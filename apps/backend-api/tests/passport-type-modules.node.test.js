"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createSemanticModelRegistry = require("../src/services/semantic-model-registry");
const {
  getPassportPolicyCatalog,
  getPassportPolicyForPassportType,
  getPassportTypeModules,
  loadPassportTypeModuleDefinitions,
} = require("../src/passport-modules");

function flattenFields(definition) {
  return (definition.fieldsJson?.sections || [])
    .flatMap((section) => section.fields || []);
}

test("passport type registry discovers arbitrary product modules from files", () => {
  const modulesDir = fs.mkdtempSync(path.join(os.tmpdir(), "dpp-passport-modules-"));
  const modulePath = path.join(modulesDir, "appliance-v1.js");

  fs.writeFileSync(modulePath, `
    "use strict";

    module.exports = {
      moduleKey: "appliance:v1",
      typeName: "appliancePassportV1",
      displayName: "Appliance Passport v1",
      productCategory: "Appliance",
      productIcon: "AP",
      semanticModelKey: "appliance_dictionary_v1",
      identity: {
        businessIdentifierField: "modelIdentifier",
      },
      systemHeader: {
        section: { key: "passportHeader", label: "Passport Header" },
        fieldMappings: [
          { slotKey: "digitalProductPassportId", sourceType: "managed", managedKey: "internalManagedDigitalProductPassportId" },
          { slotKey: "uniqueProductIdentifier", sourceType: "managed", managedKey: "internalManagedUniqueProductIdentifier" },
          { slotKey: "internalAliasId", sourceType: "managed", managedKey: "internalManagedInternalAliasId" },
          { slotKey: "granularity", sourceType: "managed", managedKey: "internalManagedGranularity" },
          { slotKey: "dppSchemaVersion", sourceType: "managed", managedKey: "internalManagedDppSchemaVersion" },
          { slotKey: "dppStatus", sourceType: "managed", managedKey: "internalManagedDppStatus" },
          { slotKey: "lastUpdate", sourceType: "managed", managedKey: "internalManagedLastUpdate" },
          { slotKey: "economicOperatorId", sourceType: "managed", managedKey: "internalManagedEconomicOperatorId" },
          { slotKey: "facilityId", sourceType: "managed", managedKey: "internalManagedFacilityId" },
          { slotKey: "contentSpecificationIds", sourceType: "managed", managedKey: "internalManagedContentSpecificationIds" },
          { slotKey: "subjectDid", sourceType: "managed", managedKey: "internalManagedSubjectDid" },
          { slotKey: "dppDid", sourceType: "managed", managedKey: "internalManagedDppDid" },
          { slotKey: "companyDid", sourceType: "managed", managedKey: "internalManagedCompanyDid" },
        ],
        fieldKeys: [],
      },
      passportPolicy: {
        key: "applianceDppV1",
        displayName: "Appliance Passport Policy v1",
        contentSpecificationIds: ["Appliance_dictionary_v1"],
      },
      sections: [
        {
          key: "applianceIdentity",
          label: "Identity",
          fields: [
            { key: "modelIdentifier", label: "Model Identifier", type: "text" },
          ],
        },
      ],
    };
  `);

  try {
    const rawDefinitions = loadPassportTypeModuleDefinitions({ modulesDir });
    const modules = getPassportTypeModules({ modulesDir });
    const policies = getPassportPolicyCatalog({ modulesDir });
    const policy = getPassportPolicyForPassportType("appliance:v1", null, { modulesDir });

    assert.equal(rawDefinitions.length, 1);
    assert.equal(modules.length, 1);
    assert.equal(modules[0].moduleKey, "appliance:v1");
    assert.equal(modules[0].fieldsJson.sourceModule, "appliance:v1");
    assert.equal(modules[0].fieldsJson.passportPolicyKey, "applianceDppV1");
    assert.equal(modules[0].fieldsJson.passportPolicy.key, "applianceDppV1");
    assert.equal(policy.key, "applianceDppV1");
    assert.ok(policies.some((definition) => definition.key === "applianceDppV1"));
  } finally {
    fs.rmSync(modulesDir, { recursive: true, force: true });
  }
});

test("passport type modules have unique module keys and type names", () => {
  const modules = getPassportTypeModules();
  assert.ok(modules.length > 0);
  assert.ok(modules.some((definition) => definition.moduleKey === "appliance:v1"));
  assert.ok(modules.some((definition) => definition.moduleKey === "battery:v1"));
  assert.ok(modules.some((definition) => definition.moduleKey === "textile:v1"));

  const moduleKeys = new Set();
  const typeNames = new Set();
  for (const definition of modules) {
    assert.ok(definition.moduleKey);
    assert.ok(definition.typeName);
    assert.equal(moduleKeys.has(definition.moduleKey), false, `Duplicate moduleKey: ${definition.moduleKey}`);
    assert.equal(typeNames.has(definition.typeName), false, `Duplicate typeName: ${definition.typeName}`);
    moduleKeys.add(definition.moduleKey);
    typeNames.add(definition.typeName);
  }
});

test("passport type modules expose passport policies", () => {
  const modules = getPassportTypeModules();
  const policies = getPassportPolicyCatalog();
  const policyKeys = new Set(policies.map((policy) => policy.key));

  assert.ok(policyKeys.has("applianceDppV1"));
  assert.ok(policyKeys.has("batteryDppV1"));
  assert.ok(policyKeys.has("textileDppV1"));

  for (const definition of modules) {
    assert.ok(definition.passportPolicy?.key, `${definition.moduleKey} must define a passport policy key`);
    assert.ok(policyKeys.has(definition.passportPolicy.key));
    assert.deepEqual(
      definition.fieldsJson.passportPolicyKey,
      definition.passportPolicy.key
    );
    assert.deepEqual(
      definition.fieldsJson.passportPolicy,
      definition.passportPolicy
    );
  }
});

test("passport policy resolution follows source modules and type names", () => {
  const appliancePolicy = getPassportPolicyForPassportType("appliancePassportV1");
  const batteryPolicy = getPassportPolicyForPassportType("batteryPassportV1");
  const textilePolicy = getPassportPolicyForPassportType("textilePassportV1");
  const sourceModulePolicy = getPassportPolicyForPassportType("custom_name", {
    fieldsJson: { sourceModule: "textile:v1" },
    semanticModelKey: "textile_dictionary_v1",
  });

  assert.equal(appliancePolicy.key, "applianceDppV1");
  assert.equal(batteryPolicy.key, "batteryDppV1");
  assert.equal(textilePolicy.key, "textileDppV1");
  assert.equal(sourceModulePolicy.key, "textileDppV1");
});

test("passport type modules reference registered semantic models", () => {
  const registry = createSemanticModelRegistry();
  for (const definition of getPassportTypeModules()) {
    if (!definition.semanticModelKey) continue;
    assert.ok(
      registry.getModel(definition.semanticModelKey),
      `${definition.moduleKey} references missing semantic model ${definition.semanticModelKey}`
    );
  }
});

test("passport type module field definitions are structurally valid", () => {
  for (const definition of getPassportTypeModules()) {
    assert.match(definition.typeName, /^[a-z][A-Za-z0-9]{1,99}$/);
    assert.ok(Array.isArray(definition.fieldsJson.sections));
    assert.ok(definition.fieldsJson.sections.length > 0);

    const fieldKeys = new Set();
    for (const section of definition.fieldsJson.sections) {
      assert.match(section.key, /^[a-z][A-Za-z0-9]{0,199}$/);
      assert.ok(section.label);
      assert.ok(Array.isArray(section.fields));
      assert.ok(section.fields.length > 0);
    }

    for (const field of flattenFields(definition)) {
      assert.match(field.key, /^[a-z][A-Za-z0-9]{0,199}$/);
      assert.ok(field.label);
      assert.ok(["text", "textarea", "boolean", "file", "table", "url", "date", "symbol"].includes(field.type));
      assert.equal(fieldKeys.has(field.key), false, `Duplicate field key in ${definition.typeName}: ${field.key}`);
      fieldKeys.add(field.key);
    }
  }
});

test("passport type module fields carry locked canonical source semantics", () => {
  for (const definition of getPassportTypeModules()) {
    for (const section of definition.fieldsJson.sections || []) {
      assert.equal(section.sourceModuleKey, definition.moduleKey, `${definition.moduleKey}.${section.key} must retain source module key`);
      for (const field of section.fields || []) {
        assert.equal(field.canonicalLocked, true, `${definition.moduleKey}.${field.key} must be canonical locked`);
        assert.equal(field.sourceModuleKey, definition.moduleKey, `${definition.moduleKey}.${field.key} must retain source module key`);
        assert.equal(field.sourceModuleFieldKey, field.key, `${definition.moduleKey}.${field.key} must retain source field key`);
        assert.ok(field.semanticId, `${definition.moduleKey}.${field.key} must have explicit semanticId`);
        assert.ok(field.elementIdPath, `${definition.moduleKey}.${field.key} must have explicit elementIdPath`);
        assert.ok(field.objectType, `${definition.moduleKey}.${field.key} must have explicit objectType`);
        assert.ok(field.valueDataType, `${definition.moduleKey}.${field.key} must have explicit valueDataType`);
        if (field.type === "table") {
          assert.ok(Array.isArray(field.table_columns), `${definition.moduleKey}.${field.key} must define table columns`);
          for (const column of field.table_columns) {
            assert.equal(column.canonicalLocked, true, `${definition.moduleKey}.${field.key}.${column.key} must be canonical locked`);
            assert.equal(column.sourceModuleKey, definition.moduleKey, `${definition.moduleKey}.${field.key}.${column.key} must retain source module key`);
            assert.equal(column.sourceModuleColumnKey, column.key, `${definition.moduleKey}.${field.key}.${column.key} must retain source column key`);
            assert.ok(column.semanticId, `${definition.moduleKey}.${field.key}.${column.key} must have explicit semanticId`);
            assert.ok(column.elementIdPath, `${definition.moduleKey}.${field.key}.${column.key} must have explicit elementIdPath`);
            assert.ok(column.objectType, `${definition.moduleKey}.${field.key}.${column.key} must have explicit objectType`);
            assert.ok(column.valueDataType, `${definition.moduleKey}.${field.key}.${column.key} must have explicit valueDataType`);
          }
        }
      }
    }
  }
});
