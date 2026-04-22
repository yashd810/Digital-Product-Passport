"use strict";
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs   = require("fs");

module.exports = function registerAdminRoutes(app, {
  pool,
  multer,
  authenticateToken,
  isSuperAdmin,
  checkCompanyAccess,
  verifyPassword,
  logAudit,
  getTable,
  createPassportTable,
  queryTableStats,
  publicReadRateLimit,
  GLOBAL_SYMBOLS_DIR,
  REPO_BASE_DIR,
  FILES_BASE_DIR,
  IN_REVISION_STATUS,
  IN_REVISION_STATUSES_SQL,
  createTransporter,
  brandedEmail,
  storageService,
}) {

  // ─── UMBRELLA CATEGORIES ───────────────────────────────────────────────────
  app.get("/api/admin/umbrella-categories", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const r = await pool.query("SELECT * FROM umbrella_categories ORDER BY name");
      res.json(r.rows);
    } catch (e) { console.error("List umbrellas error:", e.message); res.status(500).json({ error: "Failed to fetch categories" }); }
  });

  app.post("/api/admin/umbrella-categories", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { name, icon = "📋" } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
      const r = await pool.query(
        "INSERT INTO umbrella_categories (name, icon) VALUES ($1, $2) RETURNING *",
        [name.trim(), icon]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) {
      if (e.code === "23505") return res.status(400).json({ error: "Category already exists" });
      res.status(500).json({ error: "Failed to create category" });
    }
  });

  app.delete("/api/admin/umbrella-categories/:id", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ error: "Password is required" });

      const userRow = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.userId]);
      if (!userRow.rows.length) return res.status(401).json({ error: "User not found" });
      const valid = await verifyPassword(password, userRow.rows[0].password_hash);
      if (!valid) return res.status(403).json({ error: "Incorrect password" });

      const cat = await pool.query("SELECT name FROM umbrella_categories WHERE id = $1", [req.params.id]);
      if (!cat.rows.length) return res.status(404).json({ error: "Category not found" });
      const usage = await pool.query(
        "SELECT COUNT(*) FROM passport_types WHERE umbrella_category = $1", [cat.rows[0].name]
      );
      if (parseInt(usage.rows[0].count) > 0)
        return res.status(400).json({ error: "Cannot delete — passport types are using this category" });
      await pool.query("DELETE FROM umbrella_categories WHERE id = $1", [req.params.id]);
      await logAudit(null, req.user.userId, "DELETE_PRODUCT_CATEGORY", "umbrella_categories", req.params.id, null,
        { name: cat.rows[0].name });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed to delete category" }); }
  });

  // ─── PASSPORT TYPES (listing) ──────────────────────────────────────────────
  app.get("/api/admin/passport-types", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT pt.id, pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon, pt.semantic_model_key,
               pt.fields_json, pt.is_active, pt.created_at,
               u.email AS created_by_email
        FROM passport_types pt
        LEFT JOIN users u ON u.id = pt.created_by
        ORDER BY pt.umbrella_category, pt.display_name
      `);
      res.json(r.rows);
    } catch (e) { console.error("List passport types error:", e.message); res.status(500).json({ error: "Failed to fetch passport types" }); }
  });

  // Public — used by PassportViewer and PassportForm
  app.get("/api/passport-types/:typeName", publicReadRateLimit, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, type_name, display_name, umbrella_category, umbrella_icon, semantic_model_key, fields_json
         FROM passport_types WHERE type_name = $1`,
        [req.params.typeName]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport type not found" });
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: "Failed to fetch passport type" }); }
  });

  // ─── PASSPORT TYPES (CRUD by super admin) ─────────────────────────────────
  app.patch("/api/admin/passport-types/:id", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { display_name, umbrella_category, umbrella_icon, semantic_model_key, sections } = req.body;
      const { id } = req.params;

      const existing = await pool.query("SELECT * FROM passport_types WHERE id = $1", [id]);
      if (!existing.rows.length) return res.status(404).json({ error: "Passport type not found" });

      const updates = [];
      const vals = [];
      let idx = 1;

      if (display_name !== undefined)      { updates.push(`display_name = $${idx++}`);      vals.push(display_name); }
      if (umbrella_category !== undefined) { updates.push(`umbrella_category = $${idx++}`); vals.push(umbrella_category); }
      if (umbrella_icon !== undefined)     { updates.push(`umbrella_icon = $${idx++}`);     vals.push(umbrella_icon); }
      if (semantic_model_key !== undefined) { updates.push(`semantic_model_key = $${idx++}`); vals.push(semantic_model_key || null); }
      if (sections !== undefined) {
        const fields_json = { sections };
        updates.push(`fields_json = $${idx++}`);
        vals.push(JSON.stringify(fields_json));
      }

      if (updates.length === 0) return res.status(400).json({ error: "Nothing to update" });

      vals.push(id);
      const r = await pool.query(
        `UPDATE passport_types SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
        vals
      );

      await logAudit(null, req.user.userId, "UPDATE_PASSPORT_TYPE_METADATA", "passport_types", null, null,
        { type_name: existing.rows[0].type_name, updated_fields: updates });

      res.json({ success: true, passportType: r.rows[0] });
    } catch (e) {
      console.error("Patch passport type error:", e.message);
      res.status(500).json({ error: "Failed to update passport type" });
    }
  });

  app.delete("/api/admin/passport-types/:typeId", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { typeId } = req.params;
      const { password } = req.body;
      if (!password) return res.status(400).json({ error: "Password is required" });

      const userRow = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.userId]);
      if (!userRow.rows.length) return res.status(401).json({ error: "User not found" });
      const valid = await verifyPassword(password, userRow.rows[0].password_hash);
      if (!valid) return res.status(403).json({ error: "Incorrect password" });

      const typeRow = await pool.query(
        "SELECT type_name, display_name FROM passport_types WHERE id = $1", [typeId]
      );
      if (!typeRow.rows.length) return res.status(404).json({ error: "Passport type not found" });
      const { type_name, display_name } = typeRow.rows[0];

      await pool.query("DELETE FROM passport_types WHERE id = $1", [typeId]);

      const tbl = getTable(type_name);
      if (!/^passport_type_[a-z0-9_]+$/.test(tbl)) {
        throw new Error(`Refusing to drop table with unexpected name: ${tbl}`);
      }
      await pool.query(`DROP TABLE IF EXISTS "${tbl}"`);

      await logAudit(null, req.user.userId, "DELETE_PASSPORT_TYPE", "passport_types", null, null,
        { type_name, display_name });

      res.json({ success: true });
    } catch (e) {
      console.error("Delete passport type error:", e.message);
      res.status(500).json({ error: "Failed to delete passport type" });
    }
  });

  app.post("/api/admin/passport-types", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { type_name, display_name, umbrella_category, umbrella_icon, semantic_model_key, sections } = req.body;

      if (!type_name || !display_name || !umbrella_category || !sections)
        return res.status(400).json({ error: "type_name, display_name, umbrella_category, and sections are required" });

      if (!/^[a-z][a-z0-9_]{1,99}$/.test(type_name))
        return res.status(400).json({
          error: "type_name must be lowercase letters/numbers/underscores, 2–100 chars, start with a letter"
        });

      if (!Array.isArray(sections) || sections.length === 0)
        return res.status(400).json({ error: "At least one section is required" });

      for (const section of sections) {
        if (!section.key || !section.label || !Array.isArray(section.fields))
          return res.status(400).json({ error: "Each section must have key, label, and fields array" });
        if (!/^[a-z][a-z0-9_]{0,199}$/.test(section.key))
          return res.status(400).json({ error: `Invalid section key: ${section.key}` });
        for (const field of section.fields) {
          if (!field.key || !field.label || !field.type)
            return res.status(400).json({ error: "Each field must have key, label, and type" });
          if (!/^[a-zA-Z][a-zA-Z0-9_]{0,199}$/.test(field.key))
            return res.status(400).json({ error: `Invalid field key: ${field.key}` });
          if (!["text","textarea","boolean","file","table","url","date","symbol"].includes(field.type))
            return res.status(400).json({ error: `Invalid field type: ${field.type}` });
        }
      }

      const fields_json = { sections };

      const r = await pool.query(
        `INSERT INTO passport_types (type_name, display_name, umbrella_category, umbrella_icon, semantic_model_key, fields_json, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [type_name, display_name, umbrella_category, umbrella_icon || "📋",
         semantic_model_key || null, JSON.stringify(fields_json), req.user.userId]
      );

      await pool.query(
        "INSERT INTO umbrella_categories (name, icon) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
        [umbrella_category, umbrella_icon || "📋"]
      );

      await createPassportTable(type_name);

      await logAudit(null, req.user.userId, "CREATE_PASSPORT_TYPE", "passport_types", null, null,
        { type_name, display_name, umbrella_category, semantic_model_key: semantic_model_key || null });

      res.status(201).json({ success: true, passportType: r.rows[0] });
    } catch (e) {
      if (e.code === "23505") return res.status(400).json({ error: "A passport type with this type_name already exists" });
      console.error("Create passport type error:", e.message);
      res.status(500).json({ error: "Failed to create passport type" });
    }
  });

  // ─── PASSPORT TYPE DRAFT ───────────────────────────────────────────────────
  app.get("/api/admin/passport-type-draft", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        "SELECT id, draft_json, created_at, updated_at FROM passport_type_drafts WHERE user_id = $1",
        [req.user.userId]
      );
      if (!r.rows.length) return res.json(null);
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: "Failed to fetch draft" }); }
  });

  app.put("/api/admin/passport-type-draft", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { draft_json } = req.body;
      if (!draft_json || typeof draft_json !== "object")
        return res.status(400).json({ error: "draft_json object is required" });
      const r = await pool.query(
        `INSERT INTO passport_type_drafts (user_id, draft_json)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
           SET draft_json = EXCLUDED.draft_json,
               updated_at = NOW()
         RETURNING id, updated_at`,
        [req.user.userId, JSON.stringify(draft_json)]
      );
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: "Failed to save draft" }); }
  });

  app.delete("/api/admin/passport-type-draft", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM passport_type_drafts WHERE user_id = $1", [req.user.userId]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed to delete draft" }); }
  });

  // ─── SYMBOLS ───────────────────────────────────────────────────────────────
  const symbolUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = [".svg", ".png", ".jpg", ".jpeg", ".webp"];
      if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
      else cb(new Error("Only SVG, PNG, JPG, WebP files are allowed"));
    },
  });

  app.get("/api/symbols", authenticateToken, async (req, res) => {
    try {
      const { category } = req.query;
      let q = "SELECT id, name, category, file_url, created_at FROM symbols WHERE is_active = true";
      const params = [];
      if (category) { q += " AND category = $1"; params.push(category); }
      q += " ORDER BY category, name";
      const r = await pool.query(q, params);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: "Failed to fetch symbols" }); }
  });

  app.get("/api/symbols/categories", authenticateToken, async (req, res) => {
    try {
      const r = await pool.query(
        "SELECT DISTINCT category FROM symbols WHERE is_active = true ORDER BY category"
      );
      res.json(r.rows.map(row => row.category));
    } catch (e) { res.status(500).json({ error: "Failed to fetch categories" }); }
  });

  app.post("/api/admin/symbols", authenticateToken, isSuperAdmin, symbolUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const { name, category = "General" } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "name is required" });

      const stored = await storageService.saveGlobalSymbol({
        originalName: req.file.originalname,
        buffer: req.file.buffer,
        contentType: req.file.mimetype,
      });

      const r = await pool.query(
        "INSERT INTO symbols (name, category, storage_key, storage_provider, file_url, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [name.trim(), category.trim() || "General", stored.storageKey, stored.provider, stored.url, req.user.userId]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) {
      console.error("Symbol upload error:", e.message);
      res.status(500).json({ error: e.message || "Failed to upload symbol" });
    }
  });

  app.delete("/api/admin/symbols/:id", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        "UPDATE symbols SET is_active = false WHERE id = $1 RETURNING id",
        [req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Symbol not found" });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed to delete symbol" }); }
  });

  app.patch("/api/admin/passport-types/:id/deactivate", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        "UPDATE passport_types SET is_active = false WHERE id = $1 RETURNING id, type_name, display_name, is_active",
        [req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport type not found" });
      res.json({ success: true, passportType: r.rows[0] });
    } catch (e) { res.status(500).json({ error: "Failed to deactivate passport type" }); }
  });

  app.patch("/api/admin/passport-types/:id/activate", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        "UPDATE passport_types SET is_active = true WHERE id = $1 RETURNING id, type_name, display_name, is_active",
        [req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport type not found" });
      res.json({ success: true, passportType: r.rows[0] });
    } catch (e) { res.status(500).json({ error: "Failed to activate passport type" }); }
  });

  // ─── COMPANIES ─────────────────────────────────────────────────────────────
  app.post("/api/admin/companies", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { companyName } = req.body;
      if (!companyName) return res.status(400).json({ error: "Company name required" });
      const r = await pool.query(
        "INSERT INTO companies (company_name) VALUES ($1) RETURNING *",
        [companyName]
      );
      res.status(201).json({ success: true, company: r.rows[0] });
    } catch (e) { res.status(500).json({ error: "Failed to create company" }); }
  });

  app.get("/api/admin/companies", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const r = await pool.query(`
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
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: "Failed to fetch companies" }); }
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

      res.json({ success: true, company: updated.rows[0] });
    } catch (e) {
      console.error("Asset management toggle error:", e.message);
      res.status(500).json({ error: "Failed to update Asset Management access" });
    }
  });

  app.delete("/api/admin/companies/:companyId", authenticateToken, isSuperAdmin, async (req, res) => {
    const client = await pool.connect();
    let passportGuids = [];

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
        "SELECT guid, passport_type FROM passport_registry WHERE company_id = $1", [companyId]
      );
      passportGuids = regRes.rows.map((row) => row.guid);
      const passportTypes = [...new Set(regRes.rows.map((row) => row.passport_type).filter(Boolean))];

      await client.query(
        `INSERT INTO audit_logs (company_id, user_id, action, table_name, passport_guid, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [null, req.user.userId, "DELETE_COMPANY", "companies", null,
         JSON.stringify({ company }),
         JSON.stringify({ deleted_company_id: company.id, deleted_company_name: company.company_name })]
      );

      if (passportGuids.length) {
        await client.query("DELETE FROM passport_dynamic_values WHERE passport_guid = ANY($1::uuid[])", [passportGuids]);
        await client.query("DELETE FROM passport_signatures WHERE passport_guid = ANY($1::uuid[])", [passportGuids]);
        await client.query("DELETE FROM passport_scan_events WHERE passport_guid = ANY($1::uuid[])", [passportGuids]);
        await client.query("DELETE FROM passport_workflow WHERE passport_guid = ANY($1::uuid[])", [passportGuids]);
      }

      for (const passportType of passportTypes) {
        const tableName = getTable(passportType);
        await client.query(`DELETE FROM ${tableName} WHERE company_id = $1`, [companyId]);
      }

      await client.query("DELETE FROM passport_registry WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM invite_tokens WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM api_keys WHERE company_id = $1", [companyId]);
      const repoFiles = await client.query(
        "SELECT storage_key, file_path FROM company_repository WHERE company_id = $1 AND (storage_key IS NOT NULL OR file_path IS NOT NULL)",
        [companyId]
      );
      await client.query("DELETE FROM company_repository WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM company_passport_access WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM passport_workflow WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM audit_logs WHERE company_id = $1", [companyId]);

      if (userIds.length) {
        await client.query("DELETE FROM notifications WHERE user_id = ANY($1::int[])", [userIds]);
        await client.query("DELETE FROM password_reset_tokens WHERE user_id = ANY($1::int[])", [userIds]);
      }

      await client.query("DELETE FROM users WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM companies WHERE id = $1", [companyId]);

      await client.query("COMMIT");

      await Promise.all(repoFiles.rows.map((row) => storageService.deleteStoredFile({
        storageKey: row.storage_key,
        filePath: row.file_path,
      }).catch(() => {})));
      const repoDir = path.join(REPO_BASE_DIR, String(companyId));
      fs.rmSync(repoDir, { recursive: true, force: true });
      passportGuids.forEach((guid) => {
        fs.rmSync(path.join(FILES_BASE_DIR, String(guid)), { recursive: true, force: true });
      });

      res.json({
        success: true,
        deletedCompany: company,
        deletedCurrentSessionUser: userIds.includes(req.user.userId),
      });
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("Delete company error:", e.message);
      res.status(500).json({ error: "Failed to delete company" });
    } finally {
      client.release();
    }
  });

  // ─── SUPER ADMINS ──────────────────────────────────────────────────────────
  app.get("/api/admin/super-admins", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, email, first_name, last_name, is_active, created_at, last_login_at
         FROM users WHERE role = 'super_admin'
         ORDER BY is_active DESC, created_at ASC`
      );
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: "Failed to fetch super admins" }); }
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

      const inviter = await pool.query("SELECT first_name, last_name, email FROM users WHERE id = $1", [req.user.userId]);
      const inviterName = inviter.rows.length
        ? `${inviter.rows[0].first_name || ""} ${inviter.rows[0].last_name || ""}`.trim() || inviter.rows[0].email
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
          message: `Super admin invite created for ${inviteeEmail}. Share the registration link manually.`,
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
          ` }),
        });
      } catch (mailErr) {
        console.error("Super admin invite mail error:", mailErr.message);
        return res.status(201).json({
          success: true, emailSent: false, registerUrl,
          warning: "Invite created, but the email could not be sent.",
          detail: mailErr.message,
          message: `Super admin invite created for ${inviteeEmail}. Share the registration link manually.`,
        });
      }

      res.status(201).json({ success: true, emailSent: true, message: `Invitation sent to ${inviteeEmail}` });
    } catch (e) {
      console.error("Super admin invite error:", e.message);
      res.status(500).json({ error: "Failed to send super admin invitation", detail: e.message });
    }
  });

  app.patch("/api/admin/super-admins/:userId/access", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const { active } = req.body || {};
      if (typeof active !== "boolean") return res.status(400).json({ error: "active must be true or false" });

      const targetRes = await pool.query(
        "SELECT id, email, is_active FROM users WHERE id = $1 AND role = 'super_admin'", [userId]
      );
      if (!targetRes.rows.length) return res.status(404).json({ error: "Super admin not found" });

      if (!active) {
        const countRes = await pool.query(
          "SELECT COUNT(*)::int AS count FROM users WHERE role = 'super_admin' AND is_active = true"
        );
        const activeCount = countRes.rows[0]?.count || 0;
        if (activeCount <= 1 && targetRes.rows[0].is_active) {
          return res.status(400).json({ error: "At least one active super admin must remain" });
        }
      }

      const updated = await pool.query(
        `UPDATE users SET is_active = $1, updated_at = NOW()
         WHERE id = $2 AND role = 'super_admin'
         RETURNING id, email, first_name, last_name, is_active, created_at, last_login_at`,
        [active, userId]
      );

      await logAudit(null, req.user.userId,
        active ? "RESTORE_SUPER_ADMIN_ACCESS" : "REVOKE_SUPER_ADMIN_ACCESS",
        "users", null, { user_id: userId }, { active }
      );

      res.json({
        success: true,
        user: updated.rows[0],
        revokedCurrentSessionUser: !active && Number(userId) === Number(req.user.userId),
      });
    } catch (e) {
      console.error("Super admin access update error:", e.message);
      res.status(500).json({ error: "Failed to update super admin access" });
    }
  });

  // ─── ADMIN ANALYTICS ───────────────────────────────────────────────────────
  app.get("/api/admin/analytics", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const companiesRes = await pool.query("SELECT id, company_name FROM companies ORDER BY company_name");
      const accessRes    = await pool.query(`
        SELECT cpa.company_id, pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon
        FROM company_passport_access cpa
        JOIN passport_types pt ON pt.id = cpa.passport_type_id
      `);

      const archivedRes        = await pool.query(`SELECT COUNT(DISTINCT guid) FROM passport_archives`);
      const archivedByCoRes    = await pool.query(`SELECT company_id, COUNT(DISTINCT guid) AS count FROM passport_archives GROUP BY company_id`);
      const archivedByTypeRes  = await pool.query(`SELECT company_id, passport_type, COUNT(DISTINCT guid) AS count FROM passport_archives GROUP BY company_id, passport_type`);
      const archivedByCompany  = {};
      archivedByCoRes.rows.forEach(r => { archivedByCompany[r.company_id] = parseInt(r.count) || 0; });
      const archivedByType = {};
      archivedByTypeRes.rows.forEach(r => {
        const key = `${r.company_id}:${r.passport_type}`;
        archivedByType[key] = parseInt(r.count) || 0;
      });

      const overall = {
        total_companies: companiesRes.rows.length,
        total_passports: 0, draft_count: 0, in_review_count: 0, released_count: 0, revised_count: 0, obsolete_count: 0,
        archived_count: parseInt(archivedRes.rows[0].count) || 0,
      };
      const byCompany  = [];
      const byType     = [];
      const umbrellaMap = {};

      for (const company of companiesRes.rows) {
        const grantedTypes = accessRes.rows.filter(a => a.company_id === company.id);

        let compStats = { id: company.id, company_name: company.company_name,
                          total_passports: 0, draft_count: 0, in_review_count: 0, released_count: 0, revised_count: 0, obsolete_count: 0,
                          archived_count: archivedByCompany[company.id] || 0 };

        for (const typeAccess of grantedTypes) {
          try {
            const stats = await queryTableStats(typeAccess.type_name, company.id);
            if (stats.total === 0) continue;

            compStats.total_passports  += stats.total;
            compStats.draft_count      += stats.draft;
            compStats.in_review_count  += stats.in_review;
            compStats.released_count   += stats.released;
            compStats.revised_count    += stats.revised;
            compStats.obsolete_count   += stats.obsolete;

            overall.total_passports  += stats.total;
            overall.draft_count      += stats.draft;
            overall.in_review_count  += stats.in_review;
            overall.released_count   += stats.released;
            overall.revised_count    += stats.revised;
            overall.obsolete_count   += stats.obsolete;

            const umb = typeAccess.umbrella_category;
            const typeArchived = archivedByType[`${company.id}:${typeAccess.type_name}`] || 0;
            if (!umbrellaMap[umb]) {
              umbrellaMap[umb] = {
                umbrella_category: umb, umbrella_icon: typeAccess.umbrella_icon,
                total: 0, draft: 0, released: 0, revised: 0, obsolete: 0, archived: 0, types: {},
              };
            }
            umbrellaMap[umb].total    += stats.total;
            umbrellaMap[umb].draft    += stats.draft;
            umbrellaMap[umb].released += stats.released;
            umbrellaMap[umb].revised  += stats.revised;
            umbrellaMap[umb].obsolete += stats.obsolete;
            umbrellaMap[umb].archived += typeArchived;

            const tKey = typeAccess.type_name;
            if (!umbrellaMap[umb].types[tKey]) {
              umbrellaMap[umb].types[tKey] = {
                type_name: tKey, display_name: typeAccess.display_name,
                total: 0, draft: 0, released: 0, revised: 0, obsolete: 0, archived: 0,
              };
            }
            umbrellaMap[umb].types[tKey].total    += stats.total;
            umbrellaMap[umb].types[tKey].draft    += stats.draft;
            umbrellaMap[umb].types[tKey].released += stats.released;
            umbrellaMap[umb].types[tKey].revised  += stats.revised;
            umbrellaMap[umb].types[tKey].obsolete += stats.obsolete;
            umbrellaMap[umb].types[tKey].archived += typeArchived;

            byType.push({
              company_name: company.company_name, passport_type: typeAccess.type_name,
              display_name: typeAccess.display_name, umbrella_category: umb,
              total_count: stats.total, draft_count: stats.draft,
              released_count: stats.released, revised_count: stats.revised,
            });
          } catch (e) { console.error(`Analytics error for ${company.id}/${typeAccess.type_name}:`, e.message); }
        }

        byCompany.push(compStats);
      }

      const byUmbrella = Object.values(umbrellaMap).map(u => ({
        ...u, types: Object.values(u.types),
      }));

      // Include archived in total counts
      overall.total_passports += overall.archived_count;
      byCompany.forEach(c => { c.total_passports += c.archived_count; });

      res.json({ overall, byCompany, byType, byUmbrella });
    } catch (e) { console.error("Admin analytics error:", e.message); res.status(500).json({ error: "Failed to fetch analytics" }); }
  });

  app.get("/api/admin/companies/:companyId/analytics", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { companyId } = req.params;

      const accessRes = await pool.query(`
        SELECT pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon, cpa.granted_at
        FROM company_passport_access cpa
        JOIN passport_types pt ON pt.id = cpa.passport_type_id
        WHERE cpa.company_id = $1
      `, [companyId]);

      let totalPassports = 0;
      const analytics    = [];
      const trendMonths = [];
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const firstGrantedAt = accessRes.rows
        .map((row) => row.granted_at ? new Date(row.granted_at) : null)
        .filter((value) => value && !Number.isNaN(value.getTime()))
        .sort((a, b) => a - b)[0];
      const trendStart = firstGrantedAt
        ? new Date(firstGrantedAt.getFullYear(), firstGrantedAt.getMonth(), 1)
        : new Date(currentMonthStart);

      for (let month = new Date(trendStart); month <= currentMonthStart; month.setMonth(month.getMonth() + 1)) {
        trendMonths.push(new Date(month));
      }
      const trendSeriesMap = {};

      for (const { type_name, display_name, umbrella_category, umbrella_icon } of accessRes.rows) {
        try {
          const stats = await queryTableStats(type_name, companyId);
          if (stats.total === 0) continue;
          totalPassports += stats.total;
          analytics.push({
            passport_type: type_name, display_name, umbrella_category, umbrella_icon,
            total: stats.total, draft_count: stats.draft, released_count: stats.released,
            revised_count: stats.revised, in_review_count: stats.in_review, obsolete_count: stats.obsolete,
          });

          const tableName = getTable(type_name);
          const baselineRes = await pool.query(
            `SELECT COUNT(*) AS count FROM ${tableName}
             WHERE company_id = $1 AND deleted_at IS NULL AND created_at < $2`,
            [companyId, trendStart.toISOString()]
          );
          const monthlyRes = await pool.query(
            `SELECT date_trunc('month', created_at) AS month_bucket, COUNT(*) AS count
             FROM ${tableName}
             WHERE company_id = $1 AND deleted_at IS NULL AND created_at >= $2
             GROUP BY 1 ORDER BY 1`,
            [companyId, trendStart.toISOString()]
          );

          if (!trendSeriesMap[umbrella_category]) {
            trendSeriesMap[umbrella_category] = {
              umbrella_category, umbrella_icon, baseline: 0,
              monthlyCounts: Object.fromEntries(
                trendMonths.map((month) => [month.toISOString().slice(0, 7), 0])
              ),
            };
          }

          trendSeriesMap[umbrella_category].baseline += parseInt(baselineRes.rows[0]?.count || 0, 10);
          monthlyRes.rows.forEach((row) => {
            const key = new Date(row.month_bucket).toISOString().slice(0, 7);
            trendSeriesMap[umbrella_category].monthlyCounts[key] =
              (trendSeriesMap[umbrella_category].monthlyCounts[key] || 0) + parseInt(row.count || 0, 10);
          });
        } catch (e) { console.error(`Per-company analytics error for ${companyId}/${type_name}:`, e.message); }
      }

      const scanRes = await pool.query(
        `SELECT COUNT(DISTINCT (pse.passport_guid, pse.viewer_user_id)) FROM passport_scan_events pse
         JOIN passport_registry pr ON pr.guid = pse.passport_guid
         WHERE pr.company_id = $1 AND pse.viewer_user_id IS NOT NULL`,
        [companyId]
      );
      const scanStats = parseInt(scanRes.rows[0]?.count || 0, 10) || 0;
      const archivedRes = await pool.query(
        `SELECT COUNT(DISTINCT guid) FROM passport_archives WHERE company_id = $1`, [companyId]
      );
      const archivedCount = parseInt(archivedRes.rows[0]?.count || 0, 10) || 0;
      totalPassports += archivedCount;
      const trend = {
        labels: trendMonths.map((month) => month.toLocaleString("en-US", { month: "short", year: "2-digit" })),
        series: Object.values(trendSeriesMap).map((series) => {
          let running = series.baseline;
          return {
            umbrella_category: series.umbrella_category,
            umbrella_icon: series.umbrella_icon,
            values: trendMonths.map((month) => {
              const key = month.toISOString().slice(0, 7);
              running += series.monthlyCounts[key] || 0;
              return running;
            }),
          };
        }),
      };

      const users = await pool.query(
        `SELECT id, email, first_name, last_name, role, is_active, created_at, last_login_at
         FROM users WHERE company_id = $1 AND role != 'super_admin' ORDER BY role, first_name`,
        [companyId]
      );
      const comp = await pool.query("SELECT company_name FROM companies WHERE id = $1", [companyId]);

      res.json({ totalPassports, analytics, scanStats, archivedCount, trend, users: users.rows, company: comp.rows[0] });
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  // ─── USER ROLE / COMPANY ACCESS ────────────────────────────────────────────
  app.patch("/api/admin/users/:userId/role", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { role } = req.body;
      if (!["company_admin","editor","viewer"].includes(role))
        return res.status(400).json({ error: "Invalid role" });
      await pool.query("UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2", [role, req.params.userId]);
      res.json({ success: true });
    } catch { res.status(500).json({ error: "Failed" }); }
  });

  app.post("/api/admin/company-access", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { companyId, passportTypeId } = req.body;
      if (!companyId || !passportTypeId)
        return res.status(400).json({ error: "companyId and passportTypeId required" });

      const typeRes = await pool.query(
        "SELECT type_name, display_name FROM passport_types WHERE id = $1", [passportTypeId]
      );
      if (!typeRes.rows.length) return res.status(404).json({ error: "Passport type not found" });
      const { type_name, display_name } = typeRes.rows[0];

      const r = await pool.query(
        `INSERT INTO company_passport_access (company_id, passport_type_id, access_revoked)
         VALUES ($1, $2, FALSE)
         ON CONFLICT (company_id, passport_type_id) DO UPDATE SET access_revoked = FALSE
         RETURNING *`,
        [companyId, passportTypeId]
      );

      res.status(201).json({
        success: true, access: r.rows[0], table: getTable(type_name), display_name,
      });
    } catch (e) {
      if (e.code === "23505") return res.status(400).json({ error: "Access already granted" });
      console.error("Grant access error:", e.message);
      res.status(500).json({ error: "Failed to grant access" });
    }
  });

  app.delete("/api/admin/company-access/:companyId/:typeId", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { companyId, typeId } = req.params;

      const r = await pool.query(
        `UPDATE company_passport_access SET access_revoked = TRUE
         WHERE company_id = $1 AND passport_type_id = $2 RETURNING id`,
        [companyId, typeId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Access record not found" });

      const typeRes = await pool.query("SELECT type_name FROM passport_types WHERE id = $1", [typeId]);
      if (typeRes.rows.length) {
        const tbl = getTable(typeRes.rows[0].type_name);
        await pool.query(
          `UPDATE ${tbl} SET release_status = 'released', updated_at = NOW()
           WHERE company_id = $1 AND release_status IN ('draft', 'in_review')`,
          [companyId]
        );
      }

      res.json({ success: true });
    } catch (e) {
      console.error("Revoke access error:", e.message);
      res.status(500).json({ error: "Failed to revoke access" });
    }
  });

  // ─── PASSPORT TYPES PER COMPANY ────────────────────────────────────────────
  app.get("/api/companies/:companyId/passport-types", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT DISTINCT pt.id, pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon, pt.fields_json,
          (NOT cpa.access_revoked) AS access_granted
        FROM passport_types pt
        JOIN company_passport_access cpa ON pt.id = cpa.passport_type_id
        WHERE cpa.company_id = $1
        ORDER BY pt.umbrella_category, pt.display_name
      `, [req.params.companyId]);

      res.json(r.rows);
    } catch (e) { console.error("passport-types fetch error:", e.message); res.status(500).json({ error: "Failed to fetch passport types" }); }
  });
};
