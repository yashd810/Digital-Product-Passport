"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { getTable } = require("../src/shared/passports/passport-helpers");

test("passport storage table names always start with a valid identifier character", () => {
  assert.equal(getTable("electronicsPassportV1"), "electronics_passport_v1_passports");
  assert.equal(getTable("123Passport"), "type_123_passport_passports");
});
