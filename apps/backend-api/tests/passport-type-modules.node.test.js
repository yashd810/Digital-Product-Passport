"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  getPassportPolicyCatalog,
  getPassportPolicyForPassportType,
  getPassportTypeModules,
  loadPassportTypeModuleDefinitions,
} = require("../src/passport-modules");

function createSystemHeader() {
  return {
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
  };
}

function createModuleDefinition(overrides = {}) {
  const moduleKey = overrides.moduleKey || "medical-device:v1";
  const typeName = overrides.typeName || "medicalDevicePassportV1";
  const semanticModelKey = overrides.semanticModelKey || "medicalDeviceDictionaryV1";
  const passportPolicyKey = overrides.passportPolicyKey || "medicalDeviceDppV1";

  return {
    moduleKey,
    typeName,
    displayName: overrides.displayName || "Medical Device Passport v1",
    productCategory: overrides.productCategory || "Medical Device",
    productIcon: overrides.productIcon || "MD",
    semanticModelKey,
    identity: {
      businessIdentifierField: "modelIdentifier",
    },
    systemHeader: createSystemHeader(),
    passportPolicy: {
      key: passportPolicyKey,
      displayName: `${overrides.displayName || "Medical Device Passport"} Policy`,
      contentSpecificationIds: [semanticModelKey],
      defaultCarrierPolicyKey: "webPublicEntryV1",
    },
    sections: overrides.sections || [
      {
        key: "deviceIdentity",
        label: "Device Identity",
        fields: [
          {
            key: "modelIdentifier",
            label: "Model Identifier",
            type: "text",
            semanticId: "https://example.test/dictionary/medical-device/v1/terms/model-identifier",
            elementIdPath: "deviceIdentity.modelIdentifier",
            objectType: "SingleValuedDataElement",
            valueDataType: "String",
          },
          {
            key: "components",
            label: "Components",
            type: "table",
            semanticId: "https://example.test/dictionary/medical-device/v1/terms/components",
            elementIdPath: "deviceIdentity.components",
            objectType: "CollectionDataElement",
            valueDataType: "String",
            tableColumns: [
              {
                key: "componentName",
                label: "Component Name",
                type: "text",
                semanticId: "https://example.test/dictionary/medical-device/v1/terms/component-name",
                elementIdPath: "deviceIdentity.components.componentName",
                objectType: "SingleValuedDataElement",
                valueDataType: "String",
              },
            ],
          },
        ],
      },
    ],
  };
}

function writeModuleFile(modulesDir, fileName, definition) {
  fs.writeFileSync(
    path.join(modulesDir, fileName),
    `"use strict";\n\nmodule.exports = ${JSON.stringify(definition, null, 2)};\n`
  );
}

function withTempModules(callback) {
  const modulesDir = fs.mkdtempSync(path.join(os.tmpdir(), "dpp-passport-modules-"));
  try {
    return callback(modulesDir);
  } finally {
    fs.rmSync(modulesDir, { recursive: true, force: true });
  }
}

test("default passport module registry starts empty for fresh deployments", () => {
  const modules = getPassportTypeModules();

  assert.deepEqual(modules, []);
});

test("passport type registry discovers arbitrary product modules from files", () => withTempModules((modulesDir) => {
  writeModuleFile(modulesDir, "medical-device-v1.js", createModuleDefinition());

  const rawDefinitions = loadPassportTypeModuleDefinitions({ modulesDir });
  const modules = getPassportTypeModules({ modulesDir });
  const policies = getPassportPolicyCatalog({ modulesDir });
  const policy = getPassportPolicyForPassportType("medical-device:v1", null, { modulesDir });

  assert.equal(rawDefinitions.length, 1);
  assert.equal(modules.length, 1);
  assert.equal(modules[0].moduleKey, "medical-device:v1");
  assert.equal(modules[0].fieldsJson.sourceModule, "medical-device:v1");
  assert.equal(modules[0].fieldsJson.passportPolicyKey, "medicalDeviceDppV1");
  assert.equal(modules[0].fieldsJson.passportPolicy.key, "medicalDeviceDppV1");
  assert.equal(policy.key, "medicalDeviceDppV1");
  assert.ok(policies.some((definition) => definition.key === "medicalDeviceDppV1"));
}));

test("passport policy resolution follows source modules and type names", () => withTempModules((modulesDir) => {
  writeModuleFile(modulesDir, "medical-device-v1.js", createModuleDefinition());

  const modulePolicy = getPassportPolicyForPassportType("medical-device:v1", null, { modulesDir });
  const typePolicy = getPassportPolicyForPassportType("medicalDevicePassportV1", null, { modulesDir });
  const sourceModulePolicy = getPassportPolicyForPassportType("customName", {
    fieldsJson: { sourceModule: "medical-device:v1" },
    semanticModelKey: "medicalDeviceDictionaryV1",
  }, { modulesDir });

  assert.equal(modulePolicy.key, "medicalDeviceDppV1");
  assert.equal(typePolicy.key, "medicalDeviceDppV1");
  assert.equal(sourceModulePolicy.key, "medicalDeviceDppV1");
}));

test("passport type module fields carry locked canonical source semantics", () => withTempModules((modulesDir) => {
  writeModuleFile(modulesDir, "medical-device-v1.js", createModuleDefinition());
  const [definition] = getPassportTypeModules({ modulesDir });

  for (const section of definition.fieldsJson.sections || []) {
    assert.equal(section.sourceModuleKey, definition.moduleKey);
    for (const field of section.fields || []) {
      assert.equal(field.canonicalLocked, true);
      assert.equal(field.sourceModuleKey, definition.moduleKey);
      assert.equal(field.sourceModuleFieldKey, field.key);
      assert.ok(field.semanticId);
      assert.ok(field.elementIdPath);
      assert.ok(field.objectType);
      assert.ok(field.valueDataType);
      if (field.type === "table") {
        assert.ok(Array.isArray(field.tableColumns));
        for (const column of field.tableColumns) {
          assert.equal(column.canonicalLocked, true);
          assert.equal(column.sourceModuleKey, definition.moduleKey);
          assert.equal(column.sourceModuleColumnKey, column.key);
          assert.ok(column.semanticId);
          assert.ok(column.elementIdPath);
          assert.ok(column.objectType);
          assert.ok(column.valueDataType);
        }
      }
    }
  }
}));
