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

function createExampleProductTypeDef() {
  const rootClassIri = "https://www.claros-dpp.online/dictionary/example-product/v1/classes/ExampleProductPassport";
  const graphProperties = [
    {
      key: "deviceMaterial",
      label: "Device Material",
      semanticId: "https://www.claros-dpp.online/dictionary/example-product/v1/terms/device-material",
      domainClassKey: "exampleProductPassport",
      domainClassIri: rootClassIri,
      rangeKind: "scalar",
      dataType: "string",
      minCount: 0,
      maxCount: 1,
    },
    {
      key: "sterilizationCycles",
      label: "Sterilization Cycles",
      semanticId: "https://www.claros-dpp.online/dictionary/example-product/v1/terms/sterilization-cycles",
      domainClassKey: "exampleProductPassport",
      domainClassIri: rootClassIri,
      rangeKind: "scalar",
      dataType: "integer",
      minCount: 0,
      maxCount: 1,
    },
  ];
  return {
    typeName: "exampleProductPassportV1",
    displayName: "Example Product Passport v1",
    productCategory: "Example Product",
    semanticModelKey: "exampleProductDictionaryV1",
    fieldsJson: {
      semanticGraph: {
        schemaVersion: 1,
        rootClassKey: "exampleProductPassport",
        classes: [{
          key: "exampleProductPassport",
          label: "Example Product Passport",
          semanticId: rootClassIri,
          root: true,
          properties: graphProperties,
        }],
        enums: [],
      },
      sections: [{
        key: "deviceIdentity",
        fields: [
          {
            key: "deviceMaterial",
            label: "Device Material",
            type: "text",
            dataType: "string",
            semanticId: "https://www.claros-dpp.online/dictionary/example-product/v1/terms/device-material",
            domainClassKey: "exampleProductPassport",
            domainClassIri: rootClassIri,
            rangeKind: "scalar",
            rangeIri: "http://www.w3.org/2001/XMLSchema#string",
            minCount: 0,
            maxCount: 1,
            objectType: "SingleValuedDataElement",
            valueDataType: "String",
          },
          {
            key: "sterilizationCycles",
            label: "Sterilization Cycles",
            type: "text",
            dataType: "integer",
            semanticId: "https://www.claros-dpp.online/dictionary/example-product/v1/terms/sterilization-cycles",
            domainClassKey: "exampleProductPassport",
            domainClassIri: rootClassIri,
            rangeKind: "scalar",
            rangeIri: "http://www.w3.org/2001/XMLSchema#integer",
            minCount: 0,
            maxCount: 1,
            objectType: "SingleValuedDataElement",
            valueDataType: "Integer",
          },
        ],
      }],
    },
  };
}

test("canonical serializer resolves terms from explicit semantic field metadata", () => {
  const serializer = createCanonicalPassportSerializer({
    didService: createDidService(),
    productIdentifierService: createProductIdentifierService(),
    semanticModelRegistry: createSemanticModelRegistry(),
  });
  const typeDef = createExampleProductTypeDef();
  const passport = {
    passportType: "exampleProductPassportV1",
    dppId: "MD-DPP-001",
    lineageId: "MD-LINEAGE-001",
    companyId: 42,
    internalAliasId: "DEVICE-001",
    releaseStatus: "released",
    updatedAt: "2026-06-02T08:00:00.000Z",
    contentSpecificationIds: ["exampleProductDictionaryV1"],
    economicOperatorId: "EORI-EXAMPLE-001",
    deviceMaterial: "Surgical steel",
    sterilizationCycles: "12",
  };

  const canonical = serializer.buildCanonicalPassportPayload(passport, typeDef, {
    company: {
      id: 42,
      companyName: "Nordic Devices",
      didSlug: "nordic-devices",
      economicOperatorIdentifier: "EORI-EXAMPLE-001",
    },
  });

  assert.equal(canonical.fields.deviceMaterial, "Surgical steel");
  assert.equal(canonical.fields.sterilizationCycles, 12);
  assert.deepEqual(canonical.extensions.platform.validationIssues || [], []);

  const expanded = serializer.buildExpandedPassportPayload(passport, typeDef, {
    company: {
      id: 42,
      companyName: "Nordic Devices",
      didSlug: "nordic-devices",
      economicOperatorIdentifier: "EORI-EXAMPLE-001",
    },
  });
  const cyclesElement = expanded.elements.find((element) => element.elementId === "sterilizationCycles");

  assert.equal(
    cyclesElement.dictionaryReference,
    "https://www.claros-dpp.online/dictionary/example-product/v1/terms/sterilization-cycles"
  );
  assert.equal(cyclesElement.valueDataType, "Integer");
  assert.equal(cyclesElement.value, 12);
});
