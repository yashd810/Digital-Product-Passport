"use strict";

const { v4: uuidv4 } = require("uuid");
const logger = require("../../infrastructure/logging/logger");

module.exports = function registerSuperAdminRoutes(app, deps) {
  const {
    pool,
    authenticateToken,
    isSuperAdmin,
    logAudit,
    createTransporter,
    brandedEmail,
  } = deps;

  function buildSuperAdminResponse(row = {}) {
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName ?? "",
      lastName: row.lastName ?? "",
      isActive: Boolean(row.isActive),
      createdAt: row.createdAt ?? null,
      lastLoginAt: row.lastLoginAt ?? null,
    };
  }

  app.get("/api/admin/super-admins", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, email, "firstName" AS "firstName", "lastName" AS "lastName", "isActive" AS "isActive", "createdAt" AS "createdAt", "lastLoginAt" AS "lastLoginAt"
         FROM users WHERE role = 'super_admin'
         ORDER BY "isActive" DESC, "createdAt" ASC`
      );
      res.json(result.rows.map(buildSuperAdminResponse));
    } catch {
      res.status(500).json({ error: "Failed to fetch super admins" });
    }
  });

  app.post("/api/admin/super-admins/invite", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { inviteeEmail } = req.body;
      if (!inviteeEmail) return res.status(400).json({ error: "Invitee email is required" });

      const existing = await pool.query("SELECT id FROM users WHERE email = $1", [inviteeEmail]);
      if (existing.rows.length) return res.status(400).json({ error: "This email is already registered" });

      await pool.query(
        `UPDATE invite_tokens SET expires_at = NOW()
         WHERE email = $1 AND role_to_assign = 'super_admin' AND used = false AND expires_at > NOW()`,
        [inviteeEmail]
      );

      const inviter = await pool.query('SELECT "firstName" AS "firstName", "lastName" AS "lastName", email FROM users WHERE id = $1', [req.user.userId]);
      const inviterName = inviter.rows.length
        ? `${inviter.rows[0].firstName || ""} ${inviter.rows[0].lastName || ""}`.trim() || inviter.rows[0].email
        : "A colleague";
      const tokenValue = uuidv4();
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO invite_tokens (token, email, company_id, invited_by, expires_at, role_to_assign)
         VALUES ($1, $2, NULL, $3, $4, 'super_admin')`,
        [tokenValue, inviteeEmail, req.user.userId, expiresAt]
      );

      const appUrl = process.env.APP_URL || "http://localhost:3000";
      const registerUrl = `${appUrl}/register?token=${tokenValue}`;

      if (!process.env.EMAIL_PASS) {
        return res.status(201).json({
          success: true, emailSent: false, registerUrl,
          warning: "Invite created, but email is not configured on the server.",
          message: `Super admin invite created for ${inviteeEmail}. Share the registration link manually.`
        });
      }

      try {
        await createTransporter().sendMail({
          from: process.env.EMAIL_FROM || "onboarding@resend.dev",
          to: inviteeEmail,
          subject: `${inviterName} invited you to become a Super Admin on Digital Product Passport`,
          html: brandedEmail({ preheader: "You have been invited as a Super Admin", bodyHtml: `
            <p><strong>${inviterName}</strong> has invited you to join <strong>Digital Product Passport</strong> as a <strong>Super Admin</strong>.</p>
            <div class="info-box">
              <div class="info-row"><span class="info-label">Access level</span><span class="info-value">Super Admin</span></div>
              <div class="info-row"><span class="info-label">Invitation expires</span><span class="info-value">${expiresAt.toLocaleString()}</span></div>
            </div>
            <div class="cta-wrap"><a href="${registerUrl}" class="cta-btn">Complete Registration →</a></div>
          ` })
        });
      } catch (mailError) {
        logger.error("Super admin invite mail error:", mailError.message);
        return res.status(201).json({
          success: true, emailSent: false, registerUrl,
          warning: "Invite created, but the email could not be sent.",
          detail: mailError.message,
          message: `Super admin invite created for ${inviteeEmail}. Share the registration link manually.`
        });
      }

      res.status(201).json({ success: true, emailSent: true, message: `Invitation sent to ${inviteeEmail}` });
    } catch (error) {
      logger.error("Super admin invite error:", error.message);
      res.status(500).json({ error: "Failed to send super admin invitation", detail: error.message });
    }
  });

  app.patch("/api/admin/super-admins/:userId/access", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const { active } = req.body || {};
      if (typeof active !== "boolean") return res.status(400).json({ error: "active must be true or false" });

      const targetRes = await pool.query(
        'SELECT id, email, "isActive" AS "isActive" FROM users WHERE id = $1 AND role = \'super_admin\'', [userId]
      );
      if (!targetRes.rows.length) return res.status(404).json({ error: "Super admin not found" });

      if (!active) {
        const countRes = await pool.query(
          'SELECT COUNT(*)::int AS count FROM users WHERE role = \'super_admin\' AND "isActive" = true'
        );
        const activeCount = countRes.rows[0]?.count || 0;
        if (activeCount <= 1 && targetRes.rows[0].is_active) {
          return res.status(400).json({ error: "At least one active super admin must remain" });
        }
      }

      const updated = await pool.query(
        `UPDATE users
         SET "isActive" = $1,
             "sessionVersion" = COALESCE("sessionVersion", 1) + 1,
             "updatedAt" = NOW()
         WHERE id = $2 AND role = 'super_admin'
         RETURNING id, email, "firstName" AS "firstName", "lastName" AS "lastName", "isActive" AS "isActive", "createdAt" AS "createdAt", "lastLoginAt" AS "lastLoginAt"`,
        [active, userId]
      );

      await logAudit(
        null, req.user.userId,
        active ? "RESTORE_SUPER_ADMIN_ACCESS" : "REVOKE_SUPER_ADMIN_ACCESS",
        "users", null, { user_id: userId }, { active }
      );

      res.json({
        success: true,
        user: buildSuperAdminResponse(updated.rows[0]),
        revokedCurrentSessionUser: !active && Number(userId) === Number(req.user.userId)
      });
    } catch (error) {
      logger.error("Super admin access update error:", error.message);
      res.status(500).json({ error: "Failed to update super admin access" });
    }
  });
};
