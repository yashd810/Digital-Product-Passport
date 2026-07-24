"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const csvCore = require("./csv-core");
const { deriveSections } = require("./derived-field-metadata");
const {
  buildFieldsCsvContent,
  fieldsCsvColumnLabels,
  fieldsCsvHeaders,
  fieldsCsvV2Columns,
  getFieldsCsvRowsFromSpec,
  legacyFieldsCsvColumns,
  readFieldsCsvRows,
} = require("./fields-csv");

function scalarField(overrides = {}) {
  return {
    fieldLabel: "Identifier",
    fieldKey: "identifier",
    semanticSlug: "identifier",
    fieldType: "text",
    definition: "Identifies this item.",
    dataType: "string",
    unitKey: "none",
    unitLabel: "",
    unitSymbol: "",
    confidentiality: "public",
    objectType: "SingleValuedDataElement",
    valueDataType: "String",
    queryable: false,
    indexed: false,
    tableColumns: [],
    ...overrides,
  };
}

function tableColumn(overrides = {}) {
  return {
    columnLabel: "Material name",
    columnKey: "materialName",
    semanticSlug: "material-name",
    dataType: "string",
    unitKey: "none",
    unitLabel: "",
    unitSymbol: "",
    objectType: "SingleValuedDataElement",
    valueDataType: "String",
    ...overrides,
  };
}

function tableField(overrides = {}) {
  return {
    fieldLabel: "Material composition",
    fieldKey: "materialComposition",
    semanticSlug: "material-composition",
    fieldType: "table",
    definition: "Structured material composition.",
    dataType: "array",
    unitKey: "none",
    unitLabel: "",
    unitSymbol: "",
    confidentiality: "restricted",
    objectType: "DataElementCollection",
    valueDataType: "Array",
    queryable: false,
    indexed: true,
    tableColumns: [
      tableColumn(),
      tableColumn({
        columnLabel: "Recycled share",
        columnKey: "recycledShare",
        semanticSlug: "recycled-share",
        dataType: "decimal",
        unitKey: "percent",
        unitLabel: "Percent",
        unitSymbol: "%",
        valueDataType: "Decimal",
      }),
    ],
    ...overrides,
  };
}

function singleFieldSpec(field = scalarField(), section = {}) {
  return {
    sections: [{
      key: "identity",
      label: "Identity",
      fields: [field],
      ...section,
    }],
  };
}

function v2RowsFor(spec) {
  return getFieldsCsvRowsFromSpec(spec);
}

function readV2Rows(rows, options = {}) {
  return readFieldsCsvRows(buildFieldsCsvContent(rows, options));
}

function legacyRow(overrides = {}) {
  return {
    sectionLabel: "Identity",
    sectionPath: "",
    sectionKeyPath: "",
    fieldLabel: "Serial number",
    fieldType: "text",
    definition: "Identifies the product instance.",
    dataType: "string",
    unitLabel: "",
    unitSymbol: "",
    confidentiality: "public",
    queryable: "false",
    indexed: "false",
    tableColumns: "",
    ...overrides,
  };
}

function buildLegacyCsv(rows, {
  columns = legacyFieldsCsvColumns,
  delimiter = ",",
  bom = false,
  lineEnding = "\n",
} = {}) {
  return csvCore.buildCsv([
    columns.map((column) => fieldsCsvColumnLabels[column]),
    ...rows.map((row) => columns.map((column) => row[column] ?? "")),
  ], { delimiter, bom, lineEnding });
}

function expectRowsRejected(rows, expected) {
  assert.throws(() => readV2Rows(rows), expected);
}

test("fields CSV v2 round-trips actual inputs and regenerates nested identifiers and table metadata", () => {
  const spec = {
    sections: [
      {
        key: "overview",
        label: "Overview",
        fields: [
          scalarField({
            fieldLabel: "Identifier",
            fieldKey: "passportModelCode",
            semanticSlug: "passport-model-code",
            definition: "Stable model code.",
            queryable: true,
            indexed: true,
          }),
          scalarField({
            fieldLabel: "Localized description",
            fieldKey: "localizedDescription",
            semanticSlug: "localized-description",
            fieldType: "textarea",
            definition: "Description in the issuer's selected language.",
            objectType: "MultiLanguageDataElement",
          }),
        ],
        sections: [
          {
            key: "materials",
            label: "Materials",
            fields: [
              scalarField({
                fieldLabel: "Material declaration",
                fieldKey: "materialDeclaration",
                semanticSlug: "material-declaration",
                confidentiality: "restricted",
              }),
            ],
            sections: [
              {
                key: "recycledContent",
                label: "Recycled content",
                fields: [tableField()],
              },
            ],
          },
        ],
      },
      {
        key: "serviceLife",
        label: "Service life",
        fields: [
          scalarField({
            fieldLabel: "Service date",
            fieldKey: "serviceDate",
            semanticSlug: "service-date",
            fieldType: "date",
            definition: "Date the product entered service.",
            dataType: "date",
            valueDataType: "Date",
          }),
        ],
      },
    ],
  };
  const exportedRows = v2RowsFor(spec);

  assert.deepEqual(
    exportedRows.map((row) => [row.fieldKey, row.sectionOrderPath, row.fieldOrder]),
    [
      ["identifier", "[1]", "1"],
      ["localizedDescription", "[1]", "2"],
      ["materialDeclaration", "[1,1]", "1"],
      ["materialComposition", "[1,1,1]", "1"],
      ["serviceDate", "[2]", "1"],
    ]
  );

  // Spreadsheet row order is not authoritative in v2; the explicit order columns are.
  const imported = readV2Rows([...exportedRows].reverse());
  assert.equal(imported.formatVersion, "2");
  assert.equal(imported.legacy, false);
  assert.equal(imported.explicitOrder, true);
  assert.equal(imported.sectionCount, 4);
  assert.equal(imported.fieldCount, 5);
  assert.equal(imported.tableColumnCount, 2);
  assert.equal(imported.maxDepth, 3);
  assert.deepEqual(imported.sections, deriveSections(spec.sections));
});

test("repeated display labels receive distinct context-aware semantic slugs and keys", () => {
  const spec = {
    sections: [{
      key: "identifiers",
      label: "Identifiers",
      fields: [
        scalarField({
          fieldLabel: "Identifier",
          fieldKey: "manufacturerIdentifier",
          semanticSlug: "manufacturer-identifier",
        }),
        scalarField({
          fieldLabel: "Identifier",
          fieldKey: "facilityIdentifier",
          semanticSlug: "facility-identifier",
        }),
      ],
    }],
  };

  const imported = readV2Rows(v2RowsFor(spec));
  assert.deepEqual(
    imported.sections[0].fields.map(({ fieldLabel, fieldKey, semanticSlug }) => ({
      fieldLabel,
      fieldKey,
      semanticSlug,
    })),
    [
      { fieldLabel: "Identifier", fieldKey: "identifiersIdentifier", semanticSlug: "identifiers-identifier" },
      { fieldLabel: "Identifier", fieldKey: "identifiersIdentifier2", semanticSlug: "identifiers-identifier2" },
    ]
  );
});

test("the optional Format version column can be omitted without losing v2 ordering or regenerated identities", () => {
  const spec = {
    sections: [
      { key: "first", label: "First", fields: [scalarField({ fieldKey: "firstValue", semanticSlug: "first-value" })] },
      { key: "second", label: "Second", fields: [scalarField({ fieldKey: "secondValue", semanticSlug: "second-value" })] },
    ],
  };
  const columns = fieldsCsvV2Columns.filter((column) => column !== "formatVersion");
  const rows = v2RowsFor(spec).reverse();
  const content = csvCore.buildCsv([
    columns.map((column) => fieldsCsvColumnLabels[column]),
    ...rows.map((row) => columns.map((column) => row[column] ?? "")),
  ]);
  const imported = readFieldsCsvRows(content);

  assert.equal(imported.legacy, false);
  assert.equal(imported.explicitOrder, true);
  assert.deepEqual(imported.sections.map((section) => section.key), ["first", "second"]);
  assert.deepEqual(imported.sections.map((section) => section.fields[0].fieldKey), ["firstIdentifier", "secondIdentifier"]);
});

test("legacy 13-column nested and flat files remain importable", () => {
  const nested = legacyRow({
    sectionLabel: "Recycled content",
    sectionPath: JSON.stringify(["Materials", "Composition", "Recycled content"]),
    sectionKeyPath: JSON.stringify(["materials", "composition", "recycledContent"]),
    fieldLabel: "Recycled percentage",
    fieldType: "text",
    dataType: "decimal",
    unitLabel: "Percent",
    unitSymbol: "%",
  });
  const flat = legacyRow({
    sectionLabel: "Identity",
    fieldLabel: "Serial number",
  });

  const nestedImport = readFieldsCsvRows(buildLegacyCsv([nested]));
  assert.equal(nestedImport.legacy, true);
  assert.equal(nestedImport.explicitOrder, false);
  assert.equal(nestedImport.maxDepth, 3);
  assert.equal(
    nestedImport.sections[0].sections[0].sections[0].fields[0].fieldKey,
    "recycledPercentage"
  );

  const flatImport = readFieldsCsvRows(buildLegacyCsv([flat]));
  assert.equal(flatImport.legacy, true);
  assert.deepEqual(
    flatImport.sections.map(({ key, label }) => ({ key, label })),
    [{ key: "identity", label: "Identity" }]
  );
  assert.equal(flatImport.sections[0].fields[0].fieldKey, "serialNumber");
});

test("legacy subset headers use defaults without requiring the retired full template", () => {
  const columns = ["sectionLabel", "fieldLabel", "definition"];
  const imported = readFieldsCsvRows(buildLegacyCsv([
    legacyRow({
      sectionLabel: "Documentation",
      fieldLabel: "Declaration",
      definition: "Supplier declaration.",
    }),
  ], { columns }));
  const field = imported.sections[0].fields[0];

  assert.equal(imported.legacy, true);
  assert.equal(field.fieldKey, "declaration");
  assert.equal(field.semanticSlug, "declaration");
  assert.equal(field.fieldType, "text");
  assert.equal(field.dataType, "string");
  assert.equal(field.objectType, "SingleValuedDataElement");
  assert.equal(field.valueDataType, "String");
  assert.equal(field.confidentiality, "public");
  assert.deepEqual(field.tableColumns, []);
});

test("BOM and CRLF, LF, and bare-CR records all parse", () => {
  const rows = v2RowsFor(singleFieldSpec());
  for (const lineEnding of ["\r\n", "\n", "\r"]) {
    const content = buildFieldsCsvContent(rows, { bom: true, lineEnding });
    assert.equal(content.startsWith("\ufeff"), true, `expected BOM for ${JSON.stringify(lineEnding)}`);
    const imported = readFieldsCsvRows(content);
    assert.equal(imported.sections[0].fields[0].fieldKey, "identifier");
  }
});

test("comma, semicolon, and tab dialects are auto-detected", () => {
  const rows = v2RowsFor(singleFieldSpec());
  for (const delimiter of [",", ";", "\t"]) {
    const content = buildFieldsCsvContent(rows, {
      delimiter,
      bom: false,
      lineEnding: "\n",
    });
    const imported = readFieldsCsvRows(content);
    assert.equal(imported.delimiter, delimiter);
    assert.equal(imported.sections[0].fields[0].fieldKey, "identifier");
  }
});

test("sep= directives select comma, semicolon, and tab dialects after a BOM", () => {
  const rows = v2RowsFor(singleFieldSpec());
  for (const delimiter of [",", ";", "\t"]) {
    const body = buildFieldsCsvContent(rows, {
      delimiter,
      bom: false,
      lineEnding: "\r\n",
    });
    const content = `\ufeffsep=${delimiter}\r\n${body}`;
    const imported = readFieldsCsvRows(content);
    assert.equal(imported.delimiter, delimiter);
    assert.equal(imported.sections[0].fields[0].fieldKey, "identifier");
  }
});

test("quoted commas, quotes, embedded newlines, Unicode, formulas, and literal apostrophes round-trip safely", () => {
  const complexDefinition = "Rad ett, \"citerad\"\nRad två; Ω and ✓";
  const formula = "=HYPERLINK(\"https://example.invalid\",\"open\")";
  const literalApostrophe = "'Already literal text";
  const spec = {
    sections: [{
      key: "measurements",
      label: "Mätningar, \"primära\"",
      fields: [
        scalarField({
          fieldLabel: "Mätvärde, \"primärt\"",
          fieldKey: "primaryMeasurement",
          semanticSlug: "primary-measurement",
          definition: complexDefinition,
        }),
        scalarField({
          fieldLabel: "Formula text",
          fieldKey: "formulaText",
          semanticSlug: "formula-text",
          definition: formula,
        }),
        scalarField({
          fieldLabel: "Apostrophe text",
          fieldKey: "apostropheText",
          semanticSlug: "apostrophe-text",
          definition: literalApostrophe,
        }),
      ],
    }],
  };

  const content = buildFieldsCsvContent(v2RowsFor(spec));
  assert.match(content, /'=HYPERLINK/);
  assert.match(content, /''Already literal text/);
  const imported = readFieldsCsvRows(content);
  assert.equal(imported.sections[0].label, "Mätningar, \"primära\"");
  assert.deepEqual(
    imported.sections[0].fields.map((field) => field.definition),
    [complexDefinition, formula, literalApostrophe]
  );

  assert.equal(csvCore.restoreFormulaSafeCell(csvCore.protectFormulaCell("'literal")), "'literal");
  assert.equal(csvCore.restoreFormulaSafeCell(csvCore.protectFormulaCell("=1+1")), "=1+1");
});

test("header-only, incomplete, and wrong-width files are rejected", () => {
  assert.throws(
    () => readFieldsCsvRows(buildFieldsCsvContent([])),
    /must contain at least one complete field row/
  );

  const incomplete = v2RowsFor(singleFieldSpec());
  incomplete[0] = { ...incomplete[0], fieldLabel: "" };
  expectRowsRejected(incomplete, /requires both Section label and Label/);

  const completeRow = v2RowsFor(singleFieldSpec())[0];
  const shortRow = fieldsCsvV2Columns
    .slice(0, -1)
    .map((column) => completeRow[column] ?? "");
  const wrongWidth = csvCore.buildCsv([
    fieldsCsvHeaders(),
    shortRow,
  ]);
  assert.throws(
    () => readFieldsCsvRows(wrongWidth),
    /expected 21 columns but found 20/
  );
});

test("nested label paths are validated while imported section key paths are ignored", () => {
  const missingKeyPath = readFieldsCsvRows(buildLegacyCsv([
    legacyRow({
      sectionLabel: "Composition",
      sectionPath: JSON.stringify(["Materials", "Composition"]),
      sectionKeyPath: "",
    }),
  ]));
  assert.equal(missingKeyPath.sections[0].sections[0].key, "composition");

  assert.throws(
    () => readFieldsCsvRows(buildLegacyCsv([
      legacyRow({
        sectionLabel: "Wrong leaf",
        sectionPath: JSON.stringify(["Materials", "Composition"]),
        sectionKeyPath: JSON.stringify(["materials", "composition"]),
      }),
    ])),
    /must match the final Section path label/
  );

  const conflictingImportedKeys = readFieldsCsvRows(buildLegacyCsv([
      legacyRow({
        sectionLabel: "Composition",
        sectionPath: JSON.stringify(["Materials", "Composition"]),
        sectionKeyPath: JSON.stringify(["materials", "composition"]),
        fieldLabel: "Material name",
      }),
      legacyRow({
        sectionLabel: "Composition",
        sectionPath: JSON.stringify(["Materials", "Composition"]),
        sectionKeyPath: JSON.stringify(["materials", "compositionDetails"]),
        fieldLabel: "Material share",
      }),
    ]));
  assert.deepEqual(
    conflictingImportedKeys.sections[0].sections[0].fields.map((field) => field.fieldKey),
    ["materialName", "materialShare"]
  );
});

test("imported field, section, and table-column identifiers are ignored and regenerated", () => {
  const duplicateFields = v2RowsFor({
    sections: [{
      key: "identity",
      label: "Identity",
      fields: [
        scalarField({ fieldLabel: "First ID", fieldKey: "sameId", semanticSlug: "same-id" }),
        scalarField({ fieldLabel: "Second ID", fieldKey: "sameId", semanticSlug: "same-id" }),
      ],
    }],
  });
  duplicateFields.forEach((row) => {
    row.fieldKey = "sameId";
    row.semanticSlug = "same-id";
  });
  const regeneratedFields = readV2Rows(duplicateFields);
  assert.deepEqual(
    regeneratedFields.sections[0].fields.map((field) => field.fieldKey),
    ["firstId", "secondId"]
  );

  const regeneratedSections = readFieldsCsvRows(buildLegacyCsv([
      legacyRow({
        sectionLabel: "Details",
        sectionPath: JSON.stringify(["Product", "Details"]),
        sectionKeyPath: JSON.stringify(["product", "details"]),
        fieldLabel: "Product value",
      }),
      legacyRow({
        sectionLabel: "Details",
        sectionPath: JSON.stringify(["Facility", "Details"]),
        sectionKeyPath: JSON.stringify(["facility", "details"]),
        fieldLabel: "Facility value",
      }),
    ]));
  assert.deepEqual(
    regeneratedSections.sections.map((section) => section.sections[0].key),
    ["productDetails", "facilityDetails"]
  );

  const [tableRow] = v2RowsFor(singleFieldSpec(tableField()));
  const duplicateColumns = [
    tableColumn(),
    tableColumn({ columnLabel: "Material again" }),
  ];
  const regeneratedColumns = readV2Rows(
    [{ ...tableRow, tableColumns: JSON.stringify(duplicateColumns) }]
  );
  assert.deepEqual(
    regeneratedColumns.sections[0].fields[0].tableColumns.map((column) => column.columnKey),
    ["materialName", "materialAgain"]
  );
});

test("invalid and inconsistent v2 ordering is rejected", () => {
  const rows = v2RowsFor({
    sections: [{
      key: "identity",
      label: "Identity",
      fields: [
        scalarField({ fieldLabel: "First", fieldKey: "first", semanticSlug: "first" }),
        scalarField({ fieldLabel: "Second", fieldKey: "second", semanticSlug: "second" }),
      ],
    }],
  });

  expectRowsRejected(
    rows.map((row, index) => index === 1 ? { ...row, fieldOrder: "1" } : row),
    /duplicates Field order 1/
  );
  expectRowsRejected(
    rows.map((row, index) => index === 1 ? { ...row, fieldOrder: "" } : row),
    /must provide both order columns for every row/
  );
  expectRowsRejected(
    rows.map((row, index) => index === 1
      ? { ...row, fieldOrder: "", sectionOrderPath: "" }
      : row),
    /must provide both order columns for every row/
  );
  expectRowsRejected(
    rows.map((row, index) => index === 1 ? { ...row, sectionOrderPath: "[2]" } : row),
    /same label path is paired with different section key paths/
  );

  const deepRow = v2RowsFor({
    sections: [{
      key: "root",
      label: "Root",
      fields: [],
      sections: [{
        key: "leaf",
        label: "Leaf",
        fields: [scalarField()],
      }],
    }],
  })[0];
  expectRowsRejected(
    [{ ...deepRow, sectionOrderPath: "[1]" }],
    /must be a JSON array of positive integers matching the section path depth/
  );

  const separateSections = v2RowsFor({
    sections: [
      { key: "firstSection", label: "First section", fields: [scalarField()] },
      {
        key: "secondSection",
        label: "Second section",
        fields: [scalarField({ fieldKey: "otherIdentifier", semanticSlug: "other-identifier" })],
      },
    ],
  });
  expectRowsRejected(
    separateSections.map((row, index) => index === 1 ? { ...row, sectionOrderPath: "[1]" } : row),
    /reuses one section position for different section paths/
  );
});

test("invalid table JSON and structural mismatches are rejected while derived schema metadata is ignored", () => {
  const [tableRow] = v2RowsFor(singleFieldSpec(tableField()));

  expectRowsRejected(
    [{ ...tableRow, tableColumns: "not-json" }],
    /Table schema must be valid JSON/
  );
  const ignoredColumnMetadata = readV2Rows([{
      ...tableRow,
      tableColumns: JSON.stringify([
        tableColumn({ objectType: "RelatedResource", valueDataType: "Object" }),
      ]),
    }]);
  assert.equal(ignoredColumnMetadata.sections[0].fields[0].tableColumns[0].objectType, "SingleValuedDataElement");

  const ignoredValueMetadata = readV2Rows([{
      ...tableRow,
      tableColumns: JSON.stringify([
        tableColumn({ dataType: "decimal", valueDataType: "String" }),
      ]),
    }]);
  assert.equal(ignoredValueMetadata.sections[0].fields[0].tableColumns[0].valueDataType, "Decimal");

  const ignoredFieldMetadata = readV2Rows([{
    ...tableRow,
    objectType: "SingleValuedDataElement",
    valueDataType: "String",
    fieldKey: "tamperedKey",
    semanticSlug: "tampered-slug",
    unitKey: "tampered-unit",
  }]);
  const regeneratedField = ignoredFieldMetadata.sections[0].fields[0];
  assert.equal(regeneratedField.objectType, "DataElementCollection");
  assert.equal(regeneratedField.valueDataType, "Array");
  assert.equal(regeneratedField.fieldKey, "materialComposition");
  assert.equal(regeneratedField.semanticSlug, "material-composition");
  assert.equal(regeneratedField.unitKey, "none");

  const [scalarRow] = v2RowsFor(singleFieldSpec());
  expectRowsRejected(
    [{ ...scalarRow, tableColumns: JSON.stringify([tableColumn()]) }],
    /Table schema is only allowed for UI type table/
  );
});
