"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const registerAuthRoutes = require("../src/http/routes/auth");
const registerCompanyRoutes = require("../src/http/routes/company");

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
