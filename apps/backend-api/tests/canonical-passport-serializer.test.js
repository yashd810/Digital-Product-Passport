"use strict";

const assert = require("assert");

const createDidService = require("../services/did-service");
const createCanonicalPassportSerializer = require("../services/canonicalPassportSerializer");

const didService = createDidService({
  didDomain: "www.claros-dpp.online",
  publicOrigin: "https://www.claros-dpp.online",
  apiOrigin: "https://api.claros.test",
});

const { buildCanonicalPassportPayload } = createCanonicalPassportSerializer({ didService });

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

const typeDef = {
  type_name: "generic_passport",
  fields_json: {
    sections: [
      {
        fields: [
          { key: "batteryMass", dataType: "number" },
          { key: "isReplaceable", dataType: "boolean" },
          { key: "content_specification_ids" },
          { key: "facility_id" },
          { key: "dpp_status" },
        ],
      },
    ],
  },
};

const passport = {
  guid: "dpp_fff9372d-6405-4207-9ed2-808426a3151c",
  lineage_id: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
  passport_type: "generic_passport",
  product_id: "PID-72b99c83",
  product_identifier_did: "did:web:www.claros-dpp.online:did:battery:item:pid-72b99c83",
  release_status: "released",
  version_number: "3",
  updated_at: "2026-04-24T10:00:00.000Z",
  company_id: 2,
  batteryMass: "250.5",
  isReplaceable: "true",
  content_specification_ids: "prEN1234_xyz,prEN5678_abc",
  facility_id: "plant-1",
  dpp_status: "draft",
};

const company = {
  id: 2,
  did_slug: "example-corp",
  dpp_granularity: "item",
};

console.log("\nbuildCanonicalPassportPayload()");
test("preserves typed field values and required headers", () => {
  const payload = buildCanonicalPassportPayload(passport, typeDef, { company });
  assert.strictEqual(payload.digitalProductPassportId, "dpp_fff9372d-6405-4207-9ed2-808426a3151c");
  assert.strictEqual(payload.uniqueProductIdentifier, "did:web:www.claros-dpp.online:did:battery:item:pid-72b99c83");
  assert.strictEqual(payload.localProductId, "PID-72b99c83");
  assert.strictEqual(payload.granularity, "Item");
  assert.strictEqual(payload.dppStatus, "Active");
  assert.strictEqual(payload.subjectDid, "did:web:www.claros-dpp.online:did:battery:item:dpp_72b99c83-952c-4179-96f6-54a513d39dbc");
  assert.strictEqual(payload.dppDid, "did:web:www.claros-dpp.online:did:dpp:item:dpp_72b99c83-952c-4179-96f6-54a513d39dbc");
  assert.strictEqual(payload.companyDid, "did:web:www.claros-dpp.online:did:company:example-corp");
  assert.strictEqual(payload.lastUpdated, "2026-04-24T10:00:00.000Z");
  assert.strictEqual(payload.extensions.claros.versionNumber, 3);
  assert.strictEqual(payload.extensions.claros.passportType, "generic_passport");
  assert.strictEqual(payload.extensions.claros.internalId, "dpp_fff9372d-6405-4207-9ed2-808426a3151c");
  assert.strictEqual(typeof payload.fields.batteryMass, "number");
  assert.strictEqual(payload.fields.batteryMass, 250.5);
  assert.strictEqual(typeof payload.fields.isReplaceable, "boolean");
  assert.strictEqual(payload.fields.isReplaceable, true);
  assert.deepStrictEqual(payload.contentSpecificationIds, ["prEN1234_xyz", "prEN5678_abc"]);
  assert.ok(!("facility_id" in payload.fields));
  assert.ok(!("content_specification_ids" in payload.fields));
  assert.ok(!("dpp_status" in payload.fields));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
