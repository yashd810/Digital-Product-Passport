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
  normalizeModuleDefinition,
} = require("../src/modules/passports/services/passport-module-registry");
const { flattenSchemaFieldsFromSections } = require("../src/shared/passports/passport-helpers");
const { runtimeFieldFromSemanticProperty } = require("../src/shared/passports/passport-semantic-graph");
const createDidService = require("../src/platform/identity/did-service");
const createProductIdentifierService = require("../src/modules/passports/services/product-identifier-service");

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

test("battery identifiers derive from the entered serial number and retain the viewer product identifier slot", () => {
  const batteryModule = require("../passport-modules/battery-v1/module");
  const uniqueProductIdentifierMapping = batteryModule.systemHeader.fieldMappings
    .find((mapping) => mapping.slotKey === "uniqueProductIdentifier");

  assert.equal(batteryModule.identity.businessIdentifierField, "batterySerialNumber");
  assert.deepEqual(uniqueProductIdentifierMapping, {
    slotKey: "uniqueProductIdentifier",
    label: "Unique Product Identifier",
    sourceType: "field",
    fieldKey: "uniqueProductIdentifier",
  });

  const productIdentifierService = createProductIdentifierService({
    didService: createDidService({
      apiOrigin: "https://api.example.test",
      publicOrigin: "https://dpp.example.test",
      didDomain: "example.test",
    }),
  });
  const source = productIdentifierService.extractBusinessProductIdentifier(
    { batterySerialNumber: "BAT-SN-001" },
    batteryModule
  );
  const identifier = productIdentifierService.buildCanonicalProductDid({
    companyName: "Example Manufacturer",
    passportType: batteryModule.typeName,
    rawProductId: source,
    granularity: "item",
  });

  assert.equal(source, "BAT-SN-001");
  assert.equal(identifier, "did:web:example.test:did:example-manufacturer:item:BAT-SN-001");
});

test("semantic class collections preserve an explicit table UI type", () => {
  const field = runtimeFieldFromSemanticProperty({
    key: "materials",
    rangeKind: "class",
    rangeClassKey: "materialEntry",
    relationshipType: "composition",
    minCount: 0,
    maxCount: null,
    uiType: "table",
  }, { classes: [] });

  assert.equal(field.type, "table");
  assert.equal(field.dataType, "array");
  assert.equal(field.storageType, "jsonb");
});

function createModuleDefinition(overrides = {}) {
  const moduleKey = overrides.moduleKey || "example-product:v1";
  const typeName = overrides.typeName || "exampleProductPassportV1";
  const semanticModelKey = overrides.semanticModelKey || "exampleProductDictionaryV1";
  const passportPolicyKey = overrides.passportPolicyKey || "exampleProductDppV1";
  const rootClassIri = "https://example.test/dictionary/example-product/v1/classes/ExampleProductPassport";
  const deviceIdentityClassIri = "https://example.test/dictionary/example-product/v1/classes/DeviceIdentity";
  const componentClassIri = "https://example.test/dictionary/example-product/v1/classes/Component";

  return {
    moduleKey,
    typeName,
    displayName: overrides.displayName || "Example Product Passport v1",
    productCategory: overrides.productCategory || "Example Product",
    productIcon: overrides.productIcon || "MD",
    semanticModelKey,
    identity: {
      businessIdentifierField: "modelName",
      modelNameField: "modelName",
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
              key: "deviceIdentity",
              label: "Device Identity",
              semanticId: "https://example.test/dictionary/example-product/v1/terms/device-identity",
              domainClassKey: "exampleProductPassport",
              domainClassIri: rootClassIri,
              rangeKind: "class",
              rangeClassKey: "deviceIdentity",
              relationshipType: "composition",
              minCount: 0,
              maxCount: 1,
            },
          ],
        },
        {
          key: "deviceIdentity",
          label: "Device Identity",
          semanticId: deviceIdentityClassIri,
          properties: [
            {
              key: "modelName",
              label: "Model name",
              semanticId: "https://example.test/dictionary/example-product/v1/terms/device-identity/model-name",
              domainClassKey: "deviceIdentity",
              domainClassIri: deviceIdentityClassIri,
              rangeKind: "scalar",
              dataType: "string",
              minCount: 0,
              maxCount: 1,
            },
            {
              key: "components",
              label: "Components",
              semanticId: "https://example.test/dictionary/example-product/v1/terms/device-identity/components",
              domainClassKey: "deviceIdentity",
              domainClassIri: deviceIdentityClassIri,
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
            key: "modelName",
            label: "Model name",
            type: "text",
            dataType: "string",
            semanticId: "https://example.test/dictionary/example-product/v1/terms/device-identity/model-name",
            domainClassKey: "deviceIdentity",
            domainClassIri: deviceIdentityClassIri,
            rangeKind: "scalar",
            rangeIri: "http://www.w3.org/2001/XMLSchema#string",
            minCount: 0,
            maxCount: 1,
            elementIdPath: "deviceIdentity.modelName",
            objectType: "SingleValuedDataElement",
            valueDataType: "String",
          },
          {
            key: "components",
            label: "Components",
            type: "objectList",
            dataType: "array",
            semanticId: "https://example.test/dictionary/example-product/v1/terms/device-identity/components",
            domainClassKey: "deviceIdentity",
            domainClassIri: deviceIdentityClassIri,
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

function createNestedOwnershipDefinition() {
  const definition = createModuleDefinition();
  const rootClassIri = "https://example.test/dictionary/example-product/v1/classes/ExampleProductPassport";
  const identityClassIri = "https://example.test/dictionary/example-product/v1/classes/Identity";
  const productDetailsClassIri = "https://example.test/dictionary/example-product/v1/classes/ProductDetails";
  const technicalDetailsClassIri = "https://example.test/dictionary/example-product/v1/classes/TechnicalDetails";
  const fieldSemanticId = "https://example.test/dictionary/example-product/v1/terms/technical-details/technical-details";

  definition.identity.businessIdentifierField = "technicalDetails";
  definition.semanticGraph = {
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
            key: "productDetails",
            label: "Product Details",
            semanticId: "https://example.test/dictionary/example-product/v1/terms/product-details",
            domainClassKey: "exampleProductPassport",
            domainClassIri: rootClassIri,
            rangeKind: "class",
            rangeClassKey: "productDetails",
            relationshipType: "composition",
            minCount: 0,
            maxCount: 1,
          },
          {
            key: "identity",
            label: "Identity",
            semanticId: "https://example.test/dictionary/example-product/v1/terms/identity",
            domainClassKey: "exampleProductPassport",
            domainClassIri: rootClassIri,
            rangeKind: "class",
            rangeClassKey: "identity",
            relationshipType: "composition",
            minCount: 0,
            maxCount: 1,
          },
        ],
      },
      {
        key: "identity",
        label: "Identity",
        semanticId: identityClassIri,
        properties: [{
          key: "modelName",
          label: "Model name",
          semanticId: "https://example.test/dictionary/example-product/v1/terms/identity/model-name",
          domainClassKey: "identity",
          domainClassIri: identityClassIri,
          rangeKind: "scalar",
          dataType: "string",
          minCount: 1,
          maxCount: 1,
        }],
      },
      {
        key: "productDetails",
        label: "Product Details",
        semanticId: productDetailsClassIri,
        properties: [{
          key: "technicalDetails",
          label: "Technical Details",
          semanticId: "https://example.test/dictionary/example-product/v1/terms/product-details/technical-details",
          domainClassKey: "productDetails",
          domainClassIri: productDetailsClassIri,
          rangeKind: "class",
          rangeClassKey: "technicalDetails",
          relationshipType: "composition",
          minCount: 0,
          maxCount: 1,
        }],
      },
      {
        key: "technicalDetails",
        label: "Technical Details",
        semanticId: technicalDetailsClassIri,
        properties: [{
          key: "technicalDetails",
          label: "Technical Details",
          semanticId: fieldSemanticId,
          domainClassKey: "technicalDetails",
          domainClassIri: technicalDetailsClassIri,
          rangeKind: "scalar",
          dataType: "string",
          minCount: 0,
          maxCount: 1,
        }],
      },
    ],
    enums: [],
  };
  definition.sections = [{
    key: "productDetails",
    label: "Product Details",
    fields: [],
    sections: [{
      key: "technicalDetails",
      label: "Technical Details",
      fields: [{
        key: "technicalDetails",
        label: "Technical Details",
        type: "text",
        dataType: "string",
        semanticId: fieldSemanticId,
        domainClassKey: "technicalDetails",
        domainClassIri: technicalDetailsClassIri,
        rangeKind: "scalar",
        rangeIri: "http://www.w3.org/2001/XMLSchema#string",
        minCount: 0,
        maxCount: 1,
        elementIdPath: "technicalDetails",
        objectType: "SingleValuedDataElement",
        valueDataType: "String",
      }],
    }],
  }, {
    key: "identity",
    label: "Identity",
    fields: [{
      key: "modelName",
      label: "Model name",
      type: "text",
      dataType: "string",
      required: true,
      semanticId: "https://example.test/dictionary/example-product/v1/terms/identity/model-name",
      domainClassKey: "identity",
      domainClassIri: identityClassIri,
      rangeKind: "scalar",
      rangeIri: "http://www.w3.org/2001/XMLSchema#string",
      minCount: 1,
      maxCount: 1,
      elementIdPath: "identity.modelName",
      objectType: "SingleValuedDataElement",
      valueDataType: "String",
    }],
  }];
  return definition;
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

test("passport module registry rejects the retired groups schema alias", () => {
  const definition = createModuleDefinition();
  definition.sections[0].groups = [];

  assert.throws(
    () => normalizeModuleDefinition(definition),
    /retired "groups" property is not supported/
  );
});

test("passport module registry rejects reserved passport header keys and semantic IDs", () => {
  const reservedKeyDefinition = createModuleDefinition();
  reservedKeyDefinition.semanticGraph.classes[1].properties.push({
    ...reservedKeyDefinition.semanticGraph.classes[1].properties[0],
    key: "dppStatus",
    label: "DPP status",
    semanticId: "https://example.test/dictionary/example-product/v1/terms/device-identity/dpp-status",
  });
  reservedKeyDefinition.sections[0].fields.push({
    ...reservedKeyDefinition.sections[0].fields[0],
    key: "dppStatus",
    label: "DPP status",
    semanticId: "https://example.test/dictionary/example-product/v1/terms/device-identity/dpp-status",
  });

  assert.throws(
    () => normalizeModuleDefinition(reservedKeyDefinition),
    /contains a reserved passport registry\/header field.*Field "dppStatus" is already generated/
  );

  const reservedSemanticIdDefinition = createModuleDefinition();
  reservedSemanticIdDefinition.semanticGraph.classes[1].properties.push({
    ...reservedSemanticIdDefinition.semanticGraph.classes[1].properties[0],
    key: "schemaVersionCopy",
    label: "Schema version copy",
    semanticId: "dpp:dppSchemaVersion",
  });
  reservedSemanticIdDefinition.sections[0].fields.push({
    ...reservedSemanticIdDefinition.sections[0].fields[0],
    key: "schemaVersionCopy",
    label: "Schema version copy",
    semanticId: "dpp:dppSchemaVersion",
  });

  assert.throws(
    () => normalizeModuleDefinition(reservedSemanticIdDefinition),
    /contains a reserved passport registry\/header field.*uses reserved semanticId "dpp:dppSchemaVersion"/
  );
});

test("passport module registry rejects empty leaf sections", () => {
  const definition = createModuleDefinition();
  definition.sections[0].sections = [{
    key: "emptyDetails",
    label: "Empty Details",
    fields: [],
  }];

  assert.throws(
    () => normalizeModuleDefinition(definition),
    /section "emptyDetails" must contain at least one field or subsection/
  );
});

test("passport module registry resolves fields from their immediate section class", () => {
  const normalized = normalizeModuleDefinition(createNestedOwnershipDefinition());
  const field = normalized.fieldsJson.sections[0].sections[0].fields[0];

  assert.equal(field.key, "technicalDetails");
  assert.equal(field.type, "text");
  assert.equal(field.domainClassKey, "technicalDetails");
  assert.equal(
    field.semanticId,
    "https://example.test/dictionary/example-product/v1/terms/technical-details/technical-details"
  );
});

test("passport module registry requires root and nested section containment links", () => {
  const missingNestedLink = createNestedOwnershipDefinition();
  missingNestedLink.semanticGraph.classes
    .find((classDef) => classDef.key === "productDetails")
    .properties = [];
  assert.throws(
    () => normalizeModuleDefinition(missingNestedLink),
    /section "technicalDetails" is missing its semantic graph containment property on class "productDetails"/
  );

  const wrongRootLink = createNestedOwnershipDefinition();
  const rootClass = wrongRootLink.semanticGraph.classes
    .find((classDef) => classDef.key === "exampleProductPassport");
  rootClass.properties.push({
    key: "technicalDetails",
    label: "Technical Details",
    semanticId: "https://example.test/dictionary/example-product/v1/terms/root/technical-details",
    domainClassKey: "exampleProductPassport",
    domainClassIri: rootClass.semanticId,
    rangeKind: "class",
    rangeClassKey: "technicalDetails",
    relationshipType: "composition",
    minCount: 0,
    maxCount: 1,
  });
  assert.throws(
    () => normalizeModuleDefinition(wrongRootLink),
    /section "technicalDetails" is linked from semantic class "exampleProductPassport" instead of its schema parent "productDetails"/
  );
});

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
  const invalidDefinition = createModuleDefinition();
  invalidDefinition.sections[0].fields.push({
    key: "modelId",
    label: "Model Identifier",
    type: "text",
    dataType: "string",
    semanticId: "https://example.test/dictionary/example-product/v1/terms/model-id",
    elementIdPath: "deviceIdentity.modelId",
    objectType: "SingleValuedDataElement",
    valueDataType: "String",
  });
  writeModulePackage(packagesDir, "example-product-v1", invalidDefinition);

  assert.throws(
    () => getPassportTypeModules({ packagesDir }),
    /field "modelId" is missing from its owning semantic graph class "deviceIdentity"/
  );
}));

test("passport type modules accept logical field keys up to 200 characters", () => {
  const definition = createModuleDefinition();
  const longFieldKey = `a${"b".repeat(199)}`;
  const semanticId = `https://example.test/dictionary/example-product/v1/terms/${longFieldKey}`;
  definition.semanticGraph.classes[1].properties.push({
    ...definition.semanticGraph.classes[1].properties[0],
    key: longFieldKey,
    label: "Long custom field",
    semanticId,
  });
  definition.sections[0].fields.push({
    ...definition.sections[0].fields[0],
    key: longFieldKey,
    label: "Long custom field",
    semanticId,
  });

  assert.equal(
    normalizeModuleDefinition(definition).fieldsJson.sections[0].fields.at(-1).key,
    longFieldKey
  );
});

test("passport type modules reject logical field keys longer than 200 characters", () => {
  const definition = createModuleDefinition();
  const longFieldKey = `a${"b".repeat(200)}`;
  const semanticId = `https://example.test/dictionary/example-product/v1/terms/${longFieldKey}`;
  definition.semanticGraph.classes[1].properties.push({
    ...definition.semanticGraph.classes[1].properties[0],
    key: longFieldKey,
    label: "Long custom field",
    semanticId,
  });
  definition.sections[0].fields.push({
    ...definition.sections[0].fields[0],
    key: longFieldKey,
    label: "Long custom field",
    semanticId,
  });

  assert.throws(() => normalizeModuleDefinition(definition), /at most 200 characters/);
});
