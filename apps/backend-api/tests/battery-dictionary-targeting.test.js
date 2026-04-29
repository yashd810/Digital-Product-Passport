"use strict";

const {
  BATTERY_DICTIONARY_MODEL_KEY,
  hasRequiredBatterySemanticModel,
  isBatteryUmbrellaCategory,
} = require("../services/battery-dictionary-targeting");

describe("battery dictionary targeting", () => {
  test("detects battery umbrella categories", () => {
    expect(isBatteryUmbrellaCategory("Battery Digital Passport")).toBe(true);
    expect(isBatteryUmbrellaCategory("Industrial Battery")).toBe(true);
    expect(isBatteryUmbrellaCategory("Appliances")).toBe(false);
  });

  test("requires the Claros battery semantic model for battery umbrella categories", () => {
    expect(hasRequiredBatterySemanticModel({
      umbrellaCategory: "Battery Digital Passport",
      semanticModelKey: BATTERY_DICTIONARY_MODEL_KEY,
    })).toBe(true);

    expect(hasRequiredBatterySemanticModel({
      umbrellaCategory: "Battery Digital Passport",
      semanticModelKey: "",
    })).toBe(false);

    expect(hasRequiredBatterySemanticModel({
      umbrellaCategory: "Battery Digital Passport",
      semanticModelKey: "generic_dpp_v1",
    })).toBe(false);

    expect(hasRequiredBatterySemanticModel({
      umbrellaCategory: "Appliances",
      semanticModelKey: "",
    })).toBe(true);
  });
});
