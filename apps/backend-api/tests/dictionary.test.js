"use strict";

const createBatteryDictionaryService = require("../services/battery-dictionary-service");

describe("battery dictionary service", () => {
  test("loads the manifest and resolves a known field mapping", () => {
    const service = createBatteryDictionaryService();

    expect(service.getManifest()).toHaveProperty("name");
    expect(service.getManifest()).toHaveProperty("authority.normativeSource.title", "BatteryPass Data Attribute Longlist");
    expect(service.getManifest()).toHaveProperty("governance.steward.did", "did:web:www.claros-dpp.online");
    expect(service.getManifest()).toHaveProperty("versioning.sourceVersion", "BatteryPass Data Attribute Longlist v1.3");
    expect(service.getManifest()).toHaveProperty("regulatoryTraceability.applicabilityModel");
    expect(service.getTerms().length).toBeGreaterThan(0);
    expect(service.getCategoryRules()).toHaveProperty("requirementsByFieldKey");
    expect(service.resolveFieldKey("dpp_granularity")).toContain("dpp-granularity");
  });

  test("builds a JSON-LD context with inline field overrides", () => {
    const service = createBatteryDictionaryService();
    const context = service.buildJsonLdContext({
      fields_json: {
        sections: [
            {
              fields: [
                { key: "dpp_granularity" },
                { key: "custom_semantic_field", semanticId: "https://example.com/terms/custom-semantic-field" },
              ],
            },
          ],
      },
    });

    expect(Array.isArray(context)).toBe(true);
    expect(context[1]).toContain("/dictionary/battery/v1/context.jsonld");
    expect(context[2]).toHaveProperty("custom_semantic_field");
  });
});
