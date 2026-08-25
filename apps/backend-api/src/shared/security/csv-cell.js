"use strict";

// Spreadsheet applications evaluate cells whose first meaningful character is
// a formula marker.  Exports are an untrusted-data boundary: passport values
// and editable schema labels can be supplied by another authenticated user.
// Prefixing an apostrophe makes the cell literal in Excel, LibreOffice, and
// compatible importers before RFC 4180 quoting is applied.
const spreadsheetFormulaPrefix = /^[\s]*[=+\-@]/;

function stringifyCsvValue(value) {
  return Array.isArray(value) || (typeof value === "object" && value !== null)
    ? JSON.stringify(value)
    : String(value ?? "");
}

function serializeCsvCell(value) {
  const stringValue = stringifyCsvValue(value);
  const literalValue = spreadsheetFormulaPrefix.test(stringValue)
    ? `'${stringValue}`
    : stringValue;
  return `"${literalValue.replace(/"/g, '""')}"`;
}

module.exports = {
  serializeCsvCell,
  stringifyCsvValue,
};
