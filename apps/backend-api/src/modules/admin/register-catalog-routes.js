"use strict";

const { canonicalKeyFromSemanticId } = require("../../shared/passports/canonical-field-keys");

const path = require("path");
const logger = require("../../services/logger");
const { getPassportTypeModules } = require("../../passport-modules");

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
    createPassportTable,
    passportTypeHasStoredRecords,
    buildPassportTypeSchemaChange,
    normalizeRequestedPassportTypeSchema,
    getTypeSchemaVersion,
    findReservedPassportHeaderFieldConflicts,
    validatePassportTypeSections,
    storageService,
    getPassportTypeModules: listPassportTypeModules = getPassportTypeModules,
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

  const mapPassportTypeModule = (definition = {}, seededByTypeName = new Map()) => {
    const seededType = seededByTypeName.get(definition.typeName) || null;
    const sections = definition.fieldsJson?.sections || [];
    return {
      moduleKey: definition.moduleKey,
      typeName: definition.typeName,
      displayName: definition.displayName,
      productCategory: definition.productCategory,
      productIcon: definition.productIcon,
      semanticModelKey: definition.semanticModelKey,
      passportPolicyKey: definition.passportPolicy?.key || null,
      passportPolicy: definition.passportPolicy || null,
      lifecycle: definition.lifecycle || null,
      fieldsJson: definition.fieldsJson || null,
      sectionCount: sections.length,
      fieldCount: sections.reduce((count, section) => count + (section.fields?.length || 0), 0),
      seeded: Boolean(seededType),
      seededPassportTypeId: seededType?.id || null,
      seededIsActive: seededType?.isActive ?? null,
      seedCommand: `npm run seed:passport-types -- --module=${definition.moduleKey}`,
    };
  };

  const getModuleDefinitionByKey = (moduleKey) => {
    const normalizedModuleKey = String(moduleKey || "").trim();
    if (!normalizedModuleKey) return null;
    return listPassportTypeModules().find((definition) => definition.moduleKey === normalizedModuleKey) || null;
  };

  const validateModuleBackedPassportType = ({ sourceModule, semanticModelKey, sections, identity = null }) => {
    const moduleDefinition = getModuleDefinitionByKey(sourceModule);
    if (!moduleDefinition) {
      return {
        error: "Passport types must be created from a registered passport module.",
        fields: [{ code: "sourceModuleRequired", field: "sourceModule" }],
      };
    }

    const normalizedSemanticModelKey = String(semanticModelKey || "").trim();
    if (normalizedSemanticModelKey && normalizedSemanticModelKey !== moduleDefinition.semanticModelKey) {
      return {
        error: `Semantic model must stay locked to module "${sourceModule}".`,
        fields: [{
          code: "sourceModuleSemanticModelMismatch",
          field: "semanticModelKey",
          expected: moduleDefinition.semanticModelKey,
          actual: normalizedSemanticModelKey,
        }],
      };
    }

    const issues = [];
    const fieldKeys = new Set();
    for (const section of sections || []) {
      for (const field of section?.fields || []) {
        if (field?.key) fieldKeys.add(field.key);
        if (!field?.canonicalLocked || field?.sourceModuleKey !== moduleDefinition.moduleKey || !field?.sourceModuleFieldKey) {
          issues.push({
            code: "moduleFieldNotCanonical",
            field: field?.key || null,
            message: `Field "${field?.key || "unknown"}" must come from the selected passport module.`,
          });
        }
        if (!field?.semanticId) {
          issues.push({
            code: "fieldSemanticIdRequired",
            field: field?.key || null,
            message: `Field "${field?.key || "unknown"}" must have an explicit semanticId from the module.`,
          });
        } else {
          const canonicalFieldKey = canonicalKeyFromSemanticId(field.semanticId);
          if (canonicalFieldKey && field.key !== canonicalFieldKey) {
            issues.push({
              code: "fieldKeyMustMatchSemanticTerm",
              field: field?.key || null,
              expected: canonicalFieldKey,
              message: `Field "${field?.key || "unknown"}" must use canonical semantic key "${canonicalFieldKey}".`,
            });
          }
        }
        for (const metadataKey of ["elementIdPath", "objectType", "valueDataType"]) {
          if (!field?.[metadataKey]) {
            issues.push({
              code: "fieldRuntimeMetadataRequired",
              field: field?.key || null,
              metadataKey,
              message: `Field "${field?.key || "unknown"}" must have explicit ${metadataKey} metadata from the module.`,
            });
          }
        }
        if (field?.type === "table") {
          const columns = Array.isArray(field.tableColumns) ? field.tableColumns : [];
          if (!columns.length) {
            issues.push({
              code: "tableColumnsRequired",
              field: field?.key || null,
              message: `Table field "${field?.key || "unknown"}" must define module table columns.`,
            });
          }
          for (const column of columns) {
            if (!column?.canonicalLocked || column?.sourceModuleKey !== moduleDefinition.moduleKey || !column?.sourceModuleColumnKey) {
              issues.push({
                code: "moduleTableColumnNotCanonical",
                field: field?.key || null,
                column: column?.key || null,
                message: `Table column "${field?.key || "unknown"}.${column?.key || "unknown"}" must come from the selected passport module.`,
              });
            }
            if (!column?.semanticId) {
              issues.push({
                code: "tableColumnSemanticIdRequired",
                field: field?.key || null,
                column: column?.key || null,
                message: `Table column "${field?.key || "unknown"}.${column?.key || "unknown"}" must have an explicit semanticId from the module.`,
              });
            } else {
              const canonicalColumnKey = canonicalKeyFromSemanticId(column.semanticId);
              if (canonicalColumnKey && column.key !== canonicalColumnKey) {
                issues.push({
                  code: "tableColumnKeyMustMatchSemanticTerm",
                  field: field?.key || null,
                  column: column?.key || null,
                  expected: canonicalColumnKey,
                  message: `Table column "${field?.key || "unknown"}.${column?.key || "unknown"}" must use canonical semantic key "${canonicalColumnKey}".`,
                });
              }
            }
            for (const metadataKey of ["elementIdPath", "objectType", "valueDataType"]) {
              if (!column?.[metadataKey]) {
                issues.push({
                  code: "tableColumnRuntimeMetadataRequired",
                  field: field?.key || null,
                  column: column?.key || null,
                  metadataKey,
                  message: `Table column "${field?.key || "unknown"}.${column?.key || "unknown"}" must have explicit ${metadataKey} metadata from the module.`,
                });
              }
            }
          }
        }
      }
    }
    const businessIdentifierField = String(identity?.businessIdentifierField || "").trim();
    if (!businessIdentifierField) {
      issues.push({
        code: "businessIdentifierFieldRequired",
        field: "identity.businessIdentifierField",
        message: "Passport types must include a module-defined business identifier field.",
      });
    } else if (!fieldKeys.has(businessIdentifierField)) {
      issues.push({
        code: "businessIdentifierFieldNotIncluded",
        field: businessIdentifierField,
        message: `Business identifier field "${businessIdentifierField}" must be included in the passport type.`,
      });
    }

    if (issues.length) {
      return {
        error: "Passport type fields must use canonical module semantics only.",
        fields: issues,
      };
    }
    return null;
  };

  app.get("/api/admin/product-categories", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM \"productCategories\" ORDER BY name");
      res.json(result.rows);
    } catch (error) {
      logger.error("List productCategories error:", error.message);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  app.get("/api/admin/passport-type-modules", authenticateToken, isSuperAdmin, async (_req, res) => {
    try {
      const registeredTypes = await pool.query(`
        SELECT id,
               "typeName" AS "typeName",
               "isActive" AS "isActive"
          FROM "passportTypes"
      `);
      const seededByTypeName = new Map(
        registeredTypes.rows.map((row) => [row.typeName, row])
      );
      res.json(listPassportTypeModules().map((definition) =>
        mapPassportTypeModule(definition, seededByTypeName)
      ));
    } catch (error) {
      logger.error("List passport type modules error:", error.message);
      res.status(500).json({ error: "Failed to fetch passport type modules" });
    }
  });

  app.post("/api/admin/product-categories", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { name, icon = "📋" } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
      const result = await pool.query(
        "INSERT INTO \"productCategories\" (name, icon) VALUES ($1, $2) RETURNING *",
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

      const category = await pool.query("SELECT name FROM \"productCategories\" WHERE id = $1", [req.params.id]);
      if (!category.rows.length) return res.status(404).json({ error: "Category not found" });
      const usage = await pool.query(
        'SELECT COUNT(*) FROM "passportTypes" WHERE "productCategory" = $1', [category.rows[0].name]
      );
      if (parseInt(usage.rows[0].count, 10) > 0) {
        return res.status(400).json({ error: "Cannot delete — passport types are using this category" });
      }
      await pool.query("DELETE FROM \"productCategories\" WHERE id = $1", [req.params.id]);
      await logAudit(null, req.user.userId, "deleteProductCategory", "productCategories", req.params.id, null,
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
        FROM "passportTypes" pt
        LEFT JOIN users u ON u.id = pt."createdBy"
        ORDER BY pt."productCategory", pt."displayName"
      `);
      res.json(result.rows.map(mapPassportTypeRow));
    } catch (error) {
      logger.error("List passport types error:", error.message);
      res.status(500).json({ error: "Failed to fetch passport types" });
    }
  });

  app.get("/api/internal/passport-types/:typeName", authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id,
                "typeName" AS "typeName",
                "displayName" AS "displayName",
                "productCategory" AS "productCategory",
                "productIcon" AS "productIcon",
                "semanticModelKey" AS "semanticModelKey",
                "fieldsJson" AS "fieldsJson"
         FROM "passportTypes" WHERE "typeName" = $1`,
        [req.params.typeName]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Passport type not found" });
      if (req.user.role !== "superAdmin") {
        const access = await pool.query(
          `SELECT 1
           FROM "companyPassportAccess" cpa
           WHERE cpa."companyId" = $1
             AND cpa."passportTypeId" = $2
             AND COALESCE(cpa."accessRevoked", false) = false
           LIMIT 1`,
          [req.user.companyId, result.rows[0].id]
        );
        if (!access.rows.length) return res.status(403).json({ error: "Unauthorised access to this passport type" });
      }
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
        sourceModule,
        identity,
        sections,
        systemHeader,
      } = req.body;
      const { id } = req.params;

      const existing = await pool.query("SELECT * FROM \"passportTypes\" WHERE id = $1", [id]);
      if (!existing.rows.length) return res.status(404).json({ error: "Passport type not found" });
      const currentType = existing.rows[0];
      const effectiveSourceModule = sourceModule || currentType.fieldsJson?.sourceModule || null;
      const effectiveSemanticModelKey = semanticModelKey !== undefined
        ? semanticModelKey
        : currentType.semanticModelKey;
      const effectiveSections = sections !== undefined
        ? sections
        : (currentType.fieldsJson?.sections || []);
      const effectiveIdentity = identity !== undefined
        ? identity
        : (currentType.fieldsJson?.identity || null);
      const updates = [];
      const values = [];
      let index = 1;

      const moduleValidation = validateModuleBackedPassportType({
        sourceModule: effectiveSourceModule,
        semanticModelKey: effectiveSemanticModelKey,
        sections: effectiveSections,
        identity: effectiveIdentity,
      });
      if (moduleValidation) return res.status(400).json(moduleValidation);

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
            error: "passportTypeSchemaChangeRequiresNewVersion",
            detail: "Passport type fields are additive-only once passports or archives exist. Create a new passport type version for removed fields or storage type changes.",
            removed: schemaChange.removed,
            typeChanged: schemaChange.typeChanged,
          });
        }
        const fieldsJson = normalizeRequestedPassportTypeSchema({
          sections,
          systemHeader,
          currentSchemaVersion: getTypeSchemaVersion(currentType.fieldsJson || {}) + 1,
          sourceModule: effectiveSourceModule,
          identity: effectiveIdentity,
        });
        updates.push(`"fieldsJson" = $${index++}`);
        values.push(JSON.stringify(fieldsJson));
      }

      if (updates.length === 0) return res.status(400).json({ error: "Nothing to update" });

      values.push(id);
      const result = await pool.query(
        `UPDATE "passportTypes" SET ${updates.join(", ")} WHERE id = $${index} RETURNING *`,
        values
      );

      await logAudit(null, req.user.userId, "updatePassportTypeMetadata", "passportTypes", null, null,
        { typeName: existing.rows[0].typeName, updatedFields: updates });

      if (sections !== undefined) {
        await createPassportTable(currentType.typeName, {
          createdBy: req.user.userId,
          eventType: "adminUpdateReconcileTable",
        });
      }

      res.json({
        success: true,
        passportType: mapPassportTypeRow(result.rows[0]),
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
        'SELECT "typeName" AS "typeName", "displayName" AS "displayName" FROM "passportTypes" WHERE id = $1',
        [typeId]
      );
      if (!typeRow.rows.length) return res.status(404).json({ error: "Passport type not found" });
      const { typeName, displayName } = typeRow.rows[0];

      await pool.query("DELETE FROM \"passportTypes\" WHERE id = $1", [typeId]);

      const tableName = getTable(typeName);
      if (!/^"[A-Za-z][A-Za-z0-9]*"$/.test(tableName)) {
        throw new Error(`Refusing to drop table with unexpected name: ${tableName}`);
      }
      await pool.query(`DROP TABLE IF EXISTS ${tableName}`);

      await logAudit(null, req.user.userId, "deletePassportType", "passportTypes", null, null,
        { typeName, displayName });

      res.json({ success: true });
    } catch (error) {
      logger.error("Delete passport type error:", error.message);
      res.status(500).json({ error: "Failed to delete passport type" });
    }
  });

  app.post("/api/admin/passport-types", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const { typeName, displayName, productCategory, productIcon, semanticModelKey, sourceModule, identity, sections, systemHeader } = req.body;

      if (!typeName || !displayName || !productCategory || !sections) {
        return res.status(400).json({ error: "typeName, displayName, productCategory, and sections are required" });
      }

      if (!/^[a-z][A-Za-z0-9]{1,99}$/.test(typeName)) {
        return res.status(400).json({
          error: "typeName must be camelCase letters/numbers, 2-100 chars, start with a lowercase letter"
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

      const moduleValidation = validateModuleBackedPassportType({
        sourceModule,
        semanticModelKey,
        sections,
        identity,
      });
      if (moduleValidation) return res.status(400).json(moduleValidation);

      const fieldsJson = normalizeRequestedPassportTypeSchema({ sections, systemHeader, currentSchemaVersion: 1, sourceModule, identity });

      const result = await pool.query(
        `INSERT INTO "passportTypes" ("typeName", "displayName", "productCategory", "productIcon", "semanticModelKey", "fieldsJson", "createdBy")
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [typeName, displayName, productCategory, productIcon || "📋",
          semanticModelKey || null, JSON.stringify(fieldsJson), req.user.userId]
      );

      await pool.query(
        "INSERT INTO \"productCategories\" (name, icon) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
        [productCategory, productIcon || "📋"]
      );

      await createPassportTable(typeName, {
        createdBy: req.user.userId,
        eventType: "adminCreateTable",
      });

      await logAudit(null, req.user.userId, "createPassportType", "passportTypes", null, null,
        { typeName, displayName, productCategory, semanticModelKey: semanticModelKey || null, sourceModule: sourceModule || null });

      res.status(201).json({
        success: true,
        passportType: mapPassportTypeRow(result.rows[0]),
      });
    } catch (error) {
      if (error.code === "23505") return res.status(400).json({ error: "A passport type with this typeName already exists" });
      logger.error("Create passport type error:", error.message);
      res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Failed to create passport type" });
    }
  });

  app.get("/api/admin/passport-type-draft", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT id, \"draftJson\", \"createdAt\", \"updatedAt\" FROM \"passportTypeDrafts\" WHERE \"userId\" = $1",
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
      const { draftJson } = req.body;
      if (!draftJson || typeof draftJson !== "object") {
        return res.status(400).json({ error: "draftJson object is required" });
      }
      const result = await pool.query(
        `INSERT INTO "passportTypeDrafts" ("userId", "draftJson")
         VALUES ($1, $2)
         ON CONFLICT ("userId") DO UPDATE
           SET "draftJson" = EXCLUDED."draftJson",
               "updatedAt" = NOW()
         RETURNING id, "updatedAt"`,
        [req.user.userId, JSON.stringify(draftJson)]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ error: "Failed to save draft" });
    }
  });

  app.delete("/api/admin/passport-type-draft", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM \"passportTypeDrafts\" WHERE \"userId\" = $1", [req.user.userId]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete draft" });
    }
  });

  const symbolUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = [".png", ".jpg", ".jpeg", ".webp"];
      if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
      else cb(new Error("Only PNG, JPG, and WebP files are allowed"));
    }
  });

  app.get("/api/symbols", authenticateToken, async (req, res) => {
    try {
      const { category } = req.query;
      let query = "SELECT id, name, category, \"fileUrl\", \"createdAt\" FROM symbols WHERE \"isActive\" = true";
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
        "SELECT DISTINCT category FROM symbols WHERE \"isActive\" = true ORDER BY category"
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
        "INSERT INTO symbols (name, category, \"storageKey\", \"storageProvider\", \"fileUrl\", \"createdBy\") VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [name.trim(), category.trim() || "General", stored.storageKey, stored.provider, stored.url, req.user.userId]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === "storageDisabled") {
        return res.status(503).json({ error: error.message });
      }
      logger.error("Symbol upload error:", error.message);
      res.status(500).json({ error: error.message || "Failed to upload symbol" });
    }
  });

  app.delete("/api/admin/symbols/:id", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        "UPDATE symbols SET \"isActive\" = false WHERE id = $1 RETURNING id",
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
        `UPDATE "passportTypes"
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
        `UPDATE "passportTypes"
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
          (NOT cpa."accessRevoked") AS "accessGranted"
        FROM "passportTypes" pt
        JOIN "companyPassportAccess" cpa ON pt.id = cpa."passportTypeId"
        WHERE cpa."companyId" = $1
        ORDER BY pt."productCategory", pt."displayName"
      `, [req.params.companyId]);

      res.json(result.rows.map(mapPassportTypeRow));
    } catch (error) {
      logger.error("passport-types fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch passport types" });
    }
  });
};
