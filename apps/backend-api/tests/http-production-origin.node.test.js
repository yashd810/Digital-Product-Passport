"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("http");
const { configureHttp } = require("../src/bootstrap/http");

async function withProductionApp(run) {
  const app = express();
  configureHttp(app, {
    allowedOriginSet: new Set(["https://dashboard.example.test"]),
    cspConnectSrc: ["'self'", "https://dashboard.example.test"],
    globalSymbolsDir: __dirname,
    isPlainRecord: (value) => !!value && typeof value === "object" && !Array.isArray(value),
    isProduction: true,
    normalizeIncomingJsonValue: (value) => value,
    normalizeOutgoingJsonValue: (value) => value,
    port: 3001,
  });
  app.post("/mutation", (_req, res) => res.json({ success: true }));

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for production-origin test server to listen"));
    }, 1000);
    const settle = (fn) => (value) => {
      clearTimeout(timer);
      fn(value);
    };
    server.once("error", settle(reject));
    server.once("listening", settle(resolve));
    server.listen(0, "127.0.0.1");
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("production mutations allow bearer automation without weakening browser-origin checks", async () => {
  await withProductionApp(async (baseUrl) => {
    const request = (headers = {}) => fetch(`${baseUrl}/mutation`, {
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
