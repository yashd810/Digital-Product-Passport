"use strict";

const createPassportRepresentationService = require("../services/passport-representation-service");

describe("passport representation service", () => {
  test("emits standards-aligned operational header fields", () => {
    const { buildOperationalDppPayload } = createPassportRepresentationService();
    const payload = buildOperationalDppPayload(
      {
        guid: "72b99c83-952c-4179-96f6-54a513d39dbc",
        company_id: 5,
        passport_type: "battery",
        product_id: "BAT-2026-001",
        product_identifier_did: "did:web:www.example.test:did:battery:item:c5-bat-2026-001-abcdef123456",
        release_status: "released",
        version_number: 2,
        updated_at: "2026-04-27T10:00:00.000Z",
        facility_id: "FAC-01",
      },
      {
        semantic_model_key: "claros_battery_dictionary_v1",
        fields_json: {
          sections: [
            {
              fields: [
                { key: "facility_id", type: "text" },
              ],
            },
          ],
        },
      },
      {
        companyName: "Acme Energy",
        granularity: "item",
        dppIdentity: {
          companyDid: (companyId) => `did:web:www.example.test:did:company:${companyId}`,
          productModelDid: () => "did:web:www.example.test:did:battery:model:legacy",
          dppDid: () => "did:web:www.example.test:did:dpp:item:legacy",
          buildCanonicalPublicUrl: () => "https://app.example.test/dpp/acme/battery/BAT-2026-001",
        },
      }
    );

    expect(payload.uniqueProductIdentifier).toBe("did:web:www.example.test:did:battery:item:c5-bat-2026-001-abcdef123456");
    expect(payload.dppSchemaVersion).toBe("prEN 18223:2025");
    expect(payload.contentSpecificationIds).toEqual(["claros_battery_dictionary_v1"]);
    expect(payload.facilityId).toBe("FAC-01");
    expect(payload.lastUpdate).toBe("2026-04-27T10:00:00.000Z");
  });
});
