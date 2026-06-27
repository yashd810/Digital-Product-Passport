"use strict";

const { mapPassportTypeRow } = require("../../shared/passports/passport-helpers");

module.exports = function registerApiKeyRoutes(app, deps) {
  const {
    pool,
    logger,
    authenticateToken,
    checkCompanyAdmin,
    logAudit,
    buildApiKeyHashRecord,
    buildSecurityGroupApiKeyScopes,
    getTable,
    isRestrictedField,
    normalizePassportRow,
    replicateAccessControlEventToBackup,
  } = deps;

  function normalizeScopeType(value) {
    return String(value || "passportType").trim() === "passports" ? "passports" : "passportType";
  }

  function normalizeStringList(values) {
    return Array.isArray(values)
      ? [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
      : [];
  }

  function flattenRestrictedFields(typeDef) {
    return (typeDef?.fieldsJson?.sections || [])
      .flatMap((section) => (section.fields || []).map((field) => ({
        ...field,
        sectionKey: section.key || null,
        sectionLabel: section.label || section.key || null,
      })))
      .filter((field) => field?.key && isRestrictedField(field));
  }

  function mapApiKeyRow(row) {
    return {
      id: row.id,
      name: row.name ?? null,
      keyPrefix: row.keyPrefix ?? null,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
      passportType: row.passportType ?? null,
      scopeType: row.scopeType ?? "passportType",
      fieldKeys: Array.isArray(row.fieldKeys) ? row.fieldKeys : [],
      passportDppIds: Array.isArray(row.passportDppIds) ? row.passportDppIds : [],
      expiresAt: row.expiresAt ?? null,
      createdAt: row.createdAt ?? null,
      lastUsedAt: row.lastUsedAt ?? null,
      isActive: row.isActive ?? null,
    };
  }

  async function loadCompanyPassportType(companyId, passportType) {
    const result = await pool.query(
      `SELECT pt.id,
              pt."typeName" AS "typeName",
              pt."displayName" AS "displayName",
              pt."productCategory" AS "productCategory",
              pt."productIcon" AS "productIcon",
              pt."semanticModelKey" AS "semanticModelKey",
              pt."fieldsJson" AS "fieldsJson"
       FROM "passportTypes" pt
       JOIN "companyPassportAccess" cpa
         ON cpa."passportTypeId" = pt.id
        AND cpa."companyId" = $1
        AND cpa."accessRevoked" = false
       WHERE pt."typeName" = $2
         AND pt."isActive" = true
       LIMIT 1`,
      [companyId, passportType]
    );
    return result.rows[0] ? mapPassportTypeRow(result.rows[0]) : null;
  }

  async function validateSelectedPassports({ companyId, passportType, passportDppIds }) {
    const selected = normalizeStringList(passportDppIds);
    if (!selected.length) return [];

    const tableName = getTable(passportType);
    const registry = await pool.query(
      `SELECT DISTINCT "dppId"
       FROM ${tableName}
       WHERE "companyId" = $1
         AND "dppId" = ANY($2::text[])
         AND "deletedAt" IS NULL`,
      [companyId, selected]
    );
    const found = new Set(registry.rows.map((row) => String(row.dppId || "")));
    const missing = selected.filter((dppId) => !found.has(dppId));
    if (missing.length) {
      const error = new Error("One or more selected passports were not found for this company and passport type");
      error.statusCode = 400;
      error.details = { passportDppIds: missing };
      throw error;
    }
    return selected;
  }

  app.get("/api/companies/:companyId/api-keys", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id,
                name,
                "keyPrefix" AS "keyPrefix",
                scopes,
                "passportType" AS "passportType",
                "scopeType" AS "scopeType",
                "fieldKeys" AS "fieldKeys",
                "passportDppIds" AS "passportDppIds",
                "expiresAt" AS "expiresAt",
                "createdAt" AS "createdAt",
                "lastUsedAt" AS "lastUsedAt",
                "isActive" AS "isActive"
         FROM "apiKeys"
         WHERE "companyId" = $1
         ORDER BY "createdAt" DESC`,
        [req.params.companyId]
      );
      res.json(result.rows.map(mapApiKeyRow));
    } catch (error) {
      logger.error("Fetch security groups error:", error.message);
      res.status(500).json({ error: "Failed to fetch security groups" });
    }
  });

  app.get("/api/companies/:companyId/api-keys/passport-type/:passportType/passports", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const typeDef = await loadCompanyPassportType(req.params.companyId, req.params.passportType);
      if (!typeDef) return res.status(404).json({ error: "Passport type not found for this company" });
      const tableName = getTable(typeDef.typeName);
      const result = await pool.query(
        `SELECT "dppId",
                "internalAliasId",
                "modelName",
                "releaseStatus",
                "versionNumber",
                "updatedAt"
         FROM ${tableName}
         WHERE "companyId" = $1
           AND "deletedAt" IS NULL
         ORDER BY "updatedAt" DESC
         LIMIT 500`,
        [req.params.companyId]
      );
      res.json(result.rows.map((row) => ({
        ...normalizePassportRow(row, typeDef),
        passportType: typeDef.typeName,
      })));
    } catch (error) {
      logger.error("Fetch security group passports error:", error.message);
      res.status(500).json({ error: "Failed to fetch passports for security group" });
    }
  });

  app.post("/api/companies/:companyId/api-keys", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const {
        name,
        expiresAt,
        passportType,
        scopeType,
        fieldKeys,
        passportDppIds,
      } = req.body || {};

      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: "name is required" });
      }
      const normalizedName = String(name).trim();
      if (normalizedName.length > 100) {
        return res.status(400).json({ error: "name must be 100 characters or fewer" });
      }
      if (!passportType || !String(passportType).trim()) {
        return res.status(400).json({ error: "passportType is required" });
      }

      const typeDef = await loadCompanyPassportType(req.params.companyId, passportType);
      if (!typeDef) return res.status(404).json({ error: "Passport type not found for this company" });

      const restrictedFields = flattenRestrictedFields(typeDef);
      const restrictedFieldKeys = new Set(restrictedFields.map((field) => field.key));
      const selectedFieldKeys = normalizeStringList(fieldKeys);
      if (!selectedFieldKeys.length) {
        return res.status(400).json({ error: "Select at least one restricted field" });
      }
      const invalidFieldKeys = selectedFieldKeys.filter((key) => !restrictedFieldKeys.has(key));
      if (invalidFieldKeys.length) {
        return res.status(400).json({
          error: "Selected fields must be restricted fields on this passport type",
          fields: invalidFieldKeys,
        });
      }

      const parsedScopeType = normalizeScopeType(scopeType);
      const selectedPassportDppIds = parsedScopeType === "passports"
        ? await validateSelectedPassports({
            companyId: req.params.companyId,
            passportType: typeDef.typeName,
            passportDppIds,
          })
        : [];
      if (parsedScopeType === "passports" && !selectedPassportDppIds.length) {
        return res.status(400).json({ error: "Select at least one passport for a unique-passport security group" });
      }

      const resolvedExpiry = expiresAt || null;
      const expiresAtValue = resolvedExpiry ? new Date(resolvedExpiry) : null;
      if (expiresAtValue && Number.isNaN(expiresAtValue.getTime())) {
        return res.status(400).json({ error: "expiresAt must be a valid ISO timestamp" });
      }
      if (expiresAtValue && expiresAtValue <= new Date()) {
        return res.status(400).json({ error: "expiresAt must be in the future" });
      }

      const count = await pool.query(
        "SELECT COUNT(*) FROM \"apiKeys\" WHERE \"companyId\" = $1 AND \"isActive\" = true",
        [req.params.companyId]
      );
      if (parseInt(count.rows[0].count, 10) >= 100) {
        return res.status(400).json({ error: "Maximum of 100 active security groups per company" });
      }

      const rawKey = `dppSg${require("crypto").randomBytes(24).toString("hex")}`;
      const keyRecord = buildApiKeyHashRecord(rawKey);
      const scopes = buildSecurityGroupApiKeyScopes(["dpp:read", "dpp:restricted:read"]);

      const result = await pool.query(
        `INSERT INTO "apiKeys" (
           "companyId",
           name,
           "keyHash",
           "keyPrefix",
           "keySalt",
           "hashAlgorithm",
           scopes,
           "passportType",
           "scopeType",
           "fieldKeys",
           "passportDppIds",
           "expiresAt",
           "createdBy"
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id,
                   name,
                   "keyPrefix" AS "keyPrefix",
                   scopes,
                   "passportType" AS "passportType",
                   "scopeType" AS "scopeType",
                   "fieldKeys" AS "fieldKeys",
                   "passportDppIds" AS "passportDppIds",
                   "expiresAt" AS "expiresAt",
                   "createdAt" AS "createdAt",
                   "isActive" AS "isActive"`,
        [
          req.params.companyId,
          normalizedName,
          keyRecord.keyHash,
          keyRecord.keyPrefix,
          keyRecord.keySalt,
          keyRecord.hashAlgorithm,
          scopes,
          typeDef.typeName,
          parsedScopeType,
          selectedFieldKeys,
          selectedPassportDppIds,
          expiresAtValue,
          req.user.userId,
        ]
      );

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "createSecurityGroup",
        "apiKeys",
        String(result.rows[0].id),
        null,
        {
          name: normalizedName,
          passportType: typeDef.typeName,
          scopeType: parsedScopeType,
          fieldKeys: selectedFieldKeys,
          passportDppIds: selectedPassportDppIds,
        },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
          audience: "companyAdmin",
        }
      );

      res.status(201).json({ ...mapApiKeyRow(result.rows[0]), key: rawKey });
    } catch (error) {
      logger.error("Create security group error:", error.message);
      res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Failed to create security group" });
    }
  });

  async function revokeApiKey(req, res, { emergency = false } = {}) {
    const reason = req.body?.reason || (emergency ? "Emergency security group API key revocation" : "Security group API key revoked");
    const result = await pool.query(
      `UPDATE "apiKeys"
       SET "isActive" = false,
           "expiresAt" = CASE WHEN $3::boolean THEN NOW() ELSE "expiresAt" END,
           "updatedAt" = NOW()
       WHERE id = $1 AND "companyId" = $2
       RETURNING id,
                 "companyId" AS "companyId",
                 name,
                 scopes,
                 "passportType" AS "passportType",
                 "scopeType" AS "scopeType",
                 "fieldKeys" AS "fieldKeys",
                 "passportDppIds" AS "passportDppIds",
                 "expiresAt" AS "expiresAt",
                 "isActive" AS "isActive"`,
      [req.params.keyId, req.params.companyId, emergency]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Security group not found" });

    await logAudit(
      req.params.companyId,
      req.user.userId,
      emergency ? "emergencyRevokeSecurityGroup" : "revokeSecurityGroup",
      "apiKeys",
      String(req.params.keyId),
      result.rows[0],
      { revoked: true, emergency, reason },
      {
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        audience: "companyAdmin",
      }
    );

    await replicateAccessControlEventToBackup({
      companyId: req.params.companyId,
      eventType: emergency ? "apiKeyEmergencyRevoked" : "apiKeyRevoked",
      severity: emergency ? "critical" : "high",
      actorUserId: req.user.userId,
      actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
      affectedApiKeyId: req.params.keyId,
      revocationMode: emergency ? "emergency" : "standard",
      reason,
      metadata: {
        scopes: result.rows[0].scopes || [],
        keyName: result.rows[0].name || null,
        passportType: result.rows[0].passportType || null,
        scopeType: result.rows[0].scopeType || null,
      },
    }).catch((error) => {
      logger.warn({ err: error, companyId: req.params.companyId, apiKeyId: req.params.keyId }, "Failed to replicate security group revocation event");
    });

    return res.json({
      success: true,
      revoked: true,
      emergency,
      apiKey: mapApiKeyRow(result.rows[0]),
    });
  }

  app.delete("/api/companies/:companyId/api-keys/:keyId", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      await revokeApiKey(req, res);
    } catch (error) {
      logger.error("Revoke security group error:", error.message);
      res.status(500).json({ error: "Failed to revoke security group" });
    }
  });

  app.post("/api/companies/:companyId/api-keys/:keyId/revoke", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      await revokeApiKey(req, res);
    } catch (error) {
      logger.error("Revoke security group error:", error.message);
      res.status(500).json({ error: "Failed to revoke security group" });
    }
  });

  app.post("/api/companies/:companyId/api-keys/:keyId/emergency-revoke", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      await revokeApiKey(req, res, { emergency: true });
    } catch (error) {
      logger.error("Emergency revoke security group error:", error.message);
      res.status(500).json({ error: "Failed to emergency-revoke security group" });
    }
  });
};
