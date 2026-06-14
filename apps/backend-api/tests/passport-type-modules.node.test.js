"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createSemanticModelRegistry = require("../src/infrastructure/semantics/create-semantic-model-registry");
const {
  getComplianceProfileCatalog,
  getComplianceProfileForPassportType,
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
      semanticModelKey: "claros_appliance_dictionary_v1",
      identity: {
        businessIdentifierField: "modelIdentifier",
      },
      complianceProfile: {
        key: "applianceDppV1",
        displayName: "Appliance DPP Profile v1",
        contentSpecificationIds: ["claros_appliance_dictionary_v1"],
        requiredPassportFields: ["complianceProfileKey", "contentSpecificationIds"],
        enforceSemanticMapping: true,
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
    const profiles = getComplianceProfileCatalog({ modulesDir });
    const profile = getComplianceProfileForPassportType("appliance:v1", null, { modulesDir });

    assert.equal(rawDefinitions.length, 1);
    assert.equal(modules.length, 1);
    assert.equal(modules[0].moduleKey, "appliance:v1");
    assert.equal(modules[0].fieldsJson.sourceModule, "appliance:v1");
    assert.equal(modules[0].fieldsJson.complianceProfileKey, "applianceDppV1");
    assert.equal(modules[0].fieldsJson.complianceProfile.key, "applianceDppV1");
    assert.equal(profile.key, "applianceDppV1");
    assert.ok(profiles.some((definition) => definition.key === "applianceDppV1"));
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

test("passport type modules expose compliance profiles", () => {
  const modules = getPassportTypeModules();
  const profiles = getComplianceProfileCatalog();
  const profileKeys = new Set(profiles.map((profile) => profile.key));

  assert.ok(profileKeys.has("applianceDppV1"));
  assert.ok(profileKeys.has("batteryDppV1"));
  assert.ok(profileKeys.has("textileDppV1"));

  for (const definition of modules) {
    assert.ok(definition.complianceProfile?.key, `${definition.moduleKey} must define a compliance profile key`);
    assert.ok(profileKeys.has(definition.complianceProfile.key));
    assert.deepEqual(
      definition.fieldsJson.complianceProfileKey,
      definition.complianceProfile.key
    );
    assert.deepEqual(
      definition.fieldsJson.complianceProfile,
      definition.complianceProfile
    );
  }
});

test("compliance profile resolution follows source modules and type names", () => {
  const applianceProfile = getComplianceProfileForPassportType("appliancePassportV1");
  const batteryProfile = getComplianceProfileForPassportType("batteryPassportV1");
  const textileProfile = getComplianceProfileForPassportType("textilePassportV1");
  const sourceModuleProfile = getComplianceProfileForPassportType("custom_name", {
    fieldsJson: { sourceModule: "textile:v1" },
    semanticModelKey: "claros_textile_dictionary_v1",
  });

  assert.equal(applianceProfile.key, "applianceDppV1");
  assert.equal(batteryProfile.key, "batteryDppV1");
  assert.equal(textileProfile.key, "textileDppV1");
  assert.equal(sourceModuleProfile.key, "textileDppV1");
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
