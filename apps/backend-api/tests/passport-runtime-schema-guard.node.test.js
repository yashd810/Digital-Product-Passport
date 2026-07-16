"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const registerCreateRoutes = require("../src/modules/passports/register-create-routes");
const registerUpdateRoutes = require("../src/modules/passports/register-update-routes");

function createRouteApp() {
  const routes = [];
  return {
    routes,
    post(path, ...handlers) {
      routes.push({ method: "post", path, handlers });
    },
    patch(path, ...handlers) {
      routes.push({ method: "patch", path, handlers });
    },
  };
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

function findRoute(app, method, path) {
  const route = app.routes.find((entry) => entry.method === method && entry.path === path);
  if (!route) throw new Error(`Route not found: ${method} ${path}`);
  return route.handlers.at(-1);
}

function createNotReadyGuard(calls) {
  return async (typeName) => {
    calls.push(typeName);
    const error = new Error("Passport storage is not provisioned");
    error.code = "passportTypeStorageNotReady";
    error.statusCode = 503;
    throw error;
  };
}

test("ordinary create routes use read-only readiness checks instead of DDL reconciliation", async () => {
  const readinessCalls = [];
  let ddlCalls = 0;
  const app = createRouteApp();
  registerCreateRoutes(app, {
    logger: { error() {} },
    authenticateToken: () => {},
    checkCompanyAccess: () => {},
    requireEditor: () => {},
    normalizePassportRequestBody: (body) => body || {},
    getPassportTypeSchema: async () => ({ typeName: "batteryPassportV1" }),
    assertPassportTypeStorageReady: createNotReadyGuard(readinessCalls),
    createPassportTable: async () => { ddlCalls += 1; },
  });

  for (const [path, body] of [
    ["/api/companies/:companyId/passports", { passportType: "battery" }],
    ["/api/companies/:companyId/passports/bulk", { passportType: "battery", passports: [] }],
  ]) {
    const response = createResponse();
    await findRoute(app, "post", path)({
      params: { companyId: "7" },
      user: { userId: 9 },
      body,
    }, response);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error, "passportTypeStorageNotReady");
  }

  assert.deepEqual(readinessCalls, ["batteryPassportV1", "batteryPassportV1"]);
  assert.equal(ddlCalls, 0);
});

test("ordinary bulk update routes use read-only readiness checks instead of DDL reconciliation", async () => {
  const readinessCalls = [];
  let ddlCalls = 0;
  const app = createRouteApp();
  registerUpdateRoutes(app, {
    logger: { error() {} },
    authenticateToken: () => {},
    checkCompanyAccess: () => {},
    requireEditor: () => {},
    normalizePassportRequestBody: (body) => body || {},
    getPassportTypeSchema: async () => ({ typeName: "batteryPassportV1", allowedKeys: new Set() }),
    assertPassportTypeStorageReady: createNotReadyGuard(readinessCalls),
    createPassportTable: async () => { ddlCalls += 1; },
  });

  for (const [path, body] of [
    ["/api/companies/:companyId/passports/bulk-update-all", { passportType: "battery", update: { modelName: "Updated" } }],
    ["/api/companies/:companyId/passports", { passportType: "battery", passports: [] }],
  ]) {
    const response = createResponse();
    await findRoute(app, "patch", path)({
      params: { companyId: "7" },
      user: { userId: 9 },
      body,
    }, response);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error, "passportTypeStorageNotReady");
  }

  assert.deepEqual(readinessCalls, ["batteryPassportV1", "batteryPassportV1"]);
  assert.equal(ddlCalls, 0);
});
