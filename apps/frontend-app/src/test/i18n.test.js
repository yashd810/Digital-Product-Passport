import { describe, expect, test } from "vitest";
import { supportedLanguageCodes, translateSchemaLabel, translateText } from "../app/providers/i18n";

describe("user-dashboard language support", () => {
  test("supports English, Swedish, and German with interpolated dashboard copy", () => {
    expect(supportedLanguageCodes).toEqual(["en", "sv", "de"]);
    expect(translateText("sv", "sendToWorkflow")).toBe("Skicka till arbetsflöde");
    expect(translateText("de", "archiveCount", { count: 2, passport: "Pässe" })).toBe("2 Pässe archivieren?");
    expect(translateText("sv", "showingPassports", { from: 1, to: 10, total: 24 }))
      .toBe("Visar 1–10 av 24");
  });

  test("uses a passport-type supplied translation before falling back to English", () => {
    const field = {
      label: "Battery capacity",
      translations: {
        en: "Battery capacity",
        sv: "Batterikapacitet",
        de: "Batteriekapazität",
      },
    };

    expect(translateSchemaLabel("sv", field)).toBe("Batterikapacitet");
    expect(translateSchemaLabel("de", field)).toBe("Batteriekapazität");
    expect(translateSchemaLabel("en", field)).toBe("Battery capacity");
  });
});
