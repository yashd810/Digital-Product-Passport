"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getPublicSymbolContentType,
  isPublicStorageKey,
  maxPassportAttachmentBytes,
  maxPublicSymbolBytes,
  readBoundedObjectLength,
  registerSupportRoutes,
  setPassportAttachmentHeaders,
} = require("../src/bootstrap/support-routes");

test("direct storage access allows only generated global symbol assets", () => {
  assert.equal(isPublicStorageKey("uploads/symbols/symbol123-a1b2c3.png"), true);
  assert.equal(getPublicSymbolContentType("uploads/symbols/symbol123-a1b2c3.png"), "image/png");
  assert.equal(getPublicSymbolContentType("uploads/symbols/symbol123-a1b2c3.jpg"), "image/jpeg");
  assert.equal(getPublicSymbolContentType("uploads/symbols/symbol123-a1b2c3.webp"), "image/webp");
  assert.equal(isPublicStorageKey("backup-provider/company-7/passport-1/v1/releasedCurrent.json"), false);
  assert.equal(isPublicStorageKey("backup-provider/company-7/security-events/event.json"), false);
  assert.equal(isPublicStorageKey("healthchecks/storage/probe.json"), false);
  assert.equal(isPublicStorageKey("passport-files/dpp-1/document.pdf"), false);
  assert.equal(isPublicStorageKey("repository-files/7/document.pdf"), false);
  assert.equal(isPublicStorageKey("uploads/symbols/../../backup-provider/private.json"), false);
  assert.equal(isPublicStorageKey("uploads/symbols/nested/symbol.png"), false);
  assert.equal(isPublicStorageKey("uploads/symbols/symbol123-a1b2c3.svg"), false);
  assert.equal(isPublicStorageKey("uploads/symbols/other-image.png"), false);
});

test("passport attachment headers sandbox inline PDFs and force unknown bytes to download", () => {
  const createResponse = () => ({
    headers: new Map([["x-frame-options", "DENY"]]),
    setHeader(name, value) {
      this.headers.set(name.toLowerCase(), String(value));
    },
    removeHeader(name) {
      this.headers.delete(name.toLowerCase());
    },
  });

  const pdfResponse = createResponse();
  setPassportAttachmentHeaders(pdfResponse, "application/pdf", { requirePublic: false });
  assert.equal(pdfResponse.headers.get("content-security-policy"), "sandbox");
  assert.equal(pdfResponse.headers.get("content-disposition"), "inline");
  assert.equal(pdfResponse.headers.get("cross-origin-resource-policy"), "cross-origin");
  assert.equal(pdfResponse.headers.has("x-frame-options"), false);
  assert.equal(pdfResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(pdfResponse.headers.get("referrer-policy"), "no-referrer");

  const binaryResponse = createResponse();
  setPassportAttachmentHeaders(binaryResponse, "application/octet-stream");
  assert.equal(binaryResponse.headers.get("content-security-policy"), "sandbox");
  assert.equal(binaryResponse.headers.get("content-disposition"), "attachment");
  assert.equal(binaryResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(binaryResponse.headers.get("cross-origin-resource-policy"), "same-site");
});

test("stored object length parsing rejects malformed and oversized metadata before a read", () => {
  assert.equal(readBoundedObjectLength("0", maxPublicSymbolBytes), 0);
  assert.equal(readBoundedObjectLength(String(maxPassportAttachmentBytes), maxPassportAttachmentBytes), maxPassportAttachmentBytes);
  assert.equal(readBoundedObjectLength(null, maxPublicSymbolBytes), null);
  assert.throws(() => readBoundedObjectLength("12e6", maxPublicSymbolBytes), /invalid content length/);
  assert.throws(() => readBoundedObjectLength(String(maxPublicSymbolBytes + 1), maxPublicSymbolBytes), /permitted read limit/);
});

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    ended: false,
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
    json(value) {
      this.body = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function registerStorageHarness(storageService) {
  const routes = [];
  const app = {
    get(path, ...handlers) {
      routes.push({ method: "GET", path, handlers });
    },
    head(path, ...handlers) {
      routes.push({ method: "HEAD", path, handlers });
    },
    post() {},
    use() {},
  };
  registerSupportRoutes(app, {
    pool: { async query() { return { rows: [] }; } },
    fs: {},
    path: require("node:path"),
    logger: { error() {} },
    storageService,
    filesBaseDir: "/tmp/passport-files",
    normalizeStorageRequestKey: (value) => String(value || ""),
    isPassportStorageKey: () => false,
    publicReadRateLimit: (_req, _res, next) => next(),
    contactIpRateLimit: (_req, _res, next) => next(),
    contactEmailRateLimit: (_req, _res, next) => next(),
    contactRecipientRateLimit: (_req, _res, next) => next(),
    createTransporter: () => ({ sendMail: async () => {} }),
    brandedEmail: () => "",
  });
  return routes;
}

test("public storage proxy enforces its symbol-only surface and read-size bound", async () => {
  const calls = [];
  const body = Buffer.from("safe image bytes");
  const routes = registerStorageHarness({
    isLocal: false,
    async fetchObject(key) {
      calls.push(key);
      return {
        headers: new Map([
          ["content-length", String(body.length)],
          ["etag", "safe-etag"],
        ]),
        async arrayBuffer(maxBytes) {
          assert.equal(maxBytes, maxPublicSymbolBytes);
          return body;
        },
      };
    },
  });
  const getStorage = routes.find((route) => route.method === "GET" && route.path instanceof RegExp);
  assert.ok(getStorage);
  const response = createResponse();
  await getStorage.handlers.at(-1)({
    method: "GET",
    params: { 0: "uploads/symbols/symbol123-a1b2c3.png" },
  }, response);

  assert.deepEqual(calls, ["uploads/symbols/symbol123-a1b2c3.png"]);
  assert.deepEqual(response.body, body);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("content-length"), String(body.length));
  assert.equal(response.headers.get("etag"), "safe-etag");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-site");

  const denied = createResponse();
  await getStorage.handlers.at(-1)({
    method: "GET",
    params: { 0: "backup-provider/company-7/private.json" },
  }, denied);
  assert.equal(denied.statusCode, 404);
  assert.deepEqual(denied.body, { error: "Stored object not found" });
  assert.equal(calls.length, 1);
});

test("public storage HEAD requests avoid reads and oversized objects fail closed", async () => {
  let readCount = 0;
  const routes = registerStorageHarness({
    isLocal: false,
    async fetchObject() {
      return {
        headers: new Map(),
        async arrayBuffer(maxBytes) {
          readCount += 1;
          assert.equal(maxBytes, maxPublicSymbolBytes);
          const error = new Error("too large");
          error.code = "storageObjectTooLarge";
          throw error;
        },
      };
    },
  });
  const getStorage = routes.find((route) => route.method === "GET" && route.path instanceof RegExp);
  const headStorage = routes.find((route) => route.method === "HEAD" && route.path instanceof RegExp);
  const objectParams = { 0: "uploads/symbols/symbol123-a1b2c3.png" };

  const headResponse = createResponse();
  await headStorage.handlers.at(-1)({ method: "HEAD", params: objectParams }, headResponse);
  assert.equal(headResponse.statusCode, 200);
  assert.equal(headResponse.ended, true);
  assert.equal(readCount, 0);

  const getResponse = createResponse();
  await getStorage.handlers.at(-1)({ method: "GET", params: objectParams }, getResponse);
  assert.equal(readCount, 1);
  assert.equal(getResponse.statusCode, 404);
  assert.deepEqual(getResponse.body, { error: "Stored object not found" });
});

test("public storage rejects an oversized declared object before buffering it", async () => {
  let readCount = 0;
  const routes = registerStorageHarness({
    isLocal: false,
    async fetchObject() {
      return {
        headers: new Map([["content-length", String(maxPublicSymbolBytes + 1)]]),
        async arrayBuffer() {
          readCount += 1;
          return Buffer.alloc(0);
        },
      };
    },
  });
  const getStorage = routes.find((route) => route.method === "GET" && route.path instanceof RegExp);
  const response = createResponse();
  await getStorage.handlers.at(-1)({
    method: "GET",
    params: { 0: "uploads/symbols/symbol123-a1b2c3.png" },
  }, response);

  assert.equal(readCount, 0);
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: "Stored object not found" });
});
