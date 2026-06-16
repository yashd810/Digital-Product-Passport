"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const createCanonicalPassportSerializer = require("../src/services/canonicalPassportSerializer");
const createSemanticModelRegistry = require("../src/services/semantic-model-registry");

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
    semanticModelKey: "textile_dictionary_v1",
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
    contentSpecificationIds: ["Textile_dictionary_v1"],
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
  assert.deepEqual(canonical.extensions.platform.validationIssues || [], []);

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
