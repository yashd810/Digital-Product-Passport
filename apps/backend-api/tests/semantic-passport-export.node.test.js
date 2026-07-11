"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createSemanticModelRegistry = require("../src/services/semantic-model-registry");
const createSemanticPassportExportService = require("../src/services/semantic-passport-export");

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
    assert.ok(context.includes("/dictionary/custom-product/v3/context.jsonld"));

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
    assert.ok(exported["@context"].includes("/dictionary/custom-product/v3/context.jsonld"));
    assert.equal(exported["@graph"][0].energyRating, "A");
  } finally {
    cleanup();
  }
});
