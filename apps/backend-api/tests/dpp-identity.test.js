"use strict";

// Unit tests for dpp-identity-service.
// Uses Node's built-in assert module — no external test framework required.
// Run with: node apps/backend-api/tests/dpp-identity.test.js

const assert = require("assert");

// ─── SET UP: point APP_URL at the production domain ──────────────────────────
process.env.APP_URL = "https://www.claros-dpp.online";

const dppIdentity = require("../services/dpp-identity-service");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

// ─── getDomain ────────────────────────────────────────────────────────────────
console.log("\ngetDomain()");
test("returns the host from APP_URL", () => {
  assert.strictEqual(dppIdentity.getDomain(), "www.claros-dpp.online");
});

// ─── slugify ─────────────────────────────────────────────────────────────────
console.log("\nslugify()");
test("converts to lowercase and replaces spaces with hyphens", () => {
  assert.strictEqual(dppIdentity.slugify("ACME Corp"), "acme-corp");
});
test("collapses multiple separators", () => {
  assert.strictEqual(dppIdentity.slugify("hello   world!!"), "hello-world");
});
test("handles null gracefully", () => {
  assert.strictEqual(dppIdentity.slugify(null), "");
});

// ─── platformDid ─────────────────────────────────────────────────────────────
console.log("\nplatformDid()");
test("returns correct platform DID", () => {
  assert.strictEqual(dppIdentity.platformDid(), "did:web:www.claros-dpp.online");
});

// ─── companyDid ──────────────────────────────────────────────────────────────
console.log("\ncompanyDid()");
test("returns correct company DID for numeric id", () => {
  assert.strictEqual(
    dppIdentity.companyDid(5),
    "did:web:www.claros-dpp.online:did:company:5"
  );
});
test("throws for null companyId", () => {
  assert.throws(() => dppIdentity.companyDid(null), /companyId/);
});
test("throws for undefined companyId", () => {
  assert.throws(() => dppIdentity.companyDid(undefined), /companyId/);
});

// ─── productModelDid ─────────────────────────────────────────────────────────
console.log("\nproductModelDid()");
test("returns correct product model DID", () => {
  assert.strictEqual(
    dppIdentity.productModelDid(5, "ACME-001"),
    "did:web:www.claros-dpp.online:did:battery:model:5:ACME-001"
  );
});
test("URL-encodes productId with special characters", () => {
  const did = dppIdentity.productModelDid(5, "ACME 001/v2");
  assert.ok(did.includes("ACME%20001%2Fv2"), `Expected encoded productId in: ${did}`);
});
test("throws for null productId", () => {
  assert.throws(() => dppIdentity.productModelDid(5, null), /productId/);
});

// ─── productItemDid ──────────────────────────────────────────────────────────
console.log("\nproductItemDid()");
test("returns correct product item DID", () => {
  assert.strictEqual(
    dppIdentity.productItemDid(5, "ACME-001"),
    "did:web:www.claros-dpp.online:did:battery:item:5:ACME-001"
  );
});

// ─── dppDid ──────────────────────────────────────────────────────────────────
console.log("\ndppDid()");
test("returns correct DPP DID for model granularity", () => {
  assert.strictEqual(
    dppIdentity.dppDid("model", 5, "ACME-001"),
    "did:web:www.claros-dpp.online:did:dpp:model:5:ACME-001"
  );
});
test("returns correct DPP DID for item granularity", () => {
  assert.strictEqual(
    dppIdentity.dppDid("item", 5, "ACME-001"),
    "did:web:www.claros-dpp.online:did:dpp:item:5:ACME-001"
  );
});
test("throws for null granularity", () => {
  assert.throws(() => dppIdentity.dppDid(null, 5, "ACME-001"), /granularity/);
});

// ─── facilityDid ─────────────────────────────────────────────────────────────
console.log("\nfacilityDid()");
test("returns correct facility DID", () => {
  assert.strictEqual(
    dppIdentity.facilityDid("PLANT-A"),
    "did:web:www.claros-dpp.online:did:facility:PLANT-A"
  );
});
test("URL-encodes facilityId with spaces", () => {
  const did = dppIdentity.facilityDid("Plant A / Line 1");
  assert.ok(did.includes("Plant%20A"), `Expected encoded facilityId in: ${did}`);
});

// ─── parseDid ────────────────────────────────────────────────────────────────
console.log("\nparseDid()");
test("returns null for null input", () => {
  assert.strictEqual(dppIdentity.parseDid(null), null);
});
test("returns null for non-did:web string", () => {
  assert.strictEqual(dppIdentity.parseDid("did:key:abc"), null);
});
test("returns null for empty string", () => {
  assert.strictEqual(dppIdentity.parseDid(""), null);
});
test("parses platform DID", () => {
  const parsed = dppIdentity.parseDid("did:web:www.claros-dpp.online");
  assert.ok(parsed, "should not be null");
  assert.strictEqual(parsed.type, "platform");
  assert.strictEqual(parsed.domain, "www.claros-dpp.online");
});
test("parses company DID", () => {
  const parsed = dppIdentity.parseDid("did:web:www.claros-dpp.online:did:company:5");
  assert.ok(parsed);
  assert.strictEqual(parsed.type, "company");
  assert.strictEqual(parsed.companyId, "5");
});
test("parses battery model DID", () => {
  const parsed = dppIdentity.parseDid("did:web:www.claros-dpp.online:did:battery:model:5:ACME-001");
  assert.ok(parsed);
  assert.strictEqual(parsed.type, "battery");
  assert.strictEqual(parsed.level, "model");
  assert.strictEqual(parsed.companyId, "5");
  assert.strictEqual(parsed.productId, "ACME-001");
});
test("parses battery item DID", () => {
  const parsed = dppIdentity.parseDid("did:web:www.claros-dpp.online:did:battery:item:5:ACME-001");
  assert.ok(parsed);
  assert.strictEqual(parsed.type, "battery");
  assert.strictEqual(parsed.level, "item");
});
test("parses DPP DID", () => {
  const parsed = dppIdentity.parseDid("did:web:www.claros-dpp.online:did:dpp:model:5:ACME-001");
  assert.ok(parsed);
  assert.strictEqual(parsed.type, "dpp");
  assert.strictEqual(parsed.granularity, "model");
  assert.strictEqual(parsed.companyId, "5");
  assert.strictEqual(parsed.productId, "ACME-001");
});
test("parses facility DID", () => {
  const parsed = dppIdentity.parseDid("did:web:www.claros-dpp.online:did:facility:PLANT-A");
  assert.ok(parsed);
  assert.strictEqual(parsed.type, "facility");
  assert.strictEqual(parsed.facilityId, "PLANT-A");
});
test("round-trips encoded productId through parseDid", () => {
  const original = "ACME 001/v2";
  const did = dppIdentity.productModelDid(5, original);
  const parsed = dppIdentity.parseDid(did);
  assert.strictEqual(parsed.productId, original);
});

// ─── didToDocumentUrl ────────────────────────────────────────────────────────
console.log("\ndidToDocumentUrl()");
test("maps platform DID to .well-known/did.json", () => {
  assert.strictEqual(
    dppIdentity.didToDocumentUrl("did:web:www.claros-dpp.online"),
    "https://www.claros-dpp.online/.well-known/did.json"
  );
});
test("maps company DID to /did/company/:id/did.json", () => {
  assert.strictEqual(
    dppIdentity.didToDocumentUrl("did:web:www.claros-dpp.online:did:company:5"),
    "https://www.claros-dpp.online/did/company/5/did.json"
  );
});
test("maps battery model DID to /did/battery/model/.../did.json", () => {
  assert.strictEqual(
    dppIdentity.didToDocumentUrl("did:web:www.claros-dpp.online:did:battery:model:5:ACME-001"),
    "https://www.claros-dpp.online/did/battery/model/5/ACME-001/did.json"
  );
});
test("maps DPP DID to /did/dpp/model/.../did.json", () => {
  assert.strictEqual(
    dppIdentity.didToDocumentUrl("did:web:www.claros-dpp.online:did:dpp:model:5:ACME-001"),
    "https://www.claros-dpp.online/did/dpp/model/5/ACME-001/did.json"
  );
});
test("maps facility DID to /did/facility/:id/did.json", () => {
  assert.strictEqual(
    dppIdentity.didToDocumentUrl("did:web:www.claros-dpp.online:did:facility:PLANT-A"),
    "https://www.claros-dpp.online/did/facility/PLANT-A/did.json"
  );
});
test("returns null for invalid DID", () => {
  assert.strictEqual(dppIdentity.didToDocumentUrl("not-a-did"), null);
});

// ─── buildCanonicalPublicUrl ─────────────────────────────────────────────────
console.log("\nbuildCanonicalPublicUrl()");
test("uses product_id (not guid) in the URL", () => {
  const passport = {
    guid:       "11111111-2222-3333-4444-555555555555",
    product_id: "ACME-001",
    model_name: "Acme Battery Pro",
    company_id: 5,
  };
  const url = dppIdentity.buildCanonicalPublicUrl(passport, "Acme Corp");
  assert.ok(!url.includes("11111111"), `URL must not contain guid: ${url}`);
  assert.ok(url.includes("ACME-001"),  `URL must contain product_id: ${url}`);
  assert.ok(url.startsWith("https://"), `URL must be HTTPS: ${url}`);
});
test("builds correct slug structure", () => {
  const passport = {
    guid:       "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    product_id: "MODEL-X",
    model_name: "Model X",
    company_id: 7,
  };
  const url = dppIdentity.buildCanonicalPublicUrl(passport, "Tesla Energy");
  assert.ok(url.includes("/dpp/tesla-energy/model-x/"), `Expected slug path in: ${url}`);
  assert.ok(url.endsWith("MODEL-X"), `Expected encoded productId at end: ${url}`);
});
test("falls back to /passport/:dppId when no product_id", () => {
  const passport = {
    guid:       "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    product_id: null,
    model_name: null,
    company_id: 5,
  };
  const url = dppIdentity.buildCanonicalPublicUrl(passport, "Acme Corp");
  assert.ok(url.includes("/passport/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), `Expected guid fallback: ${url}`);
});

// ─── SUMMARY ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) {
  console.error("Some tests FAILED.");
  process.exit(1);
} else {
  console.log("All tests passed.");
}
