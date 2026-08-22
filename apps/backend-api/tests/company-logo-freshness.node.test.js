"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const registerCompanyRoutes = require("../src/http/routes/company");

const noop = () => {};

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
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function registerProfileRoutes(pool) {
  const { app, routes } = createRouteApp();
  registerCompanyRoutes(app, {
    pool,
    authenticateToken: noop,
    checkCompanyAccess: noop,
    checkCompanyAdmin: noop,
    requireEditor: noop,
    getTable: noop,
    getPassportFieldValue: noop,
    getPassportTypeSchema: noop,
    hasCompanyPassportTypeAccess: noop,
    assertPassportTypeStorageReady: noop,
    normalizePassportRequestBody: noop,
    extractExplicitFacilityId: noop,
    normalizeInternalAliasIdValue: noop,
    normalizeReleaseStatus: noop,
    isEditablePassportStatus: noop,
    findExistingPassportByInternalAliasId: noop,
    updatePassportRowById: noop,
    getWritablePassportColumns: noop,
    getStoredPassportValues: noop,
    logAudit: noop,
    editableReleaseStatusesSql: "('draft')",
    systemPassportFields: new Set(),
    buildSemanticPassportJsonExport: noop,
    buildExpandedPassportPayload: noop,
    productIdentifierService: {},
    complianceService: {},
  });
  return routes;
}

test("company-logo profile reads and removals cannot leave stale cached branding", async () => {
  const queries = [];
  const routes = registerProfileRoutes({
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('SELECT "companyName" AS "companyName"')) {
        return {
          rows: [{
            companyName: "Example Company",
            companyLogo: "data:image/png;base64,iVBORw0KGgo=",
            didSlug: "example-company",
          }],
        };
      }
      if (sql.includes('UPDATE companies')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  });
  const profileGet = routes.find((route) => route.method === "get" && route.routePath === "/api/companies/:companyId/profile");
  const profilePost = routes.find((route) => route.method === "post" && route.routePath === "/api/companies/:companyId/profile");
  assert.ok(profileGet);
  assert.ok(profilePost);

  const readResponse = createResponse();
  await profileGet.handlers.at(-1)({ params: { companyId: "7" } }, readResponse);
  assert.equal(readResponse.statusCode, 200);
  assert.equal(readResponse.headers["Cache-Control"], "no-store");
  assert.equal(readResponse.headers.Pragma, "no-cache");
  assert.equal(readResponse.headers.Expires, "0");
  assert.equal(readResponse.body.companyLogo, "data:image/png;base64,iVBORw0KGgo=");

  const removeResponse = createResponse();
  await profilePost.handlers.at(-1)({
    params: { companyId: "7" },
    body: { companyLogo: null },
  }, removeResponse);
  assert.equal(removeResponse.statusCode, 200);
  assert.equal(removeResponse.headers["Cache-Control"], "no-store");
  const update = queries.find((query) => query.sql.includes('UPDATE companies'));
  assert.ok(update);
  assert.deepEqual(update.params, [null, "7"]);
});

test("public and preview passport responses opt out of stale branding caches", () => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const publicRoutes = fs.readFileSync(path.join(repoRoot, "apps/backend-api/src/http/routes/passport-public.js"), "utf8");
  const previewRoutes = fs.readFileSync(path.join(repoRoot, "apps/backend-api/src/modules/passports/register-preview-management-routes.js"), "utf8");

  assert.match(publicRoutes, /handleCanonicalPassportRequest[\s\S]*?res\.setHeader\("Cache-Control", "no-store"\)/);
  assert.match(publicRoutes, /\/api\/public\/companies\/:companySlug\/profile[\s\S]*?res\.setHeader\("Cache-Control", "no-store"\)/);
  assert.match(previewRoutes, /function setNoStoreHeaders\(res\)[\s\S]*?res\.setHeader\("Cache-Control", "no-store"\)/);
  assert.match(previewRoutes, /\/api\/companies\/:companyId\/passports\/:passportKey\/preview[\s\S]*?setNoStoreHeaders\(res\)/);
});
