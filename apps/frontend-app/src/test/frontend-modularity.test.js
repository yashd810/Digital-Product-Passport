import { describe, expect, test } from "vitest";

import { getConsumerTheme } from "../app/providers/ThemeContext";
import {
  buildProductCategoryOptions,
} from "../admin/passport-types/builderHelpers";
import {
  buildSemanticModelOptions,
  deriveSemanticTermDataType,
  formatSemanticModelLabel,
  getSemanticModelOption,
} from "../admin/passport-types/semanticTermCatalog";
import {
  getPassportSerialNumberForType,
} from "../user/dashboard/passports/utils/passportListHelpers";
import { buildPassportJsonLdExport } from "../shared/utils/semanticPassportExport";
import {
  buildInactivePassportPath,
  buildPreviewPassportPath,
  buildPublicPassportPath,
} from "../passports/utils/passportRoutes";

describe("frontend modularity helpers", () => {
  test("consumer theme falls back to a neutral passport theme", () => {
    const theme = getConsumerTheme("unknown-product-type", {});

    expect(theme.headline).toBe("Digital Product Passport");
    expect(theme.heroPattern).toBe("passport");
  });

  test("semantic model labels are generated from any model key", () => {
    expect(formatSemanticModelLabel("equipmentDictionaryV3")).toBe("Equipment Dictionary V3");
    expect(formatSemanticModelLabel("serviceAssetDictionaryV1")).toBe("Service Asset Dictionary V1");
  });

  test("semantic options preserve registered and selected external models", () => {
    const options = buildSemanticModelOptions([
      {
        semanticModelKey: "equipmentDictionaryV3",
        name: "Equipment Dictionary",
        family: "equipment",
        version: "v3",
      },
    ], "externalFutureDictionaryV3");

    expect(getSemanticModelOption(options, "equipmentDictionaryV3")).toMatchObject({
      key: "equipmentDictionaryV3",
      label: "Equipment Dictionary",
      registered: true,
    });
    expect(getSemanticModelOption(options, "externalFutureDictionaryV3")).toMatchObject({
      key: "externalFutureDictionaryV3",
      registered: false,
    });
  });

  test("semantic terms preserve canonical decimal and array data types", () => {
    expect(deriveSemanticTermDataType({
      dataType: { format: "Decimal", jsonType: "decimal", xsdType: "xsd:decimal" },
    })).toBe("decimal");
    expect(deriveSemanticTermDataType({
      dataType: { format: "Array", jsonType: "array", items: { jsonType: "object" } },
    })).toBe("array");
  });

  test("passport lists use module business identifier from explicit module metadata", () => {
    const typeDefinitions = [{
      typeName: "equipmentPassportV1",
      fieldsJson: {
        identity: {
          businessIdentifierField: "serialNumber",
        },
      },
    }];

    expect(getPassportSerialNumberForType({
      passportType: "equipmentPassportV1",
      serialNumber: "SN-001",
      internalAliasId: "SKU-001",
      uniqueProductIdentifier: "did:web:example:product:001",
    }, typeDefinitions)).toBe("SN-001");

    expect(getPassportSerialNumberForType({
      passportType: "manualPassportV1",
      internalAliasId: "SKU-001",
      uniqueProductIdentifier: "did:web:example:product:001",
    }, typeDefinitions)).toBe("");
  });

  test("public and preview routes require DPP IDs and never fall back to internal aliases", () => {
    expect(buildPublicPassportPath({
      companyName: "Example Company",
      modelName: "Model One",
      dppId: "dppId-public-1",
      internalAliasId: "PRIVATE-SKU",
    })).toBe("/dpp/example-company/model-one/dppId-public-1");

    expect(buildPublicPassportPath({
      companyName: "Example Company",
      internalAliasId: "PRIVATE-SKU",
    })).toBeNull();

    expect(buildInactivePassportPath({
      companyName: "Example Company",
      dppId: "dppId-public-1",
      versionNumber: 2,
    })).toBe("/dpp/inactive/example-company/dppid-public-1/dppId-public-1/2");

    expect(buildPreviewPassportPath({
      companyName: "Example Company",
      previewId: "dppId-preview-1",
      internalAliasId: "PRIVATE-SKU",
    })).toBe("/dpp/preview/example-company/dppid-preview-1/dppId-preview-1");
  });

  test("semantic JSON-LD export includes model context and typed array rows", () => {
    const exported = buildPassportJsonLdExport([
      {
        dppId: "dpp-sensor-001",
        passportType: "equipmentPassportV3",
        serialNumber: "SN-001",
        materialComposition: [{ materialName: "Steel", percentage: "62.5" }],
      },
    ], "equipmentPassportV3", {
      semanticModel: {
        semanticModelKey: "equipmentDictionaryV3",
        contextUrl: "https://www.claros-dpp.online/dictionary/equipment/v3/context.jsonld",
        family: "equipment",
        version: "v3",
      },
      typeDef: {
        fieldsJson: {
          sections: [{
            fields: [{
              key: "materialComposition",
              type: "table",
              dataType: "array",
              objectType: "DataElementCollection",
              valueDataType: "Array",
              semanticId: "https://example.test/terms/material-composition",
              tableColumns: [
                {
                  key: "materialName",
                  dataType: "string",
                  objectType: "SingleValuedDataElement",
                  valueDataType: "String",
                },
                {
                  key: "percentage",
                  dataType: "decimal",
                  objectType: "SingleValuedDataElement",
                  valueDataType: "Decimal",
                },
              ],
            }],
          }],
        },
      },
    });

    expect(exported["@context"]).toContain("https://www.claros-dpp.online/dictionary/equipment/v3/context.jsonld");
    expect(exported.semanticModel).toMatchObject({
      semanticModelKey: "equipmentDictionaryV3",
      family: "equipment",
      version: "v3",
    });
    expect(exported["@graph"][0]).toMatchObject({
      passportType: "equipmentPassportV3",
      serialNumber: "SN-001",
      materialComposition: [{ materialName: "Steel", percentage: 62.5 }],
    });
    expect(exported["@context"]).toContainEqual({
      materialComposition: {
        "@id": "https://example.test/terms/material-composition",
        "@container": "@set",
      },
    });
  });

  test("product category options merge saved and module-derived categories", () => {
    const options = buildProductCategoryOptions({
      savedCategories: [{ id: 7, name: "Equipment", icon: "EQ" }],
      passportTypes: [
        { productCategory: "Equipment", productIcon: "shouldNotOverride" },
        { productCategory: "Service Asset", productIcon: "SA" },
      ],
      draftType: { productCategory: "Construction Product", productIcon: "CP" },
    });

    expect(options.map((option) => option.name)).toEqual([
      "Construction Product",
      "Equipment",
      "Service Asset",
    ]);
    expect(options.find((option) => option.name === "Equipment")).toMatchObject({
      id: 7,
      icon: "EQ",
      managed: true,
    });
    expect(options.find((option) => option.name === "Service Asset")).toMatchObject({
      icon: "SA",
      managed: false,
    });
  });
});
