"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { deriveSections } = require("./derived-field-metadata");

test("derived field metadata always follows the editable field inputs", () => {
  const [section] = deriveSections([{
    label: "Technical Details",
    key: "staleSectionKey",
    fields: [{
      fieldLabel: "Rated Capacity",
      fieldKey: "staleFieldKey",
      semanticSlug: "stale-semantic-slug",
      fieldType: "number",
      dataType: "decimal",
      unitLabel: "Kilowatt hour",
      unitKey: "stale-unit",
      objectType: "StaleObjectType",
      valueDataType: "StaleValueType",
    }],
  }]);

  assert.equal(section.key, "technicalDetails");
  assert.deepEqual(section.fields[0], {
    fieldLabel: "Rated Capacity",
    fieldKey: "ratedCapacity",
    semanticSlug: "rated-capacity",
    fieldType: "number",
    dataType: "decimal",
    unitLabel: "Kilowatt hour",
    unitKey: "kilowatt-hour",
    objectType: "SingleValuedDataElement",
    valueDataType: "Decimal",
    tableColumns: [],
  });
});

test("repeated and reserved labels receive stable context-aware camelCase keys", () => {
  const derived = deriveSections([
    {
      label: "Product",
      fields: [{ fieldLabel: "DPP Status", fieldType: "text" }],
      sections: [{
        label: "Identifiers",
        fields: [{ fieldLabel: "Identifier", fieldType: "text" }],
      }],
    },
    {
      label: "Manufacturer",
      fields: [],
      sections: [{
        label: "Identifiers",
        fields: [{ fieldLabel: "Identifier", fieldType: "text" }],
      }],
    },
  ]);

  assert.equal(derived[0].fields[0].fieldKey, "productDppStatus");
  assert.equal(derived[0].sections[0].fields[0].fieldKey, "productIdentifiersIdentifier");
  assert.equal(derived[1].sections[0].fields[0].fieldKey, "manufacturerIdentifiersIdentifier");
  assert.equal(derived[0].sections[0].fields[0].semanticSlug, "product-identifiers-identifier");
});

test("generated field keys preserve up to 200 characters and safely fit longer labels", () => {
  const exactLabel = `a${"b".repeat(199)}`;
  const tooLongLabel = `c${"d".repeat(260)}`;
  const [section] = deriveSections([{
    label: "Limits",
    fields: [
      { fieldLabel: exactLabel, fieldType: "text" },
      { fieldLabel: tooLongLabel, fieldType: "text" },
    ],
  }]);

  assert.equal(section.fields[0].fieldKey, exactLabel);
  assert.equal(section.fields[0].fieldKey.length, 200);
  assert.equal(section.fields[1].fieldKey.length, 200);
  assert.match(section.fields[1].fieldKey, /^[a-z][A-Za-z0-9]{199}$/);
  assert.equal(String(section.fields[1].semanticSlug).length, 200);
});

test("table-column identifiers and schema metadata are rebuilt from column inputs", () => {
  const [section] = deriveSections([{
    label: "Composition",
    fields: [{
      fieldLabel: "Material breakdown",
      fieldType: "table",
      dataType: "string",
      objectType: "Wrong",
      valueDataType: "Wrong",
      tableColumns: [{
        columnLabel: "Material name",
        columnKey: "wrong",
        semanticSlug: "wrong",
        dataType: "string",
        unitLabel: "Percent",
        unitKey: "wrong",
        objectType: "Wrong",
        valueDataType: "Wrong",
      }],
    }],
  }]);

  const field = section.fields[0];
  assert.equal(field.dataType, "array");
  assert.equal(field.objectType, "DataElementCollection");
  assert.equal(field.valueDataType, "Array");
  assert.deepEqual(field.tableColumns[0], {
    columnLabel: "Material name",
    columnKey: "materialName",
    semanticSlug: "material-name",
    dataType: "string",
    unitLabel: "Percent",
    unitKey: "percent",
    objectType: "SingleValuedDataElement",
    valueDataType: "String",
  });
});
