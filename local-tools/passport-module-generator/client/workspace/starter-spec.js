/**
 * Neutral starter Passport Module specification for the browser workspace.
 * This data-only module lets authors explore every editor surface without
 * mixing example content into the workspace controller's orchestration logic.
 */
"use strict";

const starterSpecification = {
  module: {
    family: "example-product",
    version: "v1",
    moduleKey: "example-product:v1",
    typeName: "exampleProductPassportV1",
    displayName: "Example Product Passport v1",
    productCategory: "Example Product",
    productIcon: "EX",
    semanticModelKey: "exampleProductDictionaryV1",
    passportPolicyKey: "exampleProductDppV1",
    defaultCarrierPolicyKey: "webPublicEntryV1",
    systemHeaderFieldAssignments: {},
    systemHeaderFieldConfirmations: {},
    // The hosted DPP dictionary and public semantic links are rooted here.
    baseUrl: "https://claros-dpp.online",
    dictionaryName: "Example Product Dictionary",
    dictionaryDescription: "Starter dictionary for a new Digital Product Passport module.",
  },
  roles: {
    businessIdentifierField: "modelIdentifier",
    modelNameField: "modelIdentifier",
    summaryRoles: {
      modelIdentifier: "card1",
      performanceScore: "card2",
      productCategoryDetail: "card3",
    },
    lifecycleRoles: {},
    compositionCharts: [],
  },
  sections: [
    {
      key: "productIdentity",
      label: "Product Identity",
      fields: [
        {
          fieldKey: "productCategoryDetail",
          fieldLabel: "Product Category Detail",
          fieldType: "text",
          semanticSlug: "product-category-detail",
          definition: "Classifies the product category used for requirement and reporting policies.",
          dataType: "string",
          unitKey: "none",
          confidentiality: "public",
        },
        {
          fieldKey: "modelIdentifier",
          fieldLabel: "Model Identifier",
          fieldType: "text",
          semanticSlug: "model-identifier",
          definition: "Identifies the product model that the passport describes.",
          dataType: "string",
          unitKey: "none",
          confidentiality: "public",
        },
        {
          fieldKey: "manufacturerName",
          fieldLabel: "Manufacturer Name",
          fieldType: "text",
          semanticSlug: "manufacturer-name",
          definition: "Name of the manufacturer responsible for placing the product on the market.",
          dataType: "string",
          unitKey: "none",
          confidentiality: "public",
        },
      ],
    },
    {
      key: "performanceCharacteristics",
      label: "Performance Characteristics",
      fields: [
        {
          fieldKey: "performanceScore",
          fieldLabel: "Performance Score",
          fieldType: "text",
          semanticSlug: "performance-score",
          definition: "Declared performance score for the product.",
          dataType: "decimal",
          unitKey: "percent",
          unitLabel: "Percent",
          unitSymbol: "%",
          confidentiality: "public",
        },
      ],
    },
  ],
  semanticGraph: {
    rootClass: {
      label: "Example Product Passport",
      key: "exampleProductPassport",
      definition: "Root semantic class for the example product passport.",
    },
    rootProperties: [
      {
        label: "Material Composition",
        key: "materialComposition",
        rangeKind: "class",
        rangeClassKey: "materialComposition",
        relationshipType: "composition",
        minCount: 1,
        maxCount: 1,
      },
    ],
    classes: [
      {
        label: "Material Composition",
        key: "materialComposition",
        definition: "Structured material composition information.",
        properties: [
          {
            label: "Battery Materials",
            key: "batteryMaterials",
            rangeKind: "class",
            rangeClassKey: "batteryMaterial",
            relationshipType: "composition",
            minCount: 1,
            maxCount: null,
          },
          {
            label: "Hazardous Substances",
            key: "hazardousSubstances",
            rangeKind: "class",
            rangeClassKey: "hazardousSubstance",
            relationshipType: "composition",
            minCount: 0,
            maxCount: null,
          },
        ],
      },
      {
        label: "Battery Material",
        key: "batteryMaterial",
        properties: [
          {
            label: "Material Identifier",
            key: "materialIdentifier",
            rangeKind: "scalar",
            dataType: "string",
            minCount: 1,
            maxCount: 1,
          },
          {
            label: "Material Weight",
            key: "materialWeight",
            rangeKind: "scalar",
            dataType: "decimal",
            minCount: 0,
            maxCount: 1,
            unit: "kg",
          },
        ],
      },
      {
        label: "Hazardous Substance",
        key: "hazardousSubstance",
        properties: [
          {
            label: "Hazardous Substance Class",
            key: "hazardousSubstanceClass",
            rangeKind: "enum",
            rangeEnumKey: "hazardousSubstanceClass",
            minCount: 1,
            maxCount: 1,
          },
        ],
      },
    ],
    enums: [
      {
        label: "Hazardous Substance Class",
        key: "hazardousSubstanceClass",
        values: [
          { label: "Acute Toxicity", key: "acuteToxicity" },
          { label: "Skin Corrosion Or Irritation", key: "skinCorrosionOrIrritation" },
        ],
      },
    ],
  },
};

globalThis.PassportModuleWorkspaceSample = starterSpecification;
