"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const {
  buildArtifacts,
  buildArtifactsZip,
} = require("../../../local-tools/passport-module-generator/server");

const generatedPackagePath = "apps/backend-api/passport-modules/example-product-v1";
const generatedModulePath = `${generatedPackagePath}/module.js`;
const generatorDir = path.resolve(__dirname, "../../../local-tools/passport-module-generator");

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
          },
        ],
      },
    ],
    semanticGraph: {
      rootClass: {
        label: "Example Product Passport",
        key: "exampleProductPassport",
      },
      rootProperties: [],
      classes: [],
      enums: [],
    },
  };
}

function executeCommonJs(source) {
  const module = { exports: {} };
  const run = new Function("module", "exports", source);
  run(module, module.exports);
  return module.exports;
}

function readZipFiles(buffer) {
  const endOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(endOffset, -1, "ZIP end-of-central-directory record is missing");
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  const files = new Map();
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const contentOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(contentOffset, contentOffset + compressedSize);
    const content = method === 8 ? zlib.inflateRawSync(compressed) : compressed;
    files.set(name, content.toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

test("passport module generator emits camelCase module identifiers by default", () => {
  const { artifacts, spec } = buildArtifacts(createGeneratorInput());
  const moduleArtifact = artifacts.find((artifact) => artifact.path === generatedModulePath);

  assert.ok(moduleArtifact);
  assert.equal(spec.module.semanticModelKey, "exampleProductDictionaryV1");
  assert.equal(spec.module.contentSpecificationId, "exampleProductDictionaryV1");
  assert.doesNotMatch(moduleArtifact.content, /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
  assert.doesNotMatch(moduleArtifact.content, new RegExp(`${String.fromCharCode(95)}dictionary${String.fromCharCode(95)}`));
  assert.doesNotMatch(moduleArtifact.content, /\bupdateAuthority\b/);
  assert.doesNotMatch(moduleArtifact.content, /\baccessLevel\b/);
  assert.doesNotMatch(moduleArtifact.content, /\baccess:\s*\[/);
  assert.match(moduleArtifact.content, /const semanticBaseUrl = "https:\/\/example\.test\/dictionary\/example-product\/v1\/terms";/);

  const generatedModule = executeCommonJs(moduleArtifact.content);
  assert.equal(generatedModule.semanticModelKey, "exampleProductDictionaryV1");
  assert.deepEqual(generatedModule.passportPolicy.contentSpecificationIds, ["exampleProductDictionaryV1"]);
  assert.equal(
    generatedModule.sections[0].fields[0].semanticId,
    "https://example.test/dictionary/example-product/v1/terms/model-identifier"
  );
  assert.equal(generatedModule.sections[0].fields[0].key, "modelIdentifier");
});

test("passport module generator requires an explicit deployment base URL", () => {
  const input = createGeneratorInput();
  delete input.module.baseUrl;

  assert.throws(
    () => buildArtifacts(input),
    /Base URL is required/
  );
});

test("passport module generator derives field and table column keys from semantic slugs", () => {
  const input = createGeneratorInput();
  input.roles.businessIdentifierField = "assetSerialNumber";
  input.roles.compositionFieldKey = "materialComposition";
  input.roles.compositionLabelColumnKey = "materialName";
  input.roles.compositionValueColumnKey = "massPercent";
  input.sections[0].fields = [
    {
      fieldLabel: "Serial",
      semanticSlug: "asset-serial-number",
      definition: "Identifier used by the product owner.",
      confidentiality: "restricted",
    },
    {
      fieldLabel: "Materials",
      fieldType: "table",
      dataType: "array",
      semanticSlug: "material-composition",
      definition: "Component materials.",
      tableColumns: [
        {
          columnLabel: "Name",
          semanticSlug: "material-name",
          dataType: "string",
        },
        {
          columnLabel: "Mass",
          semanticSlug: "mass-percent",
          dataType: "decimal",
          unitLabel: "Percent",
          unitSymbol: "%",
        },
      ],
    },
  ];

  const { artifacts, spec } = buildArtifacts(input);
  const moduleArtifact = artifacts.find((artifact) => artifact.path === generatedModulePath);
  const generatedModule = executeCommonJs(moduleArtifact.content);
  const [serialField, tableField] = generatedModule.sections[0].fields;

  assert.equal(spec.sections[0].fields[0].fieldKey, "assetSerialNumber");
  assert.equal(spec.sections[0].fields[0].confidentiality, "restricted");
  assert.equal(serialField.key, "assetSerialNumber");
  assert.equal(serialField.confidentiality, "restricted");
  assert.equal(serialField.access, undefined);
  assert.equal(serialField.updateAuthority, undefined);
  assert.equal(serialField.semanticId, "https://example.test/dictionary/example-product/v1/terms/asset-serial-number");
  assert.equal(tableField.key, "materialComposition");
  assert.equal(tableField.type, "objectList");
  assert.equal(tableField.compositionLabelColumnKey, "materialName");
  assert.equal(tableField.compositionValueColumnKey, "massPercent");
  assert.deepEqual(
    generatedModule.semanticGraph.classes
      .find((classDef) => classDef.key === "materialCompositionEntry")
      .properties
      .map((property) => property.key),
    ["materialName", "massPercent"]
  );
});

test("passport module generator downloads every artifact with its repository path and exact content", async () => {
  const input = createGeneratorInput();
  const generated = buildArtifacts(input);
  const download = await buildArtifactsZip(input);
  const zipFiles = readZipFiles(download.buffer);
  const downloadedPaths = [...zipFiles.keys()].sort();
  const artifactPaths = generated.artifacts.map((artifact) => artifact.path).sort();

  assert.equal(download.fileName, "example-product-v1-passport-module.zip");
  assert.equal(generated.artifacts.length, 10);
  assert.ok(
    generated.artifacts.every((artifact) => artifact.path.startsWith(`${generatedPackagePath}/`))
  );
  assert.deepEqual(downloadedPaths, artifactPaths);
  for (const artifact of generated.artifacts) {
    assert.equal(zipFiles.get(artifact.path), artifact.content);
  }
});

test("passport module generator is export-only and has no repository write wiring", () => {
  const serverSource = fs.readFileSync(path.join(generatorDir, "server.js"), "utf8");
  const appSource = fs.readFileSync(path.join(generatorDir, "app.js"), "utf8");
  const pageSource = fs.readFileSync(path.join(generatorDir, "index.html"), "utf8");

  assert.doesNotMatch(serverSource, /\/api\/write|writeArtifacts|fs\.writeFile(?:Sync)?/);
  assert.doesNotMatch(appSource, /\/api\/write|writeFiles/);
  assert.doesNotMatch(pageSource, /id=["']writeFiles["']|id=["']overwrite["']/);
  assert.match(pageSource, /This tool never writes into the repository/);
});

test("passport module generator always keeps DID header slots system managed", () => {
  const input = createGeneratorInput();
  input.module.systemHeaderFieldAssignments = {
    subjectDid: "modelIdentifier",
    dppDid: "modelIdentifier",
    companyDid: "modelIdentifier",
  };
  const { artifacts, spec } = buildArtifacts(input);
  const moduleArtifact = artifacts.find((artifact) => artifact.path === generatedModulePath);
  const generatedModule = executeCommonJs(moduleArtifact.content);
  const didMappings = generatedModule.systemHeader.fieldMappings.filter((mapping) =>
    ["subjectDid", "dppDid", "companyDid"].includes(mapping.slotKey)
  );

  assert.deepEqual(spec.module.systemHeaderFieldAssignments, {
    subjectDid: "__managed__:internalManagedSubjectDid",
    dppDid: "__managed__:internalManagedDppDid",
    companyDid: "__managed__:internalManagedCompanyDid",
  });
  assert.deepEqual(
    didMappings.map((mapping) => [mapping.slotKey, mapping.sourceType, mapping.managedKey]),
    [
      ["subjectDid", "managed", "internalManagedSubjectDid"],
      ["dppDid", "managed", "internalManagedDppDid"],
      ["companyDid", "managed", "internalManagedCompanyDid"],
    ]
  );
  assert.deepEqual(generatedModule.systemHeader.fieldKeys, []);
});
