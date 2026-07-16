"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const registerLifecycleRoutes = require("../src/modules/passports/register-lifecycle-routes");

function createRouteApp() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "patch"]) {
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

test("passport revision lookup is scoped to the requested company", async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  const { app, routes } = createRouteApp();
  const noop = (_req, _res, next) => next?.();

  registerLifecycleRoutes(app, {
    pool,
    logger: { error() {} },
    authenticateToken: noop,
    checkCompanyAccess: noop,
    requireEditor: noop,
    getTable: () => '"batteryPassports"',
  });

  const route = routes.find((entry) =>
    entry.method === "post"
    && entry.routePath === "/api/companies/:companyId/passports/:dppId/revise"
  );
  assert.ok(route);

  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "company-a", dppId: "company-b-passport" },
    body: { passportType: "battery" },
    user: { userId: "editor-a" },
  }, response);

  assert.equal(response.statusCode, 404);
  assert.equal(queries.length, 1);
  assert.match(
    queries[0].sql,
    /WHERE "dppId" = \$1\s+AND "companyId" = \$2\s+AND "releaseStatus" = 'released'\s+AND "deletedAt" IS NULL/
  );
  assert.deepEqual(queries[0].params, ["company-b-passport", "company-a"]);
});
