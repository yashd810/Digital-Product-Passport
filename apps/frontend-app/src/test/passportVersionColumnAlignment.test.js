import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("passport version column alignment", () => {
  test("keeps every version badge in one column while rendering arrows only for expandable rows", () => {
    const rowSource = readFileSync(
      new URL("../user/dashboard/passports/components/PassportListRow.js", import.meta.url),
      "utf8",
    );
    const styles = readFileSync(
      new URL("../shared/styles/dashboard/layout.css", import.meta.url),
      "utf8",
    );

    expect(rowSource).toContain("{showOlderVersionsToggle && (");
    expect(rowSource).not.toContain("passport-version-toggle-slot");
    expect(styles).not.toContain(".passport-version-toggle-slot");
    expect(styles).not.toContain(".passport-version-cell.historical");
    expect(styles).toMatch(/\.passport-version-cell\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*18px max-content;[^}]*column-gap:\s*10px;/s);
    expect(styles).toMatch(/\.passport-version-cell \.version-badge\s*\{[^}]*grid-column:\s*2;/s);
    expect(styles).toMatch(/\.passport-version-toggle\s*\{[^}]*grid-column:\s*1;[^}]*justify-self:\s*start;[^}]*width:\s*16px;[^}]*height:\s*16px;/s);
  });
});
