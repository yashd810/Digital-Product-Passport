"use strict";

const path = require("path");
require("dotenv").config({
  path: process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "../../../docker/.env"),
});

const { getPassportTypeModules } = require("../src/passport-modules");

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
  if (!/^[a-z][A-Za-z0-9]{1,99}$/.test(definition.typeName)) {
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

async function upsertPassportType(pool, definition) {
  await pool.query(
    "INSERT INTO \"productCategories\" (name, icon) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
    [definition.productCategory, definition.productIcon || "📋"]
  );

  const result = await pool.query(
    `INSERT INTO "passportTypes"
       ("typeName", "displayName", "productCategory", "productIcon", "semanticModelKey", "fieldsJson", "createdBy")
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NULL)
     ON CONFLICT ("typeName") DO UPDATE
       SET "displayName" = EXCLUDED."displayName",
           "productCategory" = EXCLUDED."productCategory",
           "productIcon" = EXCLUDED."productIcon",
           "semanticModelKey" = EXCLUDED."semanticModelKey",
           "fieldsJson" = EXCLUDED."fieldsJson",
           "isActive" = true,
           "updatedAt" = NOW()
     RETURNING id, "typeName" AS "typeName", "displayName" AS "displayName"`,
    [
      definition.typeName,
      definition.displayName,
      definition.productCategory,
      definition.productIcon || "📋",
      definition.semanticModelKey || null,
      JSON.stringify(definition.fieldsJson),
    ]
  );

  return result.rows[0];
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
    modulesDir: options.modulesDir,
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
    const row = await upsertPassportType(pool, definition);
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
  getSelectedModules,
  grantCompanyAccess,
  parseOptions,
  resolveCompaniesForAccess,
  runSeed,
};
