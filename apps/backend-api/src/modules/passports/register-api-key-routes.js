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

  app.get("/api/companies/:companyId/api-keys", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, name, key_prefix, scopes, operator_type, access_mode, max_confidentiality,
                expires_at, created_at, last_used_at, is_active
         FROM api_keys WHERE company_id = $1 ORDER BY created_at DESC`,
        [req.params.companyId]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch API keys" });
    }
  });

  app.post("/api/companies/:companyId/api-keys", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const {
        name,
        scopes,
        expires_at,
        expiresAt,
        operator_type,
        operatorType,
        access_mode,
        accessMode,
        max_confidentiality,
        maxConfidentiality,
      } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: "name is required" });
      }

      const requestedScopes = Array.isArray(scopes) ? scopes : [];
      const parsedAccessMode = parseApiKeyAccessMode(access_mode || accessMode, requestedScopes);
      const parsedScopes = buildApiKeyScopesForAccessMode(parsedAccessMode, requestedScopes);
      const parsedOperatorType = parseApiKeyOperatorType(operator_type || operatorType);
      const parsedMaxConfidentiality = parseApiKeyMaxConfidentiality(max_confidentiality || maxConfidentiality);
      const resolvedExpiry = expires_at || expiresAt || null;
      const expiresAtValue = resolvedExpiry ? new Date(resolvedExpiry) : null;
      if (expiresAtValue && Number.isNaN(expiresAtValue.getTime())) {
        return res.status(400).json({ error: "expires_at must be a valid ISO timestamp" });
      }

      const count = await pool.query(
        "SELECT COUNT(*) FROM api_keys WHERE company_id = $1 AND is_active = true",
        [req.params.companyId]
      );
      if (parseInt(count.rows[0].count, 10) >= 10) {
        return res.status(400).json({ error: "Maximum of 10 active API keys per company" });
      }

      const rawKey = `dpp_${require("crypto").randomBytes(20).toString("hex")}`;
      const keyRecord = buildApiKeyHashRecord(rawKey);

      const result = await pool.query(
        `INSERT INTO api_keys (
           company_id, name, key_hash, key_prefix, key_salt, hash_algorithm, scopes,
           operator_type, access_mode, max_confidentiality, expires_at, created_by
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, name, key_prefix, scopes, operator_type, access_mode, max_confidentiality, expires_at, created_at`,
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

      res.status(201).json({ ...result.rows[0], key: rawKey });
    } catch (error) {
      logger.error("Create API key error:", error.message);
      res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Failed to create API key" });
    }
  });

  app.delete("/api/companies/:companyId/api-keys/:keyId", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        "UPDATE api_keys SET is_active = false, updated_at = NOW() WHERE id = $1 AND company_id = $2 RETURNING id, company_id, name, scopes, operator_type, access_mode, max_confidentiality, expires_at, is_active",
        [req.params.keyId, req.params.companyId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Key not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REVOKE_API_KEY",
        "api_keys",
        String(req.params.keyId),
        result.rows[0],
        { revoked: true },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
          audience: "company_admin",
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
      }).catch(() => {});

      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to revoke API key" });
    }
  });

  app.post("/api/companies/:companyId/api-keys/:keyId/revoke", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const reason = req.body?.reason || "API key access revoked";
      const result = await pool.query(
        `UPDATE api_keys
         SET is_active = false,
             updated_at = NOW()
         WHERE id = $1 AND company_id = $2
         RETURNING id, company_id, name, scopes, operator_type, access_mode, max_confidentiality, expires_at, is_active`,
        [req.params.keyId, req.params.companyId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Key not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REVOKE_API_KEY",
        "api_keys",
        String(req.params.keyId),
        result.rows[0],
        { revoked: true, reason },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
          audience: "company_admin",
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
      }).catch(() => {});

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
        `UPDATE api_keys
         SET is_active = false,
             expires_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND company_id = $2
         RETURNING id, company_id, name, scopes, operator_type, access_mode, max_confidentiality, expires_at, is_active`,
        [req.params.keyId, req.params.companyId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Key not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "EMERGENCY_REVOKE_API_KEY",
        "api_keys",
        String(req.params.keyId),
        result.rows[0],
        { revoked: true, emergency: true, reason, effective_at: effectiveAt },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
          audience: "company_admin",
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
      }).catch(() => {});

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
