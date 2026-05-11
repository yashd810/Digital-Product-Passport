"use strict";

const {
  buildPassportJsonLdContext,
  buildPassportJsonLdExport,
} = require("../services/battery-pass-export");

describe("battery-pass-export", () => {
  test("uses the battery dictionary for battery product categories without requiring a matching type or semantic model key", () => {
    const typeDef = {
      type_name: "ev_battery_passport_custom",
      product_category: "Battery Digital Passport",
      semantic_model_key: "generic_dpp_v1",
      fields_json: {
        sections: [
          {
            fields: [
              { key: "battery_mass", semanticId: null },
            ],
          },
        ],
      },
    };

    const context = buildPassportJsonLdContext(typeDef);
    expect(context).toEqual(
      expect.arrayContaining([
        "https://www.claros-dpp.online/dictionary/battery/v1/context.jsonld",
      ])
    );

    const exported = buildPassportJsonLdExport([
      { guid: "guid-1", passport_type: "ev_battery_passport_custom", battery_mass: "450.5" },
    ], "ev_battery_passport_custom", {
      semanticModelKey: "generic_dpp_v1",
      productCategory: "Battery Digital Passport",
    });

    expect(exported.passport_type).toBe("ev_battery_passport_custom");
    expect(exported.semantic_model?.semanticModelKey).toBe("claros_battery_dictionary_v1");
    expect(exported["@context"]).toEqual(
      expect.arrayContaining([
        "https://www.claros-dpp.online/dictionary/battery/v1/context.jsonld",
      ])
    );
  });
});
