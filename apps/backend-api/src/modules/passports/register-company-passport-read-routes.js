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
    buildBatteryPassJsonExport,
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
      let query = `SELECT p.*, u.email AS created_by_email, u.first_name, u.last_name
               FROM ${tableName} p
               LEFT JOIN users u ON u.id = p.created_by
               WHERE p.deleted_at IS NULL AND p.company_id = $1`;
      const params = [companyId];
      let index = 2;

      if (status) {
        const normalizedStatus = normalizeReleaseStatus(status);
        if (normalizedStatus === IN_REVISION_STATUS) {
          query += ` AND p.release_status IN ${IN_REVISION_STATUSES_SQL}`;
        } else {
          query += ` AND p.release_status = $${index++}`;
          params.push(normalizedStatus);
        }
      }
      if (search) {
        query += ` AND (p.model_name ILIKE $${index} OR p.internal_alias_id ILIKE $${index} OR p.product_identifier_did ILIKE $${index})`;
        params.push(`%${search}%`);
        index += 1;
      }
      query += " ORDER BY p.lineage_id, p.version_number DESC";

      const result = await pool.query(query, params);
      res.json(result.rows.map((row) => ({ ...normalizePassportRow(row, typeSchema), passport_type: passportType })));
    } catch {
      res.status(500).json({ error: "Failed to fetch passports" });
    }
  });

  app.post("/api/companies/:companyId/passports/bulk-fetch", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      let passport_type;
      let identifiers;
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
        const raw = typeof item === "string" ? { internal_alias_id: item } : item || {};
        const dppId = raw.dppId;
        const internalAliasId = normalizeInternalAliasIdValue(raw.internal_alias_id || raw.internalAliasId);
        try {
          let row = null;
          if (dppId) {
            const result = await pool.query(
              `SELECT p.*, u.email AS created_by_email, u.first_name, u.last_name
               FROM ${tableName} p LEFT JOIN users u ON u.id = p.created_by
               WHERE p.dpp_id = $1 AND p.company_id = $2 AND p.deleted_at IS NULL LIMIT 1`,
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
                 SELECT DISTINCT ON (lineage_id) *
                 FROM ${tableName}
                 WHERE (internal_alias_id = ANY($1::text[]) OR product_identifier_did = ANY($1::text[]))
                   AND company_id = $2
                   AND deleted_at IS NULL
                 ORDER BY lineage_id, version_number DESC, updated_at DESC
               )
               SELECT latest.*, u.email AS created_by_email, u.first_name, u.last_name
               FROM latest LEFT JOIN users u ON u.id = latest.created_by
               ORDER BY latest.version_number DESC LIMIT 1`,
              [productIdCandidates, companyId]
            );
            row = result.rows[0];
          }

          if (row) {
            results.push({ ...normalizePassportRow(row, typeSchema), passport_type: typeSchema.typeName, _status: "found" });
          } else {
            results.push({ dppId: dppId || undefined, internal_alias_id: internalAliasId || undefined, _status: "not_found" });
          }
        } catch (error) {
          results.push({ dppId: dppId || undefined, internal_alias_id: internalAliasId || undefined, _status: "error", error: error.message });
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
        "SELECT fields_json, product_category, semantic_model_key FROM passport_types WHERE type_name=$1",
        [passportType]
      );
      if (!typeResult.rows.length) return res.status(404).json({ error: "Passport type not found" });

      const sections = typeResult.rows[0]?.fields_json?.sections || [];
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
        statusSql = " AND release_status = 'released'";
      } else if (statusFilter === "in_revision") {
        statusSql = ` AND release_status IN ${IN_REVISION_STATUSES_SQL}`;
      } else {
        statusSql = ` AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}`;
      }

      const passportResult = await pool.query(
        `SELECT ${safeColumns.join(", ")} FROM ${tableName}
         WHERE company_id=$1${statusSql} AND deleted_at IS NULL
         ORDER BY created_at DESC`,
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
              { ...normalizePassportRow(row), passport_type: passportType },
              typeResult.rows[0],
              {
                company,
                granularity: company?.default_granularity || row.granularity || "model",
              }
            ))
          : rows;
        return res.json(buildBatteryPassJsonExport(exportRows, passportType, {
          semanticModelKey: typeResult.rows[0]?.semantic_model_key || null,
          productCategory: typeResult.rows[0]?.product_category || null,
        }));
      }

      const escapeCell = (value) => {
        const stringValue = Array.isArray(value) || (typeof value === "object" && value !== null)
          ? JSON.stringify(value)
          : String(value ?? "");
        return `"${stringValue.replace(/"/g, '""')}"`;
      };

      const fieldRows = [
        ["dppId", ...rows.map((row) => row.dpp_id)],
        ["model_name", ...rows.map((row) => row.model_name || "")],
        ["internal_alias_id", ...rows.map((row) => row.internal_alias_id || "")],
        ["release_status", ...rows.map((row) => row.release_status || "")],
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

      let query = `SELECT pa.*, u.email AS archived_by_email, u.first_name AS archived_by_first_name, u.last_name AS archived_by_last_name
               FROM passport_archives pa
               LEFT JOIN users u ON u.id = pa.archived_by
               WHERE pa.company_id = $1
                 AND ${ARCHIVED_HISTORY_FILTER_SQL}`;
      const params = [companyId];
      let index = 2;

      if (passportType) {
        query += ` AND pa.passport_type = $${index++}`;
        params.push(passportType);
      }
      if (search) {
        query += ` AND (pa.model_name ILIKE $${index} OR pa.internal_alias_id ILIKE $${index} OR pa.product_identifier_did ILIKE $${index} OR pa.dpp_id::text ILIKE $${index})`;
        params.push(`%${search}%`);
        index += 1;
      }

      query = `
        SELECT
          sub.*,
          COALESCE(phv.is_public, sub.release_status IN ('released', 'obsolete')) AS is_public,
          public_version.version_number AS public_version_number
        FROM (${query}) sub
        LEFT JOIN passport_history_visibility phv
          ON phv.passport_dpp_id = sub.dpp_id
         AND phv.version_number = sub.version_number
        LEFT JOIN LATERAL (
          SELECT pa_public.version_number
          FROM passport_archives pa_public
          LEFT JOIN passport_history_visibility phv_public
            ON phv_public.passport_dpp_id = pa_public.dpp_id
           AND phv_public.version_number = pa_public.version_number
          WHERE pa_public.lineage_id = sub.lineage_id
            AND pa_public.company_id = sub.company_id
            AND ${ARCHIVED_HISTORY_FILTER_SQL.replaceAll("snapshot_reason", "pa_public.snapshot_reason")}
            AND pa_public.release_status IN ('released', 'obsolete')
            AND COALESCE(phv_public.is_public, true) = true
          ORDER BY pa_public.version_number DESC, pa_public.archived_at DESC
          LIMIT 1
        ) public_version ON true
        ORDER BY sub.lineage_id, sub.version_number DESC, sub.archived_at DESC
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
        `SELECT type_name, product_category, semantic_model_key, fields_json
         FROM passport_types
         WHERE type_name = $1
         LIMIT 1`,
        [resolved.passport.passport_type || passportType]
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
            granularity: company?.default_granularity || normalizedPassport.granularity || "model",
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
