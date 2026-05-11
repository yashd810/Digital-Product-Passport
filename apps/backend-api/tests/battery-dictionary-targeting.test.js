"use strict";

const {
  BATTERY_DICTIONARY_MODEL_KEY,
  hasRequiredBatterySemanticModel,
  isBatteryProductCategory,
} = require("../services/battery-dictionary-targeting");

describe("battery dictionary targeting", () => {
  test("detects battery product categories", () => {
    expect(isBatteryProductCategory("Battery Digital Passport")).toBe(true);
    expect(isBatteryProductCategory("Industrial Battery")).toBe(true);
    expect(isBatteryProductCategory("Appliances")).toBe(false);
  });

  test("requires the Claros battery semantic model for battery product categories", () => {
    expect(hasRequiredBatterySemanticModel({
      productCategory: "Battery Digital Passport",
      semanticModelKey: BATTERY_DICTIONARY_MODEL_KEY,
    })).toBe(true);

    expect(hasRequiredBatterySemanticModel({
      productCategory: "Battery Digital Passport",
      semanticModelKey: "",
    })).toBe(false);

    expect(hasRequiredBatterySemanticModel({
      productCategory: "Battery Digital Passport",
      semanticModelKey: "generic_dpp_v1",
    })).toBe(false);

    expect(hasRequiredBatterySemanticModel({
      productCategory: "Appliances",
      semanticModelKey: "",
    })).toBe(true);
  });
});
