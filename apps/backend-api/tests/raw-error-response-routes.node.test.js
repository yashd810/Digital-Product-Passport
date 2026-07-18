"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { validateContactSubmission } = require("../src/shared/http/contact-request");
const registerCompanyRoutes = require("../src/modules/admin/register-company-routes");
const registerMutationRoutes = require("../src/modules/dpp-api/register-mutation-routes");
const registerCarrierSecurityRoutes = require("../src/modules/passports/register-carrier-security-routes");
const registerPreviewManagementRoutes = require("../src/modules/passports/register-preview-management-routes");

function createRouteApp() {
  const routes = [];
  const app = {};
  for (const method of ["delete", "get", "options", "patch", "post", "put"]) {
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

test("contact validation does not expose unexpected parser errors", () => {
  const response = createResponse();
  let firstNameReads = 0;
  validateContactSubmission({
    body: {
      get firstName() {
        firstNameReads += 1;
        if (firstNameReads > 1) {
          throw new Error("private internal failure marker");
        }
        return "Avery";
      },
      lastName: "Example",
      email: "avery@example.test",
      message: "Please contact me.",
    },
  }, response, () => {
    throw new Error("unexpectedly accepted malformed contact request");
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Invalid contact request" });
});

test("preview routes do not expose resolver failures", async () => {
  const { app, routes } = createRouteApp();
  const previousServerUrl = process.env.SERVER_URL;
  process.env.SERVER_URL = "https://api.example.test";
  const resolverError = Object.assign(new Error("private resolver failure marker"), { statusCode: 500 });
  try {
    registerPreviewManagementRoutes(app, {
      crypto,
      pool: { query: async () => ({ rows: [] }) },
      authenticateToken: noopMiddleware,
      checkCompanyAccess: noopMiddleware,
      requireEditor: noopMiddleware,
      resolveCompanyPreviewPassport: async () => {
        throw resolverError;
      },
    });

    const previewRoute = routes.find((route) => route.routePath === "/api/companies/:companyId/passports/:passportKey/preview");
    const previewResponse = createResponse();
    await previewRoute.handlers.at(-1)({ params: { companyId: "1", passportKey: "passport-a" } }, previewResponse);
    assert.equal(previewResponse.statusCode, 500);
    assert.deepEqual(previewResponse.body, { error: "Failed to fetch passport preview" });

    const unlockRoute = routes.find((route) => route.routePath === "/api/companies/:companyId/passports/:dppId/preview-unlock");
    const unlockResponse = createResponse();
    await unlockRoute.handlers.at(-1)({
      params: { companyId: "1", dppId: "passport-a" },
      headers: { "x-api-key": "test-security-group-key" },
    }, unlockResponse);
    assert.equal(unlockResponse.statusCode, 500);
    assert.deepEqual(unlockResponse.body, { error: "Failed to unlock passport preview" });
  } finally {
    if (previousServerUrl === undefined) delete process.env.SERVER_URL;
    else process.env.SERVER_URL = previousServerUrl;
  }
});

test("company administration routes do not expose provider or database failures", async () => {
  const { app, routes } = createRouteApp();
  const providerError = new Error("private provider failure marker");
  const databaseError = new Error("private database failure marker");
  registerCompanyRoutes(app, {
    pool: {
      query: async () => ({ rows: [{ id: 1 }] }),
    },
    authenticateToken: noopMiddleware,
    isSuperAdmin: noopMiddleware,
    verifyPassword: async () => true,
    logAudit: async () => {},
    backupProviderService: {
      getContinuityEvidence: async () => {
        throw providerError;
      },
    },
    productIdentifierService: {},
    getTable: () => "passportRows",
    ensureCompanyDppPolicy: async () => {},
    getCompanyDppPolicy: async () => ({}),
    validateCompanyDppPolicyInput: () => ({ mintItemDids: true }),
    updateCompanyDppPolicy: async () => {
      throw databaseError;
    },
    storageService: { deleteStoredFile: async () => {} },
    repoBaseDir: "/tmp/repository",
    filesBaseDir: "/tmp/files",
    companyTrustLevels: new Set(["basic"]),
  });

  const evidenceRoute = routes.find((route) => route.routePath === "/api/admin/companies/:companyId/backup-continuity-evidence");
  const evidenceResponse = createResponse();
  await evidenceRoute.handlers.at(-1)({ params: { companyId: "1" } }, evidenceResponse);
  assert.equal(evidenceResponse.statusCode, 500);
  assert.deepEqual(evidenceResponse.body, { error: "Failed to fetch backup continuity evidence" });

  const policyRoute = routes.find((route) => route.routePath === "/api/admin/companies/:id/dpp-policy" && route.method === "put");
  const policyResponse = createResponse();
  await policyRoute.handlers.at(-1)({
    params: { id: "1" },
    body: { mintItemDids: true },
    user: { userId: 1 },
  }, policyResponse);
  assert.equal(policyResponse.statusCode, 500);
  assert.deepEqual(policyResponse.body, { error: "Failed to update DPP policy" });
});

test("standards DPP mutation routes hide explicit server-status failures", async () => {
  const { app, routes } = createRouteApp();
  const serverError = Object.assign(new Error("private standards mutation failure marker"), { statusCode: 500 });
  registerMutationRoutes(app, {
    pool: {},
    logger: { error: () => {} },
    authenticateToken: noopMiddleware,
    requireBearerToken: noopMiddleware,
    integrationWriteRateLimit: noopMiddleware,
    requireEditor: noopMiddleware,
    normalizePassportRequestBody: () => {
      throw serverError;
    },
    setDppMergePatchHeaders: () => {
      throw serverError;
    },
  });

  const createRoute = routes.find((route) => route.method === "post" && route.routePath === "/api/companies/:companySlug/integrations/v1/passports");
  const createRouteResponse = createResponse();
  await createRoute.handlers.at(-1)({ params: { companyId: "1" }, body: {} }, createRouteResponse);
  assert.equal(createRouteResponse.statusCode, 500);
  assert.deepEqual(createRouteResponse.body, { error: "Failed to create DPP" });

  const updateRoute = routes.find((route) => route.method === "patch" && route.routePath === "/api/companies/:companySlug/integrations/v1/passports/:dppId");
  const updateResponse = createResponse();
  await updateRoute.handlers.at(-1)({ params: { companyId: "1", dppId: "dpp-a" } }, updateResponse);
  assert.equal(updateResponse.statusCode, 500);
  assert.deepEqual(updateResponse.body, { error: "Failed to update DPP" });
});

test("dynamic-value routes hide database failures even when they carry an HTTP status", async () => {
  const { app, routes } = createRouteApp();
  const previousServerUrl = process.env.SERVER_URL;
  process.env.SERVER_URL = "https://api.example.test";
  const serverError = Object.assign(new Error("private dynamic-value failure marker"), { statusCode: 500 });
  try {
    registerCarrierSecurityRoutes(app, {
      pool: { query: async () => { throw serverError; } },
      logger: { error: () => {}, warn: () => {} },
      publicReadRateLimit: noopMiddleware,
      publicUnlockRateLimit: noopMiddleware,
    });

    const route = routes.find((entry) => entry.routePath === "/api/public/passports/:dppId/dynamic-values");
    const response = createResponse();
    await route.handlers.at(-1)({ params: { dppId: "dpp-a" }, headers: {} }, response);
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, { error: "Failed to fetch dynamic values" });
  } finally {
    if (previousServerUrl === undefined) delete process.env.SERVER_URL;
    else process.env.SERVER_URL = previousServerUrl;
  }
});
