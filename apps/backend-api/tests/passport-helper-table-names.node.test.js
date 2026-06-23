"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { getTable } = require("../src/shared/passports/passport-helpers");

test("passport storage table names always start with a valid identifier character", () => {
  assert.equal(getTable("medicalDevicePassportV1"), "\"medicalDevicePassportV1Passports\"");
  assert.equal(getTable("123Passport"), "\"type123PassportPassports\"");
});
