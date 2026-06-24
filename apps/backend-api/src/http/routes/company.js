"use strict";

const logger = require("../../services/logger");
const { generateDppRecordId } = require("../../services/dpp-record-id");
const {
  mapCompanyRow,
  mapCompanyFacilityRow,
  mapPassportTemplateFieldRow,
} = require("../../shared/passports/passport-helpers");
const {
  createComplianceManagedFieldHelpers,
} = require("../../modules/passports/compliance-managed-fields");
const {
  importManagedFieldKeys,
  buildManagedImportErrorMessage,
  getInvalidImportFieldKeys,
  getManagedImportFieldKeys,
  isManagedImportFieldLabel,
  resolveCsvImportField,
} = require("../../modules/passports/import-field-guardrails");

module.exports = function registerCompanyRoutes(app, {
  pool,
  authenticateToken,
  checkCompanyAccess,
  requireEditor,
  publicReadRateLimit,
  // passport helpers
  getTable,
  getPassportFieldValue,
  getPassportTypeSchema,
  normalizePassportRequestBody,
  extractExplicitFacilityId,
  normalizeInternalAliasIdValue,
  normalizeReleaseStatus,
  isEditablePassportStatus,
  findExistingPassportByInternalAliasId,
  updatePassportRowById,
  getWritablePassportColumns,
  getStoredPassportValues,
  logAudit,
  editableReleaseStatusesSql,
  systemPassportFields,
  buildSemanticPassportJsonExport,
  buildExpandedPassportPayload,
  productIdentifierService,
  complianceService,
  accessRightsService
}) {
  const governanceImportTokens = new Set([
    "access",
    "audience",
    "audiences",
    "fieldaccess",
    "confidentiality",
    "classification",
    "fieldconfidentiality",
    "updateauthority",
    "updateauthorities",
    "updateauthority",
    "fieldupdateauthority",
  ]);

  function normalizeGovernanceToken(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function isSchemaGovernanceKey(rawKey, typeSchema) {
    const key = String(rawKey || "").trim();
    if (!key) return false;
    if (typeSchema?.allowedKeys?.has?.(key) || systemPassportFields.has(key)) return false;
    return governanceImportTokens.has(normalizeGovernanceToken(key));
  }

  function buildGovernanceImportErrorMessage(keys = []) {
    return `Schema governance fields (${keys.join(", ")}) cannot be imported as passport row data. Configure access, confidentiality, and updateAuthority on the passport type in admin instead.`;
  }

  function createImportExcludedFieldSet(extraFields = []) {
    return new Set([
      ...importManagedFieldKeys,
      ...extraFields,
    ]);
  }

  function buildStoredProductIdentifiers({ companyId, companySlug = null, companyName = null, passportType, internalAliasId, granularity = "item" }) {
    const normalized = productIdentifierService.normalizeProductIdentifiers({
      companyId,
      companySlug,
      companyName,
      passportType,
      rawProductId: internalAliasId,
      granularity
    });
    return {
      internalAliasId: normalized.internalAliasIdInput || null,
      uniqueProductIdentifier: normalized.productIdentifierDid || null
    };
  }

  function mapTemplateRow(row = {}) {
    return {
      id: row.id ?? null,
      companyId: row.companyId ?? null,
      passportType: row.passportType ?? null,
      name: row.name ?? "",
      description: row.description ?? null,
      createdBy: row.createdBy ?? null,
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
      firstName: row.firstName ?? null,
      lastName: row.lastName ?? null,
      modelFieldCount: row.modelFieldCount !== undefined
        ? Number.parseInt(row.modelFieldCount, 10) || 0
        : 0,
    };
  }

  function normalizeBulkPassportRecord(input = {}) {
    return {
      ...input,
      passportType: input.passportType ?? null,
      modelName: input.modelName ?? null,
      internalAliasId: input.internalAliasId ?? null,
    };
  }

  const complianceManagedFieldHelpers = createComplianceManagedFieldHelpers({
    pool,
    complianceService,
    extractExplicitFacilityId,
  });

  async function buildComplianceManagedFields({ companyId, passportType }) {
    return complianceManagedFieldHelpers.buildComplianceManagedFields({
      companyId,
      passportType,
      granularity: "item",
      allowDefaultFacility: false,
    });
  }

  // ─── COMPANY PROFILE ─────────────────────────────────────────────────────

  app.get("/api/companies/:companyId/profile", publicReadRateLimit, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id,
                "companyName" AS "companyName",
                "companyLogo" AS "companyLogo"
         FROM companies
         WHERE id = $1`,
        [req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Company not found" });
      res.json(mapCompanyRow(r.rows[0]));
    } catch {res.status(500).json({ error: "Failed to fetch company profile" });}
  });

  app.post("/api/companies/:companyId/profile", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const companyLogo = req.body?.companyLogo;
      await pool.query(
        `UPDATE companies
         SET "companyLogo" = $1,
             "updatedAt" = NOW()
         WHERE id = $2`,
        [
        companyLogo !== undefined ? companyLogo : null,
        req.params.companyId]

      );
      res.json({ success: true });
    } catch {res.status(500).json({ error: "Failed to save company profile" });}
  });

  app.get("/api/companies/:companyId/compliance-identity", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const companyRes = await pool.query(
        `SELECT id,
                "companyName" AS "companyName",
                "companyLogo" AS "companyLogo",
                "didSlug" AS "didSlug",
                "economicOperatorIdentifier" AS "economicOperatorIdentifier",
                "economicOperatorIdentifierScheme" AS "economicOperatorIdentifierScheme"
         FROM companies
         WHERE id = $1
         LIMIT 1`,
        [req.params.companyId]
      );
      if (!companyRes.rows.length) return res.status(404).json({ error: "Company not found" });

      const facilitiesRes = await pool.query(
        `SELECT id,
                "companyId" AS "companyId",
                "facilityIdentifier" AS "facilityIdentifier",
                "identifierScheme" AS "identifierScheme",
                "displayName" AS "displayName",
                "metadataJson" AS "metadataJson",
                "isActive" AS "isActive",
                "createdBy" AS "createdBy",
                "createdAt" AS "createdAt",
                "updatedAt" AS "updatedAt"
         FROM "companyFacilities"
         WHERE "companyId" = $1
         ORDER BY "updatedAt" DESC, id DESC`,
        [req.params.companyId]
      );

      res.json({
        company: mapCompanyRow(companyRes.rows[0]),
        facilities: facilitiesRes.rows.map(mapCompanyFacilityRow)
      });
    } catch {
      res.status(500).json({ error: "Failed to fetch compliance identity" });
    }
  });

  app.post("/api/companies/:companyId/compliance-identity", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const economicOperatorIdentifier = req.body?.economicOperatorIdentifier === undefined ?
      undefined :
      String(req.body.economicOperatorIdentifier || "").trim();
      const economicOperatorIdentifierScheme = req.body?.economicOperatorIdentifierScheme === undefined ?
      undefined :
      String(req.body.economicOperatorIdentifierScheme || "").trim();

      await pool.query(
        `UPDATE companies
         SET "economicOperatorIdentifier" = COALESCE($1, "economicOperatorIdentifier"),
             "economicOperatorIdentifierScheme" = COALESCE($2, "economicOperatorIdentifierScheme"),
             "updatedAt" = NOW()
         WHERE id = $3`,
        [
        economicOperatorIdentifier === undefined ? null : economicOperatorIdentifier,
        economicOperatorIdentifierScheme === undefined ? null : economicOperatorIdentifierScheme,
        req.params.companyId]

      );

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "updateComplianceIdentity",
        "companies",
        req.params.companyId,
        null,
        {
          economicOperatorIdentifier: economicOperatorIdentifier === undefined ? null : economicOperatorIdentifier,
          economicOperatorIdentifierScheme: economicOperatorIdentifierScheme === undefined ? null : economicOperatorIdentifierScheme
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
      const facilityIdentifier = String(req.body?.facilityIdentifier || "").trim();
      const identifierScheme = String(req.body?.identifierScheme || "").trim();
      if (!facilityIdentifier || !identifierScheme) {
        return res.status(400).json({ error: "facilityIdentifier and identifierScheme are required" });
      }

      const result = await pool.query(
        `INSERT INTO "companyFacilities" (
           "companyId", "facilityIdentifier", "identifierScheme", "displayName", "metadataJson", "createdBy"
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT ("companyId", "identifierScheme", "facilityIdentifier")
         DO UPDATE SET
           "displayName" = EXCLUDED."displayName",
           "metadataJson" = EXCLUDED."metadataJson",
           "isActive" = true,
           "updatedAt" = NOW()
         RETURNING id,
                   "companyId" AS "companyId",
                   "facilityIdentifier" AS "facilityIdentifier",
                   "identifierScheme" AS "identifierScheme",
                   "displayName" AS "displayName",
                   "metadataJson" AS "metadataJson",
                   "isActive" AS "isActive",
                   "createdBy" AS "createdBy",
                   "createdAt" AS "createdAt",
                   "updatedAt" AS "updatedAt"`,
        [
        req.params.companyId,
        facilityIdentifier,
        identifierScheme,
        req.body?.displayName || null,
        JSON.stringify(req.body?.metadataJson || {}),
        req.user.userId]

      );

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "upsertFacilityIdentifier",
        "companyFacilities",
        facilityIdentifier,
        null,
        {
          facilityIdentifier,
          identifierScheme,
          displayName: req.body?.displayName || null
        },
        { actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}` }
      );

      res.status(201).json(mapCompanyFacilityRow(result.rows[0]));
    } catch {
      res.status(500).json({ error: "Failed to save facility identifier" });
    }
  });

  // ─── PASSPORT TEMPLATES ──────────────────────────────────────────────────

  app.get("/api/companies/:companyId/templates", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const passportTypeFilter = req.query.passportType;
      let q = `SELECT t.id,
                      t."companyId" AS "companyId",
                      t."passportType" AS "passportType",
                      t.name,
                      t.description,
                      t."createdBy" AS "createdBy",
                      t."createdAt" AS "createdAt",
                      t."updatedAt" AS "updatedAt",
                      u."firstName" AS "firstName",
                      u."lastName" AS "lastName",
                      (SELECT COUNT(*) FROM "passportTemplateFields" WHERE "templateId" = t.id AND "isModelData" = true) AS "modelFieldCount"
               FROM "passportTemplates" t
               LEFT JOIN users u ON u.id = t."createdBy"
               WHERE t."companyId" = $1`;
      const params = [companyId];
      if (passportTypeFilter) {q += ` AND t.passportType = $2`;params.push(passportTypeFilter);}
      q += ` ORDER BY t."passportType", t.name`;
      const r = await pool.query(q, params);
      res.json(r.rows.map(mapTemplateRow));
    } catch (e) {logger.error(e);res.status(500).json({ error: "Failed" });}
  });

  app.get("/api/companies/:companyId/templates/:id", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, id } = req.params;
      const t = await pool.query(
        `SELECT id,
                "companyId" AS "companyId",
                "passportType" AS "passportType",
                name,
                description,
                "createdBy" AS "createdBy",
                "createdAt" AS "createdAt",
                "updatedAt" AS "updatedAt"
         FROM "passportTemplates"
         WHERE id=$1 AND "companyId"=$2`,
        [id, companyId]
      );
      if (!t.rows.length) return res.status(404).json({ error: "Not found" });
      const fields = await pool.query(
        `SELECT "fieldKey" AS "fieldKey",
                "fieldValue" AS "fieldValue",
                "isModelData" AS "isModelData"
         FROM "passportTemplateFields"
         WHERE "templateId"=$1`,
        [id]
      );
      res.json({
        ...mapTemplateRow(t.rows[0]),
        fields: fields.rows.map(mapPassportTemplateFieldRow),
      });
    } catch (e) {res.status(500).json({ error: "Failed" });}
  });

  app.post("/api/companies/:companyId/templates", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const { passportType, name, description, fields } = req.body;
      if (!passportType || !name?.trim()) return res.status(400).json({ error: "passportType and name required" });

      const t = await pool.query(
        `INSERT INTO "passportTemplates" ("companyId", "passportType", name, description, "createdBy")
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id,
                   "companyId" AS "companyId",
                   "passportType" AS "passportType",
                   name,
                   description,
                   "createdBy" AS "createdBy",
                   "createdAt" AS "createdAt",
                   "updatedAt" AS "updatedAt"`,
        [companyId, passportType, name.trim(), description || null, req.user.userId]
      );
      const tmplId = t.rows[0].id;

      if (Array.isArray(fields) && fields.length) {
        for (const f of fields) {
          if (!f.fieldKey) continue;
          await pool.query(
            `INSERT INTO "passportTemplateFields" ("templateId", "fieldKey", "fieldValue", "isModelData")
             VALUES ($1,$2,$3,$4) ON CONFLICT ("templateId", "fieldKey") DO UPDATE
             SET "fieldValue"=$3, "isModelData"=$4`,
            [tmplId, f.fieldKey, f.fieldValue ?? null, !!f.isModelData]
          );
        }
      }
      res.json(mapTemplateRow(t.rows[0]));
    } catch (e) {logger.error(e);res.status(500).json({ error: "Failed" });}
  });

  app.put("/api/companies/:companyId/templates/:id", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, id } = req.params;
      const { name, description, fields } = req.body;

      const existing = await pool.query(
        "SELECT id FROM \"passportTemplates\" WHERE id=$1 AND \"companyId\"=$2", [id, companyId]
      );
      if (!existing.rows.length) return res.status(404).json({ error: "Not found" });

      const updated = await pool.query(
        `UPDATE "passportTemplates"
         SET name=$1, description=$2, "updatedAt"=NOW()
         WHERE id=$3
         RETURNING id,
                   "companyId" AS "companyId",
                   "passportType" AS "passportType",
                   name,
                   description,
                   "createdBy" AS "createdBy",
                   "createdAt" AS "createdAt",
                   "updatedAt" AS "updatedAt"`,
        [name?.trim() || "Untitled", description || null, id]
      );

      if (Array.isArray(fields)) {
        await pool.query("DELETE FROM \"passportTemplateFields\" WHERE \"templateId\"=$1", [id]);
        for (const f of fields) {
          if (!f.fieldKey) continue;
          await pool.query(
            `INSERT INTO "passportTemplateFields" ("templateId", "fieldKey", "fieldValue", "isModelData")
             VALUES ($1,$2,$3,$4)`,
            [id, f.fieldKey, f.fieldValue ?? null, !!f.isModelData]
          );
        }
      }
      const fieldRows = await pool.query(
        `SELECT "fieldKey" AS "fieldKey",
                "fieldValue" AS "fieldValue",
                "isModelData" AS "isModelData"
         FROM "passportTemplateFields"
         WHERE "templateId"=$1
         ORDER BY "fieldKey"`,
        [id]
      );
      res.json({
        success: true,
        template: {
          ...mapTemplateRow(updated.rows?.[0] || {}),
          fields: fieldRows.rows.map(mapPassportTemplateFieldRow),
        }
      });
    } catch (e) {res.status(500).json({ error: "Failed" });}
  });

  app.delete("/api/companies/:companyId/templates/:id", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, id } = req.params;
      await pool.query("DELETE FROM \"passportTemplates\" WHERE id=$1 AND \"companyId\"=$2", [id, companyId]);
      res.json({ success: true });
    } catch (e) {res.status(500).json({ error: "Failed" });}
  });

  app.get("/api/companies/:companyId/templates/:templateId/export-drafts", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, templateId } = req.params;
      const fmt = (req.query.format || "csv").toLowerCase();

      const tmplRes = await pool.query(
        `SELECT id,
                "companyId" AS "companyId",
                "passportType" AS "passportType",
                name,
                description,
                "createdBy" AS "createdBy",
                "createdAt" AS "createdAt",
                "updatedAt" AS "updatedAt"
         FROM "passportTemplates"
         WHERE id=$1 AND "companyId"=$2`,
        [templateId, companyId]
      );
      if (!tmplRes.rows.length) return res.status(404).json({ error: "Template not found" });
      const tmpl = mapTemplateRow(tmplRes.rows[0]);

      const fieldRes = await pool.query(
        `SELECT "fieldKey" AS "fieldKey",
                "fieldValue" AS "fieldValue",
                "isModelData" AS "isModelData"
         FROM "passportTemplateFields"
         WHERE "templateId"=$1`,
        [templateId]
      );
      const templateFields = Object.fromEntries(fieldRes.rows.map((f) => [f.fieldKey, f.fieldValue]));

      const typeRes = await pool.query(
        `SELECT "fieldsJson" AS "fieldsJson",
                "productCategory" AS "productCategory",
                "semanticModelKey" AS "semanticModelKey"
         FROM "passportTypes"
         WHERE "typeName"=$1`,
        [tmpl.passportType]
      );
      const sections = typeRes.rows[0]?.fieldsJson?.sections || [];
      const schemaFields = sections.flatMap((s) => s.fields || []).
      filter((f) => f.type !== "file" && f.type !== "table");

      const tableName = getTable(tmpl.passportType);
      const passRes = await pool.query(
        `SELECT * FROM ${tableName}
         WHERE "companyId" = $1 AND "releaseStatus" IN ${editableReleaseStatusesSql} AND "deletedAt" IS NULL
         ORDER BY "createdAt" DESC`,
        [companyId]
      );
      const rows = passRes.rows;

      if (fmt === "json" || fmt === "jsonld") {
        res.setHeader("Content-Type", "application/ld+json");
        res.setHeader("Content-Disposition", `attachment; filename="${tmpl.passportType}_drafts.jsonld"`);
        const exportRows = rows.map((row) => buildExpandedPassportPayload(
          { ...row, passportType: tmpl.passportType },
          typeRes.rows[0],
          {
            granularity: row.granularity || "model",
          }
        ));
        return res.json(buildSemanticPassportJsonExport(exportRows, tmpl.passportType, {
          semanticModelKey: typeRes.rows[0]?.semanticModelKey || null,
          productCategory: typeRes.rows[0]?.productCategory || null,
          typeDef: typeRes.rows[0]
        }));
      }

      const escCell = (v) => {
        const stringValue = Array.isArray(v) || (typeof v === "object" && v !== null)
          ? JSON.stringify(v)
          : String(v ?? "");
        return `"${stringValue.replace(/"/g, '""')}"`;
      };

      const fieldRows = [
      ["dppId", ...rows.map((r) => r.dppId || "")],
      ["modelName", ...rows.map((r) => r.modelName || "")],
      ["internalAliasId", ...rows.map((r) => r.internalAliasId || "")],
      ...schemaFields.map((f) => [
      f.label,
      ...rows.map((r) => getPassportFieldValue(r, f.key) ?? templateFields[f.key] ?? "")]
      )];

      const headerRow = ["Field Name", ...rows.map((_, i) => `Passport ${i + 1}`)];
      const csvLines = [headerRow, ...fieldRows].map((row) => row.map(escCell).join(","));

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${tmpl.passportType}_drafts.csv"`);
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
      const { passportType, csv } = normalizedBody;
      if (!passportType || !csv) return res.status(400).json({ error: "passportType and csv required" });

      const typeSchema = await getPassportTypeSchema(passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const resolvedPassportType = typeSchema.typeName;

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
      const governanceRowLabels = [...new Set(
        fieldRows
          .map((row) => String(row[0] || "").trim())
          .filter(Boolean)
          .filter((label) => isSchemaGovernanceKey(label, typeSchema))
      )];
      if (governanceRowLabels.length) {
        return res.status(400).json({
          error: buildGovernanceImportErrorMessage(governanceRowLabels),
          governanceFields: governanceRowLabels,
        });
      }
      const managedRowLabels = [...new Set(
        fieldRows
          .map((row) => String(row[0] || "").trim())
          .filter(Boolean)
          .filter((label) => {
            const field = resolveCsvImportField(label, typeSchema);
            return isManagedImportFieldLabel(label) ||
              Boolean(field?.key && getManagedImportFieldKeys({ [field.key]: true }).length > 0);
          })
      )];
      if (managedRowLabels.length) {
        return res.status(400).json({
          error: buildManagedImportErrorMessage(managedRowLabels),
          managedFields: managedRowLabels,
        });
      }

      const tableName = getTable(resolvedPassportType);
      const userId = req.user.userId;
      const excluded = createImportExcludedFieldSet(["dppId"]);

      let created = 0,updated = 0,skipped = 0,failed = 0;
      const details = [];

      for (let colIdx = 1; colIdx <= numPassports; colIdx++) {
        const passport = {};
        fieldRows.forEach((row) => {
          const rawLabel = (row[0] || "").trim();
          if (!rawLabel) return;
          const value = (row[colIdx] || "").trim();

          const field = resolveCsvImportField(rawLabel, typeSchema);

          if (field && value) {
            passport[field.key] = field.type === "boolean" ?
            value.toLowerCase() === "true" || value === "1" :
            value;
          }
        });

        const { dppId: incomingGuid, modelName, internalAliasId, ...fields } = normalizeBulkPassportRecord(passport);
        const normalizedProductId = normalizeInternalAliasIdValue(internalAliasId);

        try {
          if (incomingGuid) {
            const existing = await pool.query(
              `SELECT id FROM ${tableName} WHERE "dppId" = $1 AND "companyId" = $2 AND "releaseStatus" IN ${editableReleaseStatusesSql} AND "deletedAt" IS NULL`,
              [incomingGuid, companyId]
            );
            if (!existing.rows.length) {
              details.push({ dppId: incomingGuid, status: "skipped", reason: "not found or not editable" });
              skipped++;continue;
            }
            const rowId = existing.rows[0].id;
            if (internalAliasId !== undefined) {
              if (!normalizedProductId) {
                details.push({ dppId: incomingGuid, status: "failed", error: "internalAliasId cannot be blank" });
                failed++;continue;
              }
              const existingByProductId = await findExistingPassportByInternalAliasId({
                tableName, companyId, internalAliasId: normalizedProductId, excludeGuid: incomingGuid
              });
              if (existingByProductId) {
                details.push({ dppId: incomingGuid, internalAliasId: normalizedProductId, status: "failed", error: `Internal Alias ID "${normalizedProductId}" already belongs to another passport` });
                failed++;continue;
              }
            }
            const updateData = { modelName, ...fields };
            if (internalAliasId !== undefined) {
              const storedProductIdentifiers = buildStoredProductIdentifiers({
                companyId,
                passportType: resolvedPassportType,
                internalAliasId: normalizedProductId
              });
              updateData.internalAliasId = storedProductIdentifiers.internalAliasId;
              updateData.uniqueProductIdentifier = storedProductIdentifiers.uniqueProductIdentifier;
            }
            const updateCols = await updatePassportRowById({ tableName, rowId, userId, data: updateData, excluded });
            if (!updateCols.length) {skipped++;continue;}
            await logAudit(companyId, userId, "update", tableName, incomingGuid, null, { source: "csvUpsert" });
            details.push({ dppId: incomingGuid, internalAliasId: normalizedProductId || undefined, status: "updated" });
            updated++;
          } else {
            if (!normalizedProductId) {
              details.push({ status: "skipped", reason: "Internal Alias ID is required to create a new passport" });
              skipped++;continue;
            }
            const existingByProductId = await findExistingPassportByInternalAliasId({ tableName, companyId, internalAliasId: normalizedProductId });
            if (existingByProductId) {
              const existingStatus = normalizeReleaseStatus(existingByProductId.releaseStatus);
              if (isEditablePassportStatus(existingStatus)) {
                const storedProductIdentifiers = buildStoredProductIdentifiers({
                  companyId,
                  passportType: resolvedPassportType,
                  internalAliasId: normalizedProductId
                });
                const updateData = {
                  modelName,
                  internalAliasId: storedProductIdentifiers.internalAliasId,
                  uniqueProductIdentifier: storedProductIdentifiers.uniqueProductIdentifier,
                  ...fields
                };
                const updateCols = await updatePassportRowById({ tableName, rowId: existingByProductId.id, userId, data: updateData, excluded });
                if (!updateCols.length) {
                  details.push({ dppId: existingByProductId.dppId, internalAliasId: normalizedProductId, status: "skipped", reason: "no changes detected" });
                  skipped++;continue;
                }
                await logAudit(companyId, userId, "update", tableName, existingByProductId.dppId, null, { source: "csvUpsert", matchedBy: "internalAliasId" });
                details.push({ dppId: existingByProductId.dppId, internalAliasId: normalizedProductId, status: "updated" });
                updated++;continue;
              }
              details.push({
                dppId: existingByProductId.dppId, internalAliasId: normalizedProductId, status: "skipped",
                reason: existingStatus === "inReview" ?
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
              internalAliasId: normalizedProductId
            });
            const complianceManagedFields = await buildComplianceManagedFields({
              companyId,
              passportType: resolvedPassportType
            });
            const allCols = [
            "dppId", "lineageId", "companyId", "modelName", "internalAliasId", "uniqueProductIdentifier",
            "passportPolicyKey", "contentSpecificationIds", "carrierPolicyKey", "economicOperatorId", "facilityId",
            "createdBy", ...dataFields];

            const allVals = [
            newGuid,
            lineageId,
            companyId,
            modelName || null,
            storedProductIdentifiers.internalAliasId,
            storedProductIdentifiers.uniqueProductIdentifier,
            complianceManagedFields.passportPolicyKey,
            complianceManagedFields.contentSpecificationIds,
            complianceManagedFields.carrierPolicyKey,
            complianceManagedFields.economicOperatorId,
            complianceManagedFields.facilityId,
            userId,
            ...getStoredPassportValues(dataFields, fields)];

            await pool.query(
              `INSERT INTO ${tableName} (${allCols.join(",")}) VALUES (${allCols.map((_, i) => `$${i + 1}`).join(",")})`,
              allVals
            );
            await pool.query(
              `INSERT INTO "passportRegistry" ("dppId","lineageId","companyId","passportType") VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
              [newGuid, lineageId, companyId, resolvedPassportType]
            );
            details.push({ dppId: newGuid, internalAliasId: normalizedProductId, modelName, status: "created" });
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
      let passportType, passports;
      if (Array.isArray(req.body)) {
        passports = req.body;
        passportType = passports[0]?.passportType;
      } else {
        const normalizedBody = normalizePassportRequestBody(req.body);
        passportType = normalizedBody.passportType;
        passports = normalizedBody.passports;
      }
      if (!passportType) return res.status(400).json({ error: "passportType required" });
      if (!Array.isArray(passports) || !passports.length) return res.status(400).json({ error: "passports array required" });
      if (passports.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      const typeSchema = await getPassportTypeSchema(passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const resolvedPassportType = typeSchema.typeName;
      const tableName = getTable(resolvedPassportType);
      const userId = req.user.userId;
      const excluded = createImportExcludedFieldSet();

      let created = 0,updated = 0,skipped = 0,failed = 0;
      const details = [];

      for (const item of passports) {
        const normalizedItem = normalizePassportRequestBody(item || {});
        const { dppId: incomingGuid, modelName, internalAliasId, ...fields } = normalizeBulkPassportRecord(normalizedItem);
        const normalizedProductId = normalizeInternalAliasIdValue(internalAliasId);
        const governanceFieldKeys = Object.keys(fields).filter((key) => isSchemaGovernanceKey(key, typeSchema));
        const managedFieldKeys = getManagedImportFieldKeys(fields);
        const invalidFieldKeys = getInvalidImportFieldKeys(fields, typeSchema);
        try {
          if (governanceFieldKeys.length) {
            details.push({
              dppId: incomingGuid || undefined,
              internalAliasId: normalizedProductId || undefined,
              status: "failed",
              error: buildGovernanceImportErrorMessage(governanceFieldKeys)
            });
            failed++;
            continue;
          }
          if (managedFieldKeys.length) {
            details.push({
              dppId: incomingGuid || undefined,
              internalAliasId: normalizedProductId || undefined,
              status: "failed",
              error: buildManagedImportErrorMessage(managedFieldKeys)
            });
            failed++;
            continue;
          }
          if (invalidFieldKeys.length) {
            details.push({
              dppId: incomingGuid || undefined,
              internalAliasId: normalizedProductId || undefined,
              status: "failed",
              error: `Unknown passport field(s): ${invalidFieldKeys.join(", ")}`
            });
            failed++;
            continue;
          }
          if (incomingGuid) {
            const existing = await pool.query(
              `SELECT id FROM ${tableName} WHERE "dppId" = $1 AND "companyId" = $2 AND "releaseStatus" IN ${editableReleaseStatusesSql} AND "deletedAt" IS NULL`,
              [incomingGuid, companyId]
            );
            if (!existing.rows.length) {
              details.push({ dppId: incomingGuid, status: "skipped", reason: "not found or not editable" });
              skipped++;continue;
            }
            if (internalAliasId !== undefined) {
              if (!normalizedProductId) {
                details.push({ dppId: incomingGuid, status: "failed", error: "internalAliasId cannot be blank" });
                failed++;continue;
              }
              const existingByProductId = await findExistingPassportByInternalAliasId({
                tableName, companyId, internalAliasId: normalizedProductId, excludeGuid: incomingGuid
              });
              if (existingByProductId) {
                details.push({ dppId: incomingGuid, internalAliasId: normalizedProductId, status: "failed", error: `Internal Alias ID "${normalizedProductId}" already belongs to another passport` });
                failed++;continue;
              }
            }
            const updateData = { modelName, ...fields };
            if (internalAliasId !== undefined) {
              const storedProductIdentifiers = buildStoredProductIdentifiers({
                companyId,
                passportType: resolvedPassportType,
                internalAliasId: normalizedProductId
              });
              updateData.internalAliasId = storedProductIdentifiers.internalAliasId;
              updateData.uniqueProductIdentifier = storedProductIdentifiers.uniqueProductIdentifier;
            }
            const updateCols = await updatePassportRowById({ tableName, rowId: existing.rows[0].id, userId, data: updateData, excluded });
            if (!updateCols.length) {
              details.push({ dppId: incomingGuid, internalAliasId: normalizedProductId || undefined, status: "skipped", reason: "no changes detected" });
              skipped++;continue;
            }
            await logAudit(companyId, userId, "update", tableName, incomingGuid, null, { source: "jsonUpsert" });
            details.push({ dppId: incomingGuid, internalAliasId: normalizedProductId || undefined, status: "updated" });
            updated++;
          } else {
            if (!normalizedProductId) {
              details.push({ status: "skipped", reason: "Internal Alias ID is required to create a new passport" });
              skipped++;continue;
            }
            const existingByProductId = await findExistingPassportByInternalAliasId({ tableName, companyId, internalAliasId: normalizedProductId });
            if (existingByProductId) {
              const existingStatus = normalizeReleaseStatus(existingByProductId.releaseStatus);
              if (isEditablePassportStatus(existingStatus)) {
                const storedProductIdentifiers = buildStoredProductIdentifiers({
                  companyId,
                  passportType: resolvedPassportType,
                  internalAliasId: normalizedProductId
                });
                const allData = {
                  modelName,
                  internalAliasId: storedProductIdentifiers.internalAliasId,
                  uniqueProductIdentifier: storedProductIdentifiers.uniqueProductIdentifier,
                  ...fields
                };
                const updateCols = await updatePassportRowById({ tableName, rowId: existingByProductId.id, userId, data: allData, excluded });
                if (!updateCols.length) {
                  details.push({ dppId: existingByProductId.dppId, internalAliasId: normalizedProductId, status: "skipped", reason: "no changes detected" });
                  skipped++;continue;
                }
                await logAudit(companyId, userId, "update", tableName, existingByProductId.dppId, null, { source: "jsonUpsert", matchedBy: "internalAliasId" });
                details.push({ dppId: existingByProductId.dppId, internalAliasId: normalizedProductId, status: "updated" });
                updated++;continue;
              }
              details.push({
                dppId: existingByProductId.dppId, internalAliasId: normalizedProductId, status: "skipped",
                reason: existingStatus === "inReview" ?
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
              internalAliasId: normalizedProductId
            });
            const complianceManagedFields = await buildComplianceManagedFields({
              companyId,
              passportType: resolvedPassportType
            });
            const allCols = [
            "dppId", "lineageId", "companyId", "modelName", "internalAliasId", "uniqueProductIdentifier",
            "passportPolicyKey", "contentSpecificationIds", "carrierPolicyKey", "economicOperatorId", "facilityId",
            "createdBy", ...dataFields];

            const allVals = [
            newGuid,
            lineageId,
            companyId,
            modelName || null,
            storedProductIdentifiers.internalAliasId,
            storedProductIdentifiers.uniqueProductIdentifier,
            complianceManagedFields.passportPolicyKey,
            complianceManagedFields.contentSpecificationIds,
            complianceManagedFields.carrierPolicyKey,
            complianceManagedFields.economicOperatorId,
            complianceManagedFields.facilityId,
            userId,
            ...getStoredPassportValues(dataFields, fields)];

            await pool.query(
              `INSERT INTO ${tableName} (${allCols.join(",")}) VALUES (${allCols.map((_, i) => `$${i + 1}`).join(",")})`,
              allVals
            );
            await pool.query(
              `INSERT INTO "passportRegistry" ("dppId","lineageId","companyId","passportType") VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
              [newGuid, lineageId, companyId, resolvedPassportType]
            );
            details.push({ dppId: newGuid, internalAliasId: normalizedProductId, modelName, status: "created" });
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
