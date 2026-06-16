"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildManagedImportErrorMessage,
  getInvalidImportFieldKeys,
  getManagedImportFieldKeys,
  isImportFieldAllowed,
  isManagedImportFieldLabel,
  resolveCsvImportField,
} = require("../src/modules/passports/import-field-guardrails");

function createTypeSchema() {
  return {
    allowedKeys: new Set([
      "manufacturer",
      "materialComposition",
      "publicSummary",
      "contentSpecificationIds",
    ]),
    schemaFields: [
      { key: "manufacturer", label: "Manufacturer", type: "text" },
      { key: "materialComposition", label: "Material Composition", type: "table" },
      { key: "contentSpecificationIds", label: "Content Specification IDs", type: "json" },
    ],
  };
}

test("import guardrails allow schema fields and explicit import controls", () => {
  const typeSchema = createTypeSchema();

  assert.equal(isImportFieldAllowed("manufacturer", typeSchema), true);
  assert.equal(isImportFieldAllowed("materialComposition", typeSchema), true);
  assert.equal(isImportFieldAllowed("modelName", typeSchema), true);
  assert.equal(isImportFieldAllowed("internalAliasId", typeSchema), true);
  assert.equal(isImportFieldAllowed("dppId", typeSchema), true);

  assert.deepEqual(getInvalidImportFieldKeys({
    manufacturer: "Acme",
    modelName: "Model A",
    internalAliasId: "ITEM-001",
    dppId: "DPP-001",
  }, typeSchema), []);
});

test("import guardrails reject managed fields even if the passport schema exposes them", () => {
  const typeSchema = createTypeSchema();
  const fields = {
    passportPolicyKey: "client_profile",
    contentSpecificationIds: ["client_spec"],
    carrierPolicyKey: "client_policy",
    economicOperatorId: "client_operator",
    economicOperatorIdentifierScheme: "GLN",
    facilityId: "client_facility",
    uniqueProductIdentifier: "did:example:client",
    releaseStatus: "released",
    versionNumber: 99,
    updatedAt: "2030-01-01T00:00:00.000Z",
  };

  assert.deepEqual(getManagedImportFieldKeys(fields), Object.keys(fields));
  assert.deepEqual(getInvalidImportFieldKeys(fields, typeSchema), Object.keys(fields));
});

test("csv import resolution catches managed field labels and keeps safe fields writable", () => {
  const typeSchema = createTypeSchema();

  assert.deepEqual(resolveCsvImportField("Manufacturer", typeSchema), {
    key: "manufacturer",
    label: "Manufacturer",
    type: "text",
  });
  assert.deepEqual(resolveCsvImportField("modelName", typeSchema), {
    key: "modelName",
    type: "text",
  });
  assert.equal(resolveCsvImportField("Content Specification IDs", typeSchema).key, "contentSpecificationIds");

  assert.equal(isManagedImportFieldLabel("contentSpecificationIds"), true);
  assert.equal(isManagedImportFieldLabel("Content Specification IDs"), true);
  assert.equal(isManagedImportFieldLabel("Release Status"), true);
  assert.equal(isManagedImportFieldLabel("Manufacturer"), false);
});

test("managed import error message explains ownership", () => {
  assert.match(
    buildManagedImportErrorMessage(["passportPolicyKey"]),
    /assigned by the passport type and passport policy/
  );
});
