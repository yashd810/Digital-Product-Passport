"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const registerCompanyRoutes = require("../src/modules/admin/register-company-routes");
const registerUserAccessRoutes = require("../src/modules/admin/register-user-access-routes");
const registerPassportSupportRoutes = require("../src/modules/passports/register-support-routes");
const createPassportService = require("../src/services/passport-service");

function createRouteApp() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
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

const noop = () => {};

function createPassportServiceForAccessCheck(pool) {
  return createPassportService({
    pool,
    getTable: () => '"passports"',
    normalizePassportRow: (value) => value,
    normalizeReleaseStatus: (value) => value,
    isPublicHistoryStatus: () => false,
    isEditablePassportStatus: () => true,
    generateInternalAliasIdValue: () => "",
    inRevisionStatus: "inRevision",
    systemPassportFields: new Set(),
    getWritablePassportColumns: () => [],
    getStoredPassportValues: () => [],
    quoteSqlIdentifier: (value) => `"${value}"`,
    joinQuotedSqlIdentifiers: () => "",
    toStoredPassportValue: (value) => value,
    coerceBulkFieldValue: (value) => value,
    comparableHistoryFieldValue: (value) => value,
    formatHistoryFieldValue: (value) => String(value ?? ""),
    getHistoryFieldDefs: () => [],
    flattenSchemaFieldsFromSections: () => [],
    buildCurrentPublicPassportPath: () => "",
    buildInactivePublicPassportPath: () => "",
    createTransporter: null,
    brandedEmail: () => "",
    renderInfoTable: () => "",
  });
}

test("central passport access check requires an active, non-revoked type grant", async () => {
  const queries = [];
  const service = createPassportServiceForAccessCheck({
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [{ present: true }] };
    },
  });

  assert.equal(await service.hasCompanyPassportTypeAccess("7", "batteryV1"), true);
  assert.equal(await service.hasCompanyPassportTypeAccess("not-a-company", "batteryV1"), false);
  assert.equal(await service.hasCompanyPassportTypeAccess("7.5", "batteryV1"), false);
  assert.equal(await service.hasCompanyPassportTypeAccess("7", ""), false);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, [7, "batteryV1"]);
  assert.match(queries[0].sql, /COALESCE\(cpa\."accessRevoked", false\) = false/);
  assert.match(queries[0].sql, /pt\."isActive" = true/);
});

test("passport type access routes require super-admin authorization", () => {
  const { app, routes } = createRouteApp();
  const authenticateToken = () => {};
  const isSuperAdmin = () => {};

  registerUserAccessRoutes(app, {
    pool: {},
    authenticateToken,
    isSuperAdmin,
    getTable: noop,
    logAudit: noop,
  });

  for (const [method, routePath] of [
    ["get", "/api/admin/companies/:companyId/passport-type-access"],
    ["post", "/api/admin/company-access"],
    ["delete", "/api/admin/company-access/:companyId/:typeId"],
  ]) {
    const route = routes.find((entry) => entry.method === method && entry.routePath === routePath);
    assert.ok(route, `missing ${method.toUpperCase()} ${routePath}`);
    assert.deepEqual(route.handlers.slice(0, 2), [authenticateToken, isSuperAdmin]);
  }
});

test("super admins can change only company-member roles and the action stays in the admin audit trail", async () => {
  const { app, routes } = createRouteApp();
  const queries = [];
  const audits = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("FROM users") && sql.includes("role IN ('companyAdmin', 'editor', 'viewer')")) {
        return { rows: [{ id: 14, role: "editor", companyId: 7, email: "editor@example.test" }] };
      }
      if (sql.includes("UPDATE users")) {
        return { rows: [{ id: 14, role: "viewer", companyId: 7, email: "editor@example.test" }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  registerUserAccessRoutes(app, {
    pool,
    authenticateToken: noop,
    isSuperAdmin: noop,
    getTable: noop,
    logAudit: async (...args) => audits.push(args),
  });

  const route = routes.find((entry) =>
    entry.method === "patch" && entry.routePath === "/api/admin/users/:userId/role"
  );
  const response = createResponse();
  await route.handlers.at(-1)({
    params: { userId: "14" },
    body: { role: "viewer" },
    user: { userId: 99, role: "superAdmin", actorIdentifier: "admin@example.test" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { success: true });
  assert.equal(queries.some(({ sql }) => sql.includes("UPDATE users")), true);
  assert.equal(audits.length, 1);
  assert.equal(audits[0][0], 7);
  assert.equal(audits[0][2], "updateCompanyUserRole");
  assert.deepEqual(audits[0][5], { role: "editor", companyId: 7, email: "editor@example.test" });
  assert.equal(audits[0][7].audience, "superAdmin");
});

test("company role endpoint never converts a super-admin account into a company role", async () => {
  const { app, routes } = createRouteApp();
  let updateAttempted = false;
  const pool = {
    async query(sql) {
      if (sql.includes("UPDATE users")) updateAttempted = true;
      return { rows: [] };
    },
  };
  const audits = [];
  registerUserAccessRoutes(app, {
    pool,
    authenticateToken: noop,
    isSuperAdmin: noop,
    getTable: noop,
    logAudit: async (...args) => audits.push(args),
  });
  const route = routes.find((entry) =>
    entry.method === "patch" && entry.routePath === "/api/admin/users/:userId/role"
  );
  const response = createResponse();
  await route.handlers.at(-1)({
    params: { userId: "3" },
    body: { role: "companyAdmin" },
    user: { userId: 99, role: "superAdmin" },
  }, response);

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "Company user not found");
  assert.equal(updateAttempted, false);
  assert.equal(audits.length, 0);
});

test("company access view returns explicit active and revoked state for every passport type", async () => {
  const { app, routes } = createRouteApp();
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("FROM companies")) {
        return { rows: [{ id: 7, companyName: "Example AB", isActive: true }] };
      }
      if (sql.includes('FROM "passportTypes" pt')) {
        return {
          rows: [
            { id: 3, typeName: "batteryV1", displayName: "Battery", isActive: true, accessGranted: true },
            { id: 4, typeName: "textileV1", displayName: "Textile", isActive: false, accessGranted: false },
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  registerUserAccessRoutes(app, {
    pool,
    authenticateToken: noop,
    isSuperAdmin: noop,
    getTable: noop,
    logAudit: noop,
  });

  const route = routes.find((entry) =>
    entry.method === "get" && entry.routePath === "/api/admin/companies/:companyId/passport-type-access"
  );
  const response = createResponse();
  await route.handlers.at(-1)({ params: { companyId: "7" } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.company.companyName, "Example AB");
  assert.deepEqual(response.body.passportTypes.map((type) => type.accessGranted), [true, false]);
  assert.deepEqual(queries[1].params, [7]);
  assert.match(queries[1].sql, /COALESCE\(cpa\."accessRevoked", false\) = false/);
});

test("granting passport type access is transactional, audited, and reactivates a revoked grant", async () => {
  const { app, routes } = createRouteApp();
  const queries = [];
  const audits = [];
  let released = false;
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes("FROM companies")) {
        return { rows: [{ id: 7, companyName: "Example AB", isActive: true }] };
      }
      if (sql.includes('FROM "passportTypes"')) {
        return { rows: [{ id: 3, typeName: "batteryV1", displayName: "Battery", isActive: true }] };
      }
      if (sql.includes('INSERT INTO "companyPassportAccess"')) {
        return {
          rows: [{ id: 11, companyId: 7, passportTypeId: 3, accessRevoked: false, grantedAt: "now" }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {
      released = true;
    },
  };
  registerUserAccessRoutes(app, {
    pool: { connect: async () => client },
    authenticateToken: noop,
    isSuperAdmin: noop,
    getTable: (typeName) => `"passport_${typeName}"`,
    logAudit: async (...args) => audits.push(args),
  });

  const route = routes.find((entry) =>
    entry.method === "post" && entry.routePath === "/api/admin/company-access"
  );
  const response = createResponse();
  await route.handlers.at(-1)({
    body: { companyId: 7, passportTypeId: 3 },
    user: { userId: 99, role: "superAdmin", actorIdentifier: "user:99" },
  }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.access.accessRevoked, false);
  assert.equal(released, true);
  assert.equal(queries[0].sql, "BEGIN");
  assert.equal(queries.at(-1).sql, "COMMIT");
  const upsert = queries.find(({ sql }) => sql.includes('INSERT INTO "companyPassportAccess"'));
  assert.match(upsert.sql, /ON CONFLICT \("companyId", "passportTypeId"\) DO UPDATE/);
  assert.match(upsert.sql, /"grantedAt" = CURRENT_TIMESTAMP/);
  assert.equal(audits.length, 1);
  assert.equal(audits[0][2], "grantPassportTypeAccess");
  assert.equal(audits[0][7].client, client);
});

test("revoking passport type access is transactional and leaves passport records unchanged", async () => {
  const { app, routes } = createRouteApp();
  const queries = [];
  const audits = [];
  let released = false;
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes('FROM "passportTypes"')) {
        return { rows: [{ typeName: "batteryV1", displayName: "Battery" }] };
      }
      if (sql.includes('UPDATE "companyPassportAccess"')) return { rows: [{ id: 11 }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {
      released = true;
    },
  };
  registerUserAccessRoutes(app, {
    pool: { connect: async () => client },
    authenticateToken: noop,
    isSuperAdmin: noop,
    getTable: (typeName) => `"passport_${typeName}"`,
    logAudit: async (...args) => audits.push(args),
  });

  const route = routes.find((entry) =>
    entry.method === "delete" && entry.routePath === "/api/admin/company-access/:companyId/:typeId"
  );
  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "7", typeId: "3" },
    user: { userId: 99, role: "superAdmin" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(released, true);
  const revoke = queries.find(({ sql }) => sql.includes('UPDATE "companyPassportAccess"'));
  assert.match(revoke.sql, /COALESCE\("accessRevoked", false\) = false/);
  assert.equal(queries.some(({ sql }) => sql.includes('UPDATE "passport_batteryV1"')), false);
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.equal(audits[0][2], "revokePassportTypeAccess");
});

test("revoking an absent grant returns not found without an audit event", async () => {
  const { app, routes } = createRouteApp();
  const queries = [];
  const audits = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes('FROM "passportTypes"')) {
        return { rows: [{ typeName: "batteryV1", displayName: "Battery" }] };
      }
      if (sql.includes('UPDATE "companyPassportAccess"')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };
  registerUserAccessRoutes(app, {
    pool: { connect: async () => client },
    authenticateToken: noop,
    isSuperAdmin: noop,
    getTable: (typeName) => `"passport_${typeName}"`,
    logAudit: async (...args) => audits.push(args),
  });

  const route = routes.find((entry) =>
    entry.method === "delete" && entry.routePath === "/api/admin/company-access/:companyId/:typeId"
  );
  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "7", typeId: "3" },
    user: { userId: 99, role: "superAdmin" },
  }, response);

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "Active access grant not found");
  assert.equal(queries.at(-1).sql, "ROLLBACK");
  assert.equal(queries.some(({ sql }) => sql === "COMMIT"), false);
  assert.equal(audits.length, 0);
});

test("company listings exclude revoked passport type grants", async () => {
  const { app, routes } = createRouteApp();
  let listSql = "";
  const pool = {
    async query(sql) {
      listSql = sql;
      return { rows: [] };
    },
  };
  registerCompanyRoutes(app, {
    pool,
    authenticateToken: noop,
    isSuperAdmin: noop,
    verifyPassword: noop,
    logAudit: noop,
    backupProviderService: null,
    productIdentifierService: null,
    getTable: noop,
    ensureCompanyDppPolicy: noop,
    getCompanyDppPolicy: noop,
    validateCompanyDppPolicyInput: noop,
    updateCompanyDppPolicy: noop,
    storageService: null,
    repoBaseDir: "/tmp",
    filesBaseDir: "/tmp",
    companyTrustLevels: new Set(["basic"]),
  });

  const route = routes.find((entry) =>
    entry.method === "get" && entry.routePath === "/api/admin/companies"
  );
  const response = createResponse();
  await route.handlers.at(-1)({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, []);
  assert.match(listSql, /LEFT JOIN "companyPassportAccess" cpa\s+ON cpa\."companyId" = c\.id\s+AND COALESCE\(cpa\."accessRevoked", false\) = false/);
});

test("company dashboard passport type lists expose only active, non-revoked grants", async () => {
  const { app, routes } = createRouteApp();
  let listSql = "";
  registerPassportSupportRoutes(app, {
    pool: {
      async query(sql) {
        listSql = sql;
        return { rows: [] };
      },
    },
    crypto: {},
    logger: { error() {} },
    authenticateToken: noop,
    checkCompanyAccess: noop,
    requireEditor: noop,
    upload: { single: () => noop },
    validatePdfUpload: noop,
    storageService: {},
    logAudit: noop,
    getTable: noop,
    getPassportLineageContext: noop,
    normalizePassportRow: noop,
    isPublicHistoryStatus: noop,
    editableReleaseStatusesSql: "('draft')",
  });

  const route = routes.find((entry) =>
    entry.method === "get" && entry.routePath === "/api/companies/:companyId/passport-types"
  );
  const response = createResponse();
  await route.handlers.at(-1)({ params: { companyId: "7" } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, []);
  assert.match(listSql, /COALESCE\(cpa\."accessRevoked", false\) = false/);
  assert.match(listSql, /pt\."isActive" = true/);
});
