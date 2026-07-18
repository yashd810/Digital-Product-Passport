"use strict";
const crypto = require("crypto");
const logger = require("../../services/logger");
const {
  getEmailFromAddress,
  isEmailConfigured,
  renderPasswordResetBody,
  renderCompanyInvitationBody,
} = require("../../services/email");
const { getAppOrigin } = require("../../shared/security/configured-origin");
const { normalizeSafeImageReference } = require("../../shared/passports/passport-uri");

module.exports = function registerAuthRoutes(app, {
  pool,
  jwt,
  jwtSecret,
  hashPassword,
  verifyPassword,
  generateToken,
  hashOpaqueToken,
  generateOneTimeToken,
  validatePasswordPolicy,
  passwordMinLength,
  hashOtpCode,
  generateOtpCode,
  sessionCookieName,
  setAuthCookie,
  clearAuthCookie,
  sendOtpEmail,
  createTransporter,
  brandedEmail,
  logAudit,
  authRateLimit,
  otpRateLimit,
  passwordResetRateLimit,
  publicReadRateLimit,
  authenticateToken,
  checkCompanyAccess,
  requireEditor,
  oauthService,
  backupProviderService,
}) {
  const safeAvatarUrl = (value) => {
    try {
      return normalizeSafeImageReference(value);
    } catch {
      return null;
    }
  };
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
      avatarUrl: safeAvatarUrl(row.avatarUrl),
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
      avatarUrl: safeAvatarUrl(row.avatarUrl),
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
      return { success: true, skipped: true, reason: "backupServiceUnavailable" };
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
      const tokenHash = hashOpaqueToken(token);
      const passwordPolicyError = validatePasswordPolicy(password);
      if (passwordPolicyError) return res.status(400).json({ error: passwordPolicyError });
      const { hash, pepperVersion } = await hashPassword(password);
      const client = await pool.connect();
      let invite;
      let u;
      try {
        await client.query("BEGIN");
        const tokenRow = await client.query(
          `UPDATE "inviteTokens"
           SET used = true
           WHERE "tokenHash" = $1
             AND used = false
             AND "expiresAt" > NOW()
             AND "approvalStatus" = 'approved'
           RETURNING *`,
          [tokenHash]
        );
        if (!tokenRow.rows.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Invalid or expired invitation link. Please ask for a new invite." });
        }
        invite = tokenRow.rows[0];

        const existing = await client.query("SELECT id FROM users WHERE email = $1", [invite.email]);
        if (existing.rows.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "This email is already registered" });
        }

        const role = invite.roleToAssign || "editor";
        const assignedCompanyId = role === "superAdmin" ? null : invite.companyId;
        const result = await client.query(
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
        u = result.rows[0];
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }

      const company = invite.companyId
        ? await pool.query(
            `SELECT "companyName" AS "companyName",
                    "assetManagementEnabled" AS "assetManagementEnabled",
                    "economicOperatorIdentifier" AS "economicOperatorIdentifier",
                    "economicOperatorIdentifierScheme" AS "economicOperatorIdentifierScheme"
             FROM companies
             WHERE id = $1`,
            [invite.companyId]
          )
        : { rows: [] };
      const companyRow = company.rows[0] || {};
      const sessionToken = generateToken(u);
      setAuthCookie(res, sessionToken);
      res.status(201).json({
        success: true,
        user: buildAuthUserResponse({
          ...u,
          companyName: companyRow.companyName || null,
          assetManagementEnabled: companyRow.assetManagementEnabled || false,
          economicOperatorIdentifier: companyRow.economicOperatorIdentifier || null,
          economicOperatorIdentifierScheme: companyRow.economicOperatorIdentifierScheme || null,
        }),
      });
    } catch (e) {
      logger.error({ err: e }, "Register error");
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // ─── VALIDATE INVITE ────────────────────────────────────────────────────────
  app.post("/api/invite/validate", publicReadRateLimit, async (req, res) => {
    try {
      const { token } = req.body || {};
      if (!token) return res.status(400).json({ error: "Token is required" });
      const tokenHash = hashOpaqueToken(token);
      const row = await pool.query(
        `SELECT it.email, it."expiresAt", it.used, it."roleToAssign", it."approvalStatus", c."companyName" AS "companyName"
         FROM "inviteTokens" it LEFT JOIN companies c ON c.id = it."companyId" WHERE it."tokenHash" = $1`,
        [tokenHash]
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
      const normalizedEmail = String(email).trim().toLowerCase();

      // Per-email lockout: max 5 failures in 15 minutes
      const lockKey = `login-lockout:${normalizedEmail}`;
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
                u."firstName" AS "firstName",
                u."lastName" AS "lastName",
                u."isActive" AS "isActive",
                u."sessionVersion" AS "sessionVersion",
                u."twoFactorEnabled" AS "twoFactorEnabled",
                u."otpCodeHash" AS "otpCodeHash",
                u."otpExpiresAt" AS "otpExpiresAt",
                u."ssoOnly" AS "ssoOnly",
                u."authSource" AS "authSource",
                u."avatarUrl" AS "avatarUrl",
                u.phone,
                u."jobTitle" AS "jobTitle",
                u.bio,
                u."preferredLanguage" AS "preferredLanguage",
                u."defaultReviewerId" AS "defaultReviewerId",
                u."defaultApproverId" AS "defaultApproverId",
                u."createdAt" AS "createdAt",
                u."lastLoginAt" AS "lastLoginAt",
                c."companyName" AS "companyName",
                c."assetManagementEnabled" AS "assetManagementEnabled",
                c."economicOperatorIdentifier" AS "economicOperatorIdentifier",
                c."economicOperatorIdentifierScheme" AS "economicOperatorIdentifierScheme"
         FROM users u
         LEFT JOIN companies c ON c.id = u."companyId"
         WHERE u.email = $1 AND u."isActive" = true`,
        [normalizedEmail]
      );
      if (!result.rows.length) return res.status(401).json({ error: "Invalid credentials" });
      const u  = result.rows[0];
      if (u.ssoOnly) {
        return res.status(400).json({ error: "This account uses enterprise SSO. Use the SSO sign-in option instead." });
      }
      const passwordValid = await verifyPassword(password, u.passwordHash);
      if (!passwordValid) {
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
          logger.warn({ err: error, email: normalizedEmail }, "Failed to increment login lockout counter");
        });
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Clear lockout on successful login
      await pool.query("DELETE FROM \"requestRateLimits\" WHERE \"bucketKey\" = $1", [lockKey]).catch((error) => {
        logger.warn({ err: error, email: normalizedEmail }, "Failed to clear login lockout counter");
      });

      if (u.twoFactorEnabled) {
        if (!isEmailConfigured()) {
          return res.status(503).json({ error: "Two-factor email delivery is not configured on the server." });
        }
        const otp     = generateOtpCode();
        const otpHash = hashOtpCode(otp);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await pool.query(
          'UPDATE users SET "otpCodeHash" = $1, "otpExpiresAt" = $2 WHERE id = $3',
          [otpHash, expiresAt, u.id]
        );
        try { await sendOtpEmail(u, otp); }
        catch (emailErr) {
          logger.error("OTP email failed:", emailErr.message);
          return res.status(500).json({ error: "Failed to send verification code. Please try again." });
        }
        const preAuthToken = jwt.sign({ userId: u.id, preAuth: true }, jwtSecret, {
          algorithm: "HS256",
          expiresIn: "10m",
          issuer: "dpp-api",
          audience: "dpp-mfa",
        });
        return res.json({ requiresTwoFactor: true, preAuthToken });
      }

      await pool.query('UPDATE users SET "lastLoginAt" = NOW() WHERE id = $1', [u.id]).catch((error) => {
        logger.warn({ err: error, userId: u.id }, "Failed to update password login timestamp");
      });
      const sessionToken = generateToken(u);
      setAuthCookie(res, sessionToken);
      res.json({
        success: true,
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
      try {
        payload = jwt.verify(preAuthToken, jwtSecret, {
          algorithms: ["HS256"],
          issuer: "dpp-api",
          audience: "dpp-mfa",
        });
      }
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
                u."authSource" AS "authSource",
                u."ssoOnly" AS "ssoOnly",
                u."avatarUrl" AS "avatarUrl",
                u.phone,
                u."jobTitle" AS "jobTitle",
                u.bio,
                u."preferredLanguage" AS "preferredLanguage",
                u."defaultReviewerId" AS "defaultReviewerId",
                u."defaultApproverId" AS "defaultApproverId",
                u."createdAt" AS "createdAt",
                u."twoFactorEnabled" AS "twoFactorEnabled",
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
        'UPDATE users SET "otpCodeHash" = NULL, "otpExpiresAt" = NULL, "lastLoginAt" = NOW() WHERE id = $1',
        [u.id]
      );
      const sessionToken = generateToken(u, undefined, undefined, undefined, undefined, {
        mfaVerifiedAt: new Date().toISOString(),
        amr: ["pwd", "otp"],
      });
      setAuthCookie(res, sessionToken);
      res.json({
        success: true,
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
        .filter((part) => part.startsWith(`${sessionCookieName}=`))
        .map((part) => {
          const rawValue = part.slice(`${sessionCookieName}=`.length);
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
          payload = jwt.verify(token, jwtSecret, {
            algorithms: ["HS256"],
            issuer: "dpp-api",
            audience: "dpp-app",
          });
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
      const authUrl = await oauthService.beginLogin(req.params.providerKey, res, redirectTo);
      res.redirect(authUrl);
    } catch (e) {
      logger.warn({ err: e, providerKey: req.params.providerKey }, "Failed to start SSO login");
      res.status(400).json({ error: "Failed to start SSO login" });
    }
  });

  app.get("/api/auth/sso/:providerKey/callback", publicReadRateLimit, async (req, res) => {
    try {
      if (!oauthService?.isEnabled) return res.status(404).json({ error: "SSO is not configured" });
      const redirectUrl = await oauthService.handleCallback(req.params.providerKey, req, res);
      res.redirect(redirectUrl);
    } catch (e) {
      logger.warn({ err: e, providerKey: req.params.providerKey }, "SSO login callback failed");
      const appUrl = getAppOrigin();
      res.redirect(`${appUrl}/login?error=${encodeURIComponent("SSO login failed")}`);
    }
  });

  // ─── RESEND OTP ─────────────────────────────────────────────────────────────
  app.post("/api/auth/resend-otp", otpRateLimit, async (req, res) => {
    try {
      const { preAuthToken } = req.body;
      if (!preAuthToken) return res.status(400).json({ error: "Missing token" });

      let payload;
      try {
        payload = jwt.verify(preAuthToken, jwtSecret, {
          algorithms: ["HS256"],
          issuer: "dpp-api",
          audience: "dpp-mfa",
        });
      }
      catch { return res.status(401).json({ error: "Session expired. Please log in again." }); }
      if (!payload.preAuth) return res.status(401).json({ error: "Invalid session" });

      const result = await pool.query('SELECT * FROM users WHERE id = $1 AND "isActive" = true', [payload.userId]);
      if (!result.rows.length) return res.status(401).json({ error: "User not found" });
      const u = result.rows[0];

      if (!isEmailConfigured()) {
        return res.status(503).json({ error: "Two-factor email delivery is not configured on the server." });
      }

      const otp     = generateOtpCode();
      const otpHash = hashOtpCode(otp);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await pool.query(
        'UPDATE users SET "otpCodeHash" = $1, "otpExpiresAt" = $2 WHERE id = $3',
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
      const normalizedEmail = String(email).trim().toLowerCase();
      if (!isEmailConfigured()) {
        return res.status(503).json({ error: "Password reset email delivery is not configured on the server." });
      }
      const u = await pool.query('SELECT id FROM users WHERE email = $1 AND "isActive" = true', [normalizedEmail]);
      if (!u.rows.length) return res.json({ success: true });
      const token = generateOneTimeToken();
      const tokenHash = hashOpaqueToken(token);
      const exp   = new Date(Date.now() + 60 * 60 * 1000);
      await pool.query(
        "INSERT INTO \"passwordResetTokens\" (\"userId\", \"tokenHash\", \"expiresAt\") VALUES ($1,$2,$3)",
        [u.rows[0].id, tokenHash, exp]
      );
      const resetUrl = `${getAppOrigin()}/reset-password#token=${encodeURIComponent(token)}`;
      await createTransporter().sendMail({
        from: getEmailFromAddress(), to: normalizedEmail,
        subject: "Reset your Digital Product Passport password",
        html: brandedEmail({
          preheader: "Password Reset Request",
          bodyHtml: renderPasswordResetBody({ email: normalizedEmail, resetUrl }),
        }),
      });
      res.json({ success: true });
    } catch (e) { logger.error("Forgot password:", e.message); res.status(500).json({ error: "Failed to send email" }); }
  });

  app.post("/api/auth/validate-reset-token", publicReadRateLimit, async (req, res) => {
    try {
      const submittedToken = String(req.body?.token || "");
      const submittedHash = hashOpaqueToken(submittedToken);
      const r = await pool.query(
        "SELECT id FROM \"passwordResetTokens\" WHERE \"tokenHash\" = $1 AND used = false AND \"expiresAt\" > NOW()",
        [submittedHash]
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
      const { hash, pepperVersion } = await hashPassword(newPassword);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query(
          `UPDATE "passwordResetTokens"
           SET used = true
           WHERE "tokenHash" = $1 AND used = false AND "expiresAt" > NOW()
           RETURNING "userId"`,
          [tokenHash]
        );
        if (!claimed.rows.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Invalid or expired token" });
        }
        await client.query(
          `UPDATE users
           SET "passwordHash" = $1,
               "pepperVersion" = $2,
               "sessionVersion" = COALESCE("sessionVersion", 1) + 1,
               "updatedAt" = NOW()
           WHERE id = $3`,
          [hash, pepperVersion, claimed.rows[0].userId]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      res.json({ success: true });
    } catch (e) {
      logger.error("Reset password error:", e.message);
      res.status(500).json({ error: "Password reset failed" });
    }
  });

  // ─── COMPANY INVITE ──────────────────────────────────────────────────────────
  app.post("/api/companies/:companyId/invite", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const { inviteeEmail, roleToAssign } = req.body;
      if (!inviteeEmail) return res.status(400).json({ error: "Invitee email is required" });
      const normalizedInviteeEmail = String(inviteeEmail).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedInviteeEmail)) {
        return res.status(400).json({ error: "Invalid email address" });
      }
      const finalRole = (req.user.role === "companyAdmin" || req.user.role === "superAdmin")
        ? (roleToAssign || "editor")
        : "viewer";
      if (!["companyAdmin", "editor", "viewer"].includes(finalRole)) {
        return res.status(400).json({ error: "Invalid role" });
      }
      if (!isEmailConfigured()) return res.status(503).json({ error: "Email is not configured on the server." });

      const existing = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedInviteeEmail]);
      if (existing.rows.length) return res.status(400).json({ error: "This email is already registered" });

      await pool.query(
        `UPDATE "inviteTokens" SET "expiresAt" = NOW()
         WHERE email = $1 AND "companyId" = $2 AND used = false AND "expiresAt" > NOW()`,
        [normalizedInviteeEmail, companyId]
      );

      const company = await pool.query('SELECT "companyName" AS "companyName" FROM companies WHERE id = $1', [companyId]);
      if (!company.rows.length) return res.status(404).json({ error: "Company not found" });
      const companyName = company.rows[0].companyName;

      const inviter = await pool.query('SELECT "firstName" AS "firstName", "lastName" AS "lastName", email FROM users WHERE id = $1', [req.user.userId]);
      const inviterName = inviter.rows.length
        ? `${inviter.rows[0].firstName || ""} ${inviter.rows[0].lastName || ""}`.trim() || inviter.rows[0].email
        : "A colleague";

      const tokenValue = generateOneTimeToken();
      const tokenHash = hashOpaqueToken(tokenValue);
      const expiresAt  = new Date(Date.now() + 48 * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO "inviteTokens" ("tokenHash", email, "companyId", "invitedBy", "expiresAt", "roleToAssign")
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tokenHash, normalizedInviteeEmail, companyId, req.user.userId, expiresAt, finalRole]
      );

      const appUrl      = getAppOrigin();
      const registerUrl = `${appUrl}/register#token=${encodeURIComponent(tokenValue)}`;

      await createTransporter().sendMail({
        from: getEmailFromAddress(), to: normalizedInviteeEmail,
        subject: `${inviterName} invited you to join ${companyName} on Digital Product Passport`.replace(/[\r\n]+/g, " "),
        html: brandedEmail({
          preheader: `You have been invited to join ${companyName}`,
          bodyHtml: renderCompanyInvitationBody({
            inviterName,
            companyName,
            inviteeEmail: normalizedInviteeEmail,
            role: finalRole,
            registerUrl,
          }),
        }),
      });

      res.json({ success: true, message: `Invitation sent to ${normalizedInviteeEmail}` });
    } catch (e) {
      logger.error("Invite error:", e.message);
      res.status(500).json({ error: "Failed to send invitation." });
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
        let value = req.body[inputKey] !== undefined ? req.body[inputKey] : null;
        if (inputKey === "avatarUrl" && value !== null && value !== "") {
          try {
            value = normalizeSafeImageReference(value);
          } catch {
            return res.status(400).json({ error: "avatarUrl must be a credential-free HTTP(S) or local resource URL" });
          }
        }
        updates.push([columnName, value || null]);
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
      const freshToken = generateToken(updated.rows[0], undefined, undefined, undefined, undefined, {
        mfaVerifiedAt: req.user?.mfaVerifiedAt || null,
        amr: req.user?.authenticationMethods || ["pwd"],
      });
      setAuthCookie(res, freshToken);
      res.json({ success: true, minPasswordLength: passwordMinLength });
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
        "changeUserRole",
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
        eventType: "userRoleChanged",
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
      await logAudit(
        req.params.companyId,
        req.user.userId,
        "deactivateUserAccess",
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
        eventType: "userDeactivated",
        severity: "critical",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: req.params.userId,
        revocationMode: "emergency",
        metadata: {
          sessionVersion: deactivated.rows[0]?.sessionVersion || null,
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
        "revokeUserSessions",
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
        eventType: "userSessionsRevoked",
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
