function registerPublicApiV1Routes(app, deps) {
  const {
    pool,
    logger,
    authenticateApiKey,
    requireApiKeyScope,
    apiKeyReadRateLimit,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    getTable,
    normalizePassportRow,
    sanitizePassportForApiKey,
    flattenTypeFields,
    buildApiKeyFieldWriteDecision,
    archivePassportSnapshot,
    updatePassportRowById,
    logAudit,
    EDITABLE_RELEASE_STATUSES_SQL,
  } = deps;

  app.use("/api/v1", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-API-Key, Content-Type");
    res.header("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/api/v1/passports", authenticateApiKey, requireApiKeyScope("dpp:read"), apiKeyReadRateLimit, async (req, res) => {
    try {
      const { type, status, search, limit = "100", offset = "0" } = req.query;
      if (!type) return res.status(400).json({ error: "'type' query parameter is required" });

      const companyId = req.apiKey.companyId;
      const typeSchema = await getPassportTypeSchema(type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);
      const cap = Math.min(parseInt(limit, 10) || 100, 500);
      const off = Math.max(parseInt(offset, 10) || 0, 0);

      let q = `
        WITH latest AS (
          SELECT DISTINCT ON ("lineageId") *
          FROM ${tableName}
          WHERE "deletedAt" IS NULL AND "companyId" = $1
          ORDER BY "lineageId", "versionNumber" DESC, "updatedAt" DESC
        )
        SELECT * FROM latest WHERE 1=1
      `;
      const params = [companyId];
      let i = 2;
      if (status) {
        q += ` AND "releaseStatus" = $${i++}`;
        params.push(status);
      }
      if (search) {
        q += ` AND ("modelName" ILIKE $${i} OR "internalAliasId" ILIKE $${i} OR "uniqueProductIdentifier" ILIKE $${i})`;
        params.push(`%${search}%`);
        i++;
      }
      q += ` ORDER BY "createdAt" DESC LIMIT $${i++} OFFSET $${i++}`;
      params.push(cap, off);

      const r = await pool.query(q, params);
      res.json({
        passportType: type,
        count: r.rows.length,
        limit: cap,
        offset: off,
        operatorType: req.apiKey.operatorType || "economicOperator",
        accessMode: req.apiKey.accessMode || "read",
        maxConfidentiality: req.apiKey.maxConfidentiality || "regulated",
        passports: r.rows.map((row) => {
          const normalized = { ...normalizePassportRow(row, typeSchema), passportType: typeSchema.typeName };
          return sanitizePassportForApiKey(normalized, typeSchema, req.apiKey);
        }),
      });
    } catch (e) {
      logger.error("API v1 list error:", e.message);
      res.status(e.statusCode || 500).json({ error: e.message || "Failed to fetch passports" });
    }
  });

  app.get("/api/v1/passports/:dppId", authenticateApiKey, requireApiKeyScope("dpp:read"), apiKeyReadRateLimit, async (req, res) => {
    try {
      const { dppId } = req.params;
      const companyId = req.apiKey.companyId;

      const reg = await pool.query(
        "SELECT \"passportType\" FROM \"passportRegistry\" WHERE \"dppId\" = $1 AND \"companyId\" = $2",
        [dppId, companyId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const passportType = reg.rows[0].passportType;
      const typeSchema = await getPassportTypeSchema(passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(passportType);
      const r = await pool.query(
        `SELECT * FROM ${tableName} WHERE "dppId" = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [dppId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
      const normalized = { ...normalizePassportRow(r.rows[0], typeSchema), passportType };
      res.json(sanitizePassportForApiKey(normalized, typeSchema, req.apiKey));
    } catch (e) {
      logger.error("API v1 get error:", e.message);
      res.status(e.statusCode || 500).json({ error: e.message || "Failed to fetch passport" });
    }
  });

  app.patch("/api/v1/passports/:dppId", authenticateApiKey, requireApiKeyScope("dpp:update"), async (req, res) => {
    try {
      const dppId = String(req.params.dppId || "").trim();
      if (!dppId) return res.status(400).json({ error: "dppId is required" });

      const normalizedBody = normalizePassportRequestBody(req.body);
      const { passportType, carrierAuthenticity, granularity, ...fields } = normalizedBody;
      void passportType;
      void carrierAuthenticity;
      void granularity;

      const companyId = req.apiKey.companyId;
      const reg = await pool.query(
        "SELECT \"passportType\" FROM \"passportRegistry\" WHERE \"dppId\" = $1 AND \"companyId\" = $2",
        [dppId, companyId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const resolvedPassportType = reg.rows[0].passportType;
      const typeSchema = await getPassportTypeSchema(resolvedPassportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(resolvedPassportType);
      const current = await pool.query(
        `SELECT * FROM ${tableName}
         WHERE "dppId" = $1 AND "releaseStatus" IN ${EDITABLE_RELEASE_STATUSES_SQL} AND "deletedAt" IS NULL
         LIMIT 1`,
        [dppId]
      );
      if (!current.rows.length) {
        return res.status(404).json({ error: "Passport not found or not editable." });
      }

      const schemaFields = flattenTypeFields(typeSchema);
      const schemaFieldsByKey = new Map(schemaFields.map((field) => [field.key, field]));
      const incomingFieldKeys = Object.keys(fields);
      if (!incomingFieldKeys.length) return res.status(400).json({ error: "No fields to update" });

      const invalidFieldKeys = incomingFieldKeys.filter((key) => !schemaFieldsByKey.has(key));
      if (invalidFieldKeys.length) {
        return res.status(400).json({ error: "Unknown or unsupported field(s) in request body", fields: invalidFieldKeys });
      }

      const forbiddenFields = [];
      for (const key of incomingFieldKeys) {
        const fieldDef = schemaFieldsByKey.get(key);
        const decision = buildApiKeyFieldWriteDecision(fieldDef, req.apiKey);
        if (!decision.allowed) {
          forbiddenFields.push({
            key,
            label: fieldDef?.label || key,
            confidentiality: decision.confidentiality,
            updateAuthority: decision.updateAuthority,
          });
        }
      }
      if (forbiddenFields.length) {
        return res.status(403).json({
          error: "API key is not allowed to update one or more fields",
          fields: forbiddenFields,
        });
      }

      await archivePassportSnapshot({
        passport: current.rows[0],
        passportType: resolvedPassportType,
        archivedBy: null,
        actorIdentifier: `apiKey:${req.apiKey.keyId}`,
        snapshotReason: "beforeApiKeyUpdate",
      });

      const updateResult = await updatePassportRowById({
        tableName,
        rowId: current.rows[0].id,
        userId: null,
        data: fields,
        includeUpdatedRow: true,
      });
      const updateFields = updateResult.updateCols || [];
      if (!updateFields.length) return res.status(400).json({ error: "No fields to update" });

      if (updateResult.updatedRow) {
        await archivePassportSnapshot({
          passport: updateResult.updatedRow,
          passportType: resolvedPassportType,
          archivedBy: null,
          actorIdentifier: `apiKey:${req.apiKey.keyId}`,
          snapshotReason: "afterApiKeyUpdate",
        });
      }

      await logAudit(
        companyId,
        null,
        "UPDATE_VIA_API_KEY",
        tableName,
        dppId,
        null,
        {
          fieldsUpdated: updateFields,
          apiKeyId: req.apiKey.keyId,
          operatorType: req.apiKey.operatorType || "economicOperator",
          accessMode: req.apiKey.accessMode || "update",
        },
        {
          actorIdentifier: `apiKey:${req.apiKey.keyId}`,
          audience: req.apiKey.operatorType || "economicOperator",
        }
      );

      const responsePassport = sanitizePassportForApiKey(
        { ...normalizePassportRow(updateResult.updatedRow || { ...current.rows[0], ...fields }, typeSchema), passportType: resolvedPassportType },
        typeSchema,
        req.apiKey
      );
      res.json({
        success: true,
        updatedFields: updateFields,
        passport: responsePassport,
      });
    } catch (e) {
      logger.error("API v1 patch error:", e.message);
      res.status(500).json({ error: "Failed to update passport" });
    }
  });
}

module.exports = registerPublicApiV1Routes;
