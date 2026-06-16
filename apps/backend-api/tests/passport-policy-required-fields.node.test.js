"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const createRequiredFieldsService = require("../src/services/required-fields-service");
const { getPassportTypeModule } = require("../src/passport-modules");

function createMockPool(typeDef) {
  return {
    async query(sql, params = []) {
      if (sql.includes("FROM passport_types")) {
        return {
          rows: typeDef && params[0] === typeDef.typeName ? [typeDef] : [],
        };
      }

      throw new Error(`Unhandled mock query: ${sql}`);
    },
  };
}

function createRequiredFieldsServiceForModule(moduleKey) {
  const passportType = getPassportTypeModule(moduleKey);
  return {
    passportType,
    service: createRequiredFieldsService({
      pool: createMockPool(passportType),
    }),
  };
}

test("passport policy metadata is resolved from the selected module", () => {
  const { service, passportType } = createRequiredFieldsServiceForModule("textile:v1");

  const policy = service.resolvePassportPolicyMetadata({
    passportType: passportType.typeName,
    typeDef: passportType,
    granularity: "batch",
  });

  assert.equal(policy.key, "textileDppV1");
  assert.deepEqual(policy.contentSpecificationIds, ["Textile_dictionary_v1"]);
  assert.equal(policy.defaultCarrierPolicyKey, "web_public_entry_v1");
  assert.equal(policy.granularity, "batch");
});

test("required-field evaluation is governed by passport type required flags", async () => {
  const typeDef = {
    typeName: "customRequiredPassportV1",
    displayName: "Custom Required Passport v1",
    semanticModelKey: "custom_dictionary_v1",
    passportPolicy: {
      key: "customRequiredDppV1",
      contentSpecificationIds: ["Custom_dictionary_v1"],
    },
    fieldsJson: {
      sections: [{
        key: "identity",
        label: "Identity",
        fields: [
          { key: "modelIdentifier", label: "Model Identifier", type: "text", required: true },
          { key: "serialNumber", label: "Serial Number", type: "text", required: true },
        ],
      }],
    },
  };
  const service = createRequiredFieldsService({
    pool: createMockPool(typeDef),
  });

  const result = await service.evaluatePassport({
    passportType: typeDef.typeName,
    granularity: "item",
    modelIdentifier: "MODEL-X1",
  }, typeDef.typeName, typeDef);

  assert.equal(result.policy.key, "customRequiredDppV1");
  assert.equal(result.semanticModelKey, "custom_dictionary_v1");
  assert.equal(result.category.ruleCoverage.length, 0);
  assert.ok(
    result.requiredFieldIssues.some((issue) => issue.code === "REQUIRED_FIELD_MISSING"),
    "Expected missing required passport fields to be reported"
  );
  assert.equal(result.workflowReleaseAllowed, false);
  assert.equal(result.directReleaseAllowed, false);
});

test("complete required fields allow release without category rules", async () => {
  const { service, passportType } = createRequiredFieldsServiceForModule("textile:v1");

  const result = await service.evaluatePassport({
    passportType: passportType.typeName,
    granularity: "item",
    productModelIdentifier: "STYLE-2026-LINEN-01",
    countryOfOrigin: "SE",
    fiberComposition: "70% organic cotton, 30% recycled polyester",
    recycledContentPercentage: "30",
  }, passportType.typeName, passportType);

  assert.equal(result.policy.key, "textileDppV1");
  assert.deepEqual(result.requiredFieldIssues, []);
  assert.deepEqual(result.category.ruleCoverage, []);
  assert.equal(result.workflowReleaseAllowed, true);
  assert.equal(result.directReleaseAllowed, true);
});
