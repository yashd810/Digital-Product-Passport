function registerAccessGrantRoutes(app, deps) {
  const {
    pool,
    accessRightsService,
    logger,
    authenticateToken,
    checkCompanyAccess,
    checkCompanyAdmin,
    logAudit,
    replicateAccessControlEventToBackup,
  } = deps;

  function canViewGrantCompany(req, companyId) {
    return req.user?.role === "superAdmin" || String(req.user?.companyId) === String(companyId);
  }

  function canManageGrantCompany(req, companyId) {
    return req.user?.role === "superAdmin" || (
      req.user?.role === "companyAdmin" &&
      String(req.user?.companyId) === String(companyId)
    );
  }

  function parseGrantExpiry(rawValue) {
    if (rawValue === undefined) return { provided: false, value: undefined };
    if (rawValue === null || rawValue === "") return { provided: true, value: null };
    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
      return { error: "expiresAt must be a valid ISO timestamp" };
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
    if (options.requireAudience && (!audience || !accessRightsService.validAudiences.has(audience) || audience === "public")) {
      return { error: "audience must be a non-public supported audience" };
    }
    if (audience !== undefined && audience && (!accessRightsService.validAudiences.has(audience) || audience === "public")) {
      return { error: "audience must be a non-public supported audience" };
    }

    const dppId = body.dppId ?? body.passportDppId;
    const normalizedDppId = dppId !== undefined ? String(dppId || "").trim() : undefined;
    if (options.requireDppId && !normalizedDppId) {
      return { error: "dppId is required" };
    }

    const granteeUserInput = body.granteeUserId;
    const hasGranteeUserId = granteeUserInput !== undefined;
    const granteeUserId = hasGranteeUserId ? Number.parseInt(granteeUserInput, 10) : undefined;
    if (options.requireGranteeUserId && !Number.isFinite(granteeUserId)) {
      return { error: "granteeUserId is required" };
    }
    if (hasGranteeUserId && !Number.isFinite(granteeUserId)) {
      return { error: "granteeUserId must be a valid integer" };
    }

    const expiry = parseGrantExpiry(body.expiresAt);
    if (expiry.error) return expiry;

    const elementPath = normalizeGrantElementPath(body.elementIdPath);
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
      isActive: body.isActive,
    };
  }

  async function resolvePassportGrantTarget(dppId) {
    const result = await pool.query(
      `SELECT "dppId", "lineageId", "companyId", "passportType"
       FROM "passportRegistry"
       WHERE "dppId" = $1
       LIMIT 1`,
      [dppId]
    );
    return result.rows[0] || null;
  }

  async function loadPassportAccessGrant(grantId) {
    const result = await pool.query(
      `SELECT pag.*,
              pr."lineageId",
              pr."passportType"
       FROM "passportAccessGrants" pag
       LEFT JOIN "passportRegistry" pr ON pr."dppId" = pag."passportDppId"
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
      dppId: row.passportDppId,
      companyId: row.companyId,
      audience: row.audience,
      elementIdPath: row.elementIdPath,
      granteeUserId: row.granteeUserId,
      grantedBy: row.grantedBy,
      reason: row.reason,
      expiresAt: row.expiresAt,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      granteeEmail: row.granteeEmail,
      granteeFirstName: row.granteeFirstName,
      granteeLastName: row.granteeLastName,
      grantorEmail: row.grantorEmail,
      passportType: row.passportType,
      lineageId: row.lineageId,
    };
  }

  app.get("/api/passports/:dppId/access-grants", authenticateToken, async (req, res) => {
    try {
      const dppId = String(req.params.dppId || "").trim();
      if (!dppId) return res.status(400).json({ error: "dppId is required" });

      const target = await resolvePassportGrantTarget(dppId);
      if (!target) return res.status(404).json({ error: "Passport not found" });
      if (!canViewGrantCompany(req, target.companyId)) {
        return res.status(403).json({ error: "Unauthorised access to this company" });
      }

      const result = await pool.query(
        `SELECT pag.id, pag."passportDppId", pag."companyId", pag.audience, pag."elementIdPath",
                pag."granteeUserId", pag."grantedBy", pag.reason, pag."expiresAt", pag."isActive",
                pag."createdAt", pag."updatedAt",
                pr."passportType", pr."lineageId",
                grantee.email AS "granteeEmail", grantee."firstName" AS "granteeFirstName", grantee."lastName" AS "granteeLastName",
                grantor.email AS "grantorEmail"
         FROM "passportAccessGrants" pag
         LEFT JOIN "passportRegistry" pr ON pr."dppId" = pag."passportDppId"
         LEFT JOIN users grantee ON grantee.id = pag."granteeUserId"
         LEFT JOIN users grantor ON grantor.id = pag."grantedBy"
         WHERE pag."companyId" = $1
           AND pag."passportDppId" = $2
         ORDER BY pag."createdAt" DESC`,
        [target.companyId, dppId]
      );

      res.json({
        dppId,
        companyId: target.companyId,
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
      if (!canManageGrantCompany(req, target.companyId)) {
        return res.status(403).json({ error: "Company admin access required" });
      }

      const result = await pool.query(
        `INSERT INTO "passportAccessGrants" (
           "passportDppId", "companyId", audience, "elementIdPath", "granteeUserId", "grantedBy", reason, "expiresAt", "isActive", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
         ON CONFLICT ("passportDppId", audience, "granteeUserId", "elementIdPath")
         DO UPDATE SET
           "grantedBy" = EXCLUDED."grantedBy",
           reason = EXCLUDED.reason,
           "expiresAt" = EXCLUDED."expiresAt",
           "isActive" = true,
           "updatedAt" = NOW()
         RETURNING *`,
        [
          parsed.dppId,
          target.companyId,
          parsed.audience,
          parsed.elementIdPath || null,
          parsed.granteeUserId,
          req.user.userId,
          parsed.reason ?? null,
          parsed.expiresAt ?? null,
        ]
      );

      await logAudit(
        target.companyId,
        req.user.userId,
        "grantPassportAudience",
        "passportAccessGrants",
        parsed.dppId,
        null,
        {
          audience: parsed.audience,
          granteeUserId: parsed.granteeUserId,
          elementIdPath: parsed.elementIdPath || null,
          expiresAt: parsed.expiresAt ? parsed.expiresAt.toISOString() : null,
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
      if (!canManageGrantCompany(req, existing.companyId)) {
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
        updates.push(`"elementIdPath" = $${index++}`);
        values.push(parsed.elementIdPath || null);
      }
      if (parsed.granteeUserId !== undefined) {
        updates.push(`"granteeUserId" = $${index++}`);
        values.push(parsed.granteeUserId);
      }
      if (parsed.reason !== undefined) {
        updates.push(`reason = $${index++}`);
        values.push(parsed.reason);
      }
      if (parsed.expiresAtProvided) {
        updates.push(`"expiresAt" = $${index++}`);
        values.push(parsed.expiresAt ?? null);
      }
      if (parsed.isActive !== undefined) {
        updates.push(`"isActive" = $${index++}`);
        values.push(Boolean(parsed.isActive));
      }

      updates.push(`"updatedAt" = NOW()`);
      updates.push(`"grantedBy" = $${index++}`);
      values.push(req.user.userId);

      if (updates.length <= 2) {
        return res.status(400).json({ error: "No supported access grant fields were provided" });
      }

      values.push(grantId);
      const result = await pool.query(
        `UPDATE "passportAccessGrants"
         SET ${updates.join(", ")}
         WHERE id = $${index}
         RETURNING *`,
        values
      );

      await logAudit(
        existing.companyId,
        req.user.userId,
        "updatePassportAccessGrant",
        "passportAccessGrants",
        existing.passportDppId,
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
      if (!canManageGrantCompany(req, existing.companyId)) {
        return res.status(403).json({ error: "Company admin access required" });
      }

      const result = await pool.query(
        `DELETE FROM "passportAccessGrants"
         WHERE id = $1
         RETURNING *`,
        [grantId]
      );

      await logAudit(
        existing.companyId,
        req.user.userId,
        "deletePassportAccessGrant",
        "passportAccessGrants",
        existing.passportDppId,
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
      if (!canManageGrantCompany(req, existing.companyId)) {
        return res.status(403).json({ error: "Company admin access required" });
      }

      const reason = req.body?.reason !== undefined ? (req.body.reason || existing.reason || null) : existing.reason;
      const result = await pool.query(
        `UPDATE "passportAccessGrants"
         SET "isActive" = false,
             reason = $2,
             "updatedAt" = NOW()
         WHERE id = $1
         RETURNING *`,
        [grantId, reason]
      );

      await logAudit(
        existing.companyId,
        req.user.userId,
        "revokePassportAudience",
        "passportAccessGrants",
        existing.passportDppId,
        existing,
        { ...result.rows[0], revoked: true },
        { audience: existing.audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: existing.companyId,
        eventType: "passportAccessGrantRevoked",
        severity: "high",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: existing.granteeUserId,
        affectedGrantId: grantId,
        passportDppId: existing.passportDppId,
        audience: existing.audience,
        elementIdPath: existing.elementIdPath,
        revocationMode: "standard",
        reason,
      }).catch((error) => {
        logger?.warn?.({ err: error, companyId: existing.companyId, grantId, eventType: "passportAccessGrantRevoked" }, "Failed to replicate access grant revocation event");
      });

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
      if (!canManageGrantCompany(req, existing.companyId)) {
        return res.status(403).json({ error: "Company admin access required" });
      }

      const reason = req.body?.reason !== undefined
        ? req.body.reason || "Emergency access revocation"
        : existing.reason || "Emergency access revocation";
      const result = await pool.query(
        `UPDATE "passportAccessGrants"
         SET "isActive" = false,
             "expiresAt" = NOW(),
             reason = $2,
             "updatedAt" = NOW()
         WHERE id = $1
         RETURNING *`,
        [grantId, reason]
      );

      await logAudit(
        existing.companyId,
        req.user.userId,
        "emergencyRevokePassportAudience",
        "passportAccessGrants",
        existing.passportDppId,
        existing,
        { ...result.rows[0], revoked: true, emergency: true },
        { audience: existing.audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: existing.companyId,
        eventType: "passportAccessGrantEmergencyRevoked",
        severity: "critical",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: existing.granteeUserId,
        affectedGrantId: grantId,
        passportDppId: existing.passportDppId,
        audience: existing.audience,
        elementIdPath: existing.elementIdPath,
        revocationMode: "emergency",
        reason,
        metadata: {
          effectiveAt: result.rows[0]?.expiresAt || null,
        },
      }).catch((error) => {
        logger?.warn?.({ err: error, companyId: existing.companyId, grantId, eventType: "passportAccessGrantEmergencyRevoked" }, "Failed to replicate emergency access grant revocation event");
      });

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
        `SELECT id, audience, reason, "expiresAt", "isActive", "createdAt", "updatedAt"
         FROM "userAccessAudiences"
         WHERE "companyId" = $1
           AND "userId" = $2
         ORDER BY audience, "createdAt" DESC`,
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
      if (!accessRightsService.validAudiences.has(audience) || audience === "public") {
        return res.status(400).json({ error: "audience must be a non-public supported audience" });
      }
      const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return res.status(400).json({ error: "expiresAt must be a valid ISO timestamp" });
      }

      const result = await pool.query(
        `INSERT INTO "userAccessAudiences" (
           "userId", "companyId", audience, "grantedBy", reason, "expiresAt", "isActive", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
         ON CONFLICT ("userId", "companyId", audience)
         DO UPDATE SET
           "grantedBy" = EXCLUDED."grantedBy",
           reason = EXCLUDED.reason,
           "expiresAt" = EXCLUDED."expiresAt",
           "isActive" = true,
           "updatedAt" = NOW()
         RETURNING id, audience, reason, "expiresAt", "isActive", "createdAt", "updatedAt"`,
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
        "grantUserAudience",
        "userAccessAudiences",
        req.params.userId,
        null,
        { audience, expiresAt: expiresAt ? expiresAt.toISOString() : null },
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
      if (!accessRightsService.validAudiences.has(audience) || audience === "public") {
        return res.status(400).json({ error: "audience must be a non-public supported audience" });
      }

      const result = await pool.query(
        `UPDATE "userAccessAudiences"
         SET "isActive" = false,
             "updatedAt" = NOW()
         WHERE "companyId" = $1
           AND "userId" = $2
           AND audience = $3
         RETURNING id, audience, "userId", "isActive", "updatedAt"`,
        [req.params.companyId, req.params.userId, audience]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Access audience not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "revokeUserAudience",
        "userAccessAudiences",
        req.params.userId,
        result.rows[0],
        { revoked: true, audience },
        { audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "userAudienceRevoked",
        severity: "high",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: req.params.userId,
        audience,
        revocationMode: "standard",
      }).catch((error) => {
        logger?.warn?.({ err: error, companyId: req.params.companyId, userId: req.params.userId, eventType: "userAudienceRevoked" }, "Failed to replicate user audience revocation event");
      });

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
        `SELECT id, "userId", "companyId", audience, "grantedBy", reason, "expiresAt", "isActive"
         FROM "userAccessAudiences"
         WHERE id = $1 AND "companyId" = $2`,
        [grantId, req.params.companyId]
      );
      if (!existing.rows.length) return res.status(404).json({ error: "Access audience grant not found" });

      const reason = req.body?.reason || existing.rows[0].reason || "User audience revoked";
      const result = await pool.query(
        `UPDATE "userAccessAudiences"
         SET "isActive" = false,
             reason = $2,
             "updatedAt" = NOW()
         WHERE id = $1
         RETURNING id, audience, "userId", "isActive", "updatedAt", reason`,
        [grantId, reason]
      );

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "revokeUserAudience",
        "userAccessAudiences",
        String(existing.rows[0].userId),
        existing.rows[0],
        { ...result.rows[0], revoked: true },
        { audience: existing.rows[0].audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "userAudienceRevoked",
        severity: "high",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: existing.rows[0].userId,
        audience: existing.rows[0].audience,
        revocationMode: "standard",
        reason,
      }).catch((error) => {
        logger?.warn?.({ err: error, companyId: req.params.companyId, userId: existing.rows[0].userId, eventType: "userAudienceRevoked" }, "Failed to replicate user audience revocation event");
      });

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
        `SELECT id, "userId", "companyId", audience, "grantedBy", reason, "expiresAt", "isActive"
         FROM "userAccessAudiences"
         WHERE id = $1 AND "companyId" = $2`,
        [grantId, req.params.companyId]
      );
      if (!existing.rows.length) return res.status(404).json({ error: "Access audience grant not found" });

      const reason = req.body?.reason || existing.rows[0].reason || "Emergency user audience revocation";
      const effectiveAt = new Date().toISOString();
      const result = await pool.query(
        `UPDATE "userAccessAudiences"
         SET "isActive" = false,
             "expiresAt" = NOW(),
             reason = $2,
             "updatedAt" = NOW()
         WHERE id = $1
         RETURNING id, audience, "userId", "isActive", "updatedAt", "expiresAt", reason`,
        [grantId, reason]
      );

      await pool.query(
        `UPDATE users
         SET "sessionVersion" = COALESCE("sessionVersion", 1) + 1,
             "updatedAt" = NOW()
         WHERE id = $1 AND "companyId" = $2`,
        [existing.rows[0].userId, req.params.companyId]
      ).catch((error) => {
        logger?.warn?.({ err: error, companyId: req.params.companyId, userId: existing.rows[0].userId }, "Failed to revoke user sessions after emergency audience revocation");
      });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "emergencyRevokeUserAudience",
        "userAccessAudiences",
        String(existing.rows[0].userId),
        existing.rows[0],
        { ...result.rows[0], revoked: true, emergency: true, effectiveAt },
        { audience: existing.rows[0].audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "userAudienceEmergencyRevoked",
        severity: "critical",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: existing.rows[0].userId,
        audience: existing.rows[0].audience,
        revocationMode: "emergency",
        reason,
        metadata: { effectiveAt, sessionsRevoked: true },
      }).catch((error) => {
        logger?.warn?.({ err: error, companyId: req.params.companyId, userId: existing.rows[0].userId, eventType: "userAudienceEmergencyRevoked" }, "Failed to replicate emergency user audience revocation event");
      });

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
        `SELECT pag.id, pag.audience, pag."elementIdPath", pag."granteeUserId", pag."grantedBy", pag.reason,
                pag."expiresAt", pag."isActive", pag."createdAt", pag."updatedAt",
                u.email AS "granteeEmail", u."firstName" AS "granteeFirstName", u."lastName" AS "granteeLastName"
         FROM "passportAccessGrants" pag
         LEFT JOIN users u ON u.id = pag."granteeUserId"
         WHERE pag."companyId" = $1
           AND pag."passportDppId" = $2
         ORDER BY pag."createdAt" DESC`,
        [req.params.companyId, req.params.dppId]
      );
      res.json(result.rows.map(mapPassportAccessGrantRow));
    } catch {
      res.status(500).json({ error: "Failed to fetch passport access grants" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/access-grants", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const audience = String(req.body?.audience || "").trim();
      if (!accessRightsService.validAudiences.has(audience) || audience === "public") {
        return res.status(400).json({ error: "audience must be a non-public supported audience" });
      }
      const granteeUserId = Number.parseInt(req.body?.granteeUserId, 10);
      if (!Number.isFinite(granteeUserId)) {
        return res.status(400).json({ error: "granteeUserId is required" });
      }
      const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return res.status(400).json({ error: "expiresAt must be a valid ISO timestamp" });
      }

      const result = await pool.query(
        `INSERT INTO "passportAccessGrants" (
           "passportDppId", "companyId", audience, "elementIdPath", "granteeUserId", "grantedBy", reason, "expiresAt", "isActive", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
         ON CONFLICT ("passportDppId", audience, "granteeUserId", "elementIdPath")
         DO UPDATE SET
           "grantedBy" = EXCLUDED."grantedBy",
           reason = EXCLUDED.reason,
           "expiresAt" = EXCLUDED."expiresAt",
           "isActive" = true,
           "updatedAt" = NOW()
         RETURNING *`,
        [
          req.params.dppId,
          req.params.companyId,
          audience,
          req.body?.elementIdPath || null,
          granteeUserId,
          req.user.userId,
          req.body?.reason || null,
          expiresAt,
        ]
      );

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "grantPassportAudience",
        "passportAccessGrants",
        req.params.dppId,
        null,
        {
          audience,
          granteeUserId,
          elementIdPath: req.body?.elementIdPath || null,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
        },
        { audience }
      );

      res.status(201).json(mapPassportAccessGrantRow(result.rows[0]));
    } catch {
      res.status(500).json({ error: "Failed to grant passport access" });
    }
  });

  app.delete("/api/companies/:companyId/passports/:dppId/access-grants/:grantId", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE "passportAccessGrants"
         SET "isActive" = false,
             "updatedAt" = NOW()
         WHERE id = $1
           AND "companyId" = $2
           AND "passportDppId" = $3
         RETURNING id, audience, "granteeUserId", "elementIdPath"`,
        [req.params.grantId, req.params.companyId, req.params.dppId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Grant not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "revokePassportAudience",
        "passportAccessGrants",
        req.params.dppId,
        result.rows[0],
        { revoked: true },
        { audience: result.rows[0].audience }
      );

      res.json({ success: true, grant: mapPassportAccessGrantRow(result.rows[0]) });
    } catch {
      res.status(500).json({ error: "Failed to revoke passport access" });
    }
  });
}

module.exports = registerAccessGrantRoutes;
