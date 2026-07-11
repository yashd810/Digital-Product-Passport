"use strict";

const logger = require("../../services/logger");
const { escapeHtml } = require("../../services/email");

module.exports = function registerSuperAdminRoutes(app, deps) {
  const {
    pool,
    authenticateToken,
    isSuperAdmin,
    logAudit,
    createTransporter,
    brandedEmail,
    renderInfoTable,
    hashOpaqueToken,
    generateOneTimeToken,
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

  function buildPendingInviteResponse(row = {}) {
    return {
      id: row.id,
      email: row.email,
      invitedBy: row.invitedBy ?? null,
      invitedByEmail: row.invitedByEmail ?? "",
      invitedAt: row.createdAt ?? null,
      expiresAt: row.expiresAt ?? null,
      approvalStatus: row.approvalStatus ?? "pending",
    };
  }

  async function sendSuperAdminInviteEmail({
    transporter,
    inviteeEmail,
    inviterName,
    expiresAt,
    registerUrl,
  }) {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || "onboarding@resend.dev",
      to: inviteeEmail,
      subject: `${inviterName} invited you to become a Super Admin on Digital Product Passport`.replace(/[\r\n]+/g, " "),
      html: brandedEmail({ preheader: "You have been invited as a Super Admin", bodyHtml: `
        <p><strong>${escapeHtml(inviterName)}</strong> has invited you to join <strong>Digital Product Passport</strong> as a <strong>Super Admin</strong>.</p>
        ${renderInfoTable([
          { label: "Access level", value: "Super Admin" },
          { label: "Invitation expires", value: expiresAt.toLocaleString() },
        ])}
        <div class="cta-wrap"><a href="${escapeHtml(registerUrl)}" class="cta-btn">Complete Registration →</a></div>
      ` })
    });
  }

  async function notifyExistingSuperAdmins({
    transporter,
    inviterName,
    inviteeEmail,
    expiresAt,
    inviteId,
    actorUserId,
  }) {
    const recipientsRes = await pool.query(
      `SELECT email, "firstName" AS "firstName", "lastName" AS "lastName"
       FROM users
       WHERE role = 'superAdmin' AND "isActive" = true`
    );

    if (!recipientsRes.rows.length) return;

    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const approveUrl = `${appUrl}/admin/admin-management?approveInvite=${inviteId}`;
    const declineUrl = `${appUrl}/admin/admin-management?declineInvite=${inviteId}`;

    const mailJobs = recipientsRes.rows
      .filter((row) => row.email)
      .map((admin) => {
        const adminName =
          `${admin.firstName || ""} ${admin.lastName || ""}`.trim() ||
          admin.email ||
          "Super Admin";

        return transporter.sendMail({
          from: process.env.EMAIL_FROM || "onboarding@resend.dev",
          to: admin.email,
          subject: `Super Admin approval requested for ${inviteeEmail}`.replace(/[\r\n]+/g, " "),
          html: brandedEmail({
            preheader: "A new Super Admin invitation needs approval",
            bodyHtml: `
              <p>Hi <strong>${escapeHtml(adminName)}</strong>,</p>
              <p><strong>${escapeHtml(inviterName)}</strong> requested a new <strong>Super Admin</strong> invitation.</p>
              ${renderInfoTable([
                { label: "Invitee email", value: inviteeEmail },
                { label: "Invited by", value: inviterName },
                { label: "Access level", value: "Super Admin" },
                { label: "Invitation expires", value: expiresAt.toLocaleString() },
              ])}
              <div class="cta-wrap">
                <a href="${escapeHtml(approveUrl)}" class="cta-btn">Approve Request</a>
              </div>
              <div class="cta-wrap" style="margin-top:12px">
                <a href="${escapeHtml(declineUrl)}" class="cta-btn" style="background:#7f1d1d;border-color:#7f1d1d">Decline Request</a>
              </div>
              <p style="font-size:13px;color:#6a7a79">
                One super admin approval is enough to release the invitation email. If you are not logged in, you will be asked to sign in first.
              </p>
            `,
          }),
        });
      });

    const results = await Promise.allSettled(mailJobs);
    const failures = results.filter((result) => result.status === "rejected");

    if (failures.length) {
      logger.error(
        `Super admin invite notification mail error: ${failures.length} of ${results.length} alerts failed for actor ${actorUserId}`
      );
    }
  }

  app.get("/api/admin/super-admins/pending-invites", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT it.id,
                it.email,
                it."approvalStatus" AS "approvalStatus",
                it."expiresAt" AS "expiresAt",
                it."createdAt" AS "createdAt",
                inviter.id AS "invitedBy",
                inviter.email AS "invitedByEmail"
         FROM "inviteTokens" it
         LEFT JOIN users inviter ON inviter.id = it."invitedBy"
         WHERE it."roleToAssign" = 'superAdmin'
           AND it.used = false
           AND it."expiresAt" > NOW()
           AND COALESCE(it."approvalStatus", 'approved') = 'pending'
         ORDER BY it."createdAt" DESC`
      );
      res.json(result.rows.map(buildPendingInviteResponse));
    } catch (error) {
      logger.error({ err: error }, "Pending super admin invites fetch error");
      res.status(500).json({ error: "Failed to fetch pending super admin invites" });
    }
  });

  app.get("/api/admin/super-admins", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, email, "firstName" AS "firstName", "lastName" AS "lastName", "isActive" AS "isActive", "createdAt" AS "createdAt", "lastLoginAt" AS "lastLoginAt"
         FROM users WHERE role = 'superAdmin'
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
      const normalizedInviteeEmail = String(inviteeEmail).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedInviteeEmail)) {
        return res.status(400).json({ error: "Invalid email address" });
      }

      const existing = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedInviteeEmail]);
      if (existing.rows.length) return res.status(400).json({ error: "This email is already registered" });

      await pool.query(
        `UPDATE "inviteTokens"
         SET "expiresAt" = NOW()
         WHERE email = $1
           AND "roleToAssign" = 'superAdmin'
           AND used = false
           AND "expiresAt" > NOW()`,
        [normalizedInviteeEmail]
      );

      const inviter = await pool.query('SELECT "firstName" AS "firstName", "lastName" AS "lastName", email FROM users WHERE id = $1', [req.user.userId]);
      const inviterName = inviter.rows.length
        ? `${inviter.rows[0].firstName || ""} ${inviter.rows[0].lastName || ""}`.trim() || inviter.rows[0].email
        : "A colleague";
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

      const insertResult = await pool.query(
        `INSERT INTO "inviteTokens" (
           email, "companyId", "invitedBy", "expiresAt", "roleToAssign", "approvalStatus"
         )
         VALUES ($1, NULL, $2, $3, 'superAdmin', 'pending')
         RETURNING id`,
        [normalizedInviteeEmail, req.user.userId, expiresAt]
      );
      const inviteId = insertResult.rows[0]?.id;

      if (!process.env.EMAIL_PASS) {
        return res.status(201).json({
          success: true,
          emailSent: false,
          approvalRequired: true,
          warning: "Approval request created, but email is not configured on the server.",
          message: `Approval requested for ${normalizedInviteeEmail}. The invitation email will be sent after one super admin approves it.`
        });
      }

      try {
        const transporter = createTransporter();

        try {
          await notifyExistingSuperAdmins({
            transporter,
            inviterName,
            inviteeEmail: normalizedInviteeEmail,
            expiresAt,
            inviteId,
            actorUserId: req.user.userId,
          });
        } catch (notifyError) {
          logger.error("Super admin invite notification error:", notifyError.message);
        }
      } catch (mailError) {
        logger.error({ err: mailError }, "Super admin invite approval notification error");
        return res.status(201).json({
          success: true,
          emailSent: false,
          approvalRequired: true,
          warning: "Approval request created, but the approval email could not be sent.",
          detail: mailError.message,
          message: `Approval requested for ${normalizedInviteeEmail}. The invitation email will be sent after one super admin approves it.`
        });
      }

      res.status(201).json({
        success: true,
        emailSent: false,
        approvalRequired: true,
        message: `Approval requested for ${normalizedInviteeEmail}. The invitation email will be sent after one super admin approves it.`
      });
    } catch (error) {
      logger.error({ err: error }, "Super admin invite error");
      res.status(500).json({ error: "Failed to send super admin invitation", detail: error.message });
    }
  });

  app.post("/api/admin/super-admins/invite-requests/:inviteId/approve", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { inviteId } = req.params;
      const inviteRes = await pool.query(
        `SELECT it.id,
                it.email,
                it."expiresAt" AS "expiresAt",
                it."approvalStatus" AS "approvalStatus",
                it.used,
                inviter.email AS "invitedByEmail",
                inviter."firstName" AS "inviterFirstName",
                inviter."lastName" AS "inviterLastName"
         FROM "inviteTokens" it
         LEFT JOIN users inviter ON inviter.id = it."invitedBy"
         WHERE it.id = $1
           AND it."roleToAssign" = 'superAdmin'`,
        [inviteId]
      );
      if (!inviteRes.rows.length) return res.status(404).json({ error: "Invite request not found" });

      const invite = inviteRes.rows[0];
      if (invite.used) return res.status(400).json({ error: "This invitation has already been used." });
      if (new Date(invite.expiresAt) < new Date()) return res.status(400).json({ error: "This invitation has expired." });
      if ((invite.approvalStatus || "approved") === "approved") {
        return res.status(400).json({ error: "This invitation has already been approved." });
      }
      if (!process.env.EMAIL_PASS) {
        return res.status(500).json({ error: "Email not configured on server." });
      }

      const existing = await pool.query("SELECT id FROM users WHERE email = $1", [invite.email]);
      if (existing.rows.length) return res.status(400).json({ error: "This email is already registered" });

      const inviterName =
        `${invite.inviterFirstName || ""} ${invite.inviterLastName || ""}`.trim() ||
        invite.invitedByEmail ||
        "A colleague";
      const appUrl = process.env.APP_URL || "http://localhost:3000";
      const tokenValue = generateOneTimeToken();
      const tokenHash = hashOpaqueToken(tokenValue);
      const registerUrl = `${appUrl}/register#token=${encodeURIComponent(tokenValue)}`;
      const transporter = createTransporter();

      await sendSuperAdminInviteEmail({
        transporter,
        inviteeEmail: invite.email,
        inviterName,
        expiresAt: invite.expiresAt,
        registerUrl,
      });

      await pool.query(
        `UPDATE "inviteTokens"
         SET "approvalStatus" = 'approved',
             "tokenHash" = $1,
             "approvedBy" = $2,
             "approvedAt" = NOW(),
             "inviteEmailSentAt" = NOW()
         WHERE id = $3`,
        [tokenHash, req.user.userId, inviteId]
      );

      await logAudit(
        null,
        req.user.userId,
        "approveSuperAdminInvite",
        "inviteTokens",
        inviteId,
        null,
        { inviteeEmail: invite.email }
      );

      res.json({ success: true, message: `Invitation email sent to ${invite.email}` });
    } catch (error) {
      logger.error({ err: error }, "Super admin invite approval error");
      res.status(500).json({ error: "Failed to approve super admin invitation", detail: error.message });
    }
  });

  app.post("/api/admin/super-admins/invite-requests/:inviteId/decline", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { inviteId } = req.params;
      const result = await pool.query(
        `UPDATE "inviteTokens"
         SET "approvalStatus" = 'declined',
             "expiresAt" = NOW()
         WHERE id = $1
           AND "roleToAssign" = 'superAdmin'
           AND used = false
           AND COALESCE("approvalStatus", 'approved') = 'pending'
         RETURNING id, email`,
        [inviteId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Invite request not found or already resolved" });

      await logAudit(
        null,
        req.user.userId,
        "declineSuperAdminInvite",
        "inviteTokens",
        inviteId,
        null,
        { inviteeEmail: result.rows[0].email }
      );

      res.json({ success: true, message: `Invite request declined for ${result.rows[0].email}` });
    } catch (error) {
      logger.error({ err: error }, "Super admin invite decline error");
      res.status(500).json({ error: "Failed to decline super admin invitation", detail: error.message });
    }
  });

  app.patch("/api/admin/super-admins/:userId/access", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const { active } = req.body || {};
      if (typeof active !== "boolean") return res.status(400).json({ error: "active must be true or false" });

      const targetRes = await pool.query(
        'SELECT id, email, "isActive" AS "isActive" FROM users WHERE id = $1 AND role = \'superAdmin\'', [userId]
      );
      if (!targetRes.rows.length) return res.status(404).json({ error: "Super admin not found" });

      if (!active) {
        const countRes = await pool.query(
          'SELECT COUNT(*)::int AS count FROM users WHERE role = \'superAdmin\' AND "isActive" = true'
        );
        const activeCount = countRes.rows[0]?.count || 0;
        if (activeCount <= 1 && targetRes.rows[0].isActive) {
          return res.status(400).json({ error: "At least one active super admin must remain" });
        }
      }

      const updated = await pool.query(
        `UPDATE users
         SET "isActive" = $1,
             "sessionVersion" = COALESCE("sessionVersion", 1) + 1,
             "updatedAt" = NOW()
         WHERE id = $2 AND role = 'superAdmin'
         RETURNING id, email, "firstName" AS "firstName", "lastName" AS "lastName", "isActive" AS "isActive", "createdAt" AS "createdAt", "lastLoginAt" AS "lastLoginAt"`,
        [active, userId]
      );

      await logAudit(
        null, req.user.userId,
        active ? "restoreSuperAdminAccess" : "revokeSuperAdminAccess",
        "users", null, { userId: userId }, { active }
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
