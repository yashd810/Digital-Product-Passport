"use strict";

const path = require("path");
const logger = require("../../platform/observability/logger");
const { getPassportTypeModules } = require("../passports/services/passport-module-registry");
const { compilePassportTypeProfile } = require("../passports/services/passport-type-profile");
const {
  flattenSchemaFieldsFromSections,
  isSafePassportTypeName,
  passportTypeNameMaxLength,
  walkSchemaSections,
} = require("../../shared/passports/passport-helpers");
const {
  getSafeErrorMessage,
  getSafeErrorStatus,
} = require("../../shared/http/error-response");

module.exports = function registerCatalogRoutes(app, deps) {
  const {
    pool,
    multer,
    authenticateToken,
    isSuperAdmin,
    verifyPassword,
    logAudit,
    getTable,
    createPassportTable,
    passportTypeHasStoredRecords,
    getTypeSchemaVersion,
    findReservedPassportHeaderFieldConflicts,
    validatePassportTypeSections,
    storageService,
    getPassportTypeModules: listPassportTypeModules = getPassportTypeModules,
  } = deps;

  const getAdminAuditOptions = (req) => ({
    actorIdentifier: req.user?.actorIdentifier
      || (req.user?.userId ? `user:${req.user.userId}` : null),
    audience: "superAdmin",
  });

  const sendSafeRouteError = (res, error, fallbackMessage) => {
    const statusCode = getSafeErrorStatus(error);
    const payload = {
      error: getSafeErrorMessage(error, fallbackMessage),
    };
    if (Array.isArray(error?.issues) && error.issues.length) payload.fields = error.issues;
    return res.status(statusCode).json(payload);
  };

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

  const mapPassportTypeModule = (
    definition = {},
    seededByTypeName = new Map(),
    profileTypesByModule = new Map()
  ) => {
    const seededType = seededByTypeName.get(definition.typeName) || null;
    const profileTypes = profileTypesByModule.get(definition.moduleKey) || [];
    const sections = definition.fieldsJson?.sections || [];
    let sectionCount = 0;
    walkSchemaSections(sections, () => {
      sectionCount += 1;
    });
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
      moduleDigest: definition.moduleDigest || definition.fieldsJson?.moduleDigest || null,
      fieldsJson: definition.fieldsJson || null,
      sectionCount,
      fieldCount: flattenSchemaFieldsFromSections(sections).length,
      seeded: Boolean(seededType),
      seededPassportTypeId: seededType?.id || null,
      seededIsActive: seededType?.isActive ?? null,
      profileCount: profileTypes.length,
      profileTypes,
      seedCommand: `npm run seed:passport-types -- --module=${definition.moduleKey}`,
    };
  };

  const getModuleDefinitionByKey = (moduleKey) => {
    const normalizedModuleKey = String(moduleKey || "").trim();
    if (!normalizedModuleKey) return null;
    return listPassportTypeModules().find((definition) => definition.moduleKey === normalizedModuleKey) || null;
  };

  const compileRequestedProfile = ({
    sourceModule,
    semanticModelKey,
    profile,
    schemaVersion,
  }) => {
    const moduleDefinition = getModuleDefinitionByKey(sourceModule);
    if (!moduleDefinition) {
      const error = new Error("Passport types must be created from a registered passport module.");
      error.statusCode = 400;
      error.issues = [{ code: "sourceModuleRequired", field: "sourceModule" }];
      throw error;
    }
    const semanticModelWasProvided = semanticModelKey !== undefined;
    const requestedModelKey = String(semanticModelKey || "").trim();
    if (semanticModelWasProvided && requestedModelKey !== moduleDefinition.semanticModelKey) {
      const error = new Error(`Semantic model must stay locked to module "${sourceModule}".`);
      error.statusCode = 400;
      error.issues = [{
        code: "sourceModuleSemanticModelMismatch",
        field: "semanticModelKey",
        expected: moduleDefinition.semanticModelKey,
        actual: requestedModelKey,
      }];
      throw error;
    }
    return {
      moduleDefinition,
      fieldsJson: compilePassportTypeProfile({
        moduleDefinition,
        profile,
        schemaVersion,
      }),
    };
  };

  const getMaterialProfileDependencies = async (passportType) => {
    const [hasStoredRecords, catalogDependencies] = await Promise.all([
      passportTypeHasStoredRecords(passportType.typeName),
      pool.query(
        `SELECT EXISTS (
                  SELECT 1 FROM "passportTemplates" WHERE "passportType" = $1
                ) AS "hasTemplates",
                EXISTS (
                  SELECT 1 FROM "companyPassportAccess" WHERE "passportTypeId" = $2
                ) AS "hasCompanyGrants"`,
        [passportType.typeName, passportType.id]
      ),
    ]);
    const row = catalogDependencies.rows?.[0] || {};
    return {
      hasStoredRecords: Boolean(hasStoredRecords),
      hasTemplates: row.hasTemplates === true,
      hasCompanyGrants: row.hasCompanyGrants === true,
    };
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
               "displayName" AS "displayName",
               "isActive" AS "isActive",
               "fieldsJson" AS "fieldsJson"
          FROM "passportTypes"
      `);
      const seededByTypeName = new Map(
        registeredTypes.rows.map((row) => [row.typeName, row])
      );
      const profileTypesByModule = new Map();
      for (const row of registeredTypes.rows) {
        const sourceModule = String(row.fieldsJson?.sourceModule || "").trim();
        if (!sourceModule) continue;
        if (!profileTypesByModule.has(sourceModule)) profileTypesByModule.set(sourceModule, []);
        profileTypesByModule.get(sourceModule).push({
          id: row.id,
          typeName: row.typeName,
          displayName: row.displayName,
          isActive: row.isActive,
          schemaVersion: Number.parseInt(row.fieldsJson?.schemaVersion, 10) || 1,
          selectionMode: row.fieldsJson?.profile?.selectionMode || null,
          profileDigest: row.fieldsJson?.profileDigest || row.fieldsJson?.profile?.profileDigest || null,
          fieldCount: flattenSchemaFieldsFromSections(row.fieldsJson?.sections || []).length,
        });
      }
      res.json(listPassportTypeModules().map((definition) =>
        mapPassportTypeModule(definition, seededByTypeName, profileTypesByModule)
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
      await logAudit(
        null,
        req.user.userId,
        "createProductCategory",
        "productCategories",
        String(result.rows[0].id),
        null,
        { name: result.rows[0].name, icon: result.rows[0].icon },
        getAdminAuditOptions(req)
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
        { name: category.rows[0].name }, getAdminAuditOptions(req));
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
        profile,
      } = req.body;
      const { id } = req.params;

      const existing = await pool.query("SELECT * FROM \"passportTypes\" WHERE id = $1", [id]);
      if (!existing.rows.length) return res.status(404).json({ error: "Passport type not found" });
      const currentType = existing.rows[0];
      const currentSourceModule = String(currentType.fieldsJson?.sourceModule || "").trim();
      if (!currentSourceModule) {
        return res.status(409).json({
          error: "passportTypeProfileMigrationRequired",
          detail: "This legacy passport type is not linked to a registered module. Create a new module-backed passport type version.",
        });
      }
      if (sourceModule && sourceModule !== currentSourceModule) {
        return res.status(400).json({
          error: "A passport type cannot switch its registered source module. Create a new passport type version instead.",
        });
      }
      if (["sections", "identity", "systemHeader", "semanticGraph"].some((key) =>
        Object.prototype.hasOwnProperty.call(req.body, key))) {
        return res.status(400).json({
          error: "Submit profile.includedFields instead of authored sections or semantic metadata. The server compiles those values from the registered module.",
        });
      }
      const updates = [];
      const values = [];
      let index = 1;
      let compiledFieldsJson = null;
      let materialProfileChange = false;

      const effectiveSemanticModelKey = semanticModelKey !== undefined
        ? semanticModelKey
        : getModuleDefinitionByKey(currentSourceModule)?.semanticModelKey;
      if (profile !== undefined) {
        if (!profile || typeof profile !== "object" || Array.isArray(profile)
            || !Array.isArray(profile.includedFields)) {
          return res.status(400).json({ error: "profile.includedFields array is required" });
        }
        const currentSchemaVersion = getTypeSchemaVersion(currentType.fieldsJson || {});
        const initialCompilation = compileRequestedProfile({
          sourceModule: currentSourceModule,
          semanticModelKey: effectiveSemanticModelKey,
          profile,
          schemaVersion: currentSchemaVersion,
        });
        const currentDigest = currentType.fieldsJson?.profileDigest
          || currentType.fieldsJson?.profile?.profileDigest
          || null;
        materialProfileChange = currentDigest !== initialCompilation.fieldsJson.profileDigest;
        if (materialProfileChange) {
          const dependencies = await getMaterialProfileDependencies(currentType);
          if (Object.values(dependencies).some(Boolean)) {
            return res.status(409).json({
              error: "passportTypeProfileChangeRequiresNewVersion",
              detail: "This passport type is already used by passports, templates, or company access. Create a new passport type version for field selection, required, or confidentiality changes.",
              dependencies,
              currentProfileDigest: currentDigest,
              requestedProfileDigest: initialCompilation.fieldsJson.profileDigest,
            });
          }
          compiledFieldsJson = compileRequestedProfile({
            sourceModule: currentSourceModule,
            semanticModelKey: effectiveSemanticModelKey,
            profile,
            schemaVersion: currentSchemaVersion + 1,
          }).fieldsJson;
        } else {
          compiledFieldsJson = initialCompilation.fieldsJson;
        }
      } else if (semanticModelKey !== undefined) {
        compileRequestedProfile({
          sourceModule: currentSourceModule,
          semanticModelKey,
          profile: currentType.fieldsJson?.profile || {},
          schemaVersion: getTypeSchemaVersion(currentType.fieldsJson || {}),
        });
      }

      if (displayName !== undefined) { updates.push(`"displayName" = $${index++}`); values.push(displayName); }
      if (productCategory !== undefined) { updates.push(`"productCategory" = $${index++}`); values.push(productCategory); }
      if (productIcon !== undefined) { updates.push(`"productIcon" = $${index++}`); values.push(productIcon); }
      if (semanticModelKey !== undefined) { updates.push(`"semanticModelKey" = $${index++}`); values.push(semanticModelKey || null); }
      if (compiledFieldsJson) {
        updates.push(`"fieldsJson" = $${index++}`);
        values.push(JSON.stringify(compiledFieldsJson));
      }

      if (updates.length === 0) return res.status(400).json({ error: "Nothing to update" });

      if (productCategory !== undefined) {
        await pool.query(
          "INSERT INTO \"productCategories\" (name, icon) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
          [productCategory, productIcon || currentType.productIcon || "📋"]
        );
      }

      values.push(id);
      const result = await pool.query(
        `UPDATE "passportTypes" SET ${updates.join(", ")}, "updatedAt" = NOW() WHERE id = $${index} RETURNING *`,
        values
      );

      await logAudit(null, req.user.userId, "updatePassportType", "passportTypes", null, null,
        {
          typeName: currentType.typeName,
          updatedFields: updates,
          materialProfileChange,
          profileDigest: compiledFieldsJson?.profileDigest || currentType.fieldsJson?.profileDigest || null,
        }, getAdminAuditOptions(req));

      if (compiledFieldsJson && materialProfileChange) {
        await createPassportTable(currentType.typeName, {
          createdBy: req.user.userId,
          eventType: "adminUpdateProfileReconcileTable",
        });
      }

      res.json({
        success: true,
        passportType: mapPassportTypeRow(result.rows[0]),
      });
    } catch (error) {
      if (getSafeErrorStatus(error) >= 500) logger.error("Patch passport type error:", error.message);
      return sendSafeRouteError(res, error, "Failed to update passport type");
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
        { typeName, displayName }, getAdminAuditOptions(req));

      res.json({ success: true });
    } catch (error) {
      logger.error("Delete passport type error:", error.message);
      res.status(500).json({ error: "Failed to delete passport type" });
    }
  });

  app.post("/api/admin/passport-types", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const {
        typeName,
        displayName,
        productCategory,
        productIcon,
        semanticModelKey,
        sourceModule,
        profile,
      } = req.body;

      if (!typeName || !displayName || !productCategory || !sourceModule) {
        return res.status(400).json({ error: "typeName, displayName, productCategory, and sourceModule are required" });
      }
      if (!profile || typeof profile !== "object" || Array.isArray(profile)
          || !Array.isArray(profile.includedFields)) {
        return res.status(400).json({ error: "profile.includedFields array is required" });
      }
      if (["sections", "identity", "systemHeader", "semanticGraph"].some((key) =>
        Object.prototype.hasOwnProperty.call(req.body, key))) {
        return res.status(400).json({
          error: "Submit profile.includedFields instead of authored sections or semantic metadata. The server compiles those values from the registered module.",
        });
      }

      if (!isSafePassportTypeName(typeName)) {
        return res.status(400).json({
          error: `typeName must be camelCase letters/numbers, 2-${passportTypeNameMaxLength} chars, start with a lowercase letter`
        });
      }

      const { moduleDefinition, fieldsJson } = compileRequestedProfile({
        sourceModule,
        semanticModelKey,
        profile,
        schemaVersion: 1,
      });
      const sectionValidationError = validatePassportTypeSections(fieldsJson.sections);
      if (sectionValidationError) return res.status(400).json({ error: sectionValidationError });

      const reservedFieldConflicts = findReservedPassportHeaderFieldConflicts(fieldsJson.sections);
      if (reservedFieldConflicts.length) {
        return res.status(400).json({
          error: "One or more fields duplicate reserved passport registry/header fields and do not need to be created again.",
          fields: reservedFieldConflicts,
        });
      }

      const result = await pool.query(
        `INSERT INTO "passportTypes" ("typeName", "displayName", "productCategory", "productIcon", "semanticModelKey", "fieldsJson", "createdBy")
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [typeName, displayName, productCategory, productIcon || "📋",
          moduleDefinition.semanticModelKey || null, JSON.stringify(fieldsJson), req.user.userId]
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
        {
          typeName,
          displayName,
          productCategory,
          semanticModelKey: moduleDefinition.semanticModelKey || null,
          sourceModule,
          profileDigest: fieldsJson.profileDigest,
          includedFieldCount: fieldsJson.profile?.includedFields?.length || 0,
        }, getAdminAuditOptions(req));

      res.status(201).json({
        success: true,
        passportType: mapPassportTypeRow(result.rows[0]),
      });
    } catch (error) {
      if (error.code === "23505") return res.status(400).json({ error: "A passport type with this typeName already exists" });
      if (getSafeErrorStatus(error) >= 500) logger.error("Create passport type error:", error.message);
      return sendSafeRouteError(res, error, "Failed to create passport type");
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
        buffer: req.file.buffer,
      });

      const result = await pool.query(
        "INSERT INTO symbols (name, category, \"storageKey\", \"storageProvider\", \"fileUrl\", \"createdBy\") VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [name.trim(), category.trim() || "General", stored.storageKey, stored.provider, stored.url, req.user.userId]
      );
      await logAudit(
        null,
        req.user.userId,
        "createSymbol",
        "symbols",
        String(result.rows[0].id),
        null,
        { name: result.rows[0].name, category: result.rows[0].category },
        getAdminAuditOptions(req)
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === "storageDisabled") {
        return res.status(503).json({ error: "File storage is unavailable" });
      }
      if (error.code === "invalidFileSignature") {
        return res.status(400).json({ error: "Uploaded file type does not match its contents" });
      }
      logger.error("Symbol upload error:", error.message);
      return sendSafeRouteError(res, error, "Failed to upload symbol");
    }
  });

  app.delete("/api/admin/symbols/:id", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        "UPDATE symbols SET \"isActive\" = false WHERE id = $1 RETURNING id, name, category",
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Symbol not found" });
      await logAudit(
        null,
        req.user.userId,
        "deleteSymbol",
        "symbols",
        String(result.rows[0].id),
        { name: result.rows[0].name, category: result.rows[0].category, isActive: true },
        { name: result.rows[0].name, category: result.rows[0].category, isActive: false },
        getAdminAuditOptions(req)
      );
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
      await logAudit(
        null,
        req.user.userId,
        "deactivatePassportType",
        "passportTypes",
        String(result.rows[0].id),
        { isActive: true },
        { isActive: false, typeName: result.rows[0].typeName },
        getAdminAuditOptions(req)
      );
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
      await logAudit(
        null,
        req.user.userId,
        "activatePassportType",
        "passportTypes",
        String(result.rows[0].id),
        { isActive: false },
        { isActive: true, typeName: result.rows[0].typeName },
        getAdminAuditOptions(req)
      );
      res.json({ success: true, passportType: mapPassportTypeRow(result.rows[0]) });
    } catch {
      res.status(500).json({ error: "Failed to activate passport type" });
    }
  });

};
