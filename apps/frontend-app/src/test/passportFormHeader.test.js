import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("passport form system field handling", () => {
  test("renders only Local Tools schema fields and uses header mappings solely for prefilled values", () => {
    const source = readFileSync(
      new URL("../passports/form/PassportFormPage.js", import.meta.url),
      "utf8"
    );

    expect(source).toContain("const isSystemPrefilledField");
    expect(source).toContain("systemHeader?.fieldMappings");
    expect(source).toContain('System value');
    expect(source).toContain("renderProductImagePicker()");
    expect(source).not.toContain("renderPassportHeaderSection");
    expect(source).not.toContain("renderManagedComplianceSection");
    expect(source).not.toMatch(/\bsetModelName\b/);
    expect(source).not.toContain("buildPassportFormHeaderContext");
  });
});
