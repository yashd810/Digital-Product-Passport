"use strict";

const express = require("express");

const registerLifecycleRoutes = require("../src/modules/passports/register-lifecycle-routes");

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
  if (!layer) throw new Error(`Route not found for ${method.toUpperCase()} ${path}`);
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
    user: { userId: 9, companyId: 5, email: "editor@example.test", actorIdentifier: "operator:se-123" },
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

function createApp(options = {}) {
  const app = express();
  app.use(express.json());

  const currentReleased = {
    id: 11,
    dppId: "dpp_release_1",
    dppId: "dpp_release_1",
    lineageId: "lineage_1",
    company_id: 5,
    passportType: "battery",
    versionNumber: 2,
    releaseStatus: "released",
    internalAliasId: "SKU-REL-1",
    uniqueProductIdentifier: "did:web:www.claros-dpp.online:did:battery:item:5:sku-rel-1",
    granularity: "item",
    complianceProfileKey: "battery_dpp_v1",
    contentSpecificationIds: "[\"spec-battery\"]",
    carrierPolicyKey: "battery_qr_public_entry_v1",
    economicOperatorId: "EO-5",
    economicOperatorIdentifierScheme: "uri",
    facilityId: "FAC-DEFAULT-1",
  };

  let latestLivePassport = {
    ...currentReleased,
    releaseStatus: "draft",
  };

  const archivePassportSnapshot = jest.fn(async () => {});
  const logAudit = jest.fn(async () => {});
  const replicatePassportToBackup = jest.fn(async () => ({ success: true }));
  const recordSignedDppRelease = jest.fn(async () => {});
  const signPassport = jest.fn(async () => ({
    keyId: "sig-key-1",
    signatureAlgorithm: "ES256",
    signature: "abc123",
  }));
  const insertPassportRegistry = jest.fn(async () => {});
  const markOlderVersionsObsolete = jest.fn(async () => {});

  const pool = {
    query: jest.fn(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes("UPDATE battery_passports SET releaseStatus = 'released'")) {
        latestLivePassport = { ...latestLivePassport, releaseStatus: "released" };
        return { rows: [latestLivePassport] };
      }
      if (text.includes("UPDATE passport_attachments SET is_public = true")) {
        return { rows: [] };
      }
      if (text.includes("SELECT * FROM battery_passports WHERE dppId = $1 AND releaseStatus = 'released'")) {
        return { rows: [currentReleased] };
      }
      if (text.includes("SELECT id FROM battery_passports WHERE lineageId = $1")) {
        return { rows: [] };
      }
      if (text.includes("SELECT access_key_hash")) {
        return { rows: [{ access_key_hash: "hash", access_key_prefix: "pak_", device_api_key_hash: "dhash", device_api_key_prefix: "dpk_" }] };
      }
      if (text.includes("INSERT INTO battery_passports")) {
        return {
          rows: [{
            ...currentReleased,
            id: 22,
            dppId: params[0],
            dppId: params[0],
            lineageId: params[1],
            versionNumber: 3,
            releaseStatus: "in_revision",
            created_by: 9,
          }],
        };
      }
      return { rows: [] };
    }),
  };

  registerLifecycleRoutes(app, {
    pool,
    logger: { error: jest.fn() },
    authenticateToken: (_req, _res, next) => next(),
    checkCompanyAccess: (_req, _res, next) => next(),
    requireEditor: (_req, _res, next) => next(),
    generateDppRecordId: jest.fn(() => "dpp_revision_2"),
    normalizePassportRequestBody: (body) => body,
    getTable: () => "battery_passports",
    normalizeInternalAliasIdValue: (value) => String(value || "").trim(),
    normalizePassportRow: (row) => row,
    normalizeReleaseStatus: (value) => value,
    findExistingPassportByInternalAliasId: jest.fn(async () => null),
    buildStoredProductIdentifiers: jest.fn(({ internalAliasId }) => ({
      internalAliasId: internalAliasId,
      uniqueProductIdentifier: `did:web:www.claros-dpp.online:did:battery:item:5:${String(internalAliasId).toLowerCase()}`,
    })),
    productIdentifierService: {
      normalizeProductIdentifiers: ({ rawProductId, granularity }) => ({
        internalAliasIdInput: rawProductId,
        productIdentifierDid: `did:web:www.claros-dpp.online:did:battery:${granularity}:5:${String(rawProductId).toLowerCase()}`,
      }),
    },
    getPassportLineageContext: jest.fn(async () => null),
    archivePassportSnapshot,
    archivePassportSnapshots: jest.fn(async () => {}),
    insertPassportRegistry,
    logAudit,
    replicatePassportToBackup,
    loadLatestLivePassport: jest.fn(async () => ({ ...latestLivePassport })),
    reconcileManagedReleaseFields: jest.fn(async ({ passport }) => ({
      ...passport,
      uniqueProductIdentifier: "did:web:www.claros-dpp.online:did:battery:item:5:c5-sku-rel-1-123456789abc",
      complianceProfileKey: "battery_dpp_v1",
      contentSpecificationIds: "[\"spec-battery\"]",
      carrierPolicyKey: "battery_qr_public_entry_v1",
      economicOperatorId: "EO-5",
      economicOperatorIdentifierScheme: "uri",
      facilityId: "FAC-DEFAULT-1",
    })),
    evaluateCompliance: jest.fn(async () => ({
      directReleaseAllowed: true,
      workflowRequired: false,
      workflowReleaseAllowed: true,
      blockingIssues: [],
      completeness: {
        percentage: 100,
        missingFields: [],
        missingMandatoryFields: [],
        missingVoluntaryFields: [],
      },
      ...(options.evaluateComplianceResult || {}),
    })),
    EDITABLE_RELEASE_STATUSES_SQL: "('draft','in_revision')",
    REVISION_BLOCKING_STATUSES_SQL: "('draft','in_revision','in_review')",
    ARCHIVED_HISTORY_FILTER_SQL: "(snapshot_reason IS NULL)",
    markOlderVersionsObsolete,
    complianceService: {
      loadPassportTypeDefinition: jest.fn(async () => ({ type_name: "battery" })),
    },
    signPassport,
    recordSignedDppRelease,
    getActorIdentifier: (user) => user.actorIdentifier,
    IN_REVISION_STATUS: "in_revision",
    submitPassportToWorkflow: jest.fn(async () => ({})),
    VALID_GRANULARITIES: new Set(["model", "batch", "item"]),
  });

  return {
    app,
    archivePassportSnapshot,
    insertPassportRegistry,
    logAudit,
    markOlderVersionsObsolete,
    recordSignedDppRelease,
    replicatePassportToBackup,
    signPassport,
  };
}

describe("passport lifecycle routes", () => {
  test("PATCH /api/companies/:companyId/passports/:dppId/release releases, signs, and audits the passport", async () => {
    const { app, archivePassportSnapshot, logAudit, markOlderVersionsObsolete, recordSignedDppRelease, signPassport } = createApp();

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/companies/:companyId/passports/:dppId/release",
      params: { companyId: "5", dppId: "dpp_release_1" },
      body: { passportType: "battery" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      passport: expect.objectContaining({ releaseStatus: "released" }),
    });
    expect(archivePassportSnapshot).toHaveBeenCalledTimes(2);
    expect(signPassport).toHaveBeenCalled();
    expect(recordSignedDppRelease).toHaveBeenCalled();
    expect(markOlderVersionsObsolete).toHaveBeenCalledWith("battery_passports", "dpp_release_1", 2, "battery");
    expect(logAudit).toHaveBeenCalledWith(5, 9, "RELEASE", "battery_passports", "dpp_release_1", { releaseStatus: "draft_or_in_revision" }, { releaseStatus: "released" });
  });

  test("PATCH /api/companies/:companyId/passports/:dppId/release no longer blocks when verification finds issues", async () => {
    const { app } = createApp({
      evaluateComplianceResult: {
        directReleaseAllowed: false,
        workflowReleaseAllowed: false,
        workflowRequired: false,
        blockingIssues: [{ code: "SEMANTIC_TERM_NOT_FOUND", message: "Example issue" }],
        completeness: {
          percentage: 76,
          missingFields: [{ key: "certificate_url", label: "Certificate URL", mandatory: false }],
          missingMandatoryFields: [],
          missingVoluntaryFields: [{ key: "certificate_url", label: "Certificate URL", mandatory: false }],
        },
      },
    });

    const response = await invokeRoute(app, {
      method: "patch",
      path: "/api/companies/:companyId/passports/:dppId/release",
      params: { companyId: "5", dppId: "dpp_release_1" },
      body: { passportType: "battery" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.verification).toMatchObject({
      status: "issues_found",
      completenessPercentage: 76,
    });
  });

  test("GET /api/companies/:companyId/passports/:dppId/verification-check returns a non-blocking checker result", async () => {
    const { app } = createApp({
      evaluateComplianceResult: {
        directReleaseAllowed: false,
        workflowReleaseAllowed: true,
        workflowRequired: true,
        blockingIssues: [],
        completeness: {
          percentage: 84,
          missingFields: [{ key: "certificate_url", label: "Certificate URL", mandatory: false }],
          missingMandatoryFields: [],
          missingVoluntaryFields: [{ key: "certificate_url", label: "Certificate URL", mandatory: false }],
        },
      },
    });

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/companies/:companyId/passports/:dppId/verification-check",
      params: { companyId: "5", dppId: "dpp_release_1" },
      query: { passportType: "battery" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      passport: expect.objectContaining({
        dppId: "dpp_release_1",
        passportType: "battery",
      }),
      verification: expect.objectContaining({
        status: "missing_optional_fields",
        completenessPercentage: 84,
        counts: expect.objectContaining({
          blockingIssues: 0,
          missingRequiredFields: 0,
          missingOptionalFields: 1,
        }),
      }),
    });
  });

  test("POST /api/companies/:companyId/passports/:dppId/revise creates an in-revision successor and copies registry key material", async () => {
    const { app, archivePassportSnapshot, insertPassportRegistry, logAudit } = createApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/companies/:companyId/passports/:dppId/revise",
      params: { companyId: "5", dppId: "dpp_release_1" },
      body: { passportType: "battery" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      dppId: "dpp_revision_2",
      newVersion: 3,
      releaseStatus: "in_revision",
    });
    expect(insertPassportRegistry).toHaveBeenCalledWith(expect.objectContaining({
      dppId: "dpp_revision_2",
      companyId: "5",
      passportType: "battery",
      accessKeyHash: "hash",
      deviceApiKeyHash: "dhash",
    }));
    expect(archivePassportSnapshot).toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith("5", 9, "REVISE", "battery_passports", "dpp_revision_2", { versionNumber: 2 }, { versionNumber: 3 });
  });
});
