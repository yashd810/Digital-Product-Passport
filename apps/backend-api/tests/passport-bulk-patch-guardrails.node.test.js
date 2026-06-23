"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getInvalidBulkPatchFieldKeys,
} = require("../src/modules/passports/register-update-routes");

function createTypeSchema() {
  return {
    allowedKeys: new Set(["manufacturer", "publicSummary"]),
  };
}

test("bulk patch accepts schema fields and explicit editable built-ins", () => {
  const invalidKeys = getInvalidBulkPatchFieldKeys({
    manufacturer: "Acme",
    publicSummary: "Public summary",
    modelName: "Model A",
    internalAliasId: "ITEM-001",
  }, createTypeSchema());

  assert.deepEqual(invalidKeys, []);
});

test("bulk patch rejects system-managed and policy-owned fields", () => {
  const invalidKeys = getInvalidBulkPatchFieldKeys({
    passportPolicyKey: "clientProfile",
    contentSpecificationIds: ["clientSpec"],
    carrierPolicyKey: "clientCarrier",
    economicOperatorId: "clientOperator",
    facilityId: "clientFacility",
    releaseStatus: "released",
    versionNumber: 99,
    updatedAt: "2030-01-01T00:00:00.000Z",
  }, createTypeSchema());

  assert.deepEqual(invalidKeys, [
    "passportPolicyKey",
    "contentSpecificationIds",
    "carrierPolicyKey",
    "economicOperatorId",
    "facilityId",
    "releaseStatus",
    "versionNumber",
    "updatedAt",
  ]);
});
