"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { updateEditablePassportUseCase } = require("../src/modules/passports/application/update-passport");

function createHarness() {
  let capturedUpdateData = null;
  const currentPassport = {
    id: 22,
    dppId: "dpp_regular_patch_test",
    lineageId: "dpp_regular_patch_test",
    companyId: 7,
    passportType: "batteryPassportV1",
    releaseStatus: "draft",
    granularity: "item",
    internalAliasId: "BAT-REGULAR-001",
    uniqueProductIdentifier: "did:web:example.test:did:battery-passport-v1:item:bat-regular-001",
    complianceProfileKey: "wrong_profile",
    contentSpecificationIds: JSON.stringify(["wrong_spec"]),
    carrierPolicyKey: "wrong_carrier",
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
      typeName: "batteryPassportV1",
      allowedKeys: new Set(["manufacturer"]),
    }),
    createPassportTable: async () => {},
    getTable: () => "battery_passports",
    VALID_GRANULARITIES: new Set(["model", "batch", "item"]),
    EDITABLE_RELEASE_STATUSES_SQL: "('draft', 'in_revision')",
    hasReleasedLineageVersion: async () => false,
    normalizeInternalAliasIdValue: (value) => String(value || "").trim(),
    buildStoredProductIdentifiers: ({ internalAliasId }) => ({
      internalAliasId,
      uniqueProductIdentifier: `did:web:example.test:did:battery-passport-v1:item:${internalAliasId}`,
    }),
    findExistingPassportByInternalAliasId: async () => null,
    normalizeReleaseStatus: (status) => status,
    getCompanyNameMap: async () => new Map([["7", "Acme Batteries"]]),
    maybeSignCarrierPayload: async ({ metadata }) => metadata,
    applyCarrierAuthenticityMutation: (_current, mutation) => mutation,
    buildCarrierAuthenticityStorageValue: (value) => value ? JSON.stringify(value) : null,
    extractCarrierAuthenticityMutation: () => ({ provided: false }),
    buildComplianceManagedFields: async () => ({
      complianceProfileKey: "batteryDppV1",
      contentSpecificationIds: JSON.stringify(["claros_battery_dictionary_v1"]),
      carrierPolicyKey: "battery_qr_public_entry_v1",
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

test("regular passport update reconciles profile-owned fields from managed compliance fields", async () => {
  const { getCapturedUpdateData, updateEditablePassport } = createHarness();

  const result = await updateEditablePassport({
    req: {
      params: {
        companyId: "7",
        dppId: "dpp_regular_patch_test",
      },
      user: { userId: 9, companyId: 7, role: "company_admin" },
      body: {
        passportType: "batteryPassportV1",
        complianceProfileKey: "client_supplied_profile",
        contentSpecificationIds: ["client_supplied_spec"],
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(getCapturedUpdateData().complianceProfileKey, "batteryDppV1");
  assert.equal(getCapturedUpdateData().contentSpecificationIds, JSON.stringify(["claros_battery_dictionary_v1"]));
  assert.equal(result.passport.complianceProfileKey, "batteryDppV1");
  assert.equal(result.passport.contentSpecificationIds, JSON.stringify(["claros_battery_dictionary_v1"]));
});
