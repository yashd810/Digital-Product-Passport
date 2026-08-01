"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const {
  buildArtifacts,
  buildArtifactsZip,
  validateCsvImport,
  validateSpec,
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
      modelNameField: "modelIdentifier",
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
    "https://example.test/dictionary/example-product/v1/terms/product-identity/model-name"
  );
  assert.equal(generatedModule.sections[0].fields[0].key, "modelName");
  assert.equal(generatedModule.sections[0].fields[0].required, true);
  assert.equal(generatedModule.identity.modelNameField, "modelName");
});

test("passport module generator requires the selected model name to be a text field", () => {
  const input = createGeneratorInput();
  input.sections[0].fields[0].fieldType = "textarea";

  assert.throws(
    () => validateSpec(input),
    /Model name field must use the text UI type and string data type/
  );
});

test("passport module generator assigns selected header fields their canonical storage key", () => {
  const input = createGeneratorInput();
  input.sections[0].fields.push({
    fieldLabel: "Economic identifier",
    fieldKey: "economicIdentifier",
    semanticSlug: "economic-identifier",
  });
  input.module.systemHeaderFieldAssignments = {
    economicOperatorId: "economicIdentifier",
  };

  const { artifacts, spec } = buildArtifacts(input);
  const generatedModule = executeCommonJs(
    artifacts.find((artifact) => artifact.path === generatedModulePath).content
  );

  assert.deepEqual(
    spec.sections[0].fields.map((field) => field.fieldKey),
    ["modelName", "economicOperatorId"]
  );
  assert.deepEqual(generatedModule.systemHeader.fieldMappings.find((mapping) => (
    mapping.slotKey === "economicOperatorId"
  )), {
    slotKey: "economicOperatorId",
    label: "Economic Operator ID",
    sourceType: "field",
    fieldKey: "economicOperatorId",
  });
  assert.equal(generatedModule.sections[0].fields.some((field) => field.key === "economicIdentifier"), false);
});

test("passport module generator requires an explicit deployment base URL", () => {
  const input = createGeneratorInput();
  delete input.module.baseUrl;

  assert.throws(
    () => buildArtifacts(input),
    /Base URL is required/
  );
});

test("passport module generator derives the module key from its output folder identity", () => {
  const matchingInput = createGeneratorInput();
  matchingInput.module.family = "Example Product";
  matchingInput.module.version = "1";
  matchingInput.module.moduleKey = "different-product:v2";

  const generated = buildArtifacts(matchingInput);
  assert.equal(generated.spec.module.moduleKey, "example-product:v1");
  assert.ok(
    generated.artifacts.every((artifact) => artifact.path.startsWith(`${generatedPackagePath}/`))
  );
  const moduleArtifact = generated.artifacts.find((artifact) => artifact.path === generatedModulePath);
  assert.equal(executeCommonJs(moduleArtifact.content).moduleKey, "example-product:v1");
  const pageSource = fs.readFileSync(path.join(generatorDir, "index.html"), "utf8");
  assert.match(pageSource, /<input id="moduleKey"[^>]*\breadonly\b/);
  const appSource = fs.readFileSync(path.join(generatorDir, "app.js"), "utf8");
  assert.match(appSource, /moduleKeyInput\.value = normalizedFamily/);
  assert.match(appSource, /delete moduleKeyInput\.dataset\.manual/);
});

test("passport module generator accepts logical field keys longer than PostgreSQL identifiers", () => {
  const input = createGeneratorInput();
  const longFieldKey = `a${"b".repeat(63)}`;
  input.sections[0].fields.push({
    fieldLabel: "Long custom field",
    fieldKey: longFieldKey,
    semanticSlug: longFieldKey,
  });
  input.roles.businessIdentifierField = longFieldKey;

  assert.equal(buildArtifacts(input).spec.sections[0].fields[1].fieldKey, longFieldKey);
});

test("passport module generator rejects field keys longer than 200 characters", () => {
  const input = createGeneratorInput();
  const longFieldKey = `a${"b".repeat(200)}`;
  input.sections[0].fields.push({
    fieldLabel: "Long custom field",
    fieldKey: longFieldKey,
    semanticSlug: longFieldKey,
  });
  input.roles.businessIdentifierField = longFieldKey;

  assert.throws(() => buildArtifacts(input), /at most 200 characters/);
});

test("passport module generator rejects reserved runtime and header field keys", () => {
  const input = createGeneratorInput();
  input.roles.businessIdentifierField = "dppStatus";
  input.sections[0].fields.push({
    fieldLabel: "DPP Status",
    semanticSlug: "dpp-status",
    definition: "Attempts to duplicate a managed passport header field.",
  });

  assert.throws(
    () => buildArtifacts(input),
    /Field key "dppStatus" is reserved for passport runtime\/header data.*generated automatically/
  );
});

test("passport module generator rejects reserved runtime and header semantic IDs", () => {
  const input = createGeneratorInput();
  input.roles.businessIdentifierField = "dppStatus";
  input.sections[0].fields.push({
    fieldLabel: "DPP Status",
    semanticSlug: "dpp-status",
    definition: "Attempts to duplicate a managed passport header field.",
  });
  input.semanticGraph.rootProperties = [{
    propertyKey: "dppStatus",
    propertyLabel: "DPP Status",
    semanticId: "dpp:dppStatus",
    rangeKind: "scalar",
    dataType: "string",
  }];

  assert.throws(
    () => buildArtifacts(input),
    /Field "dppStatus" uses reserved semanticId "dpp:dppStatus".*generated automatically/
  );
});

test("passport module generator CSV preflight accepts nested fields and a semantic graph without mutating them", () => {
  const input = createGeneratorInput();
  input.sections[0].key = "productIdentity";
  input.sections[0].fields[0].fieldKey = "modelIdentifier";
  input.sections[0].sections = [{
    key: "technicalDetails",
    label: "Technical Details",
    fields: [{
      fieldKey: "ratedCapacity",
      fieldLabel: "Rated Capacity",
    }],
  }];
  input.semanticGraph.classes = [{
    key: "technicalDetails",
    label: "Technical Details",
    properties: [{
      key: "ratedCapacity",
      semanticId: "https://example.test/terms/rated-capacity",
    }],
  }];
  input.semanticGraph.enums = [{
    key: "statusCode",
    label: "Status Code",
    values: [{ key: "active", label: "Active" }],
  }];

  const validationInput = {
    sections: input.sections,
    semanticGraph: input.semanticGraph,
  };
  const snapshot = structuredClone(validationInput);
  assert.deepEqual(validateCsvImport(validationInput), {
    valid: true,
    sectionCount: 2,
    fieldCount: 2,
    semanticClassCount: 2,
    semanticPropertyCount: 1,
    semanticEnumCount: 1,
    semanticEnumValueCount: 1,
  });
  assert.deepEqual(validationInput, snapshot);
});

test("passport module generator CSV preflight rejects reserved field keys and graph semantics", () => {
  assert.throws(
    () => validateCsvImport({
      sections: [{
        key: "identity",
        label: "Identity",
        fields: [{ fieldKey: "dppStatus", fieldLabel: "DPP Status" }],
      }],
    }),
    /Field key "dppStatus" is reserved for passport runtime\/header data/
  );

  assert.throws(
    () => validateCsvImport({
      semanticGraph: {
        rootClass: { key: "examplePassport", label: "Example Passport" },
        rootProperties: [{
          key: "customStatus",
          label: "Custom Status",
          semanticId: "dpp:dppStatus",
        }],
        classes: [],
        enums: [],
      },
    }),
    /uses reserved semanticId "dpp:dppStatus"/
  );

  assert.throws(
    () => validateCsvImport({
      semanticGraph: {
        rootClass: { key: "examplePassport", label: "Example Passport" },
        rootProperties: [{
          key: "dppSchemaVersion",
          label: "Duplicate DPP Schema Version",
          semanticId: "https://example.test/terms/duplicate-schema-version",
        }],
        classes: [],
        enums: [],
      },
    }),
    /Field key "dppSchemaVersion" is reserved for passport runtime\/header data/
  );
});

test("passport module generator CSV preflight rejects incomplete and ambiguous structures", () => {
  assert.throws(
    () => validateCsvImport({}),
    /requires sections or semanticGraph/
  );
  assert.throws(
    () => validateCsvImport({ sections: [] }),
    /at least one section/
  );
  assert.throws(
    () => validateCsvImport({
      sections: [
        { key: "details", label: "Details", fields: [{ fieldKey: "model", fieldLabel: "Model" }] },
        { key: "details", label: "Other Details", fields: [{ fieldKey: "serial", fieldLabel: "Serial" }] },
      ],
    }),
    /Duplicate section key: details/
  );
  assert.throws(
    () => validateCsvImport({
      semanticGraph: {
        rootClass: { key: "examplePassport", label: "Example Passport" },
        rootProperties: [null],
        classes: [],
        enums: [],
      },
    }),
    /rootProperties must contain objects/
  );
});

test("passport module generator exposes the CSV preflight POST endpoint", () => {
  const serverSource = fs.readFileSync(path.join(generatorDir, "server.js"), "utf8");
  assert.match(serverSource, /req\.method === "POST" && pathname === "\/api\/validate-csv-import"/);
  assert.match(serverSource, /sendJson\(res, 200, validateCsvImport\(input\)\)/);
});

test("passport module generator rejects the retired groups schema alias", () => {
  const nestedAlias = createGeneratorInput();
  nestedAlias.sections[0].groups = [];
  assert.throws(
    () => buildArtifacts(nestedAlias),
    /retired "groups" property is not supported/
  );

  const rootAlias = createGeneratorInput();
  rootAlias.groups = [];
  assert.throws(
    () => buildArtifacts(rootAlias),
    /retired "groups" property is not supported/
  );
});

test("passport module generator rejects empty leaf sections at every nesting level", () => {
  const nestedInput = createGeneratorInput();
  nestedInput.sections[0].sections = [{
    key: "technicalDetails",
    label: "Technical Details",
    fields: [],
  }];
  assert.throws(
    () => buildArtifacts(nestedInput),
    /Section "Product Identity > Technical Details" has no fields.*without subsections must contain at least one field/
  );

  const rootInput = createGeneratorInput();
  rootInput.sections[0].fields = [];
  assert.throws(
    () => buildArtifacts(rootInput),
    /Section "Product Identity" has no fields.*without subsections must contain at least one field/
  );

  const parentOnlyInput = createGeneratorInput();
  const [modelField] = parentOnlyInput.sections[0].fields;
  parentOnlyInput.sections[0].fields = [];
  parentOnlyInput.sections[0].sections = [{
    key: "technicalDetails",
    label: "Technical Details",
    fields: [modelField],
  }];
  assert.doesNotThrow(() => buildArtifacts(parentOnlyInput));
});

test("passport module generator rejects overly deep schemas before normalizing them", () => {
  const input = createGeneratorInput();
  let current = input.sections[0];
  current.fields = [];
  for (let depth = 2; depth <= 33; depth += 1) {
    const child = {
      key: `section${depth}`,
      label: `Section ${depth}`,
      fields: [],
    };
    current.sections = [child];
    current = child;
  }
  current.fields = [{
    fieldLabel: "Model Identifier",
    definition: "Identifies the product model.",
  }];

  assert.throws(
    () => validateSpec(input),
    /at most 32 nested section levels/
  );
});

test("passport module generator derives field and table column keys from semantic slugs", () => {
  const input = createGeneratorInput();
  input.roles.businessIdentifierField = "assetSerialNumber";
  input.roles.modelNameField = "modelIdentifier";
  input.roles.compositionFieldKey = "materialComposition";
  input.roles.compositionLabelColumnKey = "materialName";
  input.roles.compositionValueColumnKey = "massPercent";
  input.sections[0].fields = [
    {
      fieldLabel: "Model Identifier",
      definition: "Identifies the product model.",
    },
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
  const [, serialField, tableField] = generatedModule.sections[0].fields;

  assert.equal(spec.sections[0].fields[1].fieldKey, "assetSerialNumber");
  assert.equal(spec.sections[0].fields[1].confidentiality, "restricted");
  assert.equal(serialField.key, "assetSerialNumber");
  assert.equal(serialField.confidentiality, "restricted");
  assert.equal(serialField.access, undefined);
  assert.equal(serialField.updateAuthority, undefined);
  assert.equal(serialField.semanticId, "https://example.test/dictionary/example-product/v1/terms/product-identity/asset-serial-number");
  assert.equal(tableField.key, "materialComposition");
  assert.equal(tableField.type, "table");
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

test("passport module generator exposes only DPP and company DIDs as managed headers", () => {
  const input = createGeneratorInput();
  input.module.systemHeaderFieldAssignments = {
    digitalProductPassportId: "modelIdentifier",
    subjectDid: "modelIdentifier",
    dppDid: "modelIdentifier",
    companyDid: "modelIdentifier",
  };
  const { artifacts, spec } = buildArtifacts(input);
  const moduleArtifact = artifacts.find((artifact) => artifact.path === generatedModulePath);
  const generatedModule = executeCommonJs(moduleArtifact.content);
  const didMappings = generatedModule.systemHeader.fieldMappings.filter((mapping) =>
    ["dppDid", "companyDid"].includes(mapping.slotKey)
  );

  assert.equal(spec.module.systemHeaderFieldAssignments.digitalProductPassportId, undefined);
  assert.equal(spec.module.systemHeaderFieldAssignments.subjectDid, undefined);
  assert.equal(spec.module.systemHeaderFieldAssignments.dppDid, "__managed__:internalManagedDppDid");
  assert.equal(spec.module.systemHeaderFieldAssignments.companyDid, "__managed__:internalManagedCompanyDid");
  assert.deepEqual(
    didMappings.map((mapping) => [mapping.slotKey, mapping.sourceType, mapping.managedKey]),
    [
      ["dppDid", "managed", "internalManagedDppDid"],
      ["companyDid", "managed", "internalManagedCompanyDid"],
    ]
  );
  assert.deepEqual(generatedModule.systemHeader.fieldKeys, []);
});
