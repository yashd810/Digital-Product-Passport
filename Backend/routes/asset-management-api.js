"use strict";

module.exports = function registerAssetManagementApiRoutes(app, {
  pool,
  requireAssetManagementKey,
  authenticateAssetPlatform,
  requireAssetEditor,
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
  // Apply auth middleware to all /api/asset-management routes
  app.use("/api/asset-management", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  }, requireAssetManagementKey, authenticateAssetPlatform);

  app.get("/api/asset-management/bootstrap", publicReadRateLimit, async (req, res) => {
    try {
      const companyId = Number.parseInt(req.assetContext.companyId, 10);
      const company = await assertAssetManagementEnabled(companyId);

      const types = await pool.query(
        `SELECT pt.id, pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon, pt.fields_json
         FROM passport_types pt
         JOIN company_passport_access cpa ON cpa.passport_type_id = pt.id
         WHERE cpa.company_id = $1
           AND cpa.access_revoked = false
           AND pt.is_active = true
         ORDER BY pt.umbrella_category NULLS FIRST, pt.display_name ASC`,
        [companyId]
      );

      res.json({
        company,
        passport_types: types.rows,
        erp_presets: ASSET_ERP_PRESETS,
        security: {
          asset_key_required: true,
          company_scoped: true,
        },
        assumptions: {
          editable_statuses: ["draft", IN_REVISION_STATUS],
          dynamic_pushes_do_not_change_passport_versions: true,
        },
      });
    } catch (error) {
      console.error("Asset bootstrap error:", error.message);
      res.status(500).json({ error: "Failed to load Asset Management bootstrap data" });
    }
  });

  app.get("/api/asset-management/passports", publicReadRateLimit, async (req, res) => {
    try {
      const companyId = Number.parseInt(req.assetContext.companyId, 10);
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
      const allowedKeys = new Set([...assetFieldMap.keys(), ...ASSET_MATCH_FIELDS, "is_editable", "release_status", "version_number"]);

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
        company_id: companyId,
        passport_type: typeSchema.typeName,
        display_name: typeSchema.displayName,
        fields,
        passports: cleanRows,
        summary: {
          total: cleanRows.length,
          editable: cleanRows.filter((row) => row.is_editable).length,
          released_or_locked: cleanRows.filter((row) => !row.is_editable).length,
        },
      });
    } catch (error) {
      console.error("Asset passport load error:", error.message);
      res.status(500).json({ error: "Failed to load passports for Asset Management" });
    }
  });

  app.post("/api/asset-management/source/fetch", assetSourceFetchRateLimit, requireAssetEditor, async (req, res) => {
    try {
      const sourceConfig = isPlainObject(req.body?.sourceConfig) ? req.body.sourceConfig : {};
      const fetched = await fetchAssetSourceRecords(sourceConfig);
      res.json(fetched);
    } catch (error) {
      console.error("Asset source fetch error:", error.message);
      res.status(400).json({ error: error.message || "Failed to fetch ERP/API records" });
    }
  });

  app.post("/api/asset-management/preview", assetWriteRateLimit, requireAssetEditor, async (req, res) => {
    try {
      const normalizedBody = normalizePassportRequestBody(req.body || {});
      const payload = await prepareAssetPayload({
        companyId: Number.parseInt(req.assetContext.companyId, 10),
        passportType: normalizedBody.passport_type,
        records: normalizedBody.records,
        options: normalizedBody.options,
      });
      res.json(payload);
    } catch (error) {
      console.error("Asset preview error:", error.message);
      res.status(400).json({ error: error.message || "Failed to generate asset JSON" });
    }
  });

  app.post("/api/asset-management/push", assetWriteRateLimit, requireAssetEditor, async (req, res) => {
    try {
      const normalizedBody = normalizePassportRequestBody(req.body || {});
      const companyId = Number.parseInt(req.assetContext.companyId, 10);

      let preview;
      if (normalizedBody.generated_payload?.passport_type) {
        preview = { generated_payload: normalizedBody.generated_payload };
      } else {
        preview = await prepareAssetPayload({
          companyId,
          passportType: normalizedBody.passport_type,
          records: normalizedBody.records,
          options: normalizedBody.options,
        });
      }

      const pushResult = await executeAssetPush({
        companyId,
        generatedPayload: preview.generated_payload,
        userId: req.assetContext.userId,
      });
      const status = pushResult.summary.failed
        ? (pushResult.summary.passports_updated || pushResult.summary.dynamic_fields_pushed ? "partial" : "failed")
        : "success";
      const run = await recordAssetRun({
        companyId,
        passportType: preview.generated_payload.passport_type,
        triggerType: "manual",
        sourceKind: normalizedBody.sourceKind || "manual",
        status,
        summary: pushResult.summary,
        requestJson: { options: normalizedBody.options || {} },
        generatedJson: preview.generated_payload,
      });

      res.json({
        status, run,
        summary: pushResult.summary,
        details: pushResult.details,
        generated_payload: preview.generated_payload,
      });
    } catch (error) {
      console.error("Asset push error:", error.message);
      res.status(400).json({ error: error.message || "Failed to push asset payload" });
    }
  });

  app.get("/api/asset-management/jobs", publicReadRateLimit, async (req, res) => {
    try {
      const companyId = Number.parseInt(req.assetContext.companyId, 10);
      const jobs = await pool.query(
        `SELECT * FROM asset_management_jobs WHERE company_id = $1
         ORDER BY updated_at DESC, created_at DESC LIMIT 50`,
        [companyId]
      );
      res.json({ jobs: jobs.rows });
    } catch (error) {
      console.error("Asset jobs load error:", error.message);
      res.status(500).json({ error: "Failed to load asset jobs" });
    }
  });

  app.post("/api/asset-management/jobs", assetWriteRateLimit, requireAssetEditor, async (req, res) => {
    try {
      const normalizedBody = normalizePassportRequestBody(req.body || {});
      const companyId = Number.parseInt(req.assetContext.companyId, 10);
      const passportType = String(normalizedBody.passport_type || "").trim();
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

      if (!passportType || !name) return res.status(400).json({ error: "passport_type and name are required" });

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
      console.error("Asset job create error:", error.message);
      res.status(400).json({ error: error.message || "Failed to save asset job" });
    }
  });

  app.patch("/api/asset-management/jobs/:jobId", assetWriteRateLimit, requireAssetEditor, async (req, res) => {
    try {
      const jobId = Number.parseInt(req.params.jobId, 10);
      const companyId = Number.parseInt(req.assetContext.companyId, 10);
      if (!Number.isFinite(jobId)) return res.status(400).json({ error: "jobId must be numeric" });

      const existing = await pool.query(
        "SELECT * FROM asset_management_jobs WHERE id = $1 AND company_id = $2", [jobId, companyId]
      );
      if (!existing.rows.length) return res.status(404).json({ error: "Asset job not found" });

      const current = existing.rows[0];
      const normalizedBody = normalizePassportRequestBody(req.body || {});
      const passportType = normalizedBody.passport_type || current.passport_type;
      const typeSchema = await assertCompanyAssetPassportTypeAccess(companyId, passportType);

      const sourceKind = normalizedBody.sourceKind || current.source_kind;
      const sourceConfig = normalizedBody.sourceConfig !== undefined
        ? (isPlainObject(normalizedBody.sourceConfig) ? normalizedBody.sourceConfig : {})
        : (current.source_config || {});
      const records = normalizedBody.records !== undefined
        ? (Array.isArray(normalizedBody.records) ? normalizedBody.records : [])
        : (Array.isArray(current.records_json) ? current.records_json : []);
      const options = normalizedBody.options !== undefined
        ? (isPlainObject(normalizedBody.options) ? normalizedBody.options : {})
        : (isPlainObject(current.options_json) ? current.options_json : {});
      const startAt = normalizedBody.startAt !== undefined
        ? (normalizedBody.startAt ? new Date(normalizedBody.startAt) : null)
        : current.start_at;
      const intervalMinutes = normalizedBody.intervalMinutes !== undefined
        ? (normalizedBody.intervalMinutes === "" ? null : Number.parseInt(normalizedBody.intervalMinutes, 10))
        : current.interval_minutes;
      const isActive = normalizedBody.isActive !== undefined ? normalizedBody.isActive !== false : current.is_active;
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
      console.error("Asset job update error:", error.message);
      res.status(400).json({ error: error.message || "Failed to update asset job" });
    }
  });

  app.post("/api/asset-management/jobs/:jobId/run", assetWriteRateLimit, requireAssetEditor, async (req, res) => {
    try {
      const jobId = Number.parseInt(req.params.jobId, 10);
      const companyId = Number.parseInt(req.assetContext.companyId, 10);
      if (!Number.isFinite(jobId)) return res.status(400).json({ error: "jobId must be numeric" });

      const job = await pool.query(
        "SELECT * FROM asset_management_jobs WHERE id = $1 AND company_id = $2", [jobId, companyId]
      );
      if (!job.rows.length) return res.status(404).json({ error: "Asset job not found" });

      const result = await runAssetManagementJob(job.rows[0], "manual_job_run", req.assetContext.userId);
      if (result.error) {
        return res.status(400).json({ error: result.error.message, run: result.run });
      }

      res.json(result);
    } catch (error) {
      console.error("Asset job run error:", error.message);
      res.status(400).json({ error: error.message || "Failed to run asset job" });
    }
  });

  app.get("/api/asset-management/runs", publicReadRateLimit, async (req, res) => {
    try {
      const companyId = Number.parseInt(req.assetContext.companyId, 10);
      const limit = Math.min(Number.parseInt(req.query.limit, 10) || 25, 100);

      const runs = await pool.query(
        `SELECT * FROM asset_management_runs WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [companyId, limit]
      );

      res.json({ runs: runs.rows });
    } catch (error) {
      console.error("Asset run load error:", error.message);
      res.status(500).json({ error: "Failed to load asset run history" });
    }
  });
};
