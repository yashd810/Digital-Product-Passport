"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const registerRepositoryRoutes = require("../src/http/routes/repository");
const {
  buildRepositoryFileAccessPath,
  buildRepositoryFilePublicPath,
} = require("../src/shared/repository/repository-file-links");

const previousRepositoryFileLinkSecret = process.env.REPOSITORY_FILE_LINK_SECRET;
const previousServerUrl = process.env.SERVER_URL;
process.env.REPOSITORY_FILE_LINK_SECRET = "test-repository-file-link-secret-with-32-chars";
process.env.SERVER_URL = "https://api.example.test";
test.after(() => {
  if (previousRepositoryFileLinkSecret === undefined) delete process.env.REPOSITORY_FILE_LINK_SECRET;
  else process.env.REPOSITORY_FILE_LINK_SECRET = previousRepositoryFileLinkSecret;
  if (previousServerUrl === undefined) delete process.env.SERVER_URL;
  else process.env.SERVER_URL = previousServerUrl;
});

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: new Map(),
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), String(value));
    },
    removeHeader(name) {
      this.headers.delete(String(name).toLowerCase());
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

function registerHarness({ query, storageService = { isLocal: true, provider: "local" } } = {}) {
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
      async query(sql, params = []) {
        queryCount += 1;
        return query ? query(sql, params) : { rows: [] };
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
    storageService,
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

  const token = buildRepositoryFileAccessPath({ companyId: 7, itemId: 11 }).split("/").at(-1);
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

test("repository uploads require a folder in their matching scope", async () => {
  const harness = registerHarness();
  const cases = [
    {
      path: "/api/companies/:companyId/repository/upload",
      error: "Choose an existing folder before uploading a file",
    },
    {
      path: "/api/companies/:companyId/repository/symbols/upload",
      error: "Choose an existing folder before uploading a symbol",
    },
  ];

  for (const upload of cases) {
    const route = harness.routes.find((entry) => entry.method === "post" && entry.path === upload.path);
    assert.ok(route);

    const res = createResponse();
    await route.handlers.at(-1)({
      params: { companyId: "7" },
      body: {},
      file: { buffer: Buffer.from("fixture"), size: 7, originalname: "fixture.pdf" },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: upload.error });
  }
});

test("repository responses do not disclose internal object keys or server paths", async () => {
  const harness = registerHarness({
    query: async (sql) => {
      if (sql.includes('FROM "companyRepository"')) {
        return { rows: [{
          id: 11,
          companyId: 7,
          parentId: null,
          name: "manual.pdf",
          type: "file",
          storageKey: "private/company-7/internal-key.pdf",
          filePath: "/private/server/path/manual.pdf",
          mimeType: "application/pdf",
        }] };
      }
      return { rows: [] };
    },
  });
  const route = harness.routes.find((entry) =>
    entry.method === "get" && entry.path === "/api/companies/:companyId/repository"
  );
  const response = createResponse();

  await route.handlers.at(-1)({ params: { companyId: "7" }, query: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.length, 1);
  assert.equal(Object.hasOwn(response.body[0], "storageKey"), false);
  assert.equal(Object.hasOwn(response.body[0], "filePath"), false);
  assert.match(response.body[0].fileUrl, /^https?:\/\//);
});

test("folder creation rejects parents outside the tenant and repository scope", async () => {
  const queries = [];
  const harness = registerHarness({
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
  });
  const route = harness.routes.find((entry) =>
    entry.method === "post" && entry.path === "/api/companies/:companyId/repository/folder"
  );
  const response = createResponse();

  await route.handlers.at(-1)({
    params: { companyId: "7" },
    body: { name: "Cross tenant", parentId: "99" },
    user: { userId: 3 },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Invalid repository parent folder" });
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /"companyId" = \$2/);
  assert.match(queries[0].sql, /"repositoryScope" = \$3/);
  assert.deepEqual(queries[0].params, [99, "7", "files"]);
  assert.equal(queries.some(({ sql }) => /INSERT INTO "companyRepository"/.test(sql)), false);
});

test("folder emptiness checks stay scoped to the owning tenant and repository", async () => {
  const queries = [];
  const harness = registerHarness({
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/SELECT \* FROM "companyRepository"/.test(sql)) {
        return { rows: [{ id: 20, companyId: 7, repositoryScope: "files", type: "folder" }] };
      }
      return { rows: [] };
    },
  });
  const route = harness.routes.find((entry) =>
    entry.method === "delete" && entry.path === "/api/companies/:companyId/repository/:itemId"
  );
  const response = createResponse();

  await route.handlers.at(-1)({
    params: { companyId: "7", itemId: "20" },
  }, response);

  assert.equal(response.statusCode, 200);
  const childQuery = queries.find(({ sql }) => /WHERE "parentId" = \$1/.test(sql));
  assert.ok(childQuery);
  assert.match(childQuery.sql, /"companyId" = \$2/);
  assert.match(childQuery.sql, /"repositoryScope" = \$3/);
  assert.deepEqual(childQuery.params, [20, "7", "files"]);
});

test("repository object reads pass a strict maximum to the storage adapter", async () => {
  let readLimit = null;
  const harness = registerHarness({
    query: async (sql) => {
      if (/FROM "companyRepository"/.test(sql)) {
        return { rows: [{
          id: 11,
          companyId: 7,
          type: "file",
          storageKey: "repository-files/7/manual.pdf",
          storageProvider: "s3",
          mimeType: "application/pdf",
        }] };
      }
      return { rows: [] };
    },
    storageService: {
      provider: "s3",
      async fetchObject() {
        return {
          headers: new Map([["content-length", "4"]]),
          async arrayBuffer(maxBytes) {
            readLimit = maxBytes;
            return Buffer.from("%PDF", "utf8");
          },
        };
      },
    },
  });
  const route = harness.routes.find((entry) =>
    entry.method === "get" && entry.path === "/repository-files/:token"
  );
  const token = buildRepositoryFilePublicPath({ companyId: 7, itemId: 11 }).split("/").at(-1);
  const response = createResponse();

  await route.handlers.at(-1)({
    params: { token },
    user: { role: "companyAdmin", companyId: 7 },
  }, response);

  assert.equal(readLimit, 50 * 1024 * 1024);
  assert.equal(response.headers.get("content-length"), "4");
  assert.deepEqual(response.body, Buffer.from("%PDF", "utf8"));
});

test("repository file responses do not cache bearer-authorized bytes or leak a referrer", async () => {
  let readLimit = null;
  const harness = registerHarness({
    query: async (sql) => {
      if (/FROM "companyRepository"/.test(sql)) {
        return { rows: [{
          id: 11,
          companyId: 7,
          type: "file",
          storageKey: "repository-files/7/manual.pdf",
          storageProvider: "memory",
          mimeType: "application/pdf",
        }] };
      }
      return { rows: [] };
    },
    storageService: {
      provider: "memory",
      async fetchObject() {
        return {
          headers: { get: () => null },
          async arrayBuffer(maxBytes) {
            readLimit = maxBytes;
            return Buffer.from("fixture");
          },
        };
      },
    },
  });
  const route = harness.routes.find((entry) =>
    entry.method === "get" && entry.path === "/repository-files/access/:token"
  );
  const token = buildRepositoryFileAccessPath({ companyId: 7, itemId: 11 }).split("/").at(-1);
  const response = createResponse();

  await route.handlers.at(-1)({ params: { token } }, response);

  assert.ok(readLimit > 0);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});
