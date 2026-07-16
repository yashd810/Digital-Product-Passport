"use strict";

const {
  flattenSchemaFieldsFromSections,
} = require("../shared/passports/passport-helpers");

const defaultSystemPassportHeaderSection = {
  key: "passportHeader",
  label: "Passport Header",
};

const systemHeaderManagedDefinitions = [
  { slotKey: "digitalProductPassportId", label: "Digital Product Passport ID", semanticId: "dpp:digitalProductPassportId", managedKey: "internalManagedDigitalProductPassportId", required: true },
  { slotKey: "uniqueProductIdentifier", label: "Unique Product Identifier", semanticId: "dpp:uniqueProductIdentifier", managedKey: "internalManagedUniqueProductIdentifier", required: true },
  { slotKey: "internalAliasId", label: "Internal Alias ID", semanticId: "dpp:internalAliasId", managedKey: "internalManagedInternalAliasId", required: true },
  { slotKey: "granularity", label: "Granularity", semanticId: "dpp:granularity", managedKey: "internalManagedGranularity", required: true },
  { slotKey: "dppSchemaVersion", label: "DPP Schema Version", semanticId: "dpp:dppSchemaVersion", managedKey: "internalManagedDppSchemaVersion", required: true },
  { slotKey: "dppStatus", label: "DPP Status", semanticId: "dpp:dppStatus", managedKey: "internalManagedDppStatus", required: true },
  { slotKey: "lastUpdate", label: "Last Update", semanticId: "dpp:lastUpdate", managedKey: "internalManagedLastUpdate", required: true },
  { slotKey: "economicOperatorId", label: "Economic Operator ID", semanticId: "dpp:economicOperatorId", managedKey: "internalManagedEconomicOperatorId", required: true },
  { slotKey: "facilityId", label: "Facility ID", semanticId: "dpp:facilityId", managedKey: "internalManagedFacilityId", required: false },
  { slotKey: "contentSpecificationIds", label: "Content Specification IDs", semanticId: "dpp:contentSpecificationIds", managedKey: "internalManagedContentSpecificationIds", required: true },
  { slotKey: "subjectDid", label: "Subject DID", semanticId: "dpp:subjectDid", managedKey: "internalManagedSubjectDid", required: true },
  { slotKey: "dppDid", label: "DPP DID", semanticId: "dpp:dppDid", managedKey: "internalManagedDppDid", required: true },
  { slotKey: "companyDid", label: "Company DID", semanticId: "dpp:companyDid", managedKey: "internalManagedCompanyDid", required: true },
];

const systemHeaderManagedKeySet = new Set(
  systemHeaderManagedDefinitions.map((definition) => definition.managedKey)
);

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeFieldMappings(input = {}) {
  if (!Array.isArray(input?.fieldMappings)) return [];
  return input.fieldMappings
    .map((mapping) => ({
      slotKey: cleanText(mapping?.slotKey),
      sourceType: cleanText(mapping?.sourceType || (mapping?.managedKey ? "managed" : "field")).toLowerCase(),
      label: cleanText(mapping?.label),
      fieldKey: cleanText(mapping?.fieldKey),
      managedKey: cleanText(mapping?.managedKey),
    }))
    .filter((mapping) => {
      if (mapping.sourceType === "managed") return Boolean(mapping.managedKey);
      return Boolean(mapping.fieldKey);
    });
}

function normalizeFieldKeys(input = {}) {
  const fieldMappings = normalizeFieldMappings(input);
  if (fieldMappings.length) {
    return fieldMappings
      .map((mapping) => mapping.sourceType === "field" ? mapping.fieldKey : "")
      .filter(Boolean);
  }
  if (Array.isArray(input?.fieldKeys)) {
    return input.fieldKeys.map(cleanText).filter(Boolean);
  }
  if (Array.isArray(input?.fields)) {
    return input.fields.map((field) => cleanText(field?.key)).filter(Boolean);
  }
  return [];
}

function uniqueFieldKeys(fieldKeys = []) {
  const seen = new Set();
  const ordered = [];
  for (const key of fieldKeys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  return ordered;
}

function normalizeSystemPassportHeader(input = {}) {
  const inputSection = input?.section || {};
  const fieldMappings = normalizeFieldMappings(input);
  return {
    section: {
      key: defaultSystemPassportHeaderSection.key,
      label: cleanText(inputSection.label) || defaultSystemPassportHeaderSection.label,
    },
    fieldMappings,
    fieldKeys: uniqueFieldKeys(normalizeFieldKeys(input)),
  };
}

function validateSystemPassportHeader(input = {}, sections = []) {
  const normalized = normalizeSystemPassportHeader(input);
  const knownFieldKeys = new Set(
    flattenSchemaFieldsFromSections(Array.isArray(sections) ? sections : [])
      .map((field) => cleanText(field?.key))
      .filter(Boolean)
  );

  const unknownKeys = normalized.fieldKeys.filter((key) => !knownFieldKeys.has(key));
  if (unknownKeys.length) {
    return {
      valid: false,
      error: `Passport header fields must reference existing schema field keys. Unknown keys: ${unknownKeys.join(", ")}.`,
      unknownKeys,
    };
  }

  const unknownManagedKeys = normalized.fieldMappings
    .filter((mapping) => mapping.sourceType === "managed")
    .map((mapping) => mapping.managedKey)
    .filter((managedKey) => !systemHeaderManagedKeySet.has(managedKey));
  if (unknownManagedKeys.length) {
    return {
      valid: false,
      error: `Passport header mappings contain unknown managed keys: ${unknownManagedKeys.join(", ")}.`,
      unknownManagedKeys,
    };
  }

  return { valid: true };
}

function getSystemPassportHeader(typeDef = {}) {
  return normalizeSystemPassportHeader(typeDef?.fieldsJson?.systemHeader || typeDef?.systemHeader);
}

module.exports = {
  defaultSystemPassportHeaderSection,
  systemHeaderManagedDefinitions,
  normalizeSystemPassportHeader,
  validateSystemPassportHeader,
  getSystemPassportHeader,
};
