"use strict";

const APPLIANCE_SEMANTIC_BASE = "https://www.claros-dpp.online/dictionary/appliance/v1/terms";

const publicFieldDefaults = {
  access: ["public"],
  confidentiality: "public",
  updateAuthority: ["economic_operator"],
};

const restrictedFieldDefaults = {
  access: ["economic_operator", "manufacturer", "market_surveillance", "notified_bodies"],
  confidentiality: "restricted",
  updateAuthority: ["economic_operator", "manufacturer"],
};

function term(slug) {
  return `${APPLIANCE_SEMANTIC_BASE}/${slug}`;
}

function field({
  key,
  label,
  semanticSlug,
  type = "text",
  access = publicFieldDefaults,
  unit = "",
  dataType = "string",
}) {
  return {
    ...access,
    key,
    label,
    type,
    semanticId: term(semanticSlug),
    unit,
    dataType,
  };
}

module.exports = {
  moduleKey: "appliance:v1",
  typeName: "appliancePassportV1",
  displayName: "Appliance Passport v1",
  productCategory: "Appliance",
  productIcon: "AP",
  semanticModelKey: "claros_appliance_dictionary_v1",
  complianceProfile: {
    key: "applianceDppV1",
    displayName: "Appliance DPP Profile v1",
    contentSpecificationIds: ["claros_appliance_dictionary_v1"],
    requiredPassportFields: ["complianceProfileKey", "contentSpecificationIds"],
    requireCompanyOperatorIdentifier: true,
    requireCarrierPolicy: false,
    requireFacilityAtGranularities: [],
    defaultCarrierPolicyKey: "web_public_entry_v1",
    enforceSemanticMapping: true,
    requirePublicAccessLayer: true,
    categoryPolicy: {
      kind: "semanticCategory",
      productKind: "appliance",
      label: "appliance category",
      fieldKey: "applianceCategory",
      supportedCategories: ["Major Appliance", "Small Appliance", "HVAC", "Consumer Electronics"],
      aliases: {
        major: "Major Appliance",
        major_appliance: "Major Appliance",
        small: "Small Appliance",
        small_appliance: "Small Appliance",
        hvac: "HVAC",
        electronics: "Consumer Electronics",
        consumer_electronics: "Consumer Electronics",
      },
    },
    managedSemanticFieldKeys: [],
  },
  schemaVersion: 1,
  lifecycle: {
    source: "code",
    stability: "versioned",
    changePolicy: "Breaking schema or semantic changes require a new module and typeName.",
  },
  sections: [
    {
      key: "applianceIdentity",
      label: "Appliance Identity",
      fields: [
        field({
          key: "productModelIdentifier",
          label: "Product Model Identifier",
          semanticSlug: "product-model-identifier",
        }),
        field({
          key: "applianceCategory",
          label: "Appliance Category",
          semanticSlug: "appliance-category",
        }),
        field({
          key: "manufacturerName",
          label: "Manufacturer Name",
          semanticSlug: "manufacturer-name",
        }),
      ],
    },
    {
      key: "performanceAndRepair",
      label: "Performance And Repair",
      fields: [
        field({
          key: "energyRating",
          label: "Energy Rating",
          semanticSlug: "energy-rating",
        }),
        field({
          key: "powerConsumption",
          label: "Power Consumption",
          semanticSlug: "power-consumption",
          unit: "kWh/year",
          dataType: "number",
        }),
        field({
          key: "repairabilityScore",
          label: "Repairability Score",
          semanticSlug: "repairability-score",
          unit: "1-10",
          dataType: "number",
        }),
      ],
    },
    {
      key: "complianceAndService",
      label: "Compliance And Service",
      fields: [
        field({
          key: "sparePartsAvailability",
          label: "Spare Parts Availability",
          semanticSlug: "spare-parts-availability",
          type: "textarea",
        }),
        field({
          key: "complianceDeclaration",
          label: "Compliance Declaration",
          semanticSlug: "compliance-declaration",
          type: "textarea",
          access: restrictedFieldDefaults,
        }),
      ],
    },
  ],
};
