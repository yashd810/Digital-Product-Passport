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

function createRegistryWithCustomDictionary() {
  const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-export-models-"));
  const modelDir = path.join(resourcesDir, "custom-product", "v3");
  fs.mkdirSync(modelDir, { recursive: true });

  writeJson(path.join(modelDir, "manifest.json"), {
    semanticModelKey: "customProductDictionaryV3",
    name: "Custom Product Dictionary",
    version: "3.0.0",
  });
  writeJson(path.join(modelDir, "terms.json"), [
    {
      slug: "energy-rating",
      label: "Energy rating",
      definition: "Energy performance rating for the product.",
      iri: "https://example.test/dictionary/custom-product/v3/terms/energy-rating",
    },
  ]);
  writeJson(path.join(modelDir, "context.jsonld"), {
    "@context": {
      energyRating: "https://example.test/dictionary/custom-product/v3/terms/energy-rating",
    },
  });

  return {
    registry: createSemanticModelRegistry({ resourcesDir }),
    cleanup: () => fs.rmSync(resourcesDir, { recursive: true, force: true }),
  };
}

test("semantic export does not infer a dictionary from product category names", () => {
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
            { key: "sampleMass", semanticId: null },
          ],
        },
      ],
    },
  };

  const context = buildPassportJsonLdContext(typeDef);
  assert.equal(context.length, 1);

  const exported = buildPassportJsonLdExport([
    { dppId: "dpp-1", passportType: "customPassport", sampleMass: "450.5" },
  ], "customPassport", {
    semanticModelKey: "unregisteredTestModelV1",
    productCategory: "Generic Test Passport",
  });

  assert.equal(exported.passportType, undefined);
  assert.equal(exported.semanticModel, undefined);
  assert.equal(exported["@context"].length, 1);
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
      sections: [
        {
          fields: [
            {
              key: "energyRating",
              semanticId: "https://example.test/dictionary/custom-product/v3/terms/energy-rating",
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
