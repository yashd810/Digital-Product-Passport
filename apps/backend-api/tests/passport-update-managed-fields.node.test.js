"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { updateEditablePassportUseCase } = require("../src/modules/passports/application/update-passport");

function createHarness() {
  let capturedUpdateData = null;
  const queries = [];
  const storageReadinessCalls = [];
  let ddlCalls = 0;
  const currentPassport = {
    id: 22,
    dppId: "dppRegularPatchTest",
    lineageId: "dppRegularPatchTest",
    companyId: 7,
    passportType: "exampleProductPassportV1",
    releaseStatus: "draft",
    granularity: "item",
    internalAliasId: "MD-REGULAR-001",
    uniqueProductIdentifier: "did:web:example.test:did:example-product-passport-v1:item:md-regular-001",
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
      query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [currentPassport] };
      },
    },
    normalizePassportRequestBody: (body) => body || {},
    getPassportTypeSchema: async () => ({
      typeName: "exampleProductPassportV1",
      allowedKeys: new Set(["manufacturer"]),
    }),
    createPassportTable: async () => { ddlCalls += 1; },
    assertPassportTypeStorageReady: async (typeName) => storageReadinessCalls.push(typeName),
    getTable: () => "exampleProductPassports",
    validGranularities: new Set(["model", "batch", "item"]),
    editableReleaseStatusesSql: "('draft', 'inRevision')",
    hasReleasedLineageVersion: async () => false,
    normalizeInternalAliasIdValue: (value) => String(value || "").trim(),
    buildStoredProductIdentifiers: ({ internalAliasId }) => ({
      internalAliasId,
      uniqueProductIdentifier: `did:web:example.test:did:example-product-passport-v1:item:${internalAliasId}`,
    }),
    findExistingPassportByInternalAliasId: async () => null,
    normalizeReleaseStatus: (status) => status,
    getCompanyNameMap: async () => new Map([["7", "Acme Devices"]]),
    maybeSignCarrierPayload: async ({ metadata }) => metadata,
    applyCarrierAuthenticityMutation: (_current, mutation) => mutation,
    buildCarrierAuthenticityStorageValue: (value) => value ? JSON.stringify(value) : null,
    extractCarrierAuthenticityMutation: () => ({ provided: false }),
    buildComplianceManagedFields: async () => ({
      passportPolicyKey: "exampleProductDppV1",
      contentSpecificationIds: JSON.stringify(["exampleProductDictionaryV1"]),
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
    getQueries: () => queries,
    getStorageReadinessCalls: () => storageReadinessCalls,
    getDdlCalls: () => ddlCalls,
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
        passportType: "exampleProductPassportV1",
        passportPolicyKey: "clientSuppliedProfile",
        contentSpecificationIds: ["clientSuppliedSpec"],
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(getCapturedUpdateData().passportPolicyKey, "exampleProductDppV1");
  assert.equal(getCapturedUpdateData().contentSpecificationIds, JSON.stringify(["exampleProductDictionaryV1"]));
  assert.equal(result.passport.passportPolicyKey, "exampleProductDppV1");
  assert.equal(result.passport.contentSpecificationIds, JSON.stringify(["exampleProductDictionaryV1"]));
});

test("regular passport updates scope the editable-record lookup to the route company", async () => {
  const { getQueries, updateEditablePassport } = createHarness();

  await updateEditablePassport({
    req: {
      params: { companyId: "7", dppId: "dppRegularPatchTest" },
      user: { userId: 9, companyId: 7, role: "companyAdmin" },
      body: { passportType: "exampleProductPassportV1" },
    },
  });

  assert.match(
    getQueries()[0].sql,
    /WHERE "dppId" = \$1\s+AND "companyId" = \$2\s+AND "releaseStatus" IN/
  );
  assert.deepEqual(getQueries()[0].params, ["dppRegularPatchTest", "7"]);
});

test("regular passport updates verify storage readiness without reconciling schema at request time", async () => {
  const { getDdlCalls, getStorageReadinessCalls, updateEditablePassport } = createHarness();

  await updateEditablePassport({
    req: {
      params: { companyId: "7", dppId: "dppRegularPatchTest" },
      user: { userId: 9, companyId: 7, role: "companyAdmin" },
      body: { passportType: "exampleProductPassportV1" },
    },
  });

  assert.deepEqual(getStorageReadinessCalls(), ["exampleProductPassportV1"]);
  assert.equal(getDdlCalls(), 0);
});
