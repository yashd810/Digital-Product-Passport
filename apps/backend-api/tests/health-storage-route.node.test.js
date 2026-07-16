"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const registerHealthRoutes = require("../src/http/routes/health");

const repoRoot = path.resolve(__dirname, "../../..");

function createPool() {
  const queries = [];
  return {
    queries,
    pool: {
      async query(sql) {
        queries.push(sql);
        return { rows: [{ ok: 1 }] };
      },
    },
  };
}

function createStorageService({ saveError } = {}) {
  const calls = { save: [], fetch: [], delete: [] };
  const objects = new Map();
  return {
    calls,
    objects,
    storageService: {
      provider: "test-s3-provider",
      async saveObject({ key, buffer }) {
        calls.save.push(key);
        if (saveError) throw saveError;
        objects.set(key, Buffer.from(buffer));
        return { storageKey: key };
      },
      async fetchObject(key) {
        calls.fetch.push(key);
        const buffer = objects.get(key);
        if (!buffer) throw new Error("Missing storage probe object");
        return {
          async arrayBuffer() {
            return Uint8Array.from(buffer).buffer;
          },
        };
      },
      async deleteObject(key) {
        calls.delete.push(key);
        objects.delete(key);
      },
    },
  };
}

async function withServer({ pool, storageService }, run) {
  const app = express();
  // This mirrors the production setting: the first proxy hop is trusted and
  // `req.ip` is therefore the actual client behind Caddy.
  app.set("trust proxy", 1);
  registerHealthRoutes(app, { pool, storageService });

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", resolve);
    server.listen(0, "127.0.0.1");
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  return { body: await response.json(), response };
}

test("public health stays read-only and does not invoke object storage", async () => {
  const { pool, queries } = createPool();
  const { calls, storageService } = createStorageService();

  await withServer({ pool, storageService }, async (baseUrl) => {
    const { body, response } = await fetchJson(`${baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      status: "OK",
      database: "connected",
      storage: "notChecked",
    });
  });

  assert.deepEqual(queries, ["SELECT 1"]);
  assert.deepEqual(calls, { save: [], fetch: [], delete: [] });
});

test("storage probe only permits a direct loopback request", async () => {
  const { pool } = createPool();
  const { calls, objects, storageService } = createStorageService();

  await withServer({ pool, storageService }, async (baseUrl) => {
    const forwarded = await fetchJson(`${baseUrl}/health/storage`, {
      headers: { "x-forwarded-for": "198.51.100.24" },
    });
    assert.equal(forwarded.response.status, 403);
    assert.deepEqual(forwarded.body, {
      status: "FORBIDDEN",
      error: "Storage probe is restricted.",
    });

    // A client cannot make a public address look local by prepending a
    // loopback value: with one trusted proxy hop Express uses the rightmost
    // client address supplied by Caddy.
    const spoofed = await fetchJson(`${baseUrl}/health/storage`, {
      headers: { "x-forwarded-for": "127.0.0.1, 198.51.100.24" },
    });
    assert.equal(spoofed.response.status, 403);
    assert.deepEqual(calls, { save: [], fetch: [], delete: [] });

    const direct = await fetchJson(`${baseUrl}/health/storage`);
    assert.equal(direct.response.status, 200);
    assert.deepEqual(direct.body, { status: "OK", storage: "ok" });
  });

  assert.equal(calls.save.length, 1);
  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.delete.length, 1);
  assert.equal(objects.size, 0);
});

test("storage failures do not disclose provider or error details", async () => {
  const { pool } = createPool();
  const { storageService } = createStorageService({
    saveError: new Error("secret storage credential failure"),
  });

  await withServer({ pool, storageService }, async (baseUrl) => {
    const { body, response } = await fetchJson(`${baseUrl}/health/storage`);

    assert.equal(response.status, 503);
    assert.deepEqual(body, { status: "UNAVAILABLE", storage: "failed" });
    assert.doesNotMatch(JSON.stringify(body), /provider|credential|secret/i);
  });
});

test("production routing excludes the mutating storage probe and deploys its loopback check", () => {
  for (const templateName of ["Caddyfile.backend.template", "Caddyfile.template"]) {
    const template = fs.readFileSync(path.join(repoRoot, "infra/oracle", templateName), "utf8");
    assert.match(template, /@storageProbe path \/health\/storage/);
    assert.match(template, /respond @storageProbe 404/);
  }

  const deployScript = fs.readFileSync(path.join(repoRoot, "infra/oracle/deploy-prod.sh"), "utf8");
  assert.match(deployScript, /wait_for_backend_loopback_http "\/health\/storage" "Backend storage probe"/);
  assert.match(deployScript, /exec -T backend-api node -e 'fetch\(process\.argv\[1\]\)/);
});
