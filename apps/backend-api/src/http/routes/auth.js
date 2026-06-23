"use strict";
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const logger = require("../../services/logger");

module.exports = function registerAuthRoutes(app, {
  pool,
  jwt,
  JWT_SECRET,
  hashPassword,
  verifyPassword,
  verifyPasswordAndUpgrade,
  generateToken,
  hashOpaqueToken,
  validatePasswordPolicy,
  PASSWORD_MIN_LENGTH,
  hashOtpCode,
  generateOtpCode,
  SESSION_COOKIE_NAME,
  setAuthCookie,
  clearAuthCookie,
  sendOtpEmail,
  createTransporter,
  brandedEmail,
  renderInfoTable,
  logAudit,
  authRateLimit,
  otpRateLimit,
  passwordResetRateLimit,
  publicReadRateLimit,
  authenticateToken,
  checkCompanyAccess,
  oauthService,
  backupProviderService,
}) {
  function buildAuthIdentityPayload(row = {}) {
    const operatorIdentifier = row.economicOperatorIdentifier || row.economicOperatorId || null;
    const operatorIdentifierScheme = row.economicOperatorIdentifierScheme || row.operatorIdentifierScheme || null;
    return {
      actorIdentifier: operatorIdentifier,
      actorIdentifierScheme: operatorIdentifierScheme,
      globallyUniqueOperatorId: operatorIdentifier,
      globallyUniqueOperatorIdentifier: operatorIdentifier,
      globallyUniqueOperatorIdentifierScheme: operatorIdentifierScheme,
      operatorIdentifier,
      operatorIdentifierScheme,
      economicOperatorId: operatorIdentifier,
      economicOperatorIdentifier: operatorIdentifier,
      economicOperatorIdentifierScheme: operatorIdentifierScheme,
    };
  }

  function buildAuthUserResponse(row = {}) {
    return {
      id: row.id,
      email: row.email,
      companyId: row.companyId ?? null,
      role: row.role,
      firstName: row.firstName ?? "",
      lastName: row.lastName ?? "",
      companyName: row.companyName ?? null,
      assetManagementEnabled: Boolean(row.assetManagementEnabled),
      avatarUrl: row.avatarUrl ?? null,
      phone: row.phone ?? null,
      jobTitle: row.jobTitle ?? null,
      bio: row.bio ?? null,
      authSource: row.authSource ?? null,
      ssoOnly: Boolean(row.ssoOnly),
      preferredLanguage: row.preferredLanguage ?? null,
      defaultReviewerId: row.defaultReviewerId ?? null,
      defaultApproverId: row.defaultApproverId ?? null,
      createdAt: row.createdAt ?? null,
      lastLoginAt: row.lastLoginAt ?? null,
      twoFactorEnabled: Boolean(row.twoFactorEnabled),
      isActive: row.isActive ?? undefined,
      sessionVersion: row.sessionVersion ?? undefined,
      ...buildAuthIdentityPayload(row),
    };
  }

  function buildCompanyMemberResponse(row = {}) {
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName ?? "",
      lastName: row.lastName ?? "",
      role: row.role,
      jobTitle: row.jobTitle ?? null,
      avatarUrl: row.avatarUrl ?? null,
      isActive: Boolean(row.isActive),
      createdAt: row.createdAt ?? null,
      passportCount: Number(row.passportCount ?? 0),
    };
  }

  async function replicateAccessControlEventToBackup({
    companyId,
    eventType,
    severity = "normal",
    actorUserId = null,
    actorIdentifier = null,
    affectedUserId = null,
    revocationMode = "standard",
    reason = null,
    metadata = {},
  }) {
    if (!backupProviderService || !companyId || !backupProviderService.replicateAccessControlEvent) {
      return { success: true, skipped: true, reason: "BACKUP_SERVICE_UNAVAILABLE" };
    }
    return backupProviderService.replicateAccessControlEvent({
      companyId,
      eventType,
      severity,
      actorUserId,
      actorIdentifier,
      affectedUserId,
      revocationMode,
      reason,
      metadata,
    });
  }

  // ─── REGISTER ──────────────────────────────────────────────────────────────
  app.post("/api/auth/register", authRateLimit, async (req, res) => {
    try {
      const { token, firstName, lastName, password } = req.body;
      if (!token || !firstName || !lastName || !password)
        return res.status(400).json({ error: "All fields are required" });
      const passwordPolicyError = validatePasswordPolicy(password);
      if (passwordPolicyError) return res.status(400).json({ error: passwordPolicyError });

      const tokenRow = await pool.query(
        `SELECT it.*,
                c."companyName" AS "companyName",
                c."assetManagementEnabled" AS "assetManagementEnabled",
                c."economicOperatorIdentifier" AS "economicOperatorIdentifier",
                c."economicOperatorIdentifierScheme" AS "economicOperatorIdentifierScheme"
         FROM "inviteTokens" it
         LEFT JOIN companies c ON c.id = it."companyId"
         WHERE it.token = $1 AND it.used = false AND it."expiresAt" > NOW()`,
        [token]
      );
      if (!tokenRow.rows.length)
        return res.status(400).json({ error: "Invalid or expired invitation link. Please ask for a new invite." });
      const invite = tokenRow.rows[0];
      if ((invite.approvalStatus || "approved") !== "approved") {
        return res.status(400).json({ error: "This invitation is awaiting super admin approval." });
      }

      const existing = await pool.query("SELECT id FROM users WHERE email = $1", [invite.email]);
      if (existing.rows.length)
        return res.status(400).json({ error: "This email is already registered" });

      const { hash, pepperVersion } = await hashPassword(password);
      const role = invite.roleToAssign || "editor";
      const assignedCompanyId = role === "superAdmin" ? null : invite.companyId;
      const result = await pool.query(
        `INSERT INTO users (email, "passwordHash", "firstName", "lastName", "companyId", role, "pepperVersion")
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id,
                   email,
                   "companyId" AS "companyId",
                   role,
                   "firstName" AS "firstName",
                   "lastName" AS "lastName",
                   "sessionVersion" AS "sessionVersion"`,
        [invite.email, hash, firstName, lastName, assignedCompanyId, role, pepperVersion]
      );
      await pool.query("UPDATE \"inviteTokens\" SET used = true WHERE token = $1", [token]);

      const u = result.rows[0];
      const sessionToken = generateToken(u);
      setAuthCookie(res, sessionToken);
      res.status(201).json({
        success: true,
        user: buildAuthUserResponse({
          ...u,
          companyName: invite.companyName || null,
          assetManagementEnabled: invite.assetManagementEnabled || false,
          economicOperatorIdentifier: invite.economicOperatorIdentifier || null,
          economicOperatorIdentifierScheme: invite.economicOperatorIdentifierScheme || null,
        }),
      });
    } catch (e) {
      logger.error({ err: e }, "Register error");
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // ─── VALIDATE INVITE ────────────────────────────────────────────────────────
  app.get("/api/invite/validate", publicReadRateLimit, async (req, res) => {
    try {
      const { token } = req.query;
      if (!token) return res.status(400).json({ error: "Token is required" });
      const row = await pool.query(
        `SELECT it.email, it."expiresAt", it.used, it."roleToAssign", it."approvalStatus", c."companyName" AS "companyName"
         FROM "inviteTokens" it LEFT JOIN companies c ON c.id = it."companyId" WHERE it.token = $1`,
        [token]
      );
      if (!row.rows.length) return res.status(404).json({ valid: false, error: "Invitation not found." });
      const invite = row.rows[0];
      if (invite.used)    return res.status(400).json({ valid: false, error: "This invitation has already been used." });
      if (new Date(invite.expiresAt) < new Date()) return res.status(400).json({ valid: false, error: "This invitation has expired." });
      if ((invite.approvalStatus || "approved") !== "approved") {
        return res.status(400).json({ valid: false, error: "This invitation is awaiting super admin approval." });
      }
      res.json({
        valid: true,
        email: invite.email,
        companyName: invite.companyName || null,
        roleToAssign: invite.roleToAssign || null,
        expiresAt: invite.expiresAt,
      });
    } catch (e) { res.status(500).json({ valid: false, error: "Failed to validate invitation" }); }
  });

  // ─── LOGIN ──────────────────────────────────────────────────────────────────
  app.post("/api/auth/login", authRateLimit, async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: "Email and password required" });

      // Per-email lockout: max 5 failures in 15 minutes
      const lockKey = `login-lockout:${String(email).trim().toLowerCase()}`;
      const lockRow = await pool.query(
        "SELECT count, \"resetAt\" FROM \"requestRateLimits\" WHERE \"bucketKey\" = $1",
        [lockKey]
      );
      if (lockRow.rows.length && lockRow.rows[0].count >= 5 && new Date() < new Date(lockRow.rows[0].resetAt)) {
        return res.status(429).json({ error: "Account temporarily locked due to too many failed attempts. Please try again later." });
      }

      const result = await pool.query(
        `SELECT u.id,
                u.email,
                u."passwordHash" AS "passwordHash",
                u."pepperVersion" AS "pepperVersion",
                u."companyId" AS "companyId",
                u.role,
                u."isActive" AS "isActive",
                u."sessionVersion" AS "sessionVersion",
                u."twoFactorEnabled" AS "twoFactorEnabled",
                u."otpCodeHash" AS "otpCodeHash",
                u."otpExpiresAt" AS "otpExpiresAt",
                u."ssoOnly" AS "ssoOnly",
                c."companyName" AS "companyName",
                c."assetManagementEnabled" AS "assetManagementEnabled",
                c."economicOperatorIdentifier" AS "economicOperatorIdentifier",
                c."economicOperatorIdentifierScheme" AS "economicOperatorIdentifierScheme"
         FROM users u
         LEFT JOIN companies c ON c.id = u."companyId"
         WHERE u.email = $1 AND u."isActive" = true`,
        [email]
      );
      if (!result.rows.length) return res.status(401).json({ error: "Invalid credentials" });
      const u  = result.rows[0];
      if (u.ssoOnly) {
        return res.status(400).json({ error: "This account uses enterprise SSO. Use the SSO sign-in option instead." });
      }
      const passwordCheck = await verifyPasswordAndUpgrade(password, u);
      if (!passwordCheck.valid) {
        // Increment lockout counter
        const resetAt = new Date(Date.now() + 15 * 60 * 1000);
        await pool.query(
          `INSERT INTO "requestRateLimits" ("bucketKey", count, "resetAt", "updatedAt")
           VALUES ($1, 1, $2, NOW())
           ON CONFLICT ("bucketKey") DO UPDATE
           SET count = CASE WHEN "requestRateLimits"."resetAt" <= NOW() THEN 1 ELSE "requestRateLimits".count + 1 END,
               "resetAt" = CASE WHEN "requestRateLimits"."resetAt" <= NOW() THEN $2 ELSE "requestRateLimits"."resetAt" END,
               "updatedAt" = NOW()`,
          [lockKey, resetAt]
        ).catch((error) => {
          logger.warn({ err: error, email }, "Failed to increment login lockout counter");
        });
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (passwordCheck.needsUpgrade && passwordCheck.nextHash) {
        await pool.query(
          `UPDATE users
           SET "passwordHash" = $1,
               "pepperVersion" = $2,
               "updatedAt" = NOW()
           WHERE id = $3`,
          [passwordCheck.nextHash, passwordCheck.pepperVersion, u.id]
        ).catch((error) => {
          logger.warn({ err: error, userId: u.id }, "Failed to upgrade password hash after login");
        });
      }

      // Clear lockout on successful login
      await pool.query("DELETE FROM \"requestRateLimits\" WHERE \"bucketKey\" = $1", [lockKey]).catch((error) => {
        logger.warn({ err: error, email }, "Failed to clear login lockout counter");
      });

      if (u.twoFactorEnabled) {
        const otp     = generateOtpCode();
        const otpHash = hashOtpCode(otp);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await pool.query(
          'UPDATE users SET "otpCodeHash" = $1, "otpCode" = NULL, "otpExpiresAt" = $2 WHERE id = $3',
          [otpHash, expiresAt, u.id]
        );
        try { await sendOtpEmail(u, otp); }
        catch (emailErr) {
          logger.error("OTP email failed:", emailErr.message);
          return res.status(500).json({ error: "Failed to send verification code. Please try again." });
        }
        const preAuthToken = jwt.sign({ userId: u.id, preAuth: true }, JWT_SECRET, { expiresIn: "10m" });
        return res.json({ requiresTwoFactor: true, preAuthToken });
      }

      await pool.query('UPDATE users SET "lastLoginAt" = NOW() WHERE id = $1', [u.id]).catch((error) => {
        logger.warn({ err: error, userId: u.id }, "Failed to update password login timestamp");
      });
      const sessionToken = generateToken(u, undefined, undefined, undefined, undefined, {
        mfaVerifiedAt: new Date().toISOString(),
        amr: ["pwd", "otp"]
      });
      logger.info({ userId: u.id, sessionVersion: u.sessionVersion, msg: "[LOGIN_TOKEN] Generated token with session version" });
      setAuthCookie(res, sessionToken);
      res.json({
        success: true,
        token: sessionToken,
        user: buildAuthUserResponse(u),
      });
    } catch (e) { logger.error("Login error:", e.message); res.status(500).json({ error: "Login failed" }); }
  });

  // ─── VERIFY OTP (2FA second step) ───────────────────────────────────────────
  app.post("/api/auth/verify-otp", otpRateLimit, async (req, res) => {
    try {
      const { preAuthToken, otp } = req.body;
      if (!preAuthToken || !otp) return res.status(400).json({ error: "Missing required fields" });

      let payload;
      try { payload = jwt.verify(preAuthToken, JWT_SECRET); }
      catch { return res.status(401).json({ error: "Session expired. Please log in again." }); }
      if (!payload.preAuth) return res.status(401).json({ error: "Invalid session token" });

      const result = await pool.query(
        `SELECT u.id,
                u.email,
                u."companyId" AS "companyId",
                u.role,
                u."firstName" AS "firstName",
                u."lastName" AS "lastName",
                u."lastLoginAt" AS "lastLoginAt",
                u."otpCodeHash" AS "otpCodeHash",
                u."otpExpiresAt" AS "otpExpiresAt",
                c."companyName" AS "companyName",
                c."assetManagementEnabled" AS "assetManagementEnabled",
                c."economicOperatorIdentifier" AS "economicOperatorIdentifier",
                c."economicOperatorIdentifierScheme" AS "economicOperatorIdentifierScheme"
         FROM users u
         LEFT JOIN companies c ON c.id = u."companyId"
         WHERE u.id = $1 AND u."isActive" = true`,
        [payload.userId]
      );
      if (!result.rows.length) return res.status(401).json({ error: "User not found" });
      const u = result.rows[0];

      const storedOtpHash = String(u.otpCodeHash || "").trim();
      if (!storedOtpHash || !u.otpExpiresAt || new Date() > new Date(u.otpExpiresAt)) {
        return res.status(401).json({ error: "Verification code has expired. Please log in again." });
      }

      const submitHash = hashOtpCode(otp);
      const storedBuf  = Buffer.from(storedOtpHash, "hex");
      const submitBuf  = Buffer.from(submitHash, "hex");
      if (storedBuf.length !== submitBuf.length || !crypto.timingSafeEqual(storedBuf, submitBuf)) {
        return res.status(401).json({ error: "Invalid verification code" });
      }

      await pool.query(
        'UPDATE users SET "otpCodeHash" = NULL, "otpCode" = NULL, "otpExpiresAt" = NULL, "lastLoginAt" = NOW() WHERE id = $1',
        [u.id]
      );
      const sessionToken = generateToken(u);
      setAuthCookie(res, sessionToken);
      res.json({
        success: true,
        token: sessionToken,
        user: buildAuthUserResponse(u),
      });
    } catch (e) { logger.error("OTP verify error:", e.message); res.status(500).json({ error: "Verification failed" }); }
  });

  // ─── LOGOUT ─────────────────────────────────────────────────────────────────
  app.post("/api/auth/logout", async (req, res) => {
    try {
      const authHeader = String(req.headers.authorization || "");
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      const cookieTokens = String(req.headers.cookie || "")
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`))
        .map((part) => {
          const rawValue = part.slice(`${SESSION_COOKIE_NAME}=`.length);
          try {
            return decodeURIComponent(rawValue);
          } catch {
            return rawValue;
          }
        })
        .filter(Boolean);
      const candidateTokens = [...new Set([bearerToken, ...cookieTokens].filter(Boolean))];
      for (const token of candidateTokens) {
        let payload;
        try {
          payload = jwt.verify(token, JWT_SECRET);
        } catch (_error) {
          continue;
        }
        await pool.query(
          'UPDATE users SET "sessionVersion" = COALESCE("sessionVersion", 1) + 1, "updatedAt" = NOW() WHERE id = $1',
          [payload.userId]
        ).catch((error) => {
          logger.warn({ err: error, userId: payload.userId }, "Failed to revoke session version during logout");
        });
        break;
      }
    } finally {
      clearAuthCookie(res);
      res.json({ success: true });
    }
  });

  app.get("/api/auth/sso/providers", publicReadRateLimit, async (_req, res) => {
    try {
      res.json({ providers: oauthService?.isEnabled ? oauthService.listProviders() : [] });
    } catch (e) {
      res.status(500).json({ error: "Failed to load SSO providers" });
    }
  });

  app.get("/api/auth/sso/:providerKey/start", publicReadRateLimit, async (req, res) => {
    try {
      if (!oauthService?.isEnabled) return res.status(404).json({ error: "SSO is not configured" });
      const redirectTo = String(req.query.next || "").trim();
      const authUrl = await oauthService.beginLogin(req.params.providerKey, req, redirectTo);
      res.redirect(authUrl);
    } catch (e) {
      res.status(400).json({ error: e.message || "Failed to start SSO login" });
    }
  });

  app.get("/api/auth/sso/:providerKey/callback", publicReadRateLimit, async (req, res) => {
    try {
      if (!oauthService?.isEnabled) return res.status(404).json({ error: "SSO is not configured" });
      const redirectUrl = await oauthService.handleCallback(req.params.providerKey, req, res);
      res.redirect(redirectUrl);
    } catch (e) {
      const appUrl = String(process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
      res.redirect(`${appUrl}/login?error=${encodeURIComponent(e.message || "SSO login failed")}`);
    }
  });

  // ─── RESEND OTP ─────────────────────────────────────────────────────────────
  app.post("/api/auth/resend-otp", otpRateLimit, async (req, res) => {
    try {
      const { preAuthToken } = req.body;
      if (!preAuthToken) return res.status(400).json({ error: "Missing token" });

      let payload;
      try { payload = jwt.verify(preAuthToken, JWT_SECRET); }
      catch { return res.status(401).json({ error: "Session expired. Please log in again." }); }
      if (!payload.preAuth) return res.status(401).json({ error: "Invalid session" });

      const result = await pool.query('SELECT * FROM users WHERE id = $1 AND "isActive" = true', [payload.userId]);
      if (!result.rows.length) return res.status(401).json({ error: "User not found" });
      const u = result.rows[0];

      const otp     = generateOtpCode();
      const otpHash = hashOtpCode(otp);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await pool.query(
        'UPDATE users SET "otpCodeHash" = $1, "otpCode" = NULL, "otpExpiresAt" = $2 WHERE id = $3',
        [otpHash, expiresAt, u.id]
      );
      await sendOtpEmail(u, otp);
      res.json({ success: true });
    } catch (e) { logger.error("Resend OTP error:", e.message); res.status(500).json({ error: "Failed to resend code" }); }
  });

  // ─── FORGOT PASSWORD ─────────────────────────────────────────────────────────
  app.post("/api/auth/forgot-password", passwordResetRateLimit, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Email required" });
      const u = await pool.query('SELECT id FROM users WHERE email = $1 AND "isActive" = true', [email]);
      if (!u.rows.length) return res.json({ success: true });
      const token = uuidv4();
      const tokenHash = hashOpaqueToken(token);
      const exp   = new Date(Date.now() + 60 * 60 * 1000);
      await pool.query(
        "INSERT INTO \"passwordResetTokens\" (\"userId\", token, \"expiresAt\") VALUES ($1,$2,$3)",
        [u.rows[0].id, tokenHash, exp]
      );
      const resetUrl = `${process.env.APP_URL || "http://localhost:3000"}/reset-password?token=${token}`;
      await createTransporter().sendMail({
        from: process.env.EMAIL_FROM || "noreply@example.com", to: email,
        subject: "Reset your Digital Product Passport password",
        html: brandedEmail({ preheader: "Password Reset Request", bodyHtml: `
          <p>We received a request to reset the password for <strong>${email}</strong>.</p>
          <div class="cta-wrap"><a href="${resetUrl}" class="cta-btn">🔐 Reset Password →</a></div>
          <p style="font-size:13px;color:#888;text-align:center">If you didn't request this, you can safely ignore this email.</p>` }),
      });
      res.json({ success: true });
    } catch (e) { logger.error("Forgot password:", e.message); res.status(500).json({ error: "Failed to send email" }); }
  });

  app.get("/api/auth/validate-reset-token", publicReadRateLimit, async (req, res) => {
    try {
      const submittedToken = String(req.query.token || "");
      const submittedHash = hashOpaqueToken(submittedToken);
      const r = await pool.query(
        "SELECT id FROM \"passwordResetTokens\" WHERE token = ANY($1::text[]) AND used = false AND \"expiresAt\" > NOW()",
        [[submittedToken, submittedHash]]
      );
      res.json({ valid: r.rows.length > 0 });
    } catch { res.status(500).json({ valid: false }); }
  });

  app.post("/api/auth/reset-password", passwordResetRateLimit, async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) return res.status(400).json({ error: "token and newPassword required" });
      const passwordPolicyError = validatePasswordPolicy(newPassword);
      if (passwordPolicyError) return res.status(400).json({ error: passwordPolicyError });
      const tokenHash = hashOpaqueToken(token);
      const r = await pool.query(
        "SELECT \"userId\" FROM \"passwordResetTokens\" WHERE token = ANY($1::text[]) AND used = false AND \"expiresAt\" > NOW()",
        [[token, tokenHash]]
      );
      if (!r.rows.length) return res.status(400).json({ error: "Invalid or expired token" });
      const { hash, pepperVersion } = await hashPassword(newPassword);
      await pool.query(
        `UPDATE users
         SET "passwordHash" = $1,
             "pepperVersion" = $2,
             "sessionVersion" = COALESCE("sessionVersion", 1) + 1,
             "updatedAt" = NOW()
         WHERE id = $3`,
        [hash, pepperVersion, r.rows[0].userId]
      );
      await pool.query("UPDATE \"passwordResetTokens\" SET used = true WHERE token = ANY($1::text[])", [[token, tokenHash]]);
      res.json({ success: true });
    } catch (e) {
      logger.error("Reset password error:", e.message);
      res.status(500).json({ error: "Password reset failed" });
    }
  });

  // ─── COMPANY INVITE ──────────────────────────────────────────────────────────
  app.post("/api/companies/:companyId/invite", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const { inviteeEmail, roleToAssign } = req.body;
      if (!inviteeEmail) return res.status(400).json({ error: "Invitee email is required" });
      if (!process.env.EMAIL_PASS) return res.status(500).json({ error: "Email not configured on server." });

      const existing = await pool.query("SELECT id FROM users WHERE email = $1", [inviteeEmail]);
      if (existing.rows.length) return res.status(400).json({ error: "This email is already registered" });

      await pool.query(
        `UPDATE "inviteTokens" SET "expiresAt" = NOW()
         WHERE email = $1 AND "companyId" = $2 AND used = false AND "expiresAt" > NOW()`,
        [inviteeEmail, companyId]
      );

      const company = await pool.query('SELECT "companyName" AS "companyName" FROM companies WHERE id = $1', [companyId]);
      if (!company.rows.length) return res.status(404).json({ error: "Company not found" });
      const companyName = company.rows[0].companyName;

      const inviter = await pool.query('SELECT "firstName" AS "firstName", "lastName" AS "lastName", email FROM users WHERE id = $1', [req.user.userId]);
      const inviterName = inviter.rows.length
        ? `${inviter.rows[0].firstName || ""} ${inviter.rows[0].lastName || ""}`.trim() || inviter.rows[0].email
        : "A colleague";

      const tokenValue = uuidv4();
      const expiresAt  = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const finalRole  = (req.user.role === "companyAdmin" || req.user.role === "superAdmin")
        ? (roleToAssign || "editor") : "viewer";

      await pool.query(
        `INSERT INTO "inviteTokens" (token, email, "companyId", "invitedBy", "expiresAt", "roleToAssign")
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tokenValue, inviteeEmail, companyId, req.user.userId, expiresAt, finalRole]
      );

      const appUrl      = process.env.APP_URL || "http://localhost:3000";
      const registerUrl = `${appUrl}/register?token=${tokenValue}`;

      await createTransporter().sendMail({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev", to: inviteeEmail,
        subject: `${inviterName} invited you to join ${companyName} on Digital Product Passport`,
        html: brandedEmail({ preheader: `You have been invited to join ${companyName}`, bodyHtml: `
          <p><strong>${inviterName}</strong> has invited you to join <strong>${companyName}</strong>.</p>
          ${renderInfoTable([
            { label: "Your Email", value: inviteeEmail },
            { label: "Company", value: companyName },
            { label: "Role", value: finalRole },
          ])}
          <div style="background:#fff9e8;border:1px solid #efd38f;border-radius:8px;padding:12px 14px;margin:16px 0;font-size:13px;color:#7a5a00;line-height:1.6">
            ⏰ This invitation expires in <strong style="color:#5e4300">48 hours</strong> and can only be used <strong style="color:#5e4300">once</strong>.
          </div>
          <div class="cta-wrap"><a href="${registerUrl}" class="cta-btn">Accept Invitation →</a></div>` }),
      });

      res.json({ success: true, message: `Invitation sent to ${inviteeEmail}` });
    } catch (e) {
      logger.error("Invite error:", e.message);
      res.status(500).json({ error: "Failed to send invitation.", detail: e.message });
    }
  });

  // ─── USER PROFILE ────────────────────────────────────────────────────────────
  app.get("/api/users/me", authenticateToken, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT u.id, u.email, u."firstName" AS "firstName", u."lastName" AS "lastName", u.role,
                u."companyId" AS "companyId", u."avatarUrl" AS "avatarUrl", u.phone, u."jobTitle" AS "jobTitle", u.bio,
                u."authSource" AS "authSource", u."ssoOnly" AS "ssoOnly",
                u."preferredLanguage" AS "preferredLanguage", u."defaultReviewerId" AS "defaultReviewerId",
                u."defaultApproverId" AS "defaultApproverId", u."createdAt" AS "createdAt", u."lastLoginAt" AS "lastLoginAt",
                u."twoFactorEnabled" AS "twoFactorEnabled", c."companyName" AS "companyName", c."assetManagementEnabled" AS "assetManagementEnabled",
                c."economicOperatorIdentifier" AS "economicOperatorIdentifier", c."economicOperatorIdentifierScheme" AS "economicOperatorIdentifierScheme"
         FROM users u
         LEFT JOIN companies c ON c.id = u."companyId"
         WHERE u.id = $1`,
        [req.user.userId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Not found" });
      res.json(buildAuthUserResponse(r.rows[0]));
    } catch { res.status(500).json({ error: "Failed" }); }
  });

  app.post("/api/users/me/token", authenticateToken, async (req, res) => {
    try {
      const freshToken = generateToken(req.user, undefined, undefined, undefined, undefined, {
        mfaVerifiedAt: req.user?.mfaVerifiedAt || null,
        amr: req.user?.authenticationMethods || ["pwd"]
      });
      res.json({ token: freshToken });
    } catch {
      res.status(500).json({ error: "Failed to issue bearer token" });
    }
  });

  app.patch("/api/users/me", authenticateToken, async (req, res) => {
    try {
      const fieldMap = new Map([
        ["firstName", "\"firstName\""],
        ["lastName", "\"lastName\""],
        ["phone", "phone"],
        ["jobTitle", "\"jobTitle\""],
        ["bio", "bio"],
        ["avatarUrl", "\"avatarUrl\""],
        ["defaultReviewerId", "\"defaultReviewerId\""],
        ["defaultApproverId", "\"defaultApproverId\""],
        ["preferredLanguage", "\"preferredLanguage\""],
      ]);
      const updates = [];
      for (const [inputKey, columnName] of fieldMap.entries()) {
        if (!Object.prototype.hasOwnProperty.call(req.body || {}, inputKey)) continue;
        updates.push([columnName, req.body[inputKey] !== undefined ? req.body[inputKey] : null]);
      }
      if (!updates.length) return res.status(400).json({ error: "Nothing to update" });
      const sets = updates.map(([columnName], i) => `${columnName} = $${i + 1}`).join(", ");
      const vals = updates.map(([, value]) => value);
      await pool.query(`UPDATE users SET ${sets}, "updatedAt" = NOW() WHERE id = $${updates.length + 1}`,
        [...vals, req.user.userId]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed to update profile" }); }
  });

  app.patch("/api/users/me/2fa", authenticateToken, async (req, res) => {
    try {
      const { enable, currentPassword } = req.body;
      if (typeof enable !== "boolean") return res.status(400).json({ error: "enable (boolean) required" });
      if (!currentPassword) return res.status(400).json({ error: "Current password required" });

      const u = await pool.query('SELECT "passwordHash" AS "passwordHash" FROM users WHERE id = $1', [req.user.userId]);
      if (!u.rows.length) return res.status(404).json({ error: "User not found" });
      if (!await verifyPassword(currentPassword, u.rows[0].passwordHash))
        return res.status(401).json({ error: "Current password is incorrect" });

      await pool.query(
        'UPDATE users SET "twoFactorEnabled" = $1, "updatedAt" = NOW() WHERE id = $2',
        [enable, req.user.userId]
      );
      res.json({ success: true, twoFactorEnabled: enable });
    } catch (e) { logger.error("2FA toggle error:", e.message); res.status(500).json({ error: "Failed to update 2FA setting" }); }
  });

  app.patch("/api/users/me/password", authenticateToken, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) return res.status(400).json({ error: "Both passwords required" });
      const passwordPolicyError = validatePasswordPolicy(newPassword);
      if (passwordPolicyError) return res.status(400).json({ error: passwordPolicyError });
      const u = await pool.query('SELECT "passwordHash" AS "passwordHash" FROM users WHERE id = $1', [req.user.userId]);
      if (!await verifyPassword(currentPassword, u.rows[0].passwordHash))
        return res.status(401).json({ error: "Current password is incorrect" });
      const { hash, pepperVersion } = await hashPassword(newPassword);
      const updated = await pool.query(
        `UPDATE users
         SET "passwordHash" = $1,
             "pepperVersion" = $2,
             "sessionVersion" = COALESCE("sessionVersion", 1) + 1,
             "updatedAt" = NOW()
         WHERE id = $3
         RETURNING id, email, "companyId" AS "companyId", role, "sessionVersion" AS "sessionVersion"`,
        [hash, pepperVersion, req.user.userId]
      );
      const mfaEnabled = !!req.user?.mfaEnabled;
      const freshToken = generateToken(updated.rows[0], undefined, undefined, undefined, undefined, {
        mfaVerifiedAt: mfaEnabled ? new Date().toISOString() : null,
        amr: mfaEnabled ? ["pwd", "otp"] : ["pwd"]
      });
      setAuthCookie(res, freshToken);
      res.json({ success: true, minPasswordLength: PASSWORD_MIN_LENGTH });
    } catch { res.status(500).json({ error: "Failed" }); }
  });

  // ─── COMPANY USERS (team management) ─────────────────────────────────────────
  app.get("/api/companies/:companyId/users", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT u.id, u.email, u."firstName" AS "firstName", u."lastName" AS "lastName", u.role, u."jobTitle" AS "jobTitle", u."avatarUrl" AS "avatarUrl",
                u."isActive" AS "isActive", u."createdAt" AS "createdAt",
                (SELECT COUNT(*) FROM "passportRegistry" pr WHERE pr."companyId" = u."companyId" AND pr."passportType" IS NOT NULL) AS "passportCount"
         FROM users u
         WHERE u."companyId" = $1 AND u.role != 'superAdmin'
         ORDER BY u.role, u."firstName"`,
        [req.params.companyId]
      );
      res.json(r.rows.map(buildCompanyMemberResponse));
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  app.patch("/api/companies/:companyId/users/:userId", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      if (req.user.role !== "companyAdmin" && req.user.role !== "superAdmin")
        return res.status(403).json({ error: "Admin only" });
      const { role } = req.body;
      if (!["companyAdmin","editor","viewer"].includes(role))
        return res.status(400).json({ error: "Invalid role" });
      const updated = await pool.query('UPDATE users SET role = $1, "sessionVersion" = COALESCE("sessionVersion", 1) + 1, "updatedAt" = NOW() WHERE id = $2 AND "companyId" = $3 RETURNING id, role, "sessionVersion" AS "sessionVersion", "isActive" AS "isActive"',
        [role, req.params.userId, req.params.companyId]);
      await logAudit(
        req.params.companyId,
        req.user.userId,
        "CHANGE_USER_ROLE",
        "users",
        String(req.params.userId),
        null,
        { role, sessionVersion: updated.rows[0]?.sessionVersion || null },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
          audience: "companyAdmin",
        }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "USER_ROLE_CHANGED",
        severity: "high",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: req.params.userId,
        revocationMode: "roleChange",
        metadata: { role },
      }).catch((error) => {
        logger.warn({ err: error, companyId: req.params.companyId, userId: req.params.userId }, "Failed to replicate user role change event");
      });
      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error, companyId: req.params.companyId, userId: req.params.userId }, "Failed to change user role");
      res.status(500).json({ error: "Failed" });
    }
  });

  app.patch("/api/companies/:companyId/users/:userId/deactivate", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      if (req.user.role !== "companyAdmin" && req.user.role !== "superAdmin")
        return res.status(403).json({ error: "Admin only" });
      const deactivated = await pool.query('UPDATE users SET "isActive" = false, "sessionVersion" = COALESCE("sessionVersion", 1) + 1, "updatedAt" = NOW() WHERE id = $1 AND "companyId" = $2 RETURNING id, role, "sessionVersion" AS "sessionVersion", "isActive" AS "isActive"',
        [req.params.userId, req.params.companyId]);
      await pool.query(
        `UPDATE "userAccessAudiences"
         SET "isActive" = false,
             "updatedAt" = NOW()
        WHERE "userId" = $1
          AND ("companyId" = $2 OR "companyId" IS NULL)`,
        [req.params.userId, req.params.companyId]
      ).catch((error) => {
        logger.warn({ err: error, companyId: req.params.companyId, userId: req.params.userId }, "Failed to deactivate delegated user audiences");
      });
      await pool.query(
        `UPDATE "passportAccessGrants"
         SET "isActive" = false,
             "updatedAt" = NOW()
         WHERE "granteeUserId" = $1
           AND "companyId" = $2`,
        [req.params.userId, req.params.companyId]
      ).catch((error) => {
        logger.warn({ err: error, companyId: req.params.companyId, userId: req.params.userId }, "Failed to deactivate passport access grants for user");
      });
      await logAudit(
        req.params.companyId,
        req.user.userId,
        "DEACTIVATE_USER_ACCESS",
        "users",
        String(req.params.userId),
        null,
        { isActive: false, sessionVersion: deactivated.rows[0]?.sessionVersion || null },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
          audience: "companyAdmin",
        }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "USER_DEACTIVATED",
        severity: "critical",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: req.params.userId,
        revocationMode: "emergency",
        metadata: {
          sessionVersion: deactivated.rows[0]?.sessionVersion || null,
          revokedDelegatedAudiences: true,
          revokedPassportGrants: true,
        },
      }).catch((error) => {
        logger.warn({ err: error, companyId: req.params.companyId, userId: req.params.userId }, "Failed to replicate user deactivation event");
      });
      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error, companyId: req.params.companyId, userId: req.params.userId }, "Failed to deactivate user");
      res.status(500).json({ error: "Failed" });
    }
  });

  app.post("/api/companies/:companyId/users/:userId/revoke-sessions", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      if (req.user.role !== "companyAdmin" && req.user.role !== "superAdmin")
        return res.status(403).json({ error: "Admin only" });
      const reason = req.body?.reason || "User sessions revoked";
      const updated = await pool.query(
        `UPDATE users
         SET "sessionVersion" = COALESCE("sessionVersion", 1) + 1,
             "updatedAt" = NOW()
         WHERE id = $1 AND "companyId" = $2
         RETURNING id, role, "sessionVersion" AS "sessionVersion", "isActive" AS "isActive"`,
        [req.params.userId, req.params.companyId]
      );
      if (!updated.rows.length) return res.status(404).json({ error: "User not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REVOKE_USER_SESSIONS",
        "users",
        String(req.params.userId),
        null,
        { sessionVersion: updated.rows[0].sessionVersion, reason },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
          audience: "companyAdmin",
        }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "USER_SESSIONS_REVOKED",
        severity: "critical",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: req.params.userId,
        revocationMode: "emergency",
        reason,
        metadata: { sessionVersion: updated.rows[0].sessionVersion },
      }).catch((error) => {
        logger.warn({ err: error, companyId: req.params.companyId, userId: req.params.userId }, "Failed to replicate user session revocation event");
      });

      res.json({
        success: true,
        revoked: true,
        emergency: true,
        sessionVersion: updated.rows[0].sessionVersion,
      });
    } catch (error) {
      logger.error({ err: error, companyId: req.params.companyId, userId: req.params.userId }, "Failed to revoke user sessions");
      res.status(500).json({ error: "Failed to revoke user sessions" });
    }
  });
};
