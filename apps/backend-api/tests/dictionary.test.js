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
    expect(service.getManifest()).toHaveProperty("interoperabilityProfile.dcatApVersion", "DCAT-AP 3.0.1");
    expect(service.getTerms().length).toBeGreaterThan(0);
    expect(service.getCategoryRules()).toHaveProperty("requirementsByFieldKey");
    expect(service.getDcatCatalog()).toHaveProperty("@type", "dcat:Catalog");
    expect(service.getContext()).toHaveProperty("@context.@protected", true);
    expect(service.getContext()).toHaveProperty("@context.id", "@id");
    expect(service.getContext()).toHaveProperty("@context.type", "@type");
    expect(service.resolveFieldKey("dpp_granularity")).toContain("dpp-granularity");
  });

  test("publishes domain, range, and workbook metadata for terms", () => {
    const service = createBatteryDictionaryService();
    const term = service.getTermByFieldKey("dpp_schema_version");

    expect(term).toHaveProperty("domainClassKey", "DPPInfo");
    expect(term).toHaveProperty("domain.curie", "clarosBatteryClass:DPPInfo");
    expect(term).toHaveProperty("domain.broaderClass.curie", "clarosBatteryClass:DigitalBatteryPassport");
    expect(term).toHaveProperty("range.curie", "xsd:string");
    expect(term).toHaveProperty("semanticBinding.domain.iri");
    expect(term).toHaveProperty("sourceWorkbookRow", 8);
    expect(term).toHaveProperty("accessRights", "Public");
    expect(term).toHaveProperty("batteryCategoryRequirements.EV", "mandatory_espr_jtc24");
  });

  test("uses section-specific Spherity-style domains for battery terms", () => {
    const service = createBatteryDictionaryService();

    expect(service.getTermByFieldKey("unique_battery_identifier")).toHaveProperty("domainClassKey", "BatteryIdentifiers");
    expect(service.getTermByFieldKey("manufacturer_identifier")).toHaveProperty("domainClassKey", "OperatorIdentifiers");
    expect(service.getTermByFieldKey("battery_carbon_footprint_per_functional_unit")).toHaveProperty("domainClassKey", "BatteryCarbonFootprint");
    expect(service.getTermByFieldKey("remaining_capacity")).toHaveProperty("domainClassKey", "PerformanceDurabilityRestricted");
    expect(service.getTermByFieldKey("rated_capacity")).toHaveProperty("domainClassKey", "PerformanceDurabilityPublic");
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
