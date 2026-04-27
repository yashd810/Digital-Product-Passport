"use strict";

const createComplianceService = require("../services/compliance-service");

function createMockPool(typeDef) {
  return {
    async query(sql, params) {
      if (sql.includes("FROM passport_types")) {
        return { rows: typeDef && params[0] === typeDef.type_name ? [typeDef] : [] };
      }
      throw new Error(`Unhandled mock query: ${sql}`);
    },
  };
}

function createMockBatteryDictionaryService() {
  const manifest = {
    batteryCategoryScope: ["EV", "LMT", "Industrial", "Stationary"],
  };
  const categoryRules = {
    sourceWorkbook: "2026_BatteryPass-Ready_DataAttributeLongList_v1.3.xlsx",
    sheetName: "Data attribute longlist_DR_v1.3",
  };
  const terms = [
    {
      slug: "battery-category",
      iri: "https://example.com/terms/battery-category",
      appFieldKeys: ["battery_category"],
      dataType: { format: "String", jsonType: "string", xsdType: "xsd:string" },
    },
    {
      slug: "battery-mass",
      iri: "https://example.com/terms/battery-mass",
      appFieldKeys: ["battery_mass"],
      dataType: { format: "Decimal", jsonType: "number", xsdType: "xsd:decimal" },
    },
    {
      slug: "state-of-charge",
      iri: "https://example.com/terms/state-of-charge",
      appFieldKeys: ["state_of_charge_soc"],
      dataType: { format: "Decimal", jsonType: "number", xsdType: "xsd:decimal" },
    },
    {
      slug: "certificate-url",
      iri: "https://example.com/terms/certificate-url",
      appFieldKeys: ["certificate_url"],
      dataType: { format: "URI/URL", jsonType: "string", xsdType: "xsd:anyURI" },
    },
    {
      slug: "battery-passport-id",
      iri: "https://example.com/terms/battery-passport-id",
      appFieldKeys: ["passport_identifier"],
      dataType: { format: "String", jsonType: "string", xsdType: "xsd:string" },
    },
  ];

  const termsByFieldKey = Object.fromEntries(
    terms.flatMap((term) => (term.appFieldKeys || []).map((fieldKey) => [fieldKey, term]))
  );
  const termsByIri = Object.fromEntries(terms.map((term) => [term.iri, term]));
  const requirementsByFieldKey = {
    passport_identifier: { EV: "mandatory_battreg", LMT: "mandatory_battreg", Industrial: "mandatory_battreg", Stationary: "mandatory_battreg" },
    battery_category: { EV: "mandatory_battreg", LMT: "mandatory_battreg", Industrial: "mandatory_battreg", Stationary: "mandatory_battreg" },
    battery_mass: { EV: "mandatory_battreg", LMT: "mandatory_battreg", Industrial: "mandatory_battreg", Stationary: "mandatory_battreg" },
    state_of_charge_soc: { EV: "mandatory_battreg", LMT: "mandatory_battreg", Industrial: "not_applicable", Stationary: "not_applicable" },
    certificate_url: { EV: "voluntary", LMT: "voluntary", Industrial: "voluntary", Stationary: "voluntary" },
  };

  return {
    getManifest() {
      return manifest;
    },
    getCategoryRules() {
      return categoryRules;
    },
    getTermByFieldKey(fieldKey) {
      return termsByFieldKey[fieldKey] || null;
    },
    getTermByIri(iri) {
      return termsByIri[iri] || null;
    },
    getCategoryRequirementForField(fieldKey, category) {
      return requirementsByFieldKey[fieldKey]?.[category] || null;
    },
  };
}

const TYPE_DEF = {
  type_name: "din_spec_99100",
  semantic_model_key: "claros_battery_dictionary_v1",
  fields_json: {
    sections: [
      {
        key: "general",
        label: "General",
        fields: [
          { key: "passport_identifier", label: "Passport Identifier", type: "text", access: ["public"] },
          { key: "battery_category", label: "Battery Category", type: "text", access: ["public"] },
          { key: "battery_mass", label: "Battery Mass", type: "text", access: ["public"] },
          { key: "state_of_charge_soc", label: "State of Charge", type: "text", access: ["legitimate_interest"] },
          { key: "certificate_url", label: "Certificate URL", type: "url", access: ["notified_bodies"] },
        ],
      },
    ],
  },
};

describe("compliance service", () => {
  test("requires workflow when a battery passport is incomplete but otherwise valid", async () => {
    const service = createComplianceService({
      pool: createMockPool(TYPE_DEF),
      batteryDictionaryService: createMockBatteryDictionaryService(),
    });

    const result = await service.evaluatePassport({
      passport_type: "din_spec_99100",
      passport_identifier: "BAT-2026-001",
      battery_category: "EV",
      battery_mass: "450.5",
      state_of_charge_soc: "",
      certificate_url: "",
    }, "din_spec_99100");

    expect(result.workflowReleaseAllowed).toBe(true);
    expect(result.directReleaseAllowed).toBe(false);
    expect(result.workflowRequired).toBe(true);
    expect(result.completeness.percentage).toBe(60);
    expect(result.completeness.missingFields.map((field) => field.key)).toEqual(
      expect.arrayContaining(["state_of_charge_soc", "certificate_url"])
    );
    expect(result.category.normalized).toBe("EV");
    expect(result.category.missingMandatoryFields.map((field) => field.key)).toContain("state_of_charge_soc");
  });

  test("blocks release when semantic values do not match the battery dictionary datatypes", async () => {
    const service = createComplianceService({
      pool: createMockPool(TYPE_DEF),
      batteryDictionaryService: createMockBatteryDictionaryService(),
    });

    const result = await service.evaluatePassport({
      passport_type: "din_spec_99100",
      passport_identifier: "BAT-2026-001",
      battery_category: "EV",
      battery_mass: "not-a-number",
      state_of_charge_soc: "high",
      certificate_url: "notaurl",
    }, "din_spec_99100");

    expect(result.workflowReleaseAllowed).toBe(false);
    expect(result.directReleaseAllowed).toBe(false);
    expect(result.blockingIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "SEMANTIC_VALUE_TYPE_MISMATCH",
      ])
    );
  });

  test("blocks release when access metadata is missing or invalid", async () => {
    const typeDef = {
      ...TYPE_DEF,
      fields_json: {
        sections: [
          {
            key: "general",
            label: "General",
            fields: [
              { key: "passport_identifier", label: "Passport Identifier", type: "text", access: [] },
              { key: "battery_category", label: "Battery Category", type: "text", access: ["public", "unknown_audience"] },
            ],
          },
        ],
      },
    };

    const service = createComplianceService({
      pool: createMockPool(typeDef),
      batteryDictionaryService: createMockBatteryDictionaryService(),
    });

    const result = await service.evaluatePassport({
      passport_type: "din_spec_99100",
      passport_identifier: "BAT-2026-001",
      battery_category: "EV",
    }, "din_spec_99100");

    expect(result.workflowReleaseAllowed).toBe(false);
    expect(result.blockingIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["FIELD_ACCESS_MISSING", "FIELD_ACCESS_INVALID"])
    );
  });

  test("ignores non-applicable category fields when the workbook marks them as not applicable", async () => {
    const service = createComplianceService({
      pool: createMockPool(TYPE_DEF),
      batteryDictionaryService: createMockBatteryDictionaryService(),
    });

    const result = await service.evaluatePassport({
      passport_type: "din_spec_99100",
      passport_identifier: "BAT-2026-001",
      battery_category: "Industrial",
      battery_mass: "450.5",
      certificate_url: "",
      state_of_charge_soc: "",
    }, "din_spec_99100");

    expect(result.category.normalized).toBe("Industrial");
    expect(result.completeness.missingFields.map((field) => field.key)).toContain("certificate_url");
    expect(result.completeness.missingFields.map((field) => field.key)).not.toContain("state_of_charge_soc");
    expect(result.category.ignoredFields.map((field) => field.key)).toContain("state_of_charge_soc");
  });
});
