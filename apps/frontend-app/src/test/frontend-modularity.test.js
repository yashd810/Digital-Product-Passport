import { describe, expect, test } from "vitest";

import { getConsumerTheme } from "../app/providers/ThemeContext";
import {
  buildProductCategoryOptions,
} from "../admin/passport-types/builderHelpers";
import {
  buildSemanticModelOptions,
  formatSemanticModelLabel,
  getSemanticModelOption,
} from "../admin/passport-types/semanticTermCatalog";
import {
  getPassportSerialNumber,
} from "../user/dashboard/passports/utils/passportListHelpers";
import { buildPassportJsonLdExport } from "../shared/utils/semanticPassportExport";

describe("frontend modularity helpers", () => {
  test("consumer theme falls back to a neutral passport theme instead of battery", () => {
    const theme = getConsumerTheme("unknown-product-type", {});

    expect(theme.headline).toBe("Digital Product Passport");
    expect(theme.heroPattern).toBe("passport");
  });

  test("semantic model labels are generated from any model key", () => {
    expect(formatSemanticModelLabel("claros_appliance_dictionary_v3")).toBe("Claros Appliance Dictionary V3");
    expect(formatSemanticModelLabel("genericDppV1")).toBe("Generic DPP V1");
    expect(formatSemanticModelLabel("")).toBe("No semantic model");
  });

  test("semantic options preserve registered and selected external models", () => {
    const options = buildSemanticModelOptions([
      {
        semanticModelKey: "claros_appliance_dictionary_v3",
        name: "Claros Appliance Dictionary",
        family: "appliance",
        version: "v3",
      },
    ], "external_future_dictionary_v3");

    expect(getSemanticModelOption(options, "claros_appliance_dictionary_v3")).toMatchObject({
      key: "claros_appliance_dictionary_v3",
      label: "Claros Appliance Dictionary",
      registered: true,
    });
    expect(getSemanticModelOption(options, "external_future_dictionary_v3")).toMatchObject({
      key: "external_future_dictionary_v3",
      registered: false,
    });
  });

  test("passport lists prefer product-neutral serial fields before battery aliases", () => {
    expect(getPassportSerialNumber({
      batterySerialNumber: "BAT-001",
      serialNumber: "SER-001",
      productSerialNumber: "PROD-001",
    })).toBe("PROD-001");
  });

  test("semantic JSON-LD export includes the selected non-battery model context", () => {
    const exported = buildPassportJsonLdExport([
      {
        dppId: "dpp-appliance-001",
        passportType: "appliancePassportV3",
        energyRating: "A",
      },
    ], "appliancePassportV3", {
      semanticModel: {
        semanticModelKey: "claros_appliance_dictionary_v3",
        contextUrl: "https://www.claros-dpp.online/dictionary/appliance/v3/context.jsonld",
        family: "appliance",
        version: "v3",
      },
    });

    expect(exported["@context"]).toContain("https://www.claros-dpp.online/dictionary/appliance/v3/context.jsonld");
    expect(exported.semanticModel).toMatchObject({
      semanticModelKey: "claros_appliance_dictionary_v3",
      family: "appliance",
      version: "v3",
    });
    expect(exported["@graph"][0]).toMatchObject({
      passportType: "appliancePassportV3",
      energyRating: "A",
    });
  });

  test("product category options merge saved and module-derived categories", () => {
    const options = buildProductCategoryOptions({
      savedCategories: [{ id: 7, name: "Appliance", icon: "AP" }],
      passportTypes: [
        { productCategory: "Appliance", productIcon: "SHOULD_NOT_OVERRIDE" },
        { productCategory: "Medical Device", productIcon: "MD" },
      ],
      draftType: { productCategory: "Construction Product", productIcon: "CP" },
    });

    expect(options.map((option) => option.name)).toEqual([
      "Appliance",
      "Construction Product",
      "Medical Device",
    ]);
    expect(options.find((option) => option.name === "Appliance")).toMatchObject({
      id: 7,
      icon: "AP",
      managed: true,
    });
    expect(options.find((option) => option.name === "Medical Device")).toMatchObject({
      icon: "MD",
      managed: false,
    });
  });
});
