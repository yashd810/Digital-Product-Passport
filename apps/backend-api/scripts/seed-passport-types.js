"use strict";

const path = require("path");
require("dotenv").config({
  path: process.env.DOTENV_CONFIG_PATH || process.env.DPP_ENV_FILE || path.resolve(__dirname, "../../../../../env/local-compose.env"),
  quiet: true,
});

const { getPassportTypeModules } = require("../src/services/passport-module-registry");
const { compilePassportTypeProfile } = require("../src/services/passport-type-profile");
const {
  flattenSchemaFieldsFromSections,
  isSafePassportTypeName,
} = require("../src/shared/passports/passport-helpers");

function getArgValue(args, prefix) {
  return (args.find((arg) => arg.startsWith(prefix)) || "").slice(prefix.length);
}

function getArgValues(args, prefix) {
  return args
    .filter((arg) => arg.startsWith(prefix))
    .map((arg) => arg.slice(prefix.length))
    .filter(Boolean);
}

function parseCompanyIds(args) {
  const values = getArgValues(args, "--company-id=");
  const ids = values
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10));

  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error("--company-id must contain positive integer IDs");
  }

  return [...new Set(ids)];
}

function parseOptions(args = []) {
  const companyIds = parseCompanyIds(args);
  const grantAllActiveCompanies = args.includes("--grant-all-active-companies");
  if (companyIds.length && grantAllActiveCompanies) {
    throw new Error("Use either --company-id or --grant-all-active-companies, not both");
  }

  return {
    dryRun: args.includes("--dry-run"),
    skipStorage: args.includes("--skip-storage"),
    refreshModuleProfile: args.includes("--refresh-module-profile"),
    requestedModule: getArgValue(args, "--module="),
    companyIds,
    grantAllActiveCompanies,
  };
}

function createPool() {
  const { Pool } = require("pg");
  return new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
  });
}

function createStorageService(pool) {
  const createPassportService = require("../src/services/passport-service");
  const {
    inRevisionStatus,
    systemPassportFields,
    getTable,
    normalizeReleaseStatus,
    isPublicHistoryStatus,
    isEditablePassportStatus,
    normalizePassportRow,
    toStoredPassportValue,
    normalizeInternalAliasIdValue,
    generateInternalAliasIdValue,
    getWritablePassportColumns,
    getStoredPassportValues,
    quoteSqlIdentifier,
    joinQuotedSqlIdentifiers,
    buildCurrentPublicPassportPath,
    buildInactivePublicPassportPath,
    coerceBulkFieldValue,
    getHistoryFieldDefs,
    formatHistoryFieldValue,
    comparableHistoryFieldValue,
  } = require("../src/shared/passports/passport-helpers");

  return createPassportService({
    pool,
    getTable,
    normalizePassportRow,
    normalizeReleaseStatus,
    isPublicHistoryStatus,
    isEditablePassportStatus,
    normalizeInternalAliasIdValue,
    generateInternalAliasIdValue,
    inRevisionStatus,
    systemPassportFields,
    getWritablePassportColumns,
    getStoredPassportValues,
    quoteSqlIdentifier,
    joinQuotedSqlIdentifiers,
    toStoredPassportValue,
    coerceBulkFieldValue,
    comparableHistoryFieldValue,
    formatHistoryFieldValue,
    getHistoryFieldDefs,
    buildCurrentPublicPassportPath,
    buildInactivePublicPassportPath,
    productIdentifierService: null,
  });
}

function getSelectedModules(requestedModule = "", options = {}) {
  const modules = getPassportTypeModules(options);
  if (!requestedModule) return modules;
  return modules.filter((definition) =>
    definition.moduleKey === requestedModule || definition.typeName === requestedModule
  );
}

function buildAccessPlan(options = {}) {
  return {
    requested: Boolean(options.companyIds?.length || options.grantAllActiveCompanies),
    companyIds: options.companyIds || [],
    grantAllActiveCompanies: Boolean(options.grantAllActiveCompanies),
  };
}

function validateDefinition(definition) {
  const missing = ["moduleKey", "typeName", "displayName", "productCategory", "fieldsJson"]
    .filter((key) => !definition[key]);
  if (missing.length) {
    throw new Error(`Passport type module ${definition.moduleKey || definition.typeName || "<unknown>"} is missing: ${missing.join(", ")}`);
  }
  if (!isSafePassportTypeName(definition.typeName)) {
    throw new Error(`Invalid typeName for module ${definition.moduleKey}: ${definition.typeName}`);
  }
  const sections = definition.fieldsJson?.sections;
  if (!Array.isArray(sections) || !sections.length) {
    throw new Error(`Passport type module ${definition.moduleKey} must define at least one section`);
  }
}

async function resolveCompaniesForAccess(pool, { companyIds = [], grantAllActiveCompanies = false } = {}) {
  if (grantAllActiveCompanies) {
    const result = await pool.query(
      `SELECT id, "companyName" AS "companyName"
         FROM companies
        WHERE "isActive" = TRUE
        ORDER BY "companyName"`
    );
    return result.rows;
  }

  if (!companyIds.length) return [];

  const result = await pool.query(
    `SELECT id, "companyName" AS "companyName"
       FROM companies
      WHERE id = ANY($1::int[])
      ORDER BY "companyName"`,
    [companyIds]
  );
  const foundIds = new Set(result.rows.map((row) => Number(row.id)));
  const missingIds = companyIds.filter((id) => !foundIds.has(id));
  if (missingIds.length) {
    throw new Error(`Company ID(s) not found: ${missingIds.join(", ")}`);
  }
  return result.rows;
}

function sameFieldSet(leftSections = [], rightSections = []) {
  const left = flattenSchemaFieldsFromSections(leftSections).map((field) => field.key).sort();
  const right = flattenSchemaFieldsFromSections(rightSections).map((field) => field.key).sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function buildModuleRefreshProfile(existingFieldsJson = {}) {
  const currentProfile = existingFieldsJson?.profile || {};
  return {
    sourceModule: currentProfile.sourceModule || existingFieldsJson.sourceModule,
    // Keep the selected Local Tools fields and section labels, but deliberately
    // omit derived field metadata. It is rebuilt from the module so corrections
    // such as a public lifecycle field take effect for an existing seed.
    includedFields: (currentProfile.includedFields || [])
      .map((field) => ({
        sourceModuleFieldKey: field?.sourceModuleFieldKey,
        semanticId: field?.semanticId,
        domainClassKey: field?.domainClassKey,
        ...(field?.labelI18n ? { labelI18n: field.labelI18n } : {}),
      }))
      .filter((field) => field.sourceModuleFieldKey || field.semanticId),
    ...(Array.isArray(currentProfile.sectionOverrides)
      ? { sectionOverrides: currentProfile.sectionOverrides }
      : {}),
  };
}

async function refreshPassportTypeProfile(pool, existing, definition) {
  const existingSchemaVersion = Number.parseInt(existing.fieldsJson?.schemaVersion, 10) || 1;
  const fieldsJson = compilePassportTypeProfile({
    moduleDefinition: definition,
    profile: buildModuleRefreshProfile(existing.fieldsJson),
    schemaVersion: existingSchemaVersion + 1,
  });
  const refreshed = await pool.query(
    `UPDATE "passportTypes"
        SET "fieldsJson" = $2::jsonb,
            "updatedAt" = NOW()
      WHERE id = $1
      RETURNING id,
                "typeName" AS "typeName",
                "displayName" AS "displayName",
                "isActive" AS "isActive",
                "fieldsJson" AS "fieldsJson"`,
    [existing.id, JSON.stringify(fieldsJson)]
  );
  return { ...(refreshed.rows?.[0] || existing), seedAction: "refreshedProfile" };
}

async function ensurePassportType(pool, definition, { refreshModuleProfile = false } = {}) {
  await pool.query(
    "INSERT INTO \"productCategories\" (name, icon) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
    [definition.productCategory, definition.productIcon || "📋"]
  );

  const existingResult = await pool.query(
    `SELECT id,
            "typeName" AS "typeName",
            "displayName" AS "displayName",
            "isActive" AS "isActive",
            "fieldsJson" AS "fieldsJson"
       FROM "passportTypes"
      WHERE "typeName" = $1
      LIMIT 1`,
    [definition.typeName]
  );
  const existing = existingResult.rows?.[0] || null;
  if (existing) {
    if (existing.fieldsJson?.profile) {
      if (refreshModuleProfile) {
        return refreshPassportTypeProfile(pool, existing, definition);
      }
      return { ...existing, seedAction: "preservedProfile" };
    }

    const isProvablyFullLegacyType = existing.fieldsJson?.sourceModule === definition.moduleKey
      && sameFieldSet(existing.fieldsJson?.sections || [], definition.fieldsJson?.sections || []);
    if (!isProvablyFullLegacyType) {
      return { ...existing, seedAction: "preservedLegacy" };
    }

    try {
      const fieldsJson = compilePassportTypeProfile({
        moduleDefinition: definition,
        sections: existing.fieldsJson.sections,
        identity: existing.fieldsJson.identity,
        systemHeader: existing.fieldsJson.systemHeader,
        schemaVersion: Number.parseInt(existing.fieldsJson.schemaVersion, 10) || 1,
      });
      const backfilled = await pool.query(
        `UPDATE "passportTypes"
            SET "fieldsJson" = $2::jsonb,
                "updatedAt" = NOW()
          WHERE id = $1
          RETURNING id,
                    "typeName" AS "typeName",
                    "displayName" AS "displayName",
                    "isActive" AS "isActive",
                    "fieldsJson" AS "fieldsJson"`,
        [existing.id, JSON.stringify(fieldsJson)]
      );
      return { ...(backfilled.rows?.[0] || existing), seedAction: "backfilledFullProfile" };
    } catch {
      return { ...existing, seedAction: "preservedLegacy" };
    }
  }

  const fieldsJson = compilePassportTypeProfile({
    moduleDefinition: definition,
    schemaVersion: 1,
  });
  const result = await pool.query(
    `INSERT INTO "passportTypes"
       ("typeName", "displayName", "productCategory", "productIcon", "semanticModelKey", "fieldsJson", "createdBy")
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NULL)
     ON CONFLICT ("typeName") DO NOTHING
     RETURNING id,
               "typeName" AS "typeName",
               "displayName" AS "displayName",
               "isActive" AS "isActive",
               "fieldsJson" AS "fieldsJson"`,
    [
      definition.typeName,
      definition.displayName,
      definition.productCategory,
      definition.productIcon || "📋",
      definition.semanticModelKey || null,
      JSON.stringify(fieldsJson),
    ]
  );
  if (result.rows?.[0]) return { ...result.rows[0], seedAction: "createdFullProfile" };

  const concurrent = await pool.query(
    `SELECT id,
            "typeName" AS "typeName",
            "displayName" AS "displayName",
            "isActive" AS "isActive",
            "fieldsJson" AS "fieldsJson"
       FROM "passportTypes"
      WHERE "typeName" = $1
      LIMIT 1`,
    [definition.typeName]
  );
  if (!concurrent.rows?.[0]) throw new Error(`Failed to create passport type ${definition.typeName}`);
  return { ...concurrent.rows[0], seedAction: "preservedConcurrentProfile" };
}

async function grantCompanyAccess(pool, { companies = [], passportTypes = [] } = {}) {
  const grants = [];
  for (const company of companies) {
    for (const passportType of passportTypes) {
      const result = await pool.query(
        `INSERT INTO "companyPassportAccess" ("companyId", "passportTypeId", "accessRevoked")
         VALUES ($1, $2, FALSE)
         ON CONFLICT ("companyId", "passportTypeId") DO UPDATE SET "accessRevoked" = FALSE
         RETURNING id, "companyId", "passportTypeId", "accessRevoked"`,
        [company.id, passportType.id]
      );

      grants.push({
        companyId: company.id,
        companyName: company.companyName || null,
        moduleKey: passportType.moduleKey,
        typeName: passportType.typeName,
        accessId: result.rows[0]?.id || null,
      });
    }
  }
  return grants;
}

async function runSeed({ pool, options }) {
  const modules = getSelectedModules(options.requestedModule, {
    packagesDir: options.packagesDir,
  });
  if (!modules.length) {
    if (options.requestedModule) {
      throw new Error(`No passport type module found for ${options.requestedModule}`);
    }
    if (options.dryRun) {
      return {
        dryRun: true,
        selected: 0,
        accessPlan: buildAccessPlan(options),
        modules: [],
      };
    }
    return {
      success: true,
      seeded: 0,
      accessGranted: 0,
      results: [],
      accessGrants: [],
      message: "No passport type modules are registered.",
    };
  }

  modules.forEach(validateDefinition);

  if (options.dryRun) {
    return {
      dryRun: true,
      selected: modules.length,
      accessPlan: buildAccessPlan(options),
      modules,
    };
  }

  const storageService = options.skipStorage ? null : createStorageService(pool);
  const results = [];
  const seededPassportTypes = [];

  for (const definition of modules) {
    const row = await ensurePassportType(pool, definition, {
      refreshModuleProfile: options.refreshModuleProfile,
    });
    let storage = "skipped";
    if (storageService) {
      await storageService.createPassportTable(definition.typeName, {
        eventType: "passportModuleSeedReconcileTable",
      });
      storage = "reconciled";
    }

    const seededType = {
      id: row.id,
      moduleKey: definition.moduleKey,
      typeName: row.typeName,
      displayName: row.displayName,
      seedAction: row.seedAction,
    };
    seededPassportTypes.push(seededType);
    results.push({
      ...seededType,
      storage,
    });
  }

  const companies = await resolveCompaniesForAccess(pool, {
    companyIds: options.companyIds,
    grantAllActiveCompanies: options.grantAllActiveCompanies,
  });
  const accessGrants = await grantCompanyAccess(pool, {
    companies,
    passportTypes: seededPassportTypes,
  });

  return {
    success: true,
    seeded: results.length,
    accessGranted: accessGrants.length,
    results,
    accessGrants,
  };
}

async function main(cliArgs = process.argv.slice(2)) {
  const options = parseOptions(cliArgs);
  const pool = options.dryRun ? null : createPool();
  try {
    const result = await runSeed({ pool, options });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("[Passport type module seed] failed:", error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  ensurePassportType,
  buildModuleRefreshProfile,
  getSelectedModules,
  grantCompanyAccess,
  parseOptions,
  resolveCompaniesForAccess,
  runSeed,
};
