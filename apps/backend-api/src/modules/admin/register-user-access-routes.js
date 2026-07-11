"use strict";

const logger = require("../../services/logger");

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
      if (!["companyAdmin", "editor", "viewer"].includes(role)) {
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
        'SELECT "typeName" AS "typeName", "displayName" AS "displayName" FROM "passportTypes" WHERE id = $1',
        [passportTypeId]
      );
      if (!typeRes.rows.length) return res.status(404).json({ error: "Passport type not found" });
      const { typeName, displayName } = typeRes.rows[0];

      const result = await pool.query(
        `INSERT INTO "companyPassportAccess" ("companyId", "passportTypeId", "accessRevoked")
         VALUES ($1, $2, FALSE)
         ON CONFLICT ("companyId", "passportTypeId") DO UPDATE SET "accessRevoked" = FALSE
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
        `UPDATE "companyPassportAccess" SET "accessRevoked" = TRUE
         WHERE "companyId" = $1 AND "passportTypeId" = $2 RETURNING id`,
        [companyId, typeId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Access record not found" });

      const typeRes = await pool.query('SELECT "typeName" AS "typeName" FROM "passportTypes" WHERE id = $1', [typeId]);
      if (typeRes.rows.length) {
        const tableName = getTable(typeRes.rows[0].typeName);
        await pool.query(
          `UPDATE ${tableName} SET "releaseStatus" = 'released', "updatedAt" = NOW()
           WHERE "companyId" = $1 AND "releaseStatus" IN ('draft', 'inRevision')`,
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
