"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createSemanticModelRegistry = require("../src/infrastructure/semantics/create-semantic-model-registry");
const createSemanticPassportExportService = require("../services/semantic-passport-export");

function createExportService() {
  return createSemanticPassportExportService({
    semanticModelRegistry: createSemanticModelRegistry(),
  });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function createRegistryWithApplianceDictionary() {
  const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-export-models-"));
  const modelDir = path.join(resourcesDir, "appliance", "v3");
  fs.mkdirSync(modelDir, { recursive: true });

  writeJson(path.join(modelDir, "manifest.json"), {
    semanticModelKey: "claros_appliance_dictionary_v3",
    name: "Claros Appliance Dictionary",
    version: "3.0.0",
  });
  writeJson(path.join(modelDir, "terms.json"), [
    {
      slug: "energy-rating",
      label: "Energy rating",
      definition: "Energy performance rating for the product.",
      iri: "https://example.test/dictionary/appliance/v3/terms/energy-rating",
      appFieldKeys: ["energyRating"],
    },
  ]);
  writeJson(path.join(modelDir, "field-map.json"), {
    energyRating: "https://example.test/dictionary/appliance/v3/terms/energy-rating",
  });
  writeJson(path.join(modelDir, "context.jsonld"), {
    "@context": {
      energyRating: "https://example.test/dictionary/appliance/v3/terms/energy-rating",
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
    type_name: "evBatteryPassportCustom",
    product_category: "Battery Digital Passport",
    semantic_model_key: "genericDppV1",
    fields_json: {
      sections: [
        {
          fields: [
            { key: "batteryMass", semanticId: null },
          ],
        },
      ],
    },
  };

  const context = buildPassportJsonLdContext(typeDef);
  assert.equal(context.length, 1);

  const exported = buildPassportJsonLdExport([
    { dppId: "dpp-1", passportType: "evBatteryPassportCustom", batteryMass: "450.5" },
  ], "evBatteryPassportCustom", {
    semanticModelKey: "genericDppV1",
    productCategory: "Battery Digital Passport",
  });

  assert.equal(exported.passportType, undefined);
  assert.equal(exported.semantic_model, undefined);
  assert.equal(exported.semanticModel, undefined);
  assert.equal(exported["@context"].length, 1);
});

test("semantic export supports arbitrary registered semantic models without category-specific code", () => {
  const { registry, cleanup } = createRegistryWithApplianceDictionary();
  const service = createSemanticPassportExportService({ semanticModelRegistry: registry });
  const { buildPassportJsonLdContext, buildPassportJsonLdExport } = service;
  const typeDef = {
    typeName: "appliancePassportV3",
    productCategory: "Appliance",
    semanticModelKey: "claros_appliance_dictionary_v3",
    fieldsJson: {
      sections: [
        {
          fields: [
            { key: "energyRating" },
          ],
        },
      ],
    },
  };

  try {
    const context = buildPassportJsonLdContext(typeDef);
    assert.ok(context.includes("/dictionary/appliance/v3/context.jsonld"));

    const exported = buildPassportJsonLdExport([
      {
        dppId: "dpp-appliance-1",
        passportType: "appliancePassportV3",
        energyRating: "A",
      },
    ], "appliancePassportV3", {
      semanticModelKey: "claros_appliance_dictionary_v3",
      productCategory: "Appliance",
      typeDef,
    });

    assert.equal(exported.passportType, "appliancePassportV3");
    assert.equal(exported.semantic_model?.semanticModelKey, "claros_appliance_dictionary_v3");
    assert.equal(exported.semanticModel?.semanticModelKey, "claros_appliance_dictionary_v3");
    assert.ok(exported["@context"].includes("/dictionary/appliance/v3/context.jsonld"));
    assert.equal(exported["@graph"][0].energyRating, "A");
  } finally {
    cleanup();
  }
});
