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
    { id: 7, companyName: "Northwind Textiles" },
    { id: 8, companyName: "Battery Works" },
  ];

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      const normalizedSql = String(sql).replace(/\s+/g, " ").trim();

      if (normalizedSql.includes("FROM companies") && normalizedSql.includes("WHERE is_active = TRUE")) {
        return { rows: companies };
      }

      if (normalizedSql.includes("FROM companies") && normalizedSql.includes("WHERE id = ANY")) {
        const ids = params[0] || [];
        return { rows: companies.filter((company) => ids.includes(company.id)) };
      }

      if (normalizedSql.startsWith("INSERT INTO product_categories")) {
        return { rows: [] };
      }

      if (normalizedSql.startsWith("INSERT INTO passport_types")) {
        passportTypeId += 1;
        return {
          rows: [{
            id: passportTypeId,
            typeName: params[0],
            displayName: params[1],
          }],
        };
      }

      if (normalizedSql.startsWith("INSERT INTO company_passport_access")) {
        return {
          rows: [{
            id: Number(`${params[0]}${params[1]}`),
            company_id: params[0],
            passport_type_id: params[1],
            access_revoked: false,
          }],
        };
      }

      return { rows: [] };
    },
  };
}

test("parseOptions supports explicit company access targets", () => {
  assert.deepEqual(parseOptions([
    "--module=textile:v1",
    "--company-id=7,8",
    "--skip-storage",
  ]), {
    dryRun: false,
    skipStorage: true,
    requestedModule: "textile:v1",
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

test("dry run reports the selected module and access plan without requiring a pool", async () => {
  const result = await runSeed({
    pool: null,
    options: parseOptions(["--dry-run", "--module=textile:v1", "--company-id=7"]),
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.selected, 1);
  assert.deepEqual(result.accessPlan.companyIds, [7]);
  assert.equal(result.modules[0].moduleKey, "textile:v1");
});

test("seed script can discover and select an arbitrary future module file", async () => {
  const modulesDir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-passport-modules-"));
  fs.writeFileSync(path.join(modulesDir, "medical-device-v1.js"), `
    "use strict";

    module.exports = {
      moduleKey: "medical-device:v1",
      typeName: "medicalDevicePassportV1",
      displayName: "Medical Device Passport v1",
      productCategory: "Medical Device",
      productIcon: "MD",
      semanticModelKey: "claros_medical_device_dictionary_v1",
      identity: {
        businessIdentifierField: "modelIdentifier",
      },
      complianceProfile: {
        key: "medicalDeviceDppV1",
        displayName: "Medical Device DPP Profile v1",
        contentSpecificationIds: ["claros_medical_device_dictionary_v1"],
        requiredPassportFields: ["complianceProfileKey", "contentSpecificationIds"],
        enforceSemanticMapping: true,
      },
      sections: [{
        key: "deviceIdentity",
        label: "Device Identity",
        fields: [
          { key: "modelIdentifier", label: "Model Identifier", type: "text" },
        ],
      }],
    };
  `);

  try {
    const selected = getSelectedModules("medical-device:v1", { modulesDir });
    assert.equal(selected.length, 1);
    assert.equal(selected[0].moduleKey, "medical-device:v1");
    assert.equal(selected[0].fieldsJson.complianceProfile.key, "medicalDeviceDppV1");

    const result = await runSeed({
      pool: null,
      options: {
        ...parseOptions(["--dry-run", "--module=medical-device:v1"]),
        modulesDir,
      },
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.selected, 1);
    assert.equal(result.modules[0].productCategory, "Medical Device");
  } finally {
    fs.rmSync(modulesDir, { recursive: true, force: true });
  }
});

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
    companies: [{ id: 7, companyName: "Northwind Textiles" }],
    passportTypes: [{ id: 101, moduleKey: "textile:v1", typeName: "textilePassportV1" }],
  });

  assert.equal(grants.length, 1);
  assert.equal(grants[0].companyId, 7);
  assert.equal(grants[0].typeName, "textilePassportV1");
  assert.ok(pool.calls.some((call) =>
    call.sql.includes("ON CONFLICT (company_id, passport_type_id) DO UPDATE SET access_revoked = FALSE")
  ));
});

test("runSeed can seed a module and grant access to selected companies", async () => {
  const pool = createMockPool();
  const result = await runSeed({
    pool,
    options: parseOptions(["--module=textile:v1", "--company-id=7", "--skip-storage"]),
  });

  assert.equal(result.success, true);
  assert.equal(result.seeded, 1);
  assert.equal(result.accessGranted, 1);
  assert.equal(result.results[0].typeName, "textilePassportV1");
  assert.equal(result.accessGrants[0].companyId, 7);
});
