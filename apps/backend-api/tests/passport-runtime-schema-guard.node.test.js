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
    hasCompanyPassportTypeAccess: async () => true,
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

test("ordinary create routes require an active company passport type grant before storage access", async () => {
  const accessCalls = [];
  const readinessCalls = [];
  const app = createRouteApp();
  registerCreateRoutes(app, {
    logger: { error() {} },
    authenticateToken: () => {},
    checkCompanyAccess: () => {},
    requireEditor: () => {},
    normalizePassportRequestBody: (body) => body || {},
    getPassportTypeSchema: async () => ({ typeName: "batteryPassportV1" }),
    hasCompanyPassportTypeAccess: async (companyId, typeName) => {
      accessCalls.push([companyId, typeName]);
      return false;
    },
    assertPassportTypeStorageReady: async (typeName) => {
      readinessCalls.push(typeName);
    },
  });

  for (const [path, body] of [
    ["/api/companies/:companyId/passports", { passportType: "battery" }],
    ["/api/companies/:companyId/passports/bulk", { passportType: "battery", passports: [{}] }],
  ]) {
    const response = createResponse();
    await findRoute(app, "post", path)({
      params: { companyId: "7" },
      user: { userId: 9, role: "editor" },
      body,
    }, response);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, { error: "Passport type not found for this company" });
  }

  assert.deepEqual(accessCalls, [
    ["7", "batteryPassportV1"],
    ["7", "batteryPassportV1"],
  ]);
  assert.deepEqual(readinessCalls, []);
});

test("super-admin create routes bypass company passport type grants", async () => {
  const readinessCalls = [];
  const app = createRouteApp();
  registerCreateRoutes(app, {
    logger: { error() {} },
    authenticateToken: () => {},
    checkCompanyAccess: () => {},
    requireEditor: () => {},
    normalizePassportRequestBody: (body) => body || {},
    getPassportTypeSchema: async () => ({ typeName: "batteryPassportV1" }),
    hasCompanyPassportTypeAccess: async () => {
      throw new Error("super-admin must not query a company grant");
    },
    assertPassportTypeStorageReady: createNotReadyGuard(readinessCalls),
  });

  const response = createResponse();
  await findRoute(app, "post", "/api/companies/:companyId/passports")({
    params: { companyId: "7" },
    user: { userId: 1, role: "superAdmin" },
    body: { passportType: "battery" },
  }, response);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(readinessCalls, ["batteryPassportV1"]);
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
    hasCompanyPassportTypeAccess: async () => true,
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

test("ordinary update routes require an active company passport type grant before storage access", async () => {
  const accessCalls = [];
  const readinessCalls = [];
  const app = createRouteApp();
  registerUpdateRoutes(app, {
    logger: { error() {} },
    authenticateToken: () => {},
    checkCompanyAccess: () => {},
    requireEditor: () => {},
    normalizePassportRequestBody: (body) => body || {},
    getPassportTypeSchema: async () => ({ typeName: "batteryPassportV1", allowedKeys: new Set() }),
    hasCompanyPassportTypeAccess: async (companyId, typeName) => {
      accessCalls.push([companyId, typeName]);
      return false;
    },
    assertPassportTypeStorageReady: async (typeName) => {
      readinessCalls.push(typeName);
    },
  });

  const requests = [
    {
      path: "/api/companies/:companyId/passports/bulk-update-all",
      body: { passportType: "battery", update: { modelName: "Updated" } },
    },
    {
      path: "/api/companies/:companyId/passports/:dppId",
      params: { dppId: "dpp-1" },
      body: { passportType: "battery", modelName: "Updated" },
    },
    {
      path: "/api/companies/:companyId/passports",
      body: { passportType: "battery", passports: [{}] },
    },
  ];

  for (const request of requests) {
    const response = createResponse();
    await findRoute(app, "patch", request.path)({
      params: { companyId: "7", ...(request.params || {}) },
      user: { userId: 9, role: "editor" },
      body: request.body,
    }, response);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, { error: "Passport type not found for this company" });
  }

  assert.deepEqual(accessCalls, [
    ["7", "batteryPassportV1"],
    ["7", "batteryPassportV1"],
    ["7", "batteryPassportV1"],
  ]);
  assert.deepEqual(readinessCalls, []);
});
