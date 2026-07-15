"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const http = require("node:http");

const registerPassportPublicRoutes = require("../src/http/routes/passport-public");

function registerTestRoutes(app, { activeKey, historicalKeys }) {
  const passThrough = (_req, _res, next) => next();
  const pool = {
    async query(sql) {
      if (sql.includes('FROM "passportSigningKeys"') && sql.includes("LIMIT 1")) {
        return { rows: [activeKey] };
      }
      if (sql.includes('FROM "passportSigningKeys"')) {
        return { rows: historicalKeys };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  registerPassportPublicRoutes(app, {
    pool,
    crypto,
    publicReadRateLimit: passThrough,
    publicUnlockRateLimit: passThrough,
    getTable: () => "passports",
    normalizePassportRow: (value) => value,
    buildCurrentPublicPassportPath: () => "/",
    buildInactivePublicPassportPath: () => "/",
    stripRestrictedFieldsForPublicView: (value) => value,
    getCompanyNameMap: async () => new Map(),
    resolvePublicPassportByDppId: async () => null,
    buildPassportVersionHistory: async () => [],
    verifyPassportSignature: async () => ({ status: "unsigned" }),
    logAudit: async () => undefined,
    buildSemanticPassportJsonExport: () => ({}),
    buildCanonicalPassportPayload: () => ({}),
    buildExpandedPassportPayload: () => ({}),
    backupProviderService: {},
    signingService: {
      getSigningKey: () => ({ keyId: activeKey.keyId }),
      getSigningTrustMetadata: () => ({ issuerDid: "did:web:api.example.test" }),
    },
    didService: {
      getApiOrigin: () => "https://api.example.test",
      getDidDomain: () => "api.example.test",
      getPlatformDid: () => "did:web:api.example.test",
    },
    productIdentifierService: {},
  });
}

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", resolve);
    server.listen(0, "127.0.0.1");
  });
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    // Node's fetch client can retain a keep-alive socket after the final
    // response. Explicitly close test-owned connections so server.close()
    // cannot wait indefinitely for that idle socket.
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("public signing key discovery retains verification material across rotations", async () => {
  const activeKey = {
    keyId: "active-key",
    publicKey: "public-key-active",
    algorithm: "ES256",
    algorithmVersion: "ES256",
    createdAt: "2026-07-10T10:00:00.000Z",
  };
  const historicalKeys = [
    activeKey,
    {
      keyId: "retired-key",
      publicKey: "public-key-retired",
      algorithm: "ES256",
      algorithmVersion: "ES256",
      createdAt: "2026-06-01T10:00:00.000Z",
    },
  ];
  const app = express();
  registerTestRoutes(app, { activeKey, historicalKeys });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/public/signing-key`);
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.publicKey, activeKey.publicKey);
    assert.deepEqual(body.historicalKeys, historicalKeys.map((key) => ({
      keyId: key.keyId,
      publicKey: key.publicKey,
      algorithm: key.algorithmVersion,
      createdAt: key.createdAt,
    })));
  });
});
