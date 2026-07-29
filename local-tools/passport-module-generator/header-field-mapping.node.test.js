"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildArtifacts } = require("./server");
const { validateSystemPassportHeader } = require("../../apps/backend-api/src/services/passport-header-fields");

function executeCommonJs(source) {
  const module = { exports: {} };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

test("header assignments turn selected section fields into canonical passport header fields", () => {
  const { artifacts } = buildArtifacts({
    module: {
      family: "header-mapping-product",
      version: "v1",
      baseUrl: "https://example.test",
      systemHeaderFieldAssignments: {
        economicOperatorId: "operatorReference",
        facilityId: "facilityReference",
      },
    },
    roles: {
      businessIdentifierField: "modelIdentifier",
      modelNameField: "modelIdentifier",
    },
    sections: [{
      label: "Identity",
      fields: [
        { fieldLabel: "Model identifier", semanticSlug: "model-identifier" },
        { fieldLabel: "Operator reference", semanticSlug: "operator-reference" },
        { fieldLabel: "Facility reference", semanticSlug: "facility-reference" },
      ],
    }],
    semanticGraph: {
      rootClass: { label: "Header mapping product", key: "headerMappingProduct" },
      rootProperties: [],
      classes: [],
      enums: [],
    },
  });

  const moduleArtifact = artifacts.find((artifact) => artifact.path.endsWith("/module.js"));
  const generatedModule = executeCommonJs(moduleArtifact.content);
  const generatedFieldKeys = generatedModule.sections[0].fields.map((field) => field.key);

  assert.deepEqual(generatedFieldKeys, ["modelName", "economicOperatorId", "facilityId"]);
  assert.deepEqual(
    generatedModule.systemHeader.fieldMappings.filter((mapping) => mapping.sourceType === "field"),
    [
      { slotKey: "economicOperatorId", label: "Economic Operator ID", sourceType: "field", fieldKey: "economicOperatorId" },
      { slotKey: "facilityId", label: "Facility ID", sourceType: "field", fieldKey: "facilityId" },
    ]
  );
  assert.deepEqual(
    validateSystemPassportHeader(generatedModule.systemHeader, generatedModule.sections),
    { valid: true }
  );
});
