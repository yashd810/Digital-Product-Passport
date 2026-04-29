"use strict";

const logger = require("../services/logger");
const { generateDppRecordId } = require("../services/dpp-record-id");

module.exports = function registerCompanyRoutes(app, {
  pool,
  authenticateToken,
  checkCompanyAccess,
  requireEditor,
  publicReadRateLimit,
  // passport helpers
  getTable,
  getPassportTypeSchema,
  normalizePassportRequestBody,
  normalizeProductIdValue,
  normalizeReleaseStatus,
  isEditablePassportStatus,
  findExistingPassportByProductId,
  updatePassportRowById,
  getWritablePassportColumns,
  getStoredPassportValues,
  logAudit,
  EDITABLE_RELEASE_STATUSES_SQL,
  SYSTEM_PASSPORT_FIELDS,
  buildBatteryPassJsonExport,
  productIdentifierService,
  complianceService,
  accessRightsService
}) {
  function buildStoredProductIdentifiers({ companyId, passportType, productId, granularity = "item" }) {
    const normalized = productIdentifierService.normalizeProductIdentifiers({
      companyId,
      passportType,
      rawProductId: productId,
      granularity
    });
    return {
      product_id: normalized.productIdInput || null,
      product_identifier_did: normalized.productIdentifierDid || null
    };
  }

  function serializeProfileDefaultValue(value) {
    if (Array.isArray(value)) return JSON.stringify(value);
    return value ?? null;
  }

  async function loadCompanyComplianceIdentity(companyId) {
    const result = await pool.query(
      `SELECT economic_operator_identifier
       FROM companies
       WHERE id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  async function buildComplianceManagedFields({ companyId, passportType }) {
    const profile = complianceService.resolveProfileMetadata({ passportType, granularity: "item" });
    const companyIdentity = await loadCompanyComplianceIdentity(companyId);
    return {
      compliance_profile_key: profile.key,
      content_specification_ids: serializeProfileDefaultValue(profile.contentSpecificationIds),
      carrier_policy_key: profile.defaultCarrierPolicyKey || null,
      economic_operator_id: companyIdentity?.economic_operator_identifier || null,
      facility_id: null
    };
  }

  // ─── COMPANY PROFILE ─────────────────────────────────────────────────────

  app.get("/api/companies/:companyId/profile", publicReadRateLimit, async (req, res) => {
    try {
      const r = await pool.query(
        "SELECT id, company_name, company_logo, introduction_text, branding_json FROM companies WHERE id = $1",
        [req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Company not found" });
      res.json(r.rows[0]);
    } catch {res.status(500).json({ error: "Failed to fetch company profile" });}
  });

  app.post("/api/companies/:companyId/profile", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { company_logo, introduction_text, branding_json } = req.body;
      await pool.query(
        `UPDATE companies
         SET company_logo = $1,
             introduction_text = COALESCE($2, introduction_text),
             branding_json = COALESCE($3::jsonb, branding_json),
             updated_at = NOW()
         WHERE id = $4`,
        [
        company_logo !== undefined ? company_logo : null,
        introduction_text || null,
        branding_json ? JSON.stringify(branding_json) : null,
        req.params.companyId]

      );
      res.json({ success: true });
    } catch {res.status(500).json({ error: "Failed to save company profile" });}
  });

  app.get("/api/companies/:companyId/compliance-identity", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const companyRes = await pool.query(
        `SELECT id, company_name, did_slug, economic_operator_identifier, economic_operator_identifier_scheme
         FROM companies
         WHERE id = $1
         LIMIT 1`,
        [req.params.companyId]
      );
      if (!companyRes.rows.length) return res.status(404).json({ error: "Company not found" });

      const facilitiesRes = await pool.query(
        `SELECT id, facility_identifier, identifier_scheme, display_name, metadata_json, is_active, created_at, updated_at
         FROM company_facilities
         WHERE company_id = $1
         ORDER BY updated_at DESC, id DESC`,
        [req.params.companyId]
      );

      res.json({
        company: companyRes.rows[0],
        facilities: facilitiesRes.rows
      });
    } catch {
      res.status(500).json({ error: "Failed to fetch compliance identity" });
    }
  });

  app.post("/api/companies/:companyId/compliance-identity", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const economicOperatorIdentifier = req.body?.economic_operator_identifier === undefined ?
      undefined :
      String(req.body.economic_operator_identifier || "").trim();
      const economicOperatorIdentifierScheme = req.body?.economic_operator_identifier_scheme === undefined ?
      undefined :
      String(req.body.economic_operator_identifier_scheme || "").trim();

      await pool.query(
        `UPDATE companies
         SET economic_operator_identifier = COALESCE($1, economic_operator_identifier),
             economic_operator_identifier_scheme = COALESCE($2, economic_operator_identifier_scheme),
             updated_at = NOW()
         WHERE id = $3`,
        [
        economicOperatorIdentifier === undefined ? null : economicOperatorIdentifier,
        economicOperatorIdentifierScheme === undefined ? null : economicOperatorIdentifierScheme,
        req.params.companyId]

      );

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "UPDATE_COMPLIANCE_IDENTITY",
        "companies",
        req.params.companyId,
        null,
        {
          economic_operator_identifier: economicOperatorIdentifier === undefined ? null : economicOperatorIdentifier,
          economic_operator_identifier_scheme: economicOperatorIdentifierScheme === undefined ? null : economicOperatorIdentifierScheme
        },
        { actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}` }
      );

      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to update compliance identity" });
    }
  });

  app.post("/api/companies/:companyId/facilities", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const facilityIdentifier = String(req.body?.facility_identifier || "").trim();
      const identifierScheme = String(req.body?.identifier_scheme || "").trim();
      if (!facilityIdentifier || !identifierScheme) {
        return res.status(400).json({ error: "facility_identifier and identifier_scheme are required" });
      }

      const result = await pool.query(
        `INSERT INTO company_facilities (
           company_id, facility_identifier, identifier_scheme, display_name, metadata_json, created_by
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (company_id, identifier_scheme, facility_identifier)
         DO UPDATE SET
           display_name = EXCLUDED.display_name,
           metadata_json = EXCLUDED.metadata_json,
           is_active = true,
           updated_at = NOW()
         RETURNING *`,
        [
        req.params.companyId,
        facilityIdentifier,
        identifierScheme,
        req.body?.display_name || null,
        JSON.stringify(req.body?.metadata_json || {}),
        req.user.userId]

      );

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "UPSERT_FACILITY_IDENTIFIER",
        "company_facilities",
        facilityIdentifier,
        null,
        {
          facility_identifier: facilityIdentifier,
          identifier_scheme: identifierScheme,
          display_name: req.body?.display_name || null
        },
        { actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}` }
      );

      res.status(201).json(result.rows[0]);
    } catch {
      res.status(500).json({ error: "Failed to save facility identifier" });
    }
  });

  // ─── PASSPORT TEMPLATES ──────────────────────────────────────────────────

  app.get("/api/companies/:companyId/templates", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const { passport_type } = req.query;
      let q = `SELECT t.*, u.first_name, u.last_name,
                 (SELECT COUNT(*) FROM passport_template_fields WHERE template_id = t.id AND is_model_data = true) AS model_field_count
               FROM passport_templates t
               LEFT JOIN users u ON u.id = t.created_by
               WHERE t.company_id = $1`;
      const params = [companyId];
      if (passport_type) {q += ` AND t.passport_type = $2`;params.push(passport_type);}
      q += ` ORDER BY t.passport_type, t.name`;
      const r = await pool.query(q, params);
      res.json(r.rows);
    } catch (e) {logger.error(e);res.status(500).json({ error: "Failed" });}
  });

  app.get("/api/companies/:companyId/templates/:id", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, id } = req.params;
      const t = await pool.query(
        "SELECT * FROM passport_templates WHERE id=$1 AND company_id=$2",
        [id, companyId]
      );
      if (!t.rows.length) return res.status(404).json({ error: "Not found" });
      const fields = await pool.query(
        "SELECT field_key, field_value, is_model_data FROM passport_template_fields WHERE template_id=$1",
        [id]
      );
      res.json({ ...t.rows[0], fields: fields.rows });
    } catch (e) {res.status(500).json({ error: "Failed" });}
  });

  app.post("/api/companies/:companyId/templates", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const { passport_type, name, description, fields } = req.body;
      if (!passport_type || !name?.trim()) return res.status(400).json({ error: "passport_type and name required" });

      const t = await pool.query(
        `INSERT INTO passport_templates (company_id, passport_type, name, description, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [companyId, passport_type, name.trim(), description || null, req.user.userId]
      );
      const tmplId = t.rows[0].id;

      if (Array.isArray(fields) && fields.length) {
        for (const f of fields) {
          if (!f.field_key) continue;
          await pool.query(
            `INSERT INTO passport_template_fields (template_id, field_key, field_value, is_model_data)
             VALUES ($1,$2,$3,$4) ON CONFLICT (template_id, field_key) DO UPDATE
             SET field_value=$3, is_model_data=$4`,
            [tmplId, f.field_key, f.field_value ?? null, !!f.is_model_data]
          );
        }
      }
      res.json(t.rows[0]);
    } catch (e) {logger.error(e);res.status(500).json({ error: "Failed" });}
  });

  app.put("/api/companies/:companyId/templates/:id", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, id } = req.params;
      const { name, description, fields } = req.body;

      const existing = await pool.query(
        "SELECT id FROM passport_templates WHERE id=$1 AND company_id=$2", [id, companyId]
      );
      if (!existing.rows.length) return res.status(404).json({ error: "Not found" });

      await pool.query(
        `UPDATE passport_templates SET name=$1, description=$2, updated_at=NOW() WHERE id=$3`,
        [name?.trim() || "Untitled", description || null, id]
      );

      if (Array.isArray(fields)) {
        await pool.query("DELETE FROM passport_template_fields WHERE template_id=$1", [id]);
        for (const f of fields) {
          if (!f.field_key) continue;
          await pool.query(
            `INSERT INTO passport_template_fields (template_id, field_key, field_value, is_model_data)
             VALUES ($1,$2,$3,$4)`,
            [id, f.field_key, f.field_value ?? null, !!f.is_model_data]
          );
        }
      }
      res.json({ success: true });
    } catch (e) {res.status(500).json({ error: "Failed" });}
  });

  app.delete("/api/companies/:companyId/templates/:id", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, id } = req.params;
      await pool.query("DELETE FROM passport_templates WHERE id=$1 AND company_id=$2", [id, companyId]);
      res.json({ success: true });
    } catch (e) {res.status(500).json({ error: "Failed" });}
  });

  app.get("/api/companies/:companyId/templates/:templateId/export-drafts", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, templateId } = req.params;
      const fmt = (req.query.format || "csv").toLowerCase();

      const tmplRes = await pool.query(
        "SELECT * FROM passport_templates WHERE id=$1 AND company_id=$2",
        [templateId, companyId]
      );
      if (!tmplRes.rows.length) return res.status(404).json({ error: "Template not found" });
      const tmpl = tmplRes.rows[0];

      const fieldRes = await pool.query(
        "SELECT field_key, field_value, is_model_data FROM passport_template_fields WHERE template_id=$1",
        [templateId]
      );
      const templateFields = Object.fromEntries(fieldRes.rows.map((f) => [f.field_key, f.field_value]));

      const typeRes = await pool.query(
        "SELECT fields_json, umbrella_category, semantic_model_key FROM passport_types WHERE type_name=$1",
        [tmpl.passport_type]
      );
      const sections = typeRes.rows[0]?.fields_json?.sections || [];
      const schemaFields = sections.flatMap((s) => s.fields || []).
      filter((f) => f.type !== "file" && f.type !== "table");

      const tableName = getTable(tmpl.passport_type);
      const cols = ["dppId", "model_name", "product_id", ...schemaFields.map((f) => f.key)];
      const safeColsSql = cols.map((c) => /^[a-z][a-z0-9_]*$/.test(c) ? c : null).filter(Boolean);

      const passRes = await pool.query(
        `SELECT ${safeColsSql.join(", ")} FROM ${tableName}
         WHERE company_id=$1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [companyId]
      );
      const rows = passRes.rows;

      if (fmt === "json" || fmt === "jsonld") {
        res.setHeader("Content-Type", "application/ld+json");
        res.setHeader("Content-Disposition", `attachment; filename="${tmpl.passport_type}_drafts.jsonld"`);
        return res.json(buildBatteryPassJsonExport(rows, tmpl.passport_type, {
          semanticModelKey: typeRes.rows[0]?.semantic_model_key || null,
          umbrellaCategory: typeRes.rows[0]?.umbrella_category || null
        }));
      }

      const escCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

      const fieldRows = [
      ["dppId", ...rows.map((r) => r.dppId)],
      ["model_name", ...rows.map((r) => r.model_name || "")],
      ["product_id", ...rows.map((r) => r.product_id || "")],
      ...schemaFields.map((f) => [
      f.label,
      ...rows.map((r) => r[f.key] ?? templateFields[f.key] ?? "")]
      )];

      const headerRow = ["Field Name", ...rows.map((_, i) => `Passport ${i + 1}`)];
      const csvLines = [headerRow, ...fieldRows].map((row) => row.map(escCell).join(","));

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${tmpl.passport_type}_drafts.csv"`);
      res.send(csvLines.join("\n"));
    } catch (e) {
      logger.error("Export drafts error:", e.message);
      res.status(500).json({ error: "Export failed" });
    }
  });

  // ─── UPSERT VIA CSV ──────────────────────────────────────────────────────

  app.post("/api/companies/:companyId/passports/upsert-csv", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const normalizedBody = normalizePassportRequestBody(req.body);
      const { passport_type, csv } = normalizedBody;
      if (!passport_type || !csv) return res.status(400).json({ error: "passport_type and csv required" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const resolvedPassportType = typeSchema.typeName;

      const allFields = typeSchema.schemaFields;

      const parseRow = (line) => {
        line = line.replace(/\r$/, "");
        const cells = [];let cur = "";let inQ = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') {if (inQ && line[i + 1] === '"') {cur += '"';i++;} else inQ = !inQ;} else
          if (c === ',' && !inQ) {cells.push(cur);cur = "";} else
          cur += c;
        }
        cells.push(cur);
        return cells;
      };
      const rows = csv.split("\n").map((l) => l.trim()).filter(Boolean).map(parseRow);
      if (rows.length < 2) return res.status(400).json({ error: "CSV too short" });

      const numPassports = rows[0].length - 1;
      const fieldRows = rows.slice(1);

      const tableName = getTable(resolvedPassportType);
      const userId = req.user.userId;
      const excluded = new Set(["id", "dppId", "company_id", "created_by", "created_at", "passport_type",
      "version_number", "release_status", "deleted_at", "qr_code",
      "created_by_email", "first_name", "last_name", "updated_by", "updated_at"]);

      let created = 0,updated = 0,skipped = 0,failed = 0;
      const details = [];

      for (let colIdx = 1; colIdx <= numPassports; colIdx++) {
        const passport = {};
        fieldRows.forEach((row) => {
          const rawLabel = (row[0] || "").trim();
          if (!rawLabel) return;
          const normalized = rawLabel.toLowerCase();
          const value = (row[colIdx] || "").trim();

          const field =
          allFields.find((f) => f.label?.trim().toLowerCase() === normalized) ||
          allFields.find((f) => f.key?.toLowerCase() === normalized) || (
          normalized === "model_name" ? { key: "model_name" } : null) || (
          normalized === "product_id" ? { key: "product_id" } : null) || (
          normalized === "dppId" ? { key: "dppId" } : null);

          if (field && value) {
            passport[field.key] = field.type === "boolean" ?
            value.toLowerCase() === "true" || value === "1" :
            value;
          }
        });

        const { dppId: incomingGuid, model_name, product_id, ...fields } = passport;
        const normalizedProductId = normalizeProductIdValue(product_id);

        try {
          if (incomingGuid) {
            const existing = await pool.query(
              `SELECT id FROM ${tableName} WHERE dpp_id=$1 AND company_id=$2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL`,
              [incomingGuid, companyId]
            );
            if (!existing.rows.length) {
              details.push({ dppId: incomingGuid, status: "skipped", reason: "not found or not editable" });
              skipped++;continue;
            }
            const rowId = existing.rows[0].id;
            if (product_id !== undefined) {
              if (!normalizedProductId) {
                details.push({ dppId: incomingGuid, status: "failed", error: "product_id cannot be blank" });
                failed++;continue;
              }
              const existingByProductId = await findExistingPassportByProductId({
                tableName, companyId, productId: normalizedProductId, excludeGuid: incomingGuid
              });
              if (existingByProductId) {
                details.push({ dppId: incomingGuid, product_id: normalizedProductId, status: "failed", error: `Serial Number "${normalizedProductId}" already belongs to another passport` });
                failed++;continue;
              }
            }
            const updateData = { model_name, ...fields };
            if (product_id !== undefined) {
              const storedProductIdentifiers = buildStoredProductIdentifiers({
                companyId,
                passportType: resolvedPassportType,
                productId: normalizedProductId
              });
              updateData.product_id = storedProductIdentifiers.product_id;
              updateData.product_identifier_did = storedProductIdentifiers.product_identifier_did;
            }
            const updateCols = await updatePassportRowById({ tableName, rowId, userId, data: updateData, excluded });
            if (!updateCols.length) {skipped++;continue;}
            await logAudit(companyId, userId, "UPDATE", tableName, incomingGuid, null, { source: "csv_upsert" });
            details.push({ dppId: incomingGuid, product_id: normalizedProductId || undefined, status: "updated" });
            updated++;
          } else {
            if (!normalizedProductId) {
              details.push({ status: "skipped", reason: "Serial Number is required to create a new passport" });
              skipped++;continue;
            }
            const existingByProductId = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId });
            if (existingByProductId) {
              const existingStatus = normalizeReleaseStatus(existingByProductId.release_status);
              if (isEditablePassportStatus(existingStatus)) {
                const storedProductIdentifiers = buildStoredProductIdentifiers({
                  companyId,
                  passportType: resolvedPassportType,
                  productId: normalizedProductId
                });
                const updateData = {
                  model_name,
                  product_id: storedProductIdentifiers.product_id,
                  product_identifier_did: storedProductIdentifiers.product_identifier_did,
                  ...fields
                };
                const updateCols = await updatePassportRowById({ tableName, rowId: existingByProductId.id, userId, data: updateData, excluded });
                if (!updateCols.length) {
                  details.push({ dppId: existingByProductId.dppId, product_id: normalizedProductId, status: "skipped", reason: "no changes detected" });
                  skipped++;continue;
                }
                await logAudit(companyId, userId, "UPDATE", tableName, existingByProductId.dppId, null, { source: "csv_upsert", matched_by: "product_id" });
                details.push({ dppId: existingByProductId.dppId, product_id: normalizedProductId, status: "updated" });
                updated++;continue;
              }
              details.push({
                dppId: existingByProductId.dppId, product_id: normalizedProductId, status: "skipped",
                reason: existingStatus === "in_review" ?
                "matching passport is in review and cannot be edited" :
                "matching passport already exists; revise it before importing changes"
              });
              skipped++;continue;
            }
            const newGuid = generateDppRecordId();
            const lineageId = newGuid;
            const dataFields = getWritablePassportColumns(fields, excluded);
            const storedProductIdentifiers = buildStoredProductIdentifiers({
              companyId,
              passportType: resolvedPassportType,
              productId: normalizedProductId
            });
            const complianceManagedFields = await buildComplianceManagedFields({
              companyId,
              passportType: resolvedPassportType
            });
            const allCols = [
            "dppId", "lineage_id", "company_id", "model_name", "product_id", "product_identifier_did",
            "compliance_profile_key", "content_specification_ids", "carrier_policy_key", "economic_operator_id", "facility_id",
            "created_by", ...dataFields];

            const allVals = [
            newGuid,
            lineageId,
            companyId,
            model_name || null,
            storedProductIdentifiers.product_id,
            storedProductIdentifiers.product_identifier_did,
            complianceManagedFields.compliance_profile_key,
            complianceManagedFields.content_specification_ids,
            complianceManagedFields.carrier_policy_key,
            complianceManagedFields.economic_operator_id,
            complianceManagedFields.facility_id,
            userId,
            ...getStoredPassportValues(dataFields, fields)];

            await pool.query(
              `INSERT INTO ${tableName} (${allCols.join(",")}) VALUES (${allCols.map((_, i) => `$${i + 1}`).join(",")})`,
              allVals
            );
            await pool.query(
              `INSERT INTO passport_registry (dpp_id,lineage_id,company_id,passport_type) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
              [newGuid, lineageId, companyId, resolvedPassportType]
            );
            details.push({ dppId: newGuid, product_id: normalizedProductId, model_name, status: "created" });
            created++;
          }
        } catch (e) {
          logger.error("Upsert CSV row error:", e.message);
          details.push({ status: "failed", error: e.message });
          failed++;
        }
      }

      res.json({ summary: { created, updated, skipped, failed }, details });
    } catch (e) {
      logger.error("Upsert CSV error:", e.message);
      res.status(500).json({ error: "Import failed" });
    }
  });

  // ─── UPSERT VIA JSON ─────────────────────────────────────────────────────

  app.post("/api/companies/:companyId/passports/upsert-json", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
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
      const resolvedPassportType = typeSchema.typeName;
      const tableName = getTable(resolvedPassportType);
      const userId = req.user.userId;
      const excluded = new Set(["id", "company_id", "created_by", "created_at", "passport_type",
      "version_number", "release_status", "deleted_at", "qr_code",
      "created_by_email", "first_name", "last_name", "updated_by", "updated_at"]);

      let created = 0,updated = 0,skipped = 0,failed = 0;
      const details = [];

      for (const item of passports) {
        const normalizedItem = normalizePassportRequestBody(item || {});
        const { dppId: incomingGuid, model_name, product_id, ...fields } = normalizedItem;
        const normalizedProductId = normalizeProductIdValue(product_id);
        const invalidFieldKeys = Object.keys(fields).filter((key) =>
        !SYSTEM_PASSPORT_FIELDS.has(key) &&
        !typeSchema.allowedKeys.has(key)
        );
        try {
          if (invalidFieldKeys.length) {
            details.push({
              dppId: incomingGuid || undefined,
              product_id: normalizedProductId || undefined,
              status: "failed",
              error: `Unknown passport field(s): ${invalidFieldKeys.join(", ")}`
            });
            failed++;
            continue;
          }
          if (incomingGuid) {
            const existing = await pool.query(
              `SELECT id FROM ${tableName} WHERE dpp_id=$1 AND company_id=$2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL`,
              [incomingGuid, companyId]
            );
            if (!existing.rows.length) {
              details.push({ dppId: incomingGuid, status: "skipped", reason: "not found or not editable" });
              skipped++;continue;
            }
            if (product_id !== undefined) {
              if (!normalizedProductId) {
                details.push({ dppId: incomingGuid, status: "failed", error: "product_id cannot be blank" });
                failed++;continue;
              }
              const existingByProductId = await findExistingPassportByProductId({
                tableName, companyId, productId: normalizedProductId, excludeGuid: incomingGuid
              });
              if (existingByProductId) {
                details.push({ dppId: incomingGuid, product_id: normalizedProductId, status: "failed", error: `Serial Number "${normalizedProductId}" already belongs to another passport` });
                failed++;continue;
              }
            }
            const updateData = { model_name, ...fields };
            if (product_id !== undefined) {
              const storedProductIdentifiers = buildStoredProductIdentifiers({
                companyId,
                passportType: resolvedPassportType,
                productId: normalizedProductId
              });
              updateData.product_id = storedProductIdentifiers.product_id;
              updateData.product_identifier_did = storedProductIdentifiers.product_identifier_did;
            }
            const updateCols = await updatePassportRowById({ tableName, rowId: existing.rows[0].id, userId, data: updateData, excluded });
            if (!updateCols.length) {
              details.push({ dppId: incomingGuid, product_id: normalizedProductId || undefined, status: "skipped", reason: "no changes detected" });
              skipped++;continue;
            }
            await logAudit(companyId, userId, "UPDATE", tableName, incomingGuid, null, { source: "json_upsert" });
            details.push({ dppId: incomingGuid, product_id: normalizedProductId || undefined, status: "updated" });
            updated++;
          } else {
            if (!normalizedProductId) {
              details.push({ status: "skipped", reason: "Serial Number is required to create a new passport" });
              skipped++;continue;
            }
            const existingByProductId = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId });
            if (existingByProductId) {
              const existingStatus = normalizeReleaseStatus(existingByProductId.release_status);
              if (isEditablePassportStatus(existingStatus)) {
                const storedProductIdentifiers = buildStoredProductIdentifiers({
                  companyId,
                  passportType: resolvedPassportType,
                  productId: normalizedProductId
                });
                const allData = {
                  model_name,
                  product_id: storedProductIdentifiers.product_id,
                  product_identifier_did: storedProductIdentifiers.product_identifier_did,
                  ...fields
                };
                const updateCols = await updatePassportRowById({ tableName, rowId: existingByProductId.id, userId, data: allData, excluded });
                if (!updateCols.length) {
                  details.push({ dppId: existingByProductId.dppId, product_id: normalizedProductId, status: "skipped", reason: "no changes detected" });
                  skipped++;continue;
                }
                await logAudit(companyId, userId, "UPDATE", tableName, existingByProductId.dppId, null, { source: "json_upsert", matched_by: "product_id" });
                details.push({ dppId: existingByProductId.dppId, product_id: normalizedProductId, status: "updated" });
                updated++;continue;
              }
              details.push({
                dppId: existingByProductId.dppId, product_id: normalizedProductId, status: "skipped",
                reason: existingStatus === "in_review" ?
                "matching passport is in review and cannot be edited" :
                "matching passport already exists; revise it before importing changes"
              });
              skipped++;continue;
            }
            const newGuid = generateDppRecordId();
            const lineageId = newGuid;
            const dataFields = getWritablePassportColumns(fields, excluded);
            const storedProductIdentifiers = buildStoredProductIdentifiers({
              companyId,
              passportType: resolvedPassportType,
              productId: normalizedProductId
            });
            const complianceManagedFields = await buildComplianceManagedFields({
              companyId,
              passportType: resolvedPassportType
            });
            const allCols = [
            "dppId", "lineage_id", "company_id", "model_name", "product_id", "product_identifier_did",
            "compliance_profile_key", "content_specification_ids", "carrier_policy_key", "economic_operator_id", "facility_id",
            "created_by", ...dataFields];

            const allVals = [
            newGuid,
            lineageId,
            companyId,
            model_name || null,
            storedProductIdentifiers.product_id,
            storedProductIdentifiers.product_identifier_did,
            complianceManagedFields.compliance_profile_key,
            complianceManagedFields.content_specification_ids,
            complianceManagedFields.carrier_policy_key,
            complianceManagedFields.economic_operator_id,
            complianceManagedFields.facility_id,
            userId,
            ...getStoredPassportValues(dataFields, fields)];

            await pool.query(
              `INSERT INTO ${tableName} (${allCols.join(",")}) VALUES (${allCols.map((_, i) => `$${i + 1}`).join(",")})`,
              allVals
            );
            await pool.query(
              `INSERT INTO passport_registry (dpp_id,lineage_id,company_id,passport_type) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
              [newGuid, lineageId, companyId, resolvedPassportType]
            );
            details.push({ dppId: newGuid, product_id: normalizedProductId, model_name, status: "created" });
            created++;
          }
        } catch (e) {
          logger.error("Upsert JSON item error:", e.message);
          details.push({ dppId: incomingGuid, status: "failed", error: e.message });
          failed++;
        }
      }

      res.json({ summary: { created, updated, skipped, failed }, details });
    } catch (e) {
      logger.error("Upsert JSON error:", e.message);
      res.status(500).json({ error: "Import failed" });
    }
  });
};
