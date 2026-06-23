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

function createMedicalDeviceTypeDef() {
  return {
    typeName: "medicalDevicePassportV1",
    displayName: "Medical Device Passport v1",
    productCategory: "Medical Device",
    semanticModelKey: "medicalDeviceDictionaryV1",
    fieldsJson: {
      sections: [{
        key: "deviceIdentity",
        fields: [
          {
            key: "deviceMaterial",
            label: "Device Material",
            type: "text",
            semanticId: "https://www.claros-dpp.online/dictionary/medical-device/v1/terms/device-material",
            objectType: "SingleValuedDataElement",
            valueDataType: "String",
          },
          {
            key: "sterilizationCycles",
            label: "Sterilization Cycles",
            type: "text",
            semanticId: "https://www.claros-dpp.online/dictionary/medical-device/v1/terms/sterilization-cycles",
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
  const typeDef = createMedicalDeviceTypeDef();
  const passport = {
    passportType: "medicalDevicePassportV1",
    dppId: "MD-DPP-001",
    lineageId: "MD-LINEAGE-001",
    companyId: 42,
    internalAliasId: "DEVICE-001",
    releaseStatus: "released",
    updatedAt: "2026-06-02T08:00:00.000Z",
    contentSpecificationIds: ["medicalDeviceDictionaryV1"],
    economicOperatorId: "EORI-MEDICAL-001",
    deviceMaterial: "Surgical steel",
    sterilizationCycles: "12",
  };

  const canonical = serializer.buildCanonicalPassportPayload(passport, typeDef, {
    company: {
      id: 42,
      companyName: "Nordic Devices",
      didSlug: "nordic-devices",
      economicOperatorIdentifier: "EORI-MEDICAL-001",
    },
  });

  assert.equal(canonical.fields.deviceMaterial, "Surgical steel");
  assert.equal(canonical.fields.sterilizationCycles, "12");
  assert.deepEqual(canonical.extensions.platform.validationIssues || [], []);

  const expanded = serializer.buildExpandedPassportPayload(passport, typeDef, {
    company: {
      id: 42,
      companyName: "Nordic Devices",
      didSlug: "nordic-devices",
      economicOperatorIdentifier: "EORI-MEDICAL-001",
    },
  });
  const cyclesElement = expanded.elements.find((element) => element.elementId === "sterilizationCycles");

  assert.equal(
    cyclesElement.dictionaryReference,
    "https://www.claros-dpp.online/dictionary/medical-device/v1/terms/sterilization-cycles"
  );
  assert.equal(cyclesElement.valueDataType, "Integer");
  assert.equal(cyclesElement.value, "12");
});
