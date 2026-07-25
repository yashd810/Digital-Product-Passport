"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createSemanticModelRegistry = require("../src/services/semantic-model-registry");
const createSemanticPassportExportService = require("../src/services/semantic-passport-export");
const {
  toPassportStorageColumnKey,
} = require("../src/shared/passports/passport-helpers");

function createExportService() {
  return createSemanticPassportExportService({
    semanticModelRegistry: createSemanticModelRegistry(),
  });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeModuleStub(modelDir, { family, version, semanticModelKey }) {
  fs.writeFileSync(
    path.join(modelDir, "module.js"),
    `"use strict";\n\nmodule.exports = ${JSON.stringify({
      moduleKey: `${family}:${version}`,
      typeName: "customProductPassportV3",
      semanticModelKey,
    }, null, 2)};\n`
  );
}

function createEnergyRatingGraph() {
  const rootClassIri = "https://example.test/dictionary/custom-product/v3/classes/CustomProductPassport";
  return {
    schemaVersion: 1,
    rootClassKey: "customProductPassport",
    classes: [{
      key: "customProductPassport",
      label: "Custom Product Passport",
      semanticId: rootClassIri,
      root: true,
      properties: [{
        key: "energyRating",
        label: "Energy Rating",
        semanticId: "https://example.test/dictionary/custom-product/v3/terms/energy-rating",
        domainClassKey: "customProductPassport",
        domainClassIri: rootClassIri,
        rangeKind: "scalar",
        dataType: "string",
        minCount: 0,
        maxCount: 1,
      }],
    }],
    enums: [],
  };
}

function createNestedSectionTypeDefinition() {
  const rootClassIri = "https://example.test/dictionary/custom-product/v3/classes/CustomProductPassport";
  const performanceClassIri = "https://example.test/dictionary/custom-product/v3/classes/Performance";
  const statusEnumIri = "https://example.test/dictionary/custom-product/v3/enums/LifecycleStatus";
  const energyRatingSemanticId = "https://example.test/dictionary/custom-product/v3/terms/performance/energy-rating";
  const lifecycleStatusSemanticId = "https://example.test/dictionary/custom-product/v3/terms/performance/lifecycle-status";
  return {
    typeName: "customProductPassportV3",
    productCategory: "Custom Product",
    semanticModelKey: "unregisteredNestedDictionaryV3",
    fieldsJson: {
      schemaVersion: 4,
      sourceModule: "custom-product:v3",
      moduleDigest: "sha256:module",
      profileDigest: "sha256:profile",
      profile: {
        contractVersion: 1,
        selectionMode: "explicit",
        sourceModule: "custom-product:v3",
        moduleDigest: "sha256:module",
        profileDigest: "sha256:profile",
        includedFields: [{ sourceModuleFieldKey: "energyRating" }, { sourceModuleFieldKey: "lifecycleStatus" }],
      },
      semanticProfile: {
        schemaVersion: 1,
        graphDigest: "sha256:graph",
      },
      semanticGraph: {
        schemaVersion: 1,
        rootClassKey: "customProductPassport",
        classes: [
          {
            key: "customProductPassport",
            label: "Custom Product Passport",
            semanticId: rootClassIri,
            root: true,
            properties: [{
              key: "performance",
              label: "Performance",
              semanticId: "https://example.test/dictionary/custom-product/v3/terms/performance",
              domainClassKey: "customProductPassport",
              domainClassIri: rootClassIri,
              rangeKind: "class",
              rangeClassKey: "performance",
              relationshipType: "composition",
              minCount: 0,
              maxCount: 1,
            }],
          },
          {
            key: "performance",
            label: "Performance",
            semanticId: performanceClassIri,
            properties: [
              {
                key: "energyRating",
                label: "Energy Rating",
                semanticId: energyRatingSemanticId,
                domainClassKey: "performance",
                domainClassIri: performanceClassIri,
                rangeKind: "scalar",
                dataType: "string",
                minCount: 0,
                maxCount: 1,
              },
              {
                key: "lifecycleStatus",
                label: "Lifecycle Status",
                semanticId: lifecycleStatusSemanticId,
                domainClassKey: "performance",
                domainClassIri: performanceClassIri,
                rangeKind: "enum",
                rangeEnumKey: "lifecycleStatus",
                minCount: 0,
                maxCount: 1,
              },
            ],
          },
        ],
        enums: [{
          key: "lifecycleStatus",
          label: "Lifecycle Status",
          semanticId: statusEnumIri,
          values: [{
            key: "active",
            label: "Active",
            semanticId: `${statusEnumIri}/active`,
          }],
        }],
      },
      sections: [{
        key: "performance",
        label: "Performance",
        fields: [
          {
            key: "energyRating",
            label: "Energy Rating",
            type: "text",
            dataType: "string",
            objectType: "SingleValuedDataElement",
            valueDataType: "String",
            semanticId: energyRatingSemanticId,
            domainClassKey: "performance",
            domainClassIri: performanceClassIri,
            rangeKind: "scalar",
            rangeIri: "http://www.w3.org/2001/XMLSchema#string",
            minCount: 0,
            maxCount: 1,
          },
          {
            key: "lifecycleStatus",
            label: "Lifecycle Status",
            type: "select",
            dataType: "string",
            objectType: "SingleValuedDataElement",
            valueDataType: "String",
            semanticId: lifecycleStatusSemanticId,
            domainClassKey: "performance",
            domainClassIri: performanceClassIri,
            rangeKind: "enum",
            rangeEnumKey: "lifecycleStatus",
            rangeIri: statusEnumIri,
            minCount: 0,
            maxCount: 1,
          },
        ],
      }],
    },
  };
}

function createRegistryWithCustomDictionary() {
  const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-export-models-"));
  const modelDir = path.join(packagesDir, "custom-product-v3");
  fs.mkdirSync(modelDir, { recursive: true });

  writeJson(path.join(modelDir, "manifest.json"), {
    semanticModelKey: "customProductDictionaryV3",
    name: "Custom Product Dictionary",
    version: "3.0.0",
  });
  writeModuleStub(modelDir, {
    family: "custom-product",
    version: "v3",
    semanticModelKey: "customProductDictionaryV3",
  });
  writeJson(path.join(modelDir, "terms.json"), [
    {
      slug: "energy-rating",
      label: "Energy rating",
      definition: "Energy performance rating for the product.",
      iri: "https://example.test/dictionary/custom-product/v3/terms/energy-rating",
      internalKey: "energyRating",
      dataType: "string",
      rangeKind: "scalar",
      domain: {
        key: "customProductPassport",
        iri: "https://example.test/dictionary/custom-product/v3/classes/CustomProductPassport",
        label: "Custom Product Passport",
      },
      range: {
        iri: "http://www.w3.org/2001/XMLSchema#string",
        curie: "xsd:string",
        label: "String",
        jsonType: "string",
      },
    },
  ]);
  writeJson(path.join(modelDir, "classes.json"), [{
    key: "customProductPassport",
    label: "Custom Product Passport",
    iri: "https://example.test/dictionary/custom-product/v3/classes/CustomProductPassport",
    root: true,
  }]);
  writeJson(path.join(modelDir, "context.jsonld"), {
    "@context": {
      energyRating: "https://example.test/dictionary/custom-product/v3/terms/energy-rating",
    },
  });

  return {
    registry: createSemanticModelRegistry({ packagesDir }),
    cleanup: () => fs.rmSync(packagesDir, { recursive: true, force: true }),
  };
}

test("semantic export rejects schemas without a semantic graph", () => {
  const {
    buildPassportJsonLdContext,
    buildPassportJsonLdExport,
  } = createExportService();
  const typeDef = {
    typeName: "customPassport",
    productCategory: "Generic Test Passport",
    semanticModelKey: "unregisteredTestModelV1",
    fieldsJson: {
      sections: [
        {
          fields: [
            {
              key: "sampleMass",
              type: "text",
              dataType: "decimal",
              objectType: "SingleValuedDataElement",
              valueDataType: "Decimal",
              semanticId: null,
            },
          ],
        },
      ],
    },
  };

  assert.throws(
    () => buildPassportJsonLdContext(typeDef),
    /requires a semantic class graph/
  );
  assert.throws(
    () => buildPassportJsonLdExport([
      { dppId: "dpp-1", passportType: "customPassport", sampleMass: "450.5" },
    ], "customPassport", { typeDef }),
    /requires a semantic class graph/
  );
});

test("semantic export supports arbitrary registered semantic models without category-specific code", () => {
  const { registry, cleanup } = createRegistryWithCustomDictionary();
  const service = createSemanticPassportExportService({ semanticModelRegistry: registry });
  const { buildPassportJsonLdContext, buildPassportJsonLdExport } = service;
  const typeDef = {
    typeName: "customProductPassportV3",
    productCategory: "Custom Product",
    semanticModelKey: "customProductDictionaryV3",
    fieldsJson: {
      semanticGraph: createEnergyRatingGraph(),
      sections: [
        {
          fields: [
            {
              key: "energyRating",
              type: "text",
              dataType: "string",
              objectType: "SingleValuedDataElement",
              valueDataType: "String",
              semanticId: "https://example.test/dictionary/custom-product/v3/terms/energy-rating",
              domainClassKey: "customProductPassport",
              domainClassIri: "https://example.test/dictionary/custom-product/v3/classes/CustomProductPassport",
              rangeKind: "scalar",
              rangeIri: "http://www.w3.org/2001/XMLSchema#string",
              minCount: 0,
              maxCount: 1,
            },
          ],
        },
      ],
    },
  };

  try {
    const context = buildPassportJsonLdContext(typeDef);
    assert.equal(context.includes("/dictionary/custom-product/v3/context.jsonld"), false);
    assert.equal(
      context.find((entry) => entry && typeof entry === "object" && entry.energyRating)?.energyRating?.["@id"],
      "https://example.test/dictionary/custom-product/v3/terms/energy-rating"
    );

    const exported = buildPassportJsonLdExport([
      {
        dppId: "dpp-custom-product-1",
        passportType: "customProductPassportV3",
        energyRating: "A",
      },
    ], "customProductPassportV3", {
      semanticModelKey: "customProductDictionaryV3",
      productCategory: "Custom Product",
      typeDef,
    });

    assert.equal(exported.passportType, "customProductPassportV3");
    assert.equal(exported.semanticModel?.semanticModelKey, "customProductDictionaryV3");
    assert.equal(exported["@context"].includes("/dictionary/custom-product/v3/context.jsonld"), false);
    assert.equal(
      exported.semanticModel.contextUrl,
      "/dictionary/custom-product/v3/context.jsonld"
    );
    assert.equal(exported["@graph"][0].energyRating, "A");
  } finally {
    cleanup();
  }
});

test("semantic export uses immediate owner metadata for flat nested-section fields", () => {
  const { buildPassportJsonLdContext, buildPassportJsonLdExport } = createExportService();
  const typeDef = createNestedSectionTypeDefinition();
  const context = buildPassportJsonLdContext(typeDef);
  const inlineContext = context.find((entry) => (
    entry && typeof entry === "object" && entry.energyRating
  ));

  assert.equal(
    inlineContext.energyRating["@id"],
    "https://example.test/dictionary/custom-product/v3/terms/performance/energy-rating"
  );
  assert.equal(
    inlineContext.lifecycleStatus["@id"],
    "https://example.test/dictionary/custom-product/v3/terms/performance/lifecycle-status"
  );
  assert.equal(inlineContext.lifecycleStatus["@type"], "@id");
  assert.equal(
    inlineContext.performance["@context"].energyRating["@id"],
    inlineContext.energyRating["@id"]
  );

  const exported = buildPassportJsonLdExport([{
    dppId: "dpp-nested-1",
    passportType: "customProductPassportV3",
    energyRating: "A",
    excludedLegacyField: "must not leak",
    fields: {
      lifecycleStatus: "active",
      excludedLegacyField: "must not leak",
    },
  }], "customProductPassportV3", { typeDef });

  assert.equal(exported["@graph"][0].energyRating, "A");
  assert.equal(
    Object.prototype.hasOwnProperty.call(exported["@graph"][0], "excludedLegacyField"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(exported["@graph"][0].fields, "excludedLegacyField"),
    false
  );
  assert.deepEqual(exported["@graph"][0].fields.lifecycleStatus, {
    "@id": "https://example.test/dictionary/custom-product/v3/enums/LifecycleStatus/active",
  });
  assert.deepEqual(exported.semanticProfile, {
    typeName: "customProductPassportV3",
    semanticModelKey: "unregisteredNestedDictionaryV3",
    sourceModule: "custom-product:v3",
    schemaVersion: 4,
    profileDigest: "sha256:profile",
    moduleDigest: "sha256:module",
    graphDigest: "sha256:graph",
    contractVersion: 1,
    selectionMode: "explicit",
    includedFieldCount: 2,
    profilePath: "/api/passport-types/customProductPassportV3/semantic-profile",
  });
});

test("semantic export restores long logical field keys before applying the selected profile", () => {
  const { buildPassportJsonLdExport } = createExportService();
  const longKey = `measurement${"Value".repeat(20)}`;
  const storageKey = toPassportStorageColumnKey(longKey);
  const rootClassIri = "https://example.test/dictionary/custom-product/v3/classes/CustomProductPassport";
  const semanticId = "https://example.test/dictionary/custom-product/v3/terms/long-measurement";
  const typeDef = {
    typeName: "customProductPassportV3",
    fieldsJson: {
      semanticGraph: {
        schemaVersion: 1,
        rootClassKey: "customProductPassport",
        classes: [{
          key: "customProductPassport",
          label: "Custom Product Passport",
          semanticId: rootClassIri,
          root: true,
          properties: [{
            key: longKey,
            label: "Long measurement",
            semanticId,
            domainClassKey: "customProductPassport",
            domainClassIri: rootClassIri,
            rangeKind: "scalar",
            dataType: "string",
            minCount: 0,
            maxCount: 1,
          }],
        }],
        enums: [],
      },
      sections: [{
        key: "measurements",
        label: "Measurements",
        fields: [{
          key: longKey,
          label: "Long measurement",
          type: "text",
          dataType: "string",
          objectType: "SingleValuedDataElement",
          valueDataType: "String",
          semanticId,
          domainClassKey: "customProductPassport",
          domainClassIri: rootClassIri,
          rangeKind: "scalar",
          rangeIri: "http://www.w3.org/2001/XMLSchema#string",
          minCount: 0,
          maxCount: 1,
        }],
      }],
    },
  };

  const exported = buildPassportJsonLdExport([{
    dppId: "dpp-long-field-1",
    passportType: typeDef.typeName,
    [storageKey]: "stored value",
    excludedLegacyField: "must not leak",
  }], typeDef.typeName, { typeDef });

  assert.equal(exported["@graph"][0][longKey], "stored value");
  assert.equal(Object.prototype.hasOwnProperty.call(exported["@graph"][0], storageKey), false);
  assert.equal(Object.prototype.hasOwnProperty.call(exported["@graph"][0], "excludedLegacyField"), false);
});
