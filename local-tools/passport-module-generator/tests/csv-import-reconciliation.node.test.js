"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  buildSemanticGraphSourceCatalog,
  parseSemanticGraphSourceRef,
  reconcileSemanticGraphSources,
} = require("../shared/csv-import-reconciliation");

function importedSections() {
  return [
    {
      key: "general",
      label: "General",
      fields: [
        { fieldKey: "name", fieldType: "text" },
        {
          fieldKey: "composition",
          fieldType: "table",
          tableColumns: [
            { columnKey: "material" },
            { columnKey: "percentage" },
          ],
        },
      ],
      sections: [
        {
          key: "safety",
          label: "Safety",
          fields: [
            { fieldKey: "hazard", fieldType: "text" },
          ],
        },
      ],
    },
  ];
}

function scalarProperty(key, sourceRef = "") {
  return {
    key,
    label: key,
    sourceRef,
    rangeKind: "scalar",
    dataType: "string",
    rangeClassKey: "",
    rangeEnumKey: "",
    enumOverrideKey: "",
  };
}

function baseGraph() {
  return {
    rootClass: { key: "passport", label: "Passport" },
    rootProperties: [],
    classes: [],
    enums: [
      {
        key: "hazardClass",
        label: "Hazard class",
        values: [{ key: "safe", label: "Safe" }],
      },
    ],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("the module exposes the same reconciliation API through UMD and CommonJS", () => {
  const source = fs.readFileSync(path.join(__dirname, "../shared/csv-import-reconciliation.js"), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);

  assert.equal(typeof context.PassportModuleCsvImportReconciliation.reconcileSemanticGraphSources, "function");
  assert.equal(typeof reconcileSemanticGraphSources, "function");
});

test("source catalog includes deep sections, fields, tables, and table columns", () => {
  const catalog = buildSemanticGraphSourceCatalog(importedSections());

  assert.deepEqual([...catalog.sectionRefs], ["section:general", "section:safety"]);
  assert.deepEqual([...catalog.fieldRefs], [
    "field:general:name",
    "field:general:composition",
    "field:safety:hazard",
  ]);
  assert.deepEqual([...catalog.tableRefs], ["table:general:composition"]);
  assert.deepEqual([...catalog.columnRefs], [
    "column:general:composition:material",
    "column:general:composition:percentage",
  ]);
  assert.deepEqual([...catalog.parentSectionKeys], [
    ["general", ""],
    ["safety", "general"],
  ]);
});

test("source reference parsing accepts only the four exact canonical formats", () => {
  assert.deepEqual(parseSemanticGraphSourceRef("section:general"), {
    kind: "section",
    sectionKey: "general",
    sourceRef: "section:general",
  });
  assert.deepEqual(parseSemanticGraphSourceRef("field:safety:hazard"), {
    kind: "field",
    sectionKey: "safety",
    fieldKey: "hazard",
    sourceRef: "field:safety:hazard",
  });
  assert.deepEqual(parseSemanticGraphSourceRef("table:general:composition"), {
    kind: "table",
    sectionKey: "general",
    fieldKey: "composition",
    sourceRef: "table:general:composition",
  });
  assert.deepEqual(parseSemanticGraphSourceRef("column:general:composition:material"), {
    kind: "column",
    sectionKey: "general",
    fieldKey: "composition",
    columnKey: "material",
    sourceRef: "column:general:composition:material",
  });
  assert.deepEqual(parseSemanticGraphSourceRef("field:general"), {
    kind: "invalid",
    sourceRef: "field:general",
  });
  assert.equal(parseSemanticGraphSourceRef("  "), null);
});

test("stale linked entries are removed while custom entries and stable order are preserved", () => {
  const graph = baseGraph();
  graph.rootProperties = [
    scalarProperty("customFirst"),
    scalarProperty("generalLink", "section:general"),
    scalarProperty("staleRoot", "field:general:removed"),
    scalarProperty("nestedLink", "field:safety:hazard"),
    scalarProperty("customLast"),
  ];
  graph.classes = [
    {
      key: "customClass",
      label: "Custom class",
      sourceRef: "",
      properties: [
        scalarProperty("customProperty"),
        scalarProperty("validNested", "field:safety:hazard"),
        scalarProperty("staleNested", "field:safety:removed"),
      ],
    },
    {
      key: "compositionClass",
      label: "Composition class",
      sourceRef: "table:general:composition",
      properties: [
        scalarProperty("material", "column:general:composition:material"),
        scalarProperty("staleColumn", "column:general:composition:removed"),
        scalarProperty("percentage", "column:general:composition:percentage"),
      ],
    },
    {
      key: "staleClass",
      label: "Stale class",
      sourceRef: "section:removed",
      properties: [
        scalarProperty("customChild"),
        scalarProperty("linkedChild", "field:general:name"),
      ],
    },
    {
      key: "wrongTableClass",
      label: "Wrong table class",
      sourceRef: "table:general:name",
      properties: [],
    },
  ];
  const before = clone(graph);

  const result = reconcileSemanticGraphSources(graph, importedSections());

  assert.deepEqual(graph, before, "the source graph must not be mutated");
  assert.notStrictEqual(result.graph, graph);
  assert.equal(result.removedClassCount, 2);
  assert.equal(result.removedPropertyCount, 7);
  assert.deepEqual(result.graph.rootProperties.map((entry) => entry.key), [
    "customFirst",
    "generalLink",
    "customLast",
  ]);
  assert.deepEqual(result.graph.classes.map((entry) => entry.key), [
    "customClass",
    "compositionClass",
  ]);
  assert.deepEqual(result.graph.classes[0].properties.map((entry) => entry.key), [
    "customProperty",
  ]);
  assert.deepEqual(result.graph.classes[1].properties.map((entry) => entry.key), [
    "material",
    "percentage",
  ]);
  assert.deepEqual(result.graph.enums, before.enums);
});

test("all valid context-aware nested section, field, table, and column references survive", () => {
  const graph = baseGraph();
  graph.rootProperties = [
    scalarProperty("general", "section:general"),
  ];
  graph.classes = [
    {
      key: "general",
      label: "General",
      sourceRef: "section:general",
      properties: [
        scalarProperty("name", "field:general:name"),
        scalarProperty("composition", "field:general:composition"),
        scalarProperty("safety", "section:safety"),
      ],
    },
    {
      key: "safety",
      label: "Safety",
      sourceRef: "section:safety",
      properties: [scalarProperty("hazard", "field:safety:hazard")],
    },
    {
      key: "tableClass",
      label: "Table class",
      sourceRef: "table:general:composition",
      properties: [scalarProperty("percentage", "column:general:composition:percentage")],
    },
    {
      key: "customClass",
      label: "Custom class",
      sourceRef: "",
      properties: [scalarProperty("customProperty")],
    },
  ];

  const result = reconcileSemanticGraphSources(graph, importedSections());

  assert.equal(result.removedClassCount, 0);
  assert.equal(result.removedPropertyCount, 0);
  assert.deepEqual(result.graph, graph);
});

test("table and column references require table fields and matching table columns", () => {
  const graph = baseGraph();
  graph.rootProperties = [
    scalarProperty("ordinaryField", "field:general:name"),
  ];
  graph.classes = [
    {
      key: "notATable",
      label: "Not a table",
      sourceRef: "table:general:name",
      properties: [],
    },
    {
      key: "tableClass",
      label: "Table class",
      sourceRef: "table:general:composition",
      properties: [
        scalarProperty("validColumn", "column:general:composition:material"),
        scalarProperty("notAColumn", "column:general:name:value"),
        scalarProperty("missingColumn", "column:general:composition:missing"),
      ],
    },
  ];

  const result = reconcileSemanticGraphSources(graph, importedSections());

  assert.equal(result.removedClassCount, 1);
  assert.equal(result.removedPropertyCount, 3);
  assert.deepEqual(result.graph.rootProperties, []);
  assert.deepEqual(result.graph.classes.map((entry) => entry.key), ["tableClass"]);
  assert.deepEqual(result.graph.classes[0].properties.map((entry) => entry.key), ["validColumn"]);
});

test("references that exist but are invalid for their graph context are removed as stale", () => {
  const graph = baseGraph();
  graph.rootProperties = [
    scalarProperty("validRootSection", "section:general"),
    scalarProperty("invalidRootTable", "table:general:composition"),
    scalarProperty("invalidRootColumn", "column:general:composition:material"),
  ];
  graph.classes = [
    {
      key: "invalidFieldClass",
      label: "Invalid field class",
      sourceRef: "field:general:name",
      properties: [scalarProperty("child")],
    },
    {
      key: "invalidColumnClass",
      label: "Invalid column class",
      sourceRef: "column:general:composition:material",
      properties: [],
    },
    {
      key: "sectionClass",
      label: "Section class",
      sourceRef: "section:general",
      properties: [
        scalarProperty("validField", "field:general:name"),
        scalarProperty("wrongSection", "field:safety:hazard"),
        scalarProperty("sectionInsteadOfField", "section:general"),
      ],
    },
    {
      key: "tableClass",
      label: "Table class",
      sourceRef: "table:general:composition",
      properties: [
        scalarProperty("validColumn", "column:general:composition:percentage"),
        scalarProperty("fieldInsteadOfColumn", "field:general:composition"),
        scalarProperty("otherFieldColumn", "column:general:name:value"),
      ],
    },
    {
      key: "customClass",
      label: "Custom class",
      sourceRef: "",
      properties: [
        scalarProperty("validSection", "section:safety"),
        scalarProperty("validField", "field:safety:hazard"),
        scalarProperty("invalidTable", "table:general:composition"),
        scalarProperty("invalidColumn", "column:general:composition:material"),
      ],
    },
  ];

  const result = reconcileSemanticGraphSources(graph, importedSections());

  assert.equal(result.removedClassCount, 2);
  assert.equal(result.removedPropertyCount, 11);
  assert.deepEqual(result.graph.rootProperties.map((entry) => entry.key), ["validRootSection"]);
  assert.deepEqual(result.graph.classes.map((entry) => entry.key), [
    "sectionClass",
    "tableClass",
    "customClass",
  ]);
  assert.deepEqual(result.graph.classes[0].properties.map((entry) => entry.key), ["validField"]);
  assert.deepEqual(result.graph.classes[1].properties.map((entry) => entry.key), ["validColumn"]);
  assert.deepEqual(result.graph.classes[2].properties, []);
});

test("malformed and unknown source reference kinds are treated as stale", () => {
  const graph = baseGraph();
  graph.rootProperties = [
    scalarProperty("custom"),
    scalarProperty("shortField", "field:general"),
    scalarProperty("longSection", "section:general:extra"),
    scalarProperty("unknown", "record:general"),
  ];

  const result = reconcileSemanticGraphSources(graph, importedSections());

  assert.equal(result.removedPropertyCount, 3);
  assert.deepEqual(result.graph.rootProperties.map((entry) => entry.key), ["custom"]);
});

test("an empty imported catalog removes every linked entry but preserves custom graph content", () => {
  const graph = baseGraph();
  graph.rootProperties = [
    scalarProperty("customRoot"),
    scalarProperty("linkedRoot", "section:general"),
  ];
  graph.classes = [
    {
      key: "customClass",
      label: "Custom class",
      sourceRef: "",
      properties: [
        scalarProperty("customProperty"),
        scalarProperty("linkedProperty", "field:general:name"),
      ],
    },
    {
      key: "linkedClass",
      label: "Linked class",
      sourceRef: "section:general",
      properties: [scalarProperty("child")],
    },
  ];

  const result = reconcileSemanticGraphSources(graph, []);

  assert.equal(result.removedClassCount, 1);
  assert.equal(result.removedPropertyCount, 3);
  assert.deepEqual(result.graph.rootProperties.map((entry) => entry.key), ["customRoot"]);
  assert.deepEqual(result.graph.classes.map((entry) => entry.key), ["customClass"]);
  assert.deepEqual(result.graph.classes[0].properties.map((entry) => entry.key), ["customProperty"]);
  assert.equal(result.graph.enums.length, 1);
});

test("retained dangling class, enum, and enum-override references block reconciliation", async (t) => {
  const cases = [
    {
      name: "class removed as stale",
      configure(graph) {
        graph.rootProperties.push({
          ...scalarProperty("customRelationship"),
          rangeKind: "class",
          rangeClassKey: "removedClass",
        });
        graph.classes.push({
          key: "removedClass",
          label: "Removed class",
          sourceRef: "section:missing",
          properties: [],
        });
      },
      error: /customRelationship.*rangeClassKey "removedClass" does not identify a retained class/,
    },
    {
      name: "missing enum range",
      configure(graph) {
        graph.rootProperties.push({
          ...scalarProperty("customEnum"),
          rangeKind: "enum",
          rangeEnumKey: "missingEnum",
        });
      },
      error: /customEnum.*rangeEnumKey "missingEnum" does not identify a retained enum/,
    },
    {
      name: "missing enum override",
      configure(graph) {
        graph.rootProperties.push({
          ...scalarProperty("customOverride"),
          enumOverrideKey: "missingEnum",
        });
      },
      error: /customOverride.*enumOverrideKey "missingEnum" does not identify a retained enum/,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const graph = baseGraph();
      scenario.configure(graph);
      const before = clone(graph);
      assert.throws(() => reconcileSemanticGraphSources(graph, importedSections()), scenario.error);
      assert.deepEqual(graph, before, "a failed reconciliation must not mutate its input");
    });
  }
});

test("duplicate imported section keys are rejected because source refs would be ambiguous", () => {
  const sections = importedSections();
  sections.push({ key: "safety", fields: [] });

  assert.throws(
    () => reconcileSemanticGraphSources(baseGraph(), sections),
    /duplicate section key "safety"/
  );
});
