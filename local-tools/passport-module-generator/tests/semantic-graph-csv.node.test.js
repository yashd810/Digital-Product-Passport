"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCsv,
  parseCsv,
} = require("../shared/csv-core");
const {
  buildSemanticGraphCsvContent,
  legacySemanticGraphCsvHeaders,
  parseSemanticGraphCsv,
  semanticGraphCsvV2Headers,
  semanticGraphCsvVersion,
} = require("../shared/semantic-graph-csv");

const columnIndex = Object.freeze(Object.fromEntries(
  semanticGraphCsvV2Headers.map((header, index) => [header, index])
));

function fullGraph() {
  return {
    rootClass: {
      label: "=Battery Passport, Nordic",
      key: "batteryPassport",
      semanticId: "https://claros-dpp.online/dictionary/battery/v2/classes/BatteryPassport",
      definition: "Root definition with a comma, a \"quote\", and Ångström.",
    },
    rootProperties: [
      {
        label: "+Risk score",
        key: "riskScore",
        semanticId: "https://claros-dpp.online/dictionary/battery/v2/terms/risk-score",
        definition: "First line\r\nSecond line with an embedded comma.",
        semanticSlug: "risk-score",
        rangeKind: "scalar",
        dataType: "decimal",
        rangeClassKey: "",
        rangeEnumKey: "",
        relationshipType: "",
        minCount: 0,
        maxCount: 1,
        unit: "%",
        uiType: "text",
        sourceRef: "field:overview:riskScore",
        enumOverrideKey: "",
      },
      {
        label: "Materials",
        key: "materials",
        semanticId: "https://claros-dpp.online/dictionary/battery/v2/terms/materials",
        definition: "Reference to material entries.",
        semanticSlug: "materials",
        rangeKind: "class",
        dataType: "",
        rangeClassKey: "materialEntry",
        rangeEnumKey: "",
        relationshipType: "reference",
        minCount: 1,
        maxCount: null,
        unit: "",
        uiType: "objectList",
        sourceRef: "section:materials",
        enumOverrideKey: "",
      },
      {
        label: "Hazard class",
        key: "hazardClass",
        semanticId: "https://claros-dpp.online/dictionary/battery/v2/terms/hazard-class",
        definition: "Controlled hazard classification.",
        semanticSlug: "hazard-class",
        rangeKind: "enum",
        dataType: "",
        rangeClassKey: "",
        rangeEnumKey: "hazardClass",
        relationshipType: "",
        minCount: 0,
        maxCount: 1,
        unit: "",
        uiType: "select",
        sourceRef: "field:safety:hazardClass",
        enumOverrideKey: "hazardClass",
      },
    ],
    classes: [
      {
        label: "Material entry",
        key: "materialEntry",
        semanticId: "https://claros-dpp.online/dictionary/battery/v2/classes/MaterialEntry",
        definition: "A material entry with exact source wiring.",
        sourceRef: "table:materials:materialComposition",
        properties: [
          {
            label: "Mass",
            key: "mass",
            semanticId: "https://claros-dpp.online/dictionary/battery/v2/terms/material-entry/mass",
            definition: "'@literal apostrophe and formula-like content",
            semanticSlug: "mass",
            rangeKind: "scalar",
            dataType: "decimal",
            rangeClassKey: "",
            rangeEnumKey: "",
            relationshipType: "",
            minCount: 1,
            maxCount: 1,
            unit: "kg",
            uiType: "text",
            sourceRef: "column:materials:materialComposition:mass",
            enumOverrideKey: "",
          },
        ],
      },
    ],
    enums: [
      {
        label: "Hazard class",
        key: "hazardClass",
        semanticId: "https://claros-dpp.online/dictionary/battery/v2/enums/HazardClass",
        definition: "Hazard values; pipes remain literal in v2.",
        values: [
          {
            label: "Acute | toxic",
            key: "acuteToxic",
            semanticId: "https://claros-dpp.online/dictionary/battery/v2/enums/HazardClass/acute-toxic",
            definition: "Value with |, comma, and \"quote\".",
          },
          {
            label: "'@Literal apostrophe",
            key: "literalApostrophe",
            semanticId: "https://claros-dpp.online/dictionary/battery/v2/enums/HazardClass/literal-apostrophe",
            definition: "Unicode: Göteborg 🔋",
          },
        ],
      },
    ],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function encodedV2Rows(graph = fullGraph()) {
  return parseCsv(buildSemanticGraphCsvContent(graph)).rows;
}

function rebuildV2(rows, options = {}) {
  return buildCsv(rows, {
    bom: true,
    lineEnding: "\r\n",
    formulaSafe: false,
    ...options,
  });
}

function findRecordRow(rows, recordType, key) {
  return rows.find((row, index) => index > 0
    && row[columnIndex["Record type"]] === recordType
    && row[columnIndex.Key] === key);
}

test("v2 round-trips every graph record and editable metadata without loss", () => {
  const graph = fullGraph();
  const csv = buildSemanticGraphCsvContent(graph);

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /\r\n/);
  assert.match(csv, /'\+Risk score/);
  assert.match(csv, /''@literal apostrophe/);
  assert.deepEqual(parseSemanticGraphCsv(csv), graph);
});

test("v2 explicit order survives arbitrary CSV record ordering", () => {
  const graph = fullGraph();
  const rows = encodedV2Rows(graph);
  const reordered = [rows[0], ...rows.slice(1).reverse()];

  assert.deepEqual(parseSemanticGraphCsv(rebuildV2(reordered)), graph);
});

test("v2 supports comma, semicolon, and tab dialects with BOM and all common line endings", () => {
  const graph = fullGraph();
  const cases = [
    { delimiter: ",", lineEnding: "\r\n", bom: true },
    { delimiter: ";", lineEnding: "\n", bom: false },
    { delimiter: "\t", lineEnding: "\r", bom: true },
  ];

  for (const options of cases) {
    const csv = buildSemanticGraphCsvContent(graph, options);
    assert.deepEqual(parseSemanticGraphCsv(csv), graph, JSON.stringify(options));
  }

  const semicolon = buildSemanticGraphCsvContent(graph, {
    delimiter: ";",
    lineEnding: "\r\n",
    bom: false,
  });
  assert.deepEqual(parseSemanticGraphCsv(`\ufeffsep=;\r\n${semicolon}`), graph);
});

test("v2 rejects malformed owners and range references", async (t) => {
  const cases = [
    {
      name: "unknown property owner",
      mutate(rows) {
        findRecordRow(rows, "property", "mass")[columnIndex["Owner key"]] = "missingClass";
      },
      error: /does not identify a class/,
    },
    {
      name: "unknown enum-value owner",
      mutate(rows) {
        findRecordRow(rows, "enumValue", "acuteToxic")[columnIndex["Owner key"]] = "missingEnum";
      },
      error: /does not identify an enum/,
    },
    {
      name: "unknown class range",
      mutate(rows) {
        findRecordRow(rows, "property", "materials")[columnIndex["Range class key"]] = "missingClass";
      },
      error: /unknown range class/,
    },
    {
      name: "unknown enum range",
      mutate(rows) {
        findRecordRow(rows, "property", "hazardClass")[columnIndex["Range enum key"]] = "missingEnum";
      },
      error: /unknown range enum/,
    },
    {
      name: "unknown enum override",
      mutate(rows) {
        findRecordRow(rows, "property", "hazardClass")[columnIndex["Enum override key"]] = "missingEnum";
      },
      error: /unknown enum override/,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const rows = encodedV2Rows();
      scenario.mutate(rows);
      assert.throws(() => parseSemanticGraphCsv(rebuildV2(rows)), scenario.error);
    });
  }
});

test("v2 rejects duplicate keys, IRIs, and sibling order values", async (t) => {
  const cases = [
    {
      name: "class key",
      mutate(rows) {
        findRecordRow(rows, "class", "materialEntry")[columnIndex.Key] = "batteryPassport";
      },
      error: /Duplicate class key/,
    },
    {
      name: "property key on one owner",
      mutate(rows) {
        findRecordRow(rows, "property", "materials")[columnIndex.Key] = "riskScore";
      },
      error: /Duplicate property key/,
    },
    {
      name: "enum value key",
      mutate(rows) {
        findRecordRow(rows, "enumValue", "literalApostrophe")[columnIndex.Key] = "acuteToxic";
      },
      error: /Duplicate enum value key/,
    },
    {
      name: "property semantic IRI",
      mutate(rows) {
        findRecordRow(rows, "property", "materials")[columnIndex["Semantic IRI"]]
          = findRecordRow(rows, "property", "riskScore")[columnIndex["Semantic IRI"]];
      },
      error: /Duplicate property semantic IRI/,
    },
    {
      name: "property order",
      mutate(rows) {
        findRecordRow(rows, "property", "materials")[columnIndex.Order]
          = findRecordRow(rows, "property", "riskScore")[columnIndex.Order];
      },
      error: /Duplicate property on batterypassport order/i,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const rows = encodedV2Rows();
      scenario.mutate(rows);
      assert.throws(() => parseSemanticGraphCsv(rebuildV2(rows)), scenario.error);
    });
  }
});

test("v2 validates cardinality before applying a graph", async (t) => {
  const cases = [
    {
      name: "negative minimum",
      minimum: "-1",
      maximum: "1",
      error: /Minimum count must be a non-negative integer/,
    },
    {
      name: "fractional minimum",
      minimum: "0.5",
      maximum: "1",
      error: /Minimum count must be a non-negative integer/,
    },
    {
      name: "maximum below minimum",
      minimum: "2",
      maximum: "1",
      error: /Maximum count must be greater than or equal/,
    },
    {
      name: "invalid maximum",
      minimum: "0",
      maximum: "many",
      error: /Maximum count must be a non-negative integer/,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const rows = encodedV2Rows();
      const property = findRecordRow(rows, "property", "riskScore");
      property[columnIndex["Minimum count"]] = scenario.minimum;
      property[columnIndex["Maximum count"]] = scenario.maximum;
      assert.throws(() => parseSemanticGraphCsv(rebuildV2(rows)), scenario.error);
    });
  }
});

test("v2 rejects malformed width, headers, record types, versions, and missing roots", async (t) => {
  const cases = [
    {
      name: "short row",
      mutate(rows) {
        rows[1].pop();
      },
      error: /expected 20 columns but found 19/,
    },
    {
      name: "wrong header",
      mutate(rows) {
        rows[0][columnIndex.Label] = "Display label";
      },
      error: /headers do not match/,
    },
    {
      name: "unknown record type",
      mutate(rows) {
        rows[1][columnIndex["Record type"]] = "relationship";
      },
      error: /unsupported Record type/,
    },
    {
      name: "wrong version",
      mutate(rows) {
        rows[1][columnIndex["Graph CSV version"]] = String(Number(semanticGraphCsvVersion) + 1);
      },
      error: /Graph CSV version must be 2/,
    },
    {
      name: "missing root",
      mutate(rows) {
        const index = rows.findIndex((row) => row[columnIndex["Record type"]] === "rootClass");
        rows.splice(index, 1);
      },
      error: /exactly one rootClass/,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const rows = encodedV2Rows();
      scenario.mutate(rows);
      assert.throws(() => parseSemanticGraphCsv(rebuildV2(rows)), scenario.error);
    });
  }
});

test("header-only v2 and legacy files are rejected", () => {
  const v2 = buildCsv([[...semanticGraphCsvV2Headers]]);
  const legacy = buildCsv([[...legacySemanticGraphCsvHeaders]]);

  assert.throws(() => parseSemanticGraphCsv(v2), /must contain at least one graph record/);
  assert.throws(() => parseSemanticGraphCsv(legacy), /does not contain any graph records/);
});

test("the current 12-column legacy graph CSV imports through configurable key and IRI builders", () => {
  const rows = [
    [...legacySemanticGraphCsvHeaders],
    ["@root", "=Root definition from CSV", "Materials", "Material relationship", "class", "", "Material", "composition", "1", "n", "", ""],
    ["@root", "=Root definition from CSV", "Hazard", "Hazard vocabulary", "enum", "", "Hazard Class", "", "0", "1", "", "Acute Toxicity | Skin Corrosion"],
    ["Material", "Material definition", "Mass", "Measured mass", "scalar", "decimal", "", "", "1", "1", "kg", ""],
  ];
  const legacyCsv = buildCsv(rows, { delimiter: ";", bom: true, lineEnding: "\r\n" });
  const options = {
    legacyRootClass: {
      label: "Battery Passport Root",
      key: "batteryPassport",
      semanticId: "https://claros-dpp.online/classes/BatteryPassport",
      definition: "",
    },
    keyFromLabel(value) {
      const words = String(value).match(/[A-Za-z0-9]+/g) || [];
      return words.map((word, index) => {
        const lower = word.toLowerCase();
        return index ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}` : lower;
      }).join("");
    },
    classIri(key) {
      return `https://claros-dpp.online/classes/${key}`;
    },
    propertyIri(key, ownerKey) {
      return `https://claros-dpp.online/terms/${ownerKey}/${key}`;
    },
    enumIri(key) {
      return `https://claros-dpp.online/enums/${key}`;
    },
    enumValueIri(key, enumDef) {
      return `${enumDef.semanticId}/${key}`;
    },
  };

  assert.deepEqual(parseSemanticGraphCsv(legacyCsv, options), {
    rootClass: {
      label: "Battery Passport Root",
      key: "batteryPassport",
      semanticId: "https://claros-dpp.online/classes/BatteryPassport",
      definition: "=Root definition from CSV",
    },
    rootProperties: [
      {
        label: "Materials",
        key: "materials",
        semanticId: "https://claros-dpp.online/terms/batteryPassport/materials",
        definition: "Material relationship",
        semanticSlug: "materials",
        rangeKind: "class",
        dataType: "",
        rangeClassKey: "material",
        rangeEnumKey: "",
        relationshipType: "composition",
        minCount: 1,
        maxCount: null,
        unit: "",
        uiType: "",
        sourceRef: "",
        enumOverrideKey: "",
      },
      {
        label: "Hazard",
        key: "hazard",
        semanticId: "https://claros-dpp.online/terms/batteryPassport/hazard",
        definition: "Hazard vocabulary",
        semanticSlug: "hazard",
        rangeKind: "enum",
        dataType: "",
        rangeClassKey: "",
        rangeEnumKey: "hazardClass",
        relationshipType: "",
        minCount: 0,
        maxCount: 1,
        unit: "",
        uiType: "",
        sourceRef: "",
        enumOverrideKey: "",
      },
    ],
    classes: [
      {
        label: "Material",
        key: "material",
        semanticId: "https://claros-dpp.online/classes/material",
        definition: "Material definition",
        sourceRef: "",
        properties: [
          {
            label: "Mass",
            key: "mass",
            semanticId: "https://claros-dpp.online/terms/material/mass",
            definition: "Measured mass",
            semanticSlug: "mass",
            rangeKind: "scalar",
            dataType: "decimal",
            rangeClassKey: "",
            rangeEnumKey: "",
            relationshipType: "",
            minCount: 1,
            maxCount: 1,
            unit: "kg",
            uiType: "",
            sourceRef: "",
            enumOverrideKey: "",
          },
        ],
      },
    ],
    enums: [
      {
        label: "Hazard Class",
        key: "hazardClass",
        semanticId: "https://claros-dpp.online/enums/hazardClass",
        definition: "Hazard Class controlled vocabulary.",
        values: [
          {
            label: "Acute Toxicity",
            key: "acuteToxicity",
            semanticId: "https://claros-dpp.online/enums/hazardClass/acuteToxicity",
            definition: "",
          },
          {
            label: "Skin Corrosion",
            key: "skinCorrosion",
            semanticId: "https://claros-dpp.online/enums/hazardClass/skinCorrosion",
            definition: "",
          },
        ],
      },
    ],
  });
});

test("legacy import rejects unresolved ranges, duplicate derived keys, and invalid cardinality", async (t) => {
  const header = [...legacySemanticGraphCsvHeaders];
  const root = {
    legacyRootClass: {
      label: "Root",
      key: "root",
      semanticId: "https://claros-dpp.online/classes/root",
    },
  };

  await t.test("unresolved class", () => {
    const csv = buildCsv([
      header,
      ["@root", "", "Missing", "", "class", "", "Missing Class", "composition", "0", "1", "", ""],
    ]);
    assert.throws(() => parseSemanticGraphCsv(csv, root), /unknown range class/);
  });

  await t.test("duplicate property key", () => {
    const csv = buildCsv([
      header,
      ["@root", "", "Same label", "", "scalar", "string", "", "", "0", "1", "", ""],
      ["@root", "", "Same label", "", "scalar", "string", "", "", "0", "1", "", ""],
    ]);
    assert.throws(() => parseSemanticGraphCsv(csv, root), /Duplicate property key/);
  });

  await t.test("invalid cardinality", () => {
    const csv = buildCsv([
      header,
      ["@root", "", "Count", "", "scalar", "integer", "", "", "2", "1", "", ""],
    ]);
    assert.throws(() => parseSemanticGraphCsv(csv, root), /Maximum count must be greater than or equal/);
  });
});
