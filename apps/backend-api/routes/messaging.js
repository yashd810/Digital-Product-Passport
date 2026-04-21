module.exports = function registerMessagingRoutes(app, {
  pool,
  authenticateToken,
}) {
  app.get("/api/messaging/conversations", authenticateToken, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT
          c.id,
          c.company_id,
          u.id AS other_id,
          u.first_name,
          u.last_name,
          u.email,
          lm.body AS last_message,
          lm.created_at AS last_message_at,
          ls.sender_id AS last_sender_id,
          (SELECT COUNT(*) FROM messages m2
           WHERE m2.conversation_id = c.id
             AND m2.created_at > COALESCE(cm_me.last_read_at, '1970-01-01')
             AND m2.sender_id != $1
          ) AS unread
        FROM conversations c
        JOIN conversation_members cm_me ON cm_me.conversation_id = c.id AND cm_me.user_id = $1
        JOIN conversation_members cm_other ON cm_other.conversation_id = c.id AND cm_other.user_id != $1
        JOIN users u ON u.id = cm_other.user_id
        LEFT JOIN LATERAL (
          SELECT m.body, m.created_at, m.sender_id FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC LIMIT 1
        ) lm ON true
        LEFT JOIN messages ls ON ls.id = (
          SELECT id FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
        )
        WHERE c.company_id = (SELECT company_id FROM users WHERE id = $1)
        ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
        [req.user.userId]
      );
      res.json(r.rows);
    } catch (e) {
      console.error("List conversations error:", e.message);
      res.status(500).json({ error: "Failed" });
    }
  });

  app.post("/api/messaging/conversations", authenticateToken, async (req, res) => {
    try {
      const { otherUserId } = req.body;
      if (!otherUserId) return res.status(400).json({ error: "otherUserId required" });
      const meId = req.user.userId;
      if (parseInt(otherUserId, 10) === meId) return res.status(400).json({ error: "Cannot message yourself" });

      const meRes = await pool.query("SELECT company_id FROM users WHERE id = $1", [meId]);
      const otherRes = await pool.query(
        "SELECT company_id, first_name, last_name, email FROM users WHERE id = $1",
        [otherUserId]
      );
      if (!otherRes.rows.length) return res.status(404).json({ error: "User not found" });
      if (meRes.rows[0].company_id !== otherRes.rows[0].company_id) {
        return res.status(403).json({ error: "Different company" });
      }

      const existing = await pool.query(
        `SELECT c.id FROM conversations c
         JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = $1
         JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = $2
         WHERE c.company_id = $3 LIMIT 1`,
        [meId, otherUserId, meRes.rows[0].company_id]
      );

      let convId;
      if (existing.rows.length) {
        convId = existing.rows[0].id;
      } else {
        const newConv = await pool.query(
          "INSERT INTO conversations (company_id) VALUES ($1) RETURNING id",
          [meRes.rows[0].company_id]
        );
        convId = newConv.rows[0].id;
        await pool.query(
          "INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2),($1,$3)",
          [convId, meId, otherUserId]
        );
      }
      res.json({ id: convId });
    } catch (e) {
      console.error("Create conversation error:", e.message);
      res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/messaging/conversations/:convId/messages", authenticateToken, async (req, res) => {
    try {
      const convId = parseInt(req.params.convId, 10);
      const mem = await pool.query(
        "SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2",
        [convId, req.user.userId]
      );
      if (!mem.rows.length) return res.status(403).json({ error: "Forbidden" });

      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const before = req.query.before;
      let q;
      let params;
      if (before) {
        q = `SELECT m.id, m.body, m.created_at, m.sender_id,
                    u.first_name, u.last_name, u.email
             FROM messages m JOIN users u ON u.id = m.sender_id
             WHERE m.conversation_id=$1 AND m.id < $2
             ORDER BY m.id DESC LIMIT $3`;
        params = [convId, before, limit];
      } else {
        q = `SELECT m.id, m.body, m.created_at, m.sender_id,
                    u.first_name, u.last_name, u.email
             FROM messages m JOIN users u ON u.id = m.sender_id
             WHERE m.conversation_id=$1
             ORDER BY m.id DESC LIMIT $2`;
        params = [convId, limit];
      }
      const r = await pool.query(q, params);
      await pool.query(
        "UPDATE conversation_members SET last_read_at=NOW() WHERE conversation_id=$1 AND user_id=$2",
        [convId, req.user.userId]
      );
      res.json(r.rows.reverse());
    } catch (e) {
      console.error("Get messages error:", e.message);
      res.status(500).json({ error: "Failed" });
    }
  });

  app.post("/api/messaging/conversations/:convId/messages", authenticateToken, async (req, res) => {
    try {
      const convId = parseInt(req.params.convId, 10);
      const { body } = req.body;
      if (!body?.trim()) return res.status(400).json({ error: "Message body required" });

      const mem = await pool.query(
        "SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2",
        [convId, req.user.userId]
      );
      if (!mem.rows.length) return res.status(403).json({ error: "Forbidden" });

      const r = await pool.query(
        "INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1,$2,$3) RETURNING *",
        [convId, req.user.userId, body.trim()]
      );
      await pool.query(
        "UPDATE conversation_members SET last_read_at=NOW() WHERE conversation_id=$1 AND user_id=$2",
        [convId, req.user.userId]
      );
      res.json(r.rows[0]);
    } catch (e) {
      console.error("Send message error:", e.message);
      res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/messaging/users", authenticateToken, async (req, res) => {
    try {
      const meRes = await pool.query("SELECT company_id FROM users WHERE id=$1", [req.user.userId]);
      const companyId = meRes.rows[0]?.company_id;
      if (!companyId) return res.json([]);
      const r = await pool.query(
        `SELECT id, first_name, last_name, email, role FROM users
         WHERE company_id=$1 AND id != $2 AND is_active=true ORDER BY first_name, last_name`,
        [companyId, req.user.userId]
      );
      res.json(r.rows);
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/messaging/unread", authenticateToken, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT COUNT(*) AS count FROM messages m
         JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $1
         WHERE m.sender_id != $1 AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01')`,
        [req.user.userId]
      );
      res.json({ count: parseInt(r.rows[0].count, 10) });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });
};
