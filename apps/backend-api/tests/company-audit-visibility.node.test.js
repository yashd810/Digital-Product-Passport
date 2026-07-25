"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const registerAuditAnalyticsRoutes = require("../src/modules/passports/register-audit-analytics-routes");
const registerAdminAnalyticsRoutes = require("../src/modules/admin/register-analytics-routes");

const noop = () => {};

function createRouteApp() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post"]) {
    app[method] = (routePath, ...handlers) => routes.push({ method, routePath, handlers });
  }
  return { app, routes };
}

function createResponse() {
  return {
    statusCode: 200,
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

function findRoute(routes, routePath) {
  const route = routes.find((candidate) => candidate.routePath === routePath);
  assert.ok(route, `Expected ${routePath} to be registered`);
  return route;
}

function registerCompanyAuditRoutes(pool) {
  const { app, routes } = createRouteApp();
  registerAuditAnalyticsRoutes(app, {
    pool,
    logger: { error: noop, warn: noop },
    authenticateToken: noop,
    checkCompanyAccess: noop,
    checkCompanyAdmin: noop,
    queryTableStats: noop,
    getTable: noop,
    verifyAuditLogChain: noop,
    buildAuditLogRootSummary: noop,
    listAuditLogAnchors: noop,
    anchorAuditLogRoot: noop,
    withAuditActorAliases: (row) => row,
    replicateAuditAnchorToBackup: noop,
    archivedHistoryFilterSql: "TRUE",
  });
  return routes;
}

test("company Recent Updates and Audit Logs share the strict member-actor SQL filter before pagination", async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return {
        rows: [{
          id: 11,
          action: "update",
          actorRole: "editor",
          oldValues: { confidentialValue: "before", status: "draft" },
          newValues: { confidentialValue: "after", modelName: "Battery" },
        }],
      };
    },
  };
  const routes = registerCompanyAuditRoutes(pool);
  const activity = findRoute(routes, "/api/companies/:companyId/activity");
  const auditLogs = findRoute(routes, "/api/companies/:companyId/audit-logs");

  const activityResponse = createResponse();
  await activity.handlers.at(-1)(
    { params: { companyId: "27" }, query: { limit: "5" } },
    activityResponse
  );
  const auditResponse = createResponse();
  await auditLogs.handlers.at(-1)(
    { params: { companyId: "27" }, query: { limit: "50", offset: "10" } },
    auditResponse
  );

  assert.equal(activityResponse.statusCode, 200);
  assert.equal(auditResponse.statusCode, 200);
  for (const response of [activityResponse, auditResponse]) {
    assert.equal(response.body[0].actorRole, "editor");
    assert.deepEqual(response.body[0].changedFields, ["confidentialValue", "modelName", "status"]);
    assert.equal(Object.hasOwn(response.body[0], "oldValues"), false);
    assert.equal(Object.hasOwn(response.body[0], "newValues"), false);
  }
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].params, ["27", 5]);
  assert.deepEqual(queries[1].params, ["27", 50, 10]);

  for (const { sql } of queries) {
    assert.match(sql, /JOIN users u ON al\."userId" = u\.id/);
    assert.match(sql, /al\."companyId" = \$1/);
    assert.match(sql, /al\."userId" IS NOT NULL/);
    assert.match(sql, /u\."companyId" = \$1/);
    assert.match(sql, /u\.role IN \('companyAdmin', 'editor', 'viewer'\)/);
    assert.match(sql, /COALESCE\(NULLIF\(al\.audience, ''\), u\.role\) <> 'superAdmin'/);
    assert.doesNotMatch(sql, /al\.action NOT IN/);
    assert.ok(sql.indexOf("u.\"companyId\" = $1") < sql.indexOf("LIMIT"));
  }
});

test("dedicated admin audit route is super-admin protected and keeps event-time super-admin activity visible", async () => {
  const authenticateToken = () => {};
  const isSuperAdmin = () => {};
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return {
        rows: [{
          id: 44,
          companyId: null,
          companyName: null,
          userId: 3,
          action: "createCompany",
          actorIdentifier: "admin@example.test",
          actorEmail: "admin@example.test",
          actorFirstName: "System",
          actorLastName: "Admin",
          actorRole: "superAdmin",
          createdAt: "2026-07-21T12:00:00.000Z",
          totalCount: 12,
        }],
      };
    },
  };
  const { app, routes } = createRouteApp();
  registerAdminAnalyticsRoutes(app, {
    pool,
    authenticateToken,
    isSuperAdmin,
    queryTableStats: noop,
    getTable: noop,
    archivedHistoryFilterSql: "TRUE",
  });

  const route = findRoute(routes, "/api/admin/audit-logs");
  assert.deepEqual(route.handlers.slice(0, 2), [authenticateToken, isSuperAdmin]);

  const response = createResponse();
  await route.handlers.at(-1)({ query: { limit: "5000", offset: "2000000" } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /al\.audience = 'superAdmin'/);
  assert.match(queries[0].sql, /NULLIF\(al\.audience, ''\) IS NULL AND u\.role = 'superAdmin'/);
  assert.match(queries[0].sql, /LEFT JOIN companies c ON al\."companyId" = c\.id/);
  assert.doesNotMatch(queries[0].sql, /al\."companyId" IS NOT NULL/);
  assert.deepEqual(queries[0].params, [500, 1000000]);
  assert.deepEqual(response.body.pagination, {
    limit: 500,
    offset: 1000000,
    returned: 1,
    total: 12,
  });
  assert.equal(response.body.entries[0].actorRole, "superAdmin");
  assert.equal(response.body.entries[0].companyId, null);
});

test("admin audit filters are parameterized and date-only upper bounds include the full day", async () => {
  let captured;
  const pool = {
    async query(sql, params) {
      captured = { sql, params };
      return { rows: [] };
    },
  };
  const { app, routes } = createRouteApp();
  registerAdminAnalyticsRoutes(app, {
    pool,
    authenticateToken: noop,
    isSuperAdmin: noop,
    queryTableStats: noop,
    getTable: noop,
    archivedHistoryFilterSql: "TRUE",
  });
  const route = findRoute(routes, "/api/admin/audit-logs");
  const response = createResponse();

  await route.handlers.at(-1)({
    query: {
      companyId: "18",
      action: "grantPassportTypeAccess",
      user: "Admin Person",
      from: "2026-07-01",
      to: "2026-07-21",
      limit: "25",
      offset: "50",
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.match(captured.sql, /al\."companyId" = \$1/);
  assert.match(captured.sql, /al\.action = \$2/);
  assert.match(captured.sql, /u\.email ILIKE \$3/);
  assert.match(captured.sql, /al\."createdAt" >= \$4/);
  assert.match(captured.sql, /al\."createdAt" <= \$5/);
  assert.match(captured.sql, /LIMIT \$6 OFFSET \$7/);
  assert.deepEqual(captured.params, [
    18,
    "grantPassportTypeAccess",
    "%Admin Person%",
    "2026-07-01T00:00:00.000Z",
    "2026-07-21T23:59:59.999Z",
    25,
    50,
  ]);
});

test("admin audit pagination preserves the true total after the final page", async () => {
  const pool = {
    async query() {
      return { rows: [{ id: null, totalCount: 12 }] };
    },
  };
  const { app, routes } = createRouteApp();
  registerAdminAnalyticsRoutes(app, {
    pool,
    authenticateToken: noop,
    isSuperAdmin: noop,
    queryTableStats: noop,
    getTable: noop,
    archivedHistoryFilterSql: "TRUE",
  });
  const route = findRoute(routes, "/api/admin/audit-logs");
  const response = createResponse();

  await route.handlers.at(-1)({ query: { limit: "10", offset: "20" } }, response);

  assert.deepEqual(response.body.entries, []);
  assert.deepEqual(response.body.pagination, {
    limit: 10,
    offset: 20,
    returned: 0,
    total: 12,
  });
});

test("admin audit route rejects malformed filters before querying storage", async () => {
  let queryCount = 0;
  const pool = {
    async query() {
      queryCount += 1;
      return { rows: [] };
    },
  };
  const { app, routes } = createRouteApp();
  registerAdminAnalyticsRoutes(app, {
    pool,
    authenticateToken: noop,
    isSuperAdmin: noop,
    queryTableStats: noop,
    getTable: noop,
    archivedHistoryFilterSql: "TRUE",
  });
  const route = findRoute(routes, "/api/admin/audit-logs");
  const response = createResponse();

  await route.handlers.at(-1)({ query: { companyId: "18 OR 1=1" } }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "companyId must be a positive integer");
  assert.equal(queryCount, 0);
});
