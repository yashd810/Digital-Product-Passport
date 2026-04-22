"use strict";

const { v4: uuidv4 } = require("uuid");

module.exports = function registerPassportRoutes(app, {
  pool,
  fs,
  crypto,
  authenticateToken,
  checkCompanyAccess,
  checkCompanyAdmin,
  requireEditor,
  authenticateApiKey,
  publicReadRateLimit,
  apiKeyReadRateLimit,
  assetWriteRateLimit,
  upload,
  // passport service helpers
  IN_REVISION_STATUSES_SQL,
  EDITABLE_RELEASE_STATUSES_SQL,
  REVISION_BLOCKING_STATUSES_SQL,
  EDIT_SESSION_TIMEOUT_HOURS,
  EDIT_SESSION_TIMEOUT_SQL,
  IN_REVISION_STATUS,
  SYSTEM_PASSPORT_FIELDS,
  // pure helpers from passport-helpers.js
  getTable,
  normalizePassportRow,
  normalizeReleaseStatus,
  isEditablePassportStatus,
  normalizeProductIdValue,
  generateProductIdValue,
  normalizePassportRequestBody,
  getWritablePassportColumns,
  getStoredPassportValues,
  toStoredPassportValue,
  coerceBulkFieldValue,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  buildPreviewPassportPath,
  isPublicHistoryStatus,
  // db helpers from passport-service.js
  logAudit,
  getPassportTypeSchema,
  findExistingPassportByProductId,
  getPassportLineageContext,
  getPassportVersionsByLineage,
  fetchCompanyPassportRecord,
  resolveCompanyPreviewPassport,
  updatePassportRowById,
  buildPassportVersionHistory,
  clearExpiredEditSessions,
  listActiveEditSessions,
  markOlderVersionsObsolete,
  stripRestrictedFieldsForPublicView,
  getCompanyNameMap,
  queryTableStats,
  submitPassportToWorkflow,
  // signing service
  signPassport,
  buildBatteryPassJsonExport,
  storageService,
}) {

  // ─── API KEY MANAGEMENT ────────────────────────────────────────────────────

  app.get("/api/companies/:companyId/api-keys", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, name, key_prefix, created_at, last_used_at, is_active
         FROM api_keys WHERE company_id = $1 ORDER BY created_at DESC`,
        [req.params.companyId]
      );
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: "Failed to fetch API keys" }); }
  });

  app.post("/api/companies/:companyId/api-keys", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });

      const count = await pool.query(
        "SELECT COUNT(*) FROM api_keys WHERE company_id = $1 AND is_active = true",
        [req.params.companyId]
      );
      if (parseInt(count.rows[0].count) >= 10)
        return res.status(400).json({ error: "Maximum of 10 active API keys per company" });

      const rawKey   = "dpp_" + crypto.randomBytes(20).toString("hex");
      const keyHash  = crypto.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.substring(0, 16);

      const r = await pool.query(
        `INSERT INTO api_keys (company_id, name, key_hash, key_prefix, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, name, key_prefix, created_at`,
        [req.params.companyId, name.trim(), keyHash, keyPrefix, req.user.userId]
      );
      res.status(201).json({ ...r.rows[0], key: rawKey });
    } catch (e) { console.error("Create API key error:", e.message); res.status(500).json({ error: "Failed to create API key" }); }
  });

  app.delete("/api/companies/:companyId/api-keys/:keyId", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        "UPDATE api_keys SET is_active = false WHERE id = $1 AND company_id = $2 RETURNING id",
        [req.params.keyId, req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Key not found" });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed to revoke API key" }); }
  });

  // ─── PUBLIC API v1 ─────────────────────────────────────────────────────────

  app.use("/api/v1", (req, res, next) => {
    res.header("Access-Control-Allow-Origin",  "*");
    res.header("Access-Control-Allow-Headers", "X-API-Key, Content-Type");
    res.header("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/api/v1/passports", authenticateApiKey, apiKeyReadRateLimit, async (req, res) => {
    try {
      const { type, status, search, limit = "100", offset = "0" } = req.query;
      if (!type) return res.status(400).json({ error: "'type' query parameter is required" });

      const companyId = req.apiKey.companyId;
      const tableName = getTable(type);
      const cap = Math.min(parseInt(limit) || 100, 500);
      const off = Math.max(parseInt(offset) || 0, 0);

      let q = `
        WITH latest AS (
          SELECT DISTINCT ON (lineage_id) *
          FROM ${tableName}
          WHERE deleted_at IS NULL AND company_id = $1
          ORDER BY lineage_id, version_number DESC, updated_at DESC
        )
        SELECT * FROM latest WHERE 1=1
      `;
      const params = [companyId];
      let i = 2;
      if (status) { q += ` AND release_status = $${i++}`; params.push(status); }
      if (search) { q += ` AND (model_name ILIKE $${i} OR product_id ILIKE $${i})`; params.push(`%${search}%`); i++; }
      q += ` ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`;
      params.push(cap, off);

      const r = await pool.query(q, params);
      res.json({
        passport_type: type,
        count: r.rows.length,
        limit: cap,
        offset: off,
        passports: r.rows.map(p => ({ ...p, passport_type: type })),
      });
    } catch (e) { console.error("API v1 list error:", e.message); res.status(500).json({ error: "Failed to fetch passports" }); }
  });

  app.get("/api/v1/passports/:guid", authenticateApiKey, apiKeyReadRateLimit, async (req, res) => {
    try {
      const { guid }  = req.params;
      const companyId = req.apiKey.companyId;

      const reg = await pool.query(
        "SELECT passport_type FROM passport_registry WHERE guid = $1 AND company_id = $2",
        [guid, companyId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const tableName = getTable(reg.rows[0].passport_type);
      const r = await pool.query(
        `SELECT * FROM ${tableName} WHERE guid = $1 AND deleted_at IS NULL LIMIT 1`,
        [guid]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
      res.json({ ...r.rows[0], passport_type: reg.rows[0].passport_type });
    } catch (e) { console.error("API v1 get error:", e.message); res.status(500).json({ error: "Failed to fetch passport" }); }
  });

  // ─── PASSPORT CRUD ─────────────────────────────────────────────────────────

  app.post("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const normalizedBody = normalizePassportRequestBody(req.body);
      const { passport_type, model_name, product_id, ...fields } = normalizedBody;
      const userId = req.user.userId;

      if (!passport_type) return res.status(400).json({ error: "passport_type is required" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });

      const resolvedPassportType = typeSchema.typeName;
      const tableName = getTable(resolvedPassportType);
      const guid = uuidv4();
      const lineageId = guid;
      const normalizedProductId = normalizeProductIdValue(product_id) || generateProductIdValue(guid);

      const existingByProductId = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId });
      if (existingByProductId) {
        return res.status(409).json({
          error: `A passport with Serial Number "${normalizedProductId}" already exists.`,
          existing_guid: existingByProductId.guid,
          release_status: normalizeReleaseStatus(existingByProductId.release_status),
        });
      }

      const invalidFieldKeys = Object.keys(fields).filter(key =>
        !SYSTEM_PASSPORT_FIELDS.has(key) && !typeSchema.allowedKeys.has(key)
      );
      if (invalidFieldKeys.length) {
        return res.status(400).json({ error: "Unknown passport field(s) in request body", fields: invalidFieldKeys });
      }
      const dataFields = getWritablePassportColumns(fields).filter((key) => typeSchema.allowedKeys.has(key));
      const processedFields = Object.fromEntries(dataFields.map((key) => [key, toStoredPassportValue(fields[key])]));

      const allCols = ["guid","lineage_id","company_id","model_name","product_id","created_by", ...dataFields];
      const allVals = [guid, lineageId, companyId, model_name || null, normalizedProductId, userId, ...dataFields.map(k => processedFields[k])];
      const places  = allCols.map((_, i) => `$${i + 1}`).join(", ");

      const client = await pool.connect();
      let result;
      try {
        await client.query("BEGIN");
        result = await client.query(
          `INSERT INTO ${tableName} (${allCols.join(", ")}) VALUES (${places}) RETURNING *`,
          allVals
        );
        await client.query(
          `INSERT INTO passport_registry (guid, lineage_id, company_id, passport_type) VALUES ($1, $2, $3, $4) ON CONFLICT (guid) DO NOTHING`,
          [guid, lineageId, companyId, resolvedPassportType]
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      await logAudit(companyId, userId, "CREATE", tableName, guid, null, { product_id: normalizedProductId, passport_type: resolvedPassportType, model_name });
      res.status(201).json({ success: true, passport: result.rows[0] });
    } catch (e) {
      console.error("Create passport error:", e.message);
      res.status(500).json({ error: "Failed to create passport" });
    }
  });

  app.post("/api/companies/:companyId/passports/bulk", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const normalizedBody = normalizePassportRequestBody(req.body);
      const { passport_type, passports } = normalizedBody;
      const userId = req.user.userId;

      if (!passport_type) return res.status(400).json({ error: "passport_type is required" });
      if (!Array.isArray(passports) || passports.length === 0) return res.status(400).json({ error: "passports must be a non-empty array" });
      if (passports.length > 500) return res.status(400).json({ error: "Maximum 500 passports per bulk request" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });

      const resolvedPassportType = typeSchema.typeName;
      const tableName = getTable(resolvedPassportType);
      const results = [];
      let created = 0, skipped = 0, failed = 0;

      for (let i = 0; i < passports.length; i++) {
        const item = normalizePassportRequestBody(passports[i] || {});
        const { model_name, product_id, ...fields } = item;
        const guid = uuidv4();
        const lineageId = guid;
        const normalizedProductId = normalizeProductIdValue(product_id) || generateProductIdValue(guid);

        try {
          const existingByProductId = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId });
          if (existingByProductId) {
            results.push({ index: i, product_id: normalizedProductId, success: false, error: `A passport with Serial Number "${normalizedProductId}" already exists — skipped` });
            skipped++; continue;
          }
          const invalidFieldKeys = Object.keys(fields).filter(key => !SYSTEM_PASSPORT_FIELDS.has(key) && !typeSchema.allowedKeys.has(key));
          if (invalidFieldKeys.length) {
            results.push({ index: i, product_id: normalizedProductId, success: false, error: `Unknown passport field(s): ${invalidFieldKeys.join(", ")}` });
            failed++; continue;
          }
          const dataFields = getWritablePassportColumns(fields).filter((key) => typeSchema.allowedKeys.has(key));
          const processedFields = Object.fromEntries(dataFields.map((key) => [key, toStoredPassportValue(fields[key])]));
          const allCols  = ["guid","lineage_id","company_id","model_name","product_id","created_by", ...dataFields];
          const allVals  = [guid, lineageId, companyId, model_name || null, normalizedProductId, userId, ...dataFields.map(k => processedFields[k])];
          const places   = allCols.map((_, idx) => `$${idx + 1}`).join(", ");

          const r = await pool.query(
            `INSERT INTO ${tableName} (${allCols.join(", ")}) VALUES (${places}) RETURNING guid, model_name, product_id`,
            allVals
          );
          await pool.query(
            `INSERT INTO passport_registry (guid, lineage_id, company_id, passport_type) VALUES ($1,$2,$3,$4) ON CONFLICT (guid) DO NOTHING`,
            [guid, lineageId, companyId, resolvedPassportType]
          );
          await logAudit(companyId, userId, "CREATE", tableName, guid, null, { product_id: normalizedProductId, passport_type: resolvedPassportType, model_name, bulk: true });
          results.push({ index: i, success: true, guid, product_id: normalizedProductId, model_name: model_name || null });
          created++;
        } catch (e) {
          results.push({ index: i, product_id: normalizedProductId, success: false, error: e.message });
          failed++;
        }
      }

      res.status(207).json({ summary: { total: passports.length, created, skipped, failed }, results });
    } catch (e) {
      console.error("Bulk create error:", e.message);
      res.status(500).json({ error: "Bulk create failed" });
    }
  });

  app.get("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const { passportType, search, status } = req.query;
      if (!passportType) return res.status(400).json({ error: "passportType query param is required" });

      const tableName = getTable(passportType);
      let q = `SELECT p.*, u.email AS created_by_email, u.first_name, u.last_name
               FROM ${tableName} p
               LEFT JOIN users u ON u.id = p.created_by
               WHERE p.deleted_at IS NULL AND p.company_id = $1`;
      const params = [companyId]; let i = 2;

      if (status) {
        const normalizedStatus = normalizeReleaseStatus(status);
        if (normalizedStatus === IN_REVISION_STATUS) {
          q += ` AND p.release_status IN ${IN_REVISION_STATUSES_SQL}`;
        } else {
          q += ` AND p.release_status = $${i++}`;
          params.push(normalizedStatus);
        }
      }
      if (search) { q += ` AND (p.model_name ILIKE $${i} OR p.product_id ILIKE $${i})`; params.push(`%${search}%`); i++; }
      q += " ORDER BY p.lineage_id, p.version_number DESC";

      const r = await pool.query(q, params);
      res.json(r.rows.map(row => ({ ...normalizePassportRow(row), passport_type: passportType })));
    } catch (e) { res.status(500).json({ error: "Failed to fetch passports" }); }
  });

  app.post("/api/companies/:companyId/passports/bulk-fetch", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      let passport_type, identifiers;
      if (Array.isArray(req.body)) {
        identifiers = req.body;
        passport_type = identifiers[0]?.passport_type || identifiers[0]?.passportType;
      } else {
        const normalizedBody = normalizePassportRequestBody(req.body);
        passport_type = normalizedBody.passport_type;
        identifiers = normalizedBody.passports || normalizedBody.identifiers;
      }
      if (!passport_type) return res.status(400).json({ error: "passport_type required" });
      if (!Array.isArray(identifiers) || !identifiers.length) return res.status(400).json({ error: "passports or identifiers array required" });
      if (identifiers.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);
      const results = [];

      for (const item of identifiers) {
        const raw = typeof item === "string" ? { product_id: item } : (item || {});
        const guid = raw.guid;
        const productId = normalizeProductIdValue(raw.product_id || raw.productId);
        try {
          let row = null;
          if (guid) {
            const r = await pool.query(
              `SELECT p.*, u.email AS created_by_email, u.first_name, u.last_name
               FROM ${tableName} p LEFT JOIN users u ON u.id = p.created_by
               WHERE p.guid = $1 AND p.company_id = $2 AND p.deleted_at IS NULL LIMIT 1`,
              [guid, companyId]
            );
            row = r.rows[0];
          }
          if (!row && productId) {
            const r = await pool.query(
              `WITH latest AS (
                 SELECT DISTINCT ON (lineage_id) *
                 FROM ${tableName}
                 WHERE product_id = $1 AND company_id = $2 AND deleted_at IS NULL
                 ORDER BY lineage_id, version_number DESC, updated_at DESC
               )
               SELECT latest.*, u.email AS created_by_email, u.first_name, u.last_name
               FROM latest LEFT JOIN users u ON u.id = latest.created_by
               ORDER BY latest.version_number DESC LIMIT 1`,
              [productId, companyId]
            );
            row = r.rows[0];
          }
          if (row) {
            results.push({ ...normalizePassportRow(row), passport_type: typeSchema.typeName, _status: "found" });
          } else {
            results.push({ guid: guid || undefined, product_id: productId || undefined, _status: "not_found" });
          }
        } catch (e) {
          results.push({ guid: guid || undefined, product_id: productId || undefined, _status: "error", error: e.message });
        }
      }
      res.json({ total: identifiers.length, found: results.filter(r => r._status === "found").length, results });
    } catch (e) {
      console.error("Bulk fetch error:", e.message);
      res.status(500).json({ error: "Bulk fetch failed" });
    }
  });

  app.get("/api/companies/:companyId/passports/export-drafts", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const passportType = req.query.passportType;
      const fmt = (req.query.format || "csv").toLowerCase();
      const statusFilter = (req.query.status || "draft").toLowerCase();

      if (!passportType) return res.status(400).json({ error: "passportType is required" });

      const typeRes = await pool.query("SELECT fields_json, semantic_model_key FROM passport_types WHERE type_name=$1", [passportType]);
      if (!typeRes.rows.length) return res.status(404).json({ error: "Passport type not found" });

      const sections = typeRes.rows[0]?.fields_json?.sections || [];
      const schemaFields = sections.flatMap(s => s.fields || []);
      const tableName = getTable(passportType);
      const cols = ["guid", "model_name", "product_id", "release_status", ...schemaFields.map(f => f.key)];
      const safeColsSql = cols.map(c => /^[a-z][a-z0-9_]*$/.test(c) ? c : null).filter(Boolean);

      let statusSql;
      if (statusFilter === "all") {
        statusSql = "";
      } else if (statusFilter === "released") {
        statusSql = ` AND release_status = 'released'`;
      } else if (statusFilter === "in_revision" || statusFilter === "revised") {
        statusSql = ` AND release_status IN ${IN_REVISION_STATUSES_SQL}`;
      } else {
        statusSql = ` AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}`;
      }

      const passRes = await pool.query(
        `SELECT ${safeColsSql.join(", ")} FROM ${tableName}
         WHERE company_id=$1${statusSql} AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [companyId]
      );
      const rows = passRes.rows;

      if (fmt === "json" || fmt === "jsonld") {
        res.setHeader("Content-Type", "application/ld+json");
        res.setHeader("Content-Disposition", `attachment; filename="${passportType}_export.jsonld"`);
        return res.json(buildBatteryPassJsonExport(rows, passportType, {
          semanticModelKey: typeRes.rows[0]?.semantic_model_key || null,
        }));
      }

      const escCell = (v) => {
        const str = (Array.isArray(v) || (typeof v === "object" && v !== null)) ? JSON.stringify(v) : String(v ?? "");
        return `"${str.replace(/"/g, '""')}"`;
      };
      const fieldRows = [
        ["guid",           ...rows.map(r => r.guid)],
        ["model_name",     ...rows.map(r => r.model_name || "")],
        ["product_id",     ...rows.map(r => r.product_id || "")],
        ["release_status", ...rows.map(r => r.release_status || "")],
        ...schemaFields.map(f => [f.label || f.key, ...rows.map(r => r[f.key] ?? "")]),
      ];
      const headerRow = ["Field Name", ...rows.map((_, i) => `Passport ${i + 1}`)];
      const csvLines = [headerRow, ...fieldRows].map(row => row.map(escCell).join(","));

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${passportType}_export.csv"`);
      res.send(csvLines.join("\n"));
    } catch (e) {
      console.error("Export by type error:", e.message);
      res.status(500).json({ error: "Export failed" });
    }
  });

  app.get("/api/companies/:companyId/passports/archived", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const { search, passportType } = req.query;

      let q = `SELECT pa.*, u.email AS archived_by_email, u.first_name AS archived_by_first_name, u.last_name AS archived_by_last_name
               FROM passport_archives pa
               LEFT JOIN users u ON u.id = pa.archived_by
               WHERE pa.company_id = $1`;
      const params = [companyId];
      let i = 2;

      if (passportType) { q += ` AND pa.passport_type = $${i++}`; params.push(passportType); }
      if (search) { q += ` AND (pa.model_name ILIKE $${i} OR pa.product_id ILIKE $${i} OR pa.guid::text ILIKE $${i})`; params.push(`%${search}%`); i++; }

      q = `
        SELECT
          sub.*,
          COALESCE(phv.is_public, sub.release_status IN ('released', 'obsolete')) AS is_public,
          public_version.version_number AS public_version_number
        FROM (${q}) sub
        LEFT JOIN passport_history_visibility phv
          ON phv.passport_guid = sub.guid
         AND phv.version_number = sub.version_number
        LEFT JOIN LATERAL (
          SELECT pa_public.version_number
          FROM passport_archives pa_public
          LEFT JOIN passport_history_visibility phv_public
            ON phv_public.passport_guid = pa_public.guid
           AND phv_public.version_number = pa_public.version_number
          WHERE pa_public.lineage_id = sub.lineage_id
            AND pa_public.company_id = sub.company_id
            AND pa_public.release_status IN ('released', 'obsolete')
            AND COALESCE(phv_public.is_public, true) = true
          ORDER BY pa_public.version_number DESC, pa_public.archived_at DESC
          LIMIT 1
        ) public_version ON true
        ORDER BY sub.lineage_id, sub.version_number DESC, sub.archived_at DESC
      `;

      const r = await pool.query(q, params);
      res.json(r.rows);
    } catch (e) {
      console.error("Archived list error:", e.message);
      res.status(500).json({ error: "Failed to fetch archived passports" });
    }
  });

  app.get("/api/companies/:companyId/passports/:guid", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, guid } = req.params;
      const { passportType } = req.query;
      if (!passportType) return res.status(400).json({ error: "passportType query param required" });

      const resolved = await fetchCompanyPassportRecord({ companyId, guid, passportType });
      if (!resolved?.passport) return res.status(404).json({ error: "Passport not found" });

      res.json(resolved.passport);
    } catch (e) { res.status(500).json({ error: "Failed to fetch passport" }); }
  });

  app.get("/api/companies/:companyId/passports/:passportKey/preview", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, passportKey } = req.params;
      const resolved = await resolveCompanyPreviewPassport({ companyId, passportKey });
      if (!resolved?.passport) return res.status(404).json({ error: "Passport not found" });

      const passport = await stripRestrictedFieldsForPublicView(resolved.passport, resolved.passport.passport_type);
      const companyNameMap = await getCompanyNameMap([passport.company_id]);
      const companyName = companyNameMap.get(String(passport.company_id)) || "";

      res.json({
        ...passport,
        preview_mode: true,
        preview_path: buildPreviewPassportPath({ companyName, manufacturerName: passport.manufacturer, manufacturedBy: passport.manufactured_by, modelName: passport.model_name, productId: passport.product_id, fallbackGuid: passport.guid }),
        public_path: buildCurrentPublicPassportPath({ companyName, manufacturerName: passport.manufacturer, manufacturedBy: passport.manufactured_by, modelName: passport.model_name, productId: passport.product_id }),
        inactive_path: buildInactivePublicPassportPath({ companyName, manufacturerName: passport.manufacturer, manufacturedBy: passport.manufactured_by, modelName: passport.model_name, productId: passport.product_id, versionNumber: passport.version_number }),
      });
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") return res.status(409).json({ error: e.message });
      res.status(500).json({ error: "Failed to fetch passport preview" });
    }
  });

  // ─── EDIT SESSIONS ─────────────────────────────────────────────────────────

  app.get("/api/companies/:companyId/passports/:guid/edit-session", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const editors = await listActiveEditSessions(req.params.guid, req.user.userId);
      res.json({ editors, timeoutHours: EDIT_SESSION_TIMEOUT_HOURS, serverTime: new Date().toISOString() });
    } catch (e) { res.status(500).json({ error: "Failed to fetch edit session" }); }
  });

  app.post("/api/companies/:companyId/passports/:guid/edit-session", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, guid } = req.params;
      const { passportType } = req.body;
      if (!passportType) return res.status(400).json({ error: "passportType required" });

      await clearExpiredEditSessions();
      await pool.query(
        `INSERT INTO passport_edit_sessions (passport_guid, company_id, passport_type, user_id, last_activity_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (passport_guid, user_id)
         DO UPDATE SET company_id = EXCLUDED.company_id, passport_type = EXCLUDED.passport_type, last_activity_at = NOW(), updated_at = NOW()`,
        [guid, companyId, passportType, req.user.userId]
      );

      const editors = await listActiveEditSessions(guid, req.user.userId);
      res.json({ success: true, editors, timeoutHours: EDIT_SESSION_TIMEOUT_HOURS, lastActivityAt: new Date().toISOString() });
    } catch (e) { res.status(500).json({ error: "Failed to update edit session" }); }
  });

  app.delete("/api/companies/:companyId/passports/:guid/edit-session", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      await pool.query(
        "DELETE FROM passport_edit_sessions WHERE passport_guid = $1 AND user_id = $2",
        [req.params.guid, req.user.userId]
      );
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed to clear edit session" }); }
  });

  // ─── ACCESS KEY ────────────────────────────────────────────────────────────

  app.get("/api/companies/:companyId/passports/:guid/access-key", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const r = await pool.query(
        "SELECT access_key FROM passport_registry WHERE guid = $1 AND company_id = $2",
        [req.params.guid, req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
      res.json({ accessKey: r.rows[0].access_key });
    } catch (e) { res.status(500).json({ error: "Failed to get access key" }); }
  });

  // ─── BULK UPDATE ALL ───────────────────────────────────────────────────────

  app.patch("/api/companies/:companyId/passports/bulk-update-all", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { passport_type, passportType, filter, update } = normalizePassportRequestBody(req.body);

      const requestedType = passport_type || passportType;
      if (!requestedType) return res.status(400).json({ error: "passport_type required" });
      if (!update || typeof update !== "object" || !Object.keys(update).length)
        return res.status(400).json({ error: "update object with at least one field is required" });

      const typeSchema = await getPassportTypeSchema(requestedType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);

      const invalidKeys = Object.keys(update).filter((key) =>
        !typeSchema.allowedKeys.has(key) && key !== "model_name" && key !== "product_id"
      );
      if (invalidKeys.length) return res.status(400).json({ error: `Unknown field(s): ${invalidKeys.join(", ")}` });
      if (update.product_id !== undefined) return res.status(400).json({ error: "Cannot bulk-update product_id — it must be unique per passport." });

      const params = [companyId];
      let filterSql = "";
      const filterObj = filter || {};
      const statusFilter = (filterObj.status || "editable").toLowerCase();

      if (statusFilter === "all_editable" || statusFilter === "editable" || statusFilter === "draft") {
        filterSql += ` AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}`;
      } else if (statusFilter === "draft_only") {
        filterSql += ` AND release_status = 'draft'`;
      } else if (statusFilter === "in_revision") {
        filterSql += ` AND release_status IN ${IN_REVISION_STATUSES_SQL}`;
      } else {
        return res.status(400).json({ error: `Invalid status filter "${statusFilter}". Use: editable, draft_only, in_revision` });
      }

      if (filterObj.product_id_like) { params.push(`%${filterObj.product_id_like}%`); filterSql += ` AND product_id ILIKE $${params.length}`; }
      if (filterObj.model_name_like) { params.push(`%${filterObj.model_name_like}%`); filterSql += ` AND model_name ILIKE $${params.length}`; }
      if (filterObj.created_after)   { params.push(filterObj.created_after);  filterSql += ` AND created_at >= $${params.length}`; }
      if (filterObj.created_before)  { params.push(filterObj.created_before); filterSql += ` AND created_at <= $${params.length}`; }

      const countRes = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${tableName} WHERE company_id = $1${filterSql} AND deleted_at IS NULL`,
        params
      );
      const matchCount = parseInt(countRes.rows[0].cnt, 10);
      if (matchCount === 0) return res.json({ summary: { matched: 0, updated: 0 }, message: "No passports matched the filter" });
      if (matchCount > 1000 && !req.body.confirm_large_update)
        return res.status(400).json({ error: `This will update ${matchCount} passports. Send confirm_large_update: true to proceed.`, matched: matchCount });

      const updateKeys = getWritablePassportColumns(update);
      if (!updateKeys.length) return res.status(400).json({ error: "No valid fields to update" });

      const updateVals = getStoredPassportValues(updateKeys, update);
      const setOffset = params.length;
      const sets = updateKeys.map((col, i) => `${col} = $${setOffset + i + 1}`).join(", ");
      const allParams = [...params, ...updateVals, userId];
      const updatedByIdx = allParams.length;

      const updateRes = await pool.query(
        `UPDATE ${tableName}
         SET ${sets}, updated_by = $${updatedByIdx}, updated_at = NOW()
         WHERE company_id = $1${filterSql} AND deleted_at IS NULL
         RETURNING guid`,
        allParams
      );
      const updatedGuids = updateRes.rows.map(r => r.guid);

      await logAudit(companyId, userId, "BULK_UPDATE_ALL", tableName, null, null, {
        filter: filterObj, fields_updated: updateKeys, count: updatedGuids.length,
      });

      res.json({ summary: { matched: matchCount, updated: updatedGuids.length, fields_updated: updateKeys }, guids: updatedGuids });
    } catch (e) {
      console.error("Bulk update all error:", e.message);
      res.status(500).json({ error: "Bulk update all failed", detail: e.message });
    }
  });

  // ─── PATCH SINGLE ──────────────────────────────────────────────────────────

  app.patch("/api/companies/:companyId/passports/:guid", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, guid } = req.params;
      const normalizedBody = normalizePassportRequestBody(req.body);
      const { passport_type, passportType, ...fields } = normalizedBody;
      const userId = req.user.userId;

      const requestedPassportType = passport_type || passportType;
      if (!requestedPassportType) return res.status(400).json({ error: "passportType is required in body" });
      const typeSchema = await getPassportTypeSchema(requestedPassportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);

      const current = await pool.query(
        `SELECT id, lineage_id, product_id FROM ${tableName}
         WHERE guid = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL LIMIT 1`,
        [guid]
      );
      if (!current.rows.length) return res.status(404).json({ error: "Passport not found or not editable." });
      const rowId = current.rows[0].id;

      if (fields.product_id !== undefined) {
        const normalizedProductId = normalizeProductIdValue(fields.product_id);
        if (!normalizedProductId) return res.status(400).json({ error: "product_id cannot be blank" });
        const existingByProductId = await findExistingPassportByProductId({
          tableName, companyId, productId: normalizedProductId, excludeGuid: guid, excludeLineageId: current.rows[0].lineage_id,
        });
        if (existingByProductId) {
          return res.status(409).json({
            error: `A passport with Serial Number "${normalizedProductId}" already exists.`,
            existing_guid: existingByProductId.guid,
            release_status: normalizeReleaseStatus(existingByProductId.release_status),
          });
        }
        fields.product_id = normalizedProductId;
      }

      const updateFields = await updatePassportRowById({ tableName, rowId, userId, data: fields });
      if (!updateFields.length) return res.status(400).json({ error: "No fields to update" });

      await logAudit(companyId, userId, "UPDATE", tableName, guid, null, { fields_updated: updateFields });
      res.json({ success: true });
    } catch (e) {
      console.error("PATCH /passports/:guid error:", e.message);
      res.status(500).json({ error: "Failed to update passport", detail: e.message });
    }
  });

  // ─── BULK PATCH ────────────────────────────────────────────────────────────

  app.patch("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      let passport_type, passports;

      if (Array.isArray(req.body)) {
        passports = req.body;
        passport_type = passports[0]?.passport_type || passports[0]?.passportType;
      } else {
        const normalizedBody = normalizePassportRequestBody(req.body);
        passport_type = normalizedBody.passport_type;
        passports = normalizedBody.passports;
      }
      if (!passport_type) return res.status(400).json({ error: "passport_type required" });
      if (!Array.isArray(passports) || !passports.length) return res.status(400).json({ error: "passports array required" });
      if (passports.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);

      let updated = 0, skipped = 0, failed = 0;
      const details = [];

      for (const item of passports) {
        const normalizedItem = normalizePassportRequestBody(item || {});
        const { guid: incomingGuid, passport_type: _pt, passportType: _pt2, ...fields } = normalizedItem;
        const normalizedProductId = normalizeProductIdValue(fields.product_id);

        try {
          if (!incomingGuid && !normalizedProductId) {
            details.push({ status: "failed", error: "Each item needs a guid or product_id to match against" });
            failed++; continue;
          }

          const builtInCols = new Set(["product_id", "model_name"]);
          const invalidKeys = Object.keys(fields).filter((key) =>
            !SYSTEM_PASSPORT_FIELDS.has(key) && !typeSchema.allowedKeys.has(key) && !builtInCols.has(key)
          );
          if (invalidKeys.length) {
            details.push({ guid: incomingGuid, product_id: normalizedProductId || undefined, status: "failed", error: `Unknown field(s): ${invalidKeys.join(", ")}` });
            failed++; continue;
          }

          let rowId, matchedGuid, matchedLineageId = null;
          if (incomingGuid) {
            const byGuid = await pool.query(
              `SELECT id, guid, lineage_id FROM ${tableName} WHERE guid=$1 AND company_id=$2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL`,
              [incomingGuid, companyId]
            );
            if (byGuid.rows.length) { rowId = byGuid.rows[0].id; matchedGuid = byGuid.rows[0].guid; matchedLineageId = byGuid.rows[0].lineage_id; }
          }
          if (!rowId && normalizedProductId) {
            const byProductId = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId });
            if (byProductId && isEditablePassportStatus(normalizeReleaseStatus(byProductId.release_status))) {
              rowId = byProductId.id; matchedGuid = byProductId.guid; matchedLineageId = byProductId.lineage_id;
            }
          }
          if (!rowId) {
            details.push({ guid: incomingGuid, product_id: normalizedProductId || undefined, status: "skipped", reason: "No matching editable passport found" });
            skipped++; continue;
          }
          if (fields.product_id !== undefined) {
            if (!normalizedProductId) {
              details.push({ guid: matchedGuid, status: "failed", error: "product_id cannot be blank" });
              failed++; continue;
            }
            const dup = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId, excludeGuid: matchedGuid, excludeLineageId: matchedLineageId });
            if (dup) {
              details.push({ guid: matchedGuid, product_id: normalizedProductId, status: "failed", error: `Serial Number "${normalizedProductId}" already belongs to another passport` });
              failed++; continue;
            }
            fields.product_id = normalizedProductId;
          }

          const updateCols = await updatePassportRowById({ tableName, rowId, userId, data: fields });
          if (!updateCols.length) {
            details.push({ guid: matchedGuid, product_id: normalizedProductId || undefined, status: "skipped", reason: "No changes detected" });
            skipped++; continue;
          }

          await logAudit(companyId, userId, "UPDATE", tableName, matchedGuid, null, { source: "bulk_patch", fields_updated: updateCols });
          details.push({ guid: matchedGuid, product_id: normalizedProductId || undefined, status: "updated", fields_updated: updateCols });
          updated++;
        } catch (e) {
          console.error("Bulk PATCH item error:", e.message);
          details.push({ guid: incomingGuid, product_id: normalizedProductId || undefined, status: "failed", error: e.message });
          failed++;
        }
      }

      res.json({ summary: { updated, skipped, failed, total: passports.length }, details });
    } catch (e) {
      console.error("Bulk PATCH error:", e.message);
      res.status(500).json({ error: "Bulk update failed", detail: e.message });
    }
  });

  // ─── RELEASE ───────────────────────────────────────────────────────────────

  app.patch("/api/companies/:companyId/passports/:guid/release", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, guid } = req.params;
      const { passportType } = req.body;
      if (!passportType) return res.status(400).json({ error: "passportType required in body" });

      const tableName = getTable(passportType);
      const r = await pool.query(
        `UPDATE ${tableName} SET release_status = 'released', updated_at = NOW()
         WHERE guid = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}
         RETURNING *`,
        [guid]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found or already released" });
      const released = r.rows[0];

      const typeRes = await pool.query("SELECT * FROM passport_types WHERE type_name = $1", [passportType]);
      const sigData = await signPassport({ ...released, passport_type: passportType }, typeRes.rows[0] || null);
      if (sigData) {
        await pool.query(
          `INSERT INTO passport_signatures (passport_guid, version_number, data_hash, signature, signing_key_id, released_at, vc_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (passport_guid, version_number) DO NOTHING`,
          [guid, released.version_number, sigData.dataHash, sigData.signature, sigData.keyId, sigData.releasedAt, sigData.vcJson || null]
        );
      }

      await markOlderVersionsObsolete(tableName, guid, released.version_number);
      await logAudit(companyId, req.user.userId, "RELEASE", tableName, guid, { release_status: "draft_or_in_revision" }, { release_status: "released" });
      res.json({ success: true, passport: normalizePassportRow(released) });
    } catch (e) { res.status(500).json({ error: "Failed to release passport" }); }
  });

  // ─── REVISE ────────────────────────────────────────────────────────────────

  app.post("/api/companies/:companyId/passports/:guid/revise", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, guid } = req.params;
      const { passportType } = req.body;
      const userId = req.user.userId;

      if (!passportType) return res.status(400).json({ error: "passportType required in body" });
      const tableName = getTable(passportType);

      const current = await pool.query(
        `SELECT * FROM ${tableName} WHERE guid = $1 AND release_status = 'released' LIMIT 1`,
        [guid]
      );
      if (!current.rows.length) return res.status(404).json({ error: "Released passport not found" });

      const src = current.rows[0];
      const dup = await pool.query(
        `SELECT id FROM ${tableName} WHERE lineage_id = $1 AND release_status IN ${REVISION_BLOCKING_STATUSES_SQL} AND deleted_at IS NULL`,
        [src.lineage_id]
      );
      if (dup.rows.length) return res.status(409).json({ error: "An editable revision already exists." });

      const newGuid    = uuidv4();
      const newVersion = src.version_number + 1;
      const excluded   = new Set(["id","guid","created_at","updated_at","updated_by","qr_code","lineage_id"]);
      const cols       = Object.keys(src).filter(k => !excluded.has(k));
      const vals       = cols.map(k => {
        if (k === "version_number") return newVersion;
        if (k === "release_status") return IN_REVISION_STATUS;
        if (k === "created_by")     return userId;
        if (k === "deleted_at")     return null;
        return src[k];
      });

      const allCols = ["guid", "lineage_id", ...cols];
      const allVals = [newGuid, src.lineage_id, ...vals];
      const places  = allCols.map((_, i) => `$${i + 1}`).join(", ");
      await pool.query(`INSERT INTO ${tableName} (${allCols.join(", ")}) VALUES (${places})`, allVals);

      const sourceRegistry = await pool.query(
        `SELECT access_key, device_api_key FROM passport_registry WHERE guid = $1 AND company_id = $2 LIMIT 1`,
        [guid, companyId]
      );
      const sourceKeys = sourceRegistry.rows[0] || {};
      await pool.query(
        `INSERT INTO passport_registry (guid, lineage_id, company_id, passport_type, access_key, device_api_key)
         VALUES ($1, $2, $3, $4, COALESCE($5, gen_random_uuid()::text), COALESCE($6, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')))
         ON CONFLICT (guid) DO NOTHING`,
        [newGuid, src.lineage_id, companyId, passportType, sourceKeys.access_key || null, sourceKeys.device_api_key || null]
      );

      await logAudit(companyId, userId, "REVISE", tableName, newGuid, { version_number: src.version_number }, { version_number: newVersion });
      res.json({ success: true, guid: newGuid, newVersion, release_status: IN_REVISION_STATUS });
    } catch (e) { res.status(500).json({ error: "Failed to revise passport" }); }
  });

  // ─── BULK REVISE ───────────────────────────────────────────────────────────

  app.post("/api/companies/:companyId/passports/bulk-revise", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const {
        items, changes, revisionNote = "", submitToWorkflow = false,
        reviewerId = null, approverId = null,
        scopeType = "selected", scopeMeta = {},
      } = req.body || {};

      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items must be a non-empty array" });
      if (items.length > 500) return res.status(400).json({ error: "Maximum 500 passports per bulk revise request" });
      if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length)
        return res.status(400).json({ error: "changes must be a non-empty object" });
      if (submitToWorkflow && !reviewerId && !approverId)
        return res.status(400).json({ error: "Select at least one reviewer or approver to auto-submit revisions to workflow." });
      if (reviewerId && approverId && String(reviewerId) === String(approverId))
        return res.status(400).json({ error: "Reviewer and approver must be different users." });

      const uniqueGuids = [...new Set(items.map(item => String(item?.guid || "").trim()).filter(Boolean))];
      if (!uniqueGuids.length) return res.status(400).json({ error: "No valid passport GUIDs were provided." });

      const registryRes = await pool.query(
        `SELECT guid, passport_type FROM passport_registry WHERE company_id = $1 AND guid = ANY($2::uuid[])`,
        [companyId, uniqueGuids]
      );

      const registryByGuid = new Map(registryRes.rows.map(row => [row.guid, row.passport_type]));
      const resolvedItems = uniqueGuids
        .map(guid => ({ guid, passport_type: registryByGuid.get(guid) || null }))
        .filter(item => item.passport_type);

      if (!resolvedItems.length) return res.status(404).json({ error: "No matching passports were found for this company." });

      const passportTypes = [...new Set(resolvedItems.map(item => item.passport_type))];
      const batchPassportType = passportTypes.length === 1 ? passportTypes[0] : null;

      const batchRes = await pool.query(
        `INSERT INTO passport_revision_batches
           (company_id, passport_type, requested_by, scope_type, scope_meta, revision_note, changes_json,
            submit_to_workflow, reviewer_id, approver_id, total_targeted)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, created_at`,
        [companyId, batchPassportType, userId, scopeType, JSON.stringify(scopeMeta || {}), revisionNote || null, JSON.stringify(changes), !!submitToWorkflow,
         reviewerId ? parseInt(reviewerId, 10) : null, approverId ? parseInt(approverId, 10) : null, resolvedItems.length]
      );
      const batch = batchRes.rows[0];

      const details = [];
      let revised = 0, skipped = 0, failed = 0;

      const groupedItems = resolvedItems.reduce((acc, item) => {
        if (!acc[item.passport_type]) acc[item.passport_type] = [];
        acc[item.passport_type].push(item.guid);
        return acc;
      }, {});

      for (const [passportType, guids] of Object.entries(groupedItems)) {
        const tableName = getTable(passportType);
        const typeRes = await pool.query("SELECT fields_json, display_name FROM passport_types WHERE type_name = $1", [passportType]);
        const sections = typeRes.rows[0]?.fields_json?.sections || [];
        const fieldMap = new Map(sections.flatMap(section => section.fields || []).map(field => [field.key, field]));
        fieldMap.set("model_name", { key: "model_name", label: "Model Name", type: "text" });
        fieldMap.set("product_id", { key: "product_id", label: "Serial Number", type: "text" });

        const applicableChanges = Object.entries(changes).filter(([key]) => fieldMap.has(key) && /^[a-z][a-z0-9_]+$/.test(key));

        const releasedRes = await pool.query(
          `SELECT * FROM ${tableName}
           WHERE company_id = $1 AND guid = ANY($2::uuid[]) AND release_status = 'released' AND deleted_at IS NULL`,
          [companyId, guids]
        );
        const releasedByGuid = new Map(releasedRes.rows.map(row => [row.guid, row]));

        for (const guid of guids) {
          const insertBatchItem = async (status, message, sourceVersion = null, newVersion = null) => {
            await pool.query(
              `INSERT INTO passport_revision_batch_items
                 (batch_id, passport_guid, passport_type, source_version_number, new_version_number, status, message)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [batch.id, guid, passportType, sourceVersion, newVersion, status, message || null]
            );
          };

          const source = releasedByGuid.get(guid);
          if (!source) {
            const message = "No released passport version was found for this GUID.";
            details.push({ guid, passport_type: passportType, status: "skipped", message });
            skipped++;
            await insertBatchItem("skipped", message);
            continue;
          }

          const blockerRes = await pool.query(
            `SELECT guid, version_number, release_status FROM ${tableName}
             WHERE company_id = $1 AND lineage_id = $2 AND release_status IN ${REVISION_BLOCKING_STATUSES_SQL} AND deleted_at IS NULL
             ORDER BY version_number DESC LIMIT 1`,
            [companyId, source.lineage_id]
          );
          const blocker = blockerRes.rows[0];
          if (blocker) {
            const blockerStatus = normalizeReleaseStatus(blocker.release_status);
            const message = blockerStatus === "in_review"
              ? "A revision is already in workflow for this passport."
              : "An editable revision already exists for this passport.";
            details.push({ guid, passport_type: passportType, status: "skipped", source_version_number: source.version_number, message });
            skipped++;
            await insertBatchItem("skipped", message, source.version_number, blocker.version_number || null);
            continue;
          }

          if (!applicableChanges.length) {
            const message = "None of the requested change fields apply to this passport type.";
            details.push({ guid, passport_type: passportType, status: "skipped", source_version_number: source.version_number, message });
            skipped++;
            await insertBatchItem("skipped", message, source.version_number, null);
            continue;
          }

          try {
            const sourceVersion = parseInt(source.version_number, 10) || 1;
            const newVersion = sourceVersion + 1;
            const newGuid = uuidv4();
            const excluded = new Set(["id", "guid", "created_at", "updated_at", "updated_by", "qr_code", "lineage_id"]);
            const columns = Object.keys(source).filter(key => !excluded.has(key));
            const mappedChanges = Object.fromEntries(
              applicableChanges.map(([key, value]) => [key, coerceBulkFieldValue(fieldMap.get(key), value)])
            );

            const values = columns.map((key) => {
              if (key === "version_number") return newVersion;
              if (key === "release_status") return IN_REVISION_STATUS;
              if (key === "created_by") return userId;
              if (key === "deleted_at") return null;
              if (Object.prototype.hasOwnProperty.call(mappedChanges, key)) return toStoredPassportValue(mappedChanges[key]);
              return source[key];
            });

            const allColumns = ["guid", "lineage_id", ...columns];
            const allValues  = [newGuid, source.lineage_id, ...values];
            const placeholders = allColumns.map((_, index) => `$${index + 1}`).join(", ");
            await pool.query(`INSERT INTO ${tableName} (${allColumns.join(", ")}) VALUES (${placeholders})`, allValues);

            const sourceRegistry = await pool.query(
              `SELECT access_key, device_api_key FROM passport_registry WHERE guid = $1 AND company_id = $2 LIMIT 1`,
              [guid, companyId]
            );
            const sourceKeys = sourceRegistry.rows[0] || {};
            await pool.query(
              `INSERT INTO passport_registry (guid, lineage_id, company_id, passport_type, access_key, device_api_key)
               VALUES ($1, $2, $3, $4, COALESCE($5, gen_random_uuid()::text), COALESCE($6, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')))
               ON CONFLICT (guid) DO NOTHING`,
              [newGuid, source.lineage_id, companyId, passportType, sourceKeys.access_key || null, sourceKeys.device_api_key || null]
            );

            let detailStatus = submitToWorkflow ? "submitted" : "revised";
            let detailMessage = revisionNote || null;

            if (submitToWorkflow) {
              try {
                await submitPassportToWorkflow({ companyId, guid: newGuid, passportType, userId, reviewerId, approverId });
                detailMessage = detailMessage ? `${detailMessage} Submitted to workflow.` : "Revision created and submitted to workflow.";
              } catch (workflowError) {
                detailStatus = "revised";
                detailMessage = detailMessage
                  ? `${detailMessage} Workflow submission failed: ${workflowError.message}`
                  : `Revision created, but workflow submission failed: ${workflowError.message}`;
              }
            }

            await logAudit(companyId, userId, "BULK_REVISE", tableName, newGuid,
              { version_number: sourceVersion, release_status: source.release_status },
              { version_number: newVersion, release_status: submitToWorkflow ? "in_review" : IN_REVISION_STATUS, batch_id: batch.id, revision_note: revisionNote || null, fields_updated: Object.keys(mappedChanges) }
            );

            details.push({ guid: newGuid, passport_type: passportType, status: detailStatus, source_version_number: sourceVersion, new_version_number: newVersion, message: detailMessage });
            revised++;
            await insertBatchItem(detailStatus, detailMessage, sourceVersion, newVersion);
          } catch (e) {
            const message = e.message || "Bulk revise failed for this passport.";
            details.push({ guid, passport_type: passportType, status: "failed", source_version_number: source.version_number || null, message });
            failed++;
            await insertBatchItem("failed", message, source.version_number || null, null);
          }
        }
      }

      await pool.query(
        `UPDATE passport_revision_batches SET revised_count=$1, skipped_count=$2, failed_count=$3, updated_at=NOW() WHERE id=$4`,
        [revised, skipped, failed, batch.id]
      );

      res.json({
        success: true,
        batch: { id: batch.id, created_at: batch.created_at, passport_type: batchPassportType, scope_type: scopeType },
        summary: { targeted: resolvedItems.length, revised, skipped, failed },
        details,
      });
    } catch (e) {
      console.error("Bulk revise error:", e.message);
      res.status(500).json({ error: "Bulk revise failed" });
    }
  });

  // ─── DELETE ────────────────────────────────────────────────────────────────

  app.delete("/api/companies/:companyId/passports/:guid", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, guid } = req.params;
      const { passportType } = req.body;
      if (!passportType) return res.status(400).json({ error: "passportType required in body" });

      const tableName = getTable(passportType);
      const r = await pool.query(
        `UPDATE ${tableName} SET deleted_at = NOW()
         WHERE guid = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
         RETURNING guid`,
        [guid]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found or cannot delete a released passport" });
      await logAudit(companyId, req.user.userId, "DELETE", tableName, guid, { guid }, null);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed to delete passport" }); }
  });

  app.delete("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      let passport_type, identifiers;

      if (Array.isArray(req.body)) {
        identifiers = req.body;
        passport_type = identifiers[0]?.passport_type || identifiers[0]?.passportType;
      } else {
        const normalizedBody = normalizePassportRequestBody(req.body);
        passport_type = normalizedBody.passport_type;
        identifiers = normalizedBody.passports || normalizedBody.identifiers;
      }
      if (!passport_type) return res.status(400).json({ error: "passport_type required" });
      if (!Array.isArray(identifiers) || !identifiers.length) return res.status(400).json({ error: "passports or identifiers array required" });
      if (identifiers.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);

      let deleted = 0, skipped = 0, failed = 0;
      const details = [];

      for (const item of identifiers) {
        const raw = typeof item === "string" ? { product_id: item } : (item || {});
        const guid = raw.guid;
        const productId = normalizeProductIdValue(raw.product_id || raw.productId);
        try {
          if (!guid && !productId) { details.push({ status: "failed", error: "Each item needs a guid or product_id" }); failed++; continue; }
          let matchedGuid = null;
          if (guid) {
            const r = await pool.query(
              `UPDATE ${tableName} SET deleted_at = NOW()
               WHERE guid = $1 AND company_id = $2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
               RETURNING guid`,
              [guid, companyId]
            );
            if (r.rows.length) matchedGuid = r.rows[0].guid;
          }
          if (!matchedGuid && productId) {
            const existing = await findExistingPassportByProductId({ tableName, companyId, productId });
            if (existing && isEditablePassportStatus(normalizeReleaseStatus(existing.release_status))) {
              const r = await pool.query(`UPDATE ${tableName} SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING guid`, [existing.id]);
              if (r.rows.length) matchedGuid = r.rows[0].guid;
            }
          }
          if (!matchedGuid) {
            details.push({ guid: guid || undefined, product_id: productId || undefined, status: "skipped", reason: "Not found or not deletable" });
            skipped++; continue;
          }
          await logAudit(companyId, userId, "DELETE", tableName, matchedGuid, { guid: matchedGuid }, null);
          details.push({ guid: matchedGuid, product_id: productId || undefined, status: "deleted" });
          deleted++;
        } catch (e) {
          details.push({ guid: guid || undefined, product_id: productId || undefined, status: "failed", error: e.message });
          failed++;
        }
      }

      res.json({ summary: { deleted, skipped, failed, total: identifiers.length }, details });
    } catch (e) {
      console.error("Bulk DELETE error:", e.message);
      res.status(500).json({ error: "Bulk delete failed", detail: e.message });
    }
  });

  // ─── BULK RELEASE ──────────────────────────────────────────────────────────

  app.post("/api/companies/:companyId/passports/bulk-release", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { items } = req.body || {};

      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items must be a non-empty array of { guid, passportType }" });
      if (items.length > 500) return res.status(400).json({ error: "Maximum 500 passports per bulk release request" });

      const invalid = items.filter(i => !i?.guid || !i?.passportType && !i?.passport_type);
      if (invalid.length) return res.status(400).json({ error: `${invalid.length} item(s) missing guid or passportType` });

      let released = 0, skipped = 0, failed = 0;
      const details = [];

      for (const item of items) {
        const guid = item?.guid;
        const passportType = item?.passportType || item?.passport_type;
        if (!guid || !passportType) { details.push({ guid, status: "failed", message: "Missing guid or passportType" }); failed++; continue; }
        try {
          const tableName = getTable(passportType);
          const r = await pool.query(
            `UPDATE ${tableName} SET release_status = 'released', updated_at = NOW()
             WHERE guid = $1 AND company_id = $2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
             RETURNING *`,
            [guid, companyId]
          );
          if (!r.rows.length) { details.push({ guid, status: "skipped", message: "Not found or already released" }); skipped++; continue; }
          const releasedRow = r.rows[0];

          const typeRes = await pool.query("SELECT * FROM passport_types WHERE type_name = $1", [passportType]);
          const sigData = await signPassport({ ...releasedRow, passport_type: passportType }, typeRes.rows[0] || null);
          if (sigData) {
            await pool.query(
              `INSERT INTO passport_signatures (passport_guid, version_number, data_hash, signature, signing_key_id, released_at, vc_json)
               VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (passport_guid, version_number) DO NOTHING`,
              [guid, releasedRow.version_number, sigData.dataHash, sigData.signature, sigData.keyId, sigData.releasedAt, sigData.vcJson || null]
            );
          }

          await markOlderVersionsObsolete(tableName, guid, releasedRow.version_number);
          await logAudit(companyId, userId, "RELEASE", tableName, guid, { release_status: "draft_or_in_revision" }, { release_status: "released" });
          details.push({ guid, status: "released", version: releasedRow.version_number });
          released++;
        } catch (e) { details.push({ guid, status: "failed", message: e.message }); failed++; }
      }

      res.json({ summary: { released, skipped, failed, total: items.length }, details });
    } catch (e) {
      console.error("Bulk release error:", e.message);
      res.status(500).json({ error: "Bulk release failed", detail: e.message });
    }
  });

  // ─── BULK WORKFLOW ─────────────────────────────────────────────────────────

  app.post("/api/companies/:companyId/passports/bulk-workflow", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { items, reviewerId, approverId } = req.body || {};

      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items must be a non-empty array of { guid, passportType }" });
      if (items.length > 500) return res.status(400).json({ error: "Maximum 500 passports per bulk workflow request" });
      if (!reviewerId && !approverId) return res.status(400).json({ error: "Select at least one reviewer or approver." });

      const invalid = items.filter(i => !i?.guid || !i?.passportType && !i?.passport_type);
      if (invalid.length) return res.status(400).json({ error: `${invalid.length} item(s) missing guid or passportType` });

      let submitted = 0, skipped = 0, failed = 0;
      const details = [];

      for (const item of items) {
        const guid = item?.guid;
        const passportType = item?.passportType || item?.passport_type;
        if (!guid || !passportType) { details.push({ guid, status: "failed", message: "Missing guid or passportType" }); failed++; continue; }
        try {
          await submitPassportToWorkflow({ companyId, guid, passportType, userId, reviewerId, approverId });
          details.push({ guid, status: "submitted" });
          submitted++;
        } catch (e) { details.push({ guid, status: "skipped", message: e.message }); skipped++; }
      }

      res.json({ summary: { submitted, skipped, failed, total: items.length }, details });
    } catch (e) {
      console.error("Bulk workflow error:", e.message);
      res.status(500).json({ error: "Bulk workflow submit failed", detail: e.message });
    }
  });

  // ─── ARCHIVE ───────────────────────────────────────────────────────────────

  app.post("/api/companies/:companyId/passports/:guid/archive", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, guid } = req.params;
      const { passportType } = req.body;
      const userId = req.user.userId;
      if (!passportType) return res.status(400).json({ error: "passportType required" });

      const tableName = getTable(passportType);
      const lineageContext = await getPassportLineageContext({ guid, passportType, companyId });
      if (!lineageContext?.lineage_id) return res.status(404).json({ error: "Passport not found" });

      const rows = await pool.query(
        `SELECT * FROM ${tableName} WHERE lineage_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [lineageContext.lineage_id, companyId]
      );
      if (!rows.rows.length) return res.status(404).json({ error: "Passport not found" });

      for (const row of rows.rows) {
        const { id, deleted_at, ...rowData } = row;
        await pool.query(
          `INSERT INTO passport_archives (guid, lineage_id, company_id, passport_type, version_number, model_name, product_id, release_status, row_data, archived_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [row.guid, row.lineage_id, companyId, passportType, row.version_number, row.model_name, row.product_id, row.release_status, JSON.stringify(rowData), userId]
        );
      }
      await pool.query(
        `UPDATE ${tableName} SET deleted_at = NOW() WHERE lineage_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [lineageContext.lineage_id, companyId]
      );

      await logAudit(companyId, userId, "ARCHIVE", tableName, guid, null, { versions_archived: rows.rows.length });
      res.json({ success: true, versions_archived: rows.rows.length });
    } catch (e) {
      console.error("Archive error:", e.message);
      res.status(500).json({ error: "Failed to archive passport" });
    }
  });

  app.post("/api/companies/:companyId/passports/bulk-archive", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { items } = req.body || {};
      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items required" });
      if (items.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      const invalid = items.filter(i => !i?.guid || !i?.passportType && !i?.passport_type);
      if (invalid.length) return res.status(400).json({ error: `${invalid.length} item(s) missing guid or passportType` });

      let archived = 0, skipped = 0;
      for (const item of items) {
        const guid = item?.guid;
        const passportType = item?.passportType || item?.passport_type;
        if (!guid || !passportType) { skipped++; continue; }
        try {
          const tableName = getTable(passportType);
          const lineageContext = await getPassportLineageContext({ guid, passportType, companyId });
          if (!lineageContext?.lineage_id) { skipped++; continue; }
          const rows = await pool.query(
            `SELECT * FROM ${tableName} WHERE lineage_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [lineageContext.lineage_id, companyId]
          );
          if (!rows.rows.length) { skipped++; continue; }
          for (const row of rows.rows) {
            const { id, deleted_at, ...rowData } = row;
            await pool.query(
              `INSERT INTO passport_archives (guid, lineage_id, company_id, passport_type, version_number, model_name, product_id, release_status, row_data, archived_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [row.guid, row.lineage_id, companyId, passportType, row.version_number, row.model_name, row.product_id, row.release_status, JSON.stringify(rowData), userId]
            );
          }
          await pool.query(
            `UPDATE ${tableName} SET deleted_at = NOW() WHERE lineage_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [lineageContext.lineage_id, companyId]
          );
          await logAudit(companyId, userId, "ARCHIVE", tableName, guid, null, { versions_archived: rows.rows.length });
          archived++;
        } catch { skipped++; }
      }
      res.json({ summary: { archived, skipped, total: items.length } });
    } catch (e) {
      console.error("Bulk archive error:", e.message);
      res.status(500).json({ error: "Bulk archive failed" });
    }
  });

  app.post("/api/companies/:companyId/passports/:guid/unarchive", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, guid } = req.params;
      const userId = req.user.userId;

      const archiveContext = await pool.query(
        `SELECT lineage_id FROM passport_archives WHERE (guid = $1 OR lineage_id = $1) AND company_id = $2 ORDER BY version_number DESC LIMIT 1`,
        [guid, companyId]
      );
      if (!archiveContext.rows.length) return res.status(404).json({ error: "Archived passport not found" });

      const archiveRows = await pool.query(
        `SELECT * FROM passport_archives WHERE lineage_id = $1 AND company_id = $2 ORDER BY version_number ASC`,
        [archiveContext.rows[0].lineage_id, companyId]
      );
      if (!archiveRows.rows.length) return res.status(404).json({ error: "Archived passport not found" });

      const passportType = archiveRows.rows[0].passport_type;
      const tableName = getTable(passportType);

      for (const ar of archiveRows.rows) {
        const existing = await pool.query(
          `SELECT id FROM ${tableName} WHERE guid = $1 AND version_number = $2`,
          [ar.guid, ar.version_number]
        );
        if (existing.rows.length) {
          await pool.query(`UPDATE ${tableName} SET deleted_at = NULL WHERE guid = $1 AND version_number = $2`, [ar.guid, ar.version_number]);
        }
      }
      await pool.query(
        `UPDATE ${tableName} SET deleted_at = NULL WHERE lineage_id = $1 AND company_id = $2`,
        [archiveRows.rows[0].lineage_id, companyId]
      );
      await pool.query(`DELETE FROM passport_archives WHERE lineage_id = $1 AND company_id = $2`, [archiveRows.rows[0].lineage_id, companyId]);

      await logAudit(companyId, userId, "UNARCHIVE", tableName, guid, null, { versions_restored: archiveRows.rows.length });
      res.json({ success: true, versions_restored: archiveRows.rows.length });
    } catch (e) {
      console.error("Unarchive error:", e.message);
      res.status(500).json({ error: "Failed to unarchive passport" });
    }
  });

  app.post("/api/companies/:companyId/passports/bulk-unarchive", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { guids } = req.body || {};
      if (!Array.isArray(guids) || !guids.length) return res.status(400).json({ error: "guids required" });
      if (guids.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      let restored = 0, skipped = 0;
      for (const guid of guids) {
        try {
          const contextRes = await pool.query(
            `SELECT lineage_id, passport_type FROM passport_archives WHERE (guid = $1 OR lineage_id = $1) AND company_id = $2 ORDER BY version_number DESC LIMIT 1`,
            [guid, companyId]
          );
          if (!contextRes.rows.length) { skipped++; continue; }
          const lineageId = contextRes.rows[0].lineage_id;
          const archiveRows = await pool.query(`SELECT * FROM passport_archives WHERE lineage_id = $1 AND company_id = $2`, [lineageId, companyId]);
          if (!archiveRows.rows.length) { skipped++; continue; }
          const passportType = archiveRows.rows[0].passport_type;
          const tableName = getTable(passportType);
          await pool.query(`UPDATE ${tableName} SET deleted_at = NULL WHERE lineage_id = $1 AND company_id = $2`, [lineageId, companyId]);
          await pool.query(`DELETE FROM passport_archives WHERE lineage_id = $1 AND company_id = $2`, [lineageId, companyId]);
          await logAudit(companyId, userId, "UNARCHIVE", tableName, guid, null, { versions_restored: archiveRows.rows.length });
          restored++;
        } catch { skipped++; }
      }
      res.json({ summary: { restored, skipped, total: guids.length } });
    } catch (e) {
      console.error("Bulk unarchive error:", e.message);
      res.status(500).json({ error: "Bulk unarchive failed" });
    }
  });

  // ─── DIFF & HISTORY ────────────────────────────────────────────────────────

  app.get("/api/companies/:companyId/passports/:guid/diff", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { guid } = req.params;
      const { passportType } = req.query;
      if (!passportType) return res.status(400).json({ error: "passportType required" });

      const lineageContext = await getPassportLineageContext({ guid, passportType, companyId: req.params.companyId });
      if (!lineageContext?.lineage_id) return res.status(404).json({ error: "Passport not found" });
      const versions = await getPassportVersionsByLineage({ lineageId: lineageContext.lineage_id, passportType, companyId: req.params.companyId });
      res.json({ versions: [...versions].sort((a, b) => Number(a.version_number || 0) - Number(b.version_number || 0)), passportType });
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  app.get("/api/companies/:companyId/passports/:guid/history", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, guid } = req.params;
      const reg = await pool.query(
        `SELECT passport_type FROM passport_registry WHERE guid = $1 AND company_id = $2`,
        [guid, companyId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const passportType = reg.rows[0].passport_type;
      const historyPayload = await buildPassportVersionHistory({ guid, passportType, companyId, publicOnly: false });
      res.json(historyPayload);
    } catch (e) { res.status(500).json({ error: "Failed to fetch passport history" }); }
  });

  app.patch("/api/companies/:companyId/passports/:guid/history/:versionNumber", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, guid, versionNumber } = req.params;
      const { isPublic } = req.body || {};
      const parsedVersion = parseInt(versionNumber, 10);

      if (!Number.isFinite(parsedVersion) || parsedVersion < 1) return res.status(400).json({ error: "A valid version number is required." });
      if (typeof isPublic !== "boolean") return res.status(400).json({ error: "isPublic must be true or false." });

      const reg = await pool.query(
        `SELECT passport_type FROM passport_registry WHERE guid = $1 AND company_id = $2`,
        [guid, companyId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const passportType = reg.rows[0].passport_type;
      const lineageContext = await getPassportLineageContext({ guid, passportType, companyId });
      if (!lineageContext?.lineage_id) return res.status(404).json({ error: "Passport not found" });

      const tableName = getTable(passportType);
      const versionRes = await pool.query(
        `SELECT guid, version_number, release_status FROM ${tableName}
         WHERE lineage_id = $1 AND company_id = $2 AND version_number = $3 AND deleted_at IS NULL LIMIT 1`,
        [lineageContext.lineage_id, companyId, parsedVersion]
      );
      if (!versionRes.rows.length) return res.status(404).json({ error: "Passport version not found" });

      const versionRow = normalizePassportRow(versionRes.rows[0]);
      if (!isPublicHistoryStatus(versionRow.release_status) && isPublic)
        return res.status(400).json({ error: "Only released or obsolete versions can be shown publicly." });

      const existingVisibilityRes = await pool.query(
        `SELECT is_public FROM passport_history_visibility WHERE passport_guid = $1 AND version_number = $2`,
        [versionRow.guid, parsedVersion]
      );
      const previousVisibility = existingVisibilityRes.rows.length
        ? !!existingVisibilityRes.rows[0].is_public
        : isPublicHistoryStatus(versionRow.release_status);

      await pool.query(
        `INSERT INTO passport_history_visibility (passport_guid, version_number, is_public, updated_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,NOW(),NOW())
         ON CONFLICT (passport_guid, version_number) DO UPDATE SET is_public = EXCLUDED.is_public, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [versionRow.guid, parsedVersion, isPublic, req.user.userId]
      );

      await logAudit(companyId, req.user.userId, "UPDATE_HISTORY_VISIBILITY", tableName, guid,
        { version_number: parsedVersion, is_public: previousVisibility },
        { version_number: parsedVersion, is_public: isPublic }
      );

      res.json({ success: true, version_number: parsedVersion, is_public: isPublic });
    } catch (e) { res.status(500).json({ error: "Failed to update history visibility" }); }
  });

  // ─── FILE UPLOAD ───────────────────────────────────────────────────────────

  app.post(
    "/api/companies/:companyId/passports/:guid/upload",
    authenticateToken, checkCompanyAccess, requireEditor, upload.single("file"),
    async (req, res) => {
      try {
        const { companyId, guid } = req.params;
        const { fieldKey, passportType } = req.body;
        if (!req.file) return res.status(400).json({ error: "No file received" });
        if (!fieldKey || !passportType) {
          return res.status(400).json({ error: "fieldKey and passportType required" });
        }
        if (!/^[a-zA-Z][a-zA-Z0-9_]+$/.test(fieldKey)) {
          return res.status(400).json({ error: "Invalid fieldKey" });
        }

        const tableName  = getTable(passportType);
        const stored = await storageService.savePassportFile({
          guid,
          fieldKey,
          originalName: req.file.originalname,
          buffer: req.file.buffer,
          contentType: req.file.mimetype,
        });
        const fileUrl = stored.url;

        const row = await pool.query(
          `SELECT id FROM ${tableName}
           WHERE guid = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
           ORDER BY version_number DESC LIMIT 1`,
          [guid]
        );
        if (!row.rows.length) {
          return res.status(404).json({ error: "Editable passport not found" });
        }

        await pool.query(
          `UPDATE ${tableName} SET ${fieldKey} = $1, updated_at = NOW() WHERE id = $2`,
          [fileUrl, row.rows[0].id]
        );
        await logAudit(companyId, req.user.userId, "UPLOAD", tableName, guid, null, { fieldKey, fileUrl });
        res.json({ success: true, url: fileUrl, fieldKey });
      } catch (e) {
        if (e.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large. Max 20 MB." });
        res.status(500).json({ error: "Upload failed" });
      }
    }
  );

  // ─── ANALYTICS, ACTIVITY, AUDIT LOGS ──────────────────────────────────────

  app.get("/api/companies/:companyId/analytics", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;

      const accessRes = await pool.query(`
        SELECT pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon
        FROM company_passport_access cpa
        JOIN passport_types pt ON pt.id = cpa.passport_type_id
        WHERE cpa.company_id = $1
      `, [companyId]);

      let totalPassports = 0;
      const analytics = [];
      const trendMonths = [];
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonthIndex = now.getMonth();
      const trendStart = new Date(currentYear, 0, 1);

      for (let monthIndex = 0; monthIndex <= currentMonthIndex; monthIndex += 1) {
        trendMonths.push(new Date(currentYear, monthIndex, 1));
      }
      const trendSeriesMap = {};

      for (const { type_name, display_name, umbrella_category, umbrella_icon } of accessRes.rows) {
        try {
          const stats = await queryTableStats(type_name, companyId);
          if (stats.total === 0) continue;
          totalPassports += stats.total;
          analytics.push({ passport_type: type_name, display_name, umbrella_category, umbrella_icon, draft_count: stats.draft, released_count: stats.released, revised_count: stats.revised, in_review_count: stats.in_review, obsolete_count: stats.obsolete });

          const tableName = getTable(type_name);
          const baselineRes = await pool.query(
            `SELECT COUNT(*) AS count FROM ${tableName} WHERE company_id = $1 AND deleted_at IS NULL AND created_at < $2`,
            [companyId, trendStart.toISOString()]
          );
          const monthlyRes = await pool.query(
            `SELECT date_trunc('month', created_at) AS month_bucket, COUNT(*) AS count
             FROM ${tableName}
             WHERE company_id = $1 AND deleted_at IS NULL AND created_at >= $2
             GROUP BY 1 ORDER BY 1`,
            [companyId, trendStart.toISOString()]
          );

          if (!trendSeriesMap[umbrella_category]) {
            trendSeriesMap[umbrella_category] = {
              umbrella_category, umbrella_icon, baseline: 0,
              monthlyCounts: Object.fromEntries(trendMonths.map((month) => [month.toISOString().slice(0, 7), 0])),
            };
          }
          trendSeriesMap[umbrella_category].baseline += parseInt(baselineRes.rows[0]?.count || 0, 10);
          monthlyRes.rows.forEach((row) => {
            const key = new Date(row.month_bucket).toISOString().slice(0, 7);
            trendSeriesMap[umbrella_category].monthlyCounts[key] = (trendSeriesMap[umbrella_category].monthlyCounts[key] || 0) + parseInt(row.count || 0, 10);
          });
        } catch (e) { console.error(`Analytics error for ${companyId}/${type_name}:`, e.message); }
      }

      const scanRes = await pool.query(
        `SELECT COUNT(DISTINCT (pse.passport_guid, pse.viewer_user_id)) FROM passport_scan_events pse
         JOIN passport_registry pr ON pr.guid = pse.passport_guid
         WHERE pr.company_id = $1 AND pse.viewer_user_id IS NOT NULL`,
        [companyId]
      );
      const scanStats = parseInt(scanRes.rows[0].count) || 0;
      const archivedRes = await pool.query(`SELECT COUNT(DISTINCT guid) FROM passport_archives WHERE company_id = $1`, [companyId]);
      const archivedCount = parseInt(archivedRes.rows[0].count) || 0;
      totalPassports += archivedCount;

      const trend = {
        labels: trendMonths.map((month) => month.toLocaleString("en-US", { month: "short" })),
        series: Object.values(trendSeriesMap).map((series) => {
          let running = series.baseline;
          return {
            umbrella_category: series.umbrella_category,
            umbrella_icon: series.umbrella_icon,
            values: trendMonths.map((month) => { const key = month.toISOString().slice(0, 7); running += series.monthlyCounts[key] || 0; return running; }),
          };
        }),
      };

      res.json({ totalPassports, analytics, scanStats, archivedCount, trend });
    } catch (e) { res.status(500).json({ error: "Failed to fetch analytics" }); }
  });

  app.get("/api/companies/:companyId/activity", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
      const r = await pool.query(
        `SELECT al.*, u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         WHERE al.company_id = $1 ORDER BY al.created_at DESC LIMIT $2`,
        [req.params.companyId, limit]
      );
      res.json(r.rows);
    } catch { res.status(500).json({ error: "Failed" }); }
  });

  app.get("/api/companies/:companyId/audit-logs", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 200, 1), 500);
      const offset = Math.max(parseInt(req.query.offset) || 0, 0);
      const r = await pool.query(
        `SELECT al.*, u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         WHERE al.company_id = $1 ORDER BY al.created_at DESC LIMIT $2 OFFSET $3`,
        [req.params.companyId, limit, offset]
      );
      res.json(r.rows);
    } catch { res.status(500).json({ error: "Failed to fetch audit logs" }); }
  });

  // ─── QR CODE ───────────────────────────────────────────────────────────────

  app.post("/api/passports/:guid/qrcode", authenticateToken, async (req, res) => {
    try {
      const { qrCode, passportType } = req.body;
      if (!qrCode || !passportType) return res.status(400).json({ error: "qrCode and passportType required" });

      const reg = await pool.query("SELECT company_id FROM passport_registry WHERE guid = $1", [req.params.guid]);
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found in registry" });

      const tableName = getTable(passportType);
      await pool.query(`UPDATE ${tableName} SET qr_code = $1, updated_at = NOW() WHERE guid = $2`, [qrCode, req.params.guid]);
      res.json({ success: true });
    } catch { res.status(500).json({ error: "Failed to save QR code" }); }
  });

  app.get("/api/passports/:guid/qrcode", publicReadRateLimit, async (req, res) => {
    try {
      const { guid } = req.params;
      const reg = await pool.query("SELECT passport_type FROM passport_registry WHERE guid = $1", [guid]);
      if (!reg.rows.length) return res.status(404).json({ error: "QR code not found" });

      const { passport_type } = reg.rows[0];
      const tableName = getTable(passport_type);
      const r = await pool.query(`SELECT qr_code FROM ${tableName} WHERE guid = $1 AND deleted_at IS NULL LIMIT 1`, [guid]);
      if (!r.rows.length || !r.rows[0].qr_code) return res.status(404).json({ error: "QR code not found" });

      res.json({ qrCode: r.rows[0].qr_code });
    } catch { res.status(500).json({ error: "Failed to fetch QR code" }); }
  });

  // ─── SCAN ──────────────────────────────────────────────────────────────────

  app.post("/api/passports/:guid/scan", (req, res, next) => {
    // dynamic rate limit - imported as assetWriteRateLimit equiv for scans
    next();
  }, async (req, res) => {
    try {
      const { guid } = req.params;
      const { userAgent, referrer, userId } = req.body || {};

      const reg = await pool.query("SELECT passport_type FROM passport_registry WHERE guid = $1", [guid]);
      if (!reg.rows.length) return res.json({ success: true });

      const tbl = getTable(reg.rows[0].passport_type);
      const check = await pool.query(
        `SELECT 1 FROM ${tbl} WHERE guid = $1 AND release_status = 'released' AND deleted_at IS NULL`,
        [guid]
      );
      if (!check.rows.length) return res.json({ success: true });

      const parsedUserId = Number.parseInt(userId, 10);
      if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) return res.json({ success: true });

      await pool.query(
        `INSERT INTO passport_scan_events (passport_guid, viewer_user_id, user_agent, referrer)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (passport_guid, viewer_user_id) WHERE viewer_user_id IS NOT NULL DO NOTHING`,
        [guid, parsedUserId, userAgent || null, referrer || null]
      );
      res.json({ success: true });
    } catch { res.json({ success: true }); }
  });

  app.get("/api/passports/:guid/scan-stats", publicReadRateLimit, async (req, res) => {
    try {
      const { guid } = req.params;
      const total = await pool.query(
        `SELECT COUNT(DISTINCT viewer_user_id) FROM passport_scan_events WHERE passport_guid = $1 AND viewer_user_id IS NOT NULL`,
        [guid]
      );
      const byDay = await pool.query(
        `SELECT DATE(scanned_at) AS day, COUNT(DISTINCT viewer_user_id) AS count
         FROM passport_scan_events WHERE passport_guid = $1 AND viewer_user_id IS NOT NULL
         GROUP BY DATE(scanned_at) ORDER BY day DESC LIMIT 30`,
        [guid]
      );
      res.json({ total: parseInt(total.rows[0].count), byDay: byDay.rows });
    } catch { res.status(500).json({ error: "Failed" }); }
  });

  // ─── DYNAMIC VALUES ────────────────────────────────────────────────────────

  app.get("/api/passports/:guid/dynamic-values", publicReadRateLimit, async (req, res) => {
    try {
      const { guid } = req.params;
      const r = await pool.query(
        `SELECT DISTINCT ON (field_key) field_key, value, updated_at
         FROM passport_dynamic_values WHERE passport_guid = $1 ORDER BY field_key, updated_at DESC`,
        [guid]
      );
      const values = {};
      for (const row of r.rows) { values[row.field_key] = { value: row.value, updatedAt: row.updated_at }; }
      res.json({ values });
    } catch (e) { res.status(500).json({ error: "Failed to fetch dynamic values" }); }
  });

  app.get("/api/passports/:guid/dynamic-values/:fieldKey/history", publicReadRateLimit, async (req, res) => {
    try {
      const { guid, fieldKey } = req.params;
      const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
      const r = await pool.query(
        `SELECT value, updated_at FROM passport_dynamic_values WHERE passport_guid = $1 AND field_key = $2 ORDER BY updated_at ASC LIMIT $3`,
        [guid, fieldKey, limit]
      );
      res.json({ history: r.rows.map(row => ({ value: row.value, updatedAt: row.updated_at })) });
    } catch (e) { res.status(500).json({ error: "Failed to fetch history" }); }
  });

  app.post("/api/passports/:guid/dynamic-values", async (req, res) => {
    try {
      const { guid } = req.params;
      const deviceKey = req.headers["x-device-key"];
      if (!deviceKey) return res.status(401).json({ error: "x-device-key header required" });

      const reg = await pool.query("SELECT device_api_key FROM passport_registry WHERE guid = $1", [guid]);
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });
      const storedKey = String(reg.rows[0].device_api_key || "");
      const submittedKey = String(deviceKey || "");
      const storedBuf = Buffer.from(storedKey);
      const submittedBuf = Buffer.from(submittedKey);
      if (storedBuf.length !== submittedBuf.length || !crypto.timingSafeEqual(storedBuf, submittedBuf))
        return res.status(403).json({ error: "Invalid device key" });

      const updates = req.body;
      if (!updates || typeof updates !== "object" || Array.isArray(updates))
        return res.status(400).json({ error: "Body must be an object of { fieldKey: value }" });

      const entries = Object.entries(updates).filter(([k]) => /^[a-z0-9_]{1,100}$/.test(k));
      if (!entries.length) return res.status(400).json({ error: "No valid field keys provided" });

      for (const [fieldKey, value] of entries) {
        let storedValue = value;
        if (value !== null && value !== undefined) {
          if (Array.isArray(value) || typeof value === "object") storedValue = JSON.stringify(value);
          else storedValue = String(value);
        }
        await pool.query(
          `INSERT INTO passport_dynamic_values (passport_guid, field_key, value, updated_at) VALUES ($1, $2, $3, NOW())`,
          [guid, fieldKey, storedValue]
        );
      }

      res.json({ success: true, updated: entries.map(([k]) => k) });
    } catch (e) { res.status(500).json({ error: "Failed to update dynamic values" }); }
  });

  app.get("/api/companies/:companyId/passports/:guid/device-key", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { guid } = req.params;
      const r = await pool.query("SELECT device_api_key FROM passport_registry WHERE guid = $1", [guid]);
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
      res.json({ deviceKey: r.rows[0].device_api_key });
    } catch (e) { res.status(500).json({ error: "Failed to fetch device key" }); }
  });

  app.post("/api/companies/:companyId/passports/:guid/device-key/regenerate", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { guid } = req.params;
      const r = await pool.query(
        `UPDATE passport_registry SET device_api_key = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') WHERE guid = $1 RETURNING device_api_key`,
        [guid]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
      res.json({ deviceKey: r.rows[0].device_api_key });
    } catch (e) { res.status(500).json({ error: "Failed to regenerate device key" }); }
  });

  app.patch("/api/companies/:companyId/passports/:guid/dynamic-values", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { guid } = req.params;
      const updates = req.body;
      if (!updates || typeof updates !== "object" || Array.isArray(updates))
        return res.status(400).json({ error: "Body must be an object of { fieldKey: value }" });

      const entries = Object.entries(updates).filter(([k]) => /^[a-z0-9_]{1,100}$/.test(k));
      if (!entries.length) return res.status(400).json({ error: "No valid field keys provided" });

      for (const [fieldKey, value] of entries) {
        await pool.query(
          `INSERT INTO passport_dynamic_values (passport_guid, field_key, value, updated_at) VALUES ($1, $2, $3, NOW())`,
          [guid, fieldKey, value === null || value === undefined ? null : String(value)]
        );
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed to update dynamic values" }); }
  });

  // ─── PASSPORT TYPES PER COMPANY ────────────────────────────────────────────

  app.get("/api/companies/:companyId/passport-types", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT DISTINCT pt.id, pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon, pt.semantic_model_key, pt.fields_json,
          (NOT cpa.access_revoked) AS access_granted
        FROM passport_types pt
        JOIN company_passport_access cpa ON pt.id = cpa.passport_type_id
        WHERE cpa.company_id = $1
        ORDER BY pt.umbrella_category, pt.display_name
      `, [req.params.companyId]);
      res.json(r.rows);
    } catch (e) { console.error("passport-types fetch error:", e.message); res.status(500).json({ error: "Failed to fetch passport types" }); }
  });
};
