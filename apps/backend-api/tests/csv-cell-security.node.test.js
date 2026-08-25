"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { serializeCsvCell } = require("../src/shared/security/csv-cell");

test("CSV cells neutralize spreadsheet formulas before RFC 4180 escaping", () => {
  for (const value of [
    "=HYPERLINK(\"https://attacker.invalid\")",
    "+cmd|' /C calc'!A0",
    "-1+1",
    "@SUM(1+1)",
    " \t\r\n=SUM(1+1)",
  ]) {
    assert.equal(serializeCsvCell(value), `"'${value.replace(/"/g, '""')}"`);
  }
});

test("CSV cells retain ordinary literals and escape embedded quotes", () => {
  assert.equal(serializeCsvCell("ordinary \"value\""), '"ordinary ""value"""');
  assert.equal(serializeCsvCell({ label: "ordinary" }), '"{""label"":""ordinary""}"');
});
