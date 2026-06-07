"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const dppIdentity = require("../src/services/dpp-identity-service");

test("dpp identity service generates generic product subject DID paths", () => {
  process.env.APP_URL = "https://api.example.test";

  const did = dppIdentity.productItemDid("Textile Passport v1", "STYLE-001");

  assert.equal(did, "did:web:api.example.test:did:textile-passport-v1:item:STYLE-001");
  assert.deepEqual(dppIdentity.parseDid(did), {
    type: "product",
    domain: "api.example.test",
    passportType: "textile-passport-v1",
    level: "item",
    stableId: "STYLE-001",
  });
  assert.equal(
    dppIdentity.didToDocumentUrl(did),
    "https://api.example.test/did/textile-passport-v1/item/STYLE-001/did.json"
  );
});

test("dpp identity service uses stable DPP DID document paths", () => {
  process.env.APP_URL = "https://api.example.test";

  const did = dppIdentity.dppDid("model", "lineage-123");

  assert.equal(did, "did:web:api.example.test:did:dpp:model:lineage-123");
  assert.deepEqual(dppIdentity.parseDid(did), {
    type: "dpp",
    domain: "api.example.test",
    granularity: "model",
    stableId: "lineage-123",
  });
  assert.equal(
    dppIdentity.didToDocumentUrl(did),
    "https://api.example.test/did/dpp/model/lineage-123/did.json"
  );
});
