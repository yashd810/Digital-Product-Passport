"use strict";

const createDidService = require("../services/did-service");
const createCanonicalPassportSerializer = require("../services/canonicalPassportSerializer");

describe("canonical passport JSON", () => {
  test("preserves numeric, boolean, array, and object typing", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildCanonicalPassportPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        product_id: "BAT-2026-001",
        version_number: 3,
        release_status: "released",
        updated_at: "2026-04-24T12:00:00.000Z",
        cycle_count: "42",
        is_remanufactured: "true",
        chemistry_breakdown: "{\"nickel\":60,\"manganese\":20,\"cobalt\":20}",
        certifications: "[\"CE\",\"UL\"]",
      },
      {
        type_name: "battery",
        fields_json: {
          sections: [
            {
              fields: [
                { key: "cycle_count", dataType: "integer" },
                { key: "is_remanufactured", type: "boolean" },
                { key: "chemistry_breakdown", type: "table" },
                { key: "certifications" },
              ],
            },
          ],
        },
      },
      {
        company: { company_name: "Acme Energy", did_slug: "acme-energy", dpp_granularity: "item" },
      }
    );

    expect(payload.fields.cycle_count).toBe(42);
    expect(payload.fields.is_remanufactured).toBe(true);
    expect(payload.fields.chemistry_breakdown).toEqual({ nickel: 60, manganese: 20, cobalt: 20 });
    expect(payload.fields.certifications).toEqual(["CE", "UL"]);
    expect(payload.lastUpdate).toBe("2026-04-24T12:00:00.000Z");
    expect(payload.extensions).toMatchObject({
      claros: {
        passportType: "battery",
        versionNumber: 3,
        internalId: "72b99c83-952c-4179-96f6-54a513d39dbc",
        validation: {
          valid: true,
          issueCount: 0,
        },
      },
    });
    expect(payload.versionNumber).toBeUndefined();
  });

  test("maps non-public workflow states to Inactive in exchange payloads", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildCanonicalPassportPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        product_id: "BAT-2026-001",
        version_number: 1,
        release_status: "draft",
      },
      {
        type_name: "battery",
        fields_json: { sections: [] },
      },
      {
        company: { company_name: "Acme Energy", did_slug: "acme-energy", dpp_granularity: "item" },
      }
    );

    expect(payload.dppStatus).toBe("Inactive");
  });

  test("uses batch subject DID for batch-granularity passports", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildCanonicalPassportPayload(
      {
        guid: "batch-passport-001",
        lineage_id: "batch-lineage-001",
        company_id: 5,
        passport_type: "battery",
        product_id: "BATCH-2026-001",
        granularity: "batch",
        release_status: "released",
        updated_at: "2026-04-24T12:00:00.000Z",
      },
      { type_name: "battery", fields_json: { sections: [] } },
      { company: { company_name: "Acme Energy", did_slug: "acme-energy" } }
    );

    expect(payload.granularity).toBe("Batch");
    expect(payload.subjectDid).toBe("did:web:www.claros-dpp.online:did:battery:batch:batch-lineage-001");
    expect(payload.dppDid).toBe("did:web:www.claros-dpp.online:did:dpp:batch:batch-lineage-001");
  });

  test("builds expanded Annex A-style elements for full representations", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildExpandedPassportPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        product_id: "BAT-2026-001",
        version_number: 3,
        release_status: "released",
        updated_at: "2026-04-24T12:00:00.000Z",
        cycle_count: "42",
        is_remanufactured: "true",
        chemistry_breakdown: "{\"nickel\":60,\"manganese\":20,\"cobalt\":20}",
        certifications: "[\"CE\",\"UL\"]",
      },
      {
        type_name: "battery",
        fields_json: {
          sections: [
            {
              fields: [
                { key: "cycle_count", dataType: "integer", semanticId: "urn:test:cycle-count", elementId: "cycleCount" },
                { key: "is_remanufactured", type: "boolean", semanticId: "urn:test:is-remanufactured", elementId: "isRemanufactured" },
                { key: "chemistry_breakdown", type: "table", semanticId: "urn:test:chemistry-breakdown", elementId: "chemistryBreakdown" },
                { key: "certifications", semanticId: "urn:test:certifications", elementId: "certifications" },
              ],
            },
          ],
        },
      },
      {
        company: { company_name: "Acme Energy", did_slug: "acme-energy", dpp_granularity: "item" },
      }
    );

    expect(payload.fields).toBeUndefined();
    expect(payload.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "cycleCount",
          objectType: "SingleValuedDataElement",
          dictionaryReference: "urn:test:cycle-count",
          valueDataType: "Integer",
          value: 42,
          elements: [],
        }),
        expect.objectContaining({
          elementId: "isRemanufactured",
          objectType: "SingleValuedDataElement",
          dictionaryReference: "urn:test:is-remanufactured",
          valueDataType: "Boolean",
          value: true,
          elements: [],
        }),
        expect.objectContaining({
          elementId: "certifications",
          objectType: "MultiValuedDataElement",
          dictionaryReference: "urn:test:certifications",
          valueDataType: "Array",
          value: ["CE", "UL"],
        }),
      ])
    );

    const chemistry = payload.elements.find((element) => element.elementId === "chemistryBreakdown");
    expect(chemistry).toMatchObject({
      objectType: "DataElementCollection",
      dictionaryReference: "urn:test:chemistry-breakdown",
      valueDataType: "Object",
      value: { nickel: 60, manganese: 20, cobalt: 20 },
    });
    expect(chemistry.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ elementId: "nickel", valueDataType: "Integer", value: 60 }),
        expect.objectContaining({ elementId: "manganese", valueDataType: "Integer", value: 20 }),
        expect.objectContaining({ elementId: "cobalt", valueDataType: "Integer", value: 20 }),
      ])
    );
  });

  test("resolves dictionaryReference from the battery dictionary when semanticId is omitted", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildExpandedPassportPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        product_id: "BAT-2026-001",
        version_number: 3,
        release_status: "released",
        battery_mass: "250.5",
      },
      {
        type_name: "battery",
        semantic_model_key: "claros_battery_dictionary_v1",
        fields_json: {
          sections: [
            {
              fields: [
                { key: "battery_mass", dataType: "number", elementId: "batteryMass" },
              ],
            },
          ],
        },
      },
      {
        company: { company_name: "Acme Energy", did_slug: "acme-energy", dpp_granularity: "item" },
      }
    );

    expect(payload.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "batteryMass",
          dictionaryReference: "https://www.claros-dpp.online/dictionary/battery/v1/terms/battery-mass",
          valueDataType: "Decimal",
          value: 250.5,
        }),
      ])
    );
  });

  test("classifies related resources and multilingual values with explicit standard object types", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildExpandedPassportPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        product_id: "BAT-2026-001",
        version_number: 3,
        release_status: "released",
        certificate_url: "https://example.test/certificates/cert-001.pdf",
        public_summary_i18n: { en: "Battery summary", sv: "Batterisammanfattning" },
      },
      {
        type_name: "battery",
        fields_json: {
          sections: [
            {
              fields: [
                { key: "certificate_url", type: "url", semanticId: "urn:test:certificate-url", elementId: "certificateUrl" },
                { key: "public_summary_i18n", type: "textarea", semanticId: "urn:test:public-summary-i18n", elementId: "publicSummaryI18n" },
              ],
            },
          ],
        },
      },
      {
        company: { company_name: "Acme Energy", did_slug: "acme-energy", dpp_granularity: "item" },
      }
    );

    expect(payload.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "certificateUrl",
          objectType: "RelatedResource",
          dictionaryReference: "urn:test:certificate-url",
          valueDataType: "URI",
          value: "https://example.test/certificates/cert-001.pdf",
          elements: [],
        }),
        expect.objectContaining({
          elementId: "publicSummaryI18n",
          objectType: "MultiLanguageDataElement",
          dictionaryReference: "urn:test:public-summary-i18n",
          valueDataType: "Object",
          value: { en: "Battery summary", sv: "Batterisammanfattning" },
        }),
      ])
    );

    const i18nElement = payload.elements.find((element) => element.elementId === "publicSummaryI18n");
    expect(i18nElement.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ elementId: "en", objectType: "SingleValuedDataElement", value: "Battery summary" }),
        expect.objectContaining({ elementId: "sv", objectType: "SingleValuedDataElement", value: "Batterisammanfattning" }),
      ])
    );
  });

  test("respects explicit schema object-type hints before shape-based multilingual detection", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildExpandedPassportPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        product_id: "BAT-2026-001",
        version_number: 3,
        release_status: "released",
        ambiguous_object: { en: "123", sv: "456" },
      },
      {
        type_name: "battery",
        fields_json: {
          sections: [
            {
              fields: [
                {
                  key: "ambiguous_object",
                  type: "table",
                  semanticId: "urn:test:ambiguous-object",
                  elementId: "ambiguousObject",
                  valueKind: "collection",
                },
              ],
            },
          ],
        },
      },
      {
        company: { company_name: "Acme Energy", did_slug: "acme-energy", dpp_granularity: "item" },
      }
    );

    expect(payload.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "ambiguousObject",
          objectType: "DataElementCollection",
          dictionaryReference: "urn:test:ambiguous-object",
          value: { en: "123", sv: "456" },
        }),
      ])
    );
  });

  test("drops non-conformant semantic values from export and records validation issues", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildCanonicalPassportPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        product_id: "BAT-2026-001",
        version_number: 3,
        release_status: "released",
        battery_mass: "not-a-number",
      },
      {
        type_name: "battery",
        semantic_model_key: "claros_battery_dictionary_v1",
        fields_json: {
          sections: [
            {
              fields: [
                { key: "battery_mass", dataType: "number", elementId: "batteryMass" },
              ],
            },
          ],
        },
      },
      {
        company: { company_name: "Acme Energy", did_slug: "acme-energy", dpp_granularity: "item" },
      }
    );

    expect(payload.fields.battery_mass).toBeUndefined();
    expect(payload.extensions.claros.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "battery_mass",
          code: "SEMANTIC_TYPE_MISMATCH",
          dictionaryReference: "https://www.claros-dpp.online/dictionary/battery/v1/terms/battery-mass",
        }),
      ])
    );
  });

  test("records category-based missing required fields in validation output", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildCanonicalPassportPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        product_id: "BAT-2026-001",
        version_number: 3,
        release_status: "released",
        battery_category: "EV",
      },
      {
        type_name: "battery",
        semantic_model_key: "claros_battery_dictionary_v1",
        fields_json: {
          sections: [
            {
              fields: [
                { key: "battery_category", dataType: "string", elementId: "batteryCategory" },
                { key: "battery_mass", dataType: "number", elementId: "batteryMass" },
              ],
            },
          ],
        },
      },
      {
        company: { company_name: "Acme Energy", did_slug: "acme-energy", dpp_granularity: "item" },
      }
    );

    expect(payload.fields.battery_category).toBe("EV");
    expect(payload.fields.battery_mass).toBeUndefined();
    expect(payload.extensions.claros.validation).toMatchObject({
      valid: false,
      issueCount: expect.any(Number),
      batteryCategory: {
        raw: "EV",
        normalized: "EV",
        supported: expect.arrayContaining(["EV", "LMT", "Industrial", "Stationary"]),
      },
    });
    expect(payload.extensions.claros.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "battery_mass",
          code: "CATEGORY_REQUIRED_FIELD_MISSING",
          requirementLevel: "mandatory_battreg",
          batteryCategory: "EV",
        }),
      ])
    );
  });

  test("rejects invalid schema-level URL values even without semantic term metadata", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildCanonicalPassportPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        product_id: "BAT-2026-001",
        version_number: 3,
        release_status: "released",
        certificate_url: "notaurl",
      },
      {
        type_name: "battery",
        fields_json: {
          sections: [
            {
              fields: [
                { key: "certificate_url", type: "url", elementId: "certificateUrl" },
              ],
            },
          ],
        },
      },
      {
        company: { company_name: "Acme Energy", did_slug: "acme-energy", dpp_granularity: "item" },
      }
    );

    expect(payload.fields.certificate_url).toBeUndefined();
    expect(payload.extensions.claros.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "certificate_url",
          code: "FIELD_TYPE_MISMATCH",
        }),
      ])
    );
  });

  test("rejects invalid language tags in multilingual field values", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildCanonicalPassportPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        product_id: "BAT-2026-001",
        version_number: 3,
        release_status: "released",
        public_summary_i18n: { "english-us": "Battery summary", sv: "Batterisammanfattning" },
      },
      {
        type_name: "battery",
        fields_json: {
          sections: [
            {
              fields: [
                { key: "public_summary_i18n", type: "textarea", elementId: "publicSummaryI18n", valueKind: "multilanguage" },
              ],
            },
          ],
        },
      },
      {
        company: { company_name: "Acme Energy", did_slug: "acme-energy", dpp_granularity: "item" },
      }
    );

    expect(payload.fields.public_summary_i18n).toBeUndefined();
    expect(payload.extensions.claros.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "public_summary_i18n",
          code: "SEMANTIC_LANGUAGE_TAG_INVALID",
          languageTag: "english-us",
        }),
      ])
    );
  });

  test("rejects values outside allowed options and unsupported battery categories", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildCanonicalPassportPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        product_id: "BAT-2026-001",
        version_number: 3,
        release_status: "released",
        conformity_mark: "FCC",
        battery_category: "car",
      },
      {
        type_name: "battery",
        semantic_model_key: "claros_battery_dictionary_v1",
        fields_json: {
          sections: [
            {
              fields: [
                { key: "conformity_mark", options: ["CE", "UL"] },
                { key: "battery_category", elementId: "batteryCategory" },
              ],
            },
          ],
        },
      },
      {
        company: { company_name: "Acme Energy", did_slug: "acme-energy", dpp_granularity: "item" },
      }
    );

    expect(payload.fields.conformity_mark).toBeUndefined();
    expect(payload.fields.battery_category).toBeUndefined();
    expect(payload.extensions.claros.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "conformity_mark",
          code: "SEMANTIC_TERM_NOT_FOUND",
        }),
        expect.objectContaining({
          key: "battery_category",
          code: "SEMANTIC_ALLOWED_VALUE_MISMATCH",
          invalidValues: ["car"],
        }),
      ])
    );
  });

  test("rejects invalid date-time values and unit mismatches", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildCanonicalPassportPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        product_id: "BAT-2026-001",
        version_number: 3,
        release_status: "released",
        inspection_timestamp: "not-a-timestamp",
        measured_mass: { value: 450, unit: "lb" },
      },
      {
        type_name: "battery",
        fields_json: {
          sections: [
            {
              fields: [
                { key: "inspection_timestamp", dataType: "datetime" },
                { key: "measured_mass", type: "table", unit: "kg" },
              ],
            },
          ],
        },
      },
      {
        company: { company_name: "Acme Energy", did_slug: "acme-energy", dpp_granularity: "item" },
      }
    );

    expect(payload.fields.inspection_timestamp).toBeUndefined();
    expect(payload.fields.measured_mass).toBeUndefined();
    expect(payload.extensions.claros.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "inspection_timestamp",
          code: "FIELD_TYPE_MISMATCH",
        }),
        expect.objectContaining({
          key: "measured_mass",
          code: "FIELD_UNIT_MISMATCH",
        }),
      ])
    );
  });

  test("drops battery fields that are not mapped in the dictionary", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildCanonicalPassportPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        product_id: "BAT-2026-001",
        version_number: 3,
        release_status: "released",
        custom_battery_note: "Unmapped field",
      },
      {
        type_name: "battery",
        semantic_model_key: "claros_battery_dictionary_v1",
        fields_json: {
          sections: [
            {
              fields: [
                { key: "custom_battery_note", elementId: "customBatteryNote" },
              ],
            },
          ],
        },
      },
      {
        company: { company_name: "Acme Energy", did_slug: "acme-energy", dpp_granularity: "item" },
      }
    );

    expect(payload.fields.custom_battery_note).toBeUndefined();
    expect(payload.extensions.claros.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "custom_battery_note",
          code: "SEMANTIC_TERM_NOT_FOUND",
        }),
      ])
    );
  });

  test("rejects arrays with mixed item types in export validation", () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const serializer = createCanonicalPassportSerializer({ didService });
    const payload = serializer.buildCanonicalPassportPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        lineage_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "generic_passport",
        product_id: "BAT-2026-001",
        version_number: 3,
        release_status: "released",
        chemistry_codes: ["NMC", 42],
      },
      {
        type_name: "generic_passport",
        fields_json: {
          sections: [
            {
              fields: [
                { key: "chemistry_codes", type: "table", elementId: "chemistryCodes", semanticId: "urn:test:chemistry-codes" },
              ],
            },
          ],
        },
      },
      {
        company: { company_name: "Acme Energy", did_slug: "acme-energy", dpp_granularity: "item" },
      }
    );

    expect(payload.fields.chemistry_codes).toBeUndefined();
    expect(payload.extensions.claros.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "chemistry_codes",
          code: "FIELD_ARRAY_ITEM_TYPE_MISMATCH",
        }),
      ])
    );
  });
});
