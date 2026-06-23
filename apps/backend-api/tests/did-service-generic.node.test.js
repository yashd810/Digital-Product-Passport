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
