"use strict";

const fs = require("fs");
const path = require("path");
const logger = require("../../infrastructure/logging/logger");

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
    REPO_BASE_DIR,
    FILES_BASE_DIR,
    COMPANY_TRUST_LEVELS,
  } = deps;

  function mapCompanyRow(row = {}) {
    return {
      id: row.id ?? null,
      country: row.country ?? null,
      companyName: row.companyName ?? row.company_name ?? null,
      legalName: row.legalName ?? row.legal_name ?? null,
      companyRegistrationNumber: row.companyRegistrationNumber ?? row.company_registration_number ?? null,
      vatNumber: row.vatNumber ?? row.vat_number ?? null,
      websiteDomain: row.websiteDomain ?? row.website_domain ?? null,
      customerTrustLevel: row.customerTrustLevel ?? row.customer_trust_level ?? null,
      verificationStatus: row.verificationStatus ?? row.verification_status ?? null,
      authorizedContactName: row.authorizedContactName ?? row.authorized_contact_name ?? null,
      authorizedContactEmail: row.authorizedContactEmail ?? row.authorized_contact_email ?? null,
      isActive: row.isActive ?? row.is_active ?? null,
      assetManagementEnabled: row.assetManagementEnabled ?? row.asset_management_enabled ?? null,
      assetManagementRevokedAt: row.assetManagementRevokedAt ?? row.asset_management_revoked_at ?? null,
      grantedTypeNames: row.grantedTypeNames ?? row.granted_type_names ?? [],
      grantedTypes: row.grantedTypes ?? row.granted_types ?? [],
      createdAt: row.createdAt ?? row.created_at ?? null,
      updatedAt: row.updatedAt ?? row.updated_at ?? null,
    };
  }

  function normalizeCompanyIdentity(input = {}) {
    const normalizeText = (value) => {
      const normalized = String(value || "").trim();
      return normalized || null;
    };
    const companyName = String(input.companyName || "").trim();
    const trustLevel = String(input.customerTrustLevel || "").trim().toUpperCase();
    return {
      companyName,
      legalName: normalizeText(input.legalName),
      country: normalizeText(input.country)?.toUpperCase() || null,
      companyRegistrationNumber: normalizeText(input.companyRegistrationNumber),
      vatNumber: normalizeText(input.vatNumber),
      websiteDomain: normalizeText(input.websiteDomain),
      customerTrustLevel: trustLevel || "BASIC",
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
      if (!COMPANY_TRUST_LEVELS.has(companyIdentity.customerTrustLevel)) {
        return res.status(400).json({ error: "Invalid customer trust level" });
      }
      const result = await pool.query(
        `INSERT INTO companies (
          company_name,
          legal_name,
          country,
          company_registration_number,
          vat_number,
          website_domain,
          customer_trust_level,
          verification_status,
          authorized_contact_name,
          authorized_contact_email
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
                company_name,
                legal_name,
                country,
                company_registration_number,
                vat_number,
                website_domain,
                customer_trust_level,
                verification_status,
                authorized_contact_name,
                authorized_contact_email,
                is_active,
                created_at,
                updated_at
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
      if (!COMPANY_TRUST_LEVELS.has(companyIdentity.customerTrustLevel)) {
        return res.status(400).json({ error: "Invalid customer trust level" });
      }

      const updated = await pool.query(
        `UPDATE companies
            SET company_name = $1,
                legal_name = $2,
                country = $3,
                company_registration_number = $4,
                vat_number = $5,
                website_domain = $6,
                customer_trust_level = $7,
                authorized_contact_name = $8,
                authorized_contact_email = $9,
                updated_at = NOW()
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
            ARRAY_AGG(cpa.passport_type_id) FILTER (WHERE cpa.passport_type_id IS NOT NULL),
            '{}'
          ) AS granted_types,
          COALESCE(
            ARRAY_AGG(DISTINCT pt.display_name ORDER BY pt.display_name) FILTER (WHERE pt.display_name IS NOT NULL),
            '{}'
          ) AS granted_type_names
        FROM companies c
        LEFT JOIN company_passport_access cpa ON cpa.company_id = c.id
        LEFT JOIN passport_types pt ON pt.id = cpa.passport_type_id
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `);
      res.json(result.rows.map(mapCompanyRow));
    } catch {
      res.status(500).json({ error: "Failed to fetch companies" });
    }
  });

  app.patch("/api/admin/companies/:companyId/asset-management", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { companyId } = req.params;
      const { enabled } = req.body || {};
      if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });

      const updated = await pool.query(
        `UPDATE companies
         SET asset_management_enabled = $1,
             asset_management_revoked_at = CASE WHEN $1 THEN NULL ELSE NOW() END,
             updated_at = NOW()
         WHERE id = $2
         RETURNING id, company_name, asset_management_enabled, asset_management_revoked_at`,
        [enabled, companyId]
      );
      if (!updated.rows.length) return res.status(404).json({ error: "Company not found" });

      await logAudit(
        null, req.user.userId,
        enabled ? "ENABLE_ASSET_MANAGEMENT" : "REVOKE_ASSET_MANAGEMENT",
        "companies", companyId, null, { asset_management_enabled: enabled }
      );

      if (!enabled) {
        await pool.query(
          `UPDATE asset_management_jobs
           SET is_active = false, next_run_at = NULL, updated_at = NOW()
           WHERE company_id = $1`,
          [companyId]
        );
      }

      res.json({ success: true, company: mapCompanyRow(updated.rows[0]) });
    } catch (error) {
      logger.error("Asset management toggle error:", error.message);
      res.status(500).json({ error: "Failed to update Asset Management access" });
    }
  });

  app.get("/api/admin/companies/:id/dpp-policy", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const companyId = parseInt(req.params.id, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const company = await pool.query(
        `SELECT id, company_name
         FROM companies
         WHERE id = $1
         LIMIT 1`,
        [companyId]
      );
      if (!company.rows.length) return res.status(404).json({ error: "Company not found" });

      const policy = await getCompanyDppPolicy(companyId);
      res.json({
        company_id: companyId,
        company_name: company.rows[0].company_name,
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
        "UPDATE_COMPANY_DPP_POLICY",
        "company_dpp_policies",
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

    try {
      const { companyId } = req.params;
      const { password } = req.body || {};

      if (!password) return res.status(400).json({ error: "Admin password is required" });

      const adminRes = await client.query(
        "SELECT id, password_hash FROM users WHERE id = $1", [req.user.userId]
      );
      if (!adminRes.rows.length) return res.status(401).json({ error: "Admin user not found" });

      const valid = await verifyPassword(password, adminRes.rows[0].password_hash);
      if (!valid) return res.status(403).json({ error: "Incorrect admin password" });

      await client.query("BEGIN");

      const companyRes = await client.query(
        "SELECT id, company_name FROM companies WHERE id = $1", [companyId]
      );
      if (!companyRes.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Company not found" });
      }

      const company = companyRes.rows[0];
      const userRes = await client.query("SELECT id FROM users WHERE company_id = $1", [companyId]);
      const userIds = userRes.rows.map((row) => row.id);

      const regRes = await client.query(
        "SELECT \"dppId\", \"passportType\" FROM passport_registry WHERE \"companyId\" = $1", [companyId]
      );
      passportDppIds = regRes.rows.map((row) => row.dppId);
      const passportTypes = [...new Set(regRes.rows.map((row) => row.passportType).filter(Boolean))];

      if (passportDppIds.length) {
        await client.query("DELETE FROM passport_dynamic_values WHERE \"passportDppId\" = ANY($1::text[])", [passportDppIds]);
        await client.query("DELETE FROM passport_signatures WHERE \"passportDppId\" = ANY($1::text[])", [passportDppIds]);
        await client.query("DELETE FROM passport_scan_events WHERE \"passportDppId\" = ANY($1::text[])", [passportDppIds]);
        await client.query("DELETE FROM passport_workflow WHERE \"passportDppId\" = ANY($1::text[])", [passportDppIds]);
        await client.query("DELETE FROM passport_security_events WHERE \"passportDppId\" = ANY($1::text[])", [passportDppIds]);
        await client.query("DELETE FROM passport_edit_sessions WHERE \"passportDppId\" = ANY($1::text[])", [passportDppIds]);
      }

      for (const passportType of passportTypes) {
        const tableName = getTable(passportType);
        await client.query(`DELETE FROM ${tableName} WHERE "companyId" = $1`, [companyId]);
      }

      await client.query("DELETE FROM passport_registry WHERE \"companyId\" = $1", [companyId]);
      await client.query("DELETE FROM invite_tokens WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM api_keys WHERE company_id = $1", [companyId]);
      const repoFiles = await client.query(
        "SELECT storage_key, file_path FROM company_repository WHERE company_id = $1 AND (storage_key IS NOT NULL OR file_path IS NOT NULL)",
        [companyId]
      );
      await client.query("DELETE FROM company_repository WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM company_passport_access WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM passport_workflow WHERE \"companyId\" = $1", [companyId]);

      if (userIds.length) {
        await client.query("DELETE FROM notifications WHERE \"userId\" = ANY($1::int[])", [userIds]);
        await client.query("DELETE FROM password_reset_tokens WHERE user_id = ANY($1::int[])", [userIds]);
      }

      await client.query("DELETE FROM users WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM companies WHERE id = $1", [companyId]);

      await client.query("COMMIT");

      await logAudit(
        null,
        req.user.userId,
        "DELETE_COMPANY",
        "companies",
        String(company.id),
        { company },
        { deletedCompanyId: company.id, deletedCompanyName: company.company_name },
        {
          actorIdentifier: req.user?.actorIdentifier || `user:${req.user.userId}`,
          audience: req.user?.role || null,
        }
      );

      await Promise.all(repoFiles.rows.map((row) => storageService.deleteStoredFile({
        storageKey: row.storage_key
      }).catch(() => {})));
      const repoDir = path.join(REPO_BASE_DIR, String(companyId));
      fs.rmSync(repoDir, { recursive: true, force: true });
      passportDppIds.forEach((dppId) => {
        fs.rmSync(path.join(FILES_BASE_DIR, String(dppId)), { recursive: true, force: true });
      });

      res.json({
        success: true,
        deletedCompany: company,
        deletedCurrentSessionUser: userIds.includes(req.user.userId)
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      logger.error("Delete company error:", error.message);
      res.status(500).json({ error: "Failed to delete company" });
    } finally {
      client.release();
    }
  });
};
