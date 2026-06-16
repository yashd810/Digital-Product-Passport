"use strict";

const ELECTRONICS_V1_SEMANTIC_BASE = "https://www.claros-dpp.online/dictionary/electronics/v1/terms";

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
  return `${ELECTRONICS_V1_SEMANTIC_BASE}/${slug}`;
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
  accessLevel = "public",
  unit = "",
  dataType = "string",
  queryable = false,
  indexed = false,
  storageType = "",
  displayRole = "detail",
  presentation = "data",
  summaryRole = null,
  lifecycleRole = null,
}) {
  const access = accessLevel === "restricted" ? restrictedFieldDefaults : publicFieldDefaults;
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
    ...(queryable ? { queryable: true } : {}),
    ...(indexed ? { indexed: true } : {}),
    ...(storageType ? { storageType } : {}),
  };
}

module.exports = {
  moduleKey: "electronics:v1",
  typeName: "electronicsPassportV1",
  displayName: "Electronics Passport v1",
  productCategory: "Electronics",
  productIcon: "EL",
  semanticModelKey: "electronics_dictionary_v1",
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
    key: "electronicsDppV1",
    displayName: "Electronics Passport Policy v1",
    contentSpecificationIds: ["Electronics_dictionary_v1"],
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
      key: "electronicsIdentity",
      label: "Electronics Identity",
      fields: [
        field({
          "key": "electronicsCategory",
          "label": "Electronics Category",
          "semanticSlug": "electronics-category",
          "displayRole": "hero",
          "summaryRole": "card3",
          "presentation": "data",
        }),
        field({
          "key": "productModelIdentifier",
          "label": "Product Model Identifier",
          "semanticSlug": "product-model-identifier",
          "displayRole": "hero",
          "summaryRole": "card1",
          "presentation": "data",
        }),
        field({
          "key": "manufacturerName",
          "label": "Manufacturer Name",
          "semanticSlug": "manufacturer-name",
          "presentation": "data",
        })
      ],
    },
    {
      key: "technicalCharacteristics",
      label: "Technical Characteristics",
      fields: [
        field({
          "key": "ratedPower",
          "label": "Rated Power",
          "semanticSlug": "rated-power",
          "unit": "W",
          "dataType": "number",
          "displayRole": "hero",
          "summaryRole": "card2",
          "presentation": "data",
        })
      ],
    }
  ],
};
