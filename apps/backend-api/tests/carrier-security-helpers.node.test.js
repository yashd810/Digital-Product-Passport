"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCarrierSecurityHelpers } = require("../src/modules/passports/carrier-security-helpers");

const previousOrigins = {
  APP_URL: process.env.APP_URL,
  SERVER_URL: process.env.SERVER_URL,
  VITE_PUBLIC_VIEWER_URL: process.env.VITE_PUBLIC_VIEWER_URL,
};
process.env.APP_URL = "https://dashboard.example.test";
process.env.SERVER_URL = "https://api.example.test";
process.env.VITE_PUBLIC_VIEWER_URL = "https://viewer.example.test";
test.after(() => {
  for (const [key, value] of Object.entries(previousOrigins)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

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

test("carrier credentials bind public access and viewer trust to the public viewer origin", async () => {
  const capturedPayloads = [];
  const helpers = createHelpers(capturedPayloads);

  const metadata = await helpers.maybeSignCarrierPayload({
    passport: { dppId: "DPP-1", releaseStatus: "released" },
    metadata: {},
    forceSign: true,
  });

  assert.equal(capturedPayloads[0].publicAccessUrl, "https://viewer.example.test/dpp/DPP-1");
  assert.equal(metadata.trustedViewerOrigin, "https://viewer.example.test");
  assert.equal(metadata.trustedViewerHost, "viewer.example.test");
});
