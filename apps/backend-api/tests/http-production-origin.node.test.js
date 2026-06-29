"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
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

  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
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

    assert.equal((await request()).status, 403);
    assert.equal((await request({ "x-api-key": "restricted-read-key" })).status, 403);
    assert.equal((await request({ "x-asset-key": "obsolete-key" })).status, 403);
    assert.equal((await request({ authorization: "Bearer integration-token" })).status, 200);
    assert.equal((await request({ origin: "https://dashboard.example.test" })).status, 200);
  });
});
