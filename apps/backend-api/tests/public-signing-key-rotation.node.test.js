"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");

const registerPassportPublicRoutes = require("../src/http/routes/passport-public");
const { requestApp } = require("./helpers/in-memory-http");

function registerTestRoutes(app, { activeKey, historicalKeys, backupProviderService = {} }) {
  const passThrough = (_req, _res, next) => next();
  const pool = {
    async query(sql) {
      if (sql.includes('FROM "passportSigningKeys"') && sql.includes("LIMIT 1")) {
        return { rows: [activeKey] };
      }
      if (sql.includes('FROM "passportSigningKeys"')) {
        return { rows: historicalKeys };
      }
      if (sql.includes('FROM "passportRegistry"')) {
        return { rows: [] };
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
    backupProviderService,
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

  const response = await requestApp(app, { path: "/api/public/signing-key" });
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

test("public passport requests never trigger automatic backup-handover activation", async () => {
  const activeKey = {
    keyId: "active-key",
    publicKey: "public-key-active",
    algorithm: "ES256",
    algorithmVersion: "ES256",
    createdAt: "2026-07-10T10:00:00.000Z",
  };
  let automaticActivationCalls = 0;
  const app = express();
  registerTestRoutes(app, {
    activeKey,
    historicalKeys: [activeKey],
    backupProviderService: {
      async getActivePublicHandover() {
        return null;
      },
      async ensureAutomaticPublicHandover() {
        automaticActivationCalls += 1;
        throw new Error("A public request must not mutate backup handover state");
      },
    },
  });

  const response = await requestApp(app, { path: "/api/public/passports/dpp-1" });
  assert.equal(response.status, 404);
  assert.equal(automaticActivationCalls, 0);
});
