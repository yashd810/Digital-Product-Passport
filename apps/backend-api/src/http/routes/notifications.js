const logger = require("../../infrastructure/logging/logger");

module.exports = function registerNotificationRoutes(app, {
  pool,
  authenticateToken,
}) {
  const mapNotificationRow = (row = {}) => ({
    id: row.id,
    userId: row.userId ?? null,
    type: row.type || null,
    title: row.title || "",
    message: row.message || "",
    passportDppId: row.passportDppId ?? null,
    actionUrl: row.actionUrl ?? null,
    read: Boolean(row.read),
    createdAt: row.createdAt ?? null,
  });

  const mapFullNotificationRow = (row = {}) => ({
    ...mapNotificationRow(row),
    reviewerId: row.reviewerId ?? null,
    approverId: row.approverId ?? null,
    reviewStatus: row.reviewStatus ?? null,
    approvalStatus: row.approvalStatus ?? null,
    overallStatus: row.overallStatus ?? null,
    reviewerComment: row.reviewerComment ?? null,
    approverComment: row.approverComment ?? null,
    reviewedAt: row.reviewedAt ?? null,
    approvedAt: row.approvedAt ?? null,
    rejectedAt: row.rejectedAt ?? null,
    workflowSubmittedAt: row.workflowSubmittedAt ?? null,
    reviewerName: row.reviewerName ?? null,
    reviewerEmail: row.reviewerEmail ?? null,
    approverName: row.approverName ?? null,
    approverEmail: row.approverEmail ?? null,
    submitterName: row.submitterName ?? null,
    submitterEmail: row.submitterEmail ?? null,
  });

  app.get("/api/users/me/notifications", authenticateToken, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
      const r = await pool.query(
        "SELECT * FROM notifications WHERE \"userId\" = $1 ORDER BY \"createdAt\" DESC LIMIT $2",
        [req.user.userId, limit]
      );
      res.json(r.rows.map(mapNotificationRow));
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/users/me/notifications/full", authenticateToken, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
      const r = await pool.query(
        `SELECT
           n.*,
           pw."reviewerId" AS "reviewerId",
           pw."approverId" AS "approverId",
           pw."reviewStatus" AS "reviewStatus",
           pw."approvalStatus" AS "approvalStatus",
           pw."overallStatus" AS "overallStatus",
           pw."reviewerComment" AS "reviewerComment",
           pw."approverComment" AS "approverComment",
           pw."reviewedAt" AS "reviewedAt",
           pw."approvedAt" AS "approvedAt",
           pw."rejectedAt" AS "rejectedAt",
           pw."createdAt" AS "workflowSubmittedAt",
           CONCAT(ur."firstName", ' ', ur."lastName") AS "reviewerName",
           ur.email AS "reviewerEmail",
           CONCAT(ua."firstName", ' ', ua."lastName") AS "approverName",
           ua.email AS "approverEmail",
           CONCAT(us."firstName", ' ', us."lastName") AS "submitterName",
           us.email AS "submitterEmail"
         FROM notifications n
         LEFT JOIN passport_workflow pw
           ON pw."passportDppId" = n."passportDppId"
           AND pw."createdAt" = (
             SELECT MAX(pw2."createdAt") FROM passport_workflow pw2
             WHERE pw2."passportDppId" = n."passportDppId"
           )
         LEFT JOIN users ur ON ur.id = pw."reviewerId"
         LEFT JOIN users ua ON ua.id = pw."approverId"
         LEFT JOIN users us ON us.id = pw."submittedBy"
         WHERE n."userId" = $1
         ORDER BY n."createdAt" DESC
         LIMIT $2`,
        [req.user.userId, limit]
      );
      res.json(r.rows.map(mapFullNotificationRow));
    } catch (e) {
      logger.error("Full notifications error:", e.message);
      res.status(500).json({ error: "Failed" });
    }
  });

  app.patch("/api/users/me/notifications/read-all", authenticateToken, async (req, res) => {
    try {
      await pool.query("UPDATE notifications SET read = true WHERE \"userId\" = $1", [req.user.userId]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });

  app.patch("/api/users/me/notifications/:id/read", authenticateToken, async (req, res) => {
    try {
      await pool.query(
        "UPDATE notifications SET read = true WHERE id = $1 AND \"userId\" = $2",
        [req.params.id, req.user.userId]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });
};
