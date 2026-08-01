"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildPassportTypeSemanticProfile,
  projectSemanticGraphToSections,
} = require("../src/modules/passports/services/passport-type-semantic-profile");

const base = "https://example.test/dictionary/product/v1";
const classIri = (key) => `${base}/classes/${key}`;
const termIri = (key) => `${base}/terms/${key}`;

function property(key, domainClassKey, overrides = {}) {
  return {
    key,
    label: key,
    semanticId: termIri(key),
    domainClassKey,
    domainClassIri: classIri(domainClassKey),
    rangeKind: "scalar",
    rangeIri: "http://www.w3.org/2001/XMLSchema#string",
    dataType: "string",
    minCount: 0,
    maxCount: 1,
    ...overrides,
  };
}

function composition(key, domainClassKey, rangeClassKey) {
  return property(key, domainClassKey, {
    rangeKind: "class",
    rangeClassKey,
    rangeIri: classIri(rangeClassKey),
    dataType: null,
    relationshipType: "composition",
  });
}

function createTypeDefinition() {
  const selected = property("selectedStatus", "details", {
    rangeKind: "enum",
    rangeEnumKey: "status",
    rangeIri: `${base}/enums/Status`,
  });
  const selectedRows = composition("selectedRows", "details", "selectedRow");
  return {
    typeName: "subsetPassportV1",
    semanticModelKey: "productDictionaryV1",
    fieldsJson: {
      schemaVersion: 2,
      sourceModule: "product:v1",
      profileDigest: "sha256:profile",
      moduleDigest: "sha256:module",
      profile: {
        contractVersion: 1,
        selectionMode: "explicit",
        sourceModule: "product:v1",
        profileDigest: "sha256:profile",
        moduleDigest: "sha256:module",
        includedFields: [
          { sourceModuleFieldKey: "selectedStatus" },
          { sourceModuleFieldKey: "selectedRows" },
        ],
      },
      semanticProfile: { schemaVersion: 1, graphDigest: "sha256:graph" },
      sections: [{
        key: "general",
        label: "General",
        fields: [],
        sections: [{
          key: "details",
          label: "Details",
          fields: [selected, selectedRows],
        }],
      }],
      semanticGraph: {
        schemaVersion: 1,
        rootClassKey: "root",
        classes: [
          {
            key: "root",
            label: "Root",
            semanticId: classIri("root"),
            root: true,
            properties: [
              composition("general", "root", "general"),
              composition("unrelated", "root", "unrelated"),
            ],
          },
          {
            key: "general",
            label: "General",
            semanticId: classIri("general"),
            properties: [composition("details", "general", "details")],
          },
          {
            key: "details",
            label: "Details",
            semanticId: classIri("details"),
            properties: [
              selected,
              selectedRows,
              property("excludedSibling", "details"),
            ],
          },
          {
            key: "selectedRow",
            label: "Selected row",
            semanticId: classIri("selectedRow"),
            properties: [property("rowValue", "selectedRow")],
          },
          {
            key: "unrelated",
            label: "Unrelated",
            semanticId: classIri("unrelated"),
            properties: [property("unrelatedValue", "unrelated")],
          },
        ],
        enums: [{
          key: "status",
          label: "Status",
          semanticId: `${base}/enums/Status`,
          values: [{ key: "active", label: "Active", semanticId: `${base}/enums/Status/active` }],
        }],
      },
    },
  };
}

test("semantic projection keeps selected-field ancestors and structured ranges but removes sibling branches", () => {
  const typeDef = createTypeDefinition();
  const graph = projectSemanticGraphToSections(
    typeDef.fieldsJson.semanticGraph,
    typeDef.fieldsJson.sections
  );

  assert.deepEqual(graph.classes.map((entry) => entry.key), [
    "root",
    "general",
    "details",
    "selectedRow",
  ]);
  assert.deepEqual(graph.classes.find((entry) => entry.key === "root").properties.map((entry) => entry.key), ["general"]);
  assert.deepEqual(graph.classes.find((entry) => entry.key === "general").properties.map((entry) => entry.key), ["details"]);
  assert.deepEqual(graph.classes.find((entry) => entry.key === "details").properties.map((entry) => entry.key), [
    "selectedStatus",
    "selectedRows",
  ]);
  assert.deepEqual(graph.classes.find((entry) => entry.key === "selectedRow").properties.map((entry) => entry.key), ["rowValue"]);
  assert.deepEqual(graph.enums.map((entry) => entry.key), ["status"]);
});

test("semantic profile bundle and SHACL are generated from the selected projection only", () => {
  const profile = buildPassportTypeSemanticProfile(createTypeDefinition());
  const serialized = JSON.stringify(profile);

  assert.equal(serialized.includes("excludedSibling"), false);
  assert.equal(serialized.includes("unrelatedValue"), false);
  assert.equal(serialized.includes(termIri("selectedStatus")), true);
  assert.equal(serialized.includes(termIri("rowValue")), true);
  assert.equal(profile.profileDigest, "sha256:profile");
  assert.equal(profile.graphDigest, "sha256:graph");
  assert.equal(profile.shapes["@graph"].length, 4);
});
