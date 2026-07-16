"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const registerAuthRoutes = require("../src/http/routes/auth");
const registerCompanyRoutes = require("../src/http/routes/company");
const registerAdminCompanyRoutes = require("../src/modules/admin/register-company-routes");

function createRouteApp() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (routePath, ...handlers) => routes.push({ method, routePath, handlers });
  }
  return { app, routes };
}

const noop = () => {};

test("company invitations require an editor role in addition to company membership", () => {
  const { app, routes } = createRouteApp();
  const authenticateToken = () => {};
  const checkCompanyAccess = () => {};
  const requireEditor = () => {};

  registerAuthRoutes(app, {
    pool: {}, jwt: {}, jwtSecret: "test", hashPassword: noop, verifyPassword: noop,
    generateToken: noop, hashOpaqueToken: noop, generateOneTimeToken: noop,
    validatePasswordPolicy: noop, passwordMinLength: 12, hashOtpCode: noop,
    generateOtpCode: noop, sessionCookieName: "session", setAuthCookie: noop,
    clearAuthCookie: noop, sendOtpEmail: noop, createTransporter: noop,
    brandedEmail: noop, logAudit: noop, authRateLimit: noop, otpRateLimit: noop,
    passwordResetRateLimit: noop, publicReadRateLimit: noop, authenticateToken,
    checkCompanyAccess, requireEditor, oauthService: null, backupProviderService: null,
  });

  const inviteRoute = routes.find((route) =>
    route.method === "post" && route.routePath === "/api/companies/:companyId/invite"
  );
  assert.ok(inviteRoute);
  assert.deepEqual(inviteRoute.handlers.slice(0, 3), [
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
  ]);
});

test("company identity and branding changes require company-admin authorization", () => {
  const { app, routes } = createRouteApp();
  const authenticateToken = () => {};
  const checkCompanyAccess = () => {};
  const checkCompanyAdmin = () => {};
  const requireEditor = () => {};

  registerCompanyRoutes(app, {
    pool: {}, authenticateToken, checkCompanyAccess, checkCompanyAdmin, requireEditor,
    getTable: noop, getPassportFieldValue: noop, getPassportTypeSchema: noop,
    normalizePassportRequestBody: noop, extractExplicitFacilityId: noop,
    normalizeInternalAliasIdValue: noop, normalizeReleaseStatus: noop,
    isEditablePassportStatus: noop, findExistingPassportByInternalAliasId: noop,
    updatePassportRowById: noop, getWritablePassportColumns: noop,
    getStoredPassportValues: noop, logAudit: noop,
    editableReleaseStatusesSql: "('draft')", systemPassportFields: new Set(),
    buildSemanticPassportJsonExport: noop, buildExpandedPassportPayload: noop,
    productIdentifierService: {}, complianceService: {},
  });

  for (const routePath of [
    "/api/companies/:companyId/profile",
    "/api/companies/:companyId/compliance-identity",
    "/api/companies/:companyId/facilities",
  ]) {
    const route = routes.find((entry) => entry.method === "post" && entry.routePath === routePath);
    assert.ok(route, `missing ${routePath}`);
    assert.deepEqual(route.handlers.slice(0, 2), [authenticateToken, checkCompanyAdmin]);
    assert.equal(route.handlers.includes(requireEditor), false);
    assert.equal(route.handlers.includes(checkCompanyAccess), false);
  }
});

test("passport template filtering uses the quoted canonical passport type column", async () => {
  const { app, routes } = createRouteApp();
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };

  registerCompanyRoutes(app, {
    pool, authenticateToken: noop, checkCompanyAccess: noop, checkCompanyAdmin: noop, requireEditor: noop,
    getTable: noop, getPassportFieldValue: noop, getPassportTypeSchema: noop,
    normalizePassportRequestBody: noop, extractExplicitFacilityId: noop,
    normalizeInternalAliasIdValue: noop, normalizeReleaseStatus: noop,
    isEditablePassportStatus: noop, findExistingPassportByInternalAliasId: noop,
    updatePassportRowById: noop, getWritablePassportColumns: noop,
    getStoredPassportValues: noop, logAudit: noop,
    editableReleaseStatusesSql: "('draft')", systemPassportFields: new Set(),
    buildSemanticPassportJsonExport: noop, buildExpandedPassportPayload: noop,
    productIdentifierService: {}, complianceService: {},
  });

  const route = routes.find((entry) =>
    entry.method === "get" && entry.routePath === "/api/companies/:companyId/templates"
  );
  assert.ok(route);
  const handler = route.handlers.at(-1);
  const response = {
    json(body) {
      this.body = body;
      return this;
    },
  };

  await handler({ params: { companyId: "7" }, query: { passportType: "batteryPassportV1" } }, response);

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /AND t\."passportType" = \$2/);
  assert.deepEqual(queries[0].params, ["7", "batteryPassportV1"]);
});

test("asset-management access changes require a super admin, strict booleans, and an audit event", async () => {
  const { app, routes } = createRouteApp();
  const queries = [];
  const audits = [];
  let released = false;
  const authenticateToken = () => {};
  const isSuperAdmin = () => {};
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("UPDATE companies")) {
        return {
          rows: [{
            id: 7,
            companyName: "Example Manufacturer",
            isActive: true,
            assetManagementEnabled: false,
            assetManagementRevokedAt: "2026-07-16T00:00:00.000Z",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('UPDATE "assetManagementJobs"')) return { rows: [], rowCount: 2 };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {
      released = true;
    },
  };
  registerAdminCompanyRoutes(app, {
    pool: { connect: async () => client },
    authenticateToken,
    isSuperAdmin,
    verifyPassword: noop,
    logAudit: async (...args) => audits.push(args),
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
    companyTrustLevels: new Set(),
  });

  const route = routes.find((entry) =>
    entry.method === "patch" && entry.routePath === "/api/admin/companies/:companyId/asset-management"
  );
  assert.ok(route);
  assert.deepEqual(route.handlers.slice(0, 2), [authenticateToken, isSuperAdmin]);
  const handler = route.handlers.at(-1);
  const response = {
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

  await handler({
    params: { companyId: "7" },
    body: { enabled: false },
    user: { userId: 99 },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.company.assetManagementEnabled, false);
  assert.equal(response.body.jobsDeactivated, 2);
  assert.equal(released, true);
  assert.deepEqual(audits, [[
    7,
    99,
    "setAssetManagementEnabled",
    "companies",
    "7",
    null,
    { enabled: false, jobsDeactivated: 2 },
  ]]);
  assert.equal(queries.some(({ sql }) => sql.includes('UPDATE "assetManagementJobs"')), true);

  const queryCount = queries.length;
  const invalidResponse = {
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
  await handler({
    params: { companyId: "7" },
    body: { enabled: "false" },
    user: { userId: 99 },
  }, invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(invalidResponse.body.error, "enabled must be a boolean");
  assert.equal(queries.length, queryCount);
});
