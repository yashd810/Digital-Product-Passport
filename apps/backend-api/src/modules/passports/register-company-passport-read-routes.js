"use strict";

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
    normalizeReleaseStatus,
    normalizeInternalAliasIdValue,
    getPassportTypeSchema,
    fetchCompanyPassportRecord,
    buildSemanticPassportJsonExport,
    buildExpandedPassportPayload,
    complianceService,
    productIdentifierService,
    isFullRepresentationRequest,
    loadCompanySerializationContext,
    IN_REVISION_STATUS,
    IN_REVISION_STATUSES_SQL,
    EDITABLE_RELEASE_STATUSES_SQL,
    ARCHIVED_HISTORY_FILTER_SQL,
  } = deps;

  app.get("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const { passportType, search, status } = req.query;
      if (!passportType) return res.status(400).json({ error: "passportType query param is required" });
      const typeSchema = await getPassportTypeSchema(passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });

      const tableName = getTable(passportType);
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
        const normalizedStatus = normalizeReleaseStatus(status);
        if (normalizedStatus === IN_REVISION_STATUS) {
          query += ` AND p."releaseStatus" IN ${IN_REVISION_STATUSES_SQL}`;
        } else {
          query += ` AND p."releaseStatus" = $${index++}`;
          params.push(normalizedStatus);
        }
      }
      if (search) {
        query += ` AND (p."modelName" ILIKE $${index} OR p."internalAliasId" ILIKE $${index} OR p."uniqueProductIdentifier" ILIKE $${index})`;
        params.push(`%${search}%`);
        index += 1;
      }
      query += " ORDER BY p.\"lineageId\", p.\"versionNumber\" DESC";

      const result = await pool.query(query, params);
      res.json(result.rows.map((row) => ({ ...normalizePassportRow(row, typeSchema), passportType })));
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

      const typeSchema = await getPassportTypeSchema(passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
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
            results.push({ dppId: dppId || undefined, internalAliasId: internalAliasId || undefined, _status: "not_found" });
          }
        } catch (error) {
          results.push({ dppId: dppId || undefined, internalAliasId: internalAliasId || undefined, _status: "error", error: error.message });
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
      const statusFilter = String(req.query.status || "draft").toLowerCase();

      if (!passportType) return res.status(400).json({ error: "passportType is required" });

      const typeResult = await pool.query(
        'SELECT "fieldsJson" AS "fieldsJson", "productCategory" AS "productCategory", "semanticModelKey" AS "semanticModelKey" FROM passport_types WHERE "typeName" = $1',
        [passportType]
      );
      if (!typeResult.rows.length) return res.status(404).json({ error: "Passport type not found" });

      const sections = typeResult.rows[0]?.fieldsJson?.sections || [];
      const schemaFields = sections.flatMap((section) => section.fields || []);
      const wantsFullRepresentation = isFullRepresentationRequest(req.query.representation);
      const tableName = getTable(passportType);
      // Export needs the full row because stored passport columns may be normalized
      // differently than the schema field keys (for example lowercased identifiers).
      // Limiting the SELECT list here causes many values to disappear before the
      // CSV/JSON-LD serializers have a chance to resolve them.
      const safeColumns = ["*"];

      let statusSql;
      if (statusFilter === "all") {
        statusSql = "";
      } else if (statusFilter === "released") {
        statusSql = ' AND "releaseStatus" = \'released\'';
      } else if (statusFilter === "in_revision") {
        statusSql = ` AND "releaseStatus" IN ${IN_REVISION_STATUSES_SQL}`;
      } else {
        statusSql = ` AND "releaseStatus" IN ${EDITABLE_RELEASE_STATUSES_SQL}`;
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
        res.setHeader("Content-Disposition", `attachment; filename="${passportType}_export.jsonld"`);
        const company = wantsFullRepresentation
          ? await loadCompanySerializationContext(companyId)
          : null;
        const exportRows = wantsFullRepresentation
          ? rows.map((row) => buildExpandedPassportPayload(
              { ...normalizePassportRow(row), passportType },
              typeResult.rows[0],
              {
                company,
                granularity: company?.defaultGranularity || row.granularity || "model",
              }
            ))
          : rows;
        return res.json(buildSemanticPassportJsonExport(exportRows, passportType, {
          semanticModelKey: typeResult.rows[0]?.semanticModelKey || null,
          productCategory: typeResult.rows[0]?.productCategory || null,
        }));
      }

      const escapeCell = (value) => {
        const stringValue = Array.isArray(value) || (typeof value === "object" && value !== null)
          ? JSON.stringify(value)
          : String(value ?? "");
        return `"${stringValue.replace(/"/g, '""')}"`;
      };

      const fieldRows = [
        ["dppId", ...rows.map((row) => row.dppId)],
        ["modelName", ...rows.map((row) => row.modelName || "")],
        ["internalAliasId", ...rows.map((row) => row.internalAliasId || "")],
        ["releaseStatus", ...rows.map((row) => row.releaseStatus || "")],
        ...schemaFields.map((field) => [field.label || field.key, ...rows.map((row) => getPassportFieldValue(row, field.key) ?? "")]),
      ];

      const headerRow = ["Field Name", ...rows.map((_, index) => `Passport ${index + 1}`)];
      const csvLines = [headerRow, ...fieldRows].map((row) => row.map(escapeCell).join(","));

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${passportType}_export.csv"`);
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

      let query = `SELECT pa.*, u.email AS "archivedByEmail", u."firstName" AS "archivedByFirstName", u."lastName" AS "archivedByLastName"
                   FROM passport_archives pa
               LEFT JOIN users u ON u.id = pa."archivedBy"
               WHERE pa."companyId" = $1
                 AND ${ARCHIVED_HISTORY_FILTER_SQL}`;
      const params = [companyId];
      let index = 2;

      if (passportType) {
        query += ` AND pa."passportType" = $${index++}`;
        params.push(passportType);
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
          public_version."versionNumber" AS "publicVersionNumber"
        FROM (${query}) sub
        LEFT JOIN passport_history_visibility phv
          ON phv."passportDppId" = sub."dppId"
         AND phv."versionNumber" = sub."versionNumber"
        LEFT JOIN LATERAL (
          SELECT pa_public."versionNumber"
          FROM passport_archives pa_public
          LEFT JOIN passport_history_visibility phv_public
            ON phv_public."passportDppId" = pa_public."dppId"
           AND phv_public."versionNumber" = pa_public."versionNumber"
          WHERE pa_public."lineageId" = sub."lineageId"
            AND pa_public."companyId" = sub."companyId"
            AND ${ARCHIVED_HISTORY_FILTER_SQL.replaceAll("\"snapshotReason\"", "pa_public.\"snapshotReason\"")}
            AND pa_public."releaseStatus" IN ('released', 'obsolete')
            AND COALESCE(phv_public."isPublic", true) = true
          ORDER BY pa_public."versionNumber" DESC, pa_public."archivedAt" DESC
          LIMIT 1
        ) public_version ON true
        ORDER BY sub."lineageId", sub."versionNumber" DESC, sub."archivedAt" DESC
      `;

      const result = await pool.query(query, params);
      res.json(result.rows);
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

      const resolved = await fetchCompanyPassportRecord({ companyId, dppId, passportType, versionNumber });
      if (!resolved?.passport) return res.status(404).json({ error: "Passport not found" });

      // Get passport type schema for normalization
      const typeDef = await pool.query(
        `SELECT "typeName" AS "typeName", "productCategory" AS "productCategory", "semanticModelKey" AS "semanticModelKey", "fieldsJson" AS "fieldsJson"
         FROM passport_types
         WHERE "typeName" = $1
         LIMIT 1`,
        [resolved.passport.passportType || passportType]
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

      const resolved = await fetchCompanyPassportRecord({ companyId, dppId, passportType });
      if (!resolved?.passport) return res.status(404).json({ error: "Passport not found" });

      const compliance = await complianceService.evaluatePassport(resolved.passport, passportType);
      res.json(compliance);
    } catch (error) {
      logger.error("Compliance fetch error:", error.message);
      res.status(500).json({ error: "Failed to evaluate passport compliance" });
    }
  });
};
