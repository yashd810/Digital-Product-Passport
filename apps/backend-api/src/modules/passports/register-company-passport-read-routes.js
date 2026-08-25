"use strict";

const {
  flattenSchemaFieldsFromSections,
} = require("../../shared/passports/passport-helpers");
const { getSafeErrorMessage } = require("../../shared/http/error-response");
const { serializeCsvCell } = require("../../shared/security/csv-cell");

module.exports = function registerCompanyPassportReadRoutes(app, deps) {
  const {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    normalizePassportRequestBody,
    getTable,
    normalizePassportRow,
    getPassportFieldValue,
    normalizeInternalAliasIdValue,
    getPassportTypeSchema,
    hasCompanyPassportTypeAccess,
    fetchCompanyPassportRecord,
    buildSemanticPassportJsonExport,
    buildExpandedPassportPayload,
    complianceService,
    productIdentifierService,
    isFullRepresentationRequest,
    loadCompanySerializationContext,
    inRevisionStatusesSql,
    archivedHistoryFilterSql,
  } = deps;

  async function getAccessiblePassportTypeSchema(req, companyId, requestedPassportType) {
    const typeSchema = await getPassportTypeSchema(requestedPassportType);
    if (!typeSchema) return null;
    if (req.user?.role === "superAdmin") return typeSchema;
    const hasAccess = await hasCompanyPassportTypeAccess(companyId, typeSchema.typeName);
    return hasAccess ? typeSchema : null;
  }

  app.get("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const { passportType, search, status } = req.query;
      if (!passportType) return res.status(400).json({ error: "passportType query param is required" });
      const typeSchema = await getAccessiblePassportTypeSchema(req, companyId, passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found for this company" });

      const tableName = getTable(typeSchema.typeName);
      let query = `SELECT p.*,
                          u.email AS "createdByEmail",
                          u."firstName" AS "firstName",
                          u."lastName" AS "lastName",
                          NULLIF(TRIM(CONCAT(COALESCE(u."firstName", ''), ' ', COALESCE(u."lastName", ''))), '') AS "createdByName"
               FROM ${tableName} p
               LEFT JOIN users u ON u.id = p."createdBy"
               WHERE p."deletedAt" IS NULL AND p."companyId" = $1`;
      const params = [companyId];
      let index = 2;

      if (status) {
        const normalizedStatus = String(status).trim().toLowerCase();
        const exactStatusByFilter = {
          draft: "draft",
          released: "released",
          inreview: "inReview",
          obsolete: "obsolete",
        };
        if (normalizedStatus === "all") {
          // No release-status predicate means all active rows for this type.
        } else if (normalizedStatus === "inrevision") {
          query += ` AND p."releaseStatus" IN ${inRevisionStatusesSql}`;
        } else {
          const exactStatus = exactStatusByFilter[normalizedStatus];
          if (!exactStatus) {
            return res.status(400).json({
              error: `Invalid status filter "${status}". Use: draft, released, inRevision, inReview, obsolete, all`,
            });
          }
          query += ` AND p."releaseStatus" = $${index++}`;
          params.push(exactStatus);
        }
      }
      if (search) {
        query += ` AND (p."modelName" ILIKE $${index} OR p."internalAliasId" ILIKE $${index} OR p."uniqueProductIdentifier" ILIKE $${index})`;
        params.push(`%${search}%`);
        index += 1;
      }
      query += " ORDER BY p.\"lineageId\", p.\"versionNumber\" DESC";

      const result = await pool.query(query, params);
      res.json(result.rows.map((row) => ({
        ...normalizePassportRow(row, typeSchema),
        passportType: typeSchema.typeName,
      })));
    } catch {
      res.status(500).json({ error: "Failed to fetch passports" });
    }
  });

  app.post("/api/companies/:companyId/passports/bulk-fetch", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      let passportType;
      let identifiers;
      if (Array.isArray(req.body)) {
        identifiers = req.body;
        passportType = identifiers[0]?.passportType;
      } else {
        const normalizedBody = normalizePassportRequestBody(req.body);
        passportType = normalizedBody.passportType;
        identifiers = normalizedBody.passports || normalizedBody.identifiers;
      }

      if (!passportType) return res.status(400).json({ error: "passportType required" });
      if (!Array.isArray(identifiers) || !identifiers.length) return res.status(400).json({ error: "passports or identifiers array required" });
      if (identifiers.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      const typeSchema = await getAccessiblePassportTypeSchema(req, companyId, passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found for this company" });
      const tableName = getTable(typeSchema.typeName);
      const results = [];

      for (const item of identifiers) {
        const raw = typeof item === "string" ? { internalAliasId: item } : item || {};
        const dppId = raw.dppId;
        const internalAliasId = normalizeInternalAliasIdValue(raw.internalAliasId);
        try {
          let row = null;
          if (dppId) {
            const result = await pool.query(
              `SELECT p.*,
                      u.email AS "createdByEmail",
                      u."firstName" AS "firstName",
                      u."lastName" AS "lastName",
                      NULLIF(TRIM(CONCAT(COALESCE(u."firstName", ''), ' ', COALESCE(u."lastName", ''))), '') AS "createdByName"
               FROM ${tableName} p LEFT JOIN users u ON u.id = p."createdBy"
               WHERE p."dppId" = $1 AND p."companyId" = $2 AND p."deletedAt" IS NULL LIMIT 1`,
              [dppId, companyId]
            );
            row = result.rows[0];
          }
          if (!row && internalAliasId) {
            const productIdCandidates = productIdentifierService.buildLookupCandidates({
              companyId,
              passportType: typeSchema.typeName,
              internalAliasId,
            });
            const result = await pool.query(
              `WITH latest AS (
                 SELECT DISTINCT ON ("lineageId") *
                 FROM ${tableName}
                 WHERE ("internalAliasId" = ANY($1::text[]) OR "uniqueProductIdentifier" = ANY($1::text[]))
                   AND "companyId" = $2
                   AND "deletedAt" IS NULL
                 ORDER BY "lineageId", "versionNumber" DESC, "updatedAt" DESC
               )
               SELECT latest.*,
                      u.email AS "createdByEmail",
                      u."firstName" AS "firstName",
                      u."lastName" AS "lastName",
                      NULLIF(TRIM(CONCAT(COALESCE(u."firstName", ''), ' ', COALESCE(u."lastName", ''))), '') AS "createdByName"
               FROM latest LEFT JOIN users u ON u.id = latest."createdBy"
               ORDER BY latest."versionNumber" DESC LIMIT 1`,
              [productIdCandidates, companyId]
            );
            row = result.rows[0];
          }

          if (row) {
            results.push({ ...normalizePassportRow(row, typeSchema), passportType: typeSchema.typeName, _status: "found" });
          } else {
            results.push({ dppId: dppId || undefined, internalAliasId: internalAliasId || undefined, _status: "notFound" });
          }
        } catch (error) {
          results.push({
            dppId: dppId || undefined,
            internalAliasId: internalAliasId || undefined,
            _status: "error",
            error: getSafeErrorMessage(error, "Failed to fetch passport"),
          });
        }
      }

      res.json({ total: identifiers.length, found: results.filter((row) => row._status === "found").length, results });
    } catch (error) {
      logger.error("Bulk fetch error:", error.message);
      res.status(500).json({ error: "Bulk fetch failed" });
    }
  });

  app.get("/api/companies/:companyId/passports/export-drafts", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const passportType = req.query.passportType;
      const format = String(req.query.format || "csv").toLowerCase();
      const statusFilter = String(req.query.status || "draft").trim().toLowerCase();

      if (!passportType) return res.status(400).json({ error: "passportType is required" });

      const typeSchema = await getAccessiblePassportTypeSchema(req, companyId, passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found for this company" });
      const resolvedPassportType = typeSchema.typeName;
      const typeResult = await pool.query(
        'SELECT "fieldsJson" AS "fieldsJson", "productCategory" AS "productCategory", "semanticModelKey" AS "semanticModelKey" FROM "passportTypes" WHERE "typeName" = $1',
        [resolvedPassportType]
      );
      if (!typeResult.rows.length) return res.status(404).json({ error: "Passport type not found" });

      const sections = typeResult.rows[0]?.fieldsJson?.sections || [];
      const schemaFields = flattenSchemaFieldsFromSections(sections);
      const wantsFullRepresentation = isFullRepresentationRequest(req.query.representation);
      const tableName = getTable(resolvedPassportType);
      // Export needs the full row because stored passport columns may be normalized
      // differently than the schema field keys (for example lowercased identifiers).
      // Limiting the SELECT list here causes many values to disappear before the
      // CSV/JSON-LD serializers have a chance to resolve them.
      const safeColumns = ["*"];

      const statusSqlByFilter = {
        all: "",
        draft: ' AND "releaseStatus" = \'draft\'',
        released: ' AND "releaseStatus" = \'released\'',
        inrevision: ` AND "releaseStatus" IN ${inRevisionStatusesSql}`,
      };
      const statusSql = statusSqlByFilter[statusFilter];
      if (statusSql === undefined) {
        return res.status(400).json({
          error: `Invalid status filter "${req.query.status}". Use: draft, released, inRevision, all`,
        });
      }

      const passportResult = await pool.query(
        `SELECT ${safeColumns.join(", ")} FROM ${tableName}
         WHERE "companyId"=$1${statusSql} AND "deletedAt" IS NULL
         ORDER BY "createdAt" DESC`,
        [companyId]
      );
      const rows = passportResult.rows;

      if (format === "json" || format === "jsonld") {
        res.setHeader("Content-Type", "application/ld+json");
        res.setHeader("Content-Disposition", `attachment; filename="${resolvedPassportType}_export.jsonld"`);
        const company = wantsFullRepresentation
          ? await loadCompanySerializationContext(companyId)
          : null;
        const exportRows = wantsFullRepresentation
          ? rows.map((row) => buildExpandedPassportPayload(
              { ...normalizePassportRow(row, typeResult.rows[0]?.fieldsJson), passportType: resolvedPassportType },
              typeResult.rows[0],
              {
                company,
                granularity: company?.defaultGranularity || row.granularity || "model",
              }
            ))
          : rows;
        return res.json(buildSemanticPassportJsonExport(exportRows, resolvedPassportType, {
          semanticModelKey: typeResult.rows[0]?.semanticModelKey || null,
          productCategory: typeResult.rows[0]?.productCategory || null,
          typeDef: typeResult.rows[0],
        }));
      }

      const fieldRows = [
        ["dppId", ...rows.map((row) => row.dppId)],
        ["modelName", ...rows.map((row) => row.modelName || "")],
        ["internalAliasId", ...rows.map((row) => row.internalAliasId || "")],
        ["releaseStatus", ...rows.map((row) => row.releaseStatus || "")],
        ...schemaFields.map((field) => [field.label || field.key, ...rows.map((row) => getPassportFieldValue(row, field.key) ?? "")]),
      ];

      const headerRow = ["Field Name", ...rows.map((_, index) => `Passport ${index + 1}`)];
      const csvLines = [headerRow, ...fieldRows].map((row) => row.map(serializeCsvCell).join(","));

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${resolvedPassportType}_export.csv"`);
      res.send(csvLines.join("\n"));
    } catch (error) {
      logger.error("Export by type error:", error.message);
      res.status(500).json({ error: "Export failed" });
    }
  });

  app.get("/api/companies/:companyId/passports/archived", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const { search, passportType } = req.query;
      let requestedTypeSchema = null;
      if (passportType) {
        requestedTypeSchema = await getAccessiblePassportTypeSchema(req, companyId, passportType);
        if (!requestedTypeSchema) {
          return res.status(404).json({ error: "Passport type not found for this company" });
        }
      }

      let query = `SELECT pa.*, u.email AS "archivedByEmail", u."firstName" AS "archivedByFirstName", u."lastName" AS "archivedByLastName"
                   FROM "passportArchives" pa
               LEFT JOIN users u ON u.id = pa."archivedBy"
               WHERE pa."companyId" = $1
                 AND ${archivedHistoryFilterSql}`;
      const params = [companyId];
      let index = 2;

      if (requestedTypeSchema) {
        query += ` AND pa."passportType" = $${index++}`;
        params.push(requestedTypeSchema.typeName);
      }
      if (search) {
        query += ` AND (pa."modelName" ILIKE $${index} OR pa."internalAliasId" ILIKE $${index} OR pa."productIdentifierDid" ILIKE $${index} OR pa."dppId"::text ILIKE $${index})`;
        params.push(`%${search}%`);
        index += 1;
      }

      query = `
        SELECT
          sub.*,
          COALESCE(phv."isPublic", sub."releaseStatus" IN ('released', 'obsolete')) AS "isPublic",
          publicVersion."versionNumber" AS "publicVersionNumber"
        FROM (${query}) sub
        LEFT JOIN "passportHistoryVisibility" phv
          ON phv."passportDppId" = sub."dppId"
         AND phv."versionNumber" = sub."versionNumber"
        LEFT JOIN LATERAL (
          SELECT paPublic."versionNumber"
          FROM "passportArchives" paPublic
          LEFT JOIN "passportHistoryVisibility" phvPublic
            ON phvPublic."passportDppId" = paPublic."dppId"
           AND phvPublic."versionNumber" = paPublic."versionNumber"
          WHERE paPublic."lineageId" = sub."lineageId"
            AND paPublic."companyId" = sub."companyId"
            AND ${archivedHistoryFilterSql.replaceAll("\"snapshotReason\"", "paPublic.\"snapshotReason\"")}
            AND paPublic."releaseStatus" IN ('released', 'obsolete')
            AND COALESCE(phvPublic."isPublic", true) = true
          ORDER BY paPublic."versionNumber" DESC, paPublic."archivedAt" DESC
          LIMIT 1
        ) publicVersion ON true
        ORDER BY sub."lineageId", sub."versionNumber" DESC, sub."archivedAt" DESC
      `;

      const result = await pool.query(query, params);
      const typeNames = [...new Set(
        (result.rows || []).map((row) => String(row.passportType || "").trim()).filter(Boolean)
      )];
      const typeSchemas = new Map(await Promise.all(typeNames.map(async (typeName) => {
        const typeSchema = await getAccessiblePassportTypeSchema(req, companyId, typeName);
        return [typeName, typeSchema];
      })));
      const projectedRows = (result.rows || [])
        .filter((row) => typeSchemas.has(String(row.passportType || "").trim())
          && typeSchemas.get(String(row.passportType || "").trim()))
        .map((row) => {
          const typeSchema = typeSchemas.get(String(row.passportType || "").trim()) || null;
          let storedRowData = row.rowData;
          if (typeof storedRowData === "string") {
            try {
              storedRowData = JSON.parse(storedRowData);
            } catch {
              storedRowData = null;
            }
          }
          return {
            ...row,
            // Never return an unprojected archive snapshot. If its type schema
            // cannot be resolved, omit the opaque payload instead of exposing
            // columns retained from an older schema version.
            rowData: typeSchema && storedRowData && typeof storedRowData === "object"
              ? normalizePassportRow(storedRowData, typeSchema)
              : null,
          };
        });
      res.json(projectedRows);
    } catch (error) {
      logger.error("Archived list error:", error.message);
      res.status(500).json({ error: "Failed to fetch archived passports" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const { passportType } = req.query;
      const versionNumber = req.query.versionNumber ? Number.parseInt(req.query.versionNumber, 10) : null;
      if (!passportType) return res.status(400).json({ error: "passportType query param required" });
      if (req.query.versionNumber && !Number.isFinite(versionNumber)) {
        return res.status(400).json({ error: "versionNumber must be a valid integer" });
      }

      const typeSchema = await getAccessiblePassportTypeSchema(req, companyId, passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found for this company" });
      const resolved = await fetchCompanyPassportRecord({
        companyId,
        dppId,
        passportType: typeSchema.typeName,
        versionNumber,
      });
      if (!resolved?.passport) return res.status(404).json({ error: "Passport not found" });

      // Get passport type schema for normalization
      const typeDef = await pool.query(
        `SELECT "typeName" AS "typeName", "productCategory" AS "productCategory", "semanticModelKey" AS "semanticModelKey", "fieldsJson" AS "fieldsJson"
         FROM "passportTypes"
         WHERE "typeName" = $1
         LIMIT 1`,
        [typeSchema.typeName]
      );
      if (!typeDef.rows.length) {
        return res.status(404).json({ error: "Passport type not found" });
      }

      // Normalize the passport (deserialize JSONB fields)
      const normalizedPassport = normalizePassportRow(
        resolved.passport,
        typeDef.rows[0]
      );

      if (isFullRepresentationRequest(req.query.representation)) {
        const company = await loadCompanySerializationContext(companyId);
        return res.json(
          buildExpandedPassportPayload(normalizedPassport, typeDef.rows[0], {
            company,
            granularity: company?.defaultGranularity || normalizedPassport.granularity || "model",
          })
        );
      }

      res.json(normalizedPassport);
    } catch {
      res.status(500).json({ error: "Failed to fetch passport" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/compliance", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const { passportType } = req.query;
      if (!passportType) return res.status(400).json({ error: "passportType query param required" });

      const typeSchema = await getAccessiblePassportTypeSchema(req, companyId, passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found for this company" });
      const resolved = await fetchCompanyPassportRecord({ companyId, dppId, passportType: typeSchema.typeName });
      if (!resolved?.passport) return res.status(404).json({ error: "Passport not found" });

      const compliance = await complianceService.evaluatePassport(resolved.passport, typeSchema.typeName);
      res.json(compliance);
    } catch (error) {
      logger.error("Compliance fetch error:", error.message);
      res.status(500).json({ error: "Failed to evaluate passport compliance" });
    }
  });
};
