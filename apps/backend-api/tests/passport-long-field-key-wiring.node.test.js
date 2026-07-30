"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createDraftPassportUseCase } = require("../src/modules/passports/application/create-passport");
const { updateEditablePassportUseCase } = require("../src/modules/passports/application/update-passport");
const registerLifecycleRoutes = require("../src/modules/passports/register-lifecycle-routes");
const registerBulkLifecycleRoutes = require("../src/modules/passports/register-bulk-lifecycle-routes");
const registerCompanyPassportReadRoutes = require("../src/modules/passports/register-company-passport-read-routes");
const { createPassportQueryRepository } = require("../src/modules/passports/passport-query-repository");
const { createComplianceHelpers } = require("../src/modules/passports/compliance-helpers");
const {
  getStoredPassportValues,
  getWritablePassportColumns,
  joinQuotedSqlIdentifiers,
  normalizePassportRow,
  systemPassportFields,
  toPassportStorageColumnKey,
  toStoredPassportValue,
} = require("../src/shared/passports/passport-helpers");

const longFieldKey = `componentMaterialDeclaration${"Traceability".repeat(8)}`;
const physicalFieldKey = toPassportStorageColumnKey(longFieldKey);
const typeSchema = {
  typeName: "batteryPassportV1",
  allowedKeys: new Set([longFieldKey]),
  schemaFields: [{ key: longFieldKey, type: "text", required: true }],
  fieldsJson: {
    sections: [{ key: "details", fields: [{ key: longFieldKey, type: "text", required: true }] }],
  },
};

function createRouteApp() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "patch"]) {
    app[method] = (routePath, ...handlers) => routes.push({ method, routePath, handlers });
  }
  return { app, routes };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

const noopMiddleware = (_req, _res, next) => next?.();

test("draft create stores a long logical key physically and returns and archives the logical key", async () => {
  let insertQuery = null;
  let archivedPassport = null;
  const rawInserted = {
    id: 41,
    dppId: "dpp-long-create",
    lineageId: "dpp-long-create",
    companyId: 7,
    internalAliasId: "BAT-001",
    uniqueProductIdentifier: "did:example:BAT-001",
    releaseStatus: "draft",
    versionNumber: 1,
    granularity: "item",
    [physicalFieldKey]: "created value",
  };
  const client = {
    async query(sql) {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      insertQuery = sql;
      return { rows: [rawInserted] };
    },
    release() {},
  };
  const createDraftPassport = createDraftPassportUseCase({
    pool: { connect: async () => client },
    generateDppRecordId: () => "dpp-long-create",
    normalizeInternalAliasIdValue: (value) => String(value || "").trim(),
    generateInternalAliasIdValue: (dppId) => dppId,
    findExistingPassportByInternalAliasId: async () => null,
    resolveGranularityForCreate: () => "item",
    buildStoredProductIdentifiers: ({ internalAliasId }) => ({
      internalAliasId,
      uniqueProductIdentifier: `did:example:${internalAliasId}`,
    }),
    buildComplianceManagedFields: async () => ({
      passportPolicyKey: "policy",
      contentSpecificationIds: "[]",
      carrierPolicyKey: null,
      economicOperatorId: null,
      economicOperatorIdentifierScheme: null,
      facilityId: null,
    }),
    getWritablePassportColumns,
    joinQuotedSqlIdentifiers,
    toStoredPassportValue,
    coerceBulkFieldValue: (_field, value) => value,
    extractCarrierAuthenticityMutation: () => ({ provided: false, signCarrierPayload: false }),
    applyCarrierAuthenticityMutation: () => null,
    getCompanyNameMap: async () => new Map([["7", "Example Company"]]),
    maybeSignCarrierPayload: async () => null,
    buildCarrierAuthenticityStorageValue: () => null,
    insertPassportRegistry: async () => {},
    logAudit: async () => {},
    archivePassportSnapshot: async ({ passport }) => { archivedPassport = passport; },
    getActorIdentifier: () => "user:9",
    normalizeReleaseStatus: (status) => status,
    normalizePassportRow,
    systemPassportFields,
  });

  const result = await createDraftPassport({
    companyId: 7,
    userId: 9,
    reqUser: { userId: 9 },
    typeSchema,
    resolvedPassportType: typeSchema.typeName,
    tableName: '"batteryPassportV1Passports"',
    item: {
      passportType: typeSchema.typeName,
      internalAliasId: "BAT-001",
      [longFieldKey]: "created value",
    },
    companyPolicy: {},
    snapshotReason: "afterCreate",
  });

  assert.match(insertQuery, new RegExp(`"${physicalFieldKey}"`));
  assert.equal(result.passport[longFieldKey], "created value");
  assert.equal(Object.hasOwn(result.passport, physicalFieldKey), false);
  assert.equal(archivedPassport[longFieldKey], "created value");
  assert.equal(Object.hasOwn(archivedPassport, physicalFieldKey), false);
});

test("draft create stores the selected model and mapped operator fields once in their platform columns", async () => {
  let insertQuery = null;
  let identifierSource = null;
  const typeSchemaWithCanonicalSystemFields = {
    typeName: "exampleProductPassportV1",
    allowedKeys: new Set(["modelName", "economicOperatorId"]),
    schemaFields: [
      { key: "modelName", type: "text", required: true },
      { key: "economicOperatorId", type: "text", required: true },
    ],
    fieldsJson: {
      identity: { businessIdentifierField: "modelName", modelNameField: "modelName" },
      sections: [{
        key: "identity",
        fields: [
          { key: "modelName", type: "text", required: true },
          { key: "economicOperatorId", type: "text", required: true },
        ],
      }],
    },
  };
  const client = {
    async query(sql) {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      insertQuery = sql;
      return {
        rows: [{
          id: 51,
          dppId: "dpp-canonical-create",
          lineageId: "dpp-canonical-create",
          companyId: 7,
          modelName: "Example Model",
          economicOperatorId: "EO-001",
          internalAliasId: "EX-001",
          releaseStatus: "draft",
          versionNumber: 1,
          granularity: "item",
        }],
      };
    },
    release() {},
  };
  const createDraftPassport = createDraftPassportUseCase({
    pool: { connect: async () => client },
    generateDppRecordId: () => "dpp-canonical-create",
    normalizeInternalAliasIdValue: (value) => String(value || "").trim(),
    generateInternalAliasIdValue: (dppId) => dppId,
    findExistingPassportByInternalAliasId: async () => null,
    resolveGranularityForCreate: () => "item",
    buildStoredProductIdentifiers: ({ internalAliasId, passportLike }) => {
      identifierSource = passportLike;
      return { internalAliasId, uniqueProductIdentifier: `did:example:${internalAliasId}` };
    },
    buildComplianceManagedFields: async () => ({
      passportPolicyKey: "policy",
      contentSpecificationIds: "[]",
      carrierPolicyKey: null,
      economicOperatorId: "EO-001",
      economicOperatorIdentifierScheme: null,
      facilityId: null,
    }),
    getWritablePassportColumns,
    joinQuotedSqlIdentifiers,
    toStoredPassportValue,
    extractCarrierAuthenticityMutation: () => ({ provided: false, signCarrierPayload: false }),
    applyCarrierAuthenticityMutation: () => null,
    getCompanyNameMap: async () => new Map([["7", "Example Company"]]),
    maybeSignCarrierPayload: async () => null,
    buildCarrierAuthenticityStorageValue: () => null,
    insertPassportRegistry: async () => {},
    logAudit: async () => {},
    archivePassportSnapshot: async () => {},
    getActorIdentifier: () => "user:9",
    normalizeReleaseStatus: (status) => status,
    normalizePassportRow,
    systemPassportFields,
  });

  const result = await createDraftPassport({
    companyId: 7,
    userId: 9,
    reqUser: { userId: 9 },
    typeSchema: typeSchemaWithCanonicalSystemFields,
    resolvedPassportType: typeSchemaWithCanonicalSystemFields.typeName,
    tableName: '"exampleProductPassportV1Passports"',
    item: {
      passportType: typeSchemaWithCanonicalSystemFields.typeName,
      internalAliasId: "EX-001",
      modelName: "Example Model",
    },
    companyPolicy: {},
    snapshotReason: "afterCreate",
  });

  assert.equal(identifierSource.modelName, "Example Model");
  assert.equal(insertQuery.match(/"modelName"/g)?.length, 1);
  assert.equal(insertQuery.match(/"economicOperatorId"/g)?.length, 1);
  assert.equal(result.passport.modelName, "Example Model");
  assert.equal(result.passport.economicOperatorId, "EO-001");
});

test("editable update reads and returns a long logical key while writing through the logical API key", async () => {
  let capturedUpdateData = null;
  const archives = [];
  const rawCurrent = {
    id: 42,
    dppId: "dpp-long-update",
    lineageId: "dpp-long-update",
    companyId: 7,
    internalAliasId: "BAT-002",
    uniqueProductIdentifier: "did:example:BAT-002",
    releaseStatus: "draft",
    versionNumber: 1,
    granularity: "item",
    [physicalFieldKey]: "old value",
  };
  const updateEditablePassport = updateEditablePassportUseCase({
    pool: { query: async () => ({ rows: [rawCurrent] }) },
    normalizePassportRequestBody: (body) => body,
    getPassportTypeSchema: async () => typeSchema,
    hasCompanyPassportTypeAccess: async () => true,
    assertPassportTypeStorageReady: async () => {},
    getTable: () => '"batteryPassportV1Passports"',
    validGranularities: new Set(["model", "batch", "item"]),
    editableReleaseStatusesSql: "('draft','inRevision')",
    hasReleasedLineageVersion: async () => false,
    normalizeInternalAliasIdValue: (value) => String(value || "").trim(),
    buildStoredProductIdentifiers: ({ internalAliasId }) => ({
      internalAliasId,
      uniqueProductIdentifier: `did:example:${internalAliasId}`,
    }),
    findExistingPassportByInternalAliasId: async () => null,
    normalizeReleaseStatus: (status) => status,
    getCompanyNameMap: async () => new Map([["7", "Example Company"]]),
    maybeSignCarrierPayload: async ({ metadata }) => metadata,
    applyCarrierAuthenticityMutation: (_current, mutation) => mutation,
    buildCarrierAuthenticityStorageValue: (value) => value,
    extractCarrierAuthenticityMutation: () => ({ provided: false }),
    buildComplianceManagedFields: async () => ({
      passportPolicyKey: "policy",
      contentSpecificationIds: "[]",
      carrierPolicyKey: null,
      economicOperatorId: null,
      economicOperatorIdentifierScheme: null,
      facilityId: null,
    }),
    archivePassportSnapshot: async ({ passport }) => archives.push(passport),
    updatePassportRowById: async ({ data }) => {
      capturedUpdateData = data;
      return {
        updateCols: Object.keys(data),
        updatedRow: { ...rawCurrent, [physicalFieldKey]: data[longFieldKey] },
      };
    },
    coerceBulkFieldValue: (_field, value) => value,
    logAudit: async () => {},
    getActorIdentifier: () => "user:9",
    normalizePassportRow,
  });

  const result = await updateEditablePassport({
    req: {
      params: { companyId: "7", dppId: "dpp-long-update" },
      user: { userId: 9 },
      body: { passportType: typeSchema.typeName, [longFieldKey]: "new value" },
    },
  });

  assert.equal(capturedUpdateData[longFieldKey], "new value");
  assert.equal(result.passport[longFieldKey], "new value");
  assert.equal(Object.hasOwn(result.passport, physicalFieldKey), false);
  assert.equal(archives[0][longFieldKey], "old value");
  assert.equal(archives[1][longFieldKey], "new value");
});

test("single revise copies a long field through its deterministic physical column", async () => {
  const { app, routes } = createRouteApp();
  let insertCall = null;
  const rawSource = {
    id: 43,
    dppId: "dpp-long-revise-source",
    lineageId: "dpp-long-revise-source",
    companyId: 7,
    internalAliasId: "BAT-003",
    releaseStatus: "released",
    versionNumber: 1,
    createdBy: 8,
    deletedAt: null,
    batteryChemistry: [{ batteryChemistry: "NCA" }],
    [physicalFieldKey]: "copied value",
  };
  registerLifecycleRoutes(app, {
    pool: {
      async query(sql, params) {
        if (sql.includes("AND \"releaseStatus\" = 'released'")) return { rows: [rawSource] };
        if (sql.startsWith("SELECT id FROM")) return { rows: [] };
        if (sql.startsWith("INSERT INTO \"batteryPassportV1Passports\"")) {
          insertCall = { sql, params };
          return { rows: [{ ...rawSource, dppId: "dpp-long-revise-new", versionNumber: 2 }] };
        }
        if (sql.includes('FROM "passportRegistry"')) return { rows: [{}] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    logger: { error() {} },
    authenticateToken: noopMiddleware,
    checkCompanyAccess: noopMiddleware,
    requireEditor: noopMiddleware,
    getTable: () => '"batteryPassportV1Passports"',
    getPassportTypeSchema: async () => typeSchema,
    hasCompanyPassportTypeAccess: async () => true,
    generateDppRecordId: () => "dpp-long-revise-new",
    revisionBlockingStatusesSql: "('draft','inRevision','inReview')",
    inRevisionStatus: "inRevision",
    insertPassportRegistry: async () => {},
    archivePassportSnapshot: async () => {},
    getActorIdentifier: () => "user:9",
    logAudit: async () => {},
    normalizePassportRow,
  });
  const route = routes.find((entry) => entry.method === "post" && entry.routePath.endsWith("/:dppId/revise"));
  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "7", dppId: rawSource.dppId },
    body: { passportType: typeSchema.typeName },
    user: { userId: 9 },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.ok(insertCall);
  assert.match(insertCall.sql, new RegExp(`"${physicalFieldKey}"`));
  assert.equal(insertCall.params.includes("copied value"), true);
  assert.equal(insertCall.params.includes(JSON.stringify(rawSource.batteryChemistry)), true);
});

test("bulk revise applies a change addressed by a long logical key", async () => {
  const { app, routes } = createRouteApp();
  let passportInsert = null;
  const rawSource = {
    id: 44,
    dppId: "dpp-long-bulk-source",
    lineageId: "dpp-long-bulk-source",
    companyId: 7,
    internalAliasId: "BAT-004",
    releaseStatus: "released",
    versionNumber: 1,
    createdBy: 8,
    deletedAt: null,
    batteryChemistry: [{ batteryChemistry: "NCA" }],
    [physicalFieldKey]: "old bulk value",
  };
  registerBulkLifecycleRoutes(app, {
    pool: {
      async query(sql, params) {
        if (sql.includes('FROM "passportRegistry"') && sql.includes('ANY($2::text[])')) {
          return { rows: [{ dppId: rawSource.dppId, passportType: typeSchema.typeName }] };
        }
        if (sql.startsWith('INSERT INTO "passportRevisionBatches"')) return { rows: [{ id: 81, createdAt: new Date(0) }] };
        if (sql.includes('FROM "passportTypes"')) {
          return { rows: [{ fieldsJson: typeSchema.fieldsJson, displayName: "Battery" }] };
        }
        if (sql.includes("AND \"releaseStatus\" = 'released'")) return { rows: [rawSource] };
        if (sql.includes("AND \"releaseStatus\" IN ('draft','inRevision','inReview')")) return { rows: [] };
        if (sql.startsWith('INSERT INTO "batteryPassportV1Passports"')) {
          passportInsert = { sql, params };
          return { rows: [{ ...rawSource, dppId: "dpp-long-bulk-new", versionNumber: 2, [physicalFieldKey]: "new bulk value" }] };
        }
        if (sql.includes('FROM "passportRegistry"') && sql.includes('"deviceApiKeyHash"')) return { rows: [{}] };
        if (sql.startsWith('INSERT INTO "passportRevisionBatchItems"')) return { rows: [] };
        if (sql.startsWith('UPDATE "passportRevisionBatches"')) return { rows: [] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    logger: { error() {}, warn() {} },
    authenticateToken: noopMiddleware,
    checkCompanyAccess: noopMiddleware,
    requireEditor: noopMiddleware,
    getTable: () => '"batteryPassportV1Passports"',
    getPassportTypeSchema: async () => typeSchema,
    hasCompanyPassportTypeAccess: async () => true,
    normalizeReleaseStatus: (status) => status,
    toStoredPassportValue,
    coerceBulkFieldValue: (_field, value) => value,
    generateDppRecordId: () => "dpp-long-bulk-new",
    revisionBlockingStatusesSql: "('draft','inRevision','inReview')",
    inRevisionStatus: "inRevision",
    insertPassportRegistry: async () => {},
    archivePassportSnapshot: async () => {},
    getActorIdentifier: () => "user:9",
    logAudit: async () => {},
    normalizePassportRow,
  });
  const route = routes.find((entry) => entry.method === "post" && entry.routePath.endsWith("/bulk-revise"));
  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "7" },
    body: {
      items: [{ dppId: rawSource.dppId }],
      changes: { [longFieldKey]: "new bulk value" },
    },
    user: { userId: 9 },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.summary.revised, 1);
  assert.ok(passportInsert);
  assert.match(passportInsert.sql, new RegExp(`"${physicalFieldKey}"`));
  assert.equal(passportInsert.params.includes("new bulk value"), true);
  assert.equal(passportInsert.params.includes(JSON.stringify(rawSource.batteryChemistry)), true);
});

test("company passport reads expose long logical keys instead of physical column names", async () => {
  const { app, routes } = createRouteApp();
  const rawRow = {
    dppId: "dpp-long-company-read",
    companyId: 7,
    releaseStatus: "draft",
    [physicalFieldKey]: "company read value",
  };
  registerCompanyPassportReadRoutes(app, {
    pool: { query: async () => ({ rows: [rawRow] }) },
    logger: { error() {} },
    authenticateToken: noopMiddleware,
    checkCompanyAccess: noopMiddleware,
    getPassportTypeSchema: async () => typeSchema,
    hasCompanyPassportTypeAccess: async () => true,
    getTable: () => '"batteryPassportV1Passports"',
    normalizePassportRow,
    normalizeReleaseStatus: (status) => status,
    inRevisionStatus: "inRevision",
    inRevisionStatusesSql: "('inRevision')",
  });
  const route = routes.find((entry) => entry.method === "get" && entry.routePath === "/api/companies/:companyId/passports");
  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "7" },
    query: { passportType: typeSchema.typeName },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body[0][longFieldKey], "company read value");
  assert.equal(Object.hasOwn(response.body[0], physicalFieldKey), false);
});

test("public passport repository reads expose long logical keys instead of physical column names", async () => {
  const rawRow = {
    dppId: "dpp-long-public-read",
    companyId: 7,
    releaseStatus: "released",
    versionNumber: 1,
    [physicalFieldKey]: "public read value",
  };
  const repository = createPassportQueryRepository({
    pool: {
      async query(sql) {
        if (sql.includes('FROM "passportRegistry"')) {
          return { rows: [{ passportType: typeSchema.typeName }] };
        }
        if (sql.includes('FROM "batteryPassportV1Passports"')) return { rows: [rawRow] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    getTable: () => '"batteryPassportV1Passports"',
    getPassportTypeSchema: async () => typeSchema,
    normalizePassportRow,
    isPublicHistoryStatus: (status) => status === "released" || status === "obsolete",
  });

  const result = await repository.resolveReleasedPassportByDppId(rawRow.dppId);

  assert.equal(result.passport[longFieldKey], "public read value");
  assert.equal(Object.hasOwn(result.passport, physicalFieldKey), false);
});

test("release reconciliation resolves a long business-identifier field by its logical key", async () => {
  let capturedBusinessIdentifier = null;
  const releaseTypeSchema = {
    ...typeSchema,
    fieldsJson: {
      ...typeSchema.fieldsJson,
      identity: { businessIdentifierField: longFieldKey },
    },
  };
  const helpers = createComplianceHelpers({
    pool: { query: async () => ({ rows: [] }) },
    complianceService: {
      resolvePassportPolicyMetadata: () => ({
        key: "policy",
        contentSpecificationIds: [],
        defaultCarrierPolicyKey: null,
      }),
      evaluatePassport: async () => ({}),
    },
    productIdentifierService: {
      extractBusinessProductIdentifier(source, schema) {
        const key = schema?.fieldsJson?.identity?.businessIdentifierField;
        capturedBusinessIdentifier = source[key];
        return capturedBusinessIdentifier;
      },
      normalizeProductIdentifiers: ({ rawProductId }) => ({
        internalAliasIdInput: rawProductId,
        productIdentifierDid: "did:example:BAT-005",
      }),
    },
    extractExplicitFacilityId: () => null,
    getTable: () => '"batteryPassportV1Passports"',
    getPassportTypeSchema: async () => releaseTypeSchema,
    normalizePassportRow,
    normalizeInternalAliasIdValue: (value) => String(value || "").trim(),
    normalizeReleaseStatus: (status) => status,
    updatePassportRowById: async () => {
      throw new Error("unchanged release metadata must not issue an update");
    },
  });

  const reconciled = await helpers.reconcileManagedReleaseFields({
    passport: {
      id: 45,
      dppId: "dpp-long-release",
      companyId: 7,
      internalAliasId: "BAT-005",
      uniqueProductIdentifier: "did:example:BAT-005",
      passportPolicyKey: "policy",
      contentSpecificationIds: "[]",
      carrierPolicyKey: null,
      economicOperatorId: null,
      economicOperatorIdentifierScheme: null,
      facilityId: null,
      granularity: "item",
      [physicalFieldKey]: "BUSINESS-005",
    },
    companyId: 7,
    passportType: typeSchema.typeName,
    userId: 9,
  });

  assert.equal(capturedBusinessIdentifier, "BUSINESS-005");
  assert.equal(reconciled[longFieldKey], "BUSINESS-005");
  assert.equal(Object.hasOwn(reconciled, physicalFieldKey), false);
});
