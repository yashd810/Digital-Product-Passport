import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("viewer section spacing", () => {
  test("separates an expanded section header from its first data card", () => {
    const styles = readFileSync(
      new URL("../passport-viewer/styles/PassportViewer.css", import.meta.url),
      "utf8",
    );

    expect(styles).toMatch(/\.passport-portal \.data-nested-section-content\s*\{[^}]*padding:\s*14px 20px 20px;/s);
    expect(styles).toMatch(/\.passport-portal \.data-nested-section-depth-2 > \.data-nested-section-content\s*\{[^}]*padding:\s*12px 16px 16px;/s);
  });
});
