"use strict";

const passportFieldDataTypes = Object.freeze([
  "string",
  "decimal",
  "integer",
  "boolean",
  "date",
  "datetime",
  "uri",
  "array",
]);

const passportFieldDataTypeSet = new Set(passportFieldDataTypes);
const tableColumnDataTypes = Object.freeze(
  passportFieldDataTypes.filter((dataType) => dataType !== "array")
);
const tableColumnDataTypeSet = new Set(tableColumnDataTypes);
const requiredDataTypeByFieldType = Object.freeze({
  boolean: "boolean",
  date: "date",
  file: "string",
  symbol: "uri",
  url: "uri",
});
const valueDataTypeByDataType = Object.freeze({
  string: "String",
  decimal: "Decimal",
  integer: "Integer",
  boolean: "Boolean",
  date: "Date",
  datetime: "DateTime",
  uri: "URI",
});

function expectedValueDataTypeForField(fieldType, dataType) {
  if (fieldType === "table") return "Array";
  if (fieldType === "file") return "Binary";
  if (fieldType === "url" || fieldType === "symbol") return "URI";
  return valueDataTypeByDataType[dataType] || null;
}

function normalizePassportFieldDataType(value) {
  return String(value || "").trim().toLowerCase();
}

function getPassportFieldDataTypeError(field = {}, { requireExplicit = false } = {}) {
  const fieldType = String(field?.type || "").trim().toLowerCase();
  const dataType = normalizePassportFieldDataType(field?.dataType);
  const fieldLabel = field?.key || field?.label || "unknown";

  if (!dataType) {
    return requireExplicit ? `Field "${fieldLabel}" must declare a dataType.` : null;
  }
  if (!passportFieldDataTypeSet.has(dataType)) {
    return `Field "${fieldLabel}" uses unsupported dataType "${field?.dataType}".`;
  }
  const requiredDataType = requiredDataTypeByFieldType[fieldType];
  if (requiredDataType && dataType !== requiredDataType) {
    return `Field "${fieldLabel}" type "${fieldType}" requires dataType "${requiredDataType}".`;
  }
  if (requireExplicit && !field?.objectType) {
    return `Field "${fieldLabel}" must declare an objectType.`;
  }
  if (requireExplicit && !field?.valueDataType) {
    return `Field "${fieldLabel}" must declare a valueDataType.`;
  }
  if (fieldType === "table" && dataType !== "array") {
    return `Table field "${fieldLabel}" must use dataType "array".`;
  }
  if (fieldType !== "table" && dataType === "array") {
    return `Field "${fieldLabel}" uses dataType "array" but is not a table field.`;
  }
  if (fieldType !== "table" && Array.isArray(field?.tableColumns) && field.tableColumns.length) {
    return `Field "${fieldLabel}" defines tableColumns but is not a table field.`;
  }

  const expectedFieldValueDataType = expectedValueDataTypeForField(fieldType, dataType);
  if (field?.valueDataType && field.valueDataType !== expectedFieldValueDataType) {
    return `Field "${fieldLabel}" dataType "${dataType}" requires valueDataType "${expectedFieldValueDataType}".`;
  }

  if (fieldType === "table") {
    if (field?.objectType && field.objectType !== "DataElementCollection") {
      return `Table field "${fieldLabel}" must use objectType "DataElementCollection".`;
    }
    if (field?.valueDataType && field.valueDataType !== "Array") {
      return `Table field "${fieldLabel}" must use valueDataType "Array".`;
    }
    const columns = Array.isArray(field?.tableColumns) ? field.tableColumns : [];
    if (!columns.length) return `Table field "${fieldLabel}" must define at least one table column.`;
    const seenColumnKeys = new Set();
    for (const column of columns) {
      const columnDataType = normalizePassportFieldDataType(column?.dataType);
      const columnLabel = `${fieldLabel}.${column?.key || column?.label || "unknown"}`;
      if (!column?.key) return `Table field "${fieldLabel}" contains a column without a key.`;
      if (seenColumnKeys.has(column.key)) return `Table field "${fieldLabel}" contains duplicate column key "${column.key}".`;
      seenColumnKeys.add(column.key);
      if (!columnDataType) {
        if (requireExplicit) return `Table column "${columnLabel}" must declare a dataType.`;
        continue;
      }
      if (!tableColumnDataTypeSet.has(columnDataType)) {
        return `Table column "${columnLabel}" uses unsupported dataType "${column?.dataType}".`;
      }
      if (requireExplicit && !column?.objectType) {
        return `Table column "${columnLabel}" must declare an objectType.`;
      }
      if (requireExplicit && !column?.valueDataType) {
        return `Table column "${columnLabel}" must declare a valueDataType.`;
      }
      if (column?.objectType && column.objectType !== "SingleValuedDataElement") {
        return `Table column "${columnLabel}" must use objectType "SingleValuedDataElement".`;
      }
      const expectedValueDataType = valueDataTypeByDataType[columnDataType];
      if (column?.valueDataType && column.valueDataType !== expectedValueDataType) {
        return `Table column "${columnLabel}" dataType "${columnDataType}" requires valueDataType "${expectedValueDataType}".`;
      }
    }
  }

  return null;
}

module.exports = {
  expectedValueDataTypeForField,
  getPassportFieldDataTypeError,
  normalizePassportFieldDataType,
  passportFieldDataTypes,
  passportFieldDataTypeSet,
  requiredDataTypeByFieldType,
  tableColumnDataTypes,
  tableColumnDataTypeSet,
  valueDataTypeByDataType,
};
