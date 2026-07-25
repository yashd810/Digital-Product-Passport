"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const registerHistoryReadRoutes = require("../src/modules/passports/register-history-read-routes");
const registerPreviewManagementRoutes = require("../src/modules/passports/register-preview-management-routes");

const previousServerUrl = process.env.SERVER_URL;
process.env.SERVER_URL = "https://api.example.test";
test.after(() => {
  if (previousServerUrl === undefined) delete process.env.SERVER_URL;
  else process.env.SERVER_URL = previousServerUrl;
});

const noopMiddleware = (_req, _res, next) => next?.();

function createRouteApp(methods) {
  const routes = [];
  const app = {};
  for (const method of methods) {
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

test("company preview refuses a passport whose type grant was revoked", async () => {
  const { app, routes } = createRouteApp(["delete", "get", "post"]);
  const accessCalls = [];
  registerPreviewManagementRoutes(app, {
    crypto,
    pool: {
      query: async () => {
        throw new Error("preview must not load data after a grant is revoked");
      },
    },
    authenticateToken: noopMiddleware,
    checkCompanyAccess: noopMiddleware,
    requireEditor: noopMiddleware,
    resolveCompanyPreviewPassport: async () => ({
      passport: { dppId: "dpp-preview", companyId: 7, passportType: "batteryPassportV1" },
    }),
    hasCompanyPassportTypeAccess: async (companyId, passportType) => {
      accessCalls.push([companyId, passportType]);
      return false;
    },
  });
  const route = routes.find((entry) => (
    entry.method === "get"
    && entry.routePath === "/api/companies/:companyId/passports/:passportKey/preview"
  ));
  const response = createResponse();

  await route.handlers.at(-1)({
    params: { companyId: "7", passportKey: "dpp-preview" },
    user: { companyId: 7, role: "companyAdmin" },
  }, response);

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: "Passport type not found for this company" });
  assert.deepEqual(accessCalls, [[7, "batteryPassportV1"]]);
});

test("company diff refuses a revoked passport type before loading lineage data", async () => {
  const { app, routes } = createRouteApp(["get"]);
  const accessCalls = [];
  registerHistoryReadRoutes(app, {
    pool: { query: async () => { throw new Error("lineage must not be queried"); } },
    logger: { error() {} },
    authenticateToken: noopMiddleware,
    checkCompanyAccess: noopMiddleware,
    getPassportTypeSchema: async () => ({ typeName: "batteryPassportV1" }),
    hasCompanyPassportTypeAccess: async (companyId, passportType) => {
      accessCalls.push([companyId, passportType]);
      return false;
    },
  });
  const route = routes.find((entry) => (
    entry.method === "get"
    && entry.routePath === "/api/companies/:companyId/passports/:dppId/diff"
  ));
  const response = createResponse();

  await route.handlers.at(-1)({
    params: { companyId: "7", dppId: "dpp-preview" },
    query: { passportType: "batteryPassportV1" },
    user: { companyId: 7, role: "companyAdmin" },
  }, response);

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: "Passport type not found for this company" });
  assert.deepEqual(accessCalls, [["7", "batteryPassportV1"]]);
});
