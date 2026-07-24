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

test("verifiable credentials bind the compiled passport type semantic profile", async () => {
  const semanticProfile = {
    typeName: "exampleProductPassportV1",
    sourceModule: "example-product:v1",
    schemaVersion: 5,
    profileDigest: "sha256:profile",
    moduleDigest: "sha256:module",
    graphDigest: "sha256:graph",
  };
  const service = createSigningService({
    pool: {
      query: async () => ({
        rows: [{
          id: 7,
          companyName: "Example Company",
          didSlug: "example-company",
          defaultGranularity: "item",
        }],
      }),
    },
    crypto,
    canonicalizeJson: JSON.stringify,
    didService: {
      getPublicOrigin: () => "https://example.test",
      getApiOrigin: () => "https://api.example.test",
      getPlatformDid: () => "did:web:example.test",
    },
    buildCanonicalPassportPayload: () => ({
      digitalProductPassportId: "did:web:example.test:dpp:1",
      uniqueProductIdentifier: "did:web:example.test:product:1",
      granularity: "Item",
      dppSchemaVersion: "prEN 18223:2025",
      dppStatus: "Active",
      lastUpdate: "2026-07-22T10:00:00.000Z",
      economicOperatorId: "EXAMPLE-1",
      facilityId: null,
      contentSpecificationIds: ["exampleProductDictionaryV1"],
      subjectDid: "did:web:example.test:subject:1",
      dppDid: "did:web:example.test:dpp:1",
      companyDid: "did:web:example.test:company:1",
      semanticProfile,
      fields: { selectedField: "selected" },
    }),
  });

  const vc = await service.buildVC({
    dppId: "DPP-1",
    versionNumber: 1,
    companyId: 7,
    modelName: "Example model",
  }, { typeName: "exampleProductPassportV1" }, "2026-07-22T10:00:00.000Z");

  assert.deepEqual(vc.credentialSubject.semanticProfile, semanticProfile);
  assert.equal(vc.credentialSubject.selectedField, "selected");
});
