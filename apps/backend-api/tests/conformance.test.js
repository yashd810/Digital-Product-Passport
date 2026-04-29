"use strict";

const createDidService = require("../services/did-service");
const createCanonicalPassportSerializer = require("../services/canonicalPassportSerializer");
const createPassportRepresentationService = require("../services/passport-representation-service");
const {
  buildPassportJsonLdContext,
  buildPassportJsonLdExport,
} = require("../services/battery-pass-export");

const BATTERY_CONTEXT_URL = "https://www.claros-dpp.online/dictionary/battery/v1/context.jsonld";

function createConformanceFixture() {
  const didService = createDidService({
    didDomain: "www.claros-dpp.online",
    publicOrigin: "https://www.claros-dpp.online",
    apiOrigin: "https://api.claros.test",
  });
  const serializer = createCanonicalPassportSerializer({ didService });
  const { buildOperationalDppPayload } = createPassportRepresentationService({
    buildCanonicalPassportPayload: serializer.buildCanonicalPassportPayload,
  });

  const passport = {
    guid: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
    lineage_id: "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
    company_id: 5,
    passport_type: "battery",
    product_id: "BAT-2026-001",
    product_identifier_did: "did:web:www.claros-dpp.online:did:battery:item:c5-bat-2026-001-abcdef123456",
    release_status: "released",
    version_number: 2,
    updated_at: "2026-04-27T10:00:00.000Z",
    granularity: "item",
    battery_mass: "450",
    battery_category: "EV",
  };

  const typeDef = {
    type_name: "battery",
    umbrella_category: "Battery Digital Passport",
    semantic_model_key: "claros_battery_dictionary_v1",
    fields_json: {
      sections: [
        {
          fields: [
            { key: "battery_mass", dataType: "number", elementId: "batteryMass" },
            { key: "battery_category", dataType: "string", elementId: "batteryCategory" },
          ],
        },
      ],
    },
  };

  return {
    didService,
    serializer,
    buildOperationalDppPayload,
    passport,
    typeDef,
    expectedHeader: {
      digitalProductPassportId: passport.guid,
      uniqueProductIdentifier: passport.product_id,
      dppSchemaVersion: "prEN 18223:2025",
      dppStatus: "Active",
      lastUpdated: passport.updated_at,
      economicOperatorId: didService.generateCompanyDid("company-5"),
      contentSpecificationIds: ["claros_battery_dictionary_v1"],
    },
  };
}

describe("battery DPP conformance", () => {
  test("matches the standards header and compressed JSON representation rules", () => {
    const {
      buildOperationalDppPayload,
      passport,
      typeDef,
      expectedHeader,
    } = createConformanceFixture();

    const payload = buildOperationalDppPayload(passport, typeDef, {
      companyName: "Acme Energy",
      granularity: "item",
      dppIdentity: {
        companyDid: () => expectedHeader.economicOperatorId,
        productModelDid: () => passport.product_identifier_did,
        dppDid: () => expectedHeader.digitalProductPassportId,
        buildCanonicalPublicUrl: () => "https://app.example.test/dpp/acme-energy/battery/BAT-2026-001",
      },
    });

    expect(payload).toEqual(
      expect.objectContaining({
        digitalProductPassportId: expectedHeader.digitalProductPassportId,
        uniqueProductIdentifier: expectedHeader.uniqueProductIdentifier,
        granularity: "item",
        dppSchemaVersion: expectedHeader.dppSchemaVersion,
        dppStatus: expectedHeader.dppStatus,
        lastUpdated: expectedHeader.lastUpdated,
        economicOperatorId: expectedHeader.economicOperatorId,
        contentSpecificationIds: expectedHeader.contentSpecificationIds,
        battery_mass: 450,
        battery_category: "EV",
      })
    );
    expect(payload.fields).toBeUndefined();
    expect(payload.elements).toBeUndefined();
  });

  test("matches the standards header and expanded JSON element rules", () => {
    const {
      serializer,
      passport,
      typeDef,
      expectedHeader,
    } = createConformanceFixture();

    const payload = serializer.buildExpandedPassportPayload(passport, typeDef);

    expect(payload).toEqual(
      expect.objectContaining({
        digitalProductPassportId: expectedHeader.digitalProductPassportId,
        uniqueProductIdentifier: expectedHeader.uniqueProductIdentifier,
        granularity: "Item",
        dppSchemaVersion: expectedHeader.dppSchemaVersion,
        dppStatus: expectedHeader.dppStatus,
        lastUpdated: expectedHeader.lastUpdated,
        economicOperatorId: expectedHeader.economicOperatorId,
        contentSpecificationIds: expectedHeader.contentSpecificationIds,
      })
    );
    expect(payload.fields).toBeUndefined();
    expect(Array.isArray(payload.elements)).toBe(true);
    expect(payload.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "batteryMass",
          objectType: "SingleValuedDataElement",
          dictionaryReference: "https://www.claros-dpp.online/dictionary/battery/v1/terms/battery-mass",
          valueDataType: "Decimal",
          value: 450,
          elements: [],
        }),
        expect.objectContaining({
          elementId: "batteryCategory",
          objectType: "SingleValuedDataElement",
          dictionaryReference: "https://www.claros-dpp.online/dictionary/battery/v1/terms/battery-category",
          valueDataType: "String",
          value: "EV",
          elements: [],
        }),
      ])
    );

    for (const element of payload.elements) {
      expect(element.dictionaryReference).toEqual(expect.any(String));
      expect(element.valueDataType).toEqual(expect.any(String));
      expect(element.objectType).toEqual(expect.any(String));
    }
  });

  test("resolves JSON-LD battery context and inline semantic mappings from the type definition", () => {
    const typeDef = {
      type_name: "ev_battery_passport_custom",
      umbrella_category: "Battery Digital Passport",
      semantic_model_key: "generic_dpp_v1",
      fields_json: {
        sections: [
          {
            fields: [
              { key: "battery_mass" },
              { key: "supplier_portal", semanticId: "https://example.test/ns/supplier-portal" },
            ],
          },
        ],
      },
    };

    const context = buildPassportJsonLdContext(typeDef);
    const inlineContext = context.find((entry) =>
      entry && typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, "supplier_portal")
    );

    expect(context[0]).toEqual(
      expect.objectContaining({
        DigitalProductPassport: "dpp:DigitalProductPassport",
        digitalProductPassportId: "dpp:digitalProductPassportId",
      })
    );
    expect(context).toEqual(expect.arrayContaining([BATTERY_CONTEXT_URL]));
    expect(inlineContext).toEqual({
      supplier_portal: { "@id": "https://example.test/ns/supplier-portal" },
    });

    const exported = buildPassportJsonLdExport(
      [{ guid: "guid-1", passport_type: "ev_battery_passport_custom", battery_mass: "450.5" }],
      "ev_battery_passport_custom",
      {
        semanticModelKey: "generic_dpp_v1",
        umbrellaCategory: "Battery Digital Passport",
      }
    );

    expect(exported["@context"]).toEqual(expect.arrayContaining([BATTERY_CONTEXT_URL]));
    expect(exported.semantic_model).toMatchObject({
      semanticModelKey: "claros_battery_dictionary_v1",
      contextUrl: BATTERY_CONTEXT_URL,
    });
  });
});
