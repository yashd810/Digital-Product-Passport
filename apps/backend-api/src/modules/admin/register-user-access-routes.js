"use strict";

const logger = require("../../infrastructure/logging/logger");

module.exports = function registerUserAccessRoutes(app, deps) {
  const {
    pool,
    authenticateToken,
    isSuperAdmin,
    getTable,
  } = deps;

  app.patch("/api/admin/users/:userId/role", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { role } = req.body;
      if (!["company_admin", "editor", "viewer"].includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }
      await pool.query(
        'UPDATE users SET role = $1, "sessionVersion" = COALESCE("sessionVersion", 1) + 1, "updatedAt" = NOW() WHERE id = $2',
        [role, req.params.userId]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });

  app.post("/api/admin/company-access", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { companyId, passportTypeId } = req.body;
      if (!companyId || !passportTypeId) {
        return res.status(400).json({ error: "companyId and passportTypeId required" });
      }

      const typeRes = await pool.query(
        'SELECT "typeName" AS "typeName", "displayName" AS "displayName" FROM passport_types WHERE id = $1',
        [passportTypeId]
      );
      if (!typeRes.rows.length) return res.status(404).json({ error: "Passport type not found" });
      const { typeName, displayName } = typeRes.rows[0];

      const result = await pool.query(
        `INSERT INTO company_passport_access (company_id, passport_type_id, access_revoked)
         VALUES ($1, $2, FALSE)
         ON CONFLICT (company_id, passport_type_id) DO UPDATE SET access_revoked = FALSE
         RETURNING *`,
        [companyId, passportTypeId]
      );

      res.status(201).json({
        success: true, access: result.rows[0], table: getTable(typeName), displayName
      });
    } catch (error) {
      if (error.code === "23505") return res.status(400).json({ error: "Access already granted" });
      logger.error("Grant access error:", error.message);
      res.status(500).json({ error: "Failed to grant access" });
    }
  });

  app.delete("/api/admin/company-access/:companyId/:typeId", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { companyId, typeId } = req.params;

      const result = await pool.query(
        `UPDATE company_passport_access SET access_revoked = TRUE
         WHERE company_id = $1 AND passport_type_id = $2 RETURNING id`,
        [companyId, typeId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Access record not found" });

      const typeRes = await pool.query('SELECT "typeName" AS "typeName" FROM passport_types WHERE id = $1', [typeId]);
      if (typeRes.rows.length) {
        const tableName = getTable(typeRes.rows[0].typeName);
        await pool.query(
          `UPDATE ${tableName} SET "releaseStatus" = 'released', "updatedAt" = NOW()
           WHERE "companyId" = $1 AND "releaseStatus" IN ('draft', 'in_revision')`,
          [companyId]
        );
      }

      res.json({ success: true });
    } catch (error) {
      logger.error("Revoke access error:", error.message);
      res.status(500).json({ error: "Failed to revoke access" });
    }
  });
};
