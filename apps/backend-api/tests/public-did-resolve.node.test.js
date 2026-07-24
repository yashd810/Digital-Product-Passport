"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const registerPassportPublicRoutes = require("../src/http/routes/passport-public");

const batchDid = "did:web:api.example.test:products:batteryPassportV1:batch:batch-1";

function createRouteApp() {
  const routes = [];
  return {
    routes,
    app: {
      get(routePath, ...handlers) {
        routes.push({ routePath, handlers });
      },
    },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    redirectUrl: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    redirect(code, url) {
      this.statusCode = code;
      this.redirectUrl = url;
      return this;
    },
  };
}

function registerResolveRoute() {
  const { app, routes } = createRouteApp();
  const passport = {
    dppId: "dpp-batch-1",
    lineageId: "batch-1",
    passportType: "batteryPassportV1",
    companyId: 7,
    modelName: "Battery batch",
    releaseStatus: "released",
    versionNumber: 1,
    granularity: "batch",
  };
  const pool = {
    async query(sql) {
      if (sql.includes('FROM "passportRegistry"')) {
        return {
          rows: [{
            dppId: passport.dppId,
            companyId: passport.companyId,
            passportType: passport.passportType,
            lineageId: passport.lineageId,
          }],
        };
      }
      if (sql.includes('FROM "batteryPassports"')) return { rows: [passport] };
      if (sql.includes('FROM "passportTypes"')) {
        return {
          rows: [{
            typeName: passport.passportType,
            productCategory: "battery",
            semanticModelKey: "battery:v1",
            fieldsJson: { sections: [] },
          }],
        };
      }
      if (sql.includes("FROM companies c")) {
        return {
          rows: [{
            id: 7,
            companyName: "Example Company",
            didSlug: "example-company",
            customerTrustLevel: "verified",
            defaultGranularity: "batch",
            jsonldExportEnabled: true,
            isActive: true,
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const didService = {
    getApiOrigin: () => "https://api.example.test",
    getDidDomain: () => "api.example.test",
    getPlatformDid: () => "did:web:api.example.test",
    parseDid: (did) => did === batchDid ? {
      entityType: "batch",
      passportType: passport.passportType,
      stableId: passport.lineageId,
    } : null,
    normalizeStableId: (value) => value,
    didToDocumentUrl: () => "https://api.example.test/did/batteryPassportV1/batch/batch-1/did.json",
    buildApiUrl: (path) => `https://api.example.test${path}`,
    buildPublicPassportUrl: (path) => `https://viewer.example.test${path}`,
  };

  registerPassportPublicRoutes(app, {
    pool,
    crypto,
    publicReadRateLimit: (_req, _res, next) => next?.(),
    publicUnlockRateLimit: (_req, _res, next) => next?.(),
    getTable: () => '"batteryPassports"',
    normalizePassportRow: (value) => value,
    buildCurrentPublicPassportPath: ({ dppId }) => `/passport/${dppId}`,
    buildInactivePublicPassportPath: ({ dppId }) => `/passport/${dppId}/inactive`,
    stripRestrictedFieldsForPublicView: (value) => value,
    getCompanyNameMap: async () => new Map(),
    resolvePublicPassportByDppId: async () => null,
    buildPassportVersionHistory: async () => [],
    verifyPassportSignature: async () => ({ status: "verified" }),
    logAudit: async () => undefined,
    buildSemanticPassportJsonExport: () => ({}),
    buildCanonicalPassportPayload: () => ({
      subjectDid: batchDid,
      dppDid: "did:web:api.example.test:dpp:batch:batch-1",
      companyDid: "did:web:api.example.test:company:example-company",
    }),
    buildExpandedPassportPayload: () => ({}),
    backupProviderService: {},
    signingService: {
      getSigningKey: () => null,
      getSigningTrustMetadata: () => ({}),
    },
    didService,
    productIdentifierService: {},
  });

  return routes.find((entry) => entry.routePath === "/resolve");
}

test("batch DID resolution returns JSON for API requests", async () => {
  const route = registerResolveRoute();
  const response = createResponse();
  await route.handlers.at(-1)({
    query: { did: batchDid },
    headers: { accept: "application/json" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.did, batchDid);
  assert.equal(response.body.type, "DigitalProductPassport");
  assert.equal(response.body.publicUrl, "https://viewer.example.test/passport/dpp-batch-1");
  assert.equal(response.redirectUrl, null);
});

test("batch DID resolution redirects browser navigation to the public passport", async () => {
  const route = registerResolveRoute();
  const response = createResponse();
  await route.handlers.at(-1)({
    query: { did: batchDid },
    headers: { accept: "text/html", "sec-fetch-dest": "document" },
  }, response);

  assert.equal(response.statusCode, 302);
  assert.equal(response.redirectUrl, "https://viewer.example.test/passport/dpp-batch-1");
  assert.equal(response.body, null);
});
