"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const multer = require("multer");
const registerCatalogRoutes = require("../src/modules/admin/register-catalog-routes");
const { configureHttpErrorHandling } = require("../src/bootstrap/http");
const { requestApp } = require("./helpers/in-memory-http");

function createHarness() {
  const app = express();
  let writes = 0;
  const passThrough = (_req, _res, next) => next();
  registerCatalogRoutes(app, {
    multer,
    authenticateToken(req, _res, next) { req.user = { userId: 7, role: "superAdmin" }; next(); },
    isSuperAdmin: passThrough,
    pool: { async query(_sql, params) { writes += 1; return { rows: [{ id: 1, name: params[0], category: params[1] }] }; } },
    storageService: {
      async saveGlobalSymbol({ buffer }) {
        assert.deepEqual([...buffer], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        return { storageKey: "uploads/symbols/symbol-test.png", provider: "local", url: "/symbol-test.png" };
      },
    },
    logAudit: async () => {},
  });
  configureHttpErrorHandling(app);
  return { app, writeCount: () => writes };
}

async function upload(app, { fields = { name: "Test symbol" }, filename = "symbol.png" } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" }), filename);
  const request = new Request("http://localhost/api/admin/symbols", { method: "POST", body: form });
  return requestApp(app, {
    method: "POST",
    path: "/api/admin/symbols",
    headers: { "content-type": request.headers.get("content-type") },
    body: Buffer.from(await request.arrayBuffer()),
  });
}

test("real multipart parsing rejects nested and sparse-array metadata before route or storage writes", async () => {
  const { app, writeCount } = createHarness();
  for (const field of ["name[1000000]", "category[nested][name]", "parentId[4294967294]"]) {
    const response = await upload(app, { fields: { [field]: "value" } });
    assert.equal(response.status, 400, field);
    assert.deepEqual(await response.json(), { error: "Invalid multipart request" });
  }
  assert.equal(writeCount(), 0);
});

test("real multipart parsing preserves flat upload metadata and bytes", async () => {
  const { app, writeCount } = createHarness();
  const response = await upload(app, { fields: { name: "Safe symbol", category: "Battery" } });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 1, name: "Safe symbol", category: "Battery" });
  assert.equal(writeCount(), 1);
});

test("unsupported multipart file types return a client error", async () => {
  const { app, writeCount } = createHarness();
  const response = await upload(app, { filename: "symbol.svg" });
  assert.equal(response.status, 400);
  assert.equal(writeCount(), 0);
});
