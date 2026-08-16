"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const {
  configureHttp,
  configureHttpErrorHandling,
  createEarlyJsonBodyGuard,
  createTrustedProxyAddressChecker,
  isLoopbackProxyAddress,
  parseDockerDefaultGatewayAddresses,
} = require("../src/bootstrap/http");
const { requestApp } = require("./helpers/in-memory-http");

async function withApp({ isProduction }, run) {
  const app = express();
  configureHttp(app, {
    allowedOriginSet: new Set(["https://dashboard.example.test", "https://viewer.example.test"]),
    credentialedOriginSet: new Set(["https://dashboard.example.test"]),
    cspConnectSrc: ["'self'", "https://dashboard.example.test", "https://viewer.example.test"],
    globalSymbolsDir: __dirname,
    isPlainRecord: (value) => !!value && typeof value === "object" && !Array.isArray(value),
    isProduction,
    normalizeIncomingJsonValue: (value) => value,
    normalizeOutgoingJsonValue: (value) => value,
    port: 3001,
  });
  app.post("/mutation", (_req, res) => res.json({ success: true }));
  app.post("/api/auth/login", (_req, res) => res.status(401).json({ error: "Invalid credentials" }));
  app.post("/unhandled", () => {
    throw new Error("sensitive internal failure detail");
  });
  configureHttpErrorHandling(app, { logger: { error() {} } });

  await run((path, options) => requestApp(app, { path, ...options }));
}

const withProductionApp = (run) => withApp({ isProduction: true }, run);
const withDevelopmentApp = (run) => withApp({ isProduction: false }, run);

test("production mutations allow bearer automation without weakening browser-origin checks", async () => {
  await withProductionApp(async (sendRequest) => {
    const request = (headers = {}) => sendRequest("/mutation", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: "{}",
    });
    const statusFor = async (headers = {}) => {
      const response = await request(headers);
      await response.text();
      return response.status;
    };

    assert.equal(await statusFor(), 403);
    assert.equal(await statusFor({ "x-api-key": "restricted-read-key" }), 403);
    assert.equal(await statusFor({ "x-asset-key": "obsolete-key" }), 403);
    assert.equal(await statusFor({ authorization: "Bearer integration-token" }), 200);
    assert.equal(await statusFor({ origin: "https://dashboard.example.test" }), 200);

    const viewerPublicRequest = await request({ origin: "https://viewer.example.test" });
    assert.equal(viewerPublicRequest.status, 200);
    assert.equal(viewerPublicRequest.headers.get("access-control-allow-origin"), "https://viewer.example.test");
    assert.equal(viewerPublicRequest.headers.get("access-control-allow-credentials"), null);

    assert.equal(await statusFor({
      origin: "https://viewer.example.test",
      cookie: "dppSession=cookie-session-token",
    }), 403);

    const dashboardCookieRequest = await request({
      origin: "https://dashboard.example.test",
      cookie: "dppSession=cookie-session-token",
    });
    assert.equal(dashboardCookieRequest.status, 200);
    assert.equal(dashboardCookieRequest.headers.get("access-control-allow-credentials"), "true");

    const disallowedOrigin = await request({ origin: "https://evil.example.test" });
    assert.equal(disallowedOrigin.status, 403);
    assert.match(disallowedOrigin.headers.get("content-type") || "", /application\/json/);
    assert.equal((await disallowedOrigin.json()).error, "Forbidden: origin not allowed");

    const response = await request({ authorization: "Bearer integration-token" });
    await response.text();
    assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
    assert.equal(response.headers.get("x-xss-protection"), "0");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "cross-origin");
  });
});

test("development cookie mutations still require a trusted browser origin", async () => {
  await withDevelopmentApp(async (sendRequest) => {
    const request = async (headers = {}) => {
      const response = await sendRequest("/mutation", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: "{}",
      });
      await response.text();
      return response.status;
    };

    assert.equal(await request({ cookie: "dppSession=cookie-session-token" }), 403);
    assert.equal(await request({
      origin: "https://evil.example.test",
      cookie: "dppSession=cookie-session-token",
    }), 403);
    assert.equal(await request({
      origin: "https://dashboard.example.test",
      cookie: "dppSession=cookie-session-token",
    }), 200);
    assert.equal(await request(), 200);
  });
});

test("proxy trust defaults to host loopback and only the exact Docker gateway", () => {
  const defaultTrust = createTrustedProxyAddressChecker("", { dockerGatewayAddresses: ["172.20.0.1"] });
  assert.equal(defaultTrust("127.0.0.1"), true);
  assert.equal(defaultTrust("::1"), true);
  assert.equal(defaultTrust("::ffff:127.0.0.1"), true);
  assert.equal(defaultTrust("172.20.0.1"), true);
  assert.equal(defaultTrust("172.20.0.4"), false);
  assert.equal(defaultTrust("::ffff:10.0.0.8"), false);
  assert.equal(defaultTrust("93.184.216.34"), false);
  assert.equal(defaultTrust("not-an-address"), false);

  const explicitlyConfiguredTrust = createTrustedProxyAddressChecker("172.20.0.4,::ffff:10.0.0.8");
  assert.equal(explicitlyConfiguredTrust("172.20.0.4"), true);
  assert.equal(explicitlyConfiguredTrust("::ffff:10.0.0.8"), true);
  assert.equal(explicitlyConfiguredTrust("127.0.0.1"), false);
  assert.throws(() => createTrustedProxyAddressChecker("93.184.216.34"), /TRUSTED_PROXY_IPS/);
  assert.throws(() => createTrustedProxyAddressChecker("not-an-address"), /TRUSTED_PROXY_IPS/);
  assert.equal(isLoopbackProxyAddress("127.0.0.1"), true);
  assert.equal(isLoopbackProxyAddress("172.20.0.4"), false);
});

test("Docker gateway discovery trusts only a private default route in a container", () => {
  const routeTable = [
    "Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT",
    "eth0 00000000 010014AC 0003 0 0 0 00000000 0 0 0",
    "eth0 000014AC 00000000 0001 0 0 0 00FFFFFF 0 0 0",
    "eth1 00000000 08080808 0003 0 0 0 00000000 0 0 0",
  ].join("\n");
  assert.deepEqual(parseDockerDefaultGatewayAddresses(routeTable, true), ["172.20.0.1"]);
  assert.deepEqual(parseDockerDefaultGatewayAddresses(routeTable, false), []);
});

test("JSON parsing rejects malformed and pathological structures with redacted JSON errors", async () => {
  await withProductionApp(async (sendRequest) => {
    const send = (body, path = "/mutation") => sendRequest(path, {
      method: "POST",
      headers: {
        authorization: "Bearer integration-token",
        "content-type": "application/json",
      },
      body,
    });

    const malformed = await send("{");
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: "Invalid JSON request body" });

    const nested = await send(`${"[".repeat(65)}0${"]".repeat(65)}`);
    assert.equal(nested.status, 413);
    assert.deepEqual(await nested.json(), { error: "JSON request body is too complex" });

    const tooManyValues = await send(JSON.stringify(Array(100_001).fill(0)));
    assert.equal(tooManyValues.status, 413);
    assert.deepEqual(await tooManyValues.json(), { error: "JSON request body is too complex" });

    const unhandled = await send("{}", "/unhandled");
    assert.equal(unhandled.status, 500);
    const body = await unhandled.json();
    assert.deepEqual(body, { error: "Internal server error" });
    assert.equal(JSON.stringify(body).includes("sensitive internal failure detail"), false);
  });
});

test("authentication failures and token-bearing responses cannot be cached", async () => {
  await withProductionApp(async (sendRequest) => {
    const response = await sendRequest("/api/auth/login", {
      method: "POST",
      headers: {
        authorization: "Bearer invalid-login-attempt",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "user@example.test", password: "wrong" }),
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.equal(response.headers.get("expires"), "0");
    await response.text();
  });
});

function invokeGuard(guard, req) {
  return new Promise((resolve, reject) => {
    const response = {
      headers: {},
      statusCode: 200,
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = String(value);
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body, headers: this.headers });
        return this;
      },
    };
    try {
      guard(req, response, () => resolve({ statusCode: 200, body: null, headers: response.headers }));
    } catch (error) {
      reject(error);
    }
  });
}

test("pre-parser guards cap large-body frequency, declared size, and compressed JSON", async () => {
  const guard = createEarlyJsonBodyGuard({
    maxRequests: 3,
    maxLargeRequests: 1,
    largeBodyThresholdBytes: 100,
  });
  const request = (headers = {}) => ({
    method: "POST",
    ip: "198.51.100.120",
    headers: { "content-type": "application/json", ...headers },
  });

  assert.equal((await invokeGuard(guard, request({ "content-length": "100" }))).statusCode, 200);
  const repeatedLargeBody = await invokeGuard(guard, request({ "content-length": "101" }));
  assert.equal(repeatedLargeBody.statusCode, 429);
  assert.match(repeatedLargeBody.headers["retry-after"], /^\d+$/);

  const oversized = await invokeGuard(createEarlyJsonBodyGuard(), request({
    "content-length": String((10 * 1024 * 1024) + 1),
  }));
  assert.equal(oversized.statusCode, 413);

  const compressed = await invokeGuard(createEarlyJsonBodyGuard(), request({
    "content-encoding": "gzip",
  }));
  assert.equal(compressed.statusCode, 415);
});
