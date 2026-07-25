"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const registerMutationRoutes = require("../src/modules/dpp-api/register-mutation-routes");
const { createDppUseCase } = require("../src/modules/dpp-api/application/create-dpp");

const noopMiddleware = (_req, _res, next) => next?.();

function createRouteApp() {
  const routes = [];
  const app = {};
  for (const method of ["delete", "options", "patch", "post"]) {
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

function registerRoutes({ editable = null, released = null, hasCompanyPassportTypeAccess }) {
  const { app, routes } = createRouteApp();
  registerMutationRoutes(app, {
    pool: {
      query: async () => {
        throw new Error("a revoked passport type must be rejected before querying rows");
      },
    },
    logger: { error() {}, warn() {} },
    authenticateToken: noopMiddleware,
    requireBearerToken: noopMiddleware,
    integrationWriteRateLimit: noopMiddleware,
    requireEditor: noopMiddleware,
    resolveEditablePassportByDppId: async () => editable,
    resolveActiveReleasedPassportByDppId: async () => released,
    isEditablePassportStatus: () => true,
    parseDppIdentifier: () => ({ type: "dpp" }),
    hasCompanyPassportTypeAccess,
  });
  return routes;
}

const passport = {
  dppId: "dpp-grant-test",
  companyId: 7,
  passportType: "batteryPassportV1",
  releaseStatus: "draft",
};

const request = {
  params: { companyId: "7", companySlug: "acme", dppId: "dpp-grant-test" },
  user: { userId: 9, companyId: 7, role: "companyAdmin" },
};

test("standards CREATE rejects a revoked passport type before any database write", async () => {
  const accessCalls = [];
  const createDpp = createDppUseCase({
    pool: {
      query: async () => {
        throw new Error("a revoked passport type must be rejected before querying or writing");
      },
    },
    normalizePassportRequestBody: (body) => body,
    getPassportTypeSchema: async () => ({ typeName: "batteryPassportV1" }),
    hasCompanyPassportTypeAccess: async (companyId, passportType) => {
      accessCalls.push([companyId, passportType]);
      return false;
    },
  });

  await assert.rejects(
    () => createDpp({
      req: {
        params: { companyId: "7" },
        body: { passportType: "batteryPassportV1", productIdentifier: "BAT-1" },
        user: { userId: 9, companyId: 7, role: "companyAdmin" },
      },
    }),
    (error) => error.statusCode === 404 && error.message === "Passport type not found for this company"
  );
  assert.deepEqual(accessCalls, [[7, "batteryPassportV1"]]);
});

test("standards CREATE lets a super-admin bypass a company passport type grant", async () => {
  const createDpp = createDppUseCase({
    normalizePassportRequestBody: (body) => body,
    normalizeInternalAliasIdValue: (value) => String(value || "").trim(),
    getPassportTypeSchema: async () => ({ typeName: "batteryPassportV1" }),
    hasCompanyPassportTypeAccess: async () => {
      throw new Error("super-admin must not query a company passport type grant");
    },
  });

  await assert.rejects(
    () => createDpp({
      req: {
        params: { companyId: "7" },
        body: { passportType: "batteryPassportV1", productIdentifier: "" },
        user: { userId: 1, role: "superAdmin" },
      },
    }),
    (error) => error.statusCode === 400 && error.message === "productIdentifier is required"
  );
});

test("standards DELETE rejects a revoked passport type before deleting a draft", async () => {
  const accessCalls = [];
  const routes = registerRoutes({
    editable: { passport, tableName: '"batteryPassports"' },
    hasCompanyPassportTypeAccess: async (companyId, passportType) => {
      accessCalls.push([companyId, passportType]);
      return false;
    },
  });
  const route = routes.find((entry) => (
    entry.method === "delete"
    && entry.routePath === "/api/companies/:companySlug/integrations/v1/passports/:dppId"
  ));
  const response = createResponse();

  await route.handlers.at(-1)(request, response);

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: "Passport type not found for this company" });
  assert.deepEqual(accessCalls, [[7, "batteryPassportV1"]]);
});

test("standards archive rejects a revoked passport type before reading the lineage", async () => {
  const accessCalls = [];
  const routes = registerRoutes({
    released: { passport: { ...passport, releaseStatus: "released" }, tableName: '"batteryPassports"' },
    hasCompanyPassportTypeAccess: async (companyId, passportType) => {
      accessCalls.push([companyId, passportType]);
      return false;
    },
  });
  const route = routes.find((entry) => (
    entry.method === "post"
    && entry.routePath === "/api/companies/:companySlug/integrations/v1/passports/:dppId/archive"
  ));
  const response = createResponse();

  await route.handlers.at(-1)(request, response);

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: "Passport type not found for this company" });
  assert.deepEqual(accessCalls, [[7, "batteryPassportV1"]]);
});
