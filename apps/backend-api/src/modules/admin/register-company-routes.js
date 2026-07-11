"use strict";

const fs = require("fs");
const path = require("path");
const logger = require("../../services/logger");

const isPathInsideBase = (targetPath, baseDir) => {
  const basePath = path.resolve(baseDir);
  const resolvedPath = path.resolve(targetPath);
  return resolvedPath === basePath || resolvedPath.startsWith(`${basePath}${path.sep}`);
};

module.exports = function registerCompanyRoutes(app, deps) {
  const {
    pool,
    authenticateToken,
    isSuperAdmin,
    verifyPassword,
    logAudit,
    backupProviderService,
    productIdentifierService,
    getTable,
    ensureCompanyDppPolicy,
    getCompanyDppPolicy,
    validateCompanyDppPolicyInput,
    updateCompanyDppPolicy,
    storageService,
    repoBaseDir,
    filesBaseDir,
    companyTrustLevels,
  } = deps;

  function mapCompanyRow(row = {}) {
    return {
      id: row.id ?? null,
      country: row.country ?? null,
      companyName: row.companyName ?? null,
      legalName: row.legalName ?? null,
      companyRegistrationNumber: row.companyRegistrationNumber ?? null,
      vatNumber: row.vatNumber ?? null,
      websiteDomain: row.websiteDomain ?? null,
      customerTrustLevel: row.customerTrustLevel ?? null,
      verificationStatus: row.verificationStatus ?? null,
      authorizedContactName: row.authorizedContactName ?? null,
      authorizedContactEmail: row.authorizedContactEmail ?? null,
      isActive: row.isActive ?? null,
      assetManagementEnabled: row.assetManagementEnabled ?? null,
      assetManagementRevokedAt: row.assetManagementRevokedAt ?? null,
      grantedTypeNames: row.grantedTypeNames ?? [],
      grantedTypes: row.grantedTypes ?? [],
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
    };
  }

  function normalizeCompanyIdentity(input = {}) {
    const normalizeText = (value) => {
      const normalized = String(value || "").trim();
      return normalized || null;
    };
    const companyName = String(input.companyName || "").trim();
    const trustLevel = String(input.customerTrustLevel || "").trim();
    return {
      companyName,
      legalName: normalizeText(input.legalName),
      country: normalizeText(input.country)?.toUpperCase() || null,
      companyRegistrationNumber: normalizeText(input.companyRegistrationNumber),
      vatNumber: normalizeText(input.vatNumber),
      websiteDomain: normalizeText(input.websiteDomain),
      customerTrustLevel: trustLevel || "basic",
      authorizedContactName: normalizeText(input.authorizedContactName),
      authorizedContactEmail: normalizeText(input.authorizedContactEmail)?.toLowerCase() || null
    };
  }

  app.post("/api/admin/companies", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const companyIdentity = normalizeCompanyIdentity(req.body || {});
      if (!companyIdentity.companyName) {
        return res.status(400).json({ error: "Company name required" });
      }
      if (!companyTrustLevels.has(companyIdentity.customerTrustLevel)) {
        return res.status(400).json({ error: "Invalid customer trust level" });
      }
      const result = await pool.query(
        `INSERT INTO companies (
          "companyName",
          "legalName",
          country,
          "companyRegistrationNumber",
          "vatNumber",
          "websiteDomain",
          "customerTrustLevel",
          "verificationStatus",
          "authorizedContactName",
          "authorizedContactEmail"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *`,
        [
          companyIdentity.companyName,
          companyIdentity.legalName,
          companyIdentity.country,
          companyIdentity.companyRegistrationNumber,
          companyIdentity.vatNumber,
          companyIdentity.websiteDomain,
          companyIdentity.customerTrustLevel,
          "unverified",
          companyIdentity.authorizedContactName,
          companyIdentity.authorizedContactEmail
        ]
      );
      await ensureCompanyDppPolicy(result.rows[0].id);
      res.status(201).json({ success: true, company: mapCompanyRow(result.rows[0]) });
    } catch (error) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "Company name already exists" });
      }
      res.status(500).json({ error: "Failed to create company" });
    }
  });

  app.get("/api/admin/companies/:companyId", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const companyId = Number(req.params.companyId);
      if (!Number.isInteger(companyId) || companyId <= 0) {
        return res.status(400).json({ error: "Invalid company id" });
      }
      const company = await pool.query(
        `SELECT id,
                "companyName",
                "legalName",
                country,
                "companyRegistrationNumber",
                "vatNumber",
                "websiteDomain",
                "customerTrustLevel",
                "verificationStatus",
                "authorizedContactName",
                "authorizedContactEmail",
                "isActive",
                "createdAt",
                "updatedAt"
           FROM companies
          WHERE id = $1`,
        [companyId]
      );
      if (!company.rows.length) {
        return res.status(404).json({ error: "Company not found" });
      }
      res.json(mapCompanyRow(company.rows[0]));
    } catch {
      res.status(500).json({ error: "Failed to fetch company" });
    }
  });

  app.put("/api/admin/companies/:companyId", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const companyId = Number(req.params.companyId);
      if (!Number.isInteger(companyId) || companyId <= 0) {
        return res.status(400).json({ error: "Invalid company id" });
      }
      const companyIdentity = normalizeCompanyIdentity(req.body || {});
      if (!companyIdentity.companyName) {
        return res.status(400).json({ error: "Company name required" });
      }
      if (!companyTrustLevels.has(companyIdentity.customerTrustLevel)) {
        return res.status(400).json({ error: "Invalid customer trust level" });
      }

      const updated = await pool.query(
        `UPDATE companies
            SET "companyName" = $1,
                "legalName" = $2,
                country = $3,
                "companyRegistrationNumber" = $4,
                "vatNumber" = $5,
                "websiteDomain" = $6,
                "customerTrustLevel" = $7,
                "authorizedContactName" = $8,
                "authorizedContactEmail" = $9,
                "updatedAt" = NOW()
          WHERE id = $10
          RETURNING *`,
        [
          companyIdentity.companyName,
          companyIdentity.legalName,
          companyIdentity.country,
          companyIdentity.companyRegistrationNumber,
          companyIdentity.vatNumber,
          companyIdentity.websiteDomain,
          companyIdentity.customerTrustLevel,
          companyIdentity.authorizedContactName,
          companyIdentity.authorizedContactEmail,
          companyId
        ]
      );
      if (!updated.rows.length) {
        return res.status(404).json({ error: "Company not found" });
      }
      res.json({ success: true, company: mapCompanyRow(updated.rows[0]) });
    } catch (error) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "Company name already exists" });
      }
      res.status(500).json({ error: "Failed to update company" });
    }
  });

  app.get("/api/admin/companies/:companyId/backup-policy", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      if (!backupProviderService?.getContinuityPolicy) {
        return res.status(503).json({ error: "Backup provider service is unavailable" });
      }
      const policy = backupProviderService.getContinuityPolicy({ companyId: req.params.companyId });
      return res.json(policy);
    } catch {
      return res.status(500).json({ error: "Failed to fetch backup continuity policy" });
    }
  });

  app.get("/api/admin/companies/:companyId/backup-continuity-evidence", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      if (!backupProviderService?.getContinuityEvidence) {
        return res.status(503).json({ error: "Backup provider service is unavailable" });
      }
      const evidence = await backupProviderService.getContinuityEvidence({ companyId: req.params.companyId });
      return res.json(evidence);
    } catch (error) {
      if ((error.message || "").includes("companyId")) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to fetch backup continuity evidence" });
    }
  });

  app.get("/api/admin/companies/:companyId/identifier-persistence-policy", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      if (!productIdentifierService?.getIdentifierPersistencePolicy) {
        return res.status(503).json({ error: "Product identifier service is unavailable" });
      }
      const policy = productIdentifierService.getIdentifierPersistencePolicy({
        companyId: req.params.companyId,
      });
      return res.json(policy);
    } catch {
      return res.status(500).json({ error: "Failed to fetch identifier persistence policy" });
    }
  });

  app.get("/api/admin/companies", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT c.*,
          COALESCE(
            ARRAY_AGG(cpa."passportTypeId") FILTER (WHERE cpa."passportTypeId" IS NOT NULL),
            '{}'
          ) AS "grantedTypes",
          COALESCE(
            ARRAY_AGG(DISTINCT pt."displayName" ORDER BY pt."displayName") FILTER (WHERE pt."displayName" IS NOT NULL),
            '{}'
          ) AS "grantedTypeNames"
        FROM companies c
        LEFT JOIN "companyPassportAccess" cpa ON cpa."companyId" = c.id
        LEFT JOIN "passportTypes" pt ON pt.id = cpa."passportTypeId"
        GROUP BY c.id
        ORDER BY c."createdAt" DESC
      `);
      res.json(result.rows.map(mapCompanyRow));
    } catch {
      res.status(500).json({ error: "Failed to fetch companies" });
    }
  });

  app.get("/api/admin/companies/:id/dpp-policy", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const companyId = parseInt(req.params.id, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const company = await pool.query(
        `SELECT id, "companyName"
         FROM companies
         WHERE id = $1
         LIMIT 1`,
        [companyId]
      );
      if (!company.rows.length) return res.status(404).json({ error: "Company not found" });

      const policy = await getCompanyDppPolicy(companyId);
      res.json({
        companyId: companyId,
        companyName: company.rows[0].companyName,
        ...policy
      });
    } catch (error) {
      logger.error("DPP policy fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch DPP policy" });
    }
  });

  app.put("/api/admin/companies/:id/dpp-policy", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const companyId = parseInt(req.params.id, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const company = await pool.query(
        `SELECT id
         FROM companies
         WHERE id = $1
         LIMIT 1`,
        [companyId]
      );
      if (!company.rows.length) return res.status(404).json({ error: "Company not found" });

      await ensureCompanyDppPolicy(companyId);
      const updates = validateCompanyDppPolicyInput(req.body || {});
      if (!Object.keys(updates).length) {
        return res.status(400).json({ error: "No policy fields supplied" });
      }

      const updatedPolicy = await updateCompanyDppPolicy(companyId, updates);
      await logAudit(
        companyId,
        req.user.userId,
        "updateCompanyDppPolicy",
        "companyDppPolicies",
        String(companyId),
        null,
        updates
      );

      res.json({ success: true, policy: updatedPolicy });
    } catch (error) {
      res.status(400).json({ error: error.message || "Failed to update DPP policy" });
    }
  });

  app.delete("/api/admin/companies/:companyId", authenticateToken, isSuperAdmin, async (req, res) => {
    const client = await pool.connect();
    let passportDppIds = [];
    let companyRepositoryDir = null;
    let passportStorageDirs = [];

    try {
      const { companyId } = req.params;
      const { password } = req.body || {};

      if (!password) return res.status(400).json({ error: "Admin password is required" });

      const adminRes = await client.query(
        'SELECT id, "passwordHash" AS "passwordHash" FROM users WHERE id = $1',
        [req.user.userId]
      );
      if (!adminRes.rows.length) return res.status(401).json({ error: "Admin user not found" });

      const valid = await verifyPassword(password, adminRes.rows[0].passwordHash);
      if (!valid) return res.status(403).json({ error: "Incorrect admin password" });

      await client.query("BEGIN");

      const companyRes = await client.query(
        "SELECT id, \"companyName\" FROM companies WHERE id = $1", [companyId]
      );
      if (!companyRes.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Company not found" });
      }

      const company = companyRes.rows[0];
      const userRes = await client.query('SELECT id FROM users WHERE "companyId" = $1', [companyId]);
      const userIds = userRes.rows.map((row) => row.id);

      const regRes = await client.query(
        "SELECT \"dppId\", \"passportType\" FROM \"passportRegistry\" WHERE \"companyId\" = $1", [companyId]
      );
      passportDppIds = regRes.rows.map((row) => row.dppId);
      const passportTypes = [...new Set(regRes.rows.map((row) => row.passportType).filter(Boolean))];
      // nosemgrep: javascript.express.security.audit.express-path-join-resolve-traversal.express-path-join-resolve-traversal -- The database-derived directory is validated against repoBaseDir before any deletion.
      companyRepositoryDir = path.resolve(repoBaseDir, String(company.id));
      passportStorageDirs = passportDppIds.map((dppId) => path.resolve(filesBaseDir, String(dppId)));
      if (!isPathInsideBase(companyRepositoryDir, repoBaseDir)
        || passportStorageDirs.some((directory) => !isPathInsideBase(directory, filesBaseDir))) {
        throw new Error("Refusing to remove company storage outside configured roots");
      }

      if (passportDppIds.length) {
        await client.query("DELETE FROM \"passportDynamicValues\" WHERE \"passportDppId\" = ANY($1::text[])", [passportDppIds]);
        await client.query("DELETE FROM \"passportSignatures\" WHERE \"passportDppId\" = ANY($1::text[])", [passportDppIds]);
        await client.query("DELETE FROM \"passportScanEvents\" WHERE \"passportDppId\" = ANY($1::text[])", [passportDppIds]);
        await client.query("DELETE FROM \"passportWorkflow\" WHERE \"passportDppId\" = ANY($1::text[])", [passportDppIds]);
        await client.query("DELETE FROM \"passportSecurityEvents\" WHERE \"passportDppId\" = ANY($1::text[])", [passportDppIds]);
        await client.query("DELETE FROM \"passportEditSessions\" WHERE \"passportDppId\" = ANY($1::text[])", [passportDppIds]);
      }

      for (const passportType of passportTypes) {
        const tableName = getTable(passportType);
        await client.query(`DELETE FROM ${tableName} WHERE "companyId" = $1`, [companyId]);
      }

      await client.query("DELETE FROM \"passportRegistry\" WHERE \"companyId\" = $1", [companyId]);
      await client.query("DELETE FROM \"inviteTokens\" WHERE \"companyId\" = $1", [companyId]);
      await client.query("DELETE FROM \"apiKeys\" WHERE \"companyId\" = $1", [companyId]);
      const repoFiles = await client.query(
        "SELECT \"storageKey\", \"filePath\" FROM \"companyRepository\" WHERE \"companyId\" = $1 AND (\"storageKey\" IS NOT NULL OR \"filePath\" IS NOT NULL)",
        [companyId]
      );
      await client.query("DELETE FROM \"companyRepository\" WHERE \"companyId\" = $1", [companyId]);
      await client.query("DELETE FROM \"companyPassportAccess\" WHERE \"companyId\" = $1", [companyId]);
      await client.query("DELETE FROM \"passportWorkflow\" WHERE \"companyId\" = $1", [companyId]);

      if (userIds.length) {
        await client.query("DELETE FROM notifications WHERE \"userId\" = ANY($1::int[])", [userIds]);
        await client.query("DELETE FROM \"passwordResetTokens\" WHERE \"userId\" = ANY($1::int[])", [userIds]);
      }

      await client.query('DELETE FROM users WHERE "companyId" = $1', [companyId]);
      await client.query("DELETE FROM companies WHERE id = $1", [companyId]);

      await client.query("COMMIT");

      await logAudit(
        null,
        req.user.userId,
        "deleteCompany",
        "companies",
        String(company.id),
        { company },
        { deletedCompanyId: company.id, deletedCompanyName: company.companyName },
        {
          actorIdentifier: req.user?.actorIdentifier || `user:${req.user.userId}`,
          audience: req.user?.role || null,
        }
      );

      await Promise.all(repoFiles.rows.map((row) => storageService.deleteStoredFile({
        storageKey: row.storageKey
      }).catch((error) => {
        logger.warn({ err: error, companyId, storageKey: row.storageKey }, "Failed to delete company repository file from storage");
      })));
      fs.rmSync(companyRepositoryDir, { recursive: true, force: true });
      passportStorageDirs.forEach((directory) => {
        fs.rmSync(directory, { recursive: true, force: true });
      });

      res.json({
        success: true,
        deletedCompany: company,
        deletedCurrentSessionUser: userIds.includes(req.user.userId)
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        logger.error({ err: rollbackError, companyId }, "Failed to roll back company deletion transaction");
      }
      logger.error("Delete company error:", error.message);
      res.status(500).json({ error: "Failed to delete company" });
    } finally {
      client.release();
    }
  });
};
