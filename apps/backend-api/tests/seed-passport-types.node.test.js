"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  getSelectedModules,
  grantCompanyAccess,
  parseOptions,
  resolveCompaniesForAccess,
  runSeed,
} = require("../scripts/seed-passport-types");

function createMockPool() {
  const calls = [];
  let passportTypeId = 100;
  const companies = [
    { id: 7, companyName: "Northwind Devices" },
    { id: 8, companyName: "Sensor Works" },
  ];

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      const normalizedSql = String(sql).replace(/\s+/g, " ").trim();

      if (normalizedSql.includes("FROM companies") && normalizedSql.includes("WHERE \"isActive\" = TRUE")) {
        return { rows: companies };
      }

      if (normalizedSql.includes("FROM companies") && normalizedSql.includes("WHERE id = ANY")) {
        const ids = params[0] || [];
        return { rows: companies.filter((company) => ids.includes(company.id)) };
      }

      if (normalizedSql.startsWith("INSERT INTO \"productCategories\"")) {
        return { rows: [] };
      }

      if (normalizedSql.startsWith("INSERT INTO \"passportTypes\"")) {
        passportTypeId += 1;
        return {
          rows: [{
            id: passportTypeId,
            typeName: params[0],
            displayName: params[1],
          }],
        };
      }

      if (normalizedSql.startsWith("INSERT INTO \"companyPassportAccess\"")) {
        return {
          rows: [{
            id: Number(`${params[0]}${params[1]}`),
            companyId: params[0],
            passportTypeId: params[1],
            accessRevoked: false,
          }],
        };
      }

      return { rows: [] };
    },
  };
}

function createSystemHeader() {
  return {
    section: { key: "passportHeader", label: "Passport Header" },
    fieldMappings: [
      { slotKey: "digitalProductPassportId", sourceType: "managed", managedKey: "internalManagedDigitalProductPassportId" },
      { slotKey: "uniqueProductIdentifier", sourceType: "managed", managedKey: "internalManagedUniqueProductIdentifier" },
      { slotKey: "internalAliasId", sourceType: "managed", managedKey: "internalManagedInternalAliasId" },
      { slotKey: "granularity", sourceType: "managed", managedKey: "internalManagedGranularity" },
      { slotKey: "dppSchemaVersion", sourceType: "managed", managedKey: "internalManagedDppSchemaVersion" },
      { slotKey: "dppStatus", sourceType: "managed", managedKey: "internalManagedDppStatus" },
      { slotKey: "lastUpdate", sourceType: "managed", managedKey: "internalManagedLastUpdate" },
      { slotKey: "economicOperatorId", sourceType: "managed", managedKey: "internalManagedEconomicOperatorId" },
      { slotKey: "facilityId", sourceType: "managed", managedKey: "internalManagedFacilityId" },
      { slotKey: "contentSpecificationIds", sourceType: "managed", managedKey: "internalManagedContentSpecificationIds" },
      { slotKey: "subjectDid", sourceType: "managed", managedKey: "internalManagedSubjectDid" },
      { slotKey: "dppDid", sourceType: "managed", managedKey: "internalManagedDppDid" },
      { slotKey: "companyDid", sourceType: "managed", managedKey: "internalManagedCompanyDid" },
    ],
    fieldKeys: [],
  };
}

function createExampleProductModule() {
  return {
    moduleKey: "example-product:v1",
    typeName: "exampleProductPassportV1",
    displayName: "Example Product Passport v1",
    productCategory: "Example Product",
    productIcon: "MD",
    semanticModelKey: "exampleProductDictionaryV1",
    identity: {
      businessIdentifierField: "modelIdentifier",
    },
    systemHeader: createSystemHeader(),
    passportPolicy: {
      key: "exampleProductDppV1",
      displayName: "Example Product Passport Policy v1",
      contentSpecificationIds: ["exampleProductDictionaryV1"],
    },
    sections: [{
      key: "deviceIdentity",
      label: "Device Identity",
      fields: [
        {
          key: "modelIdentifier",
          label: "Model Identifier",
          type: "text",
          semanticId: "https://example.test/dictionary/example-product/v1/terms/model-identifier",
          elementIdPath: "deviceIdentity.modelIdentifier",
          objectType: "SingleValuedDataElement",
          valueDataType: "String",
        },
      ],
    }],
  };
}

function writeModuleFile(modulesDir, fileName = "example-product-v1.js") {
  fs.writeFileSync(
    path.join(modulesDir, fileName),
    `"use strict";\n\nmodule.exports = ${JSON.stringify(createExampleProductModule(), null, 2)};\n`
  );
}

async function withTempModules(callback) {
  const modulesDir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-passport-modules-"));
  try {
    return await callback(modulesDir);
  } finally {
    fs.rmSync(modulesDir, { recursive: true, force: true });
  }
}

test("parseOptions supports explicit company access targets", () => {
  assert.deepEqual(parseOptions([
    "--module=example-product:v1",
    "--company-id=7,8",
    "--skip-storage",
  ]), {
    dryRun: false,
    skipStorage: true,
    requestedModule: "example-product:v1",
    companyIds: [7, 8],
    grantAllActiveCompanies: false,
  });
});

test("parseOptions rejects ambiguous company access targets", () => {
  assert.throws(
    () => parseOptions(["--company-id=7", "--grant-all-active-companies"]),
    /Use either --company-id or --grant-all-active-companies/
  );
});

test("dry run with an empty module registry reports zero selected modules", async () => withTempModules(async (modulesDir) => {
  const result = await runSeed({
    pool: null,
    options: {
      ...parseOptions(["--dry-run", "--company-id=7"]),
      modulesDir,
    },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.selected, 0);
  assert.deepEqual(result.accessPlan.companyIds, [7]);
  assert.deepEqual(result.modules, []);
}));

test("seed script can discover and select an arbitrary future module file", async () => withTempModules(async (modulesDir) => {
  writeModuleFile(modulesDir);

  const selected = getSelectedModules("example-product:v1", { modulesDir });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].moduleKey, "example-product:v1");
  assert.equal(selected[0].fieldsJson.passportPolicy.key, "exampleProductDppV1");

  const result = await runSeed({
    pool: null,
    options: {
      ...parseOptions(["--dry-run", "--module=example-product:v1"]),
      modulesDir,
    },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.selected, 1);
  assert.equal(result.modules[0].productCategory, "Example Product");
}));

test("requested missing module still fails clearly", async () => withTempModules(async (modulesDir) => {
  await assert.rejects(
    () => runSeed({
      pool: null,
      options: {
        ...parseOptions(["--dry-run", "--module=missing:v1"]),
        modulesDir,
      },
    }),
    /No passport type module found for missing:v1/
  );
}));

test("empty non-dry seed run is a safe no-op", async () => withTempModules(async (modulesDir) => {
  const result = await runSeed({
    pool: createMockPool(),
    options: {
      ...parseOptions(["--skip-storage"]),
      modulesDir,
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.seeded, 0);
  assert.equal(result.accessGranted, 0);
  assert.deepEqual(result.results, []);
}));

test("resolveCompaniesForAccess rejects missing explicit company IDs", async () => {
  const pool = createMockPool();
  await assert.rejects(
    () => resolveCompaniesForAccess(pool, { companyIds: [7, 999] }),
    /Company ID\(s\) not found: 999/
  );
});

test("grantCompanyAccess mirrors admin access upsert behavior", async () => {
  const pool = createMockPool();
  const grants = await grantCompanyAccess(pool, {
    companies: [{ id: 7, companyName: "Northwind Devices" }],
    passportTypes: [{ id: 101, moduleKey: "example-product:v1", typeName: "exampleProductPassportV1" }],
  });

  assert.equal(grants.length, 1);
  assert.equal(grants[0].companyId, 7);
  assert.equal(grants[0].typeName, "exampleProductPassportV1");
  assert.ok(pool.calls.some((call) =>
    call.sql.includes("ON CONFLICT (\"companyId\", \"passportTypeId\") DO UPDATE SET \"accessRevoked\" = FALSE")
  ));
});

test("runSeed can seed a module and grant access to selected companies", async () => withTempModules(async (modulesDir) => {
  writeModuleFile(modulesDir);
  const pool = createMockPool();
  const result = await runSeed({
    pool,
    options: {
      ...parseOptions(["--module=example-product:v1", "--company-id=7", "--skip-storage"]),
      modulesDir,
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.seeded, 1);
  assert.equal(result.accessGranted, 1);
  assert.equal(result.results[0].typeName, "exampleProductPassportV1");
  assert.equal(result.accessGrants[0].companyId, 7);
}));
