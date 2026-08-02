import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("passport version column alignment", () => {
  test("renders the expand control only for rows that can expand", () => {
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
    expect(styles).toMatch(/\.passport-version-toggle\s*\{[^}]*flex:\s*0 0 22px;[^}]*width:\s*22px;[^}]*height:\s*22px;/s);
  });
});
