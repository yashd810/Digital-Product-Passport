"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildArtifacts } = require("../server");

function executeCommonJs(source) {
  const module = { exports: {} };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

function generatorInput() {
  return {
    module: {
      family: "battery",
      version: "v1",
      displayName: "Battery Passport v1",
      typeName: "batteryPassportV1",
      baseUrl: "https://claros-dpp.online",
    },
    roles: {
      businessIdentifierField: "modelIdentifier",
      modelNameField: "modelIdentifier",
    },
    sections: [
      {
        key: "generalInformation",
        label: "General Information",
        fields: [{ fieldKey: "modelIdentifier", fieldLabel: "Model Identifier" }],
        sections: [{
          key: "incidentHistory",
          label: "Incident History",
          fields: [],
          sections: [{
            key: "electricalAbuseEvents",
            label: "Electrical Abuse Events",
            fields: [{
              fieldKey: "numberOfOverchargeEvents",
              fieldLabel: "Number of Overcharge Events",
              dataType: "integer",
            }],
          }],
        }],
      },
      {
        key: "materialsAndComposition",
        label: "Materials and Composition",
        fields: [{
          fieldKey: "materialsUsed",
          fieldLabel: "Materials Used",
          fieldType: "table",
          dataType: "array",
          tableColumns: [
            { columnKey: "materialName", columnLabel: "Material Name", dataType: "string" },
            { columnKey: "massShare", columnLabel: "Mass Share", dataType: "decimal" },
          ],
        }],
        sections: [{
          key: "batteryChemistry",
          label: "Battery Chemistry",
          fields: [{
            fieldKey: "batteryChemistry",
            fieldLabel: "Battery Chemistry",
            dataType: "string",
          }],
        }],
      },
    ],
    semanticGraph: {
      rootClass: { label: "Battery Passport v1 Root", key: "batteryPassportV1" },
      // This deliberately resembles an old flattened draft. Export must repair
      // placement instead of preserving the invalid root ownership.
      rootProperties: [
        {
          sourceRef: "section:electricalAbuseEvents",
          key: "electricalAbuseEvents",
          label: "General Information > Incident History > Electrical Abuse Events",
          rangeKind: "class",
          rangeClassKey: "electricalAbuseEvents",
        },
        {
          sourceRef: "field:electricalAbuseEvents:numberOfOverchargeEvents",
          key: "numberOfOverchargeEvents",
          label: "Number of Overcharge Events",
          rangeKind: "scalar",
          dataType: "integer",
        },
      ],
      classes: [],
      enums: [],
    },
  };
}

test("generator emits one nested semantic owner for every section and field", () => {
  const { spec, artifacts } = buildArtifacts(generatorInput());
  const classes = new Map(spec.semanticGraph.classes.map((classDef) => [classDef.key, classDef]));
  const root = classes.get("batteryPassportV1");
  const general = classes.get("generalInformation");
  const history = classes.get("incidentHistory");
  const electrical = classes.get("electricalAbuseEvents");
  const materials = classes.get("materialsAndComposition");
  const chemistry = classes.get("batteryChemistry");

  assert.deepEqual(root.properties.map((property) => property.key), [
    "generalInformation",
    "materialsAndComposition",
  ]);
  assert.equal(general.properties.find((property) => property.key === "incidentHistory")?.rangeClassKey, "incidentHistory");
  assert.equal(history.properties.find((property) => property.key === "electricalAbuseEvents")?.rangeClassKey, "electricalAbuseEvents");
  assert.equal(
    electrical.properties.find((property) => property.key === "numberOfOverchargeEvents")?.domainClassKey,
    "electricalAbuseEvents"
  );
  assert.equal(root.properties.some((property) => property.key === "numberOfOverchargeEvents"), false);

  const chemistryRelation = materials.properties.find((property) => property.key === "batteryChemistry");
  const chemistryValue = chemistry.properties.find((property) => property.key === "batteryChemistry");
  assert.equal(chemistryRelation.rangeKind, "class");
  assert.equal(chemistryValue.rangeKind, "scalar");
  assert.notEqual(chemistryRelation.semanticId, chemistryValue.semanticId);

  const termsArtifact = artifacts.find((artifact) => artifact.path.endsWith("/terms.json"));
  const terms = JSON.parse(termsArtifact.content);
  assert.equal(terms.length, 11);
  assert.equal(terms.some((term) => term.label.includes(" > ")), false);
  assert.equal(
    terms.filter((term) => term.internalKey === "numberOfOverchargeEvents").length,
    1
  );
  const electricalTerm = terms.find((term) => term.internalKey === "electricalAbuseEvents");
  assert.equal(electricalTerm.label, "Electrical Abuse Events");
  assert.equal(electricalTerm.domain.label, "Incident History");
  assert.equal(electricalTerm.range.label, "Electrical Abuse Events");

  const moduleArtifact = artifacts.find((artifact) => artifact.path.endsWith("/module.js"));
  const generatedModule = executeCommonJs(moduleArtifact.content);
  assert.equal(generatedModule.sections.some((section) => section.key === "semanticRelationships"), false);
  const materialsField = generatedModule.sections[1].fields.find((field) => field.key === "materialsUsed");
  assert.equal(materialsField.type, "table");
  assert.equal(materialsField.tableColumnCount, 2);
  assert.match(materialsField.tableColumns[0].semanticId, /materials-used-entry\/material-name$/);
});
