"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ensurePassportType,
  getSelectedModules,
  grantCompanyAccess,
  parseOptions,
  resolveCompaniesForAccess,
  runSeed,
} = require("../scripts/seed-passport-types");
const { getPassportTypeModule } = require("../src/services/passport-module-registry");
const { compilePassportTypeProfile } = require("../src/services/passport-type-profile");

function findFieldByKey(sections, fieldKey) {
  for (const section of sections || []) {
    const direct = (section.fields || []).find((field) => field.key === fieldKey);
    if (direct) return direct;
    const nested = findFieldByKey(section.sections || [], fieldKey);
    if (nested) return nested;
  }
  return null;
}

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
  const rootClassIri = "https://example.test/dictionary/example-product/v1/classes/ExampleProductPassport";
  const deviceIdentityClassIri = "https://example.test/dictionary/example-product/v1/classes/DeviceIdentity";
  return {
    moduleKey: "example-product:v1",
    typeName: "exampleProductPassportV1",
    displayName: "Example Product Passport v1",
    productCategory: "Example Product",
    productIcon: "MD",
    semanticModelKey: "exampleProductDictionaryV1",
    identity: {
      businessIdentifierField: "modelName",
      modelNameField: "modelName",
    },
    systemHeader: createSystemHeader(),
    passportPolicy: {
      key: "exampleProductDppV1",
      displayName: "Example Product Passport Policy v1",
      contentSpecificationIds: ["exampleProductDictionaryV1"],
    },
    semanticGraph: {
      schemaVersion: 1,
      rootClassKey: "exampleProductPassport",
      classes: [
        {
          key: "exampleProductPassport",
          label: "Example Product Passport",
          semanticId: rootClassIri,
          root: true,
          properties: [{
            key: "deviceIdentity",
            label: "Device Identity",
            semanticId: "https://example.test/dictionary/example-product/v1/terms/device-identity",
            domainClassKey: "exampleProductPassport",
            domainClassIri: rootClassIri,
            rangeKind: "class",
            rangeClassKey: "deviceIdentity",
            relationshipType: "composition",
            minCount: 0,
            maxCount: 1,
          }],
        },
        {
          key: "deviceIdentity",
          label: "Device Identity",
          semanticId: deviceIdentityClassIri,
          properties: [{
            key: "modelName",
            label: "Model name",
            semanticId: "https://example.test/dictionary/example-product/v1/terms/device-identity/model-name",
            domainClassKey: "deviceIdentity",
            domainClassIri: deviceIdentityClassIri,
            rangeKind: "scalar",
            dataType: "string",
            minCount: 0,
            maxCount: 1,
          }],
        },
      ],
      enums: [],
    },
    sections: [{
      key: "deviceIdentity",
      label: "Device Identity",
      fields: [
        {
          key: "modelName",
          label: "Model name",
          type: "text",
          dataType: "string",
          semanticId: "https://example.test/dictionary/example-product/v1/terms/device-identity/model-name",
          domainClassKey: "deviceIdentity",
          domainClassIri: deviceIdentityClassIri,
          rangeKind: "scalar",
          rangeIri: "http://www.w3.org/2001/XMLSchema#string",
          minCount: 0,
          maxCount: 1,
          elementIdPath: "deviceIdentity.modelName",
          objectType: "SingleValuedDataElement",
          valueDataType: "String",
        },
      ],
    }],
  };
}

function writeModulePackage(packagesDir, definition = createExampleProductModule()) {
  const packageDir = path.join(packagesDir, "example-product-v1");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "module.js"),
    `"use strict";\n\nmodule.exports = ${JSON.stringify(definition, null, 2)};\n`
  );
  fs.writeFileSync(
    path.join(packageDir, "manifest.json"),
    `${JSON.stringify({ semanticModelKey: definition.semanticModelKey }, null, 2)}\n`
  );
}

async function withTempModules(callback) {
  const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-passport-modules-"));
  try {
    return await callback(packagesDir);
  } finally {
    fs.rmSync(packagesDir, { recursive: true, force: true });
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
    refreshModuleProfile: false,
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

test("dry run with an empty module registry reports zero selected modules", async () => withTempModules(async (packagesDir) => {
  const result = await runSeed({
    pool: null,
    options: {
      ...parseOptions(["--dry-run", "--company-id=7"]),
      packagesDir,
    },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.selected, 0);
  assert.deepEqual(result.accessPlan.companyIds, [7]);
  assert.deepEqual(result.modules, []);
}));

test("seed script can discover and select an arbitrary future module package", async () => withTempModules(async (packagesDir) => {
  writeModulePackage(packagesDir);

  const selected = getSelectedModules("example-product:v1", { packagesDir });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].moduleKey, "example-product:v1");
  assert.equal(selected[0].fieldsJson.passportPolicy.key, "exampleProductDppV1");

  const result = await runSeed({
    pool: null,
    options: {
      ...parseOptions(["--dry-run", "--module=example-product:v1"]),
      packagesDir,
    },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.selected, 1);
  assert.equal(result.modules[0].productCategory, "Example Product");
}));

test("seed script rejects modules that duplicate reserved passport header fields", async () => withTempModules(async (packagesDir) => {
  const definition = createExampleProductModule();
  definition.semanticGraph.classes[1].properties.push({
    ...definition.semanticGraph.classes[1].properties[0],
    key: "dppStatus",
    label: "DPP status",
    semanticId: "https://example.test/dictionary/example-product/v1/terms/device-identity/dpp-status",
  });
  definition.sections[0].fields.push({
    ...definition.sections[0].fields[0],
    key: "dppStatus",
    label: "DPP status",
    semanticId: "https://example.test/dictionary/example-product/v1/terms/device-identity/dpp-status",
  });
  writeModulePackage(packagesDir, definition);

  await assert.rejects(
    () => runSeed({
      pool: null,
      options: {
        ...parseOptions(["--dry-run", "--module=example-product:v1"]),
        packagesDir,
      },
    }),
    /contains a reserved passport registry\/header field.*Field "dppStatus" is already generated/
  );
}));

test("requested missing module still fails clearly", async () => withTempModules(async (packagesDir) => {
  await assert.rejects(
    () => runSeed({
      pool: null,
      options: {
        ...parseOptions(["--dry-run", "--module=missing:v1"]),
        packagesDir,
      },
    }),
    /No passport type module found for missing:v1/
  );
}));

test("empty non-dry seed run is a safe no-op", async () => withTempModules(async (packagesDir) => {
  const result = await runSeed({
    pool: createMockPool(),
    options: {
      ...parseOptions(["--skip-storage"]),
      packagesDir,
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

test("existing curated passport type profiles are never overwritten by the seed", async () => {
  const definition = createExampleProductModule();
  const existing = {
    id: 311,
    typeName: definition.typeName,
    displayName: "Curated Example Product Type",
    isActive: true,
    fieldsJson: {
      sourceModule: definition.moduleKey,
      profile: {
        contractVersion: 1,
        selectionMode: "explicit",
        includedFields: [{ sourceModuleFieldKey: "modelName" }],
      },
    },
  };
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (String(sql).startsWith("INSERT INTO \"productCategories\"")) return { rows: [] };
      if (String(sql).includes("FROM \"passportTypes\"") && String(sql).includes("WHERE \"typeName\" = $1")) {
        return { rows: [existing] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await ensurePassportType(pool, definition);

  assert.equal(result.seedAction, "preservedProfile");
  assert.equal(result.displayName, "Curated Example Product Type");
  assert.equal(calls.some((call) => String(call.sql).startsWith("UPDATE \"passportTypes\"")), false);
  assert.equal(calls.some((call) => String(call.sql).startsWith("INSERT INTO \"passportTypes\"")), false);
});

test("an explicit module profile refresh reapplies corrected module metadata", async () => {
  const definition = getPassportTypeModule("battery:v1");
  const staleFieldsJson = JSON.parse(JSON.stringify(compilePassportTypeProfile({
    moduleDefinition: definition,
    schemaVersion: 1,
  })));
  findFieldByKey(staleFieldsJson.sections, "dateOfPuttingTheBatteryIntoService").confidentiality = "restricted";
  staleFieldsJson.profile.includedFields.find((field) =>
    field.sourceModuleFieldKey === "dateOfPuttingTheBatteryIntoService"
  ).confidentiality = "restricted";
  const existing = {
    id: 314,
    typeName: definition.typeName,
    displayName: definition.displayName,
    isActive: true,
    fieldsJson: staleFieldsJson,
  };
  const pool = {
    async query(sql, params = []) {
      if (String(sql).startsWith("INSERT INTO \"productCategories\"")) return { rows: [] };
      if (String(sql).includes("FROM \"passportTypes\"") && String(sql).includes("WHERE \"typeName\" = $1")) {
        return { rows: [existing] };
      }
      if (String(sql).startsWith("UPDATE \"passportTypes\"")) {
        return { rows: [{ ...existing, fieldsJson: JSON.parse(params[1]) }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await ensurePassportType(pool, definition, { refreshModuleProfile: true });

  assert.equal(result.seedAction, "refreshedProfile");
  assert.equal(result.fieldsJson.schemaVersion, 2);
  assert.equal(
    findFieldByKey(result.fieldsJson.sections, "dateOfPuttingTheBatteryIntoService").confidentiality,
    "public"
  );
});

test("a legacy subset type is preserved rather than being expanded by the seed", async () => {
  const definition = createExampleProductModule();
  const existing = {
    id: 313,
    typeName: definition.typeName,
    displayName: "Legacy subset type",
    isActive: true,
    fieldsJson: {
      sourceModule: definition.moduleKey,
      sections: [{
        ...definition.sections[0],
        fields: [],
      }],
    },
  };
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (String(sql).startsWith("INSERT INTO \"productCategories\"")) return { rows: [] };
      if (String(sql).includes("FROM \"passportTypes\"") && String(sql).includes("WHERE \"typeName\" = $1")) {
        return { rows: [existing] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await ensurePassportType(pool, definition);

  assert.equal(result.seedAction, "preservedLegacy");
  assert.equal(calls.some((call) => String(call.sql).startsWith("UPDATE \"passportTypes\"")), false);
  assert.equal(calls.some((call) => String(call.sql).startsWith("INSERT INTO \"passportTypes\"")), false);
});

test("runSeed can seed a module and grant access to selected companies", async () => withTempModules(async (packagesDir) => {
  writeModulePackage(packagesDir);
  const pool = createMockPool();
  const result = await runSeed({
    pool,
    options: {
      ...parseOptions(["--module=example-product:v1", "--company-id=7", "--skip-storage"]),
      packagesDir,
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.seeded, 1);
  assert.equal(result.accessGranted, 1);
  assert.equal(result.results[0].typeName, "exampleProductPassportV1");
  assert.equal(result.accessGrants[0].companyId, 7);
}));
