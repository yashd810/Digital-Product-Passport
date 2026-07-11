"use strict";

const passportFieldDataTypes = Object.freeze([
  "string",
  "decimal",
  "integer",
  "boolean",
  "date",
  "datetime",
  "uri",
  "object",
  "array",
]);

const passportFieldDataTypeSet = new Set(passportFieldDataTypes);
const tableColumnDataTypes = Object.freeze(
  passportFieldDataTypes.filter((dataType) => !["array", "object"].includes(dataType))
);
const tableColumnDataTypeSet = new Set(tableColumnDataTypes);
const requiredDataTypeByFieldType = Object.freeze({
  boolean: "boolean",
  date: "date",
  datetime: "datetime",
  file: "uri",
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
  object: "Object",
  array: "Array",
});

function expectedValueDataTypeForField(fieldType, dataType) {
  if (fieldType === "table") return "Array";
  if (["objectlist", "multiselect", "scalarlist"].includes(fieldType)) return "Array";
  if (fieldType === "object") return "Object";
  if (fieldType === "file") return "URI";
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
  const isSemanticClassField = field?.rangeKind === "class";
  const isSemanticEnumField = field?.rangeKind === "enum";

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
  if (fieldType === "object" && (!isSemanticClassField || dataType !== "object")) {
    return `Object field "${fieldLabel}" must reference a semantic class and use dataType "object".`;
  }
  if (fieldType === "objectlist" && (!isSemanticClassField || dataType !== "array")) {
    return `Object-list field "${fieldLabel}" must reference a semantic class and use dataType "array".`;
  }
  if (fieldType === "multiselect" && (!isSemanticEnumField || dataType !== "array")) {
    return `Multi-select field "${fieldLabel}" must reference a semantic enum and use dataType "array".`;
  }
  if (fieldType === "scalarlist" && (field?.rangeKind !== "scalar" || dataType !== "array")) {
    return `Scalar-list field "${fieldLabel}" must declare a scalar item type and use dataType "array".`;
  }
  if (fieldType === "select" && (!isSemanticEnumField || dataType !== "string")) {
    return `Select field "${fieldLabel}" must reference a semantic enum and use dataType "string".`;
  }
  if (!["table", "objectlist", "multiselect", "scalarlist"].includes(fieldType) && dataType === "array") {
    return `Field "${fieldLabel}" uses dataType "array" but is not a table field.`;
  }
  if (fieldType !== "object" && dataType === "object") {
    return `Field "${fieldLabel}" uses dataType "object" but is not an object field.`;
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
