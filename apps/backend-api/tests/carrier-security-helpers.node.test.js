"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCarrierSecurityHelpers } = require("../src/modules/passports/carrier-security-helpers");

function createHelpers(capturedPayloads) {
  return createCarrierSecurityHelpers({
    pool: { query: async () => ({ rows: [] }) },
    logger: null,
    normalizeReleaseStatus: (value) => String(value || "").toLowerCase(),
    buildCurrentPublicPassportPath: ({ dppId }) => `/dpp/${dppId}`,
    buildPreviewPassportPath: ({ previewDppId }) => `/dpp/preview/${previewDppId}`,
    signPortableDataConstruct: async (request) => {
      capturedPayloads.push(request.payload);
      return {
        dataHash: "hash",
        keyId: "key",
        signatureAlgorithm: "ES256",
        signedAt: "2026-06-27T00:00:00.000Z",
        document: { id: "credential" },
        trustMetadata: {},
      };
    },
  });
}

test("carrier credentials never promote an internal alias to uniqueProductIdentifier", async () => {
  const capturedPayloads = [];
  const helpers = createHelpers(capturedPayloads);

  await helpers.maybeSignCarrierPayload({
    passport: {
      dppId: "DPP-1",
      internalAliasId: "INTERNAL-SKU-1",
      releaseStatus: "released",
    },
    metadata: {},
    forceSign: true,
  });

  assert.equal(capturedPayloads[0].uniqueProductIdentifier, null);
});

test("carrier credentials retain a distinct global product identifier", async () => {
  const capturedPayloads = [];
  const helpers = createHelpers(capturedPayloads);

  await helpers.maybeSignCarrierPayload({
    passport: {
      dppId: "DPP-1",
      internalAliasId: "INTERNAL-SKU-1",
      uniqueProductIdentifier: "did:web:example.test:products:global-1",
      releaseStatus: "released",
    },
    metadata: {},
    forceSign: true,
  });

  assert.equal(
    capturedPayloads[0].uniqueProductIdentifier,
    "did:web:example.test:products:global-1"
  );
});
