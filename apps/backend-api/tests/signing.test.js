"use strict";

const crypto = require("crypto");

const createDidService = require("../services/did-service");
const createCanonicalPassportSerializer = require("../services/canonicalPassportSerializer");
const canonicalizeJson = require("../services/json-canonicalization");
const createSigningService = require("../services/signing-service");

function createMockPool() {
  const state = {
    keys: new Map(),
    signatures: new Map(),
  };

  return {
    state,
    async query(sql, params) {
      if (sql.includes("INSERT INTO passport_signing_keys")) {
        state.keys.set(params[0], {
          public_key: params[1],
          algorithm: params[2],
          algorithm_version: params[3],
        });
        return { rows: [] };
      }

      if (sql.includes("FROM companies c") && sql.includes("company_dpp_policies")) {
        return {
          rows: [{
            id: 7,
            company_name: "Acme Energy",
            did_slug: "acme-energy",
            dpp_granularity: "item",
            default_granularity: "item",
            vc_issuance_enabled: true,
            mint_model_dids: true,
            mint_item_dids: true,
            mint_facility_dids: true,
          }],
        };
      }

      if (sql.startsWith("SELECT * FROM passport_signatures")) {
        const key = `${params[0]}:${params[1]}`;
        return { rows: state.signatures.has(key) ? [state.signatures.get(key)] : [] };
      }

      if (sql.startsWith("SELECT public_key, algorithm, algorithm_version FROM passport_signing_keys")) {
        return { rows: state.keys.has(params[0]) ? [state.keys.get(params[0])] : [] };
      }

      throw new Error(`Unhandled mock query: ${sql}`);
    },
  };
}

function buildTestHarness(pool) {
  const didService = createDidService({
    didDomain: "www.claros-dpp.online",
    publicOrigin: "https://www.claros-dpp.online",
    apiOrigin: "https://api.claros.test",
  });
  const serializer = createCanonicalPassportSerializer({ didService });
  const signingService = createSigningService({
    pool,
    crypto,
    canonicalizeJson,
    didService,
    buildCanonicalPassportPayload: serializer.buildCanonicalPassportPayload,
  });

  return { didService, signingService };
}

const TYPE_DEF = {
  type_name: "battery",
  fields_json: {
    sections: [
      {
        fields: [
          { key: "facility_id" },
          { key: "capacity_wh", dataType: "integer" },
        ],
      },
    ],
  },
};

const PASSPORT = {
  guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
  lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
  company_id: 7,
  passport_type: "battery",
  product_id: "BAT-2026-001",
  version_number: 2,
  release_status: "released",
  updated_at: "2026-04-24T12:00:00.000Z",
  model_name: "Battery Pack 5000",
  facility_id: "plant-42",
  capacity_wh: "5000",
  granularity: "item",
};

describe("signing service", () => {
  const originalPrivate = process.env.SIGNING_PRIVATE_KEY;
  const originalPublic = process.env.SIGNING_PUBLIC_KEY;

  afterEach(() => {
    if (originalPrivate === undefined) delete process.env.SIGNING_PRIVATE_KEY;
    else process.env.SIGNING_PRIVATE_KEY = originalPrivate;

    if (originalPublic === undefined) delete process.env.SIGNING_PUBLIC_KEY;
    else process.env.SIGNING_PUBLIC_KEY = originalPublic;
  });

  test("issues and verifies new ES256 credentials", async () => {
    delete process.env.SIGNING_PRIVATE_KEY;
    delete process.env.SIGNING_PUBLIC_KEY;

    const pool = createMockPool();
    const { signingService } = buildTestHarness(pool);

    await signingService.loadOrGenerateSigningKey();
    const signed = await signingService.signPassport(PASSPORT, TYPE_DEF);

    expect(signed.signatureAlgorithm).toBe("ES256");

    pool.state.signatures.set(`${PASSPORT.guid}:${PASSPORT.version_number}`, {
      passport_guid: PASSPORT.guid,
      version_number: PASSPORT.version_number,
      data_hash: signed.dataHash,
      signature: signed.signature,
      algorithm: signed.legacyAlgorithm,
      signing_key_id: signed.keyId,
      released_at: signed.releasedAt,
      signed_at: signed.releasedAt,
      vc_json: signed.vcJson,
    });

    const verification = await signingService.verifyPassportSignature(PASSPORT.guid, PASSPORT.version_number);
    expect(verification.status).toBe("valid");
    expect(verification.algorithm).toBe("ES256");
    expect(verification.proofType).toBe("JsonWebSignature2020");
  });

  test("keeps legacy RSA credentials verifiable", async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    process.env.SIGNING_PRIVATE_KEY = privateKey.replace(/\n/g, "\\n");
    process.env.SIGNING_PUBLIC_KEY = publicKey.replace(/\n/g, "\\n");

    const pool = createMockPool();
    const { signingService } = buildTestHarness(pool);

    await signingService.loadOrGenerateSigningKey();
    const signed = await signingService.signPassport(PASSPORT, TYPE_DEF);

    expect(signed.signatureAlgorithm).toBe("RS256");

    pool.state.signatures.set(`${PASSPORT.guid}:${PASSPORT.version_number}`, {
      passport_guid: PASSPORT.guid,
      version_number: PASSPORT.version_number,
      data_hash: signed.dataHash,
      signature: signed.signature,
      algorithm: "RSA-SHA256",
      signing_key_id: signed.keyId,
      released_at: signed.releasedAt,
      signed_at: signed.releasedAt,
      vc_json: signed.vcJson,
    });

    const verification = await signingService.verifyPassportSignature(PASSPORT.guid, PASSPORT.version_number);
    expect(verification.status).toBe("valid");
    expect(verification.algorithm).toBe("RS256");
  });
});
