"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizePassportRow,
  projectPassportRowToSchema,
  toPassportStorageColumnKey,
} = require("../src/shared/passports/passport-helpers");

test("compiled passport schemas remove stale physical and nested business fields from reads", () => {
  const longKey = "selectedFieldWithALongLogicalNameThatExceedsThePostgresIdentifierLimitAndUsesAStorageAlias";
  const storageKey = toPassportStorageColumnKey(longKey);
  const typeDef = {
    fieldsJson: {
      sections: [{
        key: "identity",
        fields: [
          { key: "selectedField", type: "text", dataType: "string" },
          { key: longKey, type: "text", dataType: "string" },
        ],
      }],
    },
  };
  const raw = {
    id: 9,
    dppId: "DPP-9",
    companyId: 3,
    passportType: "subsetPassportV1",
    modelName: "Selected model",
    selectedField: "kept",
    [storageKey]: "long key kept",
    excludedLegacyField: "must not leak",
    fields: {
      selectedField: "nested kept",
      excludedLegacyField: "nested must not leak",
    },
  };

  const normalized = normalizePassportRow(raw, typeDef);

  assert.equal(normalized.id, 9);
  assert.equal(normalized.dppId, "DPP-9");
  assert.equal(normalized.modelName, "Selected model");
  assert.equal(normalized.selectedField, "kept");
  assert.equal(normalized[longKey], "long key kept");
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, storageKey), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "excludedLegacyField"), false);
  assert.deepEqual(normalized.fields, { selectedField: "nested kept" });
});

test("an explicit empty compiled schema exposes only the passport envelope", () => {
  const projected = projectPassportRowToSchema({
    dppId: "DPP-empty",
    companyId: 4,
    modelName: "Envelope value",
    excludedLegacyField: "must not leak",
    fields: { excludedLegacyField: "must not leak" },
  }, { fieldsJson: { sections: [] } });

  assert.equal(projected.dppId, "DPP-empty");
  assert.equal(projected.modelName, "Envelope value");
  assert.equal(Object.prototype.hasOwnProperty.call(projected, "excludedLegacyField"), false);
  assert.deepEqual(projected.fields, {});
});

test("rows without a resolved type schema retain legacy normalization behavior", () => {
  const raw = { dppId: "DPP-legacy", legacyValue: "still available" };
  assert.deepEqual(projectPassportRowToSchema(raw, null), raw);
});
