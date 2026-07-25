"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const registerCompanyRoutes = require("../src/http/routes/company");
const registerCompanyPassportReadRoutes = require("../src/modules/passports/register-company-passport-read-routes");

const noopMiddleware = (_req, _res, next) => next?.();

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
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

function registerReadRoutes(query, { hasCompanyPassportTypeAccess = async () => true } = {}) {
  const { app, routes } = createRouteApp();
  registerCompanyPassportReadRoutes(app, {
    pool: { query },
    logger: { error() {} },
    authenticateToken: noopMiddleware,
    checkCompanyAccess: noopMiddleware,
    normalizePassportRequestBody: (value) => value,
    getTable: () => '"batteryPassports"',
    normalizePassportRow: (value) => value,
    getPassportFieldValue: (row, key) => row[key],
    normalizeInternalAliasIdValue: (value) => value,
    getPassportTypeSchema: async () => ({
      typeName: "batteryPassportV1",
      fieldsJson: { sections: [] },
    }),
    hasCompanyPassportTypeAccess,
    inRevisionStatusesSql: "('inRevision')",
    isFullRepresentationRequest: () => false,
  });
  return routes;
}

test("company passport list applies exact, case-insensitive status filters", async () => {
  const cases = [
    {
      status: "draft",
      expectedSql: /p\."releaseStatus" = \$2/,
      expectedParams: ["7", "draft"],
    },
    {
      status: "released",
      expectedSql: /p\."releaseStatus" = \$2/,
      expectedParams: ["7", "released"],
    },
    {
      status: "inRevision",
      expectedSql: /p\."releaseStatus" IN \('inRevision'\)/,
      expectedParams: ["7"],
    },
    {
      status: "all",
      expectedSql: /WHERE p\."deletedAt" IS NULL AND p\."companyId" = \$1\s+ORDER BY/,
      expectedParams: ["7"],
    },
  ];

  for (const contract of cases) {
    const queries = [];
    const routes = registerReadRoutes(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const route = routes.find((entry) => (
      entry.method === "get"
      && entry.routePath === "/api/companies/:companyId/passports"
    ));
    const response = createResponse();
    await route.handlers.at(-1)({
      params: { companyId: "7" },
      query: { passportType: "batteryPassportV1", status: contract.status },
    }, response);

    assert.equal(response.statusCode, 200, contract.status);
    assert.equal(queries.length, 1, contract.status);
    assert.match(queries[0].sql, contract.expectedSql, contract.status);
    assert.deepEqual(queries[0].params, contract.expectedParams, contract.status);
  }
});

test("company passport reads reject an ungranted type before querying passport rows", async () => {
  let queryCount = 0;
  const accessCalls = [];
  const routes = registerReadRoutes(async () => {
    queryCount += 1;
    throw new Error("passport rows must not be queried without an active grant");
  }, {
    hasCompanyPassportTypeAccess: async (companyId, typeName) => {
      accessCalls.push([companyId, typeName]);
      return false;
    },
  });
  const route = routes.find((entry) => (
    entry.method === "get"
    && entry.routePath === "/api/companies/:companyId/passports"
  ));
  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "7" },
    query: { passportType: "batteryPassportV1" },
    user: { role: "companyAdmin" },
  }, response);

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: "Passport type not found for this company" });
  assert.deepEqual(accessCalls, [["7", "batteryPassportV1"]]);
  assert.equal(queryCount, 0);
});

test("company passport export keeps draft and inRevision as separate filters", async () => {
  const cases = [
    { status: "draft", expected: /"releaseStatus" = 'draft'/ },
    { status: "released", expected: /"releaseStatus" = 'released'/ },
    { status: "inRevision", expected: /"releaseStatus" IN \('inRevision'\)/ },
    { status: "all", expected: null },
  ];

  for (const contract of cases) {
    const queries = [];
    const routes = registerReadRoutes(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM "passportTypes"')) {
        return { rows: [{ fieldsJson: { sections: [] } }] };
      }
      return { rows: [] };
    });
    const route = routes.find((entry) => (
      entry.method === "get"
      && entry.routePath === "/api/companies/:companyId/passports/export-drafts"
    ));
    const response = createResponse();
    await route.handlers.at(-1)({
      params: { companyId: "7" },
      query: {
        passportType: "batteryPassportV1",
        format: "csv",
        status: contract.status,
      },
    }, response);

    assert.equal(response.statusCode, 200, contract.status);
    const exportQuery = queries.find((entry) => entry.sql.includes('FROM "batteryPassports"'));
    assert.ok(exportQuery, contract.status);
    if (contract.expected) {
      assert.match(exportQuery.sql, contract.expected, contract.status);
    } else {
      assert.doesNotMatch(exportQuery.sql, /"releaseStatus"/, contract.status);
    }
    if (contract.status === "draft") {
      assert.doesNotMatch(exportQuery.sql, /inRevision/, "draft must not include revisions");
    }
  }
});

test("company passport export rejects unknown status filters", async () => {
  const routes = registerReadRoutes(async (sql) => {
    if (sql.includes('FROM "passportTypes"')) {
      return { rows: [{ fieldsJson: { sections: [] } }] };
    }
    throw new Error(`Unexpected passport query: ${sql}`);
  });
  const route = routes.find((entry) => (
    entry.method === "get"
    && entry.routePath === "/api/companies/:companyId/passports/export-drafts"
  ));
  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "7" },
    query: { passportType: "batteryPassportV1", status: "editable" },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /draft, released, inRevision, all/);
});

test("CSV upsert rejects more than 500 passport columns before any write", async () => {
  const { app, routes } = createRouteApp();
  let queryCount = 0;
  registerCompanyRoutes(app, {
    pool: {
      async query() {
        queryCount += 1;
        throw new Error("CSV limit must be enforced before database writes");
      },
    },
    authenticateToken: noopMiddleware,
    checkCompanyAccess: noopMiddleware,
    checkCompanyAdmin: noopMiddleware,
    requireEditor: noopMiddleware,
    getTable: () => '"batteryPassports"',
    getPassportTypeSchema: async () => ({
      typeName: "batteryPassportV1",
      allowedKeys: new Set(["internalAliasId"]),
      fieldsJson: { sections: [] },
    }),
    hasCompanyPassportTypeAccess: async () => true,
    assertPassportTypeStorageReady: async () => {},
    normalizePassportRequestBody: (value) => value,
    systemPassportFields: new Set(),
    complianceService: {},
  });
  const route = routes.find((entry) => (
    entry.method === "post"
    && entry.routePath === "/api/companies/:companyId/passports/upsert-csv"
  ));
  const passportColumns = Array.from({ length: 501 }, (_, index) => `Passport ${index + 1}`);
  const values = Array.from({ length: 501 }, (_, index) => `BAT-${index + 1}`);
  const csv = [
    ["Field Name", ...passportColumns].join(","),
    ["Internal Alias ID", ...values].join(","),
  ].join("\n");
  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "7" },
    body: { passportType: "batteryPassportV1", csv },
    user: { userId: 9 },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Max 500 per request" });
  assert.equal(queryCount, 0);
});

test("CSV and JSON upserts require an active company passport type grant", async () => {
  const { app, routes } = createRouteApp();
  const accessCalls = [];
  let queryCount = 0;
  registerCompanyRoutes(app, {
    pool: {
      async query() {
        queryCount += 1;
        throw new Error("access must be checked before any database write");
      },
    },
    authenticateToken: noopMiddleware,
    checkCompanyAccess: noopMiddleware,
    checkCompanyAdmin: noopMiddleware,
    requireEditor: noopMiddleware,
    getTable: () => '"batteryPassports"',
    getPassportTypeSchema: async () => ({
      typeName: "batteryPassportV1",
      allowedKeys: new Set(["internalAliasId"]),
      fieldsJson: { sections: [] },
    }),
    hasCompanyPassportTypeAccess: async (companyId, typeName) => {
      accessCalls.push([companyId, typeName]);
      return false;
    },
    assertPassportTypeStorageReady: async () => {
      throw new Error("storage must not be checked before a company grant");
    },
    normalizePassportRequestBody: (value) => value,
    systemPassportFields: new Set(),
    complianceService: {},
    productIdentifierService: {},
  });

  const requests = [
    {
      path: "/api/companies/:companyId/passports/upsert-csv",
      body: {
        passportType: "batteryPassportV1",
        csv: "Field Name,Passport 1\\nInternal Alias ID,BAT-1",
      },
    },
    {
      path: "/api/companies/:companyId/passports/upsert-json",
      body: {
        passportType: "batteryPassportV1",
        passports: [{ internalAliasId: "BAT-1" }],
      },
    },
  ];

  for (const request of requests) {
    const route = routes.find((entry) => entry.method === "post" && entry.routePath === request.path);
    const response = createResponse();
    await route.handlers.at(-1)({
      params: { companyId: "7" },
      body: request.body,
      user: { userId: 9, role: "editor" },
    }, response);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, { error: "Passport type not found for this company" });
  }

  assert.deepEqual(accessCalls, [
    ["7", "batteryPassportV1"],
    ["7", "batteryPassportV1"],
  ]);
  assert.equal(queryCount, 0);
});

test("super-admin CSV and JSON upserts bypass company passport type grants", async () => {
  const { app, routes } = createRouteApp();
  registerCompanyRoutes(app, {
    pool: {
      async query() {
        throw new Error("these requests should finish before any database query");
      },
    },
    authenticateToken: noopMiddleware,
    checkCompanyAccess: noopMiddleware,
    checkCompanyAdmin: noopMiddleware,
    requireEditor: noopMiddleware,
    getTable: () => '"batteryPassports"',
    getPassportTypeSchema: async () => ({
      typeName: "batteryPassportV1",
      allowedKeys: new Set(["internalAliasId"]),
      fieldsJson: { sections: [] },
    }),
    hasCompanyPassportTypeAccess: async () => {
      throw new Error("super-admin must not query a company grant");
    },
    assertPassportTypeStorageReady: async () => {},
    normalizePassportRequestBody: (value) => value,
    normalizeInternalAliasIdValue: (value) => String(value || "").trim(),
    systemPassportFields: new Set(),
    complianceService: {},
    productIdentifierService: {},
  });

  const csvRoute = routes.find((entry) => (
    entry.method === "post" && entry.routePath === "/api/companies/:companyId/passports/upsert-csv"
  ));
  const csvResponse = createResponse();
  await csvRoute.handlers.at(-1)({
    params: { companyId: "7" },
    body: { passportType: "batteryPassportV1", csv: "Field Name,Passport 1" },
    user: { userId: 1, role: "superAdmin" },
  }, csvResponse);
  assert.equal(csvResponse.statusCode, 400);
  assert.deepEqual(csvResponse.body, { error: "CSV too short" });

  const jsonRoute = routes.find((entry) => (
    entry.method === "post" && entry.routePath === "/api/companies/:companyId/passports/upsert-json"
  ));
  const jsonResponse = createResponse();
  await jsonRoute.handlers.at(-1)({
    params: { companyId: "7" },
    body: { passportType: "batteryPassportV1", passports: [{}] },
    user: { userId: 1, role: "superAdmin" },
  }, jsonResponse);
  assert.equal(jsonResponse.statusCode, 200);
  assert.deepEqual(jsonResponse.body.summary, { created: 0, updated: 0, skipped: 1, failed: 0 });
});

test("CSV and JSON upserts verify storage readiness before parsing or writing", async () => {
  const { app, routes } = createRouteApp();
  const readinessCalls = [];
  let queryCount = 0;
  registerCompanyRoutes(app, {
    pool: {
      async query() {
        queryCount += 1;
        throw new Error("storage readiness must run before database writes");
      },
    },
    authenticateToken: noopMiddleware,
    checkCompanyAccess: noopMiddleware,
    checkCompanyAdmin: noopMiddleware,
    requireEditor: noopMiddleware,
    getTable: () => '"batteryPassports"',
    getPassportTypeSchema: async () => ({
      typeName: "batteryPassportV1",
      allowedKeys: new Set(["internalAliasId"]),
      fieldsJson: { sections: [] },
    }),
    hasCompanyPassportTypeAccess: async () => true,
    assertPassportTypeStorageReady: async (typeName) => {
      readinessCalls.push(typeName);
      const error = new Error("Passport storage is not provisioned");
      error.code = "passportTypeStorageNotReady";
      error.statusCode = 503;
      throw error;
    },
    normalizePassportRequestBody: (value) => value,
    systemPassportFields: new Set(),
    complianceService: {},
    productIdentifierService: {},
  });

  for (const request of [
    {
      path: "/api/companies/:companyId/passports/upsert-csv",
      body: { passportType: "batteryPassportV1", csv: "Field Name,Passport 1\\nInternal Alias ID,BAT-1" },
    },
    {
      path: "/api/companies/:companyId/passports/upsert-json",
      body: { passportType: "batteryPassportV1", passports: [{ internalAliasId: "BAT-1" }] },
    },
  ]) {
    const route = routes.find((entry) => entry.method === "post" && entry.routePath === request.path);
    const response = createResponse();
    await route.handlers.at(-1)({
      params: { companyId: "7" },
      body: request.body,
      user: { userId: 9, role: "editor" },
    }, response);
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, { error: "passportTypeStorageNotReady" });
  }

  assert.deepEqual(readinessCalls, ["batteryPassportV1", "batteryPassportV1"]);
  assert.equal(queryCount, 0);
});
