module.exports = function registerNotificationRoutes(app, {
  pool,
  authenticateToken,
}) {
  app.get("/api/users/me/notifications", authenticateToken, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
      const r = await pool.query(
        "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
        [req.user.userId, limit]
      );
      res.json(r.rows);
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
           pw.reviewer_id,
           pw.approver_id,
           pw.review_status,
           pw.approval_status,
           pw.overall_status,
           pw.reviewer_comment,
           pw.approver_comment,
           pw.reviewed_at,
           pw.approved_at,
           pw.rejected_at,
           pw.created_at  AS workflow_submitted_at,
           CONCAT(ur.first_name, ' ', ur.last_name) AS reviewer_name,
           ur.email                                  AS reviewer_email,
           CONCAT(ua.first_name, ' ', ua.last_name) AS approver_name,
           ua.email                                  AS approver_email,
           CONCAT(us.first_name, ' ', us.last_name) AS submitter_name,
           us.email                                  AS submitter_email
         FROM notifications n
         LEFT JOIN passport_workflow pw
           ON pw.passport_guid = n.passport_guid
           AND pw.created_at = (
             SELECT MAX(pw2.created_at) FROM passport_workflow pw2
             WHERE pw2.passport_guid = n.passport_guid
           )
         LEFT JOIN users ur ON ur.id = pw.reviewer_id
         LEFT JOIN users ua ON ua.id = pw.approver_id
         LEFT JOIN users us ON us.id = pw.submitted_by
         WHERE n.user_id = $1
         ORDER BY n.created_at DESC
         LIMIT $2`,
        [req.user.userId, limit]
      );
      res.json(r.rows);
    } catch (e) {
      console.error("Full notifications error:", e.message);
      res.status(500).json({ error: "Failed" });
    }
  });

  app.patch("/api/users/me/notifications/read-all", authenticateToken, async (req, res) => {
    try {
      await pool.query("UPDATE notifications SET read = true WHERE user_id = $1", [req.user.userId]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });

  app.patch("/api/users/me/notifications/:id/read", authenticateToken, async (req, res) => {
    try {
      await pool.query(
        "UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2",
        [req.params.id, req.user.userId]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });
};
