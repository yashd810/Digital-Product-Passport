"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const registerCompanyRoutes = require("../src/modules/admin/register-company-routes");
const {
  validateCompanyDppPolicyInput,
} = require("../src/services/company-dpp-policy");

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

function registerWithPool(pool, { logAudit = noop } = {}) {
  const { app, routes } = createRouteApp();
  registerCompanyRoutes(app, {
    pool,
    authenticateToken: noop,
    isSuperAdmin: noop,
    verifyPassword: noop,
    logAudit,
    backupProviderService: null,
    productIdentifierService: null,
    getTable: noop,
    ensureCompanyDppPolicy: noop,
    getCompanyDppPolicy: noop,
    validateCompanyDppPolicyInput,
    updateCompanyDppPolicy: noop,
    storageService: null,
    repoBaseDir: "/tmp/repository",
    filesBaseDir: "/tmp/files",
    companyTrustLevels: new Set(["basic", "verifiedBusiness", "enterprise"]),
  });
  return routes;
}

test("company creation stores a full country name and DPP policy in one transaction", async () => {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
      if (sql.includes("INSERT INTO companies")) {
        return {
          rows: [{
            id: 47,
            companyName: "Example Manufacturer",
            country: params[2],
            customerTrustLevel: params[6],
          }],
        };
      }
      if (sql.includes('INSERT INTO "companyDppPolicies"')) {
        return {
          rows: [{
            companyId: params[0],
            defaultGranularity: params[1],
            allowGranularityOverride: params[2],
            mintModelDids: params[3],
            mintItemDids: params[4],
            mintFacilityDids: params[5],
            vcIssuanceEnabled: params[6],
            jsonldExportEnabled: params[7],
            semanticDictionaryEnabled: params[8],
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {
      released = true;
    },
  };
  const auditCalls = [];
  const routes = registerWithPool({ connect: async () => client }, {
    logAudit: async (...args) => auditCalls.push(args),
  });
  const createRoute = routes.find((route) => route.method === "post" && route.routePath === "/api/admin/companies");
  const response = createResponse();

  await createRoute.handlers.at(-1)({
    user: { userId: 11, role: "superAdmin", actorIdentifier: "admin@example.test" },
    body: {
      companyName: "Example Manufacturer",
      country: "United Kingdom of Great Britain and Northern Ireland",
      customerTrustLevel: "enterprise",
      dppPolicy: {
        defaultGranularity: "batch",
        allowGranularityOverride: true,
        mintModelDids: false,
        mintItemDids: true,
        mintFacilityDids: true,
        vcIssuanceEnabled: false,
        jsonldExportEnabled: true,
        semanticDictionaryEnabled: false,
      },
    },
  }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.company.country, "United Kingdom of Great Britain and Northern Ireland");
  assert.equal(response.body.company.assetManagementEnabled, true);
  assert.equal(response.body.dppPolicy.defaultGranularity, "batch");
  assert.equal(queries.length, 4);
  assert.equal(queries[0].sql, "BEGIN");
  assert.match(queries[1].sql, /INSERT INTO companies/);
  assert.match(queries[2].sql, /INSERT INTO "companyDppPolicies"/);
  assert.equal(queries[3].sql, "COMMIT");
  assert.equal(queries[1].params[2], "United Kingdom of Great Britain and Northern Ireland");
  assert.deepEqual(queries[2].params, [47, "batch", true, false, true, true, false, true, false]);
  assert.equal(released, true);
  assert.equal(auditCalls.length, 1);
  assert.deepEqual(auditCalls[0].slice(0, 5), [47, 11, "createCompany", "companies", "47"]);
  assert.equal(auditCalls[0][6].companyName, "Example Manufacturer");
  assert.equal(auditCalls[0][6].dppPolicy.defaultGranularity, "batch");
  assert.deepEqual(auditCalls[0][7], {
    client,
    actorIdentifier: "admin@example.test",
    audience: "superAdmin",
  });
});

test("company update accepts an 80-character country value", async () => {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes("FROM companies") && sql.includes("FOR UPDATE")) {
        return {
          rows: [{
            id: 19,
            companyName: "Previous Company",
            country: "Sweden",
            customerTrustLevel: "basic",
          }],
        };
      }
      if (sql.includes("UPDATE companies")) {
        return {
          rows: [{
            id: 19,
            companyName: params[0],
            country: params[2],
            customerTrustLevel: params[6],
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {
      released = true;
    },
  };
  const auditCalls = [];
  const routes = registerWithPool({
    async connect() {
      return client;
    },
  }, {
    logAudit: async (...args) => auditCalls.push(args),
  });
  const updateRoute = routes.find((route) => route.method === "put" && route.routePath === "/api/admin/companies/:companyId");
  const response = createResponse();
  const country = "x".repeat(80);

  await updateRoute.handlers.at(-1)({
    params: { companyId: "19" },
    user: { userId: 11, role: "superAdmin", actorIdentifier: "admin@example.test" },
    body: {
      companyName: "Boundary Country Company",
      country,
      customerTrustLevel: "basic",
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.company.country, country);
  const updateQuery = queries.find(({ sql }) => sql.includes("UPDATE companies"));
  assert.equal(updateQuery.params[2], country);
  assert.equal(queries[0].sql, "BEGIN");
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.equal(released, true);
  assert.equal(auditCalls.length, 1);
  assert.deepEqual(auditCalls[0].slice(0, 5), [19, 11, "updateCompany", "companies", "19"]);
  assert.equal(auditCalls[0][5].companyName, "Previous Company");
  assert.equal(auditCalls[0][6].companyName, "Boundary Country Company");
  assert.deepEqual(auditCalls[0][7], {
    client,
    actorIdentifier: "admin@example.test",
    audience: "superAdmin",
  });
});

test("company country validation rejects 81 characters before persistence", async () => {
  let connectCount = 0;
  const routes = registerWithPool({
    async connect() {
      connectCount += 1;
      throw new Error("persistence should not be reached");
    },
  });
  const createRoute = routes.find((route) => route.method === "post" && route.routePath === "/api/admin/companies");
  const response = createResponse();

  await createRoute.handlers.at(-1)({
    body: {
      companyName: "Too Long Country",
      country: "x".repeat(81),
      customerTrustLevel: "basic",
    },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "Country must be 80 characters or fewer");
  assert.equal(connectCount, 0);
});

test("company creation rolls back when policy persistence fails", async () => {
  const statements = [];
  let released = false;
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("INSERT INTO companies")) return { rows: [{ id: 88, companyName: "Rollback Company" }] };
      if (sql.includes('INSERT INTO "companyDppPolicies"')) throw new Error("policy insert failed");
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {
      released = true;
    },
  };
  const routes = registerWithPool({ connect: async () => client });
  const createRoute = routes.find((route) => route.method === "post" && route.routePath === "/api/admin/companies");
  const response = createResponse();

  await createRoute.handlers.at(-1)({
    body: { companyName: "Rollback Company", customerTrustLevel: "basic" },
  }, response);

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error, "Failed to create company");
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(released, true);
});
