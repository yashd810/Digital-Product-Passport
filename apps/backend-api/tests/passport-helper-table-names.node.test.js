"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getTable,
  isSafePassportStorageFieldKey,
  normalizePassportRow,
  parseQualifiedSqlIdentifier,
  passportRuntimeSchema,
  quoteSqlIdentifier,
  toPassportStorageColumnKey,
} = require("../src/shared/passports/passport-helpers");

test("passport storage table names always start with a valid identifier character", () => {
  assert.equal(getTable("exampleProductPassportV1"), "\"passport_runtime\".\"exampleProductPassportV1Passports\"");
  assert.equal(getTable("123Passport"), "\"passport_runtime\".\"type123PassportPassports\"");
  assert.deepEqual(
    parseQualifiedSqlIdentifier(getTable("exampleProductPassportV1"), { expectedSchema: passportRuntimeSchema }),
    { schema: "passport_runtime", table: "exampleProductPassportV1Passports" }
  );
  assert.throws(
    () => parseQualifiedSqlIdentifier('"passport_runtime"."batteryPassports"; DROP TABLE users', { expectedSchema: passportRuntimeSchema }),
    /Invalid qualified SQL identifier/
  );
});

test("passport field keys up to 200 characters map deterministically to safe PostgreSQL columns", () => {
  const formerlyOverlongFieldKey = `a${"b".repeat(100)}`;
  const maxFieldKey = `a${"b".repeat(199)}`;
  const overlongFieldKey = `${maxFieldKey}c`;

  assert.equal(isSafePassportStorageFieldKey(formerlyOverlongFieldKey), true);
  assert.equal(isSafePassportStorageFieldKey(maxFieldKey), true);
  assert.equal(isSafePassportStorageFieldKey(overlongFieldKey), false);
  assert.throws(() => quoteSqlIdentifier(overlongFieldKey), /Invalid SQL identifier/);
  const storageKey = toPassportStorageColumnKey(formerlyOverlongFieldKey);
  assert.equal(storageKey.length, 63);
  assert.equal(toPassportStorageColumnKey(formerlyOverlongFieldKey), storageKey);
  assert.equal(quoteSqlIdentifier(formerlyOverlongFieldKey), `"${storageKey}"`);
  assert.throws(() => getTable(`a${"b".repeat(54)}`), /Invalid SQL identifier/);
});

test("passport row normalization restores long logical keys from physical columns", () => {
  const fieldKey = `long${"FieldName".repeat(12)}`;
  const storageKey = toPassportStorageColumnKey(fieldKey);
  const normalized = normalizePassportRow(
    { dppId: "dpp-1", companyId: 7, [storageKey]: "stored value" },
    { sections: [{ key: "details", fields: [{ key: fieldKey, type: "text" }] }] }
  );

  assert.equal(normalized[fieldKey], "stored value");
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, storageKey), false);
});
