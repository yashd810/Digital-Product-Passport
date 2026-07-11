"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  discoverPassportModulePackages,
  getPassportPolicyCatalog,
  getPassportPolicyForPassportType,
  getPassportTypeModules,
  loadPassportTypeModuleDefinitions,
} = require("../src/services/passport-module-registry");
const { flattenSchemaFieldsFromSections } = require("../src/shared/passports/passport-helpers");

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
  const moduleKey = overrides.moduleKey || "example-product:v1";
  const typeName = overrides.typeName || "exampleProductPassportV1";
  const semanticModelKey = overrides.semanticModelKey || "exampleProductDictionaryV1";
  const passportPolicyKey = overrides.passportPolicyKey || "exampleProductDppV1";
  const rootClassIri = "https://example.test/dictionary/example-product/v1/classes/ExampleProductPassport";
  const componentClassIri = "https://example.test/dictionary/example-product/v1/classes/Component";

  return {
    moduleKey,
    typeName,
    displayName: overrides.displayName || "Example Product Passport v1",
    productCategory: overrides.productCategory || "Example Product",
    productIcon: overrides.productIcon || "MD",
    semanticModelKey,
    identity: {
      businessIdentifierField: "modelIdentifier",
    },
    systemHeader: createSystemHeader(),
    passportPolicy: {
      key: passportPolicyKey,
      displayName: `${overrides.displayName || "Example Product Passport"} Policy`,
      contentSpecificationIds: [semanticModelKey],
      defaultCarrierPolicyKey: "webPublicEntryV1",
    },
    semanticGraph: overrides.semanticGraph || {
      schemaVersion: 1,
      rootClassKey: "exampleProductPassport",
      classes: [
        {
          key: "exampleProductPassport",
          label: "Example Product Passport",
          semanticId: rootClassIri,
          root: true,
          properties: [
            {
              key: "modelIdentifier",
              label: "Model Identifier",
              semanticId: "https://example.test/dictionary/example-product/v1/terms/model-identifier",
              domainClassKey: "exampleProductPassport",
              domainClassIri: rootClassIri,
              rangeKind: "scalar",
              dataType: "string",
              minCount: 0,
              maxCount: 1,
            },
            {
              key: "components",
              label: "Components",
              semanticId: "https://example.test/dictionary/example-product/v1/terms/components",
              domainClassKey: "exampleProductPassport",
              domainClassIri: rootClassIri,
              rangeKind: "class",
              rangeClassKey: "component",
              relationshipType: "composition",
              minCount: 0,
              maxCount: null,
            },
          ],
        },
        {
          key: "component",
          label: "Component",
          semanticId: componentClassIri,
          properties: [{
            key: "componentName",
            label: "Component Name",
            semanticId: "https://example.test/dictionary/example-product/v1/terms/component/component-name",
            domainClassKey: "component",
            domainClassIri: componentClassIri,
            rangeKind: "scalar",
            dataType: "string",
            minCount: 0,
            maxCount: 1,
          }],
        },
      ],
      enums: [],
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
            dataType: "string",
            semanticId: "https://example.test/dictionary/example-product/v1/terms/model-identifier",
            domainClassKey: "exampleProductPassport",
            domainClassIri: rootClassIri,
            rangeKind: "scalar",
            rangeIri: "http://www.w3.org/2001/XMLSchema#string",
            minCount: 0,
            maxCount: 1,
            elementIdPath: "deviceIdentity.modelIdentifier",
            objectType: "SingleValuedDataElement",
            valueDataType: "String",
          },
          {
            key: "components",
            label: "Components",
            type: "objectList",
            dataType: "array",
            semanticId: "https://example.test/dictionary/example-product/v1/terms/components",
            domainClassKey: "exampleProductPassport",
            domainClassIri: rootClassIri,
            rangeKind: "class",
            rangeClassKey: "component",
            rangeIri: componentClassIri,
            relationshipType: "composition",
            minCount: 0,
            maxCount: null,
            elementIdPath: "deviceIdentity.components",
            objectType: "DataElementCollection",
            valueDataType: "Array",
          },
        ],
      },
    ],
  };
}

function writeModulePackage(packagesDir, folderName, definition) {
  const packageDir = path.join(packagesDir, folderName);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "module.js"),
    `"use strict";\n\nmodule.exports = ${JSON.stringify(definition, null, 2)};\n`
  );
  fs.writeFileSync(
    path.join(packageDir, "manifest.json"),
    `${JSON.stringify({ semanticModelKey: definition.semanticModelKey }, null, 2)}\n`
  );
}

function withTempModules(callback) {
  const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "dpp-passport-modules-"));
  try {
    return callback(packagesDir);
  } finally {
    fs.rmSync(packagesDir, { recursive: true, force: true });
  }
}

test("default passport module registry starts empty for fresh deployments", () => withTempModules((packagesDir) => {
  const modules = getPassportTypeModules({ packagesDir });

  assert.deepEqual(modules, []);
}));

test("passport type registry discovers arbitrary product module packages", () => withTempModules((packagesDir) => {
  writeModulePackage(packagesDir, "example-product-v1", createModuleDefinition());

  const rawDefinitions = loadPassportTypeModuleDefinitions({ packagesDir });
  const modules = getPassportTypeModules({ packagesDir });
  const policies = getPassportPolicyCatalog({ packagesDir });
  const policy = getPassportPolicyForPassportType("example-product:v1", null, { packagesDir });

  assert.equal(rawDefinitions.length, 1);
  assert.equal(modules.length, 1);
  assert.equal(modules[0].moduleKey, "example-product:v1");
  assert.equal(modules[0].fieldsJson.sourceModule, "example-product:v1");
  assert.equal(modules[0].fieldsJson.passportPolicyKey, "exampleProductDppV1");
  assert.equal(modules[0].fieldsJson.passportPolicy.key, "exampleProductDppV1");
  assert.equal(policy.key, "exampleProductDppV1");
  assert.ok(policies.some((definition) => definition.key === "exampleProductDppV1"));
}));

test("passport package discovery enforces the moduleKey folder name", () => withTempModules((packagesDir) => {
  writeModulePackage(packagesDir, "wrong-folder-v1", createModuleDefinition());

  assert.throws(
    () => discoverPassportModulePackages({ packagesDir }),
    /must be named "example-product-v1" for moduleKey "example-product:v1"/
  );
}));

test("passport package discovery requires matching semantic model keys", () => withTempModules((packagesDir) => {
  writeModulePackage(packagesDir, "example-product-v1", createModuleDefinition());
  fs.writeFileSync(
    path.join(packagesDir, "example-product-v1", "manifest.json"),
    `${JSON.stringify({ semanticModelKey: "differentDictionaryV1" }, null, 2)}\n`
  );

  assert.throws(
    () => discoverPassportModulePackages({ packagesDir }),
    /must use the same semanticModelKey in module\.js and manifest\.json/
  );
}));

test("passport package discovery requires fixed module and manifest filenames", () => withTempModules((packagesDir) => {
  const packageDir = path.join(packagesDir, "example-product-v1");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "manifest.json"),
    `${JSON.stringify({ semanticModelKey: "exampleProductDictionaryV1" }, null, 2)}\n`
  );

  assert.throws(
    () => discoverPassportModulePackages({ packagesDir }),
    /is missing module\.js/
  );
}));

test("passport policy resolution follows source modules and type names", () => withTempModules((packagesDir) => {
  writeModulePackage(packagesDir, "example-product-v1", createModuleDefinition());

  const modulePolicy = getPassportPolicyForPassportType("example-product:v1", null, { packagesDir });
  const typePolicy = getPassportPolicyForPassportType("exampleProductPassportV1", null, { packagesDir });
  const sourceModulePolicy = getPassportPolicyForPassportType("customName", {
    fieldsJson: { sourceModule: "example-product:v1" },
    semanticModelKey: "exampleProductDictionaryV1",
  }, { packagesDir });

  assert.equal(modulePolicy.key, "exampleProductDppV1");
  assert.equal(typePolicy.key, "exampleProductDppV1");
  assert.equal(sourceModulePolicy.key, "exampleProductDppV1");
}));

test("passport type module fields carry locked canonical source semantics", () => withTempModules((packagesDir) => {
  writeModulePackage(packagesDir, "example-product-v1", createModuleDefinition());
  const [definition] = getPassportTypeModules({ packagesDir });

  for (const section of definition.fieldsJson.sections || []) {
    assert.equal(section.sourceModuleKey, definition.moduleKey);
  }
  for (const field of flattenSchemaFieldsFromSections(definition.fieldsJson.sections)) {
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
}));

test("passport type module rejects fields that are absent from the semantic graph", () => withTempModules((packagesDir) => {
  const invalidDefinition = createModuleDefinition({
    sections: [{
      key: "deviceIdentity",
      label: "Device Identity",
      fields: [{
        key: "modelId",
        label: "Model Identifier",
        type: "text",
        dataType: "string",
        semanticId: "https://example.test/dictionary/example-product/v1/terms/model-identifier",
        elementIdPath: "deviceIdentity.modelId",
        objectType: "SingleValuedDataElement",
        valueDataType: "String",
      }],
    }],
  });
  writeModulePackage(packagesDir, "example-product-v1", invalidDefinition);

  assert.throws(
    () => getPassportTypeModules({ packagesDir }),
    /field "modelId" is missing from the semantic graph root class/
  );
}));
