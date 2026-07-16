"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const createSigningService = require("../src/services/signing-service");

function createSigningKeyPair() {
  return crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
}

async function withSigningEnvironment(callback) {
  const originalPrivateKey = process.env.SIGNING_PRIVATE_KEY;
  const originalPublicKey = process.env.SIGNING_PUBLIC_KEY;
  const originalCertificateRequirement = process.env.REQUIRE_CERTIFICATE_BACKED_SIGNING;
  const { privateKey, publicKey } = createSigningKeyPair();

  process.env.SIGNING_PRIVATE_KEY = privateKey.replace(/\n/g, "\\n");
  process.env.SIGNING_PUBLIC_KEY = publicKey.replace(/\n/g, "\\n");
  delete process.env.REQUIRE_CERTIFICATE_BACKED_SIGNING;

  try {
    return await callback();
  } finally {
    if (originalPrivateKey === undefined) delete process.env.SIGNING_PRIVATE_KEY;
    else process.env.SIGNING_PRIVATE_KEY = originalPrivateKey;
    if (originalPublicKey === undefined) delete process.env.SIGNING_PUBLIC_KEY;
    else process.env.SIGNING_PUBLIC_KEY = originalPublicKey;
    if (originalCertificateRequirement === undefined) delete process.env.REQUIRE_CERTIFICATE_BACKED_SIGNING;
    else process.env.REQUIRE_CERTIFICATE_BACKED_SIGNING = originalCertificateRequirement;
  }
}

test("signing startup fails when the public verification key cannot be persisted", async () => {
  await withSigningEnvironment(async () => {
    const service = createSigningService({
      pool: {
        query: async () => {
          throw new Error("passportSigningKeys is unavailable");
        },
      },
      crypto,
      canonicalizeJson: JSON.stringify,
      didService: {},
      buildCanonicalPassportPayload: () => ({}),
    });

    await assert.rejects(
      service.loadOrGenerateSigningKey(),
      /passportSigningKeys is unavailable/
    );
  });
});
