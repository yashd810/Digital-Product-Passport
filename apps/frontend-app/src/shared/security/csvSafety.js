// Browser CSV exports can contain values and labels supplied by authenticated
// users. Keep formula protection at the serialization boundary so spreadsheet
// applications render those values as literals instead of evaluating them.
const spreadsheetFormulaPrefix = /^\s*[=+\-@]/;

export function protectSpreadsheetFormula(value) {
  const text = String(value ?? "");
  return spreadsheetFormulaPrefix.test(text) ? `'${text}` : text;
}

export function escapeCsvCell(value) {
  return `"${protectSpreadsheetFormula(value).replace(/"/g, '""')}"`;
}
