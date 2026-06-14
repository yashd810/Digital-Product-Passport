"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createCanonicalPassportSerializer = require("../src/services/canonicalPassportSerializer");
const createSemanticModelRegistry = require("../src/infrastructure/semantics/create-semantic-model-registry");

function createDidService() {
  return {
    normalizeGranularity: (value) => String(value || "item").trim().toLowerCase(),
    normalizeStableId: (value) => String(value || "").trim() || null,
    normalizeCompanySlug: (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    normalizePassportTypeSegment: (value) => String(value || "passport").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    generateCompanyDid: (slug) => `did:web:example.test:company:${slug}`,
    generateItemDid: (namespace, stableId) => `did:web:example.test:did:${namespace}:item:${stableId}`,
    generateBatchDid: (namespace, stableId) => `did:web:example.test:did:${namespace}:batch:${stableId}`,
    generateModelDid: (namespace, stableId) => `did:web:example.test:did:${namespace}:model:${stableId}`,
    generateDppDid: (granularity, stableId) => `did:web:example.test:did:dpp:${granularity}:${stableId}`,
  };
}

function createProductIdentifierService() {
  return {
    extractBusinessProductIdentifier: (passport) => passport?.internalAliasId || "",
    buildCanonicalProductDid: ({ passportType, rawProductId }) =>
      `did:web:example.test:product:${passportType}:${encodeURIComponent(rawProductId)}`,
  };
}

function createTextileTypeDef() {
  return {
    typeName: "textilePassportV1",
    displayName: "Textile Passport v1",
    productCategory: "Textile",
    semanticModelKey: "claros_textile_dictionary_v1",
    fieldsJson: {
      sections: [{
        key: "textileIdentity",
        fields: [
          {
            key: "fiberComposition",
            label: "Fiber Composition",
            type: "text",
            semanticId: "https://www.claros-dpp.online/dictionary/textile/v1/terms/fiber-composition",
            objectType: "SingleValuedDataElement",
            valueDataType: "String",
          },
          {
            key: "recycledContentPercentage",
            label: "Recycled Content Percentage",
            type: "text",
            semanticId: "https://www.claros-dpp.online/dictionary/textile/v1/terms/recycled-content-percentage",
            objectType: "SingleValuedDataElement",
            valueDataType: "Decimal",
          },
        ],
      }],
    },
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function createApplianceRegistryFixture() {
  const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-semantic-models-"));
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
      dataType: "string",
    },
    {
      slug: "energy-rating",
      label: "Energy rating",
      iri: "https://example.test/dictionary/appliance/v3/terms/energy-rating",
      dataType: "string",
    },
  ]);
  writeJson(path.join(modelDir, "context.jsonld"), {
    "@context": {
      applianceClass: "https://example.test/dictionary/appliance/v3/terms/appliance-class",
      energyRating: "https://example.test/dictionary/appliance/v3/terms/energy-rating",
    },
  });
  writeJson(path.join(modelDir, "category-rules.json"), {
    categories: ["Home", "Industrial"],
    requirementsBySemanticId: {
      "https://example.test/dictionary/appliance/v3/terms/energy-rating": {
        requirements: {
          Home: "mandatory_espr_jtc24",
          Industrial: "voluntary",
        },
      },
    },
  });

  return {
    registry: createSemanticModelRegistry({ resourcesDir }),
    cleanup: () => fs.rmSync(resourcesDir, { recursive: true, force: true }),
  };
}

function createApplianceTypeDef() {
  return {
    typeName: "appliancePassportV3",
    displayName: "Appliance Passport v3",
    productCategory: "Appliance",
    semanticModelKey: "claros_appliance_dictionary_v3",
    complianceProfile: {
      key: "applianceDppV3",
      contentSpecificationIds: ["claros_appliance_dictionary_v3"],
      categoryPolicy: {
        kind: "semanticCategory",
        productKind: "appliance",
        label: "appliance class",
        semanticId: "https://example.test/dictionary/appliance/v3/terms/appliance-class",
      },
    },
    fieldsJson: {
      sections: [{
        key: "applianceIdentity",
        fields: [
          {
            key: "applianceClass",
            label: "Appliance Class",
            type: "text",
            semanticId: "https://example.test/dictionary/appliance/v3/terms/appliance-class",
            objectType: "SingleValuedDataElement",
            valueDataType: "String",
          },
          {
            key: "energyRating",
            label: "Energy Rating",
            type: "text",
            semanticId: "https://example.test/dictionary/appliance/v3/terms/energy-rating",
            objectType: "SingleValuedDataElement",
            valueDataType: "String",
          },
        ],
      }],
    },
  };
}

test("canonical serializer resolves terms from the selected non-battery semantic model", () => {
  const serializer = createCanonicalPassportSerializer({
    didService: createDidService(),
    productIdentifierService: createProductIdentifierService(),
    semanticModelRegistry: createSemanticModelRegistry(),
  });
  const typeDef = createTextileTypeDef();
  const passport = {
    passportType: "textilePassportV1",
    dppId: "TEX-DPP-001",
    lineageId: "TEX-LINEAGE-001",
    companyId: 42,
    internalAliasId: "STYLE-001",
    releaseStatus: "released",
    updatedAt: "2026-06-02T08:00:00.000Z",
    contentSpecificationIds: ["claros_textile_dictionary_v1"],
    economicOperatorId: "EORI-TEXTILE-001",
    fiberComposition: "80% cotton, 20% recycled polyester",
    recycledContentPercentage: "20.5",
  };

  const canonical = serializer.buildCanonicalPassportPayload(passport, typeDef, {
    company: {
      id: 42,
      companyName: "Nordic Textiles",
      didSlug: "nordic-textiles",
      economicOperatorIdentifier: "EORI-TEXTILE-001",
    },
  });

  assert.equal(canonical.fields.fiberComposition, "80% cotton, 20% recycled polyester");
  assert.equal(canonical.fields.recycledContentPercentage, 20.5);
  assert.deepEqual(canonical.extensions.claros.validationIssues || [], []);

  const expanded = serializer.buildExpandedPassportPayload(passport, typeDef, {
    company: {
      id: 42,
      companyName: "Nordic Textiles",
      didSlug: "nordic-textiles",
      economicOperatorIdentifier: "EORI-TEXTILE-001",
    },
  });
  const recycledElement = expanded.elements.find((element) => element.elementId === "recycledContentPercentage");

  assert.equal(
    recycledElement.dictionaryReference,
    "https://www.claros-dpp.online/dictionary/textile/v1/terms/recycled-content-percentage"
  );
  assert.equal(recycledElement.valueDataType, "Decimal");
  assert.equal(recycledElement.value, 20.5);
});

test("canonical serializer applies arbitrary semantic category policies", () => {
  const { registry, cleanup } = createApplianceRegistryFixture();
  try {
    const serializer = createCanonicalPassportSerializer({
      didService: createDidService(),
      productIdentifierService: createProductIdentifierService(),
      semanticModelRegistry: registry,
    });
    const canonical = serializer.buildCanonicalPassportPayload({
      passportType: "appliancePassportV3",
      dppId: "APP-DPP-001",
      internalAliasId: "APP-001",
      releaseStatus: "released",
      updatedAt: "2026-06-02T08:00:00.000Z",
      applianceClass: "Home",
    }, createApplianceTypeDef(), {
      company: {
        id: 43,
        companyName: "Appliance Maker",
        didSlug: "appliance-maker",
        economicOperatorIdentifier: "EORI-APP-001",
      },
    });

    const missingEnergyRating = canonical.extensions.claros.validationIssues.find((issue) =>
      issue.key === "energyRating"
    );
    assert.equal(missingEnergyRating.code, "CATEGORY_REQUIRED_FIELD_MISSING");
    assert.equal(missingEnergyRating.category, "Home");
    assert.match(missingEnergyRating.message, /appliance class "Home"/);
    assert.deepEqual(canonical.extensions.claros.validation.category, {
      raw: "Home",
      normalized: "Home",
      supported: ["Home", "Industrial"],
      policyKind: "semanticCategory",
      productKind: "appliance",
    });
  } finally {
    cleanup();
  }
});
