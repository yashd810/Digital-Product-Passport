"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { getModuleTopologyIssues } = require("../src/modules/admin/passport-module-topology");

function createCanonicalSections() {
  return [{
    key: "identity",
    label: "Identity",
    fields: [{
      key: "modelIdentifier",
      label: "Model Identifier",
      sourceModuleFieldKey: "modelIdentifier",
    }],
  }, {
    key: "composition",
    label: "Composition",
    fields: [],
    sections: [{
      key: "materials",
      label: "Materials",
      fields: [{
        key: "materialBreakdown",
        label: "Material Breakdown",
        type: "table",
        sourceModuleFieldKey: "materialBreakdown",
        tableColumns: [{
          key: "materialName",
          label: "Material Name",
          sourceModuleColumnKey: "materialName",
        }, {
          key: "massShare",
          label: "Mass Share",
          sourceModuleColumnKey: "massShare",
        }],
      }],
    }],
  }];
}

test("module topology accepts the exact nested canonical tree and presentation metadata", () => {
  const canonicalSections = createCanonicalSections();
  const submittedSections = JSON.parse(JSON.stringify(canonicalSections));
  submittedSections[0].fields[0].required = true;
  submittedSections[0].fields[0].confidentiality = "restricted";
  submittedSections[0].fields[0].presentation = "summary";
  submittedSections[1].sections[0].labelI18n = { sv: "Material" };

  assert.deepEqual(
    getModuleTopologyIssues({ canonicalSections, submittedSections }),
    []
  );
});

test("module topology rejects reordered and renamed table columns", () => {
  const canonicalSections = createCanonicalSections();
  const submittedSections = JSON.parse(JSON.stringify(canonicalSections));
  const columns = submittedSections[1].sections[0].fields[0].tableColumns;
  submittedSections[1].sections[0].fields[0].tableColumns = [columns[1], columns[0]];
  submittedSections[1].sections[0].fields[0].tableColumns[0].label = "Mass fraction";

  const issues = getModuleTopologyIssues({ canonicalSections, submittedSections });

  assert.equal(issues.some((issue) => issue.code === "moduleTableColumnOrderOrPathMismatch"), true);
  assert.equal(issues.some((issue) => issue.code === "moduleTableColumnLabelMismatch"), true);
});
