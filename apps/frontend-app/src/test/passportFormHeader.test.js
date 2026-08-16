import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("passport form system field handling", () => {
  test("renders only Local Tools schema fields and uses header mappings solely for prefilled values", () => {
    const source = readFileSync(
      new URL("../passports/form/PassportFormPage.js", import.meta.url),
      "utf8"
    );
    const fieldPolicySource = readFileSync(
      new URL("../passports/form/passportFormFieldPolicy.js", import.meta.url),
      "utf8"
    );
    const productImageSource = readFileSync(
      new URL("../passports/form/components/PassportProductImagePicker.jsx", import.meta.url),
      "utf8"
    );
    const fieldInputSource = readFileSync(
      new URL("../passports/form/components/PassportFieldInput.jsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("const isSystemPrefilledField");
    expect(source).toContain("systemHeader?.fieldMappings");
    expect(source).toContain("managedSlotKeys");
    expect(source).toContain("platformGeneratedHeaderSlots");
    expect(source).toContain("applicationPrefilledFieldKeys");
    expect(source).toContain("form-group-system");
    expect(source).toContain('t("systemValue")');
    expect(source).toContain("<PassportProductImagePicker");
    expect(source).toContain('onOpenPicker={() => setSymbolPicker("productImage")}');
    expect(productImageSource).not.toContain("onOpenRepositoryPicker");
    expect(fieldInputSource).toContain('t("linkPdfFromRepository")');
    expect(source).toContain("fileDisplayNames");
    expect(source).toContain("onSelect={(url, fileName)");
    expect(fieldInputSource).toContain('linkedUrl ? t("linkedDocument") : null');
    expect(fieldInputSource).not.toContain('linkedUrl ? linkedUrl.split("/").pop() : null');
    expect(source).not.toContain("renderPassportHeaderSection");
    expect(source).not.toContain("renderManagedComplianceSection");
    expect(source).not.toMatch(/\bsetModelName\b/);
    expect(source).not.toContain("buildPassportFormHeaderContext");
    expect(source).not.toContain("canonicalizeRecordToSchemaKeys");
    expect(source).toMatch(/const persistedFormData = formDataRef\.current/);
    const nonPersistedBlock = fieldPolicySource.match(/export const nonPersistedPayloadKeys = new Set\(\[([\s\S]*?)\]\);/);
    expect(nonPersistedBlock?.[1]).not.toContain("uniqueProductIdentifier");
  });
});
