import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("passport identifier column sizing", () => {
  test("keeps identifier columns compact, wraps to two lines, and exposes longer values through horizontal scrolling", () => {
    const rowSource = readFileSync(
      new URL("../user/dashboard/passports/components/PassportListRow.js", import.meta.url),
      "utf8",
    );
    const styles = readFileSync(
      new URL("../shared/styles/dashboard/layout.css", import.meta.url),
      "utf8",
    );

    expect(rowSource).toContain("function PassportIdentifierText");
    expect(rowSource).toContain("new ResizeObserver(updateOverflowState)");
    expect(rowSource).toContain('" passport-text-cell-scrollable"');
    expect(rowSource).toContain("Scroll horizontally to read the full value.");
    expect(styles).toMatch(/\.passport-list-table \{[^}]*table-layout:\s*auto;/s);
    expect(styles).toMatch(/\.passport-list-table \.passport-serial-col,[\s\S]*?\.passport-list-table \.passport-model-col \{[^}]*width:\s*1%;[^}]*min-width:\s*8\.5rem;/);
    expect(styles).toMatch(/\.passport-model-cell \{[^}]*-webkit-line-clamp:\s*2;/s);
    expect(styles).toMatch(/\.passport-serial-cell \{[^}]*-webkit-line-clamp:\s*2;/s);
    expect(styles).toMatch(/\.passport-text-cell-scrollable \{[^}]*overflow-x:\s*auto;[^}]*white-space:\s*nowrap;/s);
  });
});
