"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const registerAssetManagementApiRoutes = require("../src/http/routes/asset-management-api");
const {
  normalizeStoredAssetSourceConfig,
  parseAssetSourceCredentials,
  toPublicAssetSourceConfig,
} = require("../src/shared/assets/asset-source-config");
const createAssetService = require("../src/services/asset-management");
const { normalizeAssetHeaders } = require("../src/shared/passports/passport-helpers");

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
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

function createRouteHarness({ jobOverrides = {}, serviceOverrides = {} } = {}) {
  const routes = [];
  let sourceFetchOptions = null;
  const app = {};
  for (const method of ["get", "post", "patch"]) {
    app[method] = (routePath, ...handlers) => routes.push({ method, path: routePath, handlers });
  }
  app.use = (routePath, ...handlers) => routes.push({ method: "use", path: routePath, handlers });

  const requireEditor = (_req, _res, next) => next();
  const pool = {
    async query(sql) {
      if (sql.includes('FROM "assetManagementJobs"')) {
        return {
          rows: [{
            id: 12,
            companyId: 7,
            passportType: "battery",
            name: "ERP sync",
            sourceKind: "api",
            sourceConfig: {
              url: "https://erp.example.test/items",
              method: "GET",
              credentialRef: "erp-primary",
            },
            isActive: true,
            startAt: null,
            intervalMinutes: 60,
            nextRunAt: null,
            lastRunAt: null,
            lastStatus: null,
            lastSummary: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            ...jobOverrides,
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  registerAssetManagementApiRoutes(app, {
    pool,
    authenticateToken: (_req, _res, next) => next(),
    checkCompanyAccess: (_req, _res, next) => next(),
    requireEditor,
    publicReadRateLimit: (_req, _res, next) => next(),
    assetWriteRateLimit: (_req, _res, next) => next(),
    assetSourceFetchRateLimit: (_req, _res, next) => next(),
    assetErpPresets: [],
    assetMatchFields: new Set(),
    inRevisionStatus: "inRevision",
    assertAssetManagementEnabled: async () => ({}),
    assertCompanyAssetPassportTypeAccess: async () => ({ typeName: "battery" }),
    getLatestCompanyPassports: async () => [],
    getAssetFieldMap: () => new Map(),
    isPlainObject: (value) => value !== null && typeof value === "object" && !Array.isArray(value),
    normalizePassportRequestBody: (value) => value,
    fetchAssetSourceRecords: async (_sourceConfig, options) => {
      sourceFetchOptions = options;
      return {};
    },
    prepareAssetPayload: async () => ({}),
    executeAssetPush: async () => ({}),
    runAssetManagementJob: async () => ({}),
    recordAssetRun: async () => ({}),
    resolveAssetJobNextRunAt: () => null,
    ...serviceOverrides,
  });

  return {
    routes,
    requireEditor,
    getSourceFetchOptions: () => sourceFetchOptions,
  };
}

test("asset-job response DTO exposes only validated configuration and requires an editor", async () => {
  const { routes, requireEditor } = createRouteHarness();
  const route = routes.find((entry) => entry.method === "get" && entry.path.endsWith("/jobs"));
  assert.ok(route);
  assert.equal(route.handlers.includes(requireEditor), true);

  const response = createResponse();
  await route.handlers.at(-1)({ params: { companyId: "7" } }, response);
  assert.deepEqual(response.body.jobs[0].sourceConfig, {
    url: "https://erp.example.test/items",
    method: "GET",
    credentialRef: "erp-primary",
  });
});

test("all asset-management routes enforce the company entitlement before their handlers", async () => {
  const enabledCompany = { id: 7, isActive: true, assetManagementEnabled: true };
  let checkedCompanyId = null;
  const { routes } = createRouteHarness({
    serviceOverrides: {
      assertAssetManagementEnabled: async (companyId) => {
        checkedCompanyId = companyId;
        return enabledCompany;
      },
    },
  });
  const routeMiddleware = routes.find((entry) => entry.method === "use");
  assert.ok(routeMiddleware);
  const requireAssetManagementEnabled = routeMiddleware.handlers.at(-1);

  const request = { params: { companyId: "7" } };
  let nextCalled = false;
  await requireAssetManagementEnabled(request, createResponse(), () => {
    nextCalled = true;
  });

  assert.equal(checkedCompanyId, 7);
  assert.strictEqual(request.assetManagementCompany, enabledCompany);
  assert.equal(nextCalled, true);

  const deniedError = Object.assign(
    new Error("Passport Data Management is not enabled for this company"),
    { statusCode: 403, code: "assetManagementDisabled" }
  );
  const deniedHarness = createRouteHarness({
    serviceOverrides: {
      assertAssetManagementEnabled: async () => {
        throw deniedError;
      },
    },
  });
  const deniedMiddleware = deniedHarness.routes.find((entry) => entry.method === "use").handlers.at(-1);
  const deniedResponse = createResponse();
  await deniedMiddleware({ params: { companyId: "7" } }, deniedResponse, () => {
    throw new Error("disabled asset management must not continue to the route handler");
  });
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal(deniedResponse.body.error, deniedError.message);

  const invalidResponse = createResponse();
  await requireAssetManagementEnabled({ params: { companyId: "7-not-a-company" } }, invalidResponse, () => {
    throw new Error("invalid company IDs must not continue to the route handler");
  });
  assert.equal(invalidResponse.statusCode, 400);
  assert.match(invalidResponse.body.error, /positive integer/);
});

test("asset reads fail closed instead of remapping a PostgreSQL-truncated column name", async () => {
  const longFieldKey = `a${"b".repeat(63)}`;
  const truncatedColumnKey = longFieldKey.slice(0, 63);
  const { routes } = createRouteHarness({
    serviceOverrides: {
      assertCompanyAssetPassportTypeAccess: async () => ({
        typeName: "battery",
        displayName: "Battery",
      }),
      getLatestCompanyPassports: async () => [{
        [truncatedColumnKey]: "must-not-be-remapped",
        isEditable: true,
      }],
      getAssetFieldMap: () => new Map([[
        longFieldKey,
        { key: longFieldKey, label: "Overlong field" },
      ]]),
    },
  });
  const route = routes.find((entry) => entry.method === "get" && entry.path.endsWith("/passports"));
  assert.ok(route);

  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "7" },
    query: { passportType: "battery" },
  }, response);

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error, "passportTypeInvalidStorageFieldKeys");
  assert.match(response.body.detail, /cannot be safely mapped/);
});

test("asset push rejects browser-generated payloads and regenerates an internal payload from raw rows", async () => {
  let prepareInput = null;
  let executeInput = null;
  const trustedPayload = {
    companyId: 7,
    passportType: "battery",
    records: [{ rowIndex: 1, action: "create", passportCreate: { internalAliasId: "trusted" } }],
  };
  const { routes } = createRouteHarness({
    serviceOverrides: {
      prepareAssetPayload: async (input) => {
        prepareInput = input;
        return { generatedPayload: trustedPayload };
      },
      executeAssetPush: async (input) => {
        executeInput = input;
        return {
          summary: {
            passportsCreated: 1,
            passportsUpdated: 0,
            dynamicFieldsPushed: 0,
            skipped: 0,
            failed: 0,
          },
          details: [],
        };
      },
      recordAssetRun: async () => ({ id: 42 }),
    },
  });
  const route = routes.find((entry) => entry.method === "post" && entry.path.endsWith("/push"));
  assert.ok(route);

  const rejectedResponse = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "7" },
    body: {
      generatedPayload: {
        companyId: 7,
        passportType: "battery",
        records: [{ action: "create", passportCreate: { 'malicious"; DROP TABLE users; --': "x" } }],
      },
    },
  }, rejectedResponse);
  assert.equal(rejectedResponse.statusCode, 400);
  assert.match(rejectedResponse.body.error, /generatedPayload is not accepted/);
  assert.equal(prepareInput, null);
  assert.equal(executeInput, null);

  const rawResponse = createResponse();
  const records = [{ internalAliasId: "trusted" }];
  await route.handlers.at(-1)({
    params: { companyId: "7" },
    user: { userId: 99 },
    body: { passportType: "battery", records, sourceKind: "manual" },
  }, rawResponse);
  assert.equal(rawResponse.statusCode, 200);
  assert.deepEqual(prepareInput, {
    companyId: 7,
    passportType: "battery",
    records,
    options: undefined,
  });
  assert.strictEqual(executeInput.generatedPayload, trustedPayload);
  assert.equal(executeInput.companyId, 7);
  assert.equal(executeInput.userId, 99);
});

test("asset-job response refuses invalid persisted configuration without exposing it", async () => {
  const credential = "asset-job-test-credential";
  const { routes } = createRouteHarness({
    jobOverrides: {
      sourceConfig: {
        url: `https://erp.example.test/items?api_key=${credential}`,
        headers: { Authorization: `Bearer ${credential}` },
      },
    },
  });
  const route = routes.find((entry) => entry.method === "get" && entry.path.endsWith("/jobs"));
  const response = createResponse();

  await route.handlers.at(-1)({ params: { companyId: "7" } }, response);

  assert.deepEqual(response.body.jobs[0].sourceConfig, {});
  assert.equal(JSON.stringify(response.body).includes(credential), false);
});

test("asset job responses redact stored and newly raised internal failure details", async () => {
  const sensitiveError = "connection to postgres://asset:secret@database.internal/dppSystem failed";
  const { routes } = createRouteHarness({
    jobOverrides: {
      lastSummary: { error: sensitiveError },
    },
    serviceOverrides: {
      runAssetManagementJob: async () => ({
        error: new Error(sensitiveError),
        run: { id: 73, summaryJson: { error: sensitiveError } },
      }),
    },
  });

  const jobsRoute = routes.find((entry) => entry.method === "get" && entry.path.endsWith("/jobs"));
  assert.ok(jobsRoute);
  const jobsResponse = createResponse();
  await jobsRoute.handlers.at(-1)({ params: { companyId: "7" } }, jobsResponse);
  assert.equal(JSON.stringify(jobsResponse.body).includes(sensitiveError), false);
  assert.equal(jobsResponse.body.jobs[0].lastSummary.error, "Asset job failed.");

  const runRoute = routes.find((entry) => entry.method === "post" && entry.path.endsWith("/jobs/:jobId/run"));
  assert.ok(runRoute);
  const runResponse = createResponse();
  await runRoute.handlers.at(-1)({ params: { companyId: "7", jobId: "12" } }, runResponse);
  assert.equal(runResponse.statusCode, 500);
  assert.equal(JSON.stringify(runResponse.body).includes(sensitiveError), false);
  assert.equal(runResponse.body.error, "Asset job failed.");
  assert.equal(runResponse.body.run.summaryJson.error, "Asset job failed.");
});

test("one-time source fetch carries its company context to credential checks", async () => {
  const { routes, getSourceFetchOptions } = createRouteHarness();
  const route = routes.find((entry) => entry.method === "post" && entry.path.endsWith("/source/fetch"));
  assert.ok(route);

  await route.handlers.at(-1)({
    body: { sourceConfig: { url: "https://erp.example.test/items" } },
    params: { companyId: "7" },
  }, createResponse());

  assert.deepEqual(getSourceFetchOptions(), {
    allowInlineCredentials: true,
    companyId: 7,
  });
});

test("scheduled jobs reject inline credentials, bodies, query tokens, and destructive methods", () => {
  assert.throws(
    () => normalizeStoredAssetSourceConfig({ url: "https://erp.example.test/items", headers: { Authorization: "Bearer test" } }),
    /credentialRef/
  );
  assert.throws(
    () => normalizeStoredAssetSourceConfig({ url: "https://erp.example.test/items", body: { token: "test" } }),
    /credentialRef/
  );
  assert.throws(
    () => normalizeStoredAssetSourceConfig({ url: "https://erp.example.test/items?api_key=test" }),
    /query parameters/
  );
  assert.throws(
    () => normalizeStoredAssetSourceConfig({ url: "https://erp.example.test/items", method: "DELETE" }),
    /GET or POST/
  );
  assert.throws(
    () => toPublicAssetSourceConfig({
      url: "https://erp.example.test/items?api_key=inline-token",
      headers: { Authorization: "Bearer inline-token" },
      body: { token: "inline-token" },
    }),
    /credentialRef/
  );
});

test("outbound source requests reject connection and proxy control headers", () => {
  for (const headerName of ["Host", "Connection", "Proxy-Connection", "Transfer-Encoding"]) {
    assert.throws(
      () => normalizeAssetHeaders({ [headerName]: "test" }),
      /not allowed/
    );
  }
  assert.throws(
    () => normalizeAssetHeaders(Object.fromEntries(
      Array.from({ length: 5 }, (_value, index) => [`X-Source-${index}`, "x".repeat(8 * 1024)])
    )),
    /32 KiB/
  );
  assert.throws(
    () => normalizeAssetHeaders({ "X-Source": "value\r\nInjected: value" }),
    /line breaks/
  );
});

test("server credential references require explicit company, endpoint, and method scopes", async () => {
  assert.throws(
    () => parseAssetSourceCredentials(JSON.stringify({
      unscoped: { headers: { Authorization: "Bearer test" } },
    })),
    /companyIds/
  );
  assert.throws(
    () => parseAssetSourceCredentials(JSON.stringify({
      privateTarget: {
        companyIds: [7],
        allowedUrls: ["https://127.0.0.1/items"],
        allowedMethods: ["GET"],
      },
    })),
    /public hosts/
  );

  const credentials = parseAssetSourceCredentials(JSON.stringify({
    "erp-primary": {
      companyIds: [7],
      allowedUrls: ["https://1.1.1.1/items"],
      allowedMethods: ["GET"],
      headers: { Authorization: "Bearer test" },
    },
  }));
  const service = createAssetService({
    assetSourceAllowedHosts: new Set(["1.1.1.1"]),
    assetSourceCredentials: credentials,
    normalizeAssetHeaders: (headers) => headers,
  });

  await assert.rejects(
    service.fetchAssetSourceRecords({
      url: "https://1.1.1.1/not-allowed",
      credentialRef: "erp-primary",
    }, { companyId: 7 }),
    /not available/
  );
  await assert.rejects(
    service.fetchAssetSourceRecords({
      url: "https://1.1.1.1/items",
      credentialRef: "erp-primary",
    }, { companyId: 8 }),
    /not available/
  );
  await assert.rejects(
    service.fetchAssetSourceRecords({
      url: "https://1.1.1.1/items",
      method: "POST",
      credentialRef: "erp-primary",
    }, { companyId: 7 }),
    /not available/
  );
  await assert.rejects(
    service.fetchAssetSourceRecords({
      url: "https://1.1.1.1/items?cursor=1",
      credentialRef: "erp-primary",
    }, { companyId: 7 }),
    /not available/
  );
  await assert.rejects(
    service.fetchAssetSourceRecords({
      url: "https://1.1.1.1/items",
      credentialRef: "erp-primary",
      headers: { "X-Override": "attempt" },
    }, { companyId: 7 }),
    /cannot be combined/
  );
  await assert.rejects(
    service.fetchAssetSourceRecords({
      url: "https://1.1.1.1/items",
      credentialRef: "erp-primary",
      body: null,
    }, { companyId: 7 }),
    /cannot be combined/
  );
  await assert.rejects(
    service.fetchAssetSourceRecords({
      url: "https://1.1.1.1/items",
      body: { filter: "active" },
    }, { companyId: 7 }),
    /require the POST method/
  );
  await assert.rejects(
    service.fetchAssetSourceRecords({
      url: "https://1.1.1.1/items",
      method: "POST",
      body: "x".repeat((64 * 1024) + 1),
    }, { companyId: 7 }),
    /64 KiB limit/
  );
});

test("asset scheduling computes overdue occurrences without an unbounded loop", () => {
  const service = createAssetService({});
  const from = new Date("2026-01-02T00:00:01.000Z");
  const next = service.resolveAssetJobNextRunAt({
    startAt: new Date("1970-01-01T00:00:00.000Z"),
    intervalMinutes: 1,
    from,
  });

  assert.ok(next > from);
  assert.ok(next.getTime() - from.getTime() <= 60_000);
  assert.equal(
    service.resolveAssetJobNextRunAt({
      startAt: new Date("2026-01-03T00:00:00.000Z"),
      intervalMinutes: 1,
      from,
    }).toISOString(),
    "2026-01-03T00:00:00.000Z"
  );
});

test("asset execution accepts only an in-memory payload prepared by the service", async () => {
  const service = createAssetService({});
  await assert.rejects(
    service.executeAssetPush({
      companyId: 7,
      generatedPayload: { companyId: 7, passportType: "battery", records: [{ action: "create" }] },
    }),
    /must be prepared by this service/
  );
});

test("asset writes verify storage readiness once instead of reconciling schema at runtime", async () => {
  const readinessCalls = [];
  let ddlCalls = 0;
  const service = createAssetService({
    pool: {
      async query(sql) {
        if (sql.includes("FROM companies c")) {
          return {
            rows: [{
              id: 7,
              defaultGranularity: "item",
              allowGranularityOverride: false,
              mintModelDids: true,
              mintItemDids: true,
            }],
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    getTable: () => '"batteryPassports"',
    assertCompanyAssetPassportTypeAccess: async () => ({ typeName: "battery" }),
    getAssetFieldMap: () => new Map(),
    getLatestCompanyPassports: async () => [],
    normalizeInternalAliasIdValue: (value) => String(value || "").trim(),
    generateDppRecordId: () => "dppAssetStorageGuard",
    generateInternalAliasIdValue: () => "asset-1",
    isPlainObject: (value) => value !== null && typeof value === "object" && !Array.isArray(value),
    assetMatchFields: new Set(["internalAliasId"]),
    assetIgnoredSystemColumns: new Set(),
    assertPassportTypeStorageReady: async (typeName) => {
      readinessCalls.push(typeName);
      const error = new Error("Passport storage is not provisioned");
      error.code = "passportTypeStorageNotReady";
      error.statusCode = 503;
      throw error;
    },
    createPassportTable: async () => { ddlCalls += 1; },
  });

  const prepared = await service.prepareAssetPayload({
    companyId: 7,
    passportType: "battery",
    records: [{ internalAliasId: "asset-1" }],
  });

  await assert.rejects(
    () => service.executeAssetPush({
      companyId: 7,
      generatedPayload: prepared.generatedPayload,
    }),
    /Passport storage is not provisioned/
  );
  assert.deepEqual(readinessCalls, ["battery"]);
  assert.equal(ddlCalls, 0);
});

test("scheduled jobs reject unsafe persisted credential fields before any outbound request", async () => {
  const service = createAssetService({});
  await assert.rejects(
    service.resolveAssetJobRecords({
      sourceKind: "api",
      sourceConfig: {
        url: "https://erp.example.test/items",
        headers: { Authorization: "Bearer legacy-test" },
      },
    }),
    /credentialRef/
  );
});

test("entitlement revocation disables an in-flight scheduled job instead of rescheduling it", async () => {
  const queries = [];
  const deniedError = Object.assign(
    new Error("Passport Data Management is not enabled for this company"),
    { statusCode: 403, code: "assetManagementDisabled" }
  );
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('UPDATE "assetManagementJobs"')) return { rows: [], rowCount: 1 };
      if (sql.includes('INSERT INTO "assetManagementRuns"')) {
        return { rows: [{ id: 91, createdAt: "2026-01-01T00:00:00.000Z" }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const service = createAssetService({
    pool,
    assertAssetManagementEnabled: async () => {
      throw deniedError;
    },
    isPlainObject: (value) => value !== null && typeof value === "object" && !Array.isArray(value),
  });

  const result = await service.runAssetManagementJob({
    id: 12,
    companyId: 7,
    passportType: "battery",
    sourceKind: "manual",
    optionsJson: {},
    isActive: true,
    startAt: "2026-01-01T00:00:00.000Z",
    intervalMinutes: 60,
  }, "scheduled");

  assert.equal(result.status, "disabled");
  const jobUpdate = queries.find(({ sql }) => sql.includes('UPDATE "assetManagementJobs"'));
  assert.ok(jobUpdate);
  assert.equal(jobUpdate.params[0], 12);
  assert.equal(jobUpdate.params[1], "disabled");
  assert.equal(jobUpdate.params[3], null);
  assert.equal(jobUpdate.params[4], false);
  const runInsert = queries.find(({ sql }) => sql.includes('INSERT INTO "assetManagementRuns"'));
  assert.ok(runInsert);
  assert.equal(runInsert.params[5], "disabled");
});

test("scheduler selects only jobs belonging to active, enabled companies", async () => {
  const queries = [];
  const service = createAssetService({
    pool: {
      async query(sql) {
        queries.push(sql);
        return { rows: [] };
      },
    },
  });

  await service.processDueAssetJobs();

  assert.equal(queries.length, 1);
  assert.match(queries[0], /JOIN companies c ON c\.id = j\."companyId"/);
  assert.match(queries[0], /c\."isActive" = true/);
  assert.match(queries[0], /c\."assetManagementEnabled" = true/);
});
