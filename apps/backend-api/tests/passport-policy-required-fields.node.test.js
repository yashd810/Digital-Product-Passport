"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const createRequiredFieldsService = require("../src/services/required-fields-service");

function createMockPool(typeDef) {
  return {
    async query(sql, params = []) {
      if (sql.includes("FROM \"passportTypes\"")) {
        return {
          rows: typeDef && params[0] === typeDef.typeName ? [typeDef] : [],
        };
      }

      throw new Error(`Unhandled mock query: ${sql}`);
    },
  };
}

function createFixturePassportType() {
  return {
    typeName: "medicalDevicePassportV1",
    displayName: "Medical Device Passport v1",
    semanticModelKey: "medicalDeviceDictionaryV1",
    passportPolicy: {
      key: "medicalDeviceDppV1",
      contentSpecificationIds: ["medicalDeviceDictionaryV1"],
      defaultCarrierPolicyKey: "webPublicEntryV1",
    },
    fieldsJson: {
      sections: [{
        key: "identity",
        label: "Identity",
        fields: [
          { key: "modelIdentifier", label: "Model Identifier", type: "text", required: true },
          { key: "udi", label: "Unique Device Identifier", type: "text", required: true },
        ],
      }],
    },
  };
}

test("passport policy metadata is resolved from the selected passport type definition", () => {
  const passportType = createFixturePassportType();
  const service = createRequiredFieldsService({
    pool: createMockPool(passportType),
  });

  const policy = service.resolvePassportPolicyMetadata({
    passportType: passportType.typeName,
    typeDef: passportType,
    granularity: "batch",
  });

  assert.equal(policy.key, "medicalDeviceDppV1");
  assert.deepEqual(policy.contentSpecificationIds, ["medicalDeviceDictionaryV1"]);
  assert.equal(policy.defaultCarrierPolicyKey, "webPublicEntryV1");
  assert.equal(policy.granularity, "batch");
});

test("required-field evaluation is governed by passport type required flags", async () => {
  const typeDef = createFixturePassportType();
  const service = createRequiredFieldsService({
    pool: createMockPool(typeDef),
  });

  const result = await service.evaluatePassport({
    passportType: typeDef.typeName,
    granularity: "item",
    modelIdentifier: "MODEL-X1",
  }, typeDef.typeName, typeDef);

  assert.equal(result.policy.key, "medicalDeviceDppV1");
  assert.equal(result.semanticModelKey, "medicalDeviceDictionaryV1");
  assert.equal(result.category.ruleCoverage.length, 0);
  assert.ok(
    result.requiredFieldIssues.some((issue) => issue.code === "REQUIRED_FIELD_MISSING"),
    "Expected missing required passport fields to be reported"
  );
  assert.equal(result.workflowReleaseAllowed, false);
  assert.equal(result.directReleaseAllowed, false);
});

test("complete required fields allow release without category rules", async () => {
  const typeDef = createFixturePassportType();
  const service = createRequiredFieldsService({
    pool: createMockPool(typeDef),
  });

  const result = await service.evaluatePassport({
    passportType: typeDef.typeName,
    granularity: "item",
    modelIdentifier: "MODEL-X1",
    udi: "UDI-001",
  }, typeDef.typeName, typeDef);

  assert.equal(result.policy.key, "medicalDeviceDppV1");
  assert.deepEqual(result.requiredFieldIssues, []);
  assert.deepEqual(result.category.ruleCoverage, []);
  assert.equal(result.workflowReleaseAllowed, true);
  assert.equal(result.directReleaseAllowed, true);
});
