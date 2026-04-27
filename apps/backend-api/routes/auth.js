"use strict";
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

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
  SESSION_COOKIE_NAME,
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
  oauthService,
}) {

  // ─── REGISTER ──────────────────────────────────────────────────────────────
  app.post("/api/auth/register", authRateLimit, async (req, res) => {
    try {
      const { token, firstName, lastName, password } = req.body;
      if (!token || !firstName || !lastName || !password)
        return res.status(400).json({ error: "All fields are required" });
      const passwordPolicyError = validatePasswordPolicy(password);
      if (passwordPolicyError) return res.status(400).json({ error: passwordPolicyError });

      const tokenRow = await pool.query(
        `SELECT it.*, c.company_name FROM invite_tokens it
         LEFT JOIN companies c ON c.id = it.company_id
         WHERE it.token = $1 AND it.used = false AND it.expires_at > NOW()`,
        [token]
      );
      if (!tokenRow.rows.length)
        return res.status(400).json({ error: "Invalid or expired invitation link. Please ask for a new invite." });
      const invite = tokenRow.rows[0];

      const existing = await pool.query("SELECT id FROM users WHERE email = $1", [invite.email]);
      if (existing.rows.length)
        return res.status(400).json({ error: "This email is already registered" });

      const { hash, pepperVersion } = await hashPassword(password);
      const role = invite.role_to_assign || "editor";
      const assignedCompanyId = role === "super_admin" ? null : invite.company_id;
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, company_id, role, pepper_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, email, company_id, role, first_name, last_name, session_version`,
        [invite.email, hash, firstName, lastName, assignedCompanyId, role, pepperVersion]
      );
      await pool.query("UPDATE invite_tokens SET used = true WHERE token = $1", [token]);

      const u = result.rows[0];
      const sessionToken = generateToken(u);
      setAuthCookie(res, sessionToken);
      res.status(201).json({
        success: true,
        user: { id: u.id, email: u.email, companyId: u.company_id, role: u.role,
                first_name: u.first_name, last_name: u.last_name, company_name: invite.company_name || null },
      });
    } catch (e) { console.error("Register error:", e.message); res.status(500).json({ error: "Registration failed" }); }
  });

  // ─── VALIDATE INVITE ────────────────────────────────────────────────────────
  app.get("/api/invite/validate", publicReadRateLimit, async (req, res) => {
    try {
      const { token } = req.query;
      if (!token) return res.status(400).json({ error: "Token is required" });
      const row = await pool.query(
        `SELECT it.email, it.expires_at, it.used, it.role_to_assign, c.company_name
         FROM invite_tokens it LEFT JOIN companies c ON c.id = it.company_id WHERE it.token = $1`,
        [token]
      );
      if (!row.rows.length) return res.status(404).json({ valid: false, error: "Invitation not found." });
      const invite = row.rows[0];
      if (invite.used)    return res.status(400).json({ valid: false, error: "This invitation has already been used." });
      if (new Date(invite.expires_at) < new Date()) return res.status(400).json({ valid: false, error: "This invitation has expired." });
      res.json({
        valid: true,
        email: invite.email,
        company_name: invite.company_name || null,
        role_to_assign: invite.role_to_assign || null,
        expires_at: invite.expires_at,
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
        "SELECT count, reset_at FROM request_rate_limits WHERE bucket_key = $1",
        [lockKey]
      );
      if (lockRow.rows.length && lockRow.rows[0].count >= 5 && new Date() < new Date(lockRow.rows[0].reset_at)) {
        return res.status(429).json({ error: "Account temporarily locked due to too many failed attempts. Please try again later." });
      }

      const result = await pool.query(
        `SELECT u.*, c.company_name FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.email = $1 AND u.is_active = true`,
        [email]
      );
      if (!result.rows.length) return res.status(401).json({ error: "Invalid credentials" });
      const u  = result.rows[0];
      if (u.sso_only) {
        return res.status(400).json({ error: "This account uses enterprise SSO. Use the SSO sign-in option instead." });
      }
      const passwordCheck = await verifyPasswordAndUpgrade(password, u);
      if (!passwordCheck.valid) {
        // Increment lockout counter
        const resetAt = new Date(Date.now() + 15 * 60 * 1000);
        await pool.query(
          `INSERT INTO request_rate_limits (bucket_key, count, reset_at, updated_at)
           VALUES ($1, 1, $2, NOW())
           ON CONFLICT (bucket_key) DO UPDATE
           SET count = CASE WHEN request_rate_limits.reset_at <= NOW() THEN 1 ELSE request_rate_limits.count + 1 END,
               reset_at = CASE WHEN request_rate_limits.reset_at <= NOW() THEN $2 ELSE request_rate_limits.reset_at END,
               updated_at = NOW()`,
          [lockKey, resetAt]
        ).catch(() => {});
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (passwordCheck.needsUpgrade && passwordCheck.nextHash) {
        await pool.query(
          `UPDATE users
           SET password_hash = $1,
               pepper_version = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [passwordCheck.nextHash, passwordCheck.pepperVersion, u.id]
        ).catch(() => {});
      }

      // Clear lockout on successful login
      await pool.query("DELETE FROM request_rate_limits WHERE bucket_key = $1", [lockKey]).catch(() => {});

      if (u.two_factor_enabled) {
        const otp     = String(Math.floor(100000 + Math.random() * 900000));
        const otpHash = hashOtpCode(otp);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await pool.query(
          "UPDATE users SET otp_code_hash = $1, otp_code = NULL, otp_expires_at = $2 WHERE id = $3",
          [otpHash, expiresAt, u.id]
        );
        try { await sendOtpEmail(u, otp); }
        catch (emailErr) {
          console.error("OTP email failed:", emailErr.message);
          return res.status(500).json({ error: "Failed to send verification code. Please try again." });
        }
        const preAuthToken = jwt.sign({ userId: u.id, pre_auth: true }, JWT_SECRET, { expiresIn: "10m" });
        return res.json({ requires_2fa: true, pre_auth_token: preAuthToken });
      }

      await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [u.id]).catch(() => {});
      const sessionToken = generateToken(u);
      setAuthCookie(res, sessionToken);
      res.json({
        success: true,
        token: sessionToken,
        user: { id: u.id, email: u.email, companyId: u.company_id, role: u.role,
                first_name: u.first_name, last_name: u.last_name, company_name: u.company_name },
      });
    } catch (e) { console.error("Login error:", e.message); res.status(500).json({ error: "Login failed" }); }
  });

  // ─── VERIFY OTP (2FA second step) ───────────────────────────────────────────
  app.post("/api/auth/verify-otp", otpRateLimit, async (req, res) => {
    try {
      const { pre_auth_token, otp } = req.body;
      if (!pre_auth_token || !otp) return res.status(400).json({ error: "Missing required fields" });

      let payload;
      try { payload = jwt.verify(pre_auth_token, JWT_SECRET); }
      catch { return res.status(401).json({ error: "Session expired. Please log in again." }); }
      if (!payload.pre_auth) return res.status(401).json({ error: "Invalid session token" });

      const result = await pool.query(
        `SELECT u.*, c.company_name FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.id = $1 AND u.is_active = true`,
        [payload.userId]
      );
      if (!result.rows.length) return res.status(401).json({ error: "User not found" });
      const u = result.rows[0];

      const storedOtpHash = String(u.otp_code_hash || u.otp_code || "").trim();
      if (!storedOtpHash || !u.otp_expires_at || new Date() > new Date(u.otp_expires_at)) {
        return res.status(401).json({ error: "Verification code has expired. Please log in again." });
      }

      const submitHash = hashOtpCode(otp);
      const storedBuf  = Buffer.from(storedOtpHash, "hex");
      const submitBuf  = Buffer.from(submitHash, "hex");
      if (storedBuf.length !== submitBuf.length || !crypto.timingSafeEqual(storedBuf, submitBuf)) {
        return res.status(401).json({ error: "Invalid verification code" });
      }

      await pool.query(
        "UPDATE users SET otp_code_hash = NULL, otp_code = NULL, otp_expires_at = NULL, last_login_at = NOW() WHERE id = $1",
        [u.id]
      );
      const sessionToken = generateToken(u);
      setAuthCookie(res, sessionToken);
      res.json({
        success: true,
        token: sessionToken,
        user: { id: u.id, email: u.email, companyId: u.company_id, role: u.role,
                first_name: u.first_name, last_name: u.last_name, company_name: u.company_name },
      });
    } catch (e) { console.error("OTP verify error:", e.message); res.status(500).json({ error: "Verification failed" }); }
  });

  // ─── LOGOUT ─────────────────────────────────────────────────────────────────
  app.post("/api/auth/logout", async (req, res) => {
    try {
      const authHeader = String(req.headers.authorization || "");
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      const sessionCookie = String(req.headers.cookie || "")
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
      const cookieToken = sessionCookie ? decodeURIComponent(sessionCookie.slice(`${SESSION_COOKIE_NAME}=`.length)) : "";
      const token = bearerToken || cookieToken;
      if (token) {
        try {
          const payload = jwt.verify(token, JWT_SECRET);
          await pool.query(
            "UPDATE users SET session_version = COALESCE(session_version, 1) + 1, updated_at = NOW() WHERE id = $1",
            [payload.userId]
          );
        } catch {}
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
      const { pre_auth_token } = req.body;
      if (!pre_auth_token) return res.status(400).json({ error: "Missing token" });

      let payload;
      try { payload = jwt.verify(pre_auth_token, JWT_SECRET); }
      catch { return res.status(401).json({ error: "Session expired. Please log in again." }); }
      if (!payload.pre_auth) return res.status(401).json({ error: "Invalid session" });

      const result = await pool.query("SELECT * FROM users WHERE id = $1 AND is_active = true", [payload.userId]);
      if (!result.rows.length) return res.status(401).json({ error: "User not found" });
      const u = result.rows[0];

      const otp     = String(Math.floor(100000 + Math.random() * 900000));
      const otpHash = hashOtpCode(otp);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await pool.query(
        "UPDATE users SET otp_code_hash = $1, otp_code = NULL, otp_expires_at = $2 WHERE id = $3",
        [otpHash, expiresAt, u.id]
      );
      await sendOtpEmail(u, otp);
      res.json({ success: true });
    } catch (e) { console.error("Resend OTP error:", e.message); res.status(500).json({ error: "Failed to resend code" }); }
  });

  // ─── FORGOT PASSWORD ─────────────────────────────────────────────────────────
  app.post("/api/auth/forgot-password", passwordResetRateLimit, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Email required" });
      const u = await pool.query("SELECT id FROM users WHERE email = $1 AND is_active = true", [email]);
      if (!u.rows.length) return res.json({ success: true });
      const token = uuidv4();
      const tokenHash = hashOpaqueToken(token);
      const exp   = new Date(Date.now() + 60 * 60 * 1000);
      await pool.query(
        "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)",
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
    } catch (e) { console.error("Forgot password:", e.message); res.status(500).json({ error: "Failed to send email" }); }
  });

  app.get("/api/auth/validate-reset-token", publicReadRateLimit, async (req, res) => {
    try {
      const submittedToken = String(req.query.token || "");
      const submittedHash = hashOpaqueToken(submittedToken);
      const r = await pool.query(
        "SELECT id FROM password_reset_tokens WHERE token = ANY($1::text[]) AND used = false AND expires_at > NOW()",
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
        "SELECT user_id FROM password_reset_tokens WHERE token = ANY($1::text[]) AND used = false AND expires_at > NOW()",
        [[token, tokenHash]]
      );
      if (!r.rows.length) return res.status(400).json({ error: "Invalid or expired token" });
      const { hash, pepperVersion } = await hashPassword(newPassword);
      await pool.query(
        `UPDATE users
         SET password_hash = $1,
             pepper_version = $2,
             session_version = COALESCE(session_version, 1) + 1,
             updated_at = NOW()
         WHERE id = $3`,
        [hash, pepperVersion, r.rows[0].user_id]
      );
      await pool.query("UPDATE password_reset_tokens SET used = true WHERE token = ANY($1::text[])", [[token, tokenHash]]);
      res.json({ success: true });
    } catch { res.status(500).json({ error: "Password reset failed" }); }
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
        `UPDATE invite_tokens SET expires_at = NOW()
         WHERE email = $1 AND company_id = $2 AND used = false AND expires_at > NOW()`,
        [inviteeEmail, companyId]
      );

      const company = await pool.query("SELECT company_name FROM companies WHERE id = $1", [companyId]);
      if (!company.rows.length) return res.status(404).json({ error: "Company not found" });
      const company_name = company.rows[0].company_name;

      const inviter = await pool.query("SELECT first_name, last_name, email FROM users WHERE id = $1", [req.user.userId]);
      const inviterName = inviter.rows.length
        ? `${inviter.rows[0].first_name || ""} ${inviter.rows[0].last_name || ""}`.trim() || inviter.rows[0].email
        : "A colleague";

      const tokenValue = uuidv4();
      const expiresAt  = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const finalRole  = (req.user.role === "company_admin" || req.user.role === "super_admin")
        ? (roleToAssign || "editor") : "viewer";

      await pool.query(
        `INSERT INTO invite_tokens (token, email, company_id, invited_by, expires_at, role_to_assign)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tokenValue, inviteeEmail, companyId, req.user.userId, expiresAt, finalRole]
      );

      const appUrl      = process.env.APP_URL || "http://localhost:3000";
      const registerUrl = `${appUrl}/register?token=${tokenValue}`;

      await createTransporter().sendMail({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev", to: inviteeEmail,
        subject: `${inviterName} invited you to join ${company_name} on Digital Product Passport`,
        html: brandedEmail({ preheader: `You have been invited to join ${company_name}`, bodyHtml: `
          <p><strong>${inviterName}</strong> has invited you to join <strong>${company_name}</strong>.</p>
          <div class="info-box">
            <div class="info-row"><span class="info-label">Your Email</span><span class="info-value">${inviteeEmail}</span></div>
            <div class="info-row"><span class="info-label">Company</span><span class="info-value">${company_name}</span></div>
            <div class="info-row"><span class="info-label">Role</span><span class="info-value">${finalRole}</span></div>
          </div>
          <div style="background:rgba(245,183,50,0.12);border:1px solid rgba(245,183,50,0.4);border-radius:6px;padding:10px 14px;margin:16px 0;font-size:13px;color:#f5c842">
            ⏰ This invitation expires in <strong style="color:#fde68a">48 hours</strong> and can only be used <strong style="color:#fde68a">once</strong>.
          </div>
          <div class="cta-wrap"><a href="${registerUrl}" class="cta-btn">Accept Invitation →</a></div>` }),
      });

      res.json({ success: true, message: `Invitation sent to ${inviteeEmail}` });
    } catch (e) {
      console.error("Invite error:", e.message);
      res.status(500).json({ error: "Failed to send invitation.", detail: e.message });
    }
  });

  // ─── USER PROFILE ────────────────────────────────────────────────────────────
  app.get("/api/users/me", authenticateToken, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.company_id, u.avatar_url, u.phone, u.job_title, u.bio,
                u.auth_source, u.sso_only,
                u.preferred_language, u.default_reviewer_id, u.default_approver_id, u.created_at, u.last_login_at,
                u.two_factor_enabled, c.company_name, c.asset_management_enabled
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.id = $1`,
        [req.user.userId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Not found" });
      res.json(r.rows[0]);
    } catch { res.status(500).json({ error: "Failed" }); }
  });

  app.post("/api/users/me/token", authenticateToken, async (req, res) => {
    try {
      const freshToken = generateToken(req.user);
      setAuthCookie(res, freshToken);
      res.json({ token: freshToken });
    } catch {
      res.status(500).json({ error: "Failed to issue bearer token" });
    }
  });

  app.patch("/api/users/me", authenticateToken, async (req, res) => {
    try {
      const allowed = ["first_name","last_name","phone","job_title","bio","avatar_url",
                       "default_reviewer_id","default_approver_id","preferred_language"];
      const fields = Object.keys(req.body).filter(k => allowed.includes(k));
      if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
      const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
      const vals = fields.map(f => req.body[f] !== undefined ? req.body[f] : null);
      await pool.query(`UPDATE users SET ${sets}, updated_at = NOW() WHERE id = $${fields.length + 1}`,
        [...vals, req.user.userId]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed to update profile" }); }
  });

  app.patch("/api/users/me/2fa", authenticateToken, async (req, res) => {
    try {
      const { enable, currentPassword } = req.body;
      if (typeof enable !== "boolean") return res.status(400).json({ error: "enable (boolean) required" });
      if (!currentPassword) return res.status(400).json({ error: "Current password required" });

      const u = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.userId]);
      if (!u.rows.length) return res.status(404).json({ error: "User not found" });
      if (!await verifyPassword(currentPassword, u.rows[0].password_hash))
        return res.status(401).json({ error: "Current password is incorrect" });

      await pool.query(
        "UPDATE users SET two_factor_enabled = $1, updated_at = NOW() WHERE id = $2",
        [enable, req.user.userId]
      );
      res.json({ success: true, two_factor_enabled: enable });
    } catch (e) { console.error("2FA toggle error:", e.message); res.status(500).json({ error: "Failed to update 2FA setting" }); }
  });

  app.patch("/api/users/me/password", authenticateToken, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) return res.status(400).json({ error: "Both passwords required" });
      const passwordPolicyError = validatePasswordPolicy(newPassword);
      if (passwordPolicyError) return res.status(400).json({ error: passwordPolicyError });
      const u = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.userId]);
      if (!await verifyPassword(currentPassword, u.rows[0].password_hash))
        return res.status(401).json({ error: "Current password is incorrect" });
      const { hash, pepperVersion } = await hashPassword(newPassword);
      const updated = await pool.query(
        `UPDATE users
         SET password_hash = $1,
             pepper_version = $2,
             session_version = COALESCE(session_version, 1) + 1,
             updated_at = NOW()
         WHERE id = $3
         RETURNING id, email, company_id, role, session_version`,
        [hash, pepperVersion, req.user.userId]
      );
      const freshToken = generateToken(updated.rows[0]);
      setAuthCookie(res, freshToken);
      res.json({ success: true, min_password_length: PASSWORD_MIN_LENGTH });
    } catch { res.status(500).json({ error: "Failed" }); }
  });

  // ─── COMPANY USERS (team management) ─────────────────────────────────────────
  app.get("/api/companies/:companyId/users", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.job_title, u.avatar_url,
                u.is_active, u.created_at,
                (SELECT COUNT(*) FROM passport_registry pr WHERE pr.company_id = u.company_id AND pr.passport_type IS NOT NULL) AS passport_count
         FROM users u
         WHERE u.company_id = $1 AND u.role != 'super_admin'
         ORDER BY u.role, u.first_name`,
        [req.params.companyId]
      );
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  app.patch("/api/companies/:companyId/users/:userId", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      if (req.user.role !== "company_admin" && req.user.role !== "super_admin")
        return res.status(403).json({ error: "Admin only" });
      const { role } = req.body;
      if (!["company_admin","editor","viewer"].includes(role))
        return res.status(400).json({ error: "Invalid role" });
      await pool.query("UPDATE users SET role = $1, session_version = COALESCE(session_version, 1) + 1, updated_at = NOW() WHERE id = $2 AND company_id = $3",
        [role, req.params.userId, req.params.companyId]);
      res.json({ success: true });
    } catch { res.status(500).json({ error: "Failed" }); }
  });

  app.patch("/api/companies/:companyId/users/:userId/deactivate", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      if (req.user.role !== "company_admin" && req.user.role !== "super_admin")
        return res.status(403).json({ error: "Admin only" });
      await pool.query("UPDATE users SET is_active = false, session_version = COALESCE(session_version, 1) + 1, updated_at = NOW() WHERE id = $1 AND company_id = $2",
        [req.params.userId, req.params.companyId]);
      res.json({ success: true });
    } catch { res.status(500).json({ error: "Failed" }); }
  });
};
