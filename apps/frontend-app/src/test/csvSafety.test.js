import { describe, expect, test } from "vitest";

import { escapeCsvCell, protectSpreadsheetFormula } from "../shared/security/csvSafety";

describe("CSV export security", () => {
  test("neutralizes every spreadsheet formula prefix before CSV escaping", () => {
    ["=SUM(A1:A2)", "+cmd", "-cmd", "@HYPERLINK(\"https://example.test\")", " \t=SUM(A1:A2)"].forEach((value) => {
      expect(protectSpreadsheetFormula(value)).toBe(`'${value}`);
      expect(escapeCsvCell(value)).toBe(`"'${value.replace(/"/g, '""')}"`);
    });
  });

  test("keeps ordinary CSV data readable while escaping quotes", () => {
    expect(protectSpreadsheetFormula("-17")).toBe("'-17");
    expect(escapeCsvCell('ordinary "value"')).toBe('"ordinary ""value"""');
  });
});
