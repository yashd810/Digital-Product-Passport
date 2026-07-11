"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { getTable } = require("../src/shared/passports/passport-helpers");

test("passport storage table names always start with a valid identifier character", () => {
  assert.equal(getTable("exampleProductPassportV1"), "\"exampleProductPassportV1Passports\"");
  assert.equal(getTable("123Passport"), "\"type123PassportPassports\"");
});
