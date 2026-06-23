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
    tableName: "medicalDevicePassports",
    typeDef: {
      typeName: "medicalDevicePassportV1",
      productCategory: "Medical Device",
      semanticModelKey: "medicalDeviceDictionaryV1",
      fieldsJson: {
        sourceModule: "medical-device:v1",
        sections: [{
          fields: [
            { key: "manufacturer", type: "text" },
          ],
        }],
      },
    },
    passport: {
      id: 101,
      dppId: "dppPatchTest",
      lineageId: "dppPatchTest",
      companyId: 7,
      passportType: "medicalDevicePassportV1",
      releaseStatus: "draft",
      granularity: "item",
      internalAliasId: "MD-PATCH-001",
      uniqueProductIdentifier: "did:web:example.test:did:medical-device-passport-v1:item:md-patch-001",
      passportPolicyKey: "wrongProfile",
      contentSpecificationIds: JSON.stringify(["wrongSpec"]),
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
    isEditablePassportStatus: (status) => status === "draft" || status === "inRevision",
    getCompanyNameMap: async () => new Map([["7", "Acme Devices"]]),
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
        productIdentifierDid: uniqueProductIdentifier || `did:web:example.test:did:medical-device-passport-v1:item:${rawProductId}`,
      }),
      extractBusinessProductIdentifier: () => null,
    },
    complianceService: {
      resolvePassportPolicyMetadata: () => ({
        key: "medicalDeviceDppV1",
        contentSpecificationIds: ["medicalDeviceDictionaryV1"],
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
      params: { dppId: "dppPatchTest" },
      query: {},
      body: {
        passportPolicyKey: "clientSuppliedProfile",
        contentSpecificationIds: ["clientSuppliedSpec"],
      },
      user: { userId: 9, companyId: 7, role: "companyAdmin" },
    },
    res: createResponse(),
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(getCapturedUpdateData(), {
    passportPolicyKey: "medicalDeviceDppV1",
    contentSpecificationIds: JSON.stringify(["medicalDeviceDictionaryV1"]),
  });
  assert.deepEqual(result.body.updatedFields, ["passportPolicyKey", "contentSpecificationIds"]);
  assert.equal(result.body.passport.fields.passportPolicyKey, "medicalDeviceDppV1");
  assert.equal(result.body.passport.fields.contentSpecificationIds, JSON.stringify(["medicalDeviceDictionaryV1"]));
});
