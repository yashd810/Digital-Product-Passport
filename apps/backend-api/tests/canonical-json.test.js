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
  });
});
