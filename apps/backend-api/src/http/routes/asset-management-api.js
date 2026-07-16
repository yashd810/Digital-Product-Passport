"use strict";

const logger = require("../../services/logger");
const {
  normalizeStoredAssetSourceConfig,
  toPublicAssetSourceConfig,
} = require("../../shared/assets/asset-source-config");

module.exports = function registerAssetManagementApiRoutes(app, {
  pool,
  authenticateToken,
  checkCompanyAccess,
  requireEditor,
  publicReadRateLimit,
  assetWriteRateLimit,
  assetSourceFetchRateLimit,
  assetErpPresets,
  assetMatchFields,
  inRevisionStatus,
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
  const getCompanyId = (req) => Number(req.params.companyId);
  const getUserId = (req) => req.user?.userId || req.user?.id || null;
  const toAssetJobResponse = (job) => {
    let sourceConfig = {};
    try {
      sourceConfig = toPublicAssetSourceConfig(job.sourceConfig);
    } catch {
      sourceConfig = {};
    }
    return {
      id: job.id,
      companyId: job.companyId,
      passportType: job.passportType,
      name: job.name,
      sourceKind: job.sourceKind,
      sourceConfig,
      isActive: job.isActive,
      startAt: job.startAt,
      intervalMinutes: job.intervalMinutes,
      nextRunAt: job.nextRunAt,
      lastRunAt: job.lastRunAt,
      lastStatus: job.lastStatus,
      lastSummary: job.lastSummary,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  };

  const requireAssetManagementEnabled = async (req, res, next) => {
    const companyId = getCompanyId(req);
    if (!Number.isSafeInteger(companyId) || companyId <= 0) {
      return res.status(400).json({ error: "companyId must be a positive integer" });
    }
    try {
      req.assetManagementCompany = await assertAssetManagementEnabled(companyId);
      return next();
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      return res.status(statusCode).json({
        error: statusCode >= 500
          ? "Failed to verify Passport Data Management access"
          : (error.message || "Passport Data Management access is not allowed"),
      });
    }
  };

  app.use(routeBase, (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  }, authenticateToken, checkCompanyAccess, requireAssetManagementEnabled);

  app.get(`${routeBase}/bootstrap`, publicReadRateLimit, async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const company = req.assetManagementCompany || await assertAssetManagementEnabled(companyId);

      const types = await pool.query(
        `SELECT pt.id, pt."typeName", pt."displayName", pt."productCategory", pt."productIcon", pt."fieldsJson"
         FROM "passportTypes" pt
         JOIN "companyPassportAccess" cpa ON cpa."passportTypeId" = pt.id
         WHERE cpa."companyId" = $1
           AND cpa."accessRevoked" = false
           AND pt."isActive" = true
         ORDER BY pt."productCategory" NULLS FIRST, pt."displayName" ASC`,
        [companyId]
      );

      res.json({
        company,
        passportTypes: types.rows,
        erpPresets: assetErpPresets,
        security: {
          assetKeyRequired: false,
          companyScoped: true,
        },
        assumptions: {
          editableStatuses: ["draft", inRevisionStatus],
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
      const allowedKeys = new Set([...assetFieldMap.keys(), ...assetMatchFields, "isEditable", "releaseStatus", "versionNumber"]);

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
      const fetched = await fetchAssetSourceRecords(sourceConfig, {
        allowInlineCredentials: true,
        companyId: getCompanyId(req),
      });
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

      // A preview is advisory and is sent to an untrusted browser. Always
      // regenerate it here so field allowlists, ownership checks, and release
      // status checks are evaluated immediately before the write. This is a
      // fresh application, so accepting the former generatedPayload shortcut
      // would only preserve an unsafe compatibility path.
      if (Object.prototype.hasOwnProperty.call(normalizedBody, "generatedPayload")) {
        return res.status(400).json({
          error: "generatedPayload is not accepted; submit passportType and records instead",
        });
      }
      const preview = await prepareAssetPayload({
        companyId,
        passportType: normalizedBody.passportType,
        records: normalizedBody.records,
        options: normalizedBody.options,
      });

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

  app.get(`${routeBase}/jobs`, publicReadRateLimit, requireEditor, async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const jobs = await pool.query(
        `SELECT id, "companyId", "passportType", name, "sourceKind", "sourceConfig", "isActive",
                "startAt", "intervalMinutes", "nextRunAt", "lastRunAt", "lastStatus", "lastSummary",
                "createdAt", "updatedAt"
           FROM "assetManagementJobs" WHERE "companyId" = $1
         ORDER BY "updatedAt" DESC, "createdAt" DESC LIMIT 50`,
        [companyId]
      );
      res.json({ jobs: jobs.rows.map(toAssetJobResponse) });
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
      if (!["api", "manual"].includes(sourceKind)) return res.status(400).json({ error: "sourceKind must be api or manual" });
      const sourceConfig = sourceKind === "api"
        ? normalizeStoredAssetSourceConfig(isPlainObject(normalizedBody.sourceConfig) ? normalizedBody.sourceConfig : {})
        : {};
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
        `INSERT INTO "assetManagementJobs"
         ("companyId", "passportType", name, "sourceKind", "sourceConfig", "recordsJson", "optionsJson", "isActive", "startAt", "intervalMinutes", "nextRunAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, "companyId", "passportType", name, "sourceKind", "sourceConfig", "isActive",
                   "startAt", "intervalMinutes", "nextRunAt", "lastRunAt", "lastStatus", "lastSummary",
                   "createdAt", "updatedAt"`,
        [
          companyId, typeSchema.typeName, name, sourceKind,
          JSON.stringify(sourceConfig), JSON.stringify(records), JSON.stringify(options),
          !!(isActive && nextRunAt), startAt,
          Number.isFinite(intervalMinutes) ? intervalMinutes : null,
          nextRunAt,
        ]
      );

      res.status(201).json({ job: toAssetJobResponse(inserted.rows[0]) });
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
        "SELECT * FROM \"assetManagementJobs\" WHERE id = $1 AND \"companyId\" = $2", [jobId, companyId]
      );
      if (!existing.rows.length) return res.status(404).json({ error: "Asset job not found" });

      const current = existing.rows[0];
      const normalizedBody = normalizePassportRequestBody(req.body || {});
      const passportType = normalizedBody.passportType || current.passportType;
      const typeSchema = await assertCompanyAssetPassportTypeAccess(companyId, passportType);

      const sourceKind = String(normalizedBody.sourceKind || current.sourceKind || "manual").trim().toLowerCase();
      if (!["api", "manual"].includes(sourceKind)) return res.status(400).json({ error: "sourceKind must be api or manual" });
      const sourceConfig = sourceKind === "api"
        ? (normalizedBody.sourceConfig !== undefined
          ? normalizeStoredAssetSourceConfig(isPlainObject(normalizedBody.sourceConfig) ? normalizedBody.sourceConfig : {})
          : normalizeStoredAssetSourceConfig(current.sourceConfig || {}))
        : {};
      const clearExecutionState = normalizedBody.sourceConfig !== undefined || sourceKind !== current.sourceKind;
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
        `UPDATE "assetManagementJobs"
         SET "passportType" = $2, name = $3, "sourceKind" = $4, "sourceConfig" = $5,
             "recordsJson" = $6, "optionsJson" = $7, "isActive" = $8, "startAt" = $9,
             "intervalMinutes" = $10, "nextRunAt" = $11,
             "lastRunAt" = CASE WHEN $12 THEN NULL ELSE "lastRunAt" END,
             "lastStatus" = CASE WHEN $12 THEN NULL ELSE "lastStatus" END,
             "lastSummary" = CASE WHEN $12 THEN NULL ELSE "lastSummary" END,
             "updatedAt" = NOW()
         WHERE id = $1
         RETURNING id, "companyId", "passportType", name, "sourceKind", "sourceConfig", "isActive",
                   "startAt", "intervalMinutes", "nextRunAt", "lastRunAt", "lastStatus", "lastSummary",
                   "createdAt", "updatedAt"`,
        [
          jobId, typeSchema.typeName, name, sourceKind,
          JSON.stringify(sourceConfig), JSON.stringify(records), JSON.stringify(options),
          !!(isActive && nextRunAt), startAt,
          Number.isFinite(intervalMinutes) ? intervalMinutes : null,
          nextRunAt,
          clearExecutionState,
        ]
      );

      res.json({ job: toAssetJobResponse(updated.rows[0]) });
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
        "SELECT * FROM \"assetManagementJobs\" WHERE id = $1 AND \"companyId\" = $2", [jobId, companyId]
      );
      if (!job.rows.length) return res.status(404).json({ error: "Asset job not found" });

      const result = await runAssetManagementJob(job.rows[0], "manualJobRun", getUserId(req));
      if (result.error) {
        return res.status(400).json({ error: result.error.message, run: result.run });
      }

      res.json(result);
    } catch (error) {
      logger.error("Passport data job run error:", error.message);
      res.status(400).json({ error: error.message || "Failed to run Passport Data Management job" });
    }
  });

  app.get(`${routeBase}/runs`, publicReadRateLimit, requireEditor, async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const limit = Math.min(Number.parseInt(req.query.limit, 10) || 25, 100);

      const runs = await pool.query(
        `SELECT id, "jobId", "companyId", "passportType", "triggerType", "sourceKind", status,
                "summaryJson", "createdAt"
           FROM "assetManagementRuns" WHERE "companyId" = $1 ORDER BY "createdAt" DESC LIMIT $2`,
        [companyId, limit]
      );

      res.json({ runs: runs.rows });
    } catch (error) {
      logger.error("Passport data run load error:", error.message);
      res.status(500).json({ error: "Failed to load Passport Data Management run history" });
    }
  });
};
