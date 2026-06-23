"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { updateEditablePassportUseCase } = require("../src/modules/passports/application/update-passport");

function createHarness() {
  let capturedUpdateData = null;
  const currentPassport = {
    id: 22,
    dppId: "dppRegularPatchTest",
    lineageId: "dppRegularPatchTest",
    companyId: 7,
    passportType: "medicalDevicePassportV1",
    releaseStatus: "draft",
    granularity: "item",
    internalAliasId: "MD-REGULAR-001",
    uniqueProductIdentifier: "did:web:example.test:did:medical-device-passport-v1:item:md-regular-001",
    passportPolicyKey: "wrongProfile",
    contentSpecificationIds: JSON.stringify(["wrongSpec"]),
    carrierPolicyKey: "wrongCarrier",
    economicOperatorId: "EORI-OLD",
    economicOperatorIdentifierScheme: "EORI",
    facilityId: null,
    manufacturer: "Original Manufacturer",
  };

  const updateEditablePassport = updateEditablePassportUseCase({
    pool: {
      query: async () => ({ rows: [currentPassport] }),
    },
    normalizePassportRequestBody: (body) => body || {},
    getPassportTypeSchema: async () => ({
      typeName: "medicalDevicePassportV1",
      allowedKeys: new Set(["manufacturer"]),
    }),
    createPassportTable: async () => {},
    getTable: () => "medicalDevicePassports",
    VALID_GRANULARITIES: new Set(["model", "batch", "item"]),
    EDITABLE_RELEASE_STATUSES_SQL: "('draft', 'inRevision')",
    hasReleasedLineageVersion: async () => false,
    normalizeInternalAliasIdValue: (value) => String(value || "").trim(),
    buildStoredProductIdentifiers: ({ internalAliasId }) => ({
      internalAliasId,
      uniqueProductIdentifier: `did:web:example.test:did:medical-device-passport-v1:item:${internalAliasId}`,
    }),
    findExistingPassportByInternalAliasId: async () => null,
    normalizeReleaseStatus: (status) => status,
    getCompanyNameMap: async () => new Map([["7", "Acme Devices"]]),
    maybeSignCarrierPayload: async ({ metadata }) => metadata,
    applyCarrierAuthenticityMutation: (_current, mutation) => mutation,
    buildCarrierAuthenticityStorageValue: (value) => value ? JSON.stringify(value) : null,
    extractCarrierAuthenticityMutation: () => ({ provided: false }),
    buildComplianceManagedFields: async () => ({
      passportPolicyKey: "medicalDeviceDppV1",
      contentSpecificationIds: JSON.stringify(["medicalDeviceDictionaryV1"]),
      carrierPolicyKey: "webPublicEntryV1",
      economicOperatorId: "EORI-ACME-001",
      economicOperatorIdentifierScheme: "EORI",
      facilityId: "PLANT-01",
    }),
    archivePassportSnapshot: async () => {},
    updatePassportRowById: async ({ data }) => {
      capturedUpdateData = data;
      return {
        updateCols: Object.keys(data),
        updatedRow: { ...currentPassport, ...data },
      };
    },
    logAudit: async () => {},
    getActorIdentifier: () => "user:9",
    normalizePassportRow: (row) => row,
  });

  return {
    getCapturedUpdateData: () => capturedUpdateData,
    updateEditablePassport,
  };
}

test("regular passport update reconciles policy-owned fields from managed policy fields", async () => {
  const { getCapturedUpdateData, updateEditablePassport } = createHarness();

  const result = await updateEditablePassport({
    req: {
      params: {
        companyId: "7",
        dppId: "dppRegularPatchTest",
      },
      user: { userId: 9, companyId: 7, role: "companyAdmin" },
      body: {
        passportType: "medicalDevicePassportV1",
        passportPolicyKey: "clientSuppliedProfile",
        contentSpecificationIds: ["clientSuppliedSpec"],
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(getCapturedUpdateData().passportPolicyKey, "medicalDeviceDppV1");
  assert.equal(getCapturedUpdateData().contentSpecificationIds, JSON.stringify(["medicalDeviceDictionaryV1"]));
  assert.equal(result.passport.passportPolicyKey, "medicalDeviceDppV1");
  assert.equal(result.passport.contentSpecificationIds, JSON.stringify(["medicalDeviceDictionaryV1"]));
});
