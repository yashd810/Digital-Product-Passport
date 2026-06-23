"use strict";

module.exports = function registerApiKeyRoutes(app, deps) {
  const {
    pool,
    logger,
    authenticateToken,
    checkCompanyAdmin,
    logAudit,
    buildApiKeyHashRecord,
    buildApiKeyScopesForAccessMode,
    parseApiKeyAccessMode,
    parseApiKeyOperatorType,
    parseApiKeyMaxConfidentiality,
    replicateAccessControlEventToBackup,
  } = deps;

  function mapApiKeyRow(row) {
    return {
      id: row.id,
      name: row.name ?? null,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
      keyPrefix: row.keyPrefix ?? null,
      operatorType: row.operatorType ?? null,
      accessMode: row.accessMode ?? null,
      maxConfidentiality: row.maxConfidentiality ?? null,
      expiresAt: row.expiresAt ?? null,
      createdAt: row.createdAt ?? null,
      lastUsedAt: row.lastUsedAt ?? null,
      isActive: row.isActive ?? null,
    };
  }

  app.get("/api/companies/:companyId/api-keys", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, name, "keyPrefix" AS "keyPrefix", scopes, "operatorType" AS "operatorType", "accessMode" AS "accessMode", "maxConfidentiality" AS "maxConfidentiality",
                "expiresAt" AS "expiresAt", "createdAt" AS "createdAt", "lastUsedAt" AS "lastUsedAt", "isActive" AS "isActive"
         FROM "apiKeys" WHERE "companyId" = $1 ORDER BY "createdAt" DESC`,
        [req.params.companyId]
      );
      res.json(result.rows.map(mapApiKeyRow));
    } catch {
      res.status(500).json({ error: "Failed to fetch API keys" });
    }
  });

  app.post("/api/companies/:companyId/api-keys", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const {
        name,
        scopes,
        expiresAt,
        operatorType,
        accessMode,
        maxConfidentiality,
      } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: "name is required" });
      }

      const requestedScopes = Array.isArray(scopes) ? scopes : [];
      const parsedAccessMode = parseApiKeyAccessMode(accessMode, requestedScopes);
      const parsedScopes = buildApiKeyScopesForAccessMode(parsedAccessMode, requestedScopes);
      const parsedOperatorType = parseApiKeyOperatorType(operatorType);
      const parsedMaxConfidentiality = parseApiKeyMaxConfidentiality(maxConfidentiality);
      const resolvedExpiry = expiresAt || null;
      const expiresAtValue = resolvedExpiry ? new Date(resolvedExpiry) : null;
      if (expiresAtValue && Number.isNaN(expiresAtValue.getTime())) {
        return res.status(400).json({ error: "expiresAt must be a valid ISO timestamp" });
      }

      const count = await pool.query(
        "SELECT COUNT(*) FROM \"apiKeys\" WHERE \"companyId\" = $1 AND \"isActive\" = true",
        [req.params.companyId]
      );
      if (parseInt(count.rows[0].count, 10) >= 10) {
        return res.status(400).json({ error: "Maximum of 10 active API keys per company" });
      }

      const rawKey = `dpp_${require("crypto").randomBytes(20).toString("hex")}`;
      const keyRecord = buildApiKeyHashRecord(rawKey);

      const result = await pool.query(
        `INSERT INTO "apiKeys" (
           "companyId", name, "keyHash", "keyPrefix", "keySalt", "hashAlgorithm", scopes,
           "operatorType", "accessMode", "maxConfidentiality", "expiresAt", "createdBy"
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, name, "keyPrefix" AS "keyPrefix", scopes, "operatorType" AS "operatorType", "accessMode" AS "accessMode", "maxConfidentiality" AS "maxConfidentiality", "expiresAt" AS "expiresAt", "createdAt" AS "createdAt"`,
        [
          req.params.companyId,
          name.trim(),
          keyRecord.keyHash,
          keyRecord.keyPrefix,
          keyRecord.keySalt,
          keyRecord.hashAlgorithm,
          parsedScopes,
          parsedOperatorType,
          parsedAccessMode,
          parsedMaxConfidentiality,
          expiresAtValue,
          req.user.userId,
        ]
      );

      res.status(201).json({ ...mapApiKeyRow(result.rows[0]), key: rawKey });
    } catch (error) {
      logger.error("Create API key error:", error.message);
      res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Failed to create API key" });
    }
  });

  app.delete("/api/companies/:companyId/api-keys/:keyId", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        'UPDATE "apiKeys" SET "isActive" = false, "updatedAt" = NOW() WHERE id = $1 AND "companyId" = $2 RETURNING id, "companyId" AS "companyId", name, scopes, "operatorType" AS "operatorType", "accessMode" AS "accessMode", "maxConfidentiality" AS "maxConfidentiality", "expiresAt" AS "expiresAt", "isActive" AS "isActive"',
        [req.params.keyId, req.params.companyId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Key not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REVOKE_API_KEY",
        "apiKeys",
        String(req.params.keyId),
        result.rows[0],
        { revoked: true },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
          audience: "companyAdmin",
        }
      );

      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "API_KEY_REVOKED",
        severity: "high",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedApiKeyId: req.params.keyId,
        revocationMode: "standard",
        metadata: {
          scopes: result.rows[0].scopes || [],
          keyName: result.rows[0].name || null,
        },
      }).catch((error) => {
        logger.warn({ err: error, companyId: req.params.companyId, apiKeyId: req.params.keyId }, "Failed to replicate API key revocation event");
      });

      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to revoke API key" });
    }
  });

  app.post("/api/companies/:companyId/api-keys/:keyId/revoke", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const reason = req.body?.reason || "API key access revoked";
      const result = await pool.query(
        `UPDATE "apiKeys"
         SET "isActive" = false,
             "updatedAt" = NOW()
         WHERE id = $1 AND "companyId" = $2
         RETURNING id, "companyId" AS "companyId", name, scopes, "operatorType" AS "operatorType", "accessMode" AS "accessMode", "maxConfidentiality" AS "maxConfidentiality", "expiresAt" AS "expiresAt", "isActive" AS "isActive"`,
        [req.params.keyId, req.params.companyId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Key not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REVOKE_API_KEY",
        "apiKeys",
        String(req.params.keyId),
        result.rows[0],
        { revoked: true, reason },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
          audience: "companyAdmin",
        }
      );

      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "API_KEY_REVOKED",
        severity: "high",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedApiKeyId: req.params.keyId,
        revocationMode: "standard",
        reason,
        metadata: {
          scopes: result.rows[0].scopes || [],
          keyName: result.rows[0].name || null,
        },
      }).catch((error) => {
        logger.warn({ err: error, companyId: req.params.companyId, apiKeyId: req.params.keyId }, "Failed to replicate API key revocation event");
      });

      res.json({ success: true, revoked: true, emergency: false, apiKey: result.rows[0] });
    } catch {
      res.status(500).json({ error: "Failed to revoke API key" });
    }
  });

  app.post("/api/companies/:companyId/api-keys/:keyId/emergency-revoke", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const reason = req.body?.reason || "Emergency API key revocation";
      const effectiveAt = new Date().toISOString();
      const result = await pool.query(
        `UPDATE "apiKeys"
         SET "isActive" = false,
             "expiresAt" = NOW(),
             "updatedAt" = NOW()
         WHERE id = $1 AND "companyId" = $2
         RETURNING id, "companyId" AS "companyId", name, scopes, "operatorType" AS "operatorType", "accessMode" AS "accessMode", "maxConfidentiality" AS "maxConfidentiality", "expiresAt" AS "expiresAt", "isActive" AS "isActive"`,
        [req.params.keyId, req.params.companyId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Key not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "EMERGENCY_REVOKE_API_KEY",
        "apiKeys",
        String(req.params.keyId),
        result.rows[0],
        { revoked: true, emergency: true, reason, effectiveAt },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
          audience: "companyAdmin",
        }
      );

      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "API_KEY_EMERGENCY_REVOKED",
        severity: "critical",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedApiKeyId: req.params.keyId,
        revocationMode: "emergency",
        reason,
        metadata: {
          effectiveAt,
          scopes: result.rows[0].scopes || [],
          keyName: result.rows[0].name || null,
        },
      }).catch((error) => {
        logger.warn({ err: error, companyId: req.params.companyId, apiKeyId: req.params.keyId }, "Failed to replicate emergency API key revocation event");
      });

      res.json({
        success: true,
        revoked: true,
        emergency: true,
        effectiveAt,
        apiKey: result.rows[0],
      });
    } catch {
      res.status(500).json({ error: "Failed to emergency-revoke API key" });
    }
  });
};
