"use strict";

const assert = require("assert");

const createDidService = require("../services/did-service");

const didService = createDidService({
  didDomain: "www.claros-dpp.online",
  publicOrigin: "https://www.claros-dpp.online",
  apiOrigin: "https://api.claros.test",
});

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
    failed += 1;
  }
}

console.log("\ngenerateModelDid()");
test("uses lineage stable id without adding mutable segments", () => {
  assert.strictEqual(
    didService.generateModelDid("battery", "72b99c83-952c-4179-96f6-54a513d39dbc"),
    "did:web:www.claros-dpp.online:did:battery:model:72b99c83-952c-4179-96f6-54a513d39dbc"
  );
});

console.log("\nparseDid()");
test("parses platform DID", () => {
  const parsed = didService.parseDid("did:web:www.claros-dpp.online");
  assert.ok(parsed);
  assert.strictEqual(parsed.entityType, "platform");
});

test("parses subject-level DPP DID", () => {
  const parsed = didService.parseDid("did:web:www.claros-dpp.online:did:dpp:item:BAT-2026-001");
  assert.ok(parsed);
  assert.strictEqual(parsed.entityType, "dpp");
  assert.strictEqual(parsed.granularity, "item");
  assert.strictEqual(parsed.stableId, "BAT-2026-001");
});

test("rejects traversal syntax", () => {
  assert.strictEqual(
    didService.parseDid("did:web:www.claros-dpp.online:did:battery:model:%2e%2e"),
    null
  );
});

console.log("\ndidToDocumentPath()");
test("maps company DID to slug route", () => {
  assert.strictEqual(
    didService.didToDocumentPath("did:web:www.claros-dpp.online:did:company:example-corp"),
    "/did/company/example-corp/did.json"
  );
});

test("maps item DID to stable-id route", () => {
  assert.strictEqual(
    didService.didToDocumentPath("did:web:www.claros-dpp.online:did:battery:item:BAT-2026-001"),
    "/did/battery/item/BAT-2026-001/did.json"
  );
});

test("maps batch DID to stable-id route", () => {
  assert.strictEqual(
    didService.didToDocumentPath("did:web:www.claros-dpp.online:did:battery:batch:BATCH-2026-001"),
    "/did/battery/batch/BATCH-2026-001/did.json"
  );
});

console.log("\npublicUrlToSubjects()");
test("converts did document paths back to DIDs", () => {
  assert.deepStrictEqual(
    didService.publicUrlToSubjects("https://www.claros-dpp.online/did/dpp/model/BAT-2026-001/did.json"),
    ["did:web:www.claros-dpp.online:did:dpp:model:BAT-2026-001"]
  );
});

test("converts batch did document paths back to DIDs", () => {
  assert.deepStrictEqual(
    didService.publicUrlToSubjects("https://www.claros-dpp.online/did/battery/batch/BATCH-2026-001/did.json"),
    ["did:web:www.claros-dpp.online:did:battery:batch:BATCH-2026-001"]
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
