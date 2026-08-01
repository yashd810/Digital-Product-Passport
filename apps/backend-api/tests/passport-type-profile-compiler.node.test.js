"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compilePassportTypeProfile,
} = require("../src/modules/passports/services/passport-type-profile");
const {
  flattenSchemaFieldsFromSections,
} = require("../src/shared/passports/passport-helpers");
const { createPassportModuleFixture } = require("./passport-module-fixture");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getExampleModule() {
  return createPassportModuleFixture();
}

function findSection(sections, key) {
  for (const section of sections || []) {
    if (section.key === key) return section;
    const nested = findSection(section.sections, key);
    if (nested) return nested;
  }
  return null;
}

function findFieldReference(sections, key) {
  for (const section of sections || []) {
    const field = (section.fields || []).find((candidate) => candidate.key === key);
    if (field) return field;
    const nested = findFieldReference(section.sections, key);
    if (nested) return nested;
  }
  return null;
}

function selection(fieldKey, overrides = {}) {
  return { sourceModuleFieldKey: fieldKey, ...overrides };
}

test("compiler prunes unselected fields while retaining nested ancestors and locked dependencies", () => {
  const moduleDefinition = getExampleModule();
  const compiled = compilePassportTypeProfile({
    moduleDefinition,
    profile: {
      moduleDigest: moduleDefinition.moduleDigest,
      includedFields: [selection("economicOperatorAddressCountry", {
        required: true,
        confidentiality: "restricted",
      })],
    },
  });

  const fields = flattenSchemaFieldsFromSections(compiled.sections);
  const keys = new Set(fields.map((field) => field.key));
  assert.equal(keys.has("economicOperatorAddressCountry"), true);
  assert.equal(keys.has("productMass"), false);
  assert.ok(findSection(compiled.sections, "identity"));
  assert.ok(findSection(compiled.sections, "economicOperatorInformation"));
  assert.ok(findSection(compiled.sections, "economicOperatorAddress"));

  for (const dependency of ["modelName", "economicOperatorId"]) {
    assert.equal(keys.has(dependency), true, `${dependency} must stay included`);
  }

  const selected = fields.find((field) => field.key === "economicOperatorAddressCountry");
  assert.equal(selected.required, true);
  assert.equal(selected.minCount, 1);
  assert.equal(selected.confidentiality, "restricted");
  const ownerClass = compiled.semanticGraph.classes.find((entry) => entry.key === selected.domainClassKey);
  assert.equal(ownerClass.properties.find((property) => property.key === selected.key).minCount, 1);
  assert.equal(compiled.profile.selectionMode, "explicit");
  assert.equal(compiled.profile.includedFields.length, fields.length);
  assert.match(compiled.moduleDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(compiled.profileDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(compiled.semanticProfile.graphDigest, /^sha256:[a-f0-9]{64}$/);
});

test("multiple composition charts are independent and excluding a chart field is allowed", () => {
  const moduleDefinition = getExampleModule();
  const chart = (fieldKey) => selection(fieldKey, {
    composition: true,
    compositionLabelColumnKey: "materialName",
    compositionValueColumnKey: "materialComposition",
  });
  const withTwoCharts = compilePassportTypeProfile({
    moduleDefinition,
    profile: {
      includedFields: [chart("materialsUsedInCathode"), chart("materialsUsedInAnode")],
    },
  });
  const chartFields = flattenSchemaFieldsFromSections(withTwoCharts.sections)
    .filter((field) => field.composition === true);
  assert.deepEqual(
    chartFields.map((field) => field.key).sort(),
    ["materialsUsedInAnode", "materialsUsedInCathode"]
  );

  const cathodeExcluded = compilePassportTypeProfile({
    moduleDefinition,
    profile: { includedFields: [chart("materialsUsedInAnode")] },
  });
  const keys = flattenSchemaFieldsFromSections(cathodeExcluded.sections).map((field) => field.key);
  assert.equal(keys.includes("materialsUsedInCathode"), false);
  assert.equal(keys.includes("materialsUsedInAnode"), true);
});

test("compiler preserves a module-defined object-list composition chart through its semantic range class", () => {
  const moduleDefinition = clone(getExampleModule());
  const sourceField = findFieldReference(moduleDefinition.fieldsJson.sections, "materialsUsedInCathode");
  assert.ok(sourceField);
  sourceField.type = "objectList";
  delete sourceField.tableColumns;
  delete sourceField.tableColumnCount;

  const compiled = compilePassportTypeProfile({
    moduleDefinition,
    profile: {
      includedFields: [selection("materialsUsedInCathode")],
    },
  });
  const compiledField = findFieldReference(compiled.sections, "materialsUsedInCathode");

  assert.equal(compiledField.type, "objectList");
  assert.equal(compiledField.composition, true);
  assert.equal(compiledField.compositionLabelColumnKey, "materialName");
  assert.equal(compiledField.compositionValueColumnKey, "materialComposition");
});

test("compiler applies section translations without changing the material profile digest", () => {
  const moduleDefinition = getExampleModule();
  const baseProfile = {
    includedFields: [selection("economicOperatorAddressCountry")],
  };
  const base = compilePassportTypeProfile({ moduleDefinition, profile: baseProfile });
  const translated = compilePassportTypeProfile({
    moduleDefinition,
    profile: {
      ...baseProfile,
      sectionOverrides: [{
        sourceModuleSectionKey: "economicOperatorAddress",
        labelI18n: { sv: "Ekonomisk aktors adress" },
      }],
    },
  });

  assert.deepEqual(
    findSection(translated.sections, "economicOperatorAddress").labelI18n,
    { sv: "Ekonomisk aktors adress" }
  );
  assert.equal(translated.profileDigest, base.profileDigest);
});

test("compiler rejects stale modules, canonical metadata overrides, and invalid chart fields", () => {
  const moduleDefinition = getExampleModule();
  assert.throws(
    () => compilePassportTypeProfile({
      moduleDefinition,
      profile: { moduleDigest: "sha256:stale", includedFields: [] },
    }),
    (error) => error.code === "passportTypeProfileModuleChanged" && error.statusCode === 409
  );
  assert.throws(
    () => compilePassportTypeProfile({
      moduleDefinition,
      profile: {
        includedFields: [selection("modelName")],
        identity: { businessIdentifierField: "productMass", modelNameField: "productMass" },
      },
    }),
    (error) => error.code === "passportTypeProfileCanonicalMetadataMismatch"
  );
  assert.throws(
    () => compilePassportTypeProfile({
      moduleDefinition,
      profile: {
        includedFields: [selection("productMass", { composition: true })],
      },
    }),
    (error) => error.code === "passportTypeProfileCompositionFieldInvalid"
  );
});

test("module minCount invariants cannot be excluded or made optional", () => {
  const moduleDefinition = clone(getExampleModule());
  const invariantField = findFieldReference(moduleDefinition.fieldsJson.sections, "productMass");
  assert.ok(invariantField);
  invariantField.minCount = 1;
  invariantField.required = true;
  const owner = moduleDefinition.fieldsJson.semanticGraph.classes
    .find((classDef) => classDef.key === invariantField.domainClassKey);
  owner.properties.find((property) => property.key === invariantField.key).minCount = 1;

  assert.throws(
    () => compilePassportTypeProfile({
      moduleDefinition,
      profile: { includedFields: [selection("modelName")] },
    }),
    (error) => error.code === "passportTypeProfileRequiredModuleFieldExcluded"
  );
  assert.throws(
    () => compilePassportTypeProfile({
      moduleDefinition,
      profile: {
        includedFields: [
          selection("modelName"),
          selection("productMass", { required: false }),
        ],
      },
    }),
    (error) => error.code === "passportTypeProfileRequiredModuleFieldOptional"
  );
});
