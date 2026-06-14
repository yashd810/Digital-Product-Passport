"use strict";

const TEXTILE_SEMANTIC_BASE = "https://www.claros-dpp.online/dictionary/textile/v1/terms";

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
  return `${TEXTILE_SEMANTIC_BASE}/${slug}`;
}

function valueDataTypeFor({ type, dataType }) {
  if (type === "file") return "Binary";
  if (type === "url") return "URI";
  if (dataType === "integer") return "Integer";
  if (dataType === "number" || dataType === "decimal") return "Decimal";
  if (dataType === "boolean" || type === "checkbox") return "Boolean";
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
  mediaRole = null,
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
    mediaRole,
  };
}

module.exports = {
  moduleKey: "textile:v1",
  typeName: "textilePassportV1",
  displayName: "Textile Passport v1",
  productCategory: "Textile",
  productIcon: "TX",
  semanticModelKey: "claros_textile_dictionary_v1",
  identity: {
    businessIdentifierField: "productModelIdentifier",
  },
  complianceProfile: {
    key: "textileDppV1",
    displayName: "Textile DPP Profile v1",
    contentSpecificationIds: ["claros_textile_dictionary_v1"],
    requiredPassportFields: ["complianceProfileKey", "contentSpecificationIds"],
    requireCompanyOperatorIdentifier: true,
    requireCarrierPolicy: false,
    requireFacilityAtGranularities: [],
    defaultCarrierPolicyKey: "web_public_entry_v1",
    enforceSemanticMapping: true,
    requirePublicAccessLayer: true,
    managedSemanticFields: [],
  },
  schemaVersion: 1,
  lifecycle: {
    source: "code",
    stability: "versioned",
    changePolicy: "Breaking schema or semantic changes require a new module and typeName.",
  },
  sections: [
    {
      key: "textileIdentity",
      label: "Textile Identity",
      fields: [
        field({
          key: "productModelIdentifier",
          label: "Product Model Identifier",
          semanticSlug: "product-model-identifier",
        }),
        field({
          key: "countryOfOrigin",
          label: "Country of Origin",
          semanticSlug: "country-of-origin",
        }),
      ],
    },
    {
      key: "materialComposition",
      label: "Material Composition",
      fields: [
        field({
          key: "fiberComposition",
          label: "Fiber Composition",
          semanticSlug: "fiber-composition",
          type: "textarea",
        }),
        field({
          key: "recycledContentPercentage",
          label: "Recycled Content Percentage",
          semanticSlug: "recycled-content-percentage",
          unit: "%",
          dataType: "number",
        }),
        field({
          key: "fabricWeight",
          label: "Fabric Weight",
          semanticSlug: "fabric-weight",
          unit: "g/m2",
          dataType: "number",
        }),
      ],
    },
    {
      key: "careAndCompliance",
      label: "Care and Compliance",
      fields: [
        field({
          key: "careInstructions",
          label: "Care Instructions",
          semanticSlug: "care-instructions",
          type: "textarea",
        }),
        field({
          key: "durabilityScore",
          label: "Durability Score",
          semanticSlug: "durability-score",
          unit: "1-5",
          dataType: "integer",
        }),
        field({
          key: "restrictedSubstancesDisclosure",
          label: "Restricted Substances Disclosure",
          semanticSlug: "restricted-substances-disclosure",
          type: "textarea",
          access: restrictedFieldDefaults,
        }),
      ],
    },
  ],
};
