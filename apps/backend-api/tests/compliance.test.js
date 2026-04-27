"use strict";

const createComplianceService = require("../services/compliance-service");

function createMockPool(typeDef) {
  return {
    async query(sql, params) {
      if (sql.includes("FROM passport_types")) {
        return { rows: typeDef && params[0] === typeDef.type_name ? [typeDef] : [] };
      }
      if (sql.includes("FROM companies")) {
        return {
          rows: [{
            id: 5,
            company_name: "Acme Energy",
            did_slug: "acme-energy",
            economic_operator_identifier: "EORI-ACME-001",
            economic_operator_identifier_scheme: "EORI",
          }],
        };
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
      slug: "dpp-schema-version",
      iri: "https://example.com/terms/dpp-schema-version",
      appFieldKeys: ["dpp_schema_version"],
      dataType: { format: "String", jsonType: "string", xsdType: "xsd:string" },
    },
    {
      slug: "dpp-status",
      iri: "https://example.com/terms/dpp-status",
      appFieldKeys: ["dpp_status"],
      dataType: { format: "String", jsonType: "string", xsdType: "xsd:string" },
    },
    {
      slug: "dpp-granularity",
      iri: "https://example.com/terms/dpp-granularity",
      appFieldKeys: ["dpp_granularity"],
      dataType: { format: "String", jsonType: "string", xsdType: "xsd:string" },
    },
    {
      slug: "last-updated-at",
      iri: "https://example.com/terms/last-updated-at",
      appFieldKeys: ["last_updated_at"],
      dataType: { format: "Timestamp UTC-based", jsonType: "string", xsdType: "xsd:dateTime" },
    },
    {
      slug: "unique-dpp-identifier",
      iri: "https://example.com/terms/unique-dpp-identifier",
      appFieldKeys: ["unique_dpp_identifier", "unique_passport_identifier"],
      dataType: { format: "URI/URL", jsonType: "string", xsdType: "xsd:anyURI" },
    },
    {
      slug: "unique-product-identifier",
      iri: "https://example.com/terms/unique-product-identifier",
      appFieldKeys: ["unique_product_identifier", "unique_battery_identifier"],
      dataType: { format: "URI/URL", jsonType: "string", xsdType: "xsd:anyURI" },
    },
    {
      slug: "economic-operator-identifier",
      iri: "https://example.com/terms/economic-operator-identifier",
      appFieldKeys: ["economic_operator_identifier"],
      dataType: { format: "ID (string)", jsonType: "string", xsdType: "xsd:string" },
    },
    {
      slug: "facility-identifier",
      iri: "https://example.com/terms/facility-identifier",
      appFieldKeys: ["facility_identifier"],
      dataType: { format: "ID (string)", jsonType: "string", xsdType: "xsd:string" },
    },
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
    dpp_schema_version: { EV: "mandatory_espr_jtc24", LMT: "mandatory_espr_jtc24", Industrial: "mandatory_espr_jtc24", Stationary: "mandatory_espr_jtc24" },
    dpp_status: { EV: "mandatory_espr_jtc24", LMT: "mandatory_espr_jtc24", Industrial: "mandatory_espr_jtc24", Stationary: "mandatory_espr_jtc24" },
    dpp_granularity: { EV: "mandatory_espr_jtc24", LMT: "mandatory_espr_jtc24", Industrial: "mandatory_espr_jtc24", Stationary: "mandatory_espr_jtc24" },
    last_updated_at: { EV: "mandatory_espr_jtc24", LMT: "mandatory_espr_jtc24", Industrial: "mandatory_espr_jtc24", Stationary: "mandatory_espr_jtc24" },
    unique_dpp_identifier: { EV: "mandatory_battreg", LMT: "mandatory_battreg", Industrial: "mandatory_battreg", Stationary: "mandatory_battreg" },
    unique_passport_identifier: { EV: "mandatory_battreg", LMT: "mandatory_battreg", Industrial: "mandatory_battreg", Stationary: "mandatory_battreg" },
    unique_product_identifier: { EV: "mandatory_battreg", LMT: "mandatory_battreg", Industrial: "mandatory_battreg", Stationary: "mandatory_battreg" },
    unique_battery_identifier: { EV: "mandatory_battreg", LMT: "mandatory_battreg", Industrial: "mandatory_battreg", Stationary: "mandatory_battreg" },
    economic_operator_identifier: { EV: "mandatory_espr_jtc24", LMT: "mandatory_espr_jtc24", Industrial: "mandatory_espr_jtc24", Stationary: "mandatory_espr_jtc24" },
    facility_identifier: { EV: "mandatory_battreg", LMT: "mandatory_battreg", Industrial: "mandatory_battreg", Stationary: "mandatory_battreg" },
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

function buildCanonicalPassportPayload(passport, _typeDef, { company } = {}) {
  return {
    digitalProductPassportId: passport?.guid
      ? `did:web:www.example.test:did:dpp:item:${passport.guid}`
      : "did:web:www.example.test:did:dpp:item:mock",
    uniqueProductIdentifier: passport?.product_identifier_did
      || `did:web:www.example.test:did:battery:item:${passport?.passport_identifier || "mock"}`,
    dppSchemaVersion: passport?.dpp_schema_version || "prEN 18223:2025",
    dppStatus: passport?.release_status || "Draft",
    granularity: passport?.granularity || "item",
    lastUpdate: passport?.updated_at || passport?.created_at || "2026-04-27T10:00:00.000Z",
    economicOperatorId: passport?.economic_operator_id || company?.economic_operator_identifier || "EORI-ACME-001",
    facilityId: passport?.facility_id || passport?.facility_identifier || null,
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
          { key: "passport_identifier", label: "Passport Identifier", type: "text", access: ["public"], confidentiality: "public", updateAuthority: ["economic_operator"] },
          { key: "battery_category", label: "Battery Category", type: "text", access: ["public"], confidentiality: "public", updateAuthority: ["economic_operator"] },
          { key: "battery_mass", label: "Battery Mass", type: "text", access: ["public"], confidentiality: "public", updateAuthority: ["economic_operator"] },
          { key: "state_of_charge_soc", label: "State of Charge", type: "text", access: ["legitimate_interest"], confidentiality: "restricted", updateAuthority: ["economic_operator"] },
          { key: "certificate_url", label: "Certificate URL", type: "url", access: ["notified_bodies"], confidentiality: "regulated", updateAuthority: ["economic_operator", "notified_bodies"] },
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
      buildCanonicalPassportPayload,
    });

    const result = await service.evaluatePassport({
      passport_type: "din_spec_99100",
      company_id: 5,
      compliance_profile_key: "battery_dpp_v1",
      content_specification_ids: JSON.stringify(["claros_battery_dictionary_v1"]),
      carrier_policy_key: "battery_qr_public_entry_v1",
      facility_id: "PLANT-01",
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
    expect(result.managedSemanticIssues).toEqual([]);
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
      buildCanonicalPassportPayload,
    });

    const result = await service.evaluatePassport({
      passport_type: "din_spec_99100",
      company_id: 5,
      compliance_profile_key: "battery_dpp_v1",
      content_specification_ids: JSON.stringify(["claros_battery_dictionary_v1"]),
      carrier_policy_key: "battery_qr_public_entry_v1",
      facility_id: "PLANT-01",
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
      buildCanonicalPassportPayload,
    });

    const result = await service.evaluatePassport({
      passport_type: "din_spec_99100",
      company_id: 5,
      compliance_profile_key: "battery_dpp_v1",
      content_specification_ids: JSON.stringify(["claros_battery_dictionary_v1"]),
      carrier_policy_key: "battery_qr_public_entry_v1",
      facility_id: "PLANT-01",
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
      buildCanonicalPassportPayload,
    });

    const result = await service.evaluatePassport({
      passport_type: "din_spec_99100",
      company_id: 5,
      compliance_profile_key: "battery_dpp_v1",
      content_specification_ids: JSON.stringify(["claros_battery_dictionary_v1"]),
      carrier_policy_key: "battery_qr_public_entry_v1",
      facility_id: "PLANT-01",
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

  test("blocks release when profile governance fields are missing", async () => {
    const service = createComplianceService({
      pool: createMockPool(TYPE_DEF),
      batteryDictionaryService: createMockBatteryDictionaryService(),
      buildCanonicalPassportPayload,
    });

    const result = await service.evaluatePassport({
      passport_type: "din_spec_99100",
      company_id: 5,
      passport_identifier: "BAT-2026-001",
      battery_category: "EV",
      battery_mass: "450.5",
    }, "din_spec_99100");

    expect(result.profile.key).toBe("battery_dpp_v1");
    expect(result.blockingIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "PROFILE_GOVERNANCE_FIELD_MISSING",
        "CARRIER_POLICY_MISSING",
        "FACILITY_IDENTIFIER_MISSING",
      ])
    );
  });

  test("blocks release when a battery profile does not expose a controlled-access layer", async () => {
    const publicOnlyTypeDef = {
      ...TYPE_DEF,
      fields_json: {
        sections: [
          {
            key: "general",
            label: "General",
            fields: TYPE_DEF.fields_json.sections[0].fields.map((field) => ({
              ...field,
              access: ["public"],
              confidentiality: "public",
            })),
          },
        ],
      },
    };

    const service = createComplianceService({
      pool: createMockPool(publicOnlyTypeDef),
      batteryDictionaryService: createMockBatteryDictionaryService(),
      buildCanonicalPassportPayload,
    });

    const result = await service.evaluatePassport({
      passport_type: "din_spec_99100",
      company_id: 5,
      compliance_profile_key: "battery_dpp_v1",
      content_specification_ids: JSON.stringify(["claros_battery_dictionary_v1"]),
      carrier_policy_key: "battery_qr_public_entry_v1",
      facility_id: "PLANT-01",
      passport_identifier: "BAT-2026-001",
      battery_category: "EV",
      battery_mass: "450.5",
      state_of_charge_soc: "50.0",
      certificate_url: "https://example.com/certificate",
    }, "din_spec_99100");

    expect(result.workflowReleaseAllowed).toBe(false);
    expect(result.blockingIssues.map((issue) => issue.code)).toContain("CONTROLLED_ACCESS_LAYER_MISSING");
  });

  test("blocks release when managed mandatory standards identifiers cannot be derived", async () => {
    const service = createComplianceService({
      pool: createMockPool(TYPE_DEF),
      batteryDictionaryService: createMockBatteryDictionaryService(),
      buildCanonicalPassportPayload: () => ({
        digitalProductPassportId: null,
        uniqueProductIdentifier: null,
        dppSchemaVersion: null,
        dppStatus: "Draft",
        granularity: "item",
        lastUpdate: null,
        economicOperatorId: null,
        facilityId: null,
      }),
    });

    const result = await service.evaluatePassport({
      passport_type: "din_spec_99100",
      company_id: 5,
      compliance_profile_key: "battery_dpp_v1",
      content_specification_ids: JSON.stringify(["claros_battery_dictionary_v1"]),
      carrier_policy_key: "battery_qr_public_entry_v1",
      facility_id: "PLANT-01",
      passport_identifier: "BAT-2026-001",
      battery_category: "EV",
      battery_mass: "450.5",
      state_of_charge_soc: "50.0",
      certificate_url: "https://example.com/certificate",
    }, "din_spec_99100");

    expect(result.workflowReleaseAllowed).toBe(false);
    expect(result.managedSemanticIssues.map((issue) => issue.code)).toContain("MANAGED_SEMANTIC_FIELD_MISSING");
    expect(result.managedSemanticIssues.map((issue) => issue.key)).toEqual(
      expect.arrayContaining(["unique_dpp_identifier", "unique_product_identifier"])
    );
  });
});
