"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { updateDppUseCase } = require("../src/modules/dpp-api/application/update-dpp");

function createResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
  };
}

function createUseCaseHarness() {
  let capturedUpdateData = null;
  const editable = {
    tableName: "battery_passports",
    typeDef: {
      typeName: "batteryPassportV1",
      productCategory: "Battery",
      semanticModelKey: "battery_dictionary_v1",
      fieldsJson: {
        sourceModule: "battery:v1",
        sections: [{
          fields: [
            { key: "manufacturer", type: "text" },
          ],
        }],
      },
    },
    passport: {
      id: 101,
      dppId: "dpp_patch_test",
      lineageId: "dpp_patch_test",
      companyId: 7,
      passportType: "batteryPassportV1",
      releaseStatus: "draft",
      granularity: "item",
      internalAliasId: "BAT-PATCH-001",
      uniqueProductIdentifier: "did:web:example.test:did:battery-passport-v1:item:bat-patch-001",
      passportPolicyKey: "wrong_profile",
      contentSpecificationIds: JSON.stringify(["wrong_spec"]),
      manufacturer: "Original Manufacturer",
    },
  };

  const updateDpp = updateDppUseCase({
    pool: {
      query: async () => ({ rows: [] }),
    },
    normalizePassportRequestBody: (body) => body || {},
    normalizeInternalAliasIdValue: (value) => String(value || "").trim(),
    resolveEditablePassportByDppId: async () => editable,
    isEditablePassportStatus: (status) => status === "draft" || status === "in_revision",
    getCompanyNameMap: async () => new Map([["7", "Acme Batteries"]]),
    archivePassportSnapshot: async () => {},
    updatePassportRowById: async ({ data }) => {
      capturedUpdateData = data;
      return {
        updateCols: Object.keys(data),
        updatedRow: { ...editable.passport, ...data },
      };
    },
    logAudit: async () => {},
    findExistingPassportByInternalAliasId: async () => null,
    productIdentifierService: {
      normalizeProductIdentifiers: ({ rawProductId, uniqueProductIdentifier }) => ({
        internalAliasIdInput: rawProductId,
        productIdentifierDid: uniqueProductIdentifier || `did:web:example.test:did:battery-passport-v1:item:${rawProductId}`,
      }),
      extractBusinessProductIdentifier: () => null,
    },
    complianceService: {
      resolvePassportPolicyMetadata: () => ({
        key: "batteryDppV1",
        contentSpecificationIds: ["Battery_dictionary_v1"],
      }),
    },
    SYSTEM_PASSPORT_FIELDS: new Set(["dppId", "lineageId", "releaseStatus"]),
    getWritablePassportColumns: (data) => Object.keys(data || {}),
    toStoredPassportValue: (value) => value,
    extractCarrierAuthenticityMutation: () => ({ provided: false }),
    applyCarrierAuthenticityMutation: () => null,
    extractExplicitFacilityId: (source) => source?.facilityId || null,
    VALID_GRANULARITIES: new Set(["model", "batch", "item"]),
    buildMutationPassportPayload: (passport) => ({
      fields: {
        passportPolicyKey: passport.passportPolicyKey,
        contentSpecificationIds: passport.contentSpecificationIds,
        manufacturer: passport.manufacturer,
      },
    }),
    getActorIdentifier: () => "user:9",
    replicatePassportToBackup: async () => {},
    buildDppIdentifierFields: (passport) => ({
      digitalProductPassportId: passport.dppId,
      dppId: passport.dppId,
    }),
    setDppMergePatchHeaders: (res) => {
      res.setHeader("Accept-Patch", "application/merge-patch+json, application/json");
    },
    isSupportedPatchContentType: () => true,
    parseDppIdentifier: () => ({ type: "dpp" }),
    serializePolicyDefaultValue: (value) => Array.isArray(value) ? JSON.stringify(value) : value ?? null,
    resolveManagedFacilityId: async ({ requestedFields }) => requestedFields.facilityId || null,
    MERGE_PATCH_CONTENT_TYPE: "application/merge-patch+json",
    usesConfiguredGlobalProductIdentifierScheme: (value) => String(value || "").startsWith("did:"),
  });

  return {
    getCapturedUpdateData: () => capturedUpdateData,
    updateDpp,
  };
}

test("standards PATCH reconciles policy-owned fields from the passport type", async () => {
  const { getCapturedUpdateData, updateDpp } = createUseCaseHarness();
  const result = await updateDpp({
    req: {
      params: { dppId: "dpp_patch_test" },
      query: {},
      body: {
        passportPolicyKey: "client_supplied_profile",
        contentSpecificationIds: ["client_supplied_spec"],
      },
      user: { userId: 9, companyId: 7, role: "company_admin" },
    },
    res: createResponse(),
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(getCapturedUpdateData(), {
    passportPolicyKey: "batteryDppV1",
    contentSpecificationIds: JSON.stringify(["Battery_dictionary_v1"]),
  });
  assert.deepEqual(result.body.updatedFields, ["passportPolicyKey", "contentSpecificationIds"]);
  assert.equal(result.body.passport.fields.passportPolicyKey, "batteryDppV1");
  assert.equal(result.body.passport.fields.contentSpecificationIds, JSON.stringify(["Battery_dictionary_v1"]));
});
