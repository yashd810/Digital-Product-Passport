"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createComplianceService = require("../src/services/compliance-service");
const createSemanticModelRegistry = require("../src/infrastructure/semantics/create-semantic-model-registry");
const { getPassportTypeModule } = require("../src/passport-modules");

function createMockPool(typeDef) {
  return {
    async query(sql, params = []) {
      if (sql.includes("FROM passport_types")) {
        return {
          rows: typeDef && params[0] === typeDef.typeName ? [typeDef] : [],
        };
      }

      if (sql.includes("FROM companies")) {
        return {
          rows: [{
            id: 12,
            companyName: "Nordic Textiles",
            didSlug: "nordic-textiles",
            economicOperatorIdentifier: "EORI-TEXTILE-001",
            economicOperatorIdentifierScheme: "EORI",
          }],
        };
      }

      throw new Error(`Unhandled mock query: ${sql}`);
    },
  };
}

function buildCanonicalPassportPayload(passport, _typeDef, { company } = {}) {
  const dppIdentifier = passport?.dppId || "dpp-test";
  const productIdentifier = passport?.internalAliasId || "product-test";
  return {
    digitalProductPassportId: `https://example.test/dpp/${encodeURIComponent(dppIdentifier)}`,
    uniqueProductIdentifier: `https://example.test/product/${encodeURIComponent(productIdentifier)}`,
    dppSchemaVersion: passport?.dppSchemaVersion || "prEN 18223:2025",
    dppStatus: passport?.releaseStatus || "Draft",
    granularity: passport?.granularity || "item",
    lastUpdate: passport?.updatedAt || "2026-06-02T08:00:00.000Z",
    economicOperatorId: passport?.economicOperatorId || company?.economicOperatorIdentifier || null,
    facilityId: passport?.facilityId || null,
  };
}

function createModuleComplianceService(moduleKey) {
  const passportType = getPassportTypeModule(moduleKey);
  return {
    passportType,
    service: createComplianceService({
      pool: createMockPool(passportType),
      semanticModelRegistry: createSemanticModelRegistry(),
      buildCanonicalPassportPayload,
    }),
  };
}

function createTextileComplianceService() {
  const { service, passportType } = createModuleComplianceService("textile:v1");
  return { service, textileType: passportType };
}

function createCompleteTextilePassport(overrides = {}) {
  return {
    passportType: "textilePassportV1",
    companyId: 12,
    granularity: "item",
    productModelIdentifier: "STYLE-2026-LINEN-01",
    countryOfOrigin: "SE",
    fiberComposition: "70% organic cotton, 30% recycled polyester",
    recycledContentPercentage: "30",
    fabricWeight: "210",
    careInstructions: "Wash cold. Line dry.",
    durabilityScore: "4",
    restrictedSubstancesDisclosure: "No restricted substances above declared thresholds.",
    ...overrides,
  };
}

function createCompleteBatteryPassport(overrides = {}) {
  return {
    passportType: "batteryPassportV1",
    companyId: 12,
    dppId: "BAT-DPP-001",
    internalAliasId: "BAT-ITEM-001",
    granularity: "item",
    facilityId: "PLANT-01",
    batteryModelIdentifier: "MODEL-X1",
    batterySerialNumber: "SERIAL-X1-0001",
    batteryCategory: "EV",
    manufacturerInformation: "Acme Battery Manufacturing",
    batteryChemistry: "NMC",
    batteryMass: "450.5",
    ratedCapacity: "80",
    manufacturingDate: "2026-05-01",
    carbonFootprintLabel: "CFP-A",
    ...overrides,
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function createApplianceComplianceFixture() {
  const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), "compliance-semantic-models-"));
  const modelDir = path.join(resourcesDir, "appliance", "v3");
  fs.mkdirSync(modelDir, { recursive: true });

  writeJson(path.join(modelDir, "manifest.json"), {
    semanticModelKey: "claros_appliance_dictionary_v3",
    name: "Claros Appliance Dictionary",
    version: "3.0.0",
  });
  writeJson(path.join(modelDir, "terms.json"), [
    {
      slug: "appliance-class",
      label: "Appliance class",
      iri: "https://example.test/dictionary/appliance/v3/terms/appliance-class",
      appFieldKeys: ["applianceClass"],
      dataType: "string",
    },
    {
      slug: "model-identifier",
      label: "Model identifier",
      iri: "https://example.test/dictionary/appliance/v3/terms/model-identifier",
      appFieldKeys: ["modelIdentifier"],
      dataType: "string",
    },
    {
      slug: "energy-rating",
      label: "Energy rating",
      iri: "https://example.test/dictionary/appliance/v3/terms/energy-rating",
      appFieldKeys: ["energyRating"],
      dataType: "string",
    },
  ]);
  writeJson(path.join(modelDir, "field-map.json"), {
    applianceClass: "https://example.test/dictionary/appliance/v3/terms/appliance-class",
    modelIdentifier: "https://example.test/dictionary/appliance/v3/terms/model-identifier",
    energyRating: "https://example.test/dictionary/appliance/v3/terms/energy-rating",
  });
  writeJson(path.join(modelDir, "context.jsonld"), {
    "@context": {
      applianceClass: "https://example.test/dictionary/appliance/v3/terms/appliance-class",
      modelIdentifier: "https://example.test/dictionary/appliance/v3/terms/model-identifier",
      energyRating: "https://example.test/dictionary/appliance/v3/terms/energy-rating",
    },
  });
  writeJson(path.join(modelDir, "category-rules.json"), {
    categories: ["Home", "Industrial"],
    requirementsByFieldKey: {
      energyRating: {
        requirements: {
          Home: "mandatory_espr_jtc24",
          Industrial: "voluntary",
        },
      },
    },
  });

  const passportType = {
    typeName: "appliancePassportV3",
    displayName: "Appliance Passport v3",
    productCategory: "Appliance",
    semanticModelKey: "claros_appliance_dictionary_v3",
    complianceProfile: {
      key: "applianceDppV3",
      displayName: "Appliance DPP Profile v3",
      contentSpecificationIds: ["claros_appliance_dictionary_v3"],
      requiredPassportFields: ["complianceProfileKey", "contentSpecificationIds"],
      enforceSemanticMapping: true,
      categoryPolicy: {
        kind: "semanticCategory",
        productKind: "appliance",
        label: "appliance class",
        fieldKey: "applianceClass",
        aliases: {
          home: "Home",
          household: "Home",
          industrial: "Industrial",
        },
      },
    },
    fieldsJson: {
      sections: [{
        key: "applianceIdentity",
        label: "Identity",
        fields: [
          { key: "applianceClass", label: "Appliance Class", type: "text" },
          { key: "modelIdentifier", label: "Model Identifier", type: "text" },
          { key: "energyRating", label: "Energy Rating", type: "text" },
        ],
      }],
    },
  };

  return {
    passportType,
    service: createComplianceService({
      pool: createMockPool(passportType),
      semanticModelRegistry: createSemanticModelRegistry({ resourcesDir }),
      buildCanonicalPassportPayload,
    }),
    cleanup: () => fs.rmSync(resourcesDir, { recursive: true, force: true }),
  };
}

test("textile passport evaluates through textile compliance profile and semantic model", async () => {
  const { service, textileType } = createTextileComplianceService();
  const result = await service.evaluatePassport(
    createCompleteTextilePassport(),
    textileType.typeName
  );

  assert.equal(result.profile.key, "textileDppV1");
  assert.equal(result.semanticModelKey, "claros_textile_dictionary_v1");
  assert.equal("isBatteryPassport" in result, false);
  assert.equal(result.workflowReleaseAllowed, true);
  assert.equal(result.directReleaseAllowed, true);
  assert.deepEqual(result.semanticIssues, []);
  assert.deepEqual(result.category.ruleCoverage, []);
});

test("arbitrary product modules can use semantic category policy without battery-specific code", async () => {
  const { service, passportType, cleanup } = createApplianceComplianceFixture();
  try {
    const result = await service.evaluatePassport({
      passportType: passportType.typeName,
      companyId: 12,
      applianceClass: "household",
      modelIdentifier: "APP-2026-01",
      energyRating: "A",
    }, passportType.typeName);

    assert.equal(result.profile.key, "applianceDppV3");
    assert.equal(result.semanticModelKey, "claros_appliance_dictionary_v3");
    assert.equal("isBatteryPassport" in result, false);
    assert.equal(result.categoryPolicyKind, "semanticCategory");
    assert.equal(result.category.productKind, "appliance");
    assert.equal(result.category.normalized, "Home");
    assert.ok(result.category.ruleCoverage.some((field) =>
      field.key === "energyRating" && field.mandatory === true
    ));
    assert.equal(result.workflowReleaseAllowed, true);
  } finally {
    cleanup();
  }
});

test("textile semantic profile blocks values that violate textile datatypes", async () => {
  const { service, textileType } = createTextileComplianceService();
  const result = await service.evaluatePassport(
    createCompleteTextilePassport({ recycledContentPercentage: "thirty" }),
    textileType.typeName
  );

  assert.equal(result.profile.key, "textileDppV1");
  assert.equal(result.workflowReleaseAllowed, false);
  assert.ok(
    result.blockingIssues.some((issue) => issue.code === "SEMANTIC_VALUE_TYPE_MISMATCH"),
    "Expected textile semantic datatype mismatch to block release"
  );
});

test("battery module evaluates through battery profile using semantic field-key bridges", async () => {
  const { service, passportType } = createModuleComplianceService("battery:v1");
  const result = await service.evaluatePassport(
    createCompleteBatteryPassport(),
    passportType.typeName
  );

  assert.equal(result.profile.key, "batteryDppV1");
  assert.equal(result.semanticModelKey, "claros_battery_dictionary_v1");
  assert.equal("isBatteryPassport" in result, false);
  assert.equal(result.category.productKind, "battery");
  assert.equal(result.category.normalized, "EV");
  assert.ok(result.category.ruleCoverage.some((field) => field.key === "batteryModelIdentifier"));
  assert.equal(result.workflowReleaseAllowed, true);
  assert.equal(result.directReleaseAllowed, true);
});
