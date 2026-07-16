"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const registerPreviewManagementRoutes = require("../src/modules/passports/register-preview-management-routes");

const previousServerUrl = process.env.SERVER_URL;
process.env.SERVER_URL = "https://api.example.test";
test.after(() => {
  if (previousServerUrl === undefined) delete process.env.SERVER_URL;
  else process.env.SERVER_URL = previousServerUrl;
});

function createRouteApp() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "delete"]) {
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

test("passport edit-session routes verify that the passport belongs to the requested company", async () => {
  const { app, routes } = createRouteApp();
  const resolverCalls = [];
  let readCalls = 0;
  let clearCalls = 0;
  const noop = (_req, _res, next) => next?.();

  registerPreviewManagementRoutes(app, {
    crypto,
    pool: {
      async query() {
        throw new Error("foreign passport must be rejected before edit-session persistence is touched");
      },
    },
    authenticateToken: noop,
    checkCompanyAccess: noop,
    requireEditor: noop,
    editSessionTimeoutHours: 1,
    resolveCompanyPreviewPassport: async (input) => {
      resolverCalls.push(input);
      return null;
    },
    listActiveEditSessions: async () => {
      readCalls += 1;
      return [];
    },
    clearExpiredEditSessions: async () => {
      clearCalls += 1;
    },
  });

  for (const [method, routePath] of [
    ["get", "/api/companies/:companyId/passports/:dppId/edit-session"],
    ["post", "/api/companies/:companyId/passports/:dppId/edit-session"],
    ["delete", "/api/companies/:companyId/passports/:dppId/edit-session"],
  ]) {
    const route = routes.find((entry) => entry.method === method && entry.routePath === routePath);
    assert.ok(route, `missing ${method} ${routePath}`);
    const response = createResponse();
    await route.handlers.at(-1)({
      params: { companyId: "company-a", dppId: "company-b-passport" },
      body: { passportType: "battery" },
      user: { userId: 7 },
    }, response);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, { error: "Passport not found" });
  }

  assert.deepEqual(resolverCalls, [
    { companyId: "company-a", passportKey: "company-b-passport" },
    { companyId: "company-a", passportKey: "company-b-passport" },
    { companyId: "company-a", passportKey: "company-b-passport" },
  ]);
  assert.equal(readCalls, 0);
  assert.equal(clearCalls, 0);
});
