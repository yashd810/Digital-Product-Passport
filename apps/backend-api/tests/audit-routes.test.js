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
      if (nextCalled) {
        await runHandler(index + 1);
      }
      return;
    }
    await handler(req, res);
    if (!res.finished) {
      await runHandler(index + 1);
    }
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

  const buildAuditLogRootSummary = jest.fn(async (companyId) => ({
    companyId,
    verified: true,
    logCount: 5,
    firstLogId: 11,
    latestLogId: 15,
    latestEventHash: "root_hash_15",
    latestCreatedAt: "2026-04-29T12:00:00.000Z",
    failures: [],
    checkedEntries: 5,
  }));
  const listAuditLogAnchors = jest.fn(async (companyId) => ([
    {
      id: 3,
      company_id: companyId,
      log_count: 5,
      latest_log_id: 15,
      root_event_hash: "root_hash_15",
      anchor_hash: "anchor_hash_3",
      anchor_type: "external_evidence",
      anchor_reference: "s3://evidence/audit-root.json",
    },
  ]));
  const anchorAuditLogRoot = jest.fn(async ({ companyId, anchoredBy, anchorType, anchorReference, notes, metadata }) => ({
    anchor: {
      id: 4,
      company_id: companyId,
      log_count: 6,
      latest_log_id: 16,
      root_event_hash: "root_hash_16",
      anchor_hash: "anchor_hash_4",
      anchor_type: anchorType,
      anchor_reference: anchorReference,
      notes,
      metadata_json: metadata,
      anchored_by: anchoredBy,
    },
    summary: {
      companyId,
      verified: true,
      logCount: 6,
      latestLogId: 16,
      latestEventHash: "root_hash_16",
    },
  }));

  const noopMiddleware = (_req, _res, next) => next();
  const noopAsync = jest.fn(async () => []);

  registerPassportRoutes(app, {
    pool: { query: jest.fn(async () => ({ rows: [] })) },
    fs: {},
    crypto: require("crypto"),
    authenticateToken: (req, _res, next) => {
      req.user = { userId: 9, companyId: 5, role: "company_admin", actorIdentifier: "operator:se-123" };
      next();
    },
    checkCompanyAccess: noopMiddleware,
    checkCompanyAdmin: noopMiddleware,
    requireEditor: noopMiddleware,
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
    SYSTEM_PASSPORT_FIELDS: new Set(["dpp_id", "company_id"]),
    getTable: (typeName) => `${typeName}_passports`,
    normalizePassportRow: (row) => row,
    normalizeReleaseStatus: (value) => value,
    isEditablePassportStatus: (value) => value === "draft" || value === "in_revision",
    normalizeProductIdValue: (value) => String(value || "").trim(),
    generateProductIdValue: (value) => `PID-${value}`,
    normalizePassportRequestBody: (body) => body,
    extractExplicitFacilityId: () => null,
    getWritablePassportColumns: (data) => Object.keys(data || {}),
    getStoredPassportValues: (keys, data) => keys.map((key) => data[key]),
    toStoredPassportValue: (value) => value,
    coerceBulkFieldValue: (_fieldDef, value) => value,
    buildCurrentPublicPassportPath: () => "/dpp/test",
    buildInactivePublicPassportPath: () => "/dpp/inactive/test",
    buildPreviewPassportPath: () => "/dpp/preview/test",
    isPublicHistoryStatus: () => true,
    logAudit: jest.fn(async () => {}),
    getPassportTypeSchema: jest.fn(async () => null),
    findExistingPassportByProductId: jest.fn(async () => null),
    getPassportLineageContext: jest.fn(async () => null),
    getPassportVersionsByLineage: jest.fn(async () => []),
    fetchCompanyPassportRecord: jest.fn(async () => null),
    resolveCompanyPreviewPassport: jest.fn(async () => null),
    updatePassportRowById: jest.fn(async () => []),
    buildPassportVersionHistory: jest.fn(async () => ({ history: [] })),
    clearExpiredEditSessions: jest.fn(async () => {}),
    listActiveEditSessions: noopAsync,
    markOlderVersionsObsolete: jest.fn(async () => {}),
    verifyAuditLogChain: jest.fn(async () => ({ verified: true })),
    buildAuditLogRootSummary,
    listAuditLogAnchors,
    anchorAuditLogRoot,
    stripRestrictedFieldsForPublicView: jest.fn(async (row) => row),
    getCompanyNameMap: jest.fn(async () => new Map()),
    queryTableStats: jest.fn(async () => ({})),
    submitPassportToWorkflow: jest.fn(async () => ({})),
    signPassport: jest.fn(async () => ({})),
    buildBatteryPassJsonExport: jest.fn(() => ({})),
    storageService: {},
    complianceService: {},
    accessRightsService: {
      VALID_AUDIENCES: new Set(["delegated_operator", "market_surveillance", "public"]),
      normalizeGrantElementIdPath: (value) => value,
    },
    productIdentifierService: {
      normalizeProductIdentifiers: ({ rawProductId }) => ({
        productIdInput: rawProductId,
        productIdentifierDid: rawProductId,
      }),
      buildLookupCandidates: ({ productId }) => [productId],
    },
    backupProviderService: null,
    buildExpandedPassportPayload: jest.fn(() => ({})),
  });

  return { app, buildAuditLogRootSummary, listAuditLogAnchors, anchorAuditLogRoot };
}

describe("audit log routes", () => {
  test("GET /api/companies/:companyId/audit-logs/root returns the root summary", async () => {
    const { app, buildAuditLogRootSummary } = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/companies/:companyId/audit-logs/root",
      params: { companyId: "5" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      companyId: 5,
      verified: true,
      latestEventHash: "root_hash_15",
    });
    expect(buildAuditLogRootSummary).toHaveBeenCalledWith(5);
  });

  test("GET /api/companies/:companyId/audit-logs/anchors returns anchor history", async () => {
    const { app, listAuditLogAnchors } = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/companies/:companyId/audit-logs/anchors",
      params: { companyId: "5" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      companyId: 5,
      anchors: [
        expect.objectContaining({
          id: 3,
          anchor_hash: "anchor_hash_3",
        }),
      ],
    });
    expect(listAuditLogAnchors).toHaveBeenCalledWith(5);
  });

  test("POST /api/companies/:companyId/audit-logs/anchors creates an anchor", async () => {
    const { app, anchorAuditLogRoot } = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/companies/:companyId/audit-logs/anchors",
      params: { companyId: "5" },
      body: {
        anchorType: "external_evidence",
        anchorReference: "s3://evidence/audit-root-2026-04-29.json",
        notes: "Daily compliance export",
        metadata: { ticket: "COMP-42" },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({
      anchor: expect.objectContaining({
        anchor_type: "external_evidence",
        anchor_reference: "s3://evidence/audit-root-2026-04-29.json",
        anchored_by: 9,
      }),
      summary: expect.objectContaining({
        companyId: 5,
      }),
    });
    expect(anchorAuditLogRoot).toHaveBeenCalledWith({
      companyId: 5,
      anchoredBy: 9,
      anchorType: "external_evidence",
      anchorReference: "s3://evidence/audit-root-2026-04-29.json",
      notes: "Daily compliance export",
      metadata: { ticket: "COMP-42" },
    });
  });
});
