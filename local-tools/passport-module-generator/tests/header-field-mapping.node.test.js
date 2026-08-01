"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildArtifacts } = require("../server");
const { validateSystemPassportHeader } = require("../../../apps/backend-api/src/modules/passports/services/passport-header-fields");

function executeCommonJs(source) {
  const module = { exports: {} };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

test("confirmed header assignments turn selected section fields into canonical passport header fields", () => {
  const { artifacts } = buildArtifacts({
    module: {
      family: "header-mapping-product",
      version: "v1",
      baseUrl: "https://example.test",
      systemHeaderFieldAssignments: {
        economicOperatorId: "operatorReference",
        facilityId: "facilityReference",
      },
      systemHeaderFieldConfirmations: {
        economicOperatorId: true,
        facilityId: true,
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

test("pending header selections keep their label-derived keys and are not exported as mappings", () => {
  const { artifacts } = buildArtifacts({
    module: {
      family: "pending-header-mapping-product",
      version: "v1",
      baseUrl: "https://example.test",
      systemHeaderFieldAssignments: {
        economicOperatorId: "operatorReference",
      },
      systemHeaderFieldConfirmations: {
        economicOperatorId: false,
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
      ],
    }],
    semanticGraph: {
      rootClass: { label: "Pending header mapping product", key: "pendingHeaderMappingProduct" },
      rootProperties: [],
      classes: [],
      enums: [],
    },
  });

  const moduleArtifact = artifacts.find((artifact) => artifact.path.endsWith("/module.js"));
  const generatedModule = executeCommonJs(moduleArtifact.content);
  const generatedFieldKeys = generatedModule.sections[0].fields.map((field) => field.key);

  assert.deepEqual(generatedFieldKeys, ["modelName", "operatorReference"]);
  assert.deepEqual(
    generatedModule.systemHeader.fieldMappings.filter((mapping) => mapping.sourceType === "field"),
    []
  );
  assert.deepEqual(
    validateSystemPassportHeader(generatedModule.systemHeader, generatedModule.sections),
    { valid: true }
  );
});

test("every user-mappable header slot can be confirmed while app-owned identifiers stay managed", () => {
  const headerSlotKeys = [
    "uniqueProductIdentifier",
    "granularity",
    "dppSchemaVersion",
    "dppStatus",
    "lastUpdate",
    "economicOperatorId",
    "facilityId",
    "contentSpecificationIds",
  ];
  const sourceFieldKey = (slotKey) => `${slotKey}Source`;
  const { artifacts } = buildArtifacts({
    module: {
      family: "all-header-mapping-product",
      version: "v1",
      baseUrl: "https://example.test",
      systemHeaderFieldAssignments: Object.fromEntries(
        headerSlotKeys.map((slotKey) => [slotKey, sourceFieldKey(slotKey)])
      ),
      systemHeaderFieldConfirmations: Object.fromEntries(
        headerSlotKeys.map((slotKey) => [slotKey, true])
      ),
    },
    roles: {
      businessIdentifierField: "modelIdentifier",
      modelNameField: "modelIdentifier",
    },
    sections: [{
      label: "Identity",
      fields: [
        { fieldLabel: "Model identifier", semanticSlug: "model-identifier" },
        ...headerSlotKeys.map((slotKey) => ({
          fieldLabel: `${slotKey} source`,
          semanticSlug: `${slotKey}-source`,
        })),
      ],
    }],
    semanticGraph: {
      rootClass: { label: "All header mapping product", key: "allHeaderMappingProduct" },
      rootProperties: [],
      classes: [],
      enums: [],
    },
  });

  const moduleArtifact = artifacts.find((artifact) => artifact.path.endsWith("/module.js"));
  const generatedModule = executeCommonJs(moduleArtifact.content);

  assert.deepEqual(
    generatedModule.systemHeader.fieldMappings.filter((mapping) => mapping.sourceType === "field")
      .map((mapping) => mapping.slotKey),
    headerSlotKeys
  );
  assert.deepEqual(
    validateSystemPassportHeader(generatedModule.systemHeader, generatedModule.sections),
    { valid: true }
  );
  assert.deepEqual(
    generatedModule.systemHeader.fieldMappings
      .filter((mapping) => ["dppDid", "companyDid"].includes(mapping.slotKey))
      .map((mapping) => [mapping.slotKey, mapping.sourceType, mapping.managedKey]),
    [
      ["dppDid", "managed", "internalManagedDppDid"],
      ["companyDid", "managed", "internalManagedCompanyDid"],
    ]
  );
});
