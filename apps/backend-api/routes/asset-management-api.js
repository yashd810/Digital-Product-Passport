"use strict";

const logger = require("../src/infrastructure/logging/logger");

module.exports = function registerAssetManagementApiRoutes(app, {
  pool,
  authenticateToken,
  checkCompanyAccess,
  requireEditor,
  publicReadRateLimit,
  assetWriteRateLimit,
  assetSourceFetchRateLimit,
  ASSET_ERP_PRESETS,
  ASSET_MATCH_FIELDS,
  IN_REVISION_STATUS,
  assertAssetManagementEnabled,
  assertCompanyAssetPassportTypeAccess,
  getLatestCompanyPassports,
  getAssetFieldMap,
  isPlainObject,
  normalizePassportRequestBody,
  fetchAssetSourceRecords,
  prepareAssetPayload,
  executeAssetPush,
  runAssetManagementJob,
  recordAssetRun,
  resolveAssetJobNextRunAt,
}) {
  const routeBase = "/api/companies/:companyId/passport-data-management";
  const getCompanyId = (req) => Number.parseInt(req.params.companyId, 10);
  const getUserId = (req) => req.user?.userId || req.user?.id || null;

  app.use(routeBase, (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  }, authenticateToken, checkCompanyAccess);

  app.get(`${routeBase}/bootstrap`, publicReadRateLimit, async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const company = await assertAssetManagementEnabled(companyId);

      const types = await pool.query(
        `SELECT pt.id, pt."typeName", pt."displayName", pt."productCategory", pt."productIcon", pt."fieldsJson"
         FROM passport_types pt
         JOIN company_passport_access cpa ON cpa.passport_type_id = pt.id
         WHERE cpa.company_id = $1
           AND cpa.access_revoked = false
           AND pt."isActive" = true
         ORDER BY pt."productCategory" NULLS FIRST, pt."displayName" ASC`,
        [companyId]
      );

      res.json({
        company,
        passportTypes: types.rows,
        erpPresets: ASSET_ERP_PRESETS,
        security: {
          assetKeyRequired: false,
          companyScoped: true,
        },
        assumptions: {
          editableStatuses: ["draft", IN_REVISION_STATUS],
          dynamicPushesDoNotChangePassportVersions: true,
        },
      });
    } catch (error) {
      logger.error("Passport data bootstrap error:", error.message);
      res.status(500).json({ error: "Failed to load Passport Data Management bootstrap data" });
    }
  });

  app.get(`${routeBase}/passports`, publicReadRateLimit, async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const requestedType = String(req.query.passportType || "").trim();
      if (!requestedType) {
        return res.status(400).json({ error: "passportType query param is required" });
      }

      const typeSchema = await assertCompanyAssetPassportTypeAccess(companyId, requestedType);

      const rows = await getLatestCompanyPassports({
        companyId,
        passportType: typeSchema.typeName,
      });

      const assetFieldMap = getAssetFieldMap(typeSchema);
      const fields = Array.from(assetFieldMap.values());
      const allowedKeys = new Set([...assetFieldMap.keys(), ...ASSET_MATCH_FIELDS, "isEditable", "releaseStatus", "versionNumber"]);

      const cleanRows = rows.map(row => {
        const clean = {};
        Object.entries(row).forEach(([key, value]) => {
          if (allowedKeys.has(key)) {
            clean[key] = value;
          } else if (key.length >= 63) {
            for (const fk of assetFieldMap.keys()) {
              if (fk.length > 63 && fk.substring(0, 63) === key.substring(0, 63)) {
                clean[fk] = value;
                break;
              }
            }
          }
        });
        return clean;
      });

      res.json({
        companyId,
        passportType: typeSchema.typeName,
        displayName: typeSchema.displayName,
        fields,
        passports: cleanRows,
        summary: {
          total: cleanRows.length,
          editable: cleanRows.filter((row) => row.isEditable).length,
          releasedOrLocked: cleanRows.filter((row) => !row.isEditable).length,
        },
      });
    } catch (error) {
      logger.error("Passport data load error:", error.message);
      res.status(500).json({ error: "Failed to load passports for Passport Data Management" });
    }
  });

  app.post(`${routeBase}/source/fetch`, assetSourceFetchRateLimit, requireEditor, async (req, res) => {
    try {
      const sourceConfig = isPlainObject(req.body?.sourceConfig) ? req.body.sourceConfig : {};
      const fetched = await fetchAssetSourceRecords(sourceConfig);
      res.json(fetched);
    } catch (error) {
      logger.error("Passport data source fetch error:", error.message);
      res.status(400).json({ error: error.message || "Failed to fetch ERP/API records" });
    }
  });

  app.post(`${routeBase}/preview`, assetWriteRateLimit, requireEditor, async (req, res) => {
    try {
      const normalizedBody = normalizePassportRequestBody(req.body || {});
      const payload = await prepareAssetPayload({
        companyId: getCompanyId(req),
        passportType: normalizedBody.passportType,
        records: normalizedBody.records,
        options: normalizedBody.options,
      });
      res.json(payload);
    } catch (error) {
      logger.error("Passport data preview error:", error.message);
      res.status(400).json({ error: error.message || "Failed to generate Passport Data Management preview" });
    }
  });

  app.post(`${routeBase}/push`, assetWriteRateLimit, requireEditor, async (req, res) => {
    try {
      const normalizedBody = normalizePassportRequestBody(req.body || {});
      const companyId = getCompanyId(req);

      let preview;
      if (normalizedBody.generatedPayload?.passportType) {
        preview = { generatedPayload: normalizedBody.generatedPayload };
      } else {
        preview = await prepareAssetPayload({
          companyId,
          passportType: normalizedBody.passportType,
          records: normalizedBody.records,
          options: normalizedBody.options,
        });
      }

      const pushResult = await executeAssetPush({
        companyId,
        generatedPayload: preview.generatedPayload,
        userId: getUserId(req),
      });
      const status = pushResult.summary.failed
        ? (pushResult.summary.passportsCreated || pushResult.summary.passportsUpdated || pushResult.summary.dynamicFieldsPushed ? "partial" : "failed")
        : "success";
      const run = await recordAssetRun({
        companyId,
        passportType: preview.generatedPayload.passportType,
        triggerType: "manual",
        sourceKind: normalizedBody.sourceKind || "manual",
        status,
        summary: pushResult.summary,
        requestJson: { options: normalizedBody.options || {} },
        generatedJson: preview.generatedPayload,
      });

      res.json({
        status, run,
        summary: pushResult.summary,
        details: pushResult.details,
        generatedPayload: preview.generatedPayload,
      });
    } catch (error) {
      logger.error("Passport data push error:", error.message);
      res.status(400).json({ error: error.message || "Failed to apply passport data changes" });
    }
  });

  app.get(`${routeBase}/jobs`, publicReadRateLimit, async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const jobs = await pool.query(
        `SELECT * FROM asset_management_jobs WHERE company_id = $1
         ORDER BY updated_at DESC, created_at DESC LIMIT 50`,
        [companyId]
      );
      res.json({ jobs: jobs.rows });
    } catch (error) {
      logger.error("Passport data jobs load error:", error.message);
      res.status(500).json({ error: "Failed to load Passport Data Management jobs" });
    }
  });

  app.post(`${routeBase}/jobs`, assetWriteRateLimit, requireEditor, async (req, res) => {
    try {
      const normalizedBody = normalizePassportRequestBody(req.body || {});
      const companyId = getCompanyId(req);
      const passportType = String(normalizedBody.passportType || "").trim();
      const name = String(normalizedBody.name || "").trim();
      const sourceKind = String(normalizedBody.sourceKind || "manual").trim().toLowerCase();
      const sourceConfig = isPlainObject(normalizedBody.sourceConfig) ? normalizedBody.sourceConfig : {};
      const records = Array.isArray(normalizedBody.records) ? normalizedBody.records : [];
      const options = isPlainObject(normalizedBody.options) ? normalizedBody.options : {};
      const startAt = normalizedBody.startAt ? new Date(normalizedBody.startAt) : null;
      const intervalMinutes = normalizedBody.intervalMinutes === "" || normalizedBody.intervalMinutes === undefined
        ? null
        : Number.parseInt(normalizedBody.intervalMinutes, 10);
      const isActive = normalizedBody.isActive !== false;

      if (!passportType || !name) return res.status(400).json({ error: "passportType and name are required" });

      const typeSchema = await assertCompanyAssetPassportTypeAccess(companyId, passportType);

      if (sourceKind !== "api" && !records.length) return res.status(400).json({ error: "records are required for non-API asset jobs" });
      if (sourceKind === "api" && !String(sourceConfig.url || "").trim()) return res.status(400).json({ error: "sourceConfig.url is required for API asset jobs" });

      if (records.length) {
        await prepareAssetPayload({ companyId, passportType: typeSchema.typeName, records, options });
      }

      const nextRunAt = isActive
        ? resolveAssetJobNextRunAt({ startAt: startAt || new Date(), intervalMinutes, from: new Date() })
        : null;

      const inserted = await pool.query(
        `INSERT INTO asset_management_jobs
           (company_id, passport_type, name, source_kind, source_config, records_json, options_json, is_active, start_at, interval_minutes, next_run_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          companyId, typeSchema.typeName, name, sourceKind,
          JSON.stringify(sourceConfig), JSON.stringify(records), JSON.stringify(options),
          !!(isActive && nextRunAt), startAt,
          Number.isFinite(intervalMinutes) ? intervalMinutes : null,
          nextRunAt,
        ]
      );

      res.status(201).json({ job: inserted.rows[0] });
    } catch (error) {
      logger.error("Passport data job create error:", error.message);
      res.status(400).json({ error: error.message || "Failed to save Passport Data Management job" });
    }
  });

  app.patch(`${routeBase}/jobs/:jobId`, assetWriteRateLimit, requireEditor, async (req, res) => {
    try {
      const jobId = Number.parseInt(req.params.jobId, 10);
      const companyId = getCompanyId(req);
      if (!Number.isFinite(jobId)) return res.status(400).json({ error: "jobId must be numeric" });

      const existing = await pool.query(
        "SELECT * FROM asset_management_jobs WHERE id = $1 AND company_id = $2", [jobId, companyId]
      );
      if (!existing.rows.length) return res.status(404).json({ error: "Asset job not found" });

      const current = existing.rows[0];
      const normalizedBody = normalizePassportRequestBody(req.body || {});
      const passportType = normalizedBody.passportType || current.passportType;
      const typeSchema = await assertCompanyAssetPassportTypeAccess(companyId, passportType);

      const sourceKind = normalizedBody.sourceKind || current.sourceKind;
      const sourceConfig = normalizedBody.sourceConfig !== undefined
        ? (isPlainObject(normalizedBody.sourceConfig) ? normalizedBody.sourceConfig : {})
        : (current.sourceConfig || {});
      const records = normalizedBody.records !== undefined
        ? (Array.isArray(normalizedBody.records) ? normalizedBody.records : [])
        : (Array.isArray(current.recordsJson) ? current.recordsJson : []);
      const options = normalizedBody.options !== undefined
        ? (isPlainObject(normalizedBody.options) ? normalizedBody.options : {})
        : (isPlainObject(current.optionsJson) ? current.optionsJson : {});
      const startAt = normalizedBody.startAt !== undefined
        ? (normalizedBody.startAt ? new Date(normalizedBody.startAt) : null)
        : current.startAt;
      const intervalMinutes = normalizedBody.intervalMinutes !== undefined
        ? (normalizedBody.intervalMinutes === "" ? null : Number.parseInt(normalizedBody.intervalMinutes, 10))
        : current.intervalMinutes;
      const isActive = normalizedBody.isActive !== undefined ? normalizedBody.isActive !== false : current.isActive;
      const name = normalizedBody.name !== undefined ? String(normalizedBody.name || "").trim() : current.name;

      if (!name) return res.status(400).json({ error: "Job name cannot be blank" });
      if (sourceKind !== "api" && !records.length) return res.status(400).json({ error: "records are required for non-API asset jobs" });
      if (sourceKind === "api" && !String(sourceConfig.url || "").trim()) return res.status(400).json({ error: "sourceConfig.url is required for API asset jobs" });

      if (records.length) {
        await prepareAssetPayload({ companyId, passportType: typeSchema.typeName, records, options });
      }

      const nextRunAt = isActive
        ? resolveAssetJobNextRunAt({ startAt: startAt || new Date(), intervalMinutes, from: new Date() })
        : null;

      const updated = await pool.query(
        `UPDATE asset_management_jobs
         SET passport_type = $2, name = $3, source_kind = $4, source_config = $5,
             records_json = $6, options_json = $7, is_active = $8, start_at = $9,
             interval_minutes = $10, next_run_at = $11, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          jobId, typeSchema.typeName, name, sourceKind,
          JSON.stringify(sourceConfig), JSON.stringify(records), JSON.stringify(options),
          !!(isActive && nextRunAt), startAt,
          Number.isFinite(intervalMinutes) ? intervalMinutes : null,
          nextRunAt,
        ]
      );

      res.json({ job: updated.rows[0] });
    } catch (error) {
      logger.error("Passport data job update error:", error.message);
      res.status(400).json({ error: error.message || "Failed to update Passport Data Management job" });
    }
  });

  app.post(`${routeBase}/jobs/:jobId/run`, assetWriteRateLimit, requireEditor, async (req, res) => {
    try {
      const jobId = Number.parseInt(req.params.jobId, 10);
      const companyId = getCompanyId(req);
      if (!Number.isFinite(jobId)) return res.status(400).json({ error: "jobId must be numeric" });

      const job = await pool.query(
        "SELECT * FROM asset_management_jobs WHERE id = $1 AND company_id = $2", [jobId, companyId]
      );
      if (!job.rows.length) return res.status(404).json({ error: "Asset job not found" });

      const result = await runAssetManagementJob(job.rows[0], "manual_job_run", getUserId(req));
      if (result.error) {
        return res.status(400).json({ error: result.error.message, run: result.run });
      }

      res.json(result);
    } catch (error) {
      logger.error("Passport data job run error:", error.message);
      res.status(400).json({ error: error.message || "Failed to run Passport Data Management job" });
    }
  });

  app.get(`${routeBase}/runs`, publicReadRateLimit, async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const limit = Math.min(Number.parseInt(req.query.limit, 10) || 25, 100);

      const runs = await pool.query(
        `SELECT * FROM asset_management_runs WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [companyId, limit]
      );

      res.json({ runs: runs.rows });
    } catch (error) {
      logger.error("Passport data run load error:", error.message);
      res.status(500).json({ error: "Failed to load Passport Data Management run history" });
    }
  });
};
