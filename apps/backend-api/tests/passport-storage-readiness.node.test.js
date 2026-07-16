"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createSchemaStorageHelpers } = require("../src/modules/passports/schema-storage-helpers");
const {
  getTable,
  quoteSqlIdentifier,
} = require("../src/shared/passports/passport-helpers");
const {
  livePassportSystemColumnDefinitions,
  livePassportSystemColumns,
  systemPassportColumnMappings,
} = require("../src/shared/passports/system-passport-columns");

function createHelpers(pool) {
  return createSchemaStorageHelpers({
    pool,
    logger: { warn() {} },
    getTable,
    normalizePassportRow: (row) => row,
    isEditablePassportStatus: () => true,
    quoteSqlIdentifier,
    joinQuotedSqlIdentifiers: (identifiers) => identifiers.map(quoteSqlIdentifier).join(", "),
    systemPassportColumnMappings,
    livePassportSystemColumns,
    livePassportSystemColumnDefinitions,
    inRevisionStatusesSql: "('inRevision')",
  });
}

function hasDdl(calls) {
  return calls.some(({ sql }) => /\b(CREATE|ALTER|DROP)\b/i.test(sql));
}

test("passport writes fail closed when storage is missing without issuing DDL", async () => {
  const calls = [];
  const helpers = createHelpers({
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM "passportTypes"')) {
        return {
          rows: [{
            typeName: "batteryPassportV1",
            fieldsJson: {
              sections: [{
                key: "identity",
                fields: [{ key: "modelIdentifier", type: "text" }],
              }],
            },
          }],
        };
      }
      if (sql.includes("information_schema.tables")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  await assert.rejects(
    () => helpers.assertPassportTypeStorageReady("batteryPassportV1"),
    (error) => {
      assert.equal(error.code, "passportTypeStorageNotReady");
      assert.equal(error.statusCode, 503);
      assert.equal(error.issues.some((issue) => issue.type === "missingTable"), true);
      return true;
    }
  );
  assert.equal(hasDdl(calls), false);
});

test("controlled provisioning rejects overlong schema field keys before DDL", async () => {
  const calls = [];
  const longFieldKey = `a${"b".repeat(63)}`;
  const helpers = createHelpers({
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('SELECT "fieldsJson" AS "fieldsJson" FROM "passportTypes"')) {
        return {
          rows: [{
            fieldsJson: {
              sections: [{
                key: "identity",
                fields: [{ key: longFieldKey, type: "text" }],
              }],
            },
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  await assert.rejects(
    () => helpers.createPassportTable("batteryPassportV1"),
    (error) => {
      assert.equal(error.code, "passportTypeInvalidStorageFieldKeys");
      assert.equal(error.statusCode, 400);
      assert.equal(error.issues[0].type, "invalidFieldKey");
      return true;
    }
  );
  assert.equal(hasDdl(calls), false);
});

test("schema changes fail closed when stored-record checks cannot query live storage", async () => {
  const helpers = createHelpers({
    async query(sql) {
      if (sql.includes("COUNT(*)::int AS count")) {
        throw new Error("passport table is unavailable");
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  await assert.rejects(
    () => helpers.passportTypeHasStoredRecords("batteryPassportV1"),
    /passport table is unavailable/
  );
});
