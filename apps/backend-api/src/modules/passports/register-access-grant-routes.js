function registerAccessGrantRoutes(app, deps) {
  const {
    pool,
    accessRightsService,
    authenticateToken,
    checkCompanyAccess,
    checkCompanyAdmin,
    logAudit,
    replicateAccessControlEventToBackup,
  } = deps;

  function canViewGrantCompany(req, companyId) {
    return req.user?.role === "super_admin" || String(req.user?.companyId) === String(companyId);
  }

  function canManageGrantCompany(req, companyId) {
    return req.user?.role === "super_admin" || (
      req.user?.role === "company_admin" &&
      String(req.user?.companyId) === String(companyId)
    );
  }

  function parseGrantExpiry(rawValue) {
    if (rawValue === undefined) return { provided: false, value: undefined };
    if (rawValue === null || rawValue === "") return { provided: true, value: null };
    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
      return { error: "expires_at must be a valid ISO timestamp" };
    }
    return { provided: true, value: parsed };
  }

  function normalizeGrantElementPath(rawValue) {
    if (rawValue === undefined) return { provided: false, value: undefined };
    if (rawValue === null) return { provided: true, value: null };
    const trimmed = String(rawValue).trim();
    if (!trimmed) return { provided: true, value: null };
    return {
      provided: true,
      value: accessRightsService?.normalizeGrantElementIdPath?.(trimmed) || trimmed,
    };
  }

  function normalizeAccessGrantPayload(body = {}, options = {}) {
    const audience = body.audience !== undefined ? String(body.audience || "").trim() : undefined;
    if (options.requireAudience && (!audience || !accessRightsService.VALID_AUDIENCES.has(audience) || audience === "public")) {
      return { error: "audience must be a non-public supported audience" };
    }
    if (audience !== undefined && audience && (!accessRightsService.VALID_AUDIENCES.has(audience) || audience === "public")) {
      return { error: "audience must be a non-public supported audience" };
    }

    const dppId = body.dppId ?? body.passport_dpp_id ?? body.passportDppId;
    const normalizedDppId = dppId !== undefined ? String(dppId || "").trim() : undefined;
    if (options.requireDppId && !normalizedDppId) {
      return { error: "dppId is required" };
    }

    const granteeUserInput = body.granteeUserId ?? body.grantee_user_id;
    const hasGranteeUserId = granteeUserInput !== undefined;
    const granteeUserId = hasGranteeUserId ? Number.parseInt(granteeUserInput, 10) : undefined;
    if (options.requireGranteeUserId && !Number.isFinite(granteeUserId)) {
      return { error: "grantee_user_id is required" };
    }
    if (hasGranteeUserId && !Number.isFinite(granteeUserId)) {
      return { error: "grantee_user_id must be a valid integer" };
    }

    const expiry = parseGrantExpiry(body.expiresAt ?? body.expires_at);
    if (expiry.error) return expiry;

    const elementPath = normalizeGrantElementPath(body.elementIdPath ?? body.element_id_path);
    if (elementPath.error) return elementPath;

    return {
      dppId: normalizedDppId,
      audience,
      granteeUserId,
      reason: body.reason !== undefined ? (body.reason || null) : undefined,
      expiresAt: expiry.value,
      expiresAtProvided: expiry.provided,
      elementIdPath: elementPath.value,
      elementIdPathProvided: elementPath.provided,
      isActive: body.isActive ?? body.is_active,
    };
  }

  async function resolvePassportGrantTarget(dppId) {
    const result = await pool.query(
      `SELECT dpp_id AS "dppId", lineage_id, company_id, passport_type
       FROM passport_registry
       WHERE dpp_id = $1
       LIMIT 1`,
      [dppId]
    );
    return result.rows[0] || null;
  }

  async function loadPassportAccessGrant(grantId) {
    const result = await pool.query(
      `SELECT pag.*,
              pr.lineage_id,
              pr.passport_type
       FROM passport_access_grants pag
       LEFT JOIN passport_registry pr ON pr.dpp_id = pag.passport_dpp_id
       WHERE pag.id = $1
       LIMIT 1`,
      [grantId]
    );
    return result.rows[0] || null;
  }

  function mapPassportAccessGrantRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      dppId: row.passport_dpp_id,
      passport_dpp_id: row.passport_dpp_id,
      companyId: row.company_id,
      company_id: row.company_id,
      audience: row.audience,
      elementIdPath: row.element_id_path,
      element_id_path: row.element_id_path,
      granteeUserId: row.grantee_user_id,
      grantee_user_id: row.grantee_user_id,
      grantedBy: row.granted_by,
      granted_by: row.granted_by,
      reason: row.reason,
      expiresAt: row.expires_at,
      expires_at: row.expires_at,
      isActive: row.is_active,
      is_active: row.is_active,
      createdAt: row.created_at,
      created_at: row.created_at,
      updatedAt: row.updated_at,
      updated_at: row.updated_at,
      granteeEmail: row.grantee_email,
      grantee_email: row.grantee_email,
      granteeFirstName: row.grantee_first_name,
      grantee_first_name: row.grantee_first_name,
      granteeLastName: row.grantee_last_name,
      grantee_last_name: row.grantee_last_name,
      grantorEmail: row.grantor_email,
      grantor_email: row.grantor_email,
      passportType: row.passport_type,
      passport_type: row.passport_type,
      lineageId: row.lineage_id,
      lineage_id: row.lineage_id,
    };
  }

  app.get("/api/passports/:dppId/access-grants", authenticateToken, async (req, res) => {
    try {
      const dppId = String(req.params.dppId || "").trim();
      if (!dppId) return res.status(400).json({ error: "dppId is required" });

      const target = await resolvePassportGrantTarget(dppId);
      if (!target) return res.status(404).json({ error: "Passport not found" });
      if (!canViewGrantCompany(req, target.company_id)) {
        return res.status(403).json({ error: "Unauthorised access to this company" });
      }

      const result = await pool.query(
        `SELECT pag.id, pag.passport_dpp_id, pag.company_id, pag.audience, pag.element_id_path,
                pag.grantee_user_id, pag.granted_by, pag.reason, pag.expires_at, pag.is_active,
                pag.created_at, pag.updated_at,
                pr.passport_type, pr.lineage_id,
                grantee.email AS grantee_email, grantee.first_name AS grantee_first_name, grantee.last_name AS grantee_last_name,
                grantor.email AS grantor_email
         FROM passport_access_grants pag
         LEFT JOIN passport_registry pr ON pr.dpp_id = pag.passport_dpp_id
         LEFT JOIN users grantee ON grantee.id = pag.grantee_user_id
         LEFT JOIN users grantor ON grantor.id = pag.granted_by
         WHERE pag.company_id = $1
           AND pag.passport_dpp_id = $2
         ORDER BY pag.created_at DESC`,
        [target.company_id, dppId]
      );

      res.json({
        dppId,
        companyId: target.company_id,
        grants: result.rows.map(mapPassportAccessGrantRow),
      });
    } catch {
      res.status(500).json({ error: "Failed to fetch passport access grants" });
    }
  });

  app.post("/api/access-grants", authenticateToken, async (req, res) => {
    try {
      const parsed = normalizeAccessGrantPayload(req.body, {
        requireDppId: true,
        requireAudience: true,
        requireGranteeUserId: true,
      });
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const target = await resolvePassportGrantTarget(parsed.dppId);
      if (!target) return res.status(404).json({ error: "Passport not found" });
      if (!canManageGrantCompany(req, target.company_id)) {
        return res.status(403).json({ error: "Company admin access required" });
      }

      const result = await pool.query(
        `INSERT INTO passport_access_grants (
           passport_dpp_id, company_id, audience, element_id_path, grantee_user_id, granted_by, reason, expires_at, is_active, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
         ON CONFLICT (passport_dpp_id, audience, grantee_user_id, element_id_path)
         DO UPDATE SET
           granted_by = EXCLUDED.granted_by,
           reason = EXCLUDED.reason,
           expires_at = EXCLUDED.expires_at,
           is_active = true,
           updated_at = NOW()
         RETURNING *`,
        [
          parsed.dppId,
          target.company_id,
          parsed.audience,
          parsed.elementIdPath || null,
          parsed.granteeUserId,
          req.user.userId,
          parsed.reason ?? null,
          parsed.expiresAt ?? null,
        ]
      );

      await logAudit(
        target.company_id,
        req.user.userId,
        "GRANT_PASSPORT_AUDIENCE",
        "passport_access_grants",
        parsed.dppId,
        null,
        {
          audience: parsed.audience,
          grantee_user_id: parsed.granteeUserId,
          element_id_path: parsed.elementIdPath || null,
          expires_at: parsed.expiresAt ? parsed.expiresAt.toISOString() : null,
        },
        { audience: parsed.audience }
      );

      res.status(201).json({
        success: true,
        grant: mapPassportAccessGrantRow(result.rows[0]),
      });
    } catch (error) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "An equivalent access grant already exists" });
      }
      res.status(500).json({ error: "Failed to create access grant" });
    }
  });

  app.patch("/api/access-grants/:grantId", authenticateToken, async (req, res) => {
    try {
      const grantId = Number.parseInt(req.params.grantId, 10);
      if (!Number.isFinite(grantId)) return res.status(400).json({ error: "grantId must be a valid integer" });

      const existing = await loadPassportAccessGrant(grantId);
      if (!existing) return res.status(404).json({ error: "Grant not found" });
      if (!canManageGrantCompany(req, existing.company_id)) {
        return res.status(403).json({ error: "Company admin access required" });
      }

      const parsed = normalizeAccessGrantPayload(req.body || {});
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const updates = [];
      const values = [];
      let index = 1;

      if (parsed.audience !== undefined) {
        updates.push(`audience = $${index++}`);
        values.push(parsed.audience);
      }
      if (parsed.elementIdPathProvided) {
        updates.push(`element_id_path = $${index++}`);
        values.push(parsed.elementIdPath || null);
      }
      if (parsed.granteeUserId !== undefined) {
        updates.push(`grantee_user_id = $${index++}`);
        values.push(parsed.granteeUserId);
      }
      if (parsed.reason !== undefined) {
        updates.push(`reason = $${index++}`);
        values.push(parsed.reason);
      }
      if (parsed.expiresAtProvided) {
        updates.push(`expires_at = $${index++}`);
        values.push(parsed.expiresAt ?? null);
      }
      if (parsed.isActive !== undefined) {
        updates.push(`is_active = $${index++}`);
        values.push(Boolean(parsed.isActive));
      }

      updates.push(`updated_at = NOW()`);
      updates.push(`granted_by = $${index++}`);
      values.push(req.user.userId);

      if (updates.length <= 2) {
        return res.status(400).json({ error: "No supported access grant fields were provided" });
      }

      values.push(grantId);
      const result = await pool.query(
        `UPDATE passport_access_grants
         SET ${updates.join(", ")}
         WHERE id = $${index}
         RETURNING *`,
        values
      );

      await logAudit(
        existing.company_id,
        req.user.userId,
        "UPDATE_PASSPORT_ACCESS_GRANT",
        "passport_access_grants",
        existing.passport_dpp_id,
        existing,
        result.rows[0],
        { audience: result.rows[0]?.audience || existing.audience }
      );

      res.json({
        success: true,
        grant: mapPassportAccessGrantRow(result.rows[0]),
      });
    } catch (error) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "An equivalent access grant already exists" });
      }
      res.status(500).json({ error: "Failed to update access grant" });
    }
  });

  app.delete("/api/access-grants/:grantId", authenticateToken, async (req, res) => {
    try {
      const grantId = Number.parseInt(req.params.grantId, 10);
      if (!Number.isFinite(grantId)) return res.status(400).json({ error: "grantId must be a valid integer" });

      const existing = await loadPassportAccessGrant(grantId);
      if (!existing) return res.status(404).json({ error: "Grant not found" });
      if (!canManageGrantCompany(req, existing.company_id)) {
        return res.status(403).json({ error: "Company admin access required" });
      }

      const result = await pool.query(
        `DELETE FROM passport_access_grants
         WHERE id = $1
         RETURNING *`,
        [grantId]
      );

      await logAudit(
        existing.company_id,
        req.user.userId,
        "DELETE_PASSPORT_ACCESS_GRANT",
        "passport_access_grants",
        existing.passport_dpp_id,
        existing,
        null,
        { audience: existing.audience }
      );

      res.json({
        success: true,
        deleted: true,
        grant: mapPassportAccessGrantRow(result.rows[0]),
      });
    } catch {
      res.status(500).json({ error: "Failed to delete access grant" });
    }
  });

  app.post("/api/access-grants/:grantId/revoke", authenticateToken, async (req, res) => {
    try {
      const grantId = Number.parseInt(req.params.grantId, 10);
      if (!Number.isFinite(grantId)) return res.status(400).json({ error: "grantId must be a valid integer" });

      const existing = await loadPassportAccessGrant(grantId);
      if (!existing) return res.status(404).json({ error: "Grant not found" });
      if (!canManageGrantCompany(req, existing.company_id)) {
        return res.status(403).json({ error: "Company admin access required" });
      }

      const reason = req.body?.reason !== undefined ? (req.body.reason || existing.reason || null) : existing.reason;
      const result = await pool.query(
        `UPDATE passport_access_grants
         SET is_active = false,
             reason = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [grantId, reason]
      );

      await logAudit(
        existing.company_id,
        req.user.userId,
        "REVOKE_PASSPORT_AUDIENCE",
        "passport_access_grants",
        existing.passport_dpp_id,
        existing,
        { ...result.rows[0], revoked: true },
        { audience: existing.audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: existing.company_id,
        eventType: "PASSPORT_ACCESS_GRANT_REVOKED",
        severity: "high",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: existing.grantee_user_id,
        affectedGrantId: grantId,
        passportDppId: existing.passport_dpp_id,
        audience: existing.audience,
        elementIdPath: existing.element_id_path,
        revocationMode: "standard",
        reason,
      }).catch(() => {});

      res.json({
        success: true,
        revoked: true,
        emergency: false,
        grant: mapPassportAccessGrantRow(result.rows[0]),
      });
    } catch {
      res.status(500).json({ error: "Failed to revoke access grant" });
    }
  });

  app.post("/api/access-grants/:grantId/emergency-revoke", authenticateToken, async (req, res) => {
    try {
      const grantId = Number.parseInt(req.params.grantId, 10);
      if (!Number.isFinite(grantId)) return res.status(400).json({ error: "grantId must be a valid integer" });

      const existing = await loadPassportAccessGrant(grantId);
      if (!existing) return res.status(404).json({ error: "Grant not found" });
      if (!canManageGrantCompany(req, existing.company_id)) {
        return res.status(403).json({ error: "Company admin access required" });
      }

      const reason = req.body?.reason !== undefined
        ? req.body.reason || "Emergency access revocation"
        : existing.reason || "Emergency access revocation";
      const result = await pool.query(
        `UPDATE passport_access_grants
         SET is_active = false,
             expires_at = NOW(),
             reason = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [grantId, reason]
      );

      await logAudit(
        existing.company_id,
        req.user.userId,
        "EMERGENCY_REVOKE_PASSPORT_AUDIENCE",
        "passport_access_grants",
        existing.passport_dpp_id,
        existing,
        { ...result.rows[0], revoked: true, emergency: true },
        { audience: existing.audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: existing.company_id,
        eventType: "PASSPORT_ACCESS_GRANT_EMERGENCY_REVOKED",
        severity: "critical",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: existing.grantee_user_id,
        affectedGrantId: grantId,
        passportDppId: existing.passport_dpp_id,
        audience: existing.audience,
        elementIdPath: existing.element_id_path,
        revocationMode: "emergency",
        reason,
        metadata: {
          effectiveAt: result.rows[0]?.expires_at || null,
        },
      }).catch(() => {});

      res.json({
        success: true,
        revoked: true,
        emergency: true,
        grant: mapPassportAccessGrantRow(result.rows[0]),
      });
    } catch {
      res.status(500).json({ error: "Failed to emergency-revoke access grant" });
    }
  });

  app.get("/api/companies/:companyId/access-audiences/users/:userId", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, audience, reason, expires_at, is_active, created_at, updated_at
         FROM user_access_audiences
         WHERE company_id = $1
           AND user_id = $2
         ORDER BY audience, created_at DESC`,
        [req.params.companyId, req.params.userId]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch access audiences" });
    }
  });

  app.post("/api/companies/:companyId/access-audiences/users/:userId", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const audience = String(req.body?.audience || "").trim();
      if (!accessRightsService.VALID_AUDIENCES.has(audience) || audience === "public") {
        return res.status(400).json({ error: "audience must be a non-public supported audience" });
      }
      const expiresAt = req.body?.expires_at ? new Date(req.body.expires_at) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return res.status(400).json({ error: "expires_at must be a valid ISO timestamp" });
      }

      const result = await pool.query(
        `INSERT INTO user_access_audiences (
           user_id, company_id, audience, granted_by, reason, expires_at, is_active, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
         ON CONFLICT (user_id, company_id, audience)
         DO UPDATE SET
           granted_by = EXCLUDED.granted_by,
           reason = EXCLUDED.reason,
           expires_at = EXCLUDED.expires_at,
           is_active = true,
           updated_at = NOW()
         RETURNING id, audience, reason, expires_at, is_active, created_at, updated_at`,
        [
          req.params.userId,
          req.params.companyId,
          audience,
          req.user.userId,
          req.body?.reason || null,
          expiresAt,
        ]
      );

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "GRANT_USER_AUDIENCE",
        "user_access_audiences",
        req.params.userId,
        null,
        { audience, expires_at: expiresAt ? expiresAt.toISOString() : null },
        { audience }
      );

      res.status(201).json(result.rows[0]);
    } catch {
      res.status(500).json({ error: "Failed to grant access audience" });
    }
  });

  app.delete("/api/companies/:companyId/access-audiences/users/:userId/:audience", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const audience = String(req.params.audience || "").trim();
      if (!accessRightsService.VALID_AUDIENCES.has(audience) || audience === "public") {
        return res.status(400).json({ error: "audience must be a non-public supported audience" });
      }

      const result = await pool.query(
        `UPDATE user_access_audiences
         SET is_active = false,
             updated_at = NOW()
         WHERE company_id = $1
           AND user_id = $2
           AND audience = $3
         RETURNING id, audience, user_id, is_active, updated_at`,
        [req.params.companyId, req.params.userId, audience]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Access audience not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REVOKE_USER_AUDIENCE",
        "user_access_audiences",
        req.params.userId,
        result.rows[0],
        { revoked: true, audience },
        { audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "USER_AUDIENCE_REVOKED",
        severity: "high",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: req.params.userId,
        audience,
        revocationMode: "standard",
      }).catch(() => {});

      res.json({ success: true, accessAudience: result.rows[0] });
    } catch {
      res.status(500).json({ error: "Failed to revoke access audience" });
    }
  });

  app.post("/api/companies/:companyId/access-audiences/:grantId/revoke", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const grantId = Number.parseInt(req.params.grantId, 10);
      if (!Number.isFinite(grantId)) return res.status(400).json({ error: "grantId must be a valid integer" });

      const existing = await pool.query(
        `SELECT id, user_id, company_id, audience, granted_by, reason, expires_at, is_active
         FROM user_access_audiences
         WHERE id = $1 AND company_id = $2`,
        [grantId, req.params.companyId]
      );
      if (!existing.rows.length) return res.status(404).json({ error: "Access audience grant not found" });

      const reason = req.body?.reason || existing.rows[0].reason || "User audience revoked";
      const result = await pool.query(
        `UPDATE user_access_audiences
         SET is_active = false,
             reason = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, audience, user_id, is_active, updated_at, reason`,
        [grantId, reason]
      );

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REVOKE_USER_AUDIENCE",
        "user_access_audiences",
        String(existing.rows[0].user_id),
        existing.rows[0],
        { ...result.rows[0], revoked: true },
        { audience: existing.rows[0].audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "USER_AUDIENCE_REVOKED",
        severity: "high",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: existing.rows[0].user_id,
        audience: existing.rows[0].audience,
        revocationMode: "standard",
        reason,
      }).catch(() => {});

      res.json({ success: true, revoked: true, emergency: false, accessAudience: result.rows[0] });
    } catch {
      res.status(500).json({ error: "Failed to revoke access audience" });
    }
  });

  app.post("/api/companies/:companyId/access-audiences/:grantId/emergency-revoke", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const grantId = Number.parseInt(req.params.grantId, 10);
      if (!Number.isFinite(grantId)) return res.status(400).json({ error: "grantId must be a valid integer" });

      const existing = await pool.query(
        `SELECT id, user_id, company_id, audience, granted_by, reason, expires_at, is_active
         FROM user_access_audiences
         WHERE id = $1 AND company_id = $2`,
        [grantId, req.params.companyId]
      );
      if (!existing.rows.length) return res.status(404).json({ error: "Access audience grant not found" });

      const reason = req.body?.reason || existing.rows[0].reason || "Emergency user audience revocation";
      const effectiveAt = new Date().toISOString();
      const result = await pool.query(
        `UPDATE user_access_audiences
         SET is_active = false,
             expires_at = NOW(),
             reason = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, audience, user_id, is_active, updated_at, expires_at, reason`,
        [grantId, reason]
      );

      await pool.query(
        `UPDATE users
         SET session_version = COALESCE(session_version, 1) + 1,
             updated_at = NOW()
         WHERE id = $1 AND company_id = $2`,
        [existing.rows[0].user_id, req.params.companyId]
      ).catch(() => {});

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "EMERGENCY_REVOKE_USER_AUDIENCE",
        "user_access_audiences",
        String(existing.rows[0].user_id),
        existing.rows[0],
        { ...result.rows[0], revoked: true, emergency: true, effective_at: effectiveAt },
        { audience: existing.rows[0].audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "USER_AUDIENCE_EMERGENCY_REVOKED",
        severity: "critical",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: existing.rows[0].user_id,
        audience: existing.rows[0].audience,
        revocationMode: "emergency",
        reason,
        metadata: { effectiveAt, sessionsRevoked: true },
      }).catch(() => {});

      res.json({
        success: true,
        revoked: true,
        emergency: true,
        effectiveAt,
        accessAudience: result.rows[0],
      });
    } catch {
      res.status(500).json({ error: "Failed to emergency-revoke access audience" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/access-grants", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT pag.id, pag.audience, pag.element_id_path, pag.grantee_user_id, pag.granted_by, pag.reason,
                pag.expires_at, pag.is_active, pag.created_at, pag.updated_at,
                u.email AS grantee_email, u.first_name AS grantee_first_name, u.last_name AS grantee_last_name
         FROM passport_access_grants pag
         LEFT JOIN users u ON u.id = pag.grantee_user_id
         WHERE pag.company_id = $1
           AND pag.passport_dpp_id = $2
         ORDER BY pag.created_at DESC`,
        [req.params.companyId, req.params.dppId]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch passport access grants" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/access-grants", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const audience = String(req.body?.audience || "").trim();
      if (!accessRightsService.VALID_AUDIENCES.has(audience) || audience === "public") {
        return res.status(400).json({ error: "audience must be a non-public supported audience" });
      }
      const granteeUserId = Number.parseInt(req.body?.grantee_user_id, 10);
      if (!Number.isFinite(granteeUserId)) {
        return res.status(400).json({ error: "grantee_user_id is required" });
      }
      const expiresAt = req.body?.expires_at ? new Date(req.body.expires_at) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return res.status(400).json({ error: "expires_at must be a valid ISO timestamp" });
      }

      const result = await pool.query(
        `INSERT INTO passport_access_grants (
           passport_dpp_id, company_id, audience, element_id_path, grantee_user_id, granted_by, reason, expires_at, is_active, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
         ON CONFLICT (passport_dpp_id, audience, grantee_user_id, element_id_path)
         DO UPDATE SET
           granted_by = EXCLUDED.granted_by,
           reason = EXCLUDED.reason,
           expires_at = EXCLUDED.expires_at,
           is_active = true,
           updated_at = NOW()
         RETURNING *`,
        [
          req.params.dppId,
          req.params.companyId,
          audience,
          req.body?.element_id_path || null,
          granteeUserId,
          req.user.userId,
          req.body?.reason || null,
          expiresAt,
        ]
      );

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "GRANT_PASSPORT_AUDIENCE",
        "passport_access_grants",
        req.params.dppId,
        null,
        {
          audience,
          grantee_user_id: granteeUserId,
          element_id_path: req.body?.element_id_path || null,
          expires_at: expiresAt ? expiresAt.toISOString() : null,
        },
        { audience }
      );

      res.status(201).json(result.rows[0]);
    } catch {
      res.status(500).json({ error: "Failed to grant passport access" });
    }
  });

  app.delete("/api/companies/:companyId/passports/:dppId/access-grants/:grantId", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE passport_access_grants
         SET is_active = false,
             updated_at = NOW()
         WHERE id = $1
           AND company_id = $2
           AND passport_dpp_id = $3
         RETURNING id, audience, grantee_user_id, element_id_path`,
        [req.params.grantId, req.params.companyId, req.params.dppId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Grant not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REVOKE_PASSPORT_AUDIENCE",
        "passport_access_grants",
        req.params.dppId,
        result.rows[0],
        { revoked: true },
        { audience: result.rows[0].audience }
      );

      res.json({ success: true, grant: result.rows[0] });
    } catch {
      res.status(500).json({ error: "Failed to revoke passport access" });
    }
  });
}

module.exports = registerAccessGrantRoutes;
