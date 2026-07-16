"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getTable,
  isSafePassportStorageFieldKey,
  quoteSqlIdentifier,
} = require("../src/shared/passports/passport-helpers");

test("passport storage table names always start with a valid identifier character", () => {
  assert.equal(getTable("exampleProductPassportV1"), "\"exampleProductPassportV1Passports\"");
  assert.equal(getTable("123Passport"), "\"type123PassportPassports\"");
});

test("passport storage identifiers reject values PostgreSQL would silently truncate", () => {
  const maxFieldKey = `a${"b".repeat(62)}`;
  const overlongFieldKey = `${maxFieldKey}c`;

  assert.equal(isSafePassportStorageFieldKey(maxFieldKey), true);
  assert.equal(isSafePassportStorageFieldKey(overlongFieldKey), false);
  assert.throws(() => quoteSqlIdentifier(overlongFieldKey), /Invalid SQL identifier/);
  assert.throws(() => getTable(`a${"b".repeat(54)}`), /Invalid SQL identifier/);
});
