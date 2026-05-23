"use strict";

const express = require("express");

const registerPassportRoutes = require("../routes/passports");

function createMockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    finished: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.finished = true;
      return this;
    },
    send(payload) {
      this.body = payload;
      this.finished = true;
      return this;
    },
    setHeader() {},
  };
}

function findRouteHandlers(app, method, path) {
  const layer = app._router?.stack?.find((entry) =>
    entry.route
    && entry.route.path === path
    && entry.route.methods?.[method]
  );
  if (!layer) {
    throw new Error(`Route not found for ${method.toUpperCase()} ${path}`);
  }
  return layer.route.stack.map((entry) => entry.handle);
}

async function invokeRoute(app, { method, path, body = {}, params = {}, query = {} }) {
  const handlers = findRouteHandlers(app, method, path);
  const req = {
    method: method.toUpperCase(),
    body,
    params,
    query,
    headers: {},
    user: null,
  };
  const res = createMockResponse();

  async function runHandler(index) {
    if (index >= handlers.length || res.finished) return;
    const handler = handlers[index];
    if (handler.length >= 3) {
      let nextCalled = false;
      await new Promise((resolve, reject) => {
        const next = (error) => {
          if (error) return reject(error);
          nextCalled = true;
          resolve();
        };
        Promise.resolve(handler(req, res, next)).catch(reject);
      });
      if (nextCalled) await runHandler(index + 1);
      return;
    }
    await handler(req, res);
    if (!res.finished) await runHandler(index + 1);
  }

  await runHandler(0);
  return res;
}

function createUploadStub() {
  return {
    single: () => (_req, _res, next) => next(),
    array: () => (_req, _res, next) => next(),
    fields: () => (_req, _res, next) => next(),
  };
}

function createTestApp() {
  const app = express();
  app.use(express.json());

  const currentPassport = {
    id: 12,
    dppId: "dpp_test_1",
    lineageId: "dpp_test_1",
    company_id: 5,
    granularity: "item",
    releaseStatus: "draft",
    internalAliasId: "SKU-1",
    modelName: "Original model",
    facilityId: "FAC-INACTIVE",
    contentSpecificationIds: "[\"spec-a\"]",
    carrierPolicyKey: "battery_qr_public_entry_v1",
    complianceProfileKey: "battery_dpp_v1",
    economicOperatorId: "EO-1",
    economicOperatorIdentifierScheme: "uri",
    traceability_table: "{\"columns\":[\"Step\",\"Place\"],\"rows\":[[\"Assembled\",\"Factory A\"]]}",
  };

  const pool = {
    query: jest.fn(async (sql, params = []) => {
      const text = String(sql);

      if (text.includes("SELECT economic_operator_identifier, economicOperatorIdentifierScheme")
        && text.includes("FROM companies")) {
        return {
          rows: [{
            economic_operator_identifier: "EO-1",
            economicOperatorIdentifierScheme: "uri",
          }],
        };
      }

      if (text.includes("FROM battery_passports")
        && text.includes("WHERE dppId = $1")
        && text.includes("deleted_at IS NULL LIMIT 1")) {
        return { rows: [{ ...currentPassport }] };
      }

      if (text.includes("FROM company_facilities")) {
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };

  const noopMiddleware = (_req, _res, next) => next();
  const archivePassportSnapshot = jest.fn(async () => {});
  const updatePassportRowById = jest.fn(async ({ data }) => ({
    updateCols: Object.keys(data || {}),
    updatedRow: {
      ...currentPassport,
      ...data,
    },
  }));

  registerPassportRoutes(app, {
    pool,
    fs: {},
    crypto: require("crypto"),
    authenticateToken: (req, _res, next) => {
      req.user = { userId: 9, companyId: 5, role: "company_admin" };
      next();
    },
    checkCompanyAccess: noopMiddleware,
    checkCompanyAdmin: noopMiddleware,
    requireEditor: noopMiddleware,
    requireDraftEditor: noopMiddleware,
    authenticateApiKey: noopMiddleware,
    requireApiKeyScope: () => noopMiddleware,
    publicReadRateLimit: noopMiddleware,
    apiKeyReadRateLimit: noopMiddleware,
    assetWriteRateLimit: noopMiddleware,
    upload: createUploadStub(),
    hashSecret: jest.fn(),
    createAccessKeyMaterial: jest.fn(),
    createDeviceKeyMaterial: jest.fn(),
    IN_REVISION_STATUSES_SQL: "('in_revision')",
    EDITABLE_RELEASE_STATUSES_SQL: "('draft','in_revision')",
    REVISION_BLOCKING_STATUSES_SQL: "('draft','in_revision','in_review')",
    EDIT_SESSION_TIMEOUT_HOURS: 12,
    EDIT_SESSION_TIMEOUT_SQL: "12 hours",
    IN_REVISION_STATUS: "in_revision",
    SYSTEM_PASSPORT_FIELDS: new Set(["id", "dppId", "company_id"]),
    getTable: (typeName) => `${typeName}_passports`,
    normalizePassportRow: (row) => row,
    normalizeReleaseStatus: (value) => value,
    isEditablePassportStatus: (value) => value === "draft" || value === "in_revision",
    normalizeInternalAliasIdValue: (value) => String(value || "").trim(),
    generateInternalAliasIdValue: (value) => `PID-${value}`,
    normalizePassportRequestBody: (body) => body,
    extractExplicitFacilityId: (source) => {
      const value = source?.facilityId;
      return value ? String(value).trim() : null;
    },
    getWritablePassportColumns: (data, excluded = new Set()) =>
      Object.keys(data || {}).filter((key) => !excluded.has(key)),
    getStoredPassportValues: (keys, data) => keys.map((key) => data[key]),
    toStoredPassportValue: (value) => value,
    coerceBulkFieldValue: (_fieldDef, value) => value,
    buildCurrentPublicPassportPath: () => "/dpp/test",
    buildInactivePublicPassportPath: () => "/dpp/inactive/test",
    buildPreviewPassportPath: () => "/dpp/preview/test",
    isPublicHistoryStatus: () => true,
    logAudit: jest.fn(async () => {}),
    getPassportTypeSchema: jest.fn(async () => ({
      typeName: "battery",
      allowedKeys: new Set(["manufacturer", "traceability_table"]),
    })),
    findExistingPassportByInternalAliasId: jest.fn(async () => null),
    getPassportLineageContext: jest.fn(async () => null),
    getPassportVersionsByLineage: jest.fn(async () => []),
    fetchCompanyPassportRecord: jest.fn(async () => null),
    resolveCompanyPreviewPassport: jest.fn(async () => null),
    archivePassportSnapshot,
    archivePassportSnapshots: jest.fn(async () => 0),
    updatePassportRowById,
    buildPassportVersionHistory: jest.fn(async () => ({ history: [] })),
    clearExpiredEditSessions: jest.fn(async () => {}),
    listActiveEditSessions: jest.fn(async () => []),
    markOlderVersionsObsolete: jest.fn(async () => {}),
    verifyAuditLogChain: jest.fn(async () => ({ verified: true })),
    buildAuditLogRootSummary: jest.fn(async () => ({})),
    listAuditLogAnchors: jest.fn(async () => []),
    anchorAuditLogRoot: jest.fn(async () => ({})),
    stripRestrictedFieldsForPublicView: jest.fn(async (row) => row),
    getCompanyNameMap: jest.fn(async () => new Map([["5", "Example Co"]])),
    queryTableStats: jest.fn(async () => ({})),
    submitPassportToWorkflow: jest.fn(async () => ({})),
    signPassport: jest.fn(async () => ({})),
    signPortableDataConstruct: jest.fn(async () => ({})),
    buildBatteryPassJsonExport: jest.fn(() => ({})),
    storageService: {},
    complianceService: {
      resolveProfileMetadata: () => ({
        key: "battery_dpp_v1",
        contentSpecificationIds: ["spec-a"],
        defaultCarrierPolicyKey: "battery_qr_public_entry_v1",
      }),
    },
    accessRightsService: {
      VALID_AUDIENCES: new Set(["public", "delegated_operator", "economic_operator"]),
    },
    productIdentifierService: {
      normalizeProductIdentifiers: ({ rawProductId }) => ({
        internalAliasIdInput: rawProductId,
        productIdentifierDid: `did:product:${rawProductId}`,
      }),
      buildLookupCandidates: ({ internalAliasId }) => [internalAliasId],
    },
    backupProviderService: null,
    buildExpandedPassportPayload: jest.fn(() => ({})),
  });

  return { app, archivePassportSnapshot, pool, updatePassportRowById };
}

function createReleaseTestApp() {
  const app = express();
  app.use(express.json());

  const currentPassport = {
    id: 21,
    dppId: "dpp_release_1",
    company_id: 5,
    versionNumber: 3,
    granularity: "item",
    releaseStatus: "draft",
    internalAliasId: "SKU-REL-1",
    uniqueProductIdentifier: "SKU-REL-1",
    complianceProfileKey: "generic_dpp_v1",
    contentSpecificationIds: null,
    carrierPolicyKey: null,
    economicOperatorId: null,
    economicOperatorIdentifierScheme: null,
    facilityId: null,
    modelName: "Release test passport",
  };

  const pool = {
    query: jest.fn(async (sql, params = []) => {
      const text = String(sql);

      if (text.includes("SELECT *")
        && text.includes("FROM battery_passports")
        && text.includes("WHERE dppId = $1")
        && text.includes("company_id = $2")) {
        return { rows: [{ ...currentPassport }] };
      }

      if (text.includes("SELECT economic_operator_identifier, economicOperatorIdentifierScheme")
        && text.includes("FROM companies")) {
        return {
          rows: [{
            economic_operator_identifier: "EO-5",
            economicOperatorIdentifierScheme: "uri",
          }],
        };
      }

      if (text.includes("FROM company_facilities")
        && text.includes("ORDER BY updated_at DESC")) {
        return { rows: [{ facility_identifier: "FAC-DEFAULT-1" }] };
      }

      if (text.includes("UPDATE battery_passports SET releaseStatus = 'released'")) {
        return {
          rows: [{
            ...currentPassport,
            releaseStatus: "released",
            complianceProfileKey: "battery_dpp_v1",
            uniqueProductIdentifier: "did:web:www.claros-dpp.online:did:battery:item:5:c5-sku-rel-1-123456789abc",
            contentSpecificationIds: "[\"spec-battery\"]",
            carrierPolicyKey: "battery_qr_public_entry_v1",
            economicOperatorId: "EO-5",
            economicOperatorIdentifierScheme: "uri",
            facilityId: "FAC-DEFAULT-1",
          }],
        };
      }

      if (text.includes("INSERT INTO passport_signatures")
        || text.includes("UPDATE passport_attachments SET is_public = true")) {
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };

  const noopMiddleware = (_req, _res, next) => next();
  const updatePassportRowById = jest.fn(async ({ data }) => ({
    updateCols: Object.keys(data || {}),
    updatedRow: {
      ...currentPassport,
      ...data,
    },
  }));
  const complianceEvaluate = jest.fn(async (passport) => ({
    directReleaseAllowed: true,
    workflowRequired: false,
    blockingIssues: [],
    evaluatedPassport: passport,
  }));

  registerPassportRoutes(app, {
    pool,
    fs: {},
    crypto: require("crypto"),
    authenticateToken: (req, _res, next) => {
      req.user = { userId: 9, companyId: 5, role: "company_admin" };
      next();
    },
    checkCompanyAccess: noopMiddleware,
    checkCompanyAdmin: noopMiddleware,
    requireEditor: noopMiddleware,
    requireDraftEditor: noopMiddleware,
    authenticateApiKey: noopMiddleware,
    requireApiKeyScope: () => noopMiddleware,
    publicReadRateLimit: noopMiddleware,
    apiKeyReadRateLimit: noopMiddleware,
    assetWriteRateLimit: noopMiddleware,
    upload: createUploadStub(),
    hashSecret: jest.fn(),
    createAccessKeyMaterial: jest.fn(),
    createDeviceKeyMaterial: jest.fn(),
    IN_REVISION_STATUSES_SQL: "('in_revision')",
    EDITABLE_RELEASE_STATUSES_SQL: "('draft','in_revision')",
    REVISION_BLOCKING_STATUSES_SQL: "('draft','in_revision','in_review')",
    EDIT_SESSION_TIMEOUT_HOURS: 12,
    EDIT_SESSION_TIMEOUT_SQL: "12 hours",
    IN_REVISION_STATUS: "in_revision",
    SYSTEM_PASSPORT_FIELDS: new Set(["id", "dppId", "company_id"]),
    getTable: (typeName) => `${typeName}_passports`,
    normalizePassportRow: (row) => row,
    normalizeReleaseStatus: (value) => value,
    isEditablePassportStatus: (value) => value === "draft" || value === "in_revision",
    normalizeInternalAliasIdValue: (value) => String(value || "").trim(),
    generateInternalAliasIdValue: (value) => `PID-${value}`,
    normalizePassportRequestBody: (body) => body,
    extractExplicitFacilityId: (source) => {
      const value = source?.facilityId;
      return value ? String(value).trim() : null;
    },
    getWritablePassportColumns: (data, excluded = new Set()) =>
      Object.keys(data || {}).filter((key) => !excluded.has(key)),
    getStoredPassportValues: (keys, data) => keys.map((key) => data[key]),
    toStoredPassportValue: (value) => value,
    coerceBulkFieldValue: (_fieldDef, value) => value,
    buildCurrentPublicPassportPath: () => "/dpp/test",
    buildInactivePublicPassportPath: () => "/dpp/inactive/test",
    buildPreviewPassportPath: () => "/dpp/preview/test",
    isPublicHistoryStatus: () => true,
    logAudit: jest.fn(async () => {}),
    getPassportTypeSchema: jest.fn(async () => ({
      typeName: "battery",
      allowedKeys: new Set(["manufacturer", "modelName", "internalAliasId"]),
    })),
    findExistingPassportByInternalAliasId: jest.fn(async () => null),
    getPassportLineageContext: jest.fn(async () => null),
    getPassportVersionsByLineage: jest.fn(async () => []),
    fetchCompanyPassportRecord: jest.fn(async () => null),
    resolveCompanyPreviewPassport: jest.fn(async () => null),
    archivePassportSnapshot: jest.fn(async () => {}),
    archivePassportSnapshots: jest.fn(async () => 0),
    updatePassportRowById,
    buildPassportVersionHistory: jest.fn(async () => ({ history: [] })),
    clearExpiredEditSessions: jest.fn(async () => {}),
    listActiveEditSessions: jest.fn(async () => []),
    markOlderVersionsObsolete: jest.fn(async () => {}),
    verifyAuditLogChain: jest.fn(async () => ({ verified: true })),
    buildAuditLogRootSummary: jest.fn(async () => ({})),
    listAuditLogAnchors: jest.fn(async () => []),
    anchorAuditLogRoot: jest.fn(async () => ({})),
    stripRestrictedFieldsForPublicView: jest.fn(async (row) => row),
    getCompanyNameMap: jest.fn(async () => new Map([["5", "Example Co"]])),
    queryTableStats: jest.fn(async () => ({})),
    submitPassportToWorkflow: jest.fn(async () => ({})),
    signPassport: jest.fn(async () => null),
    signPortableDataConstruct: jest.fn(async () => ({})),
    buildBatteryPassJsonExport: jest.fn(() => ({})),
    storageService: {},
    complianceService: {
      resolveProfileMetadata: () => ({
        key: "battery_dpp_v1",
        contentSpecificationIds: ["spec-battery"],
        defaultCarrierPolicyKey: "battery_qr_public_entry_v1",
      }),
      evaluatePassport: complianceEvaluate,
      loadPassportTypeDefinition: jest.fn(async () => ({ type_name: "battery" })),
    },
    accessRightsService: {
      VALID_AUDIENCES: new Set(["public", "delegated_operator", "economic_operator"]),
    },
    productIdentifierService: {
      normalizeProductIdentifiers: ({ rawProductId }) => ({
        internalAliasIdInput: rawProductId,
        productIdentifierDid: `did:web:www.claros-dpp.online:did:battery:item:5:c5-sku-rel-1-123456789abc`,
      }),
      buildLookupCandidates: ({ internalAliasId }) => [internalAliasId],
    },
    backupProviderService: null,
    buildExpandedPassportPayload: jest.fn(() => ({})),
  });

  return { app, complianceEvaluate, updatePassportRowById };
}

describe("passport patch governance", () => {
  test("PATCH /api/companies/:companyId/passports/:dppId accepts an explicit passport facility identifier without company registry lookup", async () => {
    const { app, pool, updatePassportRowById } = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/companies/:companyId/passports/:dppId",
      params: { companyId: "5", dppId: "dpp_test_1" },
      body: {
        passportType: "battery",
        facilityId: "PASSPORT-FAC-001",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(updatePassportRowById).toHaveBeenCalled();
    expect(updatePassportRowById.mock.calls[0][0].data.facilityId).toBe("PASSPORT-FAC-001");

    const facilityValidationCalls = pool.query.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM company_facilities")
      && String(sql).includes("facility_identifier = $2")
    );
    expect(facilityValidationCalls).toHaveLength(0);
  });

  test("PATCH /api/companies/:companyId/passports/:dppId returns the updated passport row for immediate form rehydration", async () => {
    const { app, updatePassportRowById } = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/companies/:companyId/passports/:dppId",
      params: { companyId: "5", dppId: "dpp_test_1" },
      body: {
        passportType: "battery",
        modelName: "Updated model",
        manufacturer: "Updated manufacturer",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.passport).toMatchObject({
      dppId: "dpp_test_1",
      passportType: "battery",
      modelName: "Updated model",
      manufacturer: "Updated manufacturer",
    });
    expect(updatePassportRowById.mock.calls[0][0].data).toMatchObject({
      modelName: "Updated model",
      manufacturer: "Updated manufacturer",
    });
  });

  test("PATCH /api/companies/:companyId/passports/:dppId ignores unsupported payload keys while updating supported fields", async () => {
    const { app, updatePassportRowById } = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/companies/:companyId/passports/:dppId",
      params: { companyId: "5", dppId: "dpp_test_1" },
      body: {
        passportType: "battery",
        modelName: "Updated model",
        unsupported_runtime_key: "should be ignored",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(updatePassportRowById).toHaveBeenCalled();
    expect(updatePassportRowById.mock.calls[0][0].data).toMatchObject({
      modelName: "Updated model",
    });
    expect(updatePassportRowById.mock.calls[0][0].data.unsupported_runtime_key).toBeUndefined();
  });

  test("PATCH /api/companies/:companyId/passports/:dppId preserves existing structured field when browser submits [object Object]", async () => {
    const { app, updatePassportRowById } = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/companies/:companyId/passports/:dppId",
      params: { companyId: "5", dppId: "dpp_test_1" },
      body: {
        passportType: "battery",
        manufacturer: "Updated manufacturer",
        traceability_table: "[object Object]",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(updatePassportRowById).toHaveBeenCalled();
    expect(updatePassportRowById.mock.calls[0][0].data).toMatchObject({
      manufacturer: "Updated manufacturer",
      traceability_table: "{\"columns\":[\"Step\",\"Place\"],\"rows\":[[\"Assembled\",\"Factory A\"]]}",
    });
  });

  test("PATCH /api/companies/:companyId/passports/:dppId preserves stored inactive facility when request does not change facility", async () => {
    const { app, pool, updatePassportRowById } = createTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/companies/:companyId/passports/:dppId",
      params: { companyId: "5", dppId: "dpp_test_1" },
      body: {
        passportType: "battery",
        manufacturer: "Updated manufacturer",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.passport).toMatchObject({
      dppId: "dpp_test_1",
      passportType: "battery",
      manufacturer: "Updated manufacturer",
      facilityId: "FAC-INACTIVE",
    });
    expect(updatePassportRowById).toHaveBeenCalled();
    expect(updatePassportRowById.mock.calls[0][0].data.facilityId).toBe("FAC-INACTIVE");

    const facilityValidationCalls = pool.query.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM company_facilities")
      && String(sql).includes("facility_identifier = $2")
    );
    expect(facilityValidationCalls).toHaveLength(0);
  });

  test("PATCH /api/companies/:companyId/passports/:dppId/release reconciles managed compliance fields before validation", async () => {
    const { app, complianceEvaluate, updatePassportRowById } = createReleaseTestApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/companies/:companyId/passports/:dppId/release",
      params: { companyId: "5", dppId: "dpp_release_1" },
      body: {
        passportType: "battery",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(updatePassportRowById).toHaveBeenCalled();
    expect(updatePassportRowById.mock.calls[0][0].data).toMatchObject({
      uniqueProductIdentifier: "did:web:www.claros-dpp.online:did:battery:item:5:c5-sku-rel-1-123456789abc",
      complianceProfileKey: "battery_dpp_v1",
      contentSpecificationIds: "[\"spec-battery\"]",
      carrierPolicyKey: "battery_qr_public_entry_v1",
      economicOperatorId: "EO-5",
      economicOperatorIdentifierScheme: "uri",
      facilityId: "FAC-DEFAULT-1",
    });
    expect(complianceEvaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        passportType: "battery",
        uniqueProductIdentifier: "did:web:www.claros-dpp.online:did:battery:item:5:c5-sku-rel-1-123456789abc",
        complianceProfileKey: "battery_dpp_v1",
        facilityId: "FAC-DEFAULT-1",
      }),
      "battery"
    );
  });
});
