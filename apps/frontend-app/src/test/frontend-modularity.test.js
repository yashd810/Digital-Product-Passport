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
  getPassportSerialNumberForType,
} from "../user/dashboard/passports/utils/passportListHelpers";
import { buildPassportJsonLdExport } from "../shared/utils/semanticPassportExport";

describe("frontend modularity helpers", () => {
  test("consumer theme falls back to a neutral passport theme", () => {
    const theme = getConsumerTheme("unknown-product-type", {});

    expect(theme.headline).toBe("Digital Product Passport");
    expect(theme.heroPattern).toBe("passport");
  });

  test("semantic model labels are generated from any model key", () => {
    expect(formatSemanticModelLabel("industrialSensorDictionaryV3")).toBe("Industrial Sensor Dictionary V3");
    expect(formatSemanticModelLabel("medicalDeviceDictionaryV1")).toBe("Medical Device Dictionary V1");
  });

  test("semantic options preserve registered and selected external models", () => {
    const options = buildSemanticModelOptions([
      {
        semanticModelKey: "industrialSensorDictionaryV3",
        name: "Industrial Sensor Dictionary",
        family: "industrial-sensor",
        version: "v3",
      },
    ], "externalFutureDictionaryV3");

    expect(getSemanticModelOption(options, "industrialSensorDictionaryV3")).toMatchObject({
      key: "industrialSensorDictionaryV3",
      label: "Industrial Sensor Dictionary",
      registered: true,
    });
    expect(getSemanticModelOption(options, "externalFutureDictionaryV3")).toMatchObject({
      key: "externalFutureDictionaryV3",
      registered: false,
    });
  });

  test("passport lists use module business identifier from explicit module metadata", () => {
    const typeDefinitions = [{
      typeName: "medicalDevicePassportV1",
      fieldsJson: {
        identity: {
          businessIdentifierField: "udi",
        },
      },
    }];

    expect(getPassportSerialNumberForType({
      passportType: "medicalDevicePassportV1",
      udi: "UDI-001",
      internalAliasId: "SKU-001",
      uniqueProductIdentifier: "did:web:example:product:001",
    }, typeDefinitions)).toBe("UDI-001");

    expect(getPassportSerialNumberForType({
      passportType: "manualPassportV1",
      internalAliasId: "SKU-001",
      uniqueProductIdentifier: "did:web:example:product:001",
    }, typeDefinitions)).toBe("");
  });

  test("semantic JSON-LD export includes the selected model context", () => {
    const exported = buildPassportJsonLdExport([
      {
        dppId: "dpp-sensor-001",
        passportType: "industrialSensorPassportV3",
        serialNumber: "SN-001",
      },
    ], "industrialSensorPassportV3", {
      semanticModel: {
        semanticModelKey: "industrialSensorDictionaryV3",
        contextUrl: "https://www.claros-dpp.online/dictionary/industrial-sensor/v3/context.jsonld",
        family: "industrial-sensor",
        version: "v3",
      },
    });

    expect(exported["@context"]).toContain("https://www.claros-dpp.online/dictionary/industrial-sensor/v3/context.jsonld");
    expect(exported.semanticModel).toMatchObject({
      semanticModelKey: "industrialSensorDictionaryV3",
      family: "industrial-sensor",
      version: "v3",
    });
    expect(exported["@graph"][0]).toMatchObject({
      passportType: "industrialSensorPassportV3",
      serialNumber: "SN-001",
    });
  });

  test("product category options merge saved and module-derived categories", () => {
    const options = buildProductCategoryOptions({
      savedCategories: [{ id: 7, name: "Industrial Sensor", icon: "IS" }],
      passportTypes: [
        { productCategory: "Industrial Sensor", productIcon: "SHOULD_NOT_OVERRIDE" },
        { productCategory: "Medical Device", productIcon: "MD" },
      ],
      draftType: { productCategory: "Construction Product", productIcon: "CP" },
    });

    expect(options.map((option) => option.name)).toEqual([
      "Construction Product",
      "Industrial Sensor",
      "Medical Device",
    ]);
    expect(options.find((option) => option.name === "Industrial Sensor")).toMatchObject({
      id: 7,
      icon: "IS",
      managed: true,
    });
    expect(options.find((option) => option.name === "Medical Device")).toMatchObject({
      icon: "MD",
      managed: false,
    });
  });
});
