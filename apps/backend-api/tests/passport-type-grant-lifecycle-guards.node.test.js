"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const registerLifecycleRoutes = require("../src/modules/passports/register-lifecycle-routes");
const registerDeleteRoutes = require("../src/modules/passports/register-delete-routes");
const registerBulkLifecycleRoutes = require("../src/modules/passports/register-bulk-lifecycle-routes");

const typeSchema = { typeName: "batteryPassportV1" };
const noop = (_req, _res, next) => next?.();

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

function inaccessibleTypeDeps() {
  return {
    logger: { error() {}, warn() {} },
    authenticateToken: noop,
    checkCompanyAccess: noop,
    requireEditor: noop,
    getPassportTypeSchema: async () => typeSchema,
    hasCompanyPassportTypeAccess: async () => false,
    getTable() {
      throw new Error("A denied passport type must not reach table resolution");
    },
  };
}

test("lifecycle mutations reject a revoked passport type before querying its table", async () => {
  let queried = false;
  const { app, routes } = createRouteApp(["get", "post", "patch"]);
  registerLifecycleRoutes(app, {
    ...inaccessibleTypeDeps(),
    pool: { query: async () => { queried = true; throw new Error("unexpected query"); } },
  });

  const route = routes.find((entry) => entry.routePath.endsWith("/:dppId/revise"));
  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "company-1", dppId: "dpp-1" },
    body: { passportType: "battery" },
    user: { userId: "editor-1" },
  }, response);

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "Passport type not found for this company");
  assert.equal(queried, false);
});

test("single-passport deletion rejects a revoked passport type before querying its table", async () => {
  let queried = false;
  const { app, routes } = createRouteApp(["delete"]);
  registerDeleteRoutes(app, {
    ...inaccessibleTypeDeps(),
    pool: { query: async () => { queried = true; throw new Error("unexpected query"); } },
  });

  const route = routes.find((entry) => entry.routePath.endsWith("/:dppId"));
  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "company-1", dppId: "dpp-1" },
    body: { passportType: "battery" },
    user: { userId: "editor-1" },
  }, response);

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "Passport type not found for this company");
  assert.equal(queried, false);
});

test("bulk release rejects a revoked passport type before reading or mutating passport rows", async () => {
  let queried = false;
  const { app, routes } = createRouteApp(["post"]);
  registerBulkLifecycleRoutes(app, {
    ...inaccessibleTypeDeps(),
    pool: { query: async () => { queried = true; throw new Error("unexpected query"); } },
  });

  const route = routes.find((entry) => entry.routePath.endsWith("/bulk-release"));
  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "company-1" },
    body: { items: [{ dppId: "dpp-1", passportType: "battery" }] },
    user: { userId: "editor-1" },
  }, response);

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "Passport type not found for this company");
  assert.equal(queried, false);
});

test("bulk revise stops after its registry lookup when a resolved type is no longer granted", async () => {
  let queries = 0;
  const { app, routes } = createRouteApp(["post"]);
  registerBulkLifecycleRoutes(app, {
    ...inaccessibleTypeDeps(),
    pool: {
      query: async () => {
        queries += 1;
        return { rows: [{ dppId: "dpp-1", passportType: "battery" }] };
      },
    },
  });

  const route = routes.find((entry) => entry.routePath.endsWith("/bulk-revise"));
  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "company-1" },
    body: {
      items: [{ dppId: "dpp-1" }],
      changes: { modelName: "Updated" },
    },
    user: { userId: "editor-1" },
  }, response);

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "Passport type not found for this company");
  assert.equal(queries, 1);
});
