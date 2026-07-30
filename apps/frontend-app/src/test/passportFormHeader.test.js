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
    expect(source).toMatch(/renderProductImagePicker[\s\S]*?setSymbolPicker\("productImage"\)/);
    expect(source).not.toMatch(/renderProductImagePicker[\s\S]*?setRepoPicker\("productImage"\)/);
    expect(source).toContain('Link PDF from Repository');
    expect(source).toContain("fileDisplayNames");
    expect(source).toContain("onSelect={(url, fileName)");
    expect(source).toContain('linkedUrl ? "Linked document" : null');
    expect(source).not.toContain('linkedUrl ? linkedUrl.split("/").pop() : null');
    expect(source).not.toContain("renderPassportHeaderSection");
    expect(source).not.toContain("renderManagedComplianceSection");
    expect(source).not.toMatch(/\bsetModelName\b/);
    expect(source).not.toContain("buildPassportFormHeaderContext");
    expect(source).not.toContain("canonicalizeRecordToSchemaKeys");
    expect(source).toMatch(/const persistedFormData = formDataRef\.current/);
    const nonPersistedBlock = source.match(/const nonPersistedPayloadKeys = new Set\(\[([\s\S]*?)\]\);/);
    expect(nonPersistedBlock?.[1]).not.toContain("uniqueProductIdentifier");
  });
});
