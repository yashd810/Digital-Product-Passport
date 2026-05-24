"use strict";

const DEFAULT_SYSTEM_PASSPORT_HEADER_SECTION = {
  key: "passport_header",
  label: "Passport Header",
};

const DEFAULT_SYSTEM_PASSPORT_HEADER_FIELDS = [
  {
    key: "digitalProductPassportId",
    label: "Digital Product Passport ID",
    semanticId: "dpp:digitalProductPassportId",
    valueSource: "system",
    ownership: "system_generated",
    required: true,
    locked: true,
  },
  {
    key: "uniqueProductIdentifier",
    label: "Unique Product Identifier",
    semanticId: "dpp:uniqueProductIdentifier",
    valueSource: "system",
    ownership: "system_generated",
    required: true,
    locked: true,
  },
  {
    key: "internalAliasId",
    label: "Internal Alias ID",
    semanticId: "dpp:internalAliasId",
    valueSource: "system",
    ownership: "passport_author_editable",
    required: true,
    locked: true,
  },
  {
    key: "granularity",
    label: "Granularity",
    semanticId: "dpp:granularity",
    valueSource: "company_policy",
    ownership: "company_managed",
    required: true,
    locked: true,
  },
  {
    key: "dppSchemaVersion",
    label: "DPP Schema Version",
    semanticId: "dpp:dppSchemaVersion",
    valueSource: "passport_type",
    ownership: "company_managed",
    required: true,
    locked: true,
  },
  {
    key: "dppStatus",
    label: "DPP Status",
    semanticId: "dpp:dppStatus",
    valueSource: "system",
    ownership: "system_generated",
    required: true,
    locked: true,
  },
  {
    key: "lastUpdate",
    label: "Last Update",
    semanticId: "dpp:lastUpdate",
    valueSource: "system",
    ownership: "system_generated",
    required: true,
    locked: true,
  },
  {
    key: "economicOperatorId",
    label: "Economic Operator ID",
    semanticId: "dpp:economicOperatorId",
    valueSource: "company_identity",
    ownership: "company_managed",
    required: true,
    locked: true,
  },
  {
    key: "facilityId",
    label: "Facility ID",
    semanticId: "dpp:facilityId",
    valueSource: "company_or_passport",
    ownership: "passport_author_editable",
    required: false,
    locked: true,
  },
  {
    key: "contentSpecificationIds",
    label: "Content Specification IDs",
    semanticId: "dpp:contentSpecificationIds",
    valueSource: "passport_type",
    ownership: "company_managed",
    required: true,
    locked: true,
  },
  {
    key: "subjectDid",
    label: "Subject DID",
    semanticId: "dpp:subjectDid",
    valueSource: "system",
    ownership: "system_generated",
    required: true,
    locked: true,
  },
  {
    key: "dppDid",
    label: "DPP DID",
    semanticId: "dpp:dppDid",
    valueSource: "system",
    ownership: "system_generated",
    required: true,
    locked: true,
  },
  {
    key: "companyDid",
    label: "Company DID",
    semanticId: "dpp:companyDid",
    valueSource: "system",
    ownership: "system_generated",
    required: true,
    locked: true,
  },
];

const DEFAULT_SYSTEM_PASSPORT_HEADER_BY_KEY = new Map(
  DEFAULT_SYSTEM_PASSPORT_HEADER_FIELDS.map((field) => [field.key, field])
);

function cleanLabel(value, fallback) {
  const label = String(value || "").trim();
  return label || fallback;
}

function normalizeSystemPassportHeader(input = {}) {
  const inputSection = input?.section || {};
  const inputFields = Array.isArray(input?.fields) ? input.fields : [];
  const inputByKey = new Map(inputFields.map((field) => [field?.key, field]));

  return {
    section: {
      key: DEFAULT_SYSTEM_PASSPORT_HEADER_SECTION.key,
      label: cleanLabel(inputSection.label, DEFAULT_SYSTEM_PASSPORT_HEADER_SECTION.label),
    },
    fields: DEFAULT_SYSTEM_PASSPORT_HEADER_FIELDS.map((field) => {
      const override = inputByKey.get(field.key) || {};
      const label_i18n = Object.fromEntries(
        Object.entries(override.label_i18n || {}).filter(([, value]) => String(value || "").trim())
      );
      return {
        ...field,
        label: cleanLabel(override.label, field.label),
        ...(Object.keys(label_i18n).length ? { label_i18n } : {}),
      };
    }),
  };
}

function getSystemPassportHeader(typeDef = {}) {
  return normalizeSystemPassportHeader(typeDef?.fieldsJson?.systemHeader);
}

function validateSystemPassportHeader(input = {}) {
  const fields = Array.isArray(input?.fields) ? input.fields : [];
  const fieldKeys = fields.map((field) => field?.key).filter(Boolean);
  const unknownKeys = fieldKeys.filter((key) => !DEFAULT_SYSTEM_PASSPORT_HEADER_BY_KEY.has(key));
  const missingKeys = DEFAULT_SYSTEM_PASSPORT_HEADER_FIELDS
    .map((field) => field.key)
    .filter((key) => !fieldKeys.includes(key));

  if (unknownKeys.length || missingKeys.length) {
    return {
      valid: false,
      error: "Passport header fields are system managed. Required header keys cannot be removed, renamed, or extended.",
      unknownKeys,
      missingKeys,
    };
  }

  for (const field of fields) {
    const expected = DEFAULT_SYSTEM_PASSPORT_HEADER_BY_KEY.get(field.key);
    if (!expected) continue;
    if (field.semanticId && field.semanticId !== expected.semanticId) {
      return {
        valid: false,
        error: `Passport header field "${field.key}" must keep semanticId "${expected.semanticId}".`,
      };
    }
    if (field.valueSource && field.valueSource !== expected.valueSource) {
      return {
        valid: false,
        error: `Passport header field "${field.key}" must keep value source "${expected.valueSource}".`,
      };
    }
    if (field.ownership && field.ownership !== expected.ownership) {
      return {
        valid: false,
        error: `Passport header field "${field.key}" must keep ownership "${expected.ownership}".`,
      };
    }
  }

  return { valid: true };
}

module.exports = {
  DEFAULT_SYSTEM_PASSPORT_HEADER_SECTION,
  DEFAULT_SYSTEM_PASSPORT_HEADER_FIELDS,
  normalizeSystemPassportHeader,
  getSystemPassportHeader,
  validateSystemPassportHeader,
};
