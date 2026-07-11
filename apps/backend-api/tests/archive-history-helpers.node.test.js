"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createArchiveHistoryHelpers } = require("../src/modules/passports/archive-history-helpers");

function createHistoryHelpers(queryLog, versionsOverride = null) {
  const versions = versionsOverride || [
    {
      dppId: "dppId-history-1",
      companyId: 7,
      versionNumber: 2,
      releaseStatus: "released",
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z",
      createdBy: 11,
      internalAliasId: "private-alias-new",
      publicField: "new-public",
      restrictedField: "new-secret",
      unclassifiedField: "new-unclassified",
    },
    {
      dppId: "dppId-history-1",
      companyId: 7,
      versionNumber: 1,
      releaseStatus: "released",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      createdBy: 11,
      internalAliasId: "private-alias-old",
      publicField: "old-public",
      restrictedField: "old-secret",
      unclassifiedField: "old-unclassified",
    },
  ];

  return createArchiveHistoryHelpers({
    pool: {
      query: async (sql) => {
        queryLog.push(sql);
        if (sql.includes('FROM "passportTypes"')) {
          return { rows: [{ displayName: "Test passport", fieldsJson: {} }] };
        }
        if (sql.includes('FROM users')) {
          return {
            rows: [{
              id: 11,
              firstName: "Private",
              lastName: "Editor",
              email: "private@example.test",
            }],
          };
        }
        if (sql.includes('FROM "passportHistoryVisibility"')) return { rows: [] };
        return { rows: [] };
      },
    },
    logger: null,
    systemPassportFields: [],
    getWritablePassportColumns: () => [],
    getStoredPassportValues: () => [],
    quoteSqlIdentifier: (value) => value,
    normalizePassportRow: (value) => value,
    normalizeReleaseStatus: (value) => value,
    isPublicHistoryStatus: (value) => ["released", "obsolete"].includes(value),
    comparableHistoryFieldValue: (_field, value) => JSON.stringify(value),
    formatHistoryFieldValue: (_field, value) => value,
    getHistoryFieldDefs: () => [
      { key: "internalAliasId", label: "Internal alias", confidentiality: "public" },
      { key: "publicField", label: "Public field", confidentiality: "public" },
      { key: "restrictedField", label: "Restricted field", confidentiality: "restricted" },
      { key: "unclassifiedField", label: "Unclassified field" },
    ],
    buildCurrentPublicPassportPath: ({ dppId }) => `/dpp/${dppId}`,
    buildInactivePublicPassportPath: ({ dppId, versionNumber }) => `/dpp/${dppId}/${versionNumber}`,
    getPassportLineageContext: async () => ({ lineageId: "lineage-1" }),
    getPassportVersionsByLineage: async () => versions,
    getCompanyNameMap: async () => new Map([["7", "Example Company"]]),
  });
}

test("public passport history excludes restricted changes and creator identity", async () => {
  const queryLog = [];
  const helpers = createHistoryHelpers(queryLog);
  const result = await helpers.buildPassportVersionHistory({
    dppId: "dppId-history-1",
    passportType: "test",
    publicOnly: true,
  });

  assert.deepEqual(result.history[0].changedFields, [{
    key: "publicField",
    label: "Public field",
    before: "old-public",
    after: "new-public",
  }]);
  assert.equal(Object.hasOwn(result.history[0], "createdByName"), false);
  assert.equal(queryLog.some((sql) => sql.includes("FROM users")), false);
});

test("security group history includes only selected restricted changes", async () => {
  const queryLog = [];
  const helpers = createHistoryHelpers(queryLog);
  const result = await helpers.buildPassportVersionHistory({
    dppId: "dppId-history-1",
    passportType: "test",
    publicOnly: true,
    allowedRestrictedFieldKeys: ["restrictedField"],
    allowedRestrictedPassportDppIds: ["dppId-history-1"],
  });

  assert.deepEqual(
    result.history[0].changedFields.map((field) => field.key),
    ["publicField", "restrictedField"]
  );
  assert.equal(Object.hasOwn(result.history[0], "createdByName"), false);
  assert.equal(queryLog.some((sql) => sql.includes("FROM users")), false);
});

test("unique-passport history does not reveal restricted predecessor values outside its DPP scope", async () => {
  const queryLog = [];
  const versions = [
    {
      dppId: "dppId-new",
      companyId: 7,
      versionNumber: 2,
      releaseStatus: "released",
      publicField: "new-public",
      restrictedField: "new-secret",
    },
    {
      dppId: "dppId-old",
      companyId: 7,
      versionNumber: 1,
      releaseStatus: "released",
      publicField: "old-public",
      restrictedField: "old-secret",
    },
  ];
  const helpers = createHistoryHelpers(queryLog, versions);
  const result = await helpers.buildPassportVersionHistory({
    dppId: "dppId-new",
    passportType: "test",
    publicOnly: true,
    allowedRestrictedFieldKeys: ["restrictedField"],
    allowedRestrictedPassportDppIds: ["dppId-new"],
  });

  assert.deepEqual(
    result.history[0].changedFields.map((field) => field.key),
    ["publicField"]
  );
});

test("authenticated passport history retains restricted changes and creator identity", async () => {
  const queryLog = [];
  const helpers = createHistoryHelpers(queryLog);
  const result = await helpers.buildPassportVersionHistory({
    dppId: "dppId-history-1",
    passportType: "test",
    companyId: 7,
    publicOnly: false,
  });

  assert.deepEqual(
    result.history[0].changedFields.map((field) => field.key),
    ["internalAliasId", "publicField", "restrictedField", "unclassifiedField"]
  );
  assert.equal(result.history[0].createdByName, "Private Editor");
});
