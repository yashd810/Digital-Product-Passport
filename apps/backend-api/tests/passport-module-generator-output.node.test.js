"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildArtifacts } = require("../../../local-tools/passport-module-generator/server");

function createGeneratorInput() {
  return {
    module: {
      family: "example-product",
      version: "v1",
      baseUrl: "https://example.test",
    },
    roles: {
      businessIdentifierField: "modelIdentifier",
    },
    sections: [
      {
        label: "Product Identity",
        fields: [
          {
            fieldLabel: "Model Identifier",
            definition: "Identifies the product model.",
            categoryLabel: "Product Identification",
          },
        ],
      },
    ],
  };
}

function executeCommonJs(source) {
  const module = { exports: {} };
  const run = new Function("module", "exports", source);
  run(module, module.exports);
  return module.exports;
}

test("passport module generator emits camelCase module identifiers by default", () => {
  const { artifacts, spec } = buildArtifacts(createGeneratorInput());
  const moduleArtifact = artifacts.find((artifact) => artifact.path.endsWith("example-product-v1.js"));

  assert.ok(moduleArtifact);
  assert.equal(spec.module.semanticModelKey, "exampleProductDictionaryV1");
  assert.equal(spec.module.contentSpecificationId, "exampleProductDictionaryV1");
  assert.doesNotMatch(moduleArtifact.content, /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
  assert.doesNotMatch(moduleArtifact.content, new RegExp(`${String.fromCharCode(95)}dictionary${String.fromCharCode(95)}`));
  assert.match(moduleArtifact.content, /const semanticBaseUrl = "https:\/\/example\.test\/dictionary\/example-product\/v1\/terms";/);

  const generatedModule = executeCommonJs(moduleArtifact.content);
  assert.equal(generatedModule.semanticModelKey, "exampleProductDictionaryV1");
  assert.deepEqual(generatedModule.passportPolicy.contentSpecificationIds, ["exampleProductDictionaryV1"]);
  assert.equal(
    generatedModule.sections[0].fields[0].semanticId,
    "https://example.test/dictionary/example-product/v1/terms/model-identifier"
  );
});
