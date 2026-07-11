"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const registerRepositoryRoutes = require("../src/http/routes/repository");
const {
  buildRepositoryFilePublicPath,
} = require("../src/shared/repository/repository-file-links");

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

function registerHarness() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "patch", "delete"]) {
    app[method] = (routePath, ...handlers) => {
      routes.push({ method, path: routePath, handlers });
    };
  }
  const authenticateToken = (_req, _res, next) => next();
  const publicReadRateLimit = (_req, _res, next) => next();
  let queryCount = 0;

  registerRepositoryRoutes(app, {
    pool: {
      async query() {
        queryCount += 1;
        return { rows: [] };
      },
    },
    fs: { existsSync: () => false },
    path,
    publicReadRateLimit,
    authenticateToken,
    checkCompanyAccess: (_req, _res, next) => next(),
    requireEditor: (_req, _res, next) => next(),
    repoUpload: { single: () => (_req, _res, next) => next() },
    repoSymbolUpload: { single: () => (_req, _res, next) => next() },
    validateRepositoryPdfUpload: (_req, _res, next) => next(),
    validateRepositorySymbolUpload: (_req, _res, next) => next(),
    repoBaseDir: "/tmp/repository",
    isPathInsideBase: () => true,
    storageService: { isLocal: true, provider: "local" },
  });

  return {
    authenticateToken,
    publicReadRateLimit,
    queryCount: () => queryCount,
    routes,
  };
}

test("stable repository references require authentication and company ownership", async () => {
  const harness = registerHarness();
  const route = harness.routes.find((entry) =>
    entry.method === "get" && entry.path === "/repository-files/:token"
  );
  assert.ok(route);
  assert.equal(route.handlers[0], harness.authenticateToken);
  assert.equal(route.handlers[1], harness.publicReadRateLimit);

  const token = buildRepositoryFilePublicPath({ companyId: 7, itemId: 11 }).split("/").at(-1);
  const res = createResponse();
  await route.handlers.at(-1)({
    params: { token },
    user: { role: "companyAdmin", companyId: 8 },
  }, res);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "File not found" });
  assert.equal(harness.queryCount(), 0);
});

test("expiring repository access links remain the public file surface", () => {
  const harness = registerHarness();
  const route = harness.routes.find((entry) =>
    entry.method === "get" && entry.path === "/repository-files/access/:token"
  );
  assert.ok(route);
  assert.equal(route.handlers[0], harness.publicReadRateLimit);
});
