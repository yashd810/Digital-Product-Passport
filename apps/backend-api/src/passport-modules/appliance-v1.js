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

function valueDataTypeFor({ type, dataType }) {
  if (type === "file") return "Binary";
  if (type === "url") return "URI";
  if (dataType === "integer") return "Integer";
  if (dataType === "number" || dataType === "decimal") return "Decimal";
  if (dataType === "boolean" || type === "boolean") return "Boolean";
  if (dataType === "date" || type === "date") return "Date";
  if (dataType === "datetime") return "DateTime";
  return "String";
}

function field({
  key,
  label,
  semanticSlug,
  type = "text",
  access = publicFieldDefaults,
  unit = "",
  dataType = "string",
  displayRole = "detail",
  presentation = "data",
  summaryRole = null,
  lifecycleRole = null,
}) {
  return {
    ...access,
    key,
    label,
    type,
    semanticId: term(semanticSlug),
    unit,
    dataType,
    elementIdPath: key,
    objectType: type === "file" || type === "url" ? "RelatedResource" : "SingleValuedDataElement",
    valueDataType: valueDataTypeFor({ type, dataType }),
    displayRole,
    presentation,
    summaryRole,
    lifecycleRole,
  };
}

module.exports = {
  moduleKey: "appliance:v1",
  typeName: "appliancePassportV1",
  displayName: "Appliance Passport v1",
  productCategory: "Appliance",
  productIcon: "AP",
  semanticModelKey: "appliance_dictionary_v1",
  systemHeader: {
    section: { key: "passportHeader", label: "Passport Header" },
    fieldMappings: [
      { slotKey: "digitalProductPassportId", sourceType: "managed", managedKey: "internalManagedDigitalProductPassportId" },
      { slotKey: "uniqueProductIdentifier", sourceType: "managed", managedKey: "internalManagedUniqueProductIdentifier" },
      { slotKey: "internalAliasId", sourceType: "managed", managedKey: "internalManagedInternalAliasId" },
      { slotKey: "granularity", sourceType: "managed", managedKey: "internalManagedGranularity" },
      { slotKey: "dppSchemaVersion", sourceType: "managed", managedKey: "internalManagedDppSchemaVersion" },
      { slotKey: "dppStatus", sourceType: "managed", managedKey: "internalManagedDppStatus" },
      { slotKey: "lastUpdate", sourceType: "managed", managedKey: "internalManagedLastUpdate" },
      { slotKey: "economicOperatorId", sourceType: "managed", managedKey: "internalManagedEconomicOperatorId" },
      { slotKey: "facilityId", sourceType: "managed", managedKey: "internalManagedFacilityId" },
      { slotKey: "contentSpecificationIds", sourceType: "managed", managedKey: "internalManagedContentSpecificationIds" },
      { slotKey: "subjectDid", sourceType: "managed", managedKey: "internalManagedSubjectDid" },
      { slotKey: "dppDid", sourceType: "managed", managedKey: "internalManagedDppDid" },
      { slotKey: "companyDid", sourceType: "managed", managedKey: "internalManagedCompanyDid" },
    ],
    fieldKeys: [],
  },
  identity: {
    businessIdentifierField: "productModelIdentifier",
  },
  passportPolicy: {
    key: "applianceDppV1",
    displayName: "Appliance Passport Policy v1",
    contentSpecificationIds: ["Appliance_dictionary_v1"],
    defaultCarrierPolicyKey: "web_public_entry_v1",
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
