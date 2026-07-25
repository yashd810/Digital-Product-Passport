"use strict";

const logger = require("../../services/logger");

module.exports = function registerUserAccessRoutes(app, deps) {
  const {
    pool,
    authenticateToken,
    isSuperAdmin,
    getTable,
    logAudit,
  } = deps;

  const parsePositiveId = (value) => {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };

  const rollbackQuietly = async (client) => {
    try {
      await client.query("ROLLBACK");
    } catch (error) {
      logger.error("Passport type access rollback error:", error.message);
    }
  };

  const getAdminAuditOptions = (req, options = {}) => ({
    ...options,
    actorIdentifier: req.user?.actorIdentifier
      || (req.user?.userId ? `user:${req.user.userId}` : null),
    audience: "superAdmin",
  });

  app.get("/api/admin/companies/:companyId/passport-type-access", authenticateToken, isSuperAdmin, async (req, res) => {
    const companyId = parsePositiveId(req.params.companyId);
    if (companyId === null) return res.status(400).json({ error: "Invalid company ID" });

    try {
      const companyResult = await pool.query(
        `SELECT id, "companyName" AS "companyName", "isActive" AS "isActive"
           FROM companies
          WHERE id = $1
          LIMIT 1`,
        [companyId]
      );
      if (!companyResult.rows.length) return res.status(404).json({ error: "Company not found" });

      const passportTypesResult = await pool.query(
        `SELECT pt.id,
                pt."typeName" AS "typeName",
                pt."displayName" AS "displayName",
                pt."productCategory" AS "productCategory",
                pt."productIcon" AS "productIcon",
                pt."fieldsJson" AS "fieldsJson",
                pt."isActive" AS "isActive",
                CASE
                  WHEN cpa.id IS NOT NULL AND COALESCE(cpa."accessRevoked", false) = false THEN true
                  ELSE false
                END AS "accessGranted",
                CASE
                  WHEN cpa.id IS NOT NULL AND COALESCE(cpa."accessRevoked", false) = false THEN cpa."grantedAt"
                  ELSE NULL
                END AS "grantedAt"
           FROM "passportTypes" pt
           LEFT JOIN "companyPassportAccess" cpa
             ON cpa."passportTypeId" = pt.id
            AND cpa."companyId" = $1
          ORDER BY pt."productCategory", pt."displayName"`,
        [companyId]
      );

      return res.json({
        company: companyResult.rows[0],
        passportTypes: passportTypesResult.rows,
      });
    } catch (error) {
      logger.error("List company passport type access error:", error.message);
      return res.status(500).json({ error: "Failed to fetch passport type access" });
    }
  });

  app.patch("/api/admin/users/:userId/role", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { role } = req.body;
      const userId = parsePositiveId(req.params.userId);
      if (!["companyAdmin", "editor", "viewer"].includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }
      if (userId === null) return res.status(400).json({ error: "Invalid user ID" });

      const target = await pool.query(
        `SELECT id,
                role,
                "companyId" AS "companyId",
                email
           FROM users
          WHERE id = $1
            AND role IN ('companyAdmin', 'editor', 'viewer')
          LIMIT 1`,
        [userId]
      );
      if (!target.rows.length) return res.status(404).json({ error: "Company user not found" });

      const current = target.rows[0];
      if (current.role === role) return res.json({ success: true });

      const updated = await pool.query(
        `UPDATE users
            SET role = $1,
                "sessionVersion" = COALESCE("sessionVersion", 1) + 1,
                "updatedAt" = NOW()
          WHERE id = $2
            AND role IN ('companyAdmin', 'editor', 'viewer')
        RETURNING id, role, "companyId" AS "companyId", email`,
        [role, userId]
      );
      if (!updated.rows.length) return res.status(404).json({ error: "Company user not found" });

      if (typeof logAudit === "function") {
        await logAudit(
          current.companyId,
          req.user?.userId,
          "updateCompanyUserRole",
          "users",
          String(userId),
          { role: current.role, companyId: current.companyId, email: current.email || null },
          { role: updated.rows[0].role, companyId: current.companyId, email: updated.rows[0].email || current.email || null },
          getAdminAuditOptions(req)
        );
      }
      return res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });

  app.post("/api/admin/company-access", authenticateToken, isSuperAdmin, async (req, res) => {
    const companyId = parsePositiveId(req.body?.companyId);
    const passportTypeId = parsePositiveId(req.body?.passportTypeId);
    if (companyId === null || passportTypeId === null) {
      return res.status(400).json({ error: "Valid companyId and passportTypeId are required" });
    }

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const companyResult = await client.query(
        `SELECT id, "companyName" AS "companyName", "isActive" AS "isActive"
           FROM companies
          WHERE id = $1
          LIMIT 1`,
        [companyId]
      );
      if (!companyResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Company not found" });
      }
      if (companyResult.rows[0].isActive === false) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Cannot grant passport type access to an inactive company" });
      }

      const typeRes = await client.query(
        `SELECT id,
                "typeName" AS "typeName",
                "displayName" AS "displayName",
                "isActive" AS "isActive"
           FROM "passportTypes"
          WHERE id = $1
          LIMIT 1`,
        [passportTypeId]
      );
      if (!typeRes.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Passport type not found" });
      }
      if (typeRes.rows[0].isActive === false) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Activate the passport type before granting access" });
      }
      const { typeName, displayName } = typeRes.rows[0];
      const tableName = getTable(typeName);

      const result = await client.query(
        `INSERT INTO "companyPassportAccess" ("companyId", "passportTypeId", "accessRevoked")
         VALUES ($1, $2, FALSE)
         ON CONFLICT ("companyId", "passportTypeId") DO UPDATE
           SET "accessRevoked" = FALSE,
               "grantedAt" = CURRENT_TIMESTAMP
         RETURNING id,
                   "companyId" AS "companyId",
                   "passportTypeId" AS "passportTypeId",
                   "accessRevoked" AS "accessRevoked",
                   "grantedAt" AS "grantedAt"`,
        [companyId, passportTypeId]
      );

      if (typeof logAudit === "function") {
        await logAudit(
          companyId,
          req.user?.userId,
          "grantPassportTypeAccess",
          "companyPassportAccess",
          `${companyId}:${passportTypeId}`,
          null,
          { companyId, passportTypeId, typeName, accessRevoked: false },
          getAdminAuditOptions(req, { client })
        );
      }
      await client.query("COMMIT");

      return res.status(201).json({
        success: true,
        access: result.rows[0],
        passportType: { id: passportTypeId, typeName, displayName },
        table: tableName,
      });
    } catch (error) {
      if (client) await rollbackQuietly(client);
      logger.error("Grant access error:", error.message);
      return res.status(500).json({ error: "Failed to grant access" });
    } finally {
      client?.release();
    }
  });

  app.delete("/api/admin/company-access/:companyId/:typeId", authenticateToken, isSuperAdmin, async (req, res) => {
    const companyId = parsePositiveId(req.params.companyId);
    const passportTypeId = parsePositiveId(req.params.typeId);
    if (companyId === null || passportTypeId === null) {
      return res.status(400).json({ error: "Valid companyId and passportTypeId are required" });
    }

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const typeRes = await client.query(
        `SELECT "typeName" AS "typeName", "displayName" AS "displayName"
           FROM "passportTypes"
          WHERE id = $1
          LIMIT 1`,
        [passportTypeId]
      );
      if (!typeRes.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Passport type not found" });
      }

      const result = await client.query(
        `UPDATE "companyPassportAccess" SET "accessRevoked" = TRUE
         WHERE "companyId" = $1
           AND "passportTypeId" = $2
           AND COALESCE("accessRevoked", false) = false
         RETURNING id`,
        [companyId, passportTypeId]
      );
      if (!result.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Active access grant not found" });
      }

      const { typeName, displayName } = typeRes.rows[0];
      if (typeof logAudit === "function") {
        await logAudit(
          companyId,
          req.user?.userId,
          "revokePassportTypeAccess",
          "companyPassportAccess",
          `${companyId}:${passportTypeId}`,
          { companyId, passportTypeId, typeName, accessRevoked: false },
          { companyId, passportTypeId, typeName, accessRevoked: true },
          getAdminAuditOptions(req, { client })
        );
      }
      await client.query("COMMIT");

      return res.json({
        success: true,
        passportType: { id: passportTypeId, typeName, displayName },
      });
    } catch (error) {
      if (client) await rollbackQuietly(client);
      logger.error("Revoke access error:", error.message);
      return res.status(500).json({ error: "Failed to revoke access" });
    } finally {
      client?.release();
    }
  });
};
