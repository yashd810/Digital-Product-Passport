"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const registerBackupRoutes = require("../src/modules/passports/register-backup-routes");
const createBackupProviderService = require("../src/services/backup-provider-service");

function createRouteApp() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "delete"]) {
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

function registerHarness(overrides = {}) {
  const { app, routes } = createRouteApp();
  const authenticateToken = () => {};
  const checkCompanyAdmin = () => {};
  registerBackupRoutes(app, {
    authenticateToken,
    checkCompanyAdmin,
    backupProviderService: null,
    ...overrides,
  });
  return { routes, authenticateToken, checkCompanyAdmin };
}

test("backup routes require company-admin authorization rather than an accidental super-admin-only guard", () => {
  const { routes, authenticateToken, checkCompanyAdmin } = registerHarness();
  assert.ok(routes.length > 0);
  for (const route of routes) {
    assert.deepEqual(route.handlers.slice(0, 2), [authenticateToken, checkCompanyAdmin], route.routePath);
  }
});

test("backup provider APIs do not return stored provider configuration", async () => {
  const secret = "oci-private-key-material";
  const { routes } = registerHarness({
    backupProviderService: {
      async listProviders() {
        return [{
          id: 4,
          companyId: 7,
          providerKey: "company-7-oci",
          providerType: "ociObjectStorage",
          configJson: { privateKey: secret, bucket: "company-7-backups" },
          isActive: true,
        }];
      },
    },
  });
  const route = routes.find((entry) => entry.method === "get" && entry.routePath.endsWith("/backup-providers"));
  assert.ok(route);

  const response = createResponse();
  await route.handlers.at(-1)({ params: { companyId: "7" } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.stringify(response.body).includes(secret), false);
  assert.equal(response.body[0].configJson, undefined);
  assert.equal(response.body[0].hasConfiguration, true);
});

test("backup replication responses redact nested provider failure details", async () => {
  const sensitiveError = "S3 upload failed for https://object.example.test with secret=backup-secret";
  const { routes } = registerHarness({
    backupProviderService: {},
    loadLatestLivePassport: async () => ({ dppId: "dpp-1", companyId: 7 }),
    replicatePassportToBackup: async () => ({
      success: false,
      results: [{
        replicationStatus: "failed",
        errorMessage: sensitiveError,
        documentation: {
          attachmentCopies: [{ backupCopy: { error: sensitiveError } }],
        },
      }],
    }),
    logAudit: async () => {},
  });
  const route = routes.find((entry) => entry.method === "post" && entry.routePath.endsWith("/backup-replications"));
  assert.ok(route);

  const response = createResponse();
  await route.handlers.at(-1)({
    params: { companyId: "7", dppId: "dpp-1" },
    body: { passportType: "battery" },
    user: { userId: 12 },
  }, response);

  assert.equal(response.statusCode, 202);
  assert.equal(JSON.stringify(response.body).includes(sensitiveError), false);
  assert.equal(response.body.results[0].errorMessage, "Backup operation failed.");
  assert.equal(response.body.results[0].documentation.attachmentCopies[0].backupCopy.error, "Backup operation failed.");
});

test("backup provider writes and revocations are atomically scoped to the owning company", async () => {
  const queries = [];
  const service = createBackupProviderService({
    pool: {
      async query(sql, params) {
        queries.push({ sql, params });
        return { rows: [] };
      },
    },
    storageService: {},
    buildCanonicalPassportPayload: () => ({}),
  });

  await assert.rejects(
    service.upsertProvider({
      companyId: 7,
      providerKey: "company-8-provider",
      displayName: "Company 7 Provider",
    }),
    /already assigned to another company/
  );
  assert.match(
    queries[0].sql,
    /WHERE "backupServiceProviders"\."companyId" IS NOT DISTINCT FROM EXCLUDED\."companyId"/
  );
  assert.equal(queries[0].params[0], 7);

  await service.revokeProvider({ companyId: 7, providerKey: "company-8-provider" });
  assert.match(queries[1].sql, /"companyId" IS NOT DISTINCT FROM \$2/);
  assert.deepEqual(queries[1].params, ["company-8-provider", 7]);
});
