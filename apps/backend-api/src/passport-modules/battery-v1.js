"use strict";

const BATTERY_SEMANTIC_BASE = "https://www.claros-dpp.online/dictionary/battery/v1/terms";

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
  return `${BATTERY_SEMANTIC_BASE}/${slug}`;
}

function valueDataTypeFor(dataType) {
  if (dataType === "integer") return "Integer";
  if (dataType === "number" || dataType === "decimal") return "Decimal";
  if (dataType === "boolean") return "Boolean";
  if (dataType === "date") return "Date";
  if (dataType === "datetime") return "DateTime";
  if (dataType === "uri" || dataType === "url") return "URI";
  return "String";
}

function textField({
  key,
  label,
  semanticSlug,
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
    type: "text",
    semanticId: term(semanticSlug),
    unit,
    dataType,
    elementIdPath: key,
    objectType: "SingleValuedDataElement",
    valueDataType: valueDataTypeFor(dataType),
    displayRole,
    presentation,
    summaryRole,
    lifecycleRole,
  };
}

module.exports = {
  moduleKey: "battery:v1",
  typeName: "batteryPassportV1",
  displayName: "Battery Passport v1",
  productCategory: "Battery",
  productIcon: "🔋",
  semanticModelKey: "battery_dictionary_v1",
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
    businessIdentifierField: "batterySerialNumber",
  },
  passportPolicy: {
    key: "batteryDppV1",
    displayName: "Battery Passport Policy v1",
    contentSpecificationIds: ["Battery_dictionary_v1"],
    defaultCarrierPolicyKey: "battery_qr_public_entry_v1",
  },
  schemaVersion: 1,
  lifecycle: {
    source: "code",
    stability: "versioned",
    changePolicy: "Breaking schema or semantic changes require a new module and typeName.",
  },
  sections: [
    {
      key: "batteryIdentity",
      label: "Battery Identity",
      fields: [
        textField({
          key: "batteryModelIdentifier",
          label: "Battery Model Identifier",
          semanticSlug: "battery-model-identifier",
        }),
        textField({
          key: "batterySerialNumber",
          label: "Battery Serial Number",
          semanticSlug: "battery-serial-number",
          access: restrictedFieldDefaults,
        }),
        textField({
          key: "batteryCategory",
          label: "Battery Category",
          semanticSlug: "battery-category",
        }),
        textField({
          key: "manufacturerInformation",
          label: "Manufacturer Information",
          semanticSlug: "manufacturer-info",
        }),
      ],
    },
    {
      key: "technicalCharacteristics",
      label: "Technical Characteristics",
      fields: [
        textField({
          key: "batteryChemistry",
          label: "Battery Chemistry",
          semanticSlug: "battery-chemistry",
        }),
        textField({
          key: "batteryMass",
          label: "Battery Mass",
          semanticSlug: "battery-mass",
          unit: "kg",
          dataType: "number",
        }),
        textField({
          key: "ratedCapacity",
          label: "Rated Capacity",
          semanticSlug: "rated-capacity",
          unit: "Ah",
          dataType: "integer",
        }),
      ],
    },
    {
      key: "lifecycleAndCarbon",
      label: "Lifecycle and Carbon",
      fields: [
        textField({
          key: "manufacturingDate",
          label: "Manufacturing Date",
          semanticSlug: "manufacturing-date",
          dataType: "date",
        }),
        textField({
          key: "carbonFootprintLabel",
          label: "Carbon Footprint Label",
          semanticSlug: "carbon-footprint-label",
        }),
      ],
    },
  ],
};
