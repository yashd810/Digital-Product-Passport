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
  findExistingPassportByInternalAliasId,
  updatePassportRowById,
  normalizeInternalAliasIdValue,
  generateInternalAliasIdValue,
  generateDppRecordId,
  productIdentifierService,
  createPassportTable,
  archivePassportSnapshot,
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
  const VALID_GRANULARITIES = new Set(["model", "batch", "item"]);

  async function getCompanyDppPolicy(companyId) {
    const result = await pool.query(
      `SELECT c.id,
              COALESCE(p.default_granularity, 'item') AS default_granularity,
              COALESCE(p.allow_granularity_override, false) AS allow_granularity_override,
              COALESCE(p.mint_model_dids, true) AS mint_model_dids,
              COALESCE(p.mint_item_dids, true) AS mint_item_dids
       FROM companies c
       LEFT JOIN company_dpp_policies p ON p.company_id = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  function resolveGranularityForCreate(companyPolicy, requestedGranularity) {
    const fallbackGranularity = String(companyPolicy?.default_granularity || "item").trim().toLowerCase();
    const normalizedRequested = requestedGranularity === undefined || requestedGranularity === null || requestedGranularity === ""
      ? null
      : String(requestedGranularity).trim().toLowerCase();

    if (normalizedRequested && !VALID_GRANULARITIES.has(normalizedRequested)) {
      throw new Error("granularity must be one of: model, batch, item");
    }
    if (!companyPolicy) return normalizedRequested || fallbackGranularity;
    if (!companyPolicy.allowGranularityOverride && normalizedRequested && normalizedRequested !== fallbackGranularity) {
      throw new Error(`Granularity override is disabled for this company. The enforced value is "${fallbackGranularity}".`);
    }

    const effectiveGranularity = normalizedRequested && companyPolicy.allowGranularityOverride
      ? normalizedRequested
      : fallbackGranularity;

    if (effectiveGranularity === "model" && companyPolicy.mintModelDids === false) {
      throw new Error("Model-level DIDs are disabled for this company policy.");
    }
    if ((effectiveGranularity === "item" || effectiveGranularity === "batch") && companyPolicy.mintItemDids === false) {
      throw new Error("Item-level DIDs are disabled for this company policy.");
    }
    return effectiveGranularity;
  }

  function buildStoredProductIdentifiers({ companyId, companySlug = null, companyName = null, passportType, internalAliasId, granularity }) {
    if (!productIdentifierService?.normalizeProductIdentifiers) {
      return {
        internalAliasId: internalAliasId || null,
        productIdentifierDid: null,
      };
    }

    const normalized = productIdentifierService.normalizeProductIdentifiers({
      companyId,
      companySlug,
      companyName,
      passportType,
      rawProductId: internalAliasId,
      granularity,
    });
    return {
      internalAliasId: normalized.internalAliasIdInput || null,
      productIdentifierDid: normalized.productIdentifierDid || null,
    };
  }

  async function insertPassportRegistry({ client = pool, dppId, lineageId, companyId, passportType }) {
    await client.query(
      `INSERT INTO passport_registry ("dppId", "lineageId", "companyId", "passportType")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("dppId") DO NOTHING`,
      [dppId, lineageId, companyId, passportType]
    );
  }

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
        fetchedAt: new Date().toISOString()
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function prepareAssetPayload({ companyId, passportType, records, options = {} }) {
    if (!companyId) throw new Error("companyId is required");
    if (!passportType) throw new Error("passportType is required");
    if (!Array.isArray(records) || !records.length) throw new Error("records array is required");
    if (records.length > 1000) throw new Error("Max 1000 asset rows per request");

    const typeSchema = await assertCompanyAssetPassportTypeAccess(companyId, passportType);

    const fieldMap = getAssetFieldMap(typeSchema);
    const createIfNotExists = options?.createIfNotExists !== false;
    const companyPolicy = await getCompanyDppPolicy(companyId);
    const currentRows = await getLatestCompanyPassports({
      companyId,
      passportType: typeSchema.typeName
    });
    const currentByGuid = new Map(currentRows.map((row) => [row.dppId, row]));
    const currentByProductId = new Map(
      currentRows.
      filter((row) => normalizeInternalAliasIdValue(row.internalAliasId)).
      map((row) => [normalizeInternalAliasIdValue(row.internalAliasId), row])
    );

    const batchTargets = new Set();
    const batchProductIds = new Map();
    const generatedRecords = [];
    const details = [];
    const summary = {
      total: records.length,
      ready: 0,
      readyForPassportCreate: 0,
      readyForPassportUpdate: 0,
      readyForDynamicPush: 0,
      skipped: 0,
      failed: 0
    };

    records.forEach((rawRecord, index) => {
      if (!isPlainObject(rawRecord)) {
        details.push({ rowIndex: index + 1, status: "failed", error: "Each asset row must be an object" });
        summary.failed += 1;
        return;
      }

      const matchGuid = String(rawRecord.matchDppId || rawRecord.matchGuid || rawRecord.dppId || rawRecord.guid || "").trim();
      const matchProductId = normalizeInternalAliasIdValue(
        rawRecord.matchProductId !== undefined ?
          rawRecord.matchProductId :
          !matchGuid ? rawRecord.internalAliasId : ""
      );

      if (!matchGuid && !matchProductId) {
        details.push({
          rowIndex: index + 1,
          status: "failed",
          error: "Each asset row needs dppId, guid, matchDppId, matchGuid, internalAliasId, or matchProductId"
        });
        summary.failed += 1;
        return;
      }

      const matchedRow = matchGuid ?
      currentByGuid.get(matchGuid) :
      currentByProductId.get(matchProductId);

      if (!matchedRow) {
        if (!createIfNotExists) {
          details.push({
            rowIndex: index + 1,
            dppId: matchGuid || undefined,
            internalAliasId: matchProductId || undefined,
            status: "skipped",
            reason: "No matching passport was found"
          });
          summary.skipped += 1;
          return;
        }

        if (!matchProductId) {
          details.push({
            rowIndex: index + 1,
            dppId: matchGuid || undefined,
            status: "failed",
            error: "A new passport needs internalAliasId or matchProductId so a draft can be created"
          });
          summary.failed += 1;
          return;
        }

      const passportCreate = {};
      const errors = [];
      const isBlankAssetValue = (value) => {
        if (value === null || value === undefined) return true;
        return typeof value === "string" ? value.trim() === "" : false;
      };

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
            const coerced = coerceAssetFieldValue(fieldDef, value);
            if (!coerced.ok) {
              errors.push(coerced.error);
              return;
            }
            passportCreate[resolvedKey] = coerced.value;
            return;
          }

          if (isBlankAssetValue(value)) return;
          errors.push(`Unknown field "${key}"`);
        });

        const normalizedProductId = normalizeInternalAliasIdValue(passportCreate.internalAliasId || matchProductId);
        if (!normalizedProductId) {
          errors.push("internalAliasId cannot be blank");
        } else {
          passportCreate.internalAliasId = normalizedProductId;
          const duplicate = currentByProductId.get(normalizedProductId);
          if (duplicate) {
            errors.push(`Serial Number "${normalizedProductId}" already belongs to another passport`);
          }
          if (batchProductIds.has(normalizedProductId)) {
            errors.push(`Serial Number "${normalizedProductId}" is assigned twice in this batch`);
          }
        }

        const requestedGranularity = options?.granularity;
        let effectiveGranularity = null;
        try {
          effectiveGranularity = resolveGranularityForCreate(companyPolicy, requestedGranularity);
        } catch (error) {
          errors.push(error.message);
        }

        if (errors.length) {
          details.push({
            rowIndex: index + 1,
            internalAliasId: normalizedProductId || matchProductId || undefined,
            status: "failed",
            error: errors.join("; ")
          });
          summary.failed += 1;
          return;
        }

        const generatedDppId = generateDppRecordId();
        const lineageId = generatedDppId;
        const resolvedProductIdentifiers = buildStoredProductIdentifiers({
          companyId,
          passportType: typeSchema.typeName,
          internalAliasId: passportCreate.internalAliasId || generateInternalAliasIdValue(generatedDppId),
          granularity: effectiveGranularity,
        });

        passportCreate.internalAliasId = resolvedProductIdentifiers.internalAliasId;
        if (passportCreate.modelName === undefined) passportCreate.modelName = "";
        batchProductIds.set(resolvedProductIdentifiers.internalAliasId, generatedDppId);
        generatedRecords.push({
          rowIndex: index + 1,
          action: "create",
          generatedDppId: generatedDppId,
          generatedLineageId: lineageId,
          generatedGranularity: effectiveGranularity,
          internalAliasId: resolvedProductIdentifiers.internalAliasId,
          productIdentifierDid: resolvedProductIdentifiers.productIdentifierDid,
          passportCreate
        });

        summary.ready += 1;
        summary.readyForPassportCreate += 1;
        details.push({
          rowIndex: index + 1,
          dppId: generatedDppId,
          internalAliasId: resolvedProductIdentifiers.internalAliasId,
          status: "ready",
          action: "create",
          generatedDppId: generatedDppId,
          passportFields: Object.keys(passportCreate),
          dynamicFields: []
        });
        return;
      }

      if (batchTargets.has(matchedRow.dppId)) {
        details.push({
          rowIndex: index + 1,
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
      const nextProductIdProvided = rawRecord.nextProductId !== undefined;

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
            if (resolvedKey === "internalAliasId" && !matchGuid && !nextProductIdProvided) return;
            const coerced = coerceAssetFieldValue(fieldDef, value);
          if (!coerced.ok) {
            errors.push(coerced.error);
            return;
          }
          passportUpdate[resolvedKey] = coerced.value;
            return;
          }

          if (isBlankAssetValue(value)) return;
          errors.push(`Unknown field "${key}"`);
        });

      if (nextProductIdProvided) {
        const normalizedNextProductId = normalizeInternalAliasIdValue(rawRecord.nextProductId);
        if (!normalizedNextProductId) {
          errors.push("nextProductId cannot be blank");
        } else {
          passportUpdate.internalAliasId = normalizedNextProductId;
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

      if (hasPassportUpdate && !matchedRow.isEditable) {
        errors.push(`Passport is ${matchedRow.releaseStatus} and can only receive dynamic pushes right now`);
      }

      if (passportUpdate.internalAliasId !== undefined) {
        const normalizedNextProductId = normalizeInternalAliasIdValue(passportUpdate.internalAliasId);
        if (!normalizedNextProductId) {
          errors.push("internalAliasId cannot be blank");
        } else {
          passportUpdate.internalAliasId = normalizedNextProductId;
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
          rowIndex: index + 1,
          dppId: matchedRow.dppId,
          internalAliasId: matchedRow.internalAliasId,
          status: "failed",
          error: errors.join("; ")
        });
        summary.failed += 1;
        return;
      }

      if (!hasPassportUpdate && !hasDynamicValues) {
        details.push({
          rowIndex: index + 1,
          dppId: matchedRow.dppId,
          internalAliasId: matchedRow.internalAliasId,
          status: "skipped",
          reason: "No changes detected for this row"
        });
        summary.skipped += 1;
        return;
      }

      batchTargets.add(matchedRow.dppId);
      generatedRecords.push({
        rowIndex: index + 1,
        action: "update",
        matchedDppId: matchedRow.dppId,
        matchedProductId: matchedRow.internalAliasId,
        matchedReleaseStatus: matchedRow.releaseStatus,
        isEditable: matchedRow.isEditable,
        match: {
          dppId: matchGuid || null,
          internalAliasId: matchProductId || null,
          matchedBy: matchGuid ? "dppId" : "internalAliasId"
        },
        passportUpdate,
        dynamicValues
      });

      summary.ready += 1;
      if (hasPassportUpdate) summary.readyForPassportUpdate += 1;
      if (hasDynamicValues) summary.readyForDynamicPush += 1;
      details.push({
        rowIndex: index + 1,
        dppId: matchedRow.dppId,
        internalAliasId: matchedRow.internalAliasId,
        status: "ready",
        passportFields: Object.keys(passportUpdate),
        dynamicFields: Object.keys(dynamicValues)
      });
    });

    return {
      companyId: Number(companyId),
      passportType: typeSchema.typeName,
      displayName: typeSchema.displayName,
      generatedAt: new Date().toISOString(),
      fields: Array.from(fieldMap.values()),
      summary,
      details,
      generatedPayload: {
        companyId: Number(companyId),
        passportType: typeSchema.typeName,
        generatedAt: new Date().toISOString(),
        records: generatedRecords
      }
    };
  }

  async function executeAssetPush({ companyId, generatedPayload, source = "asset_management", userId = null }) {
    const passportType = generatedPayload?.passportType;
    const records = Array.isArray(generatedPayload?.records) ? generatedPayload.records : [];
    if (!passportType) throw new Error("generated payload is missing passportType");
    if (!records.length) throw new Error("generated payload is empty");

    const tableName = getTable(passportType);
    const summary = {
      processed: records.length,
      passportsCreated: 0,
      passportsUpdated: 0,
      dynamicFieldsPushed: 0,
      skipped: 0,
      failed: 0
    };
    const details = [];

    for (const item of records) {
      const action = String(item.action || (item.passportCreate ? "create" : "update")).trim().toLowerCase();
      const matchedGuid = String(item.matchedDppId || "").trim();
      const generatedDppId = String(item.generatedDppId || "").trim();
      const passportUpdate = isPlainObject(item.passportUpdate) ? { ...item.passportUpdate } : {};
      const passportCreate = isPlainObject(item.passportCreate) ? { ...item.passportCreate } : {};
      const dynamicValues = isPlainObject(item.dynamicValues) ? { ...item.dynamicValues } : {};
      const detail = {
        rowIndex: item.rowIndex,
        dppId: matchedGuid || generatedDppId || undefined,
        passportFields: Object.keys(action === "create" ? passportCreate : passportUpdate),
        dynamicFields: Object.keys(dynamicValues)
      };

      try {
        if (action === "create") {
          const normalizedProductId = normalizeInternalAliasIdValue(passportCreate.internalAliasId || item.internalAliasId);
          if (!normalizedProductId) {
            throw new Error("internalAliasId is required to create a passport");
          }

          if (typeof createPassportTable === "function") {
            await createPassportTable(passportType, {
              createdBy: userId,
              eventType: "runtime_create_reconcile_table",
            });
          }

          const duplicate = await findExistingPassportByInternalAliasId({
            tableName,
            companyId,
            internalAliasId: normalizedProductId,
          });
          if (duplicate) {
            throw new Error(`Serial Number "${normalizedProductId}" already belongs to another passport`);
          }

          const dppId = generatedDppId || generateDppRecordId();
          const lineageId = String(item.generatedLineageId || dppId).trim() || dppId;
          const effectiveGranularity = resolveGranularityForCreate(
            await getCompanyDppPolicy(companyId),
            item.generatedGranularity || "item"
          );
          const storedProductIdentifiers = buildStoredProductIdentifiers({
            companyId,
            passportType,
            internalAliasId: normalizedProductId,
            granularity: effectiveGranularity,
          });

          const insertCols = [
            "\"dppId\"",
            "\"lineageId\"",
            "\"companyId\"",
            "\"modelName\"",
            "\"internalAliasId\"",
            "\"productIdentifierDid\"",
            "\"granularity\"",
            "\"createdBy\""
          ];
          const insertVals = [
            dppId,
            lineageId,
            companyId,
            passportCreate.modelName || null,
            storedProductIdentifiers.internalAliasId,
            storedProductIdentifiers.productIdentifierDid,
            effectiveGranularity,
            userId || null
          ];

          Object.entries(passportCreate).forEach(([key, value]) => {
            if (["dppId", "lineageId", "companyId", "modelName", "internalAliasId", "productIdentifierDid", "granularity", "createdBy"].includes(key)) return;
            insertCols.push(`"${key}"`);
            insertVals.push(value);
          });

          const placeholders = insertCols.map((_, index) => `$${index + 1}`).join(", ");
          const client = await pool.connect();
          let createdRow = null;
          try {
            await client.query("BEGIN");
            const inserted = await client.query(
              `INSERT INTO ${tableName} (${insertCols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
              insertVals
            );
            createdRow = inserted.rows[0] || null;
            await insertPassportRegistry({
              client,
              dppId,
              lineageId,
              companyId,
              passportType,
            });
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }

          await logAudit(
            companyId,
            userId,
            "ASSET_CREATE",
            tableName,
            dppId,
            null,
            {
              source,
              internalAliasId: storedProductIdentifiers.internalAliasId,
              productIdentifierDid: storedProductIdentifiers.productIdentifierDid,
              granularity: effectiveGranularity,
            }
          );
          if (typeof archivePassportSnapshot === "function" && createdRow) {
            await archivePassportSnapshot({
              passport: createdRow,
              passportType,
              archivedBy: userId,
              actorIdentifier: userId ? `user:${userId}` : null,
              snapshotReason: "after_asset_create",
            });
          }

          summary.passportsCreated += 1;
          details.push({
            ...detail,
            status: "created",
            internalAliasId: storedProductIdentifiers.internalAliasId,
            generatedDppId: dppId,
          });
          continue;
        }

        let updatedFields = [];
        if (Object.keys(passportUpdate).length) {
          const editable = await pool.query(
            `SELECT id
             FROM ${tableName}
             WHERE "dppId" = $1
               AND "companyId" = $2
               AND "releaseStatus" IN ${EDITABLE_RELEASE_STATUSES_SQL}
               AND "deletedAt" IS NULL
             ORDER BY "versionNumber" DESC
             LIMIT 1`,
            [matchedGuid, companyId]
          );

          if (!editable.rows.length) {
            if (!Object.keys(dynamicValues).length) {
              summary.skipped += 1;
              details.push({ ...detail, status: "skipped", reason: "Passport is no longer editable" });
              continue;
            }
            detail.passportStatus = "skipped";
            detail.passportReason = "Passport is no longer editable";
          } else {
            if (passportUpdate.internalAliasId !== undefined) {
              const duplicate = await findExistingPassportByInternalAliasId({
                tableName,
                companyId,
                internalAliasId: normalizeInternalAliasIdValue(passportUpdate.internalAliasId),
                excludeGuid: matchedGuid
              });
              if (duplicate) {
                throw new Error(`Serial Number "${passportUpdate.internalAliasId}" already belongs to another passport`);
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
                { source, fieldsUpdated: updatedFields }
              );
              summary.passportsUpdated += 1;
              detail.passportStatus = "updated";
            } else {
              detail.passportStatus = "skipped";
              detail.passportReason = "No passport field changes detected";
            }
          }
        }

        const dynamicEntries = Object.entries(dynamicValues).filter(([fieldKey]) =>
        /^[a-z][A-Za-z0-9]{0,99}$/.test(fieldKey)
        );

        if (dynamicEntries.length) {
          for (const [fieldKey, value] of dynamicEntries) {
            await pool.query(
              `INSERT INTO passport_dynamic_values ("passportDppId", field_key, value, "updatedAt")
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
            { source, fieldsUpdated: dynamicEntries.map(([fieldKey]) => fieldKey) }
          );
          summary.dynamicFieldsPushed += dynamicEntries.length;
          detail.dynamicStatus = "pushed";
        }

        if (!updatedFields.length && !dynamicEntries.length) {
          summary.skipped += 1;
          details.push({ ...detail, status: "skipped", reason: "No actionable updates remained" });
          continue;
        }

        details.push({
          ...detail,
          status: detail.passportStatus === "skipped" ? "partial" : "updated"
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
       RETURNING id, created_at AS "createdAt"`,
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
          fetchedAt: fetched.fetchedAt,
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
        generatedPayload: prepared.generatedPayload,
        source: `asset_job:${job.id || "manual"}`,
        userId
      });

      const status = pushResult.summary.failed ?
      pushResult.summary.passportsCreated || pushResult.summary.passportsUpdated || pushResult.summary.dynamicFieldsPushed ? "partial" : "failed" :
      "success";
      const nextRunAt = job.is_active ?
      resolveAssetJobNextRunAt({
        startAt: job.start_at || prepared.generatedAt,
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
        generatedJson: prepared.generatedPayload
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
