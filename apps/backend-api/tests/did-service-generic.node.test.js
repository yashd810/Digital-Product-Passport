"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const createDidService = require("../src/services/did-service");

function createService() {
  return createDidService({
    didDomain: "www.example.test",
    publicOrigin: "https://www.example.test",
    apiOrigin: "https://api.example.test",
  });
}

test("DID authority derives from the configured API origin when no test override is supplied", (t) => {
  const previousAppUrl = process.env.APP_URL;
  const previousServerUrl = process.env.SERVER_URL;
  const previousViewerUrl = process.env.VITE_PUBLIC_VIEWER_URL;
  process.env.APP_URL = "https://app.example.test";
  process.env.SERVER_URL = "https://api.example.test";
  process.env.VITE_PUBLIC_VIEWER_URL = "https://viewer.example.test";
  t.after(() => {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
    if (previousServerUrl === undefined) delete process.env.SERVER_URL;
    else process.env.SERVER_URL = previousServerUrl;
    if (previousViewerUrl === undefined) delete process.env.VITE_PUBLIC_VIEWER_URL;
    else process.env.VITE_PUBLIC_VIEWER_URL = previousViewerUrl;
  });

  const didService = createDidService();
  const did = didService.getPlatformDid();
  assert.equal(did, "did:web:api.example.test");
  assert.equal(didService.didToDocumentUrl(did), "https://api.example.test/.well-known/did.json");
  assert.equal(didService.getPublicOrigin(), "https://viewer.example.test");
  assert.equal(didService.buildPublicPassportUrl("/dpp/DPP-1"), "https://viewer.example.test/dpp/DPP-1");
});

test("DID authority encodes a configured API port for local development", (t) => {
  const previousAppUrl = process.env.APP_URL;
  const previousServerUrl = process.env.SERVER_URL;
  const previousViewerUrl = process.env.VITE_PUBLIC_VIEWER_URL;
  process.env.APP_URL = "http://localhost:3000";
  process.env.SERVER_URL = "http://localhost:3001";
  process.env.VITE_PUBLIC_VIEWER_URL = "http://localhost:3004";
  t.after(() => {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
    if (previousServerUrl === undefined) delete process.env.SERVER_URL;
    else process.env.SERVER_URL = previousServerUrl;
    if (previousViewerUrl === undefined) delete process.env.VITE_PUBLIC_VIEWER_URL;
    else process.env.VITE_PUBLIC_VIEWER_URL = previousViewerUrl;
  });

  const didService = createDidService();
  assert.equal(didService.getPlatformDid(), "did:web:localhost%3A3001");
});

test("did service generates and resolves generic product subject DID paths", () => {
  const didService = createService();
  const did = didService.generateItemDid("custom passport v1", "ITEM-001");

  assert.equal(did, "did:web:www.example.test:did:custom-passport-v1:item:ITEM-001");
  assert.deepEqual(didService.parseDid(did), {
    method: "web",
    domain: "www.example.test",
    path: ["did", "custom-passport-v1", "item", "ITEM-001"],
    entityType: "item",
    stableId: "ITEM-001",
    passportType: "custom-passport-v1",
    granularity: null,
  });
  assert.equal(
    didService.didToDocumentPath(did),
    "/did/custom-passport-v1/item/ITEM-001/did.json"
  );
});

test("did service uses neutral passport namespace when no passport type is supplied", () => {
  const didService = createService();

  assert.equal(
    didService.generateModelDid(null, "MODEL-001"),
    "did:web:www.example.test:did:passport:model:MODEL-001"
  );
});
