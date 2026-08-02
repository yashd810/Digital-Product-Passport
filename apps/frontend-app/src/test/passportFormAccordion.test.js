import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("passport form accordion layout", () => {
  test("keeps collapsed create and edit sections header-only", () => {
    const formSource = readFileSync(
      new URL("../passports/form/PassportFormPage.js", import.meta.url),
      "utf8",
    );
    const sectionStyles = readFileSync(
      new URL("../shared/styles/create-pass/form-sections.css", import.meta.url),
      "utf8",
    );

    expect(formSource).toContain('className={`form-section${expanded[sk] ? " is-expanded" : ""}`}');
    expect(formSource).toContain('className={`section-content-motion${expanded[sk] ? " is-expanded" : ""}`}');
    expect(sectionStyles).toMatch(/\.section-header\s*\{[^}]*border-bottom:\s*0;/s);
    expect(sectionStyles).toContain(".form-section.is-expanded .section-header");
    expect(sectionStyles).toMatch(/\.section-content\s*\{[^}]*padding:\s*0 20px;/s);
    expect(sectionStyles).toContain(".section-content-motion.is-expanded .section-content");
  });

  test("lays out image selection and pasted links with intentional spacing", () => {
    const fieldStyles = readFileSync(
      new URL("../shared/styles/create-pass/field-controls.css", import.meta.url),
      "utf8",
    );

    expect(fieldStyles).toContain(".passport-product-image-group");
    expect(fieldStyles).toContain("grid-template-columns: minmax(15rem, max-content) minmax(15rem, 1fr);");
    expect(fieldStyles).toContain(".passport-product-image-group .file-existing");
    expect(fieldStyles).toContain("@media (max-width: 640px)");
  });
});
