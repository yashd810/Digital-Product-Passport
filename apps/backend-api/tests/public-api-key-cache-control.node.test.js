"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const registerPassportPublicRoutes = require("../src/http/routes/passport-public");
const registerCarrierSecurityRoutes = require("../src/modules/passports/register-carrier-security-routes");

function createRouteApp() {
  const routes = [];
  const app = {};
  for (const method of ["delete", "get", "options", "patch", "post", "put"]) {
    app[method] = (routePath, ...handlers) => routes.push({ method, routePath, handlers });
  }
  return { app, routes };
}

function createResponse() {
  const headers = new Map();
  return {
    headers,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
  };
}

const passThrough = (_req, _res, next) => next();

function registerPublicRoutes(app) {
  registerPassportPublicRoutes(app, {
    pool: { query: async () => ({ rows: [] }) },
    crypto,
    publicReadRateLimit: passThrough,
    publicUnlockRateLimit: passThrough,
    getTable: () => "passports",
    normalizePassportRow: (value) => value,
    buildCurrentPublicPassportPath: () => "/",
    buildInactivePublicPassportPath: () => "/",
    stripRestrictedFieldsForPublicView: (value) => value,
    getCompanyNameMap: async () => new Map(),
    resolvePublicPassportByDppId: async () => null,
    buildPassportVersionHistory: async () => ({ history: [] }),
    verifyPassportSignature: async () => ({ status: "unsigned" }),
    logAudit: async () => undefined,
    buildSemanticPassportJsonExport: () => ({}),
    buildCanonicalPassportPayload: () => ({}),
    buildExpandedPassportPayload: () => ({}),
    backupProviderService: {},
    signingService: {
      getSigningKey: () => ({ keyId: "test-key" }),
      getSigningTrustMetadata: () => ({ issuerDid: "did:web:api.example.test" }),
    },
    didService: {
      getApiOrigin: () => "https://api.example.test",
      getDidDomain: () => "api.example.test",
      getPlatformDid: () => "did:web:api.example.test",
    },
    productIdentifierService: {},
  });
}

function registerDynamicRoutes(app) {
  const previousServerUrl = process.env.SERVER_URL;
  process.env.SERVER_URL = "https://api.example.test";
  try {
    registerCarrierSecurityRoutes(app, {
      pool: { query: async () => ({ rows: [] }) },
      logger: { error: () => {}, warn: () => {} },
      publicReadRateLimit: passThrough,
      publicUnlockRateLimit: passThrough,
      getSecurityGroupKeyFromRequest: (req) => String(req?.headers?.["x-api-key"] || "").trim(),
    });
  } finally {
    if (previousServerUrl === undefined) delete process.env.SERVER_URL;
    else process.env.SERVER_URL = previousServerUrl;
  }
}

async function assertSecurityGroupReadCannotBeCached(route) {
  const response = createResponse();
  let passedThrough = false;
  await route.handlers[1](
    { headers: { "x-api-key": "restricted-read-key" } },
    response,
    () => { passedThrough = true; },
  );

  assert.equal(passedThrough, true);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("expires"), "0");
  assert.equal(response.headers.get("vary"), "X-API-Key, X-Security-Group-Key");
}

test("public API-key reads cannot cache unlocked passport history", async () => {
  const { app, routes } = createRouteApp();
  registerPublicRoutes(app);

  const route = routes.find((entry) => entry.method === "get"
    && entry.routePath === "/api/public/passports/:dppId/history");
  assert.ok(route);
  await assertSecurityGroupReadCannotBeCached(route);
});

test("public API-key reads cannot cache unlocked dynamic values or their history", async () => {
  const { app, routes } = createRouteApp();
  registerDynamicRoutes(app);

  const targetPaths = [
    "/api/public/passports/:dppId/dynamic-values",
    "/api/public/passports/:dppId/dynamic-values/:fieldKey/history",
  ];
  for (const targetPath of targetPaths) {
    const route = routes.find((entry) => entry.method === "get" && entry.routePath === targetPath);
    assert.ok(route, targetPath);
    await assertSecurityGroupReadCannotBeCached(route);
  }
});

test("anonymous public reads do not receive a private cache directive", async () => {
  const { app, routes } = createRouteApp();
  registerDynamicRoutes(app);
  const route = routes.find((entry) => entry.method === "get"
    && entry.routePath === "/api/public/passports/:dppId/dynamic-values");
  const response = createResponse();
  let passedThrough = false;

  await route.handlers[1]({ headers: {} }, response, () => { passedThrough = true; });

  assert.equal(passedThrough, true);
  assert.equal(response.headers.size, 0);
});
