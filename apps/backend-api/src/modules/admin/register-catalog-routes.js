"use strict";

const path = require("path");
const logger = require("../../infrastructure/logging/logger");

module.exports = function registerCatalogRoutes(app, deps) {
  const {
    pool,
    multer,
    authenticateToken,
    isSuperAdmin,
    checkCompanyAccess,
    verifyPassword,
    logAudit,
    getTable,
    publicReadRateLimit,
    createPassportTable,
    passportTypeHasStoredRecords,
    buildPassportTypeSchemaChange,
    normalizeRequestedPassportTypeSchema,
    getTypeSchemaVersion,
    findReservedPassportHeaderFieldConflicts,
    validatePassportTypeSections,
    buildPassportTypeGovernanceCheck,
    storageService,
  } = deps;

  const mapPassportTypeRow = (row = {}) => ({
    id: row.id ?? null,
    typeName: row.typeName ?? null,
    displayName: row.displayName ?? null,
    productCategory: row.productCategory ?? null,
    productIcon: row.productIcon ?? null,
    semanticModelKey: row.semanticModelKey ?? null,
    fieldsJson: row.fieldsJson ?? null,
    isActive: row.isActive ?? null,
    accessGranted: row.accessGranted ?? null,
    createdAt: row.createdAt ?? null,
    createdByEmail: row.createdByEmail ?? null,
  });

  app.get("/api/admin/product-categories", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM product_categories ORDER BY name");
      res.json(result.rows);
    } catch (error) {
      logger.error("List productCategories error:", error.message);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  app.post("/api/admin/product-categories", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { name, icon = "📋" } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
      const result = await pool.query(
        "INSERT INTO product_categories (name, icon) VALUES ($1, $2) RETURNING *",
        [name.trim(), icon]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === "23505") return res.status(400).json({ error: "Category already exists" });
      res.status(500).json({ error: "Failed to create category" });
    }
  });

  app.delete("/api/admin/product-categories/:id", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ error: "Password is required" });

      const userRow = await pool.query('SELECT "passwordHash" AS "passwordHash" FROM users WHERE id = $1', [req.user.userId]);
      if (!userRow.rows.length) return res.status(401).json({ error: "User not found" });
      const valid = await verifyPassword(password, userRow.rows[0].passwordHash);
      if (!valid) return res.status(403).json({ error: "Incorrect password" });

      const category = await pool.query("SELECT name FROM product_categories WHERE id = $1", [req.params.id]);
      if (!category.rows.length) return res.status(404).json({ error: "Category not found" });
      const usage = await pool.query(
        'SELECT COUNT(*) FROM passport_types WHERE "productCategory" = $1', [category.rows[0].name]
      );
      if (parseInt(usage.rows[0].count, 10) > 0) {
        return res.status(400).json({ error: "Cannot delete — passport types are using this category" });
      }
      await pool.query("DELETE FROM product_categories WHERE id = $1", [req.params.id]);
      await logAudit(null, req.user.userId, "DELETE_PRODUCT_CATEGORY", "product_categories", req.params.id, null,
        { name: category.rows[0].name });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete category" });
    }
  });

  app.get("/api/admin/passport-types", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT pt.id,
               pt."typeName" AS "typeName",
               pt."displayName" AS "displayName",
               pt."productCategory" AS "productCategory",
               pt."productIcon" AS "productIcon",
               pt."semanticModelKey" AS "semanticModelKey",
               pt."fieldsJson" AS "fieldsJson",
               pt."isActive" AS "isActive",
               pt."createdAt" AS "createdAt",
               u.email AS "createdByEmail"
        FROM passport_types pt
        LEFT JOIN users u ON u.id = pt."createdBy"
        ORDER BY pt."productCategory", pt."displayName"
      `);
      res.json(result.rows.map(mapPassportTypeRow));
    } catch (error) {
      logger.error("List passport types error:", error.message);
      res.status(500).json({ error: "Failed to fetch passport types" });
    }
  });

  app.get("/api/passport-types/:typeName", publicReadRateLimit, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id,
                "typeName" AS "typeName",
                "displayName" AS "displayName",
                "productCategory" AS "productCategory",
                "productIcon" AS "productIcon",
                "semanticModelKey" AS "semanticModelKey",
                "fieldsJson" AS "fieldsJson"
         FROM passport_types WHERE "typeName" = $1`,
        [req.params.typeName]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Passport type not found" });
      res.json(mapPassportTypeRow(result.rows[0]));
    } catch {
      res.status(500).json({ error: "Failed to fetch passport type" });
    }
  });

  app.patch("/api/admin/passport-types/:id", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const {
        displayName,
        productCategory,
        productIcon,
        semanticModelKey,
        sections,
        systemHeader,
      } = req.body;
      const { id } = req.params;

      const existing = await pool.query("SELECT * FROM passport_types WHERE id = $1", [id]);
      if (!existing.rows.length) return res.status(404).json({ error: "Passport type not found" });
      const currentType = existing.rows[0];
      const updates = [];
      const values = [];
      let index = 1;

      if (displayName !== undefined) { updates.push(`"displayName" = $${index++}`); values.push(displayName); }
      if (productCategory !== undefined) { updates.push(`"productCategory" = $${index++}`); values.push(productCategory); }
      if (productIcon !== undefined) { updates.push(`"productIcon" = $${index++}`); values.push(productIcon); }
      if (semanticModelKey !== undefined) { updates.push(`"semanticModelKey" = $${index++}`); values.push(semanticModelKey || null); }
      if (sections !== undefined) {
        const reservedFieldConflicts = findReservedPassportHeaderFieldConflicts(sections);
        if (reservedFieldConflicts.length) {
          return res.status(400).json({
            error: "One or more fields duplicate reserved passport registry/header fields and do not need to be created again.",
            fields: reservedFieldConflicts
          });
        }
        const sectionValidationError = validatePassportTypeSections(sections);
        if (sectionValidationError) return res.status(400).json({ error: sectionValidationError });
        const schemaChange = buildPassportTypeSchemaChange({
          currentFieldsJson: currentType.fieldsJson || {},
          nextSections: sections,
        });
        const hasStoredRecords = await passportTypeHasStoredRecords(currentType.typeName);
        if (hasStoredRecords && !schemaChange.additive) {
          return res.status(409).json({
            error: "PASSPORT_TYPE_SCHEMA_CHANGE_REQUIRES_NEW_VERSION",
            detail: "Passport type fields are additive-only once passports or archives exist. Create a new passport type version for removed fields or storage type changes.",
            removed: schemaChange.removed,
            typeChanged: schemaChange.typeChanged,
          });
        }
        const fieldsJson = normalizeRequestedPassportTypeSchema({
          sections,
          systemHeader,
          currentSchemaVersion: getTypeSchemaVersion(currentType.fieldsJson || {}) + 1,
        });
        updates.push(`"fieldsJson" = $${index++}`);
        values.push(JSON.stringify(fieldsJson));
      }

      if (updates.length === 0) return res.status(400).json({ error: "Nothing to update" });

      values.push(id);
      const result = await pool.query(
        `UPDATE passport_types SET ${updates.join(", ")} WHERE id = $${index} RETURNING *`,
        values
      );

      await logAudit(null, req.user.userId, "UPDATE_PASSPORT_TYPE_METADATA", "passport_types", null, null,
        { typeName: existing.rows[0].typeName, updatedFields: updates });

      if (sections !== undefined) {
        await createPassportTable(currentType.typeName, {
          createdBy: req.user.userId,
          eventType: "admin_update_reconcile_table",
        });
      }

      const verification = sections !== undefined
        ? buildPassportTypeGovernanceCheck(sections)
        : buildPassportTypeGovernanceCheck((result.rows[0]?.fieldsJson || {}).sections || []);

      res.json({
        success: true,
        passportType: mapPassportTypeRow(result.rows[0]),
        verification,
        warning: verification.issueCount
          ? "Passport type fields contain governance metadata that should be reviewed."
          : null,
      });
    } catch (error) {
      logger.error("Patch passport type error:", error.message);
      res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Failed to update passport type" });
    }
  });

  app.delete("/api/admin/passport-types/:typeId", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { typeId } = req.params;
      const { password } = req.body;
      if (!password) return res.status(400).json({ error: "Password is required" });

      const userRow = await pool.query('SELECT "passwordHash" AS "passwordHash" FROM users WHERE id = $1', [req.user.userId]);
      if (!userRow.rows.length) return res.status(401).json({ error: "User not found" });
      const valid = await verifyPassword(password, userRow.rows[0].passwordHash);
      if (!valid) return res.status(403).json({ error: "Incorrect password" });

      const typeRow = await pool.query(
        'SELECT "typeName" AS "typeName", "displayName" AS "displayName" FROM passport_types WHERE id = $1',
        [typeId]
      );
      if (!typeRow.rows.length) return res.status(404).json({ error: "Passport type not found" });
      const { typeName, displayName } = typeRow.rows[0];

      await pool.query("DELETE FROM passport_types WHERE id = $1", [typeId]);

      const tableName = getTable(typeName);
      if (!/^passport_type_[a-z0-9_]+$/.test(tableName)) {
        throw new Error(`Refusing to drop table with unexpected name: ${tableName}`);
      }
      await pool.query(`DROP TABLE IF EXISTS "${tableName}"`);

      await logAudit(null, req.user.userId, "DELETE_PASSPORT_TYPE", "passport_types", null, null,
        { typeName, displayName });

      res.json({ success: true });
    } catch (error) {
      logger.error("Delete passport type error:", error.message);
      res.status(500).json({ error: "Failed to delete passport type" });
    }
  });

  app.post("/api/admin/passport-types", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { typeName, displayName, productCategory, productIcon, semanticModelKey, sections, systemHeader } = req.body;

      if (!typeName || !displayName || !productCategory || !sections) {
        return res.status(400).json({ error: "typeName, displayName, productCategory, and sections are required" });
      }

      if (!/^[a-z][a-z0-9_]{1,99}$/.test(typeName)) {
        return res.status(400).json({
          error: "typeName must be lowercase letters/numbers/underscores, 2-100 chars, start with a letter"
        });
      }

      const reservedFieldConflicts = findReservedPassportHeaderFieldConflicts(sections);
      if (reservedFieldConflicts.length) {
        return res.status(400).json({
          error: "One or more fields duplicate reserved passport registry/header fields and do not need to be created again.",
          fields: reservedFieldConflicts
        });
      }

      const sectionValidationError = validatePassportTypeSections(sections);
      if (sectionValidationError) return res.status(400).json({ error: sectionValidationError });

      const fieldsJson = normalizeRequestedPassportTypeSchema({ sections, systemHeader, currentSchemaVersion: 1 });

      const result = await pool.query(
        `INSERT INTO passport_types ("typeName", "displayName", "productCategory", "productIcon", "semanticModelKey", "fieldsJson", "createdBy")
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [typeName, displayName, productCategory, productIcon || "📋",
          semanticModelKey || null, JSON.stringify(fieldsJson), req.user.userId]
      );

      await pool.query(
        "INSERT INTO product_categories (name, icon) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
        [productCategory, productIcon || "📋"]
      );

      await createPassportTable(typeName, {
        createdBy: req.user.userId,
        eventType: "admin_create_table",
      });

      await logAudit(null, req.user.userId, "CREATE_PASSPORT_TYPE", "passport_types", null, null,
        { typeName, displayName, productCategory, semanticModelKey: semanticModelKey || null });

      const verification = buildPassportTypeGovernanceCheck(sections);
      res.status(201).json({
        success: true,
        passportType: mapPassportTypeRow(result.rows[0]),
        verification,
        warning: verification.issueCount
          ? "Passport type fields contain governance metadata that should be reviewed."
          : null,
      });
    } catch (error) {
      if (error.code === "23505") return res.status(400).json({ error: "A passport type with this typeName already exists" });
      logger.error("Create passport type error:", error.message);
      res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Failed to create passport type" });
    }
  });

  app.post("/api/admin/passport-types/verification-check", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { sections } = req.body || {};
      const reservedFieldConflicts = findReservedPassportHeaderFieldConflicts(sections);
      const sectionValidationError = validatePassportTypeSections(sections);
      const governance = buildPassportTypeGovernanceCheck(sections);

      return res.json({
        status: !reservedFieldConflicts.length && !sectionValidationError && governance.issueCount === 0
          ? "ok"
          : "attention_needed",
        reservedFieldConflicts,
        structuralError: sectionValidationError || null,
        governance,
      });
    } catch (error) {
      logger.error("Passport type verification check error:", error.message);
      res.status(500).json({ error: "Failed to run passport type verification check" });
    }
  });

  app.get("/api/admin/passport-type-draft", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT id, draft_json, created_at, updated_at FROM passport_type_drafts WHERE user_id = $1",
        [req.user.userId]
      );
      if (!result.rows.length) return res.json(null);
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ error: "Failed to fetch draft" });
    }
  });

  app.put("/api/admin/passport-type-draft", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { draft_json } = req.body;
      if (!draft_json || typeof draft_json !== "object") {
        return res.status(400).json({ error: "draft_json object is required" });
      }
      const result = await pool.query(
        `INSERT INTO passport_type_drafts (user_id, draft_json)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
           SET draft_json = EXCLUDED.draft_json,
               updated_at = NOW()
         RETURNING id, updated_at`,
        [req.user.userId, JSON.stringify(draft_json)]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ error: "Failed to save draft" });
    }
  });

  app.delete("/api/admin/passport-type-draft", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM passport_type_drafts WHERE user_id = $1", [req.user.userId]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete draft" });
    }
  });

  const symbolUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = [".svg", ".png", ".jpg", ".jpeg", ".webp"];
      if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
      else cb(new Error("Only SVG, PNG, JPG, WebP files are allowed"));
    }
  });

  app.get("/api/symbols", authenticateToken, async (req, res) => {
    try {
      const { category } = req.query;
      let query = "SELECT id, name, category, file_url, created_at FROM symbols WHERE is_active = true";
      const params = [];
      if (category) { query += " AND category = $1"; params.push(category); }
      query += " ORDER BY category, name";
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch symbols" });
    }
  });

  app.get("/api/symbols/categories", authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT DISTINCT category FROM symbols WHERE is_active = true ORDER BY category"
      );
      res.json(result.rows.map((row) => row.category));
    } catch {
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  app.post("/api/admin/symbols", authenticateToken, isSuperAdmin, symbolUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const { name, category = "General" } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "name is required" });

      const stored = await storageService.saveGlobalSymbol({
        originalName: req.file.originalname,
        buffer: req.file.buffer,
        contentType: req.file.mimetype
      });

      const result = await pool.query(
        "INSERT INTO symbols (name, category, storage_key, storage_provider, file_url, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [name.trim(), category.trim() || "General", stored.storageKey, stored.provider, stored.url, req.user.userId]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === "STORAGE_DISABLED") {
        return res.status(503).json({ error: error.message });
      }
      logger.error("Symbol upload error:", error.message);
      res.status(500).json({ error: error.message || "Failed to upload symbol" });
    }
  });

  app.delete("/api/admin/symbols/:id", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        "UPDATE symbols SET is_active = false WHERE id = $1 RETURNING id",
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Symbol not found" });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete symbol" });
    }
  });

  app.patch("/api/admin/passport-types/:id/deactivate", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE passport_types
            SET "isActive" = false
          WHERE id = $1
      RETURNING id,
                "typeName" AS "typeName",
                "displayName" AS "displayName",
                "isActive" AS "isActive"`,
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Passport type not found" });
      res.json({ success: true, passportType: mapPassportTypeRow(result.rows[0]) });
    } catch {
      res.status(500).json({ error: "Failed to deactivate passport type" });
    }
  });

  app.patch("/api/admin/passport-types/:id/activate", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE passport_types
            SET "isActive" = true
          WHERE id = $1
      RETURNING id,
                "typeName" AS "typeName",
                "displayName" AS "displayName",
                "isActive" AS "isActive"`,
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Passport type not found" });
      res.json({ success: true, passportType: mapPassportTypeRow(result.rows[0]) });
    } catch {
      res.status(500).json({ error: "Failed to activate passport type" });
    }
  });

  app.get("/api/companies/:companyId/passport-types", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT DISTINCT pt.id,
          pt."typeName" AS "typeName",
          pt."displayName" AS "displayName",
          pt."productCategory" AS "productCategory",
          pt."productIcon" AS "productIcon",
          pt."fieldsJson" AS "fieldsJson",
          (NOT cpa.access_revoked) AS "accessGranted"
        FROM passport_types pt
        JOIN company_passport_access cpa ON pt.id = cpa.passport_type_id
        WHERE cpa.company_id = $1
        ORDER BY pt."productCategory", pt."displayName"
      `, [req.params.companyId]);

      res.json(result.rows.map(mapPassportTypeRow));
    } catch (error) {
      logger.error("passport-types fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch passport types" });
    }
  });
};
