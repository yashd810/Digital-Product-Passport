import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("passport identifier column sizing", () => {
  test("widens the full table only when an identifier would require a third line", () => {
    const rowSource = readFileSync(
      new URL("../user/dashboard/passports/components/PassportListRow.js", import.meta.url),
      "utf8",
    );
    const tableSource = readFileSync(
      new URL("../user/dashboard/passports/components/PassportListTable.js", import.meta.url),
      "utf8",
    );
    const styles = readFileSync(
      new URL("../shared/styles/dashboard/layout.css", import.meta.url),
      "utf8",
    );

    expect(rowSource).toContain("function PassportIdentifierText");
    expect(rowSource).toContain("new ResizeObserver(updateColumnWidth)");
    expect(rowSource).toContain("passport-text-cell-natural-measure");
    expect(rowSource).toContain("requiredColumnWidth");
    expect(tableSource).toContain("updateIdentifierColumnWidth");
    expect(tableSource).toContain("passport-list-table--wide-identifiers");
    expect(styles).toMatch(/\.passport-list-table \{[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed;/s);
    expect(styles).toMatch(/\.passport-list-scroll-wrapper \{[^}]*overflow-x:\s*hidden;/s);
    expect(styles).toMatch(/\.passport-list-scroll-wrapper--wide-identifiers \{[^}]*overflow-x:\s*auto;/s);
    expect(styles).toContain("--passport-identifier-wide-column-width");
    expect(styles).toMatch(/\.passport-list-table \.passport-serial-col,[\s\S]*?\.passport-list-table \.passport-model-col \{[^}]*width:\s*clamp\(7\.5rem, 10vw, 10rem\);[^}]*min-width:\s*0;/);
    expect(styles).toMatch(/\.passport-model-cell \{[^}]*-webkit-line-clamp:\s*2;/s);
    expect(styles).toMatch(/\.passport-serial-cell \{[^}]*-webkit-line-clamp:\s*2;/s);
    expect(styles).not.toContain("passport-text-cell-scrollable");
  });
});
