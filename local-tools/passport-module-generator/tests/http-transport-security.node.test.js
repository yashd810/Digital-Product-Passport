"use strict";

const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Writable } = require("node:stream");

const { createGeneratorTransport } = require("../server/http/transport");

const securityHeaders = {
  "Content-Security-Policy": "default-src 'none'; object-src 'none'",
  "Referrer-Policy": "no-referrer",
};

class TestResponse extends Writable {
  constructor() {
    super();
    this.statusCode = null;
    this.headers = {};
    this.body = Buffer.alloc(0);
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    this.headers = headers;
    return this;
  }

  _write(chunk, _encoding, callback) {
    this.body = Buffer.concat([this.body, Buffer.from(chunk)]);
    callback();
  }
}

function createFixture() {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "dpp-generator-http-"));
  fs.mkdirSync(path.join(appDir, "client"));
  fs.mkdirSync(path.join(appDir, "shared"));
  fs.mkdirSync(path.join(appDir, "server"));
  fs.writeFileSync(path.join(appDir, "index.html"), "<!doctype html><title>safe</title>");
  fs.writeFileSync(path.join(appDir, "favicon.svg"), "<svg/>");
  fs.writeFileSync(path.join(appDir, "client", "workspace.js"), "safe-client");
  fs.writeFileSync(path.join(appDir, "shared", "rules.js"), "safe-shared");
  fs.writeFileSync(path.join(appDir, "server", "secret.js"), "must-not-be-served");

  const transport = createGeneratorTransport({
    appDir,
    maxBodyBytes: 32,
    allowedApiOrigins: new Set(["http://127.0.0.1:5055"]),
    allowedHosts: new Set(["127.0.0.1:5055", "localhost:5055"]),
    staticSecurityHeaders: securityHeaders,
    mime: {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
    },
  });
  return { appDir, transport };
}

test("rejects DNS-rebinding Hosts and cross-origin API posts", () => {
  const { appDir, transport } = createFixture();
  try {
    let rejectedHost;
    try {
      transport.validateRequestHost({ headers: { host: "attacker.example:5055" } });
    } catch (error) {
      rejectedHost = error;
    }
    assert.match(rejectedHost.message, /Host is not allowed/);
    assert.equal(rejectedHost.expose, true);
    assert.doesNotThrow(
      () => transport.validateRequestHost({ headers: { host: "localhost:5055" } })
    );
    assert.throws(
      () => transport.validateApiPostRequest({ headers: { "content-type": "application/json" } }),
      /Cross-origin/
    );
    assert.throws(
      () => transport.validateApiPostRequest({
        headers: {
          origin: "http://127.0.0.1:5055",
          "content-type": "application/json",
          "sec-fetch-site": "cross-site",
        },
      }),
      /Cross-site/
    );
    assert.doesNotThrow(() => transport.validateApiPostRequest({
      headers: {
        origin: "http://127.0.0.1:5055",
        "content-type": "application/json; charset=utf-8",
        "sec-fetch-site": "same-origin",
      },
    }));
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true });
  }
});

test("preflights declared body size before buffering", async () => {
  const { appDir, transport } = createFixture();
  try {
    const oversized = new EventEmitter();
    oversized.headers = { "content-length": "33" };
    oversized.resume = () => {};
    await assert.rejects(transport.readBody(oversized), (error) => error.statusCode === 413);

    const malformed = new EventEmitter();
    malformed.headers = { "content-length": "NaN" };
    malformed.resume = () => {};
    await assert.rejects(transport.readBody(malformed), (error) => error.statusCode === 400);
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true });
  }
});

test("serves only allowlisted public assets and refuses symlink escapes", async () => {
  const { appDir, transport } = createFixture();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "dpp-generator-outside-"));
  try {
    const outsideFile = path.join(outsideDir, "outside.js");
    fs.writeFileSync(outsideFile, "outside-secret");
    fs.symlinkSync(outsideFile, path.join(appDir, "client", "escape.js"));

    const publicResponse = new TestResponse();
    transport.serveStatic({ method: "GET" }, publicResponse, "/client/workspace.js");
    await once(publicResponse, "finish");
    assert.equal(publicResponse.statusCode, 200);
    assert.equal(publicResponse.body.toString("utf8"), "safe-client");
    assert.equal(publicResponse.headers["Content-Security-Policy"], securityHeaders["Content-Security-Policy"]);

    for (const blockedPath of ["/server/secret.js", "/client/../server/secret.js", "/client/escape.js"]) {
      const blockedResponse = new TestResponse();
      transport.serveStatic({ method: "GET" }, blockedResponse, blockedPath);
      await once(blockedResponse, "finish");
      assert.equal(blockedResponse.statusCode, 404, blockedPath);
      assert.doesNotMatch(blockedResponse.body.toString("utf8"), /secret/);
    }

    const methodResponse = new TestResponse();
    transport.serveStatic({ method: "POST" }, methodResponse, "/index.html");
    await once(methodResponse, "finish");
    assert.equal(methodResponse.statusCode, 405);
    assert.equal(methodResponse.headers.Allow, "GET, HEAD");
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});
