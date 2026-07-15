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

function createRouteHarness({ jobOverrides = {} } = {}) {
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
