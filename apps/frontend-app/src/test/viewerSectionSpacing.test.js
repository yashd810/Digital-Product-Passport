import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("viewer section spacing", () => {
  test("reveals header-to-table spacing only when a section is expanded", () => {
    const styles = readFileSync(
      new URL("../passport-viewer/styles/PassportViewer.css", import.meta.url),
      "utf8",
    );

    expect(styles).toMatch(/\.passport-portal \.data-nested-section-content\s*\{[^}]*padding:\s*0 20px;[^}]*transition:\s*padding 0\.28s ease;/s);
    expect(styles).toMatch(/\.passport-portal \.data-nested-section\.is-expanded > \.data-nested-section-motion > \.data-nested-section-content\s*\{[^}]*padding:\s*14px 20px 20px;/s);
    expect(styles).toMatch(/\.passport-portal \.data-nested-section-depth-2\.is-expanded > \.data-nested-section-motion > \.data-nested-section-content\s*\{[^}]*padding:\s*12px 16px 16px;/s);
    expect(styles).toMatch(/\.passport-portal \.data-nested-section-content\s*\{[^}]*padding:\s*0 14px;/s);
    expect(styles).toMatch(/\.passport-portal \.data-nested-section\.is-expanded > \.data-nested-section-motion > \.data-nested-section-content\s*\{[^}]*padding:\s*12px 14px 14px;/s);
  });
});
