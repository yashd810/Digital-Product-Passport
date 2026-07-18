"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { addPassportRegistryForeignKey } = require("../src/db/init");
const { createSchemaStorageHelpers } = require("../src/modules/passports/schema-storage-helpers");
const { buildCanonicalIdentityBundle } = require("../src/shared/identifiers/canonical-identity-bundle");
const {
  assertCanonicalSchemaSections,
  getSectionChildren,
  mapCompanyRow,
} = require("../src/shared/passports/passport-helpers");

test("company and identity mappings ignore the retired dppGranularity alias", () => {
  const company = mapCompanyRow({
    companyName: "Example Manufacturer",
    dppGranularity: "batch",
  });
  const identity = buildCanonicalIdentityBundle({
    passport: { lineageId: "passport-1", granularity: "model" },
    company: { companyName: "Example Manufacturer", dppGranularity: "batch" },
    didService: {
      normalizeGranularity: (value) => value,
      normalizeStableId: (value) => value,
      normalizeCompanySlug: (value) => value.toLowerCase().replace(/\s+/g, "-"),
      normalizePassportTypeSegment: (value) => value,
      generateCompanyDid: () => null,
      generateModelDid: () => null,
      generateDppDid: () => null,
    },
  });

  assert.equal(company.defaultGranularity, "item");
  assert.equal(Object.hasOwn(company, "dppGranularity"), false);
  assert.equal(identity.resolvedGranularity, "model");
});

test("canonical identity does not fall back to the retired guid alias", () => {
  const identity = buildCanonicalIdentityBundle({
    passport: { guid: "retired-guid-only" },
    didService: {
      normalizeGranularity: (value) => value,
      normalizeStableId: (value) => value,
      normalizeCompanySlug: (value) => value,
      normalizePassportTypeSegment: (value) => value,
      generateDppDid: () => null,
    },
  });

  assert.equal(identity.stableId, null);
  assert.equal(identity.digitalProductPassportId, null);
});

test("schema helpers reject retired groups instead of traversing them", () => {
  const canonicalSection = {
    key: "productIdentity",
    sections: [{ key: "manufacturer", fields: [] }],
  };

  assert.deepEqual(getSectionChildren(canonicalSection), canonicalSection.sections);
  assert.throws(
    () => assertCanonicalSchemaSections([{ key: "productIdentity", groups: [] }]),
    /retired "groups" property is not supported/
  );
  assert.throws(
    () => assertCanonicalSchemaSections({ groups: [] }),
    /retired "groups" property is not supported/
  );
  assert.throws(
    () => getSectionChildren({ key: "productIdentity", groups: [] }),
    /retired "groups" property is not supported/
  );
});

test("schema storage no longer exposes the retired no-op key migration", () => {
  const helpers = createSchemaStorageHelpers({
    pool: { query: async () => ({ rows: [] }) },
    logger: {},
    getTable: () => '"examplePassports"',
    normalizePassportRow: (row) => row,
    isEditablePassportStatus: () => true,
    quoteSqlIdentifier: (value) => `"${value}"`,
    joinQuotedSqlIdentifiers: (identifiers) => identifiers.join(", "),
    systemPassportColumnMappings: [],
    livePassportSystemColumns: new Set(),
    livePassportSystemColumnDefinitions: [],
    inRevisionStatusesSql: "('inRevision')",
  });

  assert.equal(Object.hasOwn(helpers, "migratePassportStorageToSchemaKeys"), false);
});

test("passport registry foreign keys fail closed when a required child column is absent", async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };

  await assert.rejects(
    () => addPassportRegistryForeignKey(pool, {
      tableName: "passportAttachments",
      columnName: "passportDppId",
      constraintName: "passportAttachmentsPassportDppIdFk",
    }),
    /Cannot add passportAttachmentsPassportDppIdFk: required child column passportAttachments\.passportDppId is missing/
  );
  assert.equal(calls.length, 1);
});
