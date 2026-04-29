"use strict";

/**
 * Asset Management service — ERP/API source fetching, payload preparation,
 * push execution, job scheduling.
 *
 * Usage:
 *   const createAssetService = require("./services/asset-management");
 *   const assetService = createAssetService({ pool, dns, net, helpers });
 */

const dns = require("dns").promises;
const net = require("net");
const logger = require("./logger");

module.exports = function createAssetService({
  pool,
  getTable,
  logAudit,
  assertCompanyAssetPassportTypeAccess,
  assertAssetManagementEnabled,
  getLatestCompanyPassports,
  findExistingPassportByProductId,
  updatePassportRowById,
  normalizeProductIdValue,
  isPlainObject,
  getValueAtPath,
  normalizeAssetHeaders,
  coerceAssetFieldValue,
  comparableHistoryFieldValue,
  toDynamicStoredValue,
  getAssetFieldMap,
  EDITABLE_RELEASE_STATUSES_SQL,
  ASSET_MATCH_FIELDS,
  ASSET_IGNORED_SYSTEM_COLUMNS,
  ASSET_SCHEDULER_INTERVAL_MS,
  ASSET_SOURCE_ALLOWED_HOSTS
}) {

  // ─── SSRF protection helpers ────────────────────────────────────────────────

  const isLocalHostname = (hostname) => {
    const normalized = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
    return normalized === "localhost" ||
    normalized === "localhost.localdomain" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local");
  };

  const isPrivateIpAddress = (address) => {
    if (!address) return true;
    const normalized = String(address).trim().toLowerCase();
    const family = net.isIP(normalized);

    if (family === 4) {
      const octets = normalized.split(".").map((part) => Number.parseInt(part, 10));
      const [a, b] = octets;
      return a === 10 ||
      a === 127 ||
      a === 0 ||
      a === 100 && b >= 64 && b <= 127 ||
      a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 ||
      a === 192 && b === 168 ||
      a === 198 && (b === 18 || b === 19);
    }

    if (family === 6) {
      return normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.") ||
      /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalized);
    }

    return true;
  };

  async function assertSafeAssetSourceUrl(urlString) {
    const parsedUrl = new URL(urlString);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Only HTTP(S) ERP/API endpoints are supported");
    }

    const hostname = String(parsedUrl.hostname || "").trim().toLowerCase().replace(/\.$/, "");
    if (!hostname) throw new Error("Source URL hostname is required");
    if (isLocalHostname(hostname)) {
      throw new Error("Local ERP/API hostnames are not allowed");
    }

    if (ASSET_SOURCE_ALLOWED_HOSTS.size > 0 && !ASSET_SOURCE_ALLOWED_HOSTS.has(hostname)) {
      throw new Error("ERP/API hostname is not in the allowed list");
    }

    if (net.isIP(hostname)) {
      if (isPrivateIpAddress(hostname)) {
        throw new Error("Private ERP/API IP addresses are not allowed");
      }
      return parsedUrl;
    }

    const resolvedAddresses = await dns.lookup(hostname, { all: true });
    if (!resolvedAddresses.length) {
      throw new Error("Unable to resolve ERP/API hostname");
    }
    if (resolvedAddresses.some((entry) => isPrivateIpAddress(entry.address))) {
      throw new Error("ERP/API hostname resolves to a private network address");
    }

    return parsedUrl;
  }

  // ─── Core asset functions ───────────────────────────────────────────────────

  async function fetchAssetSourceRecords(sourceConfig = {}) {
    const url = String(sourceConfig.url || "").trim();
    if (!url) throw new Error("Source URL is required");

    const parsedUrl = await assertSafeAssetSourceUrl(url);

    const method = String(sourceConfig.method || "GET").trim().toUpperCase();
    const headers = normalizeAssetHeaders(sourceConfig.headers);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const requestInit = {
        method,
        headers,
        signal: controller.signal,
        redirect: "error"
      };

      if (!["GET", "HEAD"].includes(method) && sourceConfig.body !== undefined && sourceConfig.body !== "") {
        if (typeof sourceConfig.body === "string") {
          requestInit.body = sourceConfig.body;
        } else {
          requestInit.body = JSON.stringify(sourceConfig.body);
          if (!requestInit.headers["Content-Type"] && !requestInit.headers["content-type"]) {
            requestInit.headers["Content-Type"] = "application/json";
          }
        }
      }

      const response = await fetch(parsedUrl, requestInit);
      const text = await response.text();
      let parsedPayload = text;
      try {parsedPayload = text ? JSON.parse(text) : null;} catch {}

      if (!response.ok) {
        throw new Error(`ERP/API request failed (${response.status})`);
      }

      let extracted = sourceConfig.recordPath ?
      getValueAtPath(parsedPayload, sourceConfig.recordPath) :
      parsedPayload;

      if (!Array.isArray(extracted) && isPlainObject(extracted)) {
        extracted = extracted.items || extracted.records || extracted.rows || extracted.data;
      }

      if (!Array.isArray(extracted)) {
        throw new Error("ERP/API source must resolve to an array of records");
      }
      if (extracted.length > 1000) {
        throw new Error("ERP/API source returned more than 1000 records");
      }

      const fieldMap = isPlainObject(sourceConfig.fieldMap) ? sourceConfig.fieldMap : null;
      const defaults = isPlainObject(sourceConfig.defaults) ? sourceConfig.defaults : {};
      const records = extracted.map((item) => {
        if (!isPlainObject(item)) return {};
        if (!fieldMap) return { ...item, ...defaults };
        return Object.entries(fieldMap).reduce((acc, [sourceKey, targetKey]) => {
          if (!targetKey) return acc;
          acc[String(targetKey)] = getValueAtPath(item, sourceKey);
          return acc;
        }, { ...defaults });
      });

      return {
        count: records.length,
        records,
        sample: records.slice(0, 3),
        endpoint: parsedUrl.toString(),
        fetched_at: new Date().toISOString()
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function prepareAssetPayload({ companyId, passportType, records, options = {} }) {
    if (!companyId) throw new Error("companyId is required");
    if (!passportType) throw new Error("passport_type is required");
    if (!Array.isArray(records) || !records.length) throw new Error("records array is required");
    if (records.length > 1000) throw new Error("Max 1000 asset rows per request");

    const typeSchema = await assertCompanyAssetPassportTypeAccess(companyId, passportType);

    const fieldMap = getAssetFieldMap(typeSchema);
    const currentRows = await getLatestCompanyPassports({
      companyId,
      passportType: typeSchema.typeName
    });
    const currentByGuid = new Map(currentRows.map((row) => [row.dppId, row]));
    const currentByProductId = new Map(
      currentRows.
      filter((row) => normalizeProductIdValue(row.product_id)).
      map((row) => [normalizeProductIdValue(row.product_id), row])
    );

    const batchTargets = new Set();
    const batchProductIds = new Map();
    const generatedRecords = [];
    const details = [];
    const summary = {
      total: records.length,
      ready: 0,
      ready_for_passport_update: 0,
      ready_for_dynamic_push: 0,
      skipped: 0,
      failed: 0
    };

    records.forEach((rawRecord, index) => {
      if (!isPlainObject(rawRecord)) {
        details.push({ row_index: index + 1, status: "failed", error: "Each asset row must be an object" });
        summary.failed += 1;
        return;
      }

      const matchGuid = String(rawRecord.match_dpp_id || rawRecord.dppId || "").trim();
      const matchProductId = normalizeProductIdValue(
        rawRecord.match_product_id !== undefined ?
        rawRecord.match_product_id :
        !matchGuid ? rawRecord.product_id : ""
      );

      if (!matchGuid && !matchProductId) {
        details.push({
          row_index: index + 1,
          status: "failed",
          error: "Each asset row needs dppId, match_dpp_id, product_id, or match_product_id"
        });
        summary.failed += 1;
        return;
      }

      const matchedRow = matchGuid ?
      currentByGuid.get(matchGuid) :
      currentByProductId.get(matchProductId);

      if (!matchedRow) {
        details.push({
          row_index: index + 1,
          dppId: matchGuid || undefined,
          product_id: matchProductId || undefined,
          status: "skipped",
          reason: "No matching passport was found"
        });
        summary.skipped += 1;
        return;
      }

      if (batchTargets.has(matchedRow.dppId)) {
        details.push({
          row_index: index + 1,
          dppId: matchedRow.dppId,
          status: "failed",
          error: "This passport is targeted more than once in the same asset batch"
        });
        summary.failed += 1;
        return;
      }

      const passportUpdate = {};
      const dynamicValues = {};
      const errors = [];
      const nextProductIdProvided = rawRecord.next_product_id !== undefined;

      Object.entries(rawRecord).forEach(([key, value]) => {
        if (ASSET_MATCH_FIELDS.has(key)) return;
        if (ASSET_IGNORED_SYSTEM_COLUMNS.has(key)) return;

        let resolvedKey = key;
        let fieldDef = fieldMap.get(key);

        if (!fieldDef && key.length >= 63) {
          for (const [fk, fd] of fieldMap) {
            if (fk.length > 63 && fk.substring(0, 63) === key.substring(0, 63)) {
              resolvedKey = fk;
              fieldDef = fd;
              break;
            }
          }
        }

        if (fieldDef) {
          if (resolvedKey === "product_id" && !matchGuid && !nextProductIdProvided) return;
          const coerced = coerceAssetFieldValue(fieldDef, value);
          if (!coerced.ok) {
            errors.push(coerced.error);
            return;
          }
          passportUpdate[resolvedKey] = coerced.value;
          return;
        }

        errors.push(`Unknown field "${key}"`);
      });

      if (nextProductIdProvided) {
        const normalizedNextProductId = normalizeProductIdValue(rawRecord.next_product_id);
        if (!normalizedNextProductId) {
          errors.push("next_product_id cannot be blank");
        } else {
          passportUpdate.product_id = normalizedNextProductId;
        }
      }

      Object.keys(passportUpdate).forEach((key) => {
        const fieldDef = fieldMap.get(key) || { key, type: "text" };
        const nextComparable = comparableHistoryFieldValue(fieldDef, passportUpdate[key]);
        const currentComparable = comparableHistoryFieldValue(fieldDef, matchedRow[key]);
        if (nextComparable === currentComparable) {
          delete passportUpdate[key];
        }
      });

      const hasPassportUpdate = Object.keys(passportUpdate).length > 0;
      const hasDynamicValues = Object.keys(dynamicValues).length > 0;

      if (hasPassportUpdate && !matchedRow.is_editable) {
        errors.push(`Passport is ${matchedRow.release_status} and can only receive dynamic pushes right now`);
      }

      if (passportUpdate.product_id !== undefined) {
        const normalizedNextProductId = normalizeProductIdValue(passportUpdate.product_id);
        if (!normalizedNextProductId) {
          errors.push("product_id cannot be blank");
        } else {
          passportUpdate.product_id = normalizedNextProductId;
          const duplicate = currentByProductId.get(normalizedNextProductId);
          if (duplicate && duplicate.dppId !== matchedRow.dppId) {
            errors.push(`Serial Number "${normalizedNextProductId}" already belongs to another passport`);
          }
          const reservedGuid = batchProductIds.get(normalizedNextProductId);
          if (reservedGuid && reservedGuid !== matchedRow.dppId) {
            errors.push(`Serial Number "${normalizedNextProductId}" is assigned twice in this batch`);
          } else {
            batchProductIds.set(normalizedNextProductId, matchedRow.dppId);
          }
        }
      }

      if (errors.length) {
        details.push({
          row_index: index + 1,
          dppId: matchedRow.dppId,
          product_id: matchedRow.product_id,
          status: "failed",
          error: errors.join("; ")
        });
        summary.failed += 1;
        return;
      }

      if (!hasPassportUpdate && !hasDynamicValues) {
        details.push({
          row_index: index + 1,
          dppId: matchedRow.dppId,
          product_id: matchedRow.product_id,
          status: "skipped",
          reason: "No changes detected for this row"
        });
        summary.skipped += 1;
        return;
      }

      batchTargets.add(matchedRow.dppId);
      generatedRecords.push({
        row_index: index + 1,
        matched_dpp_id: matchedRow.dppId,
        matched_product_id: matchedRow.product_id,
        matched_release_status: matchedRow.release_status,
        is_editable: matchedRow.is_editable,
        match: {
          dppId: matchGuid || null,
          product_id: matchProductId || null,
          matched_by: matchGuid ? "dppId" : "product_id"
        },
        passport_update: passportUpdate,
        dynamic_values: dynamicValues
      });

      summary.ready += 1;
      if (hasPassportUpdate) summary.ready_for_passport_update += 1;
      if (hasDynamicValues) summary.ready_for_dynamic_push += 1;
      details.push({
        row_index: index + 1,
        dppId: matchedRow.dppId,
        product_id: matchedRow.product_id,
        status: "ready",
        passport_fields: Object.keys(passportUpdate),
        dynamic_fields: Object.keys(dynamicValues)
      });
    });

    return {
      company_id: Number(companyId),
      passport_type: typeSchema.typeName,
      display_name: typeSchema.displayName,
      generated_at: new Date().toISOString(),
      fields: Array.from(fieldMap.values()),
      summary,
      details,
      generated_payload: {
        company_id: Number(companyId),
        passport_type: typeSchema.typeName,
        generated_at: new Date().toISOString(),
        records: generatedRecords
      }
    };
  }

  async function executeAssetPush({ companyId, generatedPayload, source = "asset_management", userId = null }) {
    const passportType = generatedPayload?.passport_type;
    const records = Array.isArray(generatedPayload?.records) ? generatedPayload.records : [];
    if (!passportType) throw new Error("generated payload is missing passport_type");
    if (!records.length) throw new Error("generated payload is empty");

    const tableName = getTable(passportType);
    const summary = {
      processed: records.length,
      passports_updated: 0,
      dynamic_fields_pushed: 0,
      skipped: 0,
      failed: 0
    };
    const details = [];

    for (const item of records) {
      const matchedGuid = String(item.matched_dpp_id || "").trim();
      const passportUpdate = isPlainObject(item.passport_update) ? { ...item.passport_update } : {};
      const dynamicValues = isPlainObject(item.dynamic_values) ? { ...item.dynamic_values } : {};
      const detail = {
        row_index: item.row_index,
        dppId: matchedGuid || undefined,
        passport_fields: Object.keys(passportUpdate),
        dynamic_fields: Object.keys(dynamicValues)
      };

      try {
        let updatedFields = [];
        if (Object.keys(passportUpdate).length) {
          const editable = await pool.query(
            `SELECT id
             FROM ${tableName}
             WHERE dpp_id = $1
               AND company_id = $2
               AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}
               AND deleted_at IS NULL
             ORDER BY version_number DESC
             LIMIT 1`,
            [matchedGuid, companyId]
          );

          if (!editable.rows.length) {
            if (!Object.keys(dynamicValues).length) {
              summary.skipped += 1;
              details.push({ ...detail, status: "skipped", reason: "Passport is no longer editable" });
              continue;
            }
            detail.passport_status = "skipped";
            detail.passport_reason = "Passport is no longer editable";
          } else {
            if (passportUpdate.product_id !== undefined) {
              const duplicate = await findExistingPassportByProductId({
                tableName,
                companyId,
                productId: normalizeProductIdValue(passportUpdate.product_id),
                excludeGuid: matchedGuid
              });
              if (duplicate) {
                throw new Error(`Serial Number "${passportUpdate.product_id}" already belongs to another passport`);
              }
            }

            updatedFields = await updatePassportRowById({
              tableName,
              rowId: editable.rows[0].id,
              userId,
              data: passportUpdate
            });

            if (updatedFields.length) {
              await logAudit(
                companyId,
                userId,
                "ASSET_UPDATE",
                tableName,
                matchedGuid,
                null,
                { source, fields_updated: updatedFields }
              );
              summary.passports_updated += 1;
              detail.passport_status = "updated";
            } else {
              detail.passport_status = "skipped";
              detail.passport_reason = "No passport field changes detected";
            }
          }
        }

        const dynamicEntries = Object.entries(dynamicValues).filter(([fieldKey]) =>
        /^[a-z][a-z0-9_]{0,99}$/.test(fieldKey)
        );

        if (dynamicEntries.length) {
          for (const [fieldKey, value] of dynamicEntries) {
            await pool.query(
              `INSERT INTO passport_dynamic_values (passport_dpp_id, field_key, value, updated_at)
               VALUES ($1, $2, $3, NOW())`,
              [matchedGuid, fieldKey, toDynamicStoredValue(value)]
            );
          }
          await logAudit(
            companyId,
            userId,
            "ASSET_DYNAMIC_PUSH",
            "passport_dynamic_values",
            matchedGuid,
            null,
            { source, fields_updated: dynamicEntries.map(([fieldKey]) => fieldKey) }
          );
          summary.dynamic_fields_pushed += dynamicEntries.length;
          detail.dynamic_status = "pushed";
        }

        if (!updatedFields.length && !dynamicEntries.length) {
          summary.skipped += 1;
          details.push({ ...detail, status: "skipped", reason: "No actionable updates remained" });
          continue;
        }

        details.push({
          ...detail,
          status: detail.passport_status === "skipped" ? "partial" : "updated"
        });
      } catch (error) {
        summary.failed += 1;
        details.push({
          ...detail,
          status: "failed",
          error: error.message
        });
      }
    }

    return { summary, details };
  }

  async function recordAssetRun({
    jobId = null,
    companyId,
    passportType,
    triggerType,
    sourceKind,
    status,
    summary,
    requestJson,
    generatedJson
  }) {
    const inserted = await pool.query(
      `INSERT INTO asset_management_runs
         (job_id, company_id, passport_type, trigger_type, source_kind, status, summary_json, request_json, generated_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, created_at`,
      [
      jobId,
      companyId,
      passportType || null,
      triggerType,
      sourceKind || null,
      status,
      summary ? JSON.stringify(summary) : null,
      requestJson ? JSON.stringify(requestJson) : null,
      generatedJson ? JSON.stringify(generatedJson) : null]

    );
    return inserted.rows[0];
  }

  const resolveAssetJobNextRunAt = ({ startAt, intervalMinutes, from = new Date() }) => {
    if (!startAt) return null;
    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) return null;
    const interval = Number.parseInt(intervalMinutes, 10);
    if (!Number.isFinite(interval) || interval <= 0) {
      return start > from ? start : null;
    }
    let next = new Date(start);
    while (next <= from) {
      next = new Date(next.getTime() + interval * 60 * 1000);
    }
    return next;
  };

  async function resolveAssetJobRecords(job) {
    if (job.source_kind === "api") {
      const fetched = await fetchAssetSourceRecords(job.source_config || {});
      return {
        records: fetched.records,
        sourceMeta: {
          endpoint: fetched.endpoint,
          fetched_at: fetched.fetched_at,
          count: fetched.count
        }
      };
    }

    return {
      records: Array.isArray(job.records_json) ? job.records_json : [],
      sourceMeta: {
        stored_records: Array.isArray(job.records_json) ? job.records_json.length : 0
      }
    };
  }

  let assetSchedulerHandle = null;
  let assetSchedulerBusy = false;

  async function runAssetManagementJob(job, triggerType = "manual", userId = null) {
    const options = isPlainObject(job.options_json) ? job.options_json : {};
    try {
      await assertAssetManagementEnabled(job.company_id);
      const resolved = await resolveAssetJobRecords(job);
      const prepared = await prepareAssetPayload({
        companyId: job.company_id,
        passportType: job.passport_type,
        records: resolved.records,
        options
      });
      const pushResult = await executeAssetPush({
        companyId: job.company_id,
        generatedPayload: prepared.generated_payload,
        source: `asset_job:${job.id || "manual"}`,
        userId
      });

      const status = pushResult.summary.failed ?
      pushResult.summary.passports_updated || pushResult.summary.dynamic_fields_pushed ? "partial" : "failed" :
      "success";
      const nextRunAt = job.is_active ?
      resolveAssetJobNextRunAt({
        startAt: job.start_at || prepared.generated_at,
        intervalMinutes: job.interval_minutes,
        from: new Date()
      }) :
      null;

      if (job.id) {
        await pool.query(
          `UPDATE asset_management_jobs
           SET last_run_at = NOW(),
               last_status = $2,
               last_summary = $3,
               next_run_at = $4,
               is_active = $5,
               updated_at = NOW()
           WHERE id = $1`,
          [
          job.id,
          status,
          JSON.stringify(pushResult.summary),
          nextRunAt,
          nextRunAt ? true : false]

        );
      }

      const run = await recordAssetRun({
        jobId: job.id || null,
        companyId: job.company_id,
        passportType: job.passport_type,
        triggerType,
        sourceKind: job.source_kind,
        status,
        summary: pushResult.summary,
        requestJson: {
          options,
          sourceMeta: resolved.sourceMeta
        },
        generatedJson: prepared.generated_payload
      });

      return {
        status,
        run,
        preview: prepared,
        result: pushResult
      };
    } catch (error) {
      const nextRunAt = job.is_active ?
      resolveAssetJobNextRunAt({
        startAt: job.start_at || new Date(),
        intervalMinutes: job.interval_minutes,
        from: new Date()
      }) :
      null;

      if (job.id) {
        await pool.query(
          `UPDATE asset_management_jobs
           SET last_run_at = NOW(),
               last_status = 'failed',
               last_summary = $2,
               next_run_at = $3,
               is_active = $4,
               updated_at = NOW()
           WHERE id = $1`,
          [
          job.id,
          JSON.stringify({ error: error.message }),
          nextRunAt,
          nextRunAt ? true : false]

        );
      }

      const run = await recordAssetRun({
        jobId: job.id || null,
        companyId: job.company_id,
        passportType: job.passport_type,
        triggerType,
        sourceKind: job.source_kind,
        status: "failed",
        summary: { error: error.message },
        requestJson: { options },
        generatedJson: null
      });

      return {
        status: "failed",
        run,
        error
      };
    }
  }

  async function processDueAssetJobs() {
    if (assetSchedulerBusy) return;
    assetSchedulerBusy = true;
    try {
      const dueJobs = await pool.query(
        `SELECT *
         FROM asset_management_jobs
         WHERE is_active = true
           AND next_run_at IS NOT NULL
           AND next_run_at <= NOW()
         ORDER BY next_run_at ASC
         LIMIT 10`
      );

      for (const job of dueJobs.rows) {
        await runAssetManagementJob(job, "scheduled");
      }
    } catch (error) {
      logger.error("[AssetManagement] scheduler error:", error.message);
    } finally {
      assetSchedulerBusy = false;
    }
  }

  function startAssetManagementScheduler() {
    if (assetSchedulerHandle) return;
    assetSchedulerHandle = setInterval(processDueAssetJobs, ASSET_SCHEDULER_INTERVAL_MS);
    setTimeout(processDueAssetJobs, 5000);
  }

  return {
    isLocalHostname,
    isPrivateIpAddress,
    assertSafeAssetSourceUrl,
    fetchAssetSourceRecords,
    prepareAssetPayload,
    executeAssetPush,
    recordAssetRun,
    resolveAssetJobNextRunAt,
    resolveAssetJobRecords,
    runAssetManagementJob,
    processDueAssetJobs,
    startAssetManagementScheduler
  };
};