"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildArtifacts } = require("../server");

function tableField(fieldLabel, semanticSlug, labelSlug, valueSlug) {
  return {
    fieldLabel,
    fieldType: "table",
    dataType: "array",
    semanticSlug,
    tableColumns: [
      { columnLabel: "Material", semanticSlug: labelSlug, dataType: "string" },
      { columnLabel: "Share", semanticSlug: valueSlug, dataType: "decimal" },
    ],
  };
}

function generatorInput() {
  return {
    module: {
      family: "multi-chart-product",
      version: "v1",
      baseUrl: "https://example.test",
    },
    roles: {
      businessIdentifierField: "modelIdentifier",
      modelNameField: "modelIdentifier",
      compositionCharts: [
        {
          fieldKey: "materialComposition",
          labelColumnKey: "materialName",
          valueColumnKey: "materialShare",
        },
        {
          fieldKey: "recycledComposition",
          labelColumnKey: "recycledMaterial",
          valueColumnKey: "recycledShare",
        },
      ],
    },
    sections: [{
      label: "Product",
      fields: [
        { fieldLabel: "Model identifier", semanticSlug: "model-identifier" },
        tableField("Material composition", "material-composition", "material-name", "material-share"),
        tableField("Recycled composition", "recycled-composition", "recycled-material", "recycled-share"),
      ],
    }],
    semanticGraph: {
      rootClass: { label: "Multi chart product", key: "multiChartProduct" },
      rootProperties: [],
      classes: [],
      enums: [],
    },
  };
}

function executeCommonJs(source) {
  const module = { exports: {} };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

test("generator configures every requested composition chart on its own table field", () => {
  const { artifacts } = buildArtifacts(generatorInput());
  const moduleArtifact = artifacts.find((artifact) => artifact.path.endsWith("/module.js"));
  const generatedModule = executeCommonJs(moduleArtifact.content);
  const fields = generatedModule.sections[0].fields;
  const material = fields.find((field) => field.key === "materialComposition");
  const recycled = fields.find((field) => field.key === "recycledComposition");

  assert.equal(material.composition, true);
  assert.equal(material.compositionLabelColumnKey, "materialName");
  assert.equal(material.compositionValueColumnKey, "materialShare");
  assert.equal(recycled.composition, true);
  assert.equal(recycled.compositionLabelColumnKey, "recycledMaterial");
  assert.equal(recycled.compositionValueColumnKey, "recycledShare");
});

test("generator rejects duplicate composition mappings for the same table field", () => {
  const input = generatorInput();
  input.roles.compositionCharts.push({ ...input.roles.compositionCharts[0] });
  assert.throws(
    () => buildArtifacts(input),
    /Composition chart field "materialComposition" is configured more than once/
  );
});
