"use strict";

const {
  BATTERY_DICTIONARY_MODEL_KEY,
} = require("./battery-dictionary-targeting");
const {
  DEFAULT_GENERIC_COMPLIANCE_PROFILE,
  getComplianceProfileForPassportType,
} = require("../src/passport-modules");
const { getPassportFieldValue } = require("../src/shared/passports/passport-helpers");

const VALID_ACCESS_LEVELS = new Set([
  "public",
  "consumers",
  "notified_bodies",
  "market_surveillance",
  "customs_authority",
  "eu_commission",
  "legitimate_interest",
  "economic_operator",
  "delegated_operator",
  "manufacturer",
  "authorized_representative",
  "importer",
  "distributor",
  "dealer",
  "fulfilment_service_provider",
  "professional_repairer",
  "independent_operator",
  "recycler",
  "main_dpp_service_provider",
  "backup_dpp_service_provider",
]);

const VALID_CONFIDENTIALITY_LEVELS = new Set([
  "public",
  "restricted",
  "confidential",
  "trade_secret",
  "regulated",
]);

const VALID_UPDATE_AUTHORITIES = new Set([
  "economic_operator",
  "delegated_operator",
  "manufacturer",
  "authorized_representative",
  "importer",
  "distributor",
  "dealer",
  "fulfilment_service_provider",
  "professional_repairer",
  "independent_operator",
  "recycler",
  "notified_bodies",
  "market_surveillance",
  "customs_authority",
  "eu_commission",
  "main_dpp_service_provider",
  "backup_dpp_service_provider",
  "system",
]);

const APPLICABLE_REQUIREMENT_LEVELS = new Set([
  "mandatory_battreg",
  "mandatory_espr_jtc24",
  "voluntary",
]);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLookupKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function flattenSchemaFields(typeDef) {
  const sections = typeDef?.fieldsJson?.sections || [];
  return sections.flatMap((section) =>
    (section.fields || []).map((field) => ({
      ...field,
      sectionKey: section.key || null,
      sectionLabel: section.label || null,
    }))
  );
}

function normalizePassportTypeDefinition(typeDef) {
  if (!typeDef) return null;
  const fieldsJson = typeDef.fieldsJson || typeDef.fields_json || {};
  return {
    ...typeDef,
    typeName: typeDef.typeName || typeDef.type_name || null,
    displayName: typeDef.displayName || typeDef.display_name || null,
    productCategory: typeDef.productCategory || typeDef.product_category || null,
    semanticModelKey: typeDef.semanticModelKey || typeDef.semantic_model_key || null,
    complianceProfile: typeDef.complianceProfile || typeDef.compliance_profile || fieldsJson.complianceProfile || null,
    fieldsJson,
  };
}

function normalizeCompanyGovernance(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyName: row.companyName || row.company_name || null,
    didSlug: row.didSlug || row.did_slug || null,
    economicOperatorIdentifier: row.economicOperatorIdentifier || row.economic_operator_identifier || null,
    economicOperatorIdentifierScheme: row.economicOperatorIdentifierScheme || row.economic_operator_identifier_scheme || null,
  };
}

function normalizeProfile(profile = null) {
  const baseProfile = {
    ...DEFAULT_GENERIC_COMPLIANCE_PROFILE,
    ...(profile || {}),
  };
  return {
    ...baseProfile,
    contentSpecificationIds: Array.isArray(baseProfile.contentSpecificationIds)
      ? baseProfile.contentSpecificationIds
      : [],
    requiredPassportFields: Array.isArray(baseProfile.requiredPassportFields)
      ? baseProfile.requiredPassportFields
      : [],
    requireFacilityAtGranularities: Array.isArray(baseProfile.requireFacilityAtGranularities)
      ? baseProfile.requireFacilityAtGranularities
      : [],
    managedSemanticFieldKeys: Array.isArray(baseProfile.managedSemanticFieldKeys)
      ? baseProfile.managedSemanticFieldKeys
      : [],
  };
}

function resolveProfileSemanticModelKey(typeDef, profile) {
  const profileSemanticModelKey = Array.isArray(profile?.contentSpecificationIds)
    ? normalizeText(profile.contentSpecificationIds[0])
    : "";
  return profileSemanticModelKey || normalizeText(typeDef?.semanticModelKey) || null;
}

function parseTableValue(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.rows)) return value.rows;
    return [];
  }
  const text = normalizeText(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.rows)) return parsed.rows;
    return [];
  } catch {
    return [];
  }
}

function hasMeaningfulValue(field, value) {
  if (value === null || value === undefined) return false;

  if (field?.type === "boolean") {
    // Boolean fields default to false in the DB, so treat only true as user-filled
    // to preserve the platform's current completeness semantics.
    return value === true;
  }

  if (field?.type === "table") {
    const rows = parseTableValue(value);
    return rows.some((row) =>
      Array.isArray(row)
        ? row.some((cell) => normalizeText(cell) !== "")
        : normalizeText(row) !== ""
    );
  }

  if (Array.isArray(value)) {
    return value.some((item) => normalizeText(item) !== "");
  }

  if (typeof value === "object") {
    return Object.values(value).some((item) => normalizeText(item) !== "");
  }

  return normalizeText(value) !== "";
}

function isBlankValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return normalizeText(value) === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNumericString(value) {
  return /^-?\d+(\.\d+)?$/.test(normalizeText(value));
}

function isIntegerString(value) {
  return /^-?\d+$/.test(normalizeText(value));
}

function isBooleanLike(value) {
  if (typeof value === "boolean") return true;
  return /^(true|false|1|0|yes|no)$/i.test(normalizeText(value));
}

function isDateTimeLike(value) {
  const text = normalizeText(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    return false;
  }
  return !Number.isNaN(Date.parse(text));
}

function isDateLike(value) {
  const text = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function isYearMonthLike(value) {
  const text = normalizeText(value);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) || /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(text);
}

function isUriLike(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return true;
  return /^https?:\/\//i.test(text);
}

function isLanguageTagLike(value) {
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(normalizeText(value));
}

function isScalarValue(value) {
  return value === null
    || value === undefined
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean";
}

function looksLikeJson(value) {
  const text = normalizeText(value);
  return (text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"));
}

function parseStructuredValue(field, value) {
  if (Array.isArray(value) || isPlainObject(value) || typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (field?.type === "table" || looksLikeJson(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function isExplicitMultiLanguageField(field) {
  const key = normalizeText(field?.key).toLowerCase();
  const valueKind = normalizeText(field?.valueKind || field?.expandedObjectType || field?.objectTypeHint).toLowerCase();
  return valueKind === "multilanguage"
    || valueKind === "multilingual"
    || valueKind === "i18n"
    || key.endsWith("_i18n")
    || key.endsWith("_intl")
    || key.includes("multilang")
    || key.includes("localized");
}

function isMultiLanguageValue(value) {
  if (!isPlainObject(value)) return false;
  const entries = Object.entries(value);
  if (!entries.length) return false;
  return entries.every(([key, entryValue]) =>
    isLanguageTagLike(key) && isScalarValue(entryValue)
  );
}

function normalizeArrayItemType(value) {
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "array";
  if (isPlainObject(value)) return "object";
  return typeof value;
}

function hasMixedArrayItemTypes(value) {
  if (!Array.isArray(value)) return false;
  const populatedItems = value.filter((item) => !isBlankValue(item));
  if (populatedItems.length <= 1) return false;
  const expectedType = normalizeArrayItemType(populatedItems[0]);
  return populatedItems.some((item) => normalizeArrayItemType(item) !== expectedType);
}

function formatExpectedType(term) {
  const format = normalizeText(term?.dataType?.format);
  if (format) return format;
  const xsdType = normalizeText(term?.dataType?.xsdType);
  if (xsdType) return xsdType;
  const jsonType = normalizeText(term?.dataType?.jsonType);
  return jsonType || "declared semantic datatype";
}

function isSchemaFieldCompatibleWithTerm(field, term) {
  const fieldType = normalizeText(field?.type || "text").toLowerCase();
  const jsonType = normalizeText(term?.dataType?.jsonType).toLowerCase();
  const xsdType = normalizeText(term?.dataType?.xsdType).toLowerCase();

  if (!jsonType && !xsdType) return true;

  if (jsonType === "boolean" || xsdType.endsWith(":boolean")) {
    return fieldType === "boolean";
  }

  if (xsdType.endsWith(":anyuri")) {
    return ["url", "file", "symbol", "text", "textarea"].includes(fieldType);
  }

  if (xsdType.endsWith(":datetime") || xsdType.endsWith(":date") || xsdType.endsWith(":gyearmonth")) {
    return ["date", "text", "textarea"].includes(fieldType);
  }

  if (jsonType === "number" || jsonType === "integer" || xsdType.endsWith(":decimal") || xsdType.endsWith(":integer") || xsdType.endsWith(":int")) {
    return ["text", "textarea"].includes(fieldType);
  }

  if (jsonType === "string" || xsdType.endsWith(":string")) {
    return fieldType !== "boolean";
  }

  return true;
}

function isValueCompatibleWithTerm(value, term) {
  if (isBlankValue(value)) return true;

  if (Array.isArray(value)) {
    return value.filter((item) => !isBlankValue(item)).every((item) => isValueCompatibleWithTerm(item, term));
  }

  const jsonType = normalizeText(term?.dataType?.jsonType).toLowerCase();
  const xsdType = normalizeText(term?.dataType?.xsdType).toLowerCase();

  if (jsonType === "boolean" || xsdType.endsWith(":boolean")) {
    return isBooleanLike(value);
  }

  if (jsonType === "number" || xsdType.endsWith(":decimal")) {
    return typeof value === "number" || isNumericString(value);
  }

  if (jsonType === "integer" || xsdType.endsWith(":integer") || xsdType.endsWith(":int")) {
    return Number.isInteger(value) || isIntegerString(value);
  }

  if (xsdType.endsWith(":datetime")) {
    return isDateTimeLike(value);
  }

  if (xsdType.endsWith(":date")) {
    return isDateLike(value);
  }

  if (xsdType.endsWith(":gyearmonth")) {
    return isYearMonthLike(value);
  }

  if (xsdType.endsWith(":anyuri")) {
    return isUriLike(value);
  }

  if (jsonType === "string" || xsdType.endsWith(":string")) {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  }

  return true;
}

function dedupeIssues(issues = []) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = [
      issue?.code || "",
      issue?.label || "",
      issue?.expectedType || "",
      issue?.message || "",
    ].join("::");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createIssue({ severity = "error", code, message, key = null, label = null, expectedType = null, section = null }) {
  return {
    severity,
    code,
    message,
    ...(key ? { key } : {}),
    ...(label ? { label } : {}),
    ...(expectedType ? { expectedType } : {}),
    ...(section ? { section } : {}),
  };
}

function isMandatoryRequirementLevel(level) {
  return /^mandatory(?:_|$)/.test(normalizeText(level).toLowerCase());
}

const MANAGED_BATTERY_SEMANTIC_FIELD_RESOLVERS = {
  dpp_schema_version: ({ canonicalPayload, passport }) =>
    canonicalPayload?.dppSchemaVersion || passport?.dppSchemaVersion || null,
  dpp_status: ({ canonicalPayload, passport }) =>
    canonicalPayload?.dppStatus || passport?.dppStatus || passport?.releaseStatus || null,
  dpp_granularity: ({ canonicalPayload, passport }) =>
    canonicalPayload?.granularity || passport?.granularity || null,
  last_updated_at: ({ canonicalPayload, passport }) =>
    canonicalPayload?.lastUpdate || canonicalPayload?.lastUpdated || passport?.updatedAt || passport?.createdAt || null,
  unique_dpp_identifier: ({ canonicalPayload }) =>
    canonicalPayload?.digitalProductPassportId || canonicalPayload?.dppDid || null,
  unique_passport_identifier: ({ canonicalPayload }) =>
    canonicalPayload?.digitalProductPassportId || canonicalPayload?.dppDid || null,
  unique_battery_identifier: ({ canonicalPayload }) =>
    canonicalPayload?.uniqueProductIdentifier || canonicalPayload?.productDid || null,
  unique_product_identifier: ({ canonicalPayload }) =>
    canonicalPayload?.uniqueProductIdentifier || canonicalPayload?.productDid || null,
  economic_operator_identifier: ({ canonicalPayload, company, passport }) =>
    canonicalPayload?.economicOperatorId
    || passport?.economicOperatorId
    || company?.economicOperatorIdentifier
    || null,
  facility_identifier: ({ canonicalPayload, passport }) =>
    canonicalPayload?.facilityId || passport?.facilityId || passport?.facilityIdentifier || null,
};

module.exports = function createComplianceService({
  pool,
  batteryDictionaryService,
  semanticModelRegistry = null,
  buildCanonicalPassportPayload = null,
}) {
  const batteryCategoryRules = batteryDictionaryService?.getCategoryRules ? batteryDictionaryService.getCategoryRules() : null;

  function isBatterySemanticModel(modelKey) {
    return normalizeText(modelKey) === BATTERY_DICTIONARY_MODEL_KEY;
  }

  function getModelCategoryRules(modelKey) {
    if (semanticModelRegistry?.getCategoryRules) {
      const rules = semanticModelRegistry.getCategoryRules(modelKey);
      if (rules) return rules;
    }
    if (isBatterySemanticModel(modelKey)) return batteryCategoryRules;
    return null;
  }

  function getSemanticTermByIri(modelKey, iri) {
    if (!iri) return null;
    if (semanticModelRegistry?.getTermByIri) {
      const term = semanticModelRegistry.getTermByIri(modelKey, iri);
      if (term) return term;
    }
    if (isBatterySemanticModel(modelKey) && batteryDictionaryService?.getTermByIri) {
      return batteryDictionaryService.getTermByIri(iri);
    }
    return null;
  }

  function getSemanticTermByFieldKey(modelKey, fieldKey) {
    if (!fieldKey) return null;
    if (semanticModelRegistry?.getTermByFieldKey) {
      const term = semanticModelRegistry.getTermByFieldKey(modelKey, fieldKey);
      if (term) return term;
    }
    if (isBatterySemanticModel(modelKey) && batteryDictionaryService?.getTermByFieldKey) {
      return batteryDictionaryService.getTermByFieldKey(fieldKey);
    }
    return null;
  }

  function getSemanticTermForField(field, semanticModelKey) {
    if (field?.semanticId) {
      const termByIri = getSemanticTermByIri(semanticModelKey, field.semanticId);
      if (termByIri) return termByIri;
    }
    return getSemanticTermByFieldKey(semanticModelKey, field?.key) || null;
  }

  function getCategoryRequirementForSemanticKey(modelKey, fieldKey, category) {
    if (!fieldKey || !category) return null;
    if (semanticModelRegistry?.getCategoryRequirementForField) {
      const requirement = semanticModelRegistry.getCategoryRequirementForField(modelKey, fieldKey, category);
      if (requirement) return requirement;
    }
    if (isBatterySemanticModel(modelKey) && batteryDictionaryService?.getCategoryRequirementForField) {
      return batteryDictionaryService.getCategoryRequirementForField(fieldKey, category);
    }
    return null;
  }

  async function loadPassportTypeDefinition(passportType) {
    const result = await pool.query(
      `SELECT id, "typeName" AS "typeName", "displayName" AS "displayName", "productCategory" AS "productCategory", "semanticModelKey" AS "semanticModelKey", "fieldsJson" AS "fieldsJson"
       FROM passport_types
       WHERE "typeName" = $1
       LIMIT 1`,
      [passportType]
    );
    return normalizePassportTypeDefinition(result.rows[0] || null);
  }

  async function loadCompanyGovernance(companyId) {
    if (!companyId) return null;
    const result = await pool.query(
      `SELECT id,
              company_name AS "companyName",
              did_slug AS "didSlug",
              economic_operator_identifier AS "economicOperatorIdentifier",
              economic_operator_identifier_scheme AS "economicOperatorIdentifierScheme"
       FROM companies
       WHERE id = $1
       LIMIT 1`,
      [companyId]
    ).catch(() => ({ rows: [] }));
    return normalizeCompanyGovernance(result.rows[0] || null);
  }

  function resolveProfileMetadata({ passportType = null, typeDef = null, granularity = null } = {}) {
    const normalizedTypeDef = normalizePassportTypeDefinition(typeDef);
    const profileLookupKey = passportType || normalizedTypeDef?.typeName || "";
    const profile = normalizeProfile(
      normalizedTypeDef?.complianceProfile
      || getComplianceProfileForPassportType(profileLookupKey, normalizedTypeDef)
    );
    const contentSpecificationIds = Array.isArray(profile.contentSpecificationIds) && profile.contentSpecificationIds.length
      ? profile.contentSpecificationIds
      : [normalizedTypeDef?.semanticModelKey || DEFAULT_GENERIC_COMPLIANCE_PROFILE.key];
    return {
      ...profile,
      granularity: String(granularity || "item").trim().toLowerCase() || "item",
      contentSpecificationIds,
    };
  }

  function getCategoryApplicabilityForField(field, normalizedCategory, semanticModelKey) {
    if (!normalizedCategory) return null;
    const candidateFieldKeys = new Set([field?.key]);
    const term = getSemanticTermForField(field, semanticModelKey);
    for (const appFieldKey of (term?.appFieldKeys || [])) {
      if (appFieldKey) candidateFieldKeys.add(appFieldKey);
    }

    let requirementLevel = null;
    for (const fieldKey of candidateFieldKeys) {
      requirementLevel = getCategoryRequirementForSemanticKey(semanticModelKey, fieldKey, normalizedCategory);
      if (requirementLevel) break;
    }
    if (!requirementLevel) return null;
    return {
      requirementLevel,
      applicable: APPLICABLE_REQUIREMENT_LEVELS.has(requirementLevel),
      mandatory: isMandatoryRequirementLevel(requirementLevel),
    };
  }

  function buildCompleteness(fields, passport, options = {}) {
    const normalizedCategory = options.normalizedCategory || null;
    const semanticModelKey = options.semanticModelKey || null;
    const missingFields = [];
    let filledFields = 0;
    let applicableFields = 0;
    const applicableFieldDetails = [];
    const ignoredFieldDetails = [];

    for (const field of fields) {
      const applicability = getCategoryApplicabilityForField(field, normalizedCategory, semanticModelKey);
      const isApplicable = applicability ? applicability.applicable : true;
      const requirementLevel = applicability?.requirementLevel || null;
      const isMandatory = applicability ? applicability.mandatory : true;

      if (!isApplicable) {
        ignoredFieldDetails.push({
          key: field.key,
          label: field.label || field.key,
          requirementLevel,
          section: field.sectionLabel || field.sectionKey || null,
        });
        continue;
      }

      applicableFields += 1;
      const value = getPassportFieldValue(passport, field.key);
      if (hasMeaningfulValue(field, value)) {
        filledFields += 1;
        applicableFieldDetails.push({
          key: field.key,
          label: field.label || field.key,
          requirementLevel,
          mandatory: isMandatory,
          filled: true,
          section: field.sectionLabel || field.sectionKey || null,
        });
      } else {
        const missingField = {
          key: field.key,
          label: field.label || field.key,
          type: field.type || "text",
          access: Array.isArray(field.access) ? field.access : ["public"],
          requirementLevel,
          mandatory: isMandatory,
          section: field.sectionLabel || field.sectionKey || null,
        };
        missingFields.push(missingField);
        applicableFieldDetails.push({
          key: field.key,
          label: field.label || field.key,
          requirementLevel,
          mandatory: isMandatory,
          filled: false,
          section: field.sectionLabel || field.sectionKey || null,
        });
      }
    }

    const totalFields = applicableFields;
    const percentage = totalFields > 0
      ? Math.round((filledFields / totalFields) * 100)
      : 100;

    return {
      totalFields,
      filledFields,
      missingFields,
      missingMandatoryFields: missingFields.filter((field) => field.mandatory),
      missingVoluntaryFields: missingFields.filter((field) => !field.mandatory),
      applicableFields: applicableFieldDetails,
      ignoredFields: ignoredFieldDetails,
      percentage,
    };
  }

  function validateAccess(fields) {
    const issues = [];

    for (const field of fields) {
      const access = Array.isArray(field.access) ? field.access.filter(Boolean) : [];
      if (!access.length) {
        issues.push(createIssue({
          code: "FIELD_ACCESS_MISSING",
          message: `Field "${field.label || field.key}" must expose at least one audience.`,
          key: field.key,
          label: field.label || field.key,
          section: field.sectionLabel || field.sectionKey || null,
        }));
        continue;
      }

      const invalidEntries = access.filter((entry) => !VALID_ACCESS_LEVELS.has(entry));
      if (invalidEntries.length) {
        issues.push(createIssue({
          code: "FIELD_ACCESS_INVALID",
          message: `Field "${field.label || field.key}" uses unsupported access values: ${invalidEntries.join(", ")}.`,
          key: field.key,
          label: field.label || field.key,
          section: field.sectionLabel || field.sectionKey || null,
        }));
      }
    }

    return issues;
  }

  function validateFieldGovernance(fields) {
    const issues = [];

    for (const field of fields) {
      const confidentiality = normalizeText(field?.confidentiality).toLowerCase();
      if (!confidentiality) {
        issues.push(createIssue({
          code: "FIELD_CONFIDENTIALITY_MISSING",
          message: `Field "${field.label || field.key}" must declare a confidentiality classification.`,
          key: field.key,
          label: field.label || field.key,
          section: field.sectionLabel || field.sectionKey || null,
        }));
      } else if (!VALID_CONFIDENTIALITY_LEVELS.has(confidentiality)) {
        issues.push(createIssue({
          code: "FIELD_CONFIDENTIALITY_INVALID",
          message: `Field "${field.label || field.key}" uses unsupported confidentiality value "${field.confidentiality}".`,
          key: field.key,
          label: field.label || field.key,
          section: field.sectionLabel || field.sectionKey || null,
        }));
      }

      const updateAuthority = Array.isArray(field?.updateAuthority)
        ? field.updateAuthority
        : (Array.isArray(field?.update_authority) ? field.update_authority : []);
      if (!updateAuthority.length) {
        issues.push(createIssue({
          code: "FIELD_UPDATE_AUTHORITY_MISSING",
          message: `Field "${field.label || field.key}" must declare at least one update authority.`,
          key: field.key,
          label: field.label || field.key,
          section: field.sectionLabel || field.sectionKey || null,
        }));
      } else {
        const invalidAuthorities = updateAuthority.filter((entry) => !VALID_UPDATE_AUTHORITIES.has(entry));
        if (invalidAuthorities.length) {
          issues.push(createIssue({
            code: "FIELD_UPDATE_AUTHORITY_INVALID",
            message: `Field "${field.label || field.key}" uses unsupported updateAuthority values: ${invalidAuthorities.join(", ")}.`,
            key: field.key,
            label: field.label || field.key,
            section: field.sectionLabel || field.sectionKey || null,
          }));
        }
      }
    }

    return issues;
  }

  function validateAudienceLayerCoverage(fields, profile) {
    const issues = [];
    if (!profile?.requirePublicAccessLayer) return issues;

    const hasPublicAudience = fields.some((field) => {
      const access = Array.isArray(field?.access) ? field.access : [];
      return access.includes("public");
    });

    if (!hasPublicAudience) {
      issues.push(createIssue({
        code: "PUBLIC_ACCESS_LAYER_MISSING",
        message: `Compliance profile "${profile.displayName || profile.key}" must expose at least one publicly accessible field layer before release.`,
      }));
    }

    return issues;
  }

  function validateProfileGovernance({ passport, profile, company }) {
    const issues = [];
    const granularity = String(passport?.granularity || profile?.granularity || "item").trim().toLowerCase() || "item";

    for (const requiredField of profile.requiredPassportFields || []) {
      if (!hasMeaningfulValue({ type: "text" }, passport?.[requiredField])) {
        issues.push(createIssue({
          code: "PROFILE_GOVERNANCE_FIELD_MISSING",
          message: `Compliance profile "${profile.displayName}" requires passport field "${requiredField}" before release.`,
          key: requiredField,
        }));
      }
    }

    if (profile.requireCompanyOperatorIdentifier) {
      const effectiveEconomicOperatorId = normalizeText(
        passport?.economicOperatorId || company?.economicOperatorIdentifier
      );
      const effectiveEconomicOperatorIdentifierScheme = normalizeText(
        passport?.economicOperatorIdentifierScheme || company?.economicOperatorIdentifierScheme
      );

      if (!effectiveEconomicOperatorId) {
        issues.push(createIssue({
          code: "ECONOMIC_OPERATOR_IDENTIFIER_MISSING",
          message: "The passport must declare an economic operator identifier before regulated release.",
          key: "economicOperatorId",
        }));
      }
      if (!effectiveEconomicOperatorIdentifierScheme) {
        issues.push(createIssue({
          code: "ECONOMIC_OPERATOR_IDENTIFIER_SCHEME_MISSING",
          message: "The passport must declare which identifier scheme governs its economic operator identifier.",
          key: "economicOperatorIdentifierScheme",
        }));
      }
    }

    if (profile.requireCarrierPolicy && !normalizeText(passport?.carrierPolicyKey)) {
      issues.push(createIssue({
        code: "CARRIER_POLICY_MISSING",
        message: `Compliance profile "${profile.displayName}" requires a carrierPolicyKey before release.`,
        key: "carrierPolicyKey",
      }));
    }

    if ((profile.requireFacilityAtGranularities || []).includes(granularity) && !normalizeText(passport?.facilityId)) {
      issues.push(createIssue({
        code: "FACILITY_IDENTIFIER_MISSING",
        message: `Granularity "${granularity}" requires a facilityId under compliance profile "${profile.displayName}".`,
        key: "facilityId",
      }));
    }

    return issues;
  }

  function applyManagedGovernanceDefaults(passport = {}, profile, company = null) {
    const normalized = { ...passport };
    if (profile?.key) {
      normalized.complianceProfileKey = profile.key;
    }
    if ((!normalized.contentSpecificationIds || (Array.isArray(normalized.contentSpecificationIds) && normalized.contentSpecificationIds.length === 0))
      && Array.isArray(profile?.contentSpecificationIds)
      && profile.contentSpecificationIds.length) {
      normalized.contentSpecificationIds = profile.contentSpecificationIds;
    }
    if (!normalizeText(normalized.carrierPolicyKey) && profile?.defaultCarrierPolicyKey) {
      normalized.carrierPolicyKey = profile.defaultCarrierPolicyKey;
    }
    if (!normalizeText(normalized.economicOperatorId) && company?.economicOperatorIdentifier) {
      normalized.economicOperatorId = company.economicOperatorIdentifier;
    }
    if (!normalizeText(normalized.economicOperatorIdentifierScheme) && company?.economicOperatorIdentifierScheme) {
      normalized.economicOperatorIdentifierScheme = company.economicOperatorIdentifierScheme;
    }
    return normalized;
  }

function validateSemanticData(fields, passport, { semanticModelKey = null, profile = null } = {}) {
  const issues = [];
  const enforceSemanticMapping = Boolean(profile?.enforceSemanticMapping);

  for (const field of fields) {
    const term = getSemanticTermForField(field, semanticModelKey);
    if (enforceSemanticMapping && !term) {
      issues.push(createIssue({
        code: "SEMANTIC_TERM_NOT_FOUND",
        message: `Field "${field.label || field.key}" is not mapped to a term in semantic model "${semanticModelKey || "unknown"}".`,
        key: field.key,
        label: field.label || field.key,
        section: field.sectionLabel || field.sectionKey || null,
      }));
      continue;
    }
    if (!term) continue;

    if (!isSchemaFieldCompatibleWithTerm(field, term)) {
      issues.push(createIssue({
          code: "SEMANTIC_FIELD_TYPE_MISMATCH",
          message: `Field "${field.label || field.key}" is configured as "${field.type}" but its semantic datatype expects ${formatExpectedType(term)}.`,
          key: field.key,
          label: field.label || field.key,
          expectedType: formatExpectedType(term),
          section: field.sectionLabel || field.sectionKey || null,
        }));
      }

      const value = parseStructuredValue(field, getPassportFieldValue(passport, field.key));
      if (!hasMeaningfulValue(field, value)) continue;

      if (Array.isArray(value) && hasMixedArrayItemTypes(value)) {
        issues.push(createIssue({
          code: "SEMANTIC_ARRAY_ITEM_TYPE_MISMATCH",
          message: `Field "${field.label || field.key}" contains array items with mixed JSON types.`,
          key: field.key,
          label: field.label || field.key,
          section: field.sectionLabel || field.sectionKey || null,
        }));
      }

      if ((isExplicitMultiLanguageField(field) || isMultiLanguageValue(value)) && isPlainObject(value)) {
        for (const [languageTag, localizedValue] of Object.entries(value)) {
          if (!isLanguageTagLike(languageTag)) {
            issues.push(createIssue({
              code: "SEMANTIC_LANGUAGE_TAG_INVALID",
              message: `Field "${field.label || field.key}" uses invalid language tag "${languageTag}".`,
              key: field.key,
              label: field.label || field.key,
              section: field.sectionLabel || field.sectionKey || null,
            }));
          }
          if (!isScalarValue(localizedValue)) {
            issues.push(createIssue({
              code: "SEMANTIC_MULTILANGUAGE_VALUE_INVALID",
              message: `Field "${field.label || field.key}" contains non-scalar content for language tag "${languageTag}".`,
              key: field.key,
              label: field.label || field.key,
              section: field.sectionLabel || field.sectionKey || null,
            }));
          }
        }
      }

      const expectedUnit = normalizeText(term?.unit).toLowerCase();
      if (expectedUnit && expectedUnit !== "none" && isPlainObject(value) && value.unit && normalizeText(value.unit).toLowerCase() !== expectedUnit) {
        issues.push(createIssue({
          code: "SEMANTIC_UNIT_MISMATCH",
          message: `Field "${field.label || field.key}" uses unit "${value.unit}" but the dictionary expects "${term.unit}".`,
          key: field.key,
          label: field.label || field.key,
          section: field.sectionLabel || field.sectionKey || null,
        }));
      }

      if ((isExplicitMultiLanguageField(field) || isMultiLanguageValue(value)) && isPlainObject(value)) {
        continue;
      }

      if (!isValueCompatibleWithTerm(value, term)) {
        issues.push(createIssue({
          code: "SEMANTIC_VALUE_TYPE_MISMATCH",
          message: `Field "${field.label || field.key}" has a value that does not match the semantic datatype ${formatExpectedType(term)}.`,
          key: field.key,
          label: field.label || field.key,
          expectedType: formatExpectedType(term),
          section: field.sectionLabel || field.sectionKey || null,
        }));
      }
    }

  return issues;
}

  function buildRequiredFieldIssues(completeness, options = {}) {
    const normalizedCategory = options.normalizedCategory || null;
    const categoryLabel = options.categoryLabel || "category";
    return (completeness?.missingMandatoryFields || []).map((field) => createIssue({
      code: field.requirementLevel ? "CATEGORY_REQUIRED_FIELD_MISSING" : "REQUIRED_FIELD_MISSING",
      message: field.requirementLevel && normalizedCategory
        ? `Field "${field.label || field.key}" is required for ${categoryLabel} "${normalizedCategory}" before release.`
        : `Field "${field.label || field.key}" is required before release.`,
      key: field.key,
      label: field.label || field.key,
      section: field.section || null,
    }));
  }

  function evaluateManagedSemanticFields({
    fields,
    passport,
    typeDef,
    company,
    profile,
    normalizedCategory,
    semanticModelKey,
  }) {
    const managedFields = [];
    const issues = [];

    if (!buildCanonicalPassportPayload || !profile?.managedSemanticFieldKeys?.length) {
      return { managedFields, issues };
    }

    const schemaFieldKeys = new Set(fields.map((field) => field.key).filter(Boolean));
    const canonicalPayload = buildCanonicalPassportPayload(passport || {}, typeDef, { company });

    for (const fieldKey of profile.managedSemanticFieldKeys) {
      const resolveValue = MANAGED_BATTERY_SEMANTIC_FIELD_RESOLVERS[fieldKey];
      if (!resolveValue) continue;
      if (schemaFieldKeys.has(fieldKey)) continue;

      const term = getSemanticTermByFieldKey(semanticModelKey, fieldKey);
      const syntheticField = {
        key: fieldKey,
        semanticId: term?.iri || term?.termIri || null,
      };
      const applicability = getCategoryApplicabilityForField(syntheticField, normalizedCategory, semanticModelKey);
      if (applicability && !applicability.applicable) continue;

      const label = term?.label || fieldKey;
      const value = resolveValue({ canonicalPayload, company, passport: passport || {} });
      const mandatory = applicability ? applicability.mandatory : false;
      const requirementLevel = applicability?.requirementLevel || null;

      managedFields.push({
        key: fieldKey,
        label,
        requirementLevel,
        mandatory,
        filled: hasMeaningfulValue({ type: "text" }, value),
        source: "managed",
        value: isBlankValue(value) ? null : value,
      });

      if (mandatory && !hasMeaningfulValue({ type: "text" }, value)) {
        issues.push(createIssue({
          code: "MANAGED_SEMANTIC_FIELD_MISSING",
          message: `Managed standards field "${label}" is required before release but could not be derived from passport metadata.`,
          key: fieldKey,
          label,
        }));
        continue;
      }

      if (term && !isBlankValue(value) && !isValueCompatibleWithTerm(value, term)) {
        issues.push(createIssue({
          code: "MANAGED_SEMANTIC_VALUE_TYPE_MISMATCH",
          message: `Managed standards field "${label}" does not match the semantic datatype ${formatExpectedType(term)}.`,
          key: fieldKey,
          label,
          expectedType: formatExpectedType(term),
        }));
      }
    }

    return { managedFields, issues };
  }

  function getCategoryPolicyFieldKeys(categoryPolicy = {}) {
    const keys = new Set([
      categoryPolicy.fieldKey,
      ...(Array.isArray(categoryPolicy.fieldKeys) ? categoryPolicy.fieldKeys : []),
    ]);
    return [...keys].map(normalizeText).filter(Boolean);
  }

  function getCategoryPolicyLabels(categoryPolicy = {}) {
    const labels = new Set([
      categoryPolicy.label,
      categoryPolicy.fieldLabel,
      ...(Array.isArray(categoryPolicy.fieldLabels) ? categoryPolicy.fieldLabels : []),
    ]);
    return [...labels].map(normalizeLookupKey).filter(Boolean);
  }

  function findCategoryField(fields = [], categoryPolicy = {}) {
    const fieldKeys = new Set(getCategoryPolicyFieldKeys(categoryPolicy));
    const fieldLabels = new Set(getCategoryPolicyLabels(categoryPolicy));
    return fields.find((field) => fieldKeys.has(field.key))
      || fields.find((field) => fieldLabels.has(normalizeLookupKey(field.label)))
      || null;
  }

  function buildCategoryAliasMap(categoryPolicy = {}) {
    const aliases = categoryPolicy.aliases || {};
    if (aliases instanceof Map) {
      return new Map([...aliases.entries()].map(([alias, value]) => [normalizeLookupKey(alias), value]));
    }
    return new Map(Object.entries(aliases).map(([alias, value]) => [normalizeLookupKey(alias), value]));
  }

  function getSupportedCategories(semanticModelKey, categoryPolicy = {}) {
    const categoryRules = getModelCategoryRules(semanticModelKey);
    if (Array.isArray(categoryRules?.categories) && categoryRules.categories.length) return categoryRules.categories;
    if (Array.isArray(categoryPolicy.supportedCategories)) return categoryPolicy.supportedCategories;
    return [];
  }

  function normalizeCategoryValue(value, categoryPolicy = {}, supportedCategories = []) {
    const raw = normalizeText(value);
    const normalized = normalizeLookupKey(raw);
    if (!normalized) return null;

    const aliases = buildCategoryAliasMap(categoryPolicy);
    if (aliases.has(normalized)) return aliases.get(normalized);

    const supportedCategory = supportedCategories.find((category) => normalizeLookupKey(category) === normalized);
    if (supportedCategory) return supportedCategory;
    return supportedCategories.length ? null : raw;
  }

  function buildUnsupportedCategoryMessage(rawCategory, categoryLabel, supportedCategories) {
    const supportedText = supportedCategories.length
      ? ` Supported values: ${supportedCategories.join(", ")}.`
      : "";
    return `${categoryLabel} "${rawCategory}" is not supported by the selected category policy.${supportedText}`;
  }

  function evaluateCategoryPolicy(fields, passport, completeness, { semanticModelKey = null, categoryPolicy = {} } = {}) {
    const categoryRules = getModelCategoryRules(semanticModelKey);
    const supportedCategories = getSupportedCategories(semanticModelKey, categoryPolicy);
    const categoryField = findCategoryField(fields, categoryPolicy);
    const rawCategory = categoryField ? getPassportFieldValue(passport, categoryField.key) : null;
    const categoryLabel = categoryPolicy.label || categoryField?.label || "category";
    const normalizedCategory = normalizeCategoryValue(rawCategory, categoryPolicy, supportedCategories);
    const issues = [];

    if (categoryField && hasMeaningfulValue(categoryField, rawCategory) && !normalizedCategory) {
      issues.push(createIssue({
        code: categoryPolicy.unsupportedCode || "CATEGORY_UNSUPPORTED",
        message: buildUnsupportedCategoryMessage(rawCategory, categoryLabel, supportedCategories),
        key: categoryField.key,
        label: categoryField.label || categoryField.key,
        section: categoryField.sectionLabel || categoryField.sectionKey || null,
      }));
    }
    const ruleCoverage = normalizedCategory
      ? fields
        .map((field) => {
          const applicability = getCategoryApplicabilityForField(field, normalizedCategory, semanticModelKey);
          if (!applicability) return null;
          return {
            key: field.key,
            label: field.label || field.key,
            requirementLevel: applicability.requirementLevel,
            applicable: applicability.applicable,
            mandatory: applicability.mandatory,
            filled: applicability.applicable ? hasMeaningfulValue(field, getPassportFieldValue(passport, field.key)) : null,
          };
        })
        .filter(Boolean)
      : [];

    return {
      raw: rawCategory || null,
      normalized: normalizedCategory,
      supported: supportedCategories,
      policyKind: categoryPolicy.kind || null,
      productKind: categoryPolicy.productKind || null,
      fieldKey: categoryField?.key || null,
      sourceWorkbook: categoryRules?.sourceWorkbook || null,
      sheetName: categoryRules?.sheetName || null,
      mandatoryFieldCount: completeness.applicableFields.filter((field) => field.mandatory).length,
      voluntaryFieldCount: completeness.applicableFields.filter((field) => !field.mandatory).length,
      missingMandatoryFields: completeness.missingMandatoryFields,
      missingVoluntaryFields: completeness.missingVoluntaryFields,
      ignoredFields: completeness.ignoredFields,
      ruleCoverage,
      issues,
    };
  }

  async function evaluatePassport(passport, passportType = null, providedTypeDef = null) {
    const basePassport = passport || {};
    const requestedPassportType = passportType || basePassport.passportType || basePassport.passport_type || "";
    const resolvedTypeDef = normalizePassportTypeDefinition(providedTypeDef)
      || await loadPassportTypeDefinition(requestedPassportType);
    if (!resolvedTypeDef) {
      const issue = createIssue({
        code: "PASSPORT_TYPE_NOT_FOUND",
        message: `Passport type "${requestedPassportType}" could not be resolved for compliance validation.`,
      });
      return {
        passportType: requestedPassportType || null,
        semanticModelKey: null,
        isBatteryPassport: false,
        completeness: { totalFields: 0, filledFields: 0, missingFields: [], percentage: 0 },
        accessIssues: [issue],
        governanceIssues: [],
        audienceLayerIssues: [],
        profileIssues: [],
        semanticIssues: [],
        requiredFieldIssues: [],
        managedSemanticFields: [],
        managedSemanticIssues: [],
        category: { raw: null, normalized: null, supported: [], focusFields: [], missingFocusFields: [], issues: [] },
        blockingIssues: [issue],
        directReleaseAllowed: false,
        workflowReleaseAllowed: false,
        workflowRequired: false,
      };
    }

    const resolvedPassportType = requestedPassportType || resolvedTypeDef.typeName;
    const profile = resolveProfileMetadata({
      passportType: resolvedPassportType,
      typeDef: resolvedTypeDef,
      granularity: basePassport.granularity,
    });
    const semanticModelKey = resolveProfileSemanticModelKey(resolvedTypeDef, profile);
    const fields = flattenSchemaFields(resolvedTypeDef).map((field) => ({
      ...field,
      __semanticModelKey: semanticModelKey,
      __complianceProfileKey: profile.key,
    }));
    const categoryPolicy = profile.categoryPolicy || null;
    const hasSemanticCategoryPolicy = categoryPolicy?.kind === "semanticCategory";
    const categoryField = hasSemanticCategoryPolicy ? findCategoryField(fields, categoryPolicy) : null;
    const normalizedCategory = hasSemanticCategoryPolicy
      ? normalizeCategoryValue(
        categoryField ? getPassportFieldValue(basePassport, categoryField.key) : null,
        categoryPolicy,
        getSupportedCategories(semanticModelKey, categoryPolicy)
      )
      : null;
    const company = await loadCompanyGovernance(basePassport.companyId || basePassport.company_id);
    const normalizedPassport = applyManagedGovernanceDefaults(basePassport, profile, company);
    const completeness = buildCompleteness(fields, normalizedPassport, { normalizedCategory, semanticModelKey });
    const accessIssues = validateAccess(fields);
    const governanceIssues = validateFieldGovernance(fields);
    const audienceLayerIssues = validateAudienceLayerCoverage(fields, profile);
    const semanticIssues = validateSemanticData(fields, normalizedPassport, { semanticModelKey, profile });
    const category = hasSemanticCategoryPolicy
      ? evaluateCategoryPolicy(fields, normalizedPassport, completeness, { semanticModelKey, categoryPolicy })
      : {
          raw: null,
          normalized: null,
          supported: [],
          policyKind: categoryPolicy?.kind || null,
          productKind: categoryPolicy?.productKind || null,
          fieldKey: null,
          sourceWorkbook: null,
          sheetName: null,
          mandatoryFieldCount: 0,
          voluntaryFieldCount: 0,
          missingMandatoryFields: [],
          missingVoluntaryFields: [],
          ignoredFields: [],
          ruleCoverage: [],
          issues: [],
        };

    const profileIssues = validateProfileGovernance({ passport: normalizedPassport, profile, company });
    const requiredFieldIssues = buildRequiredFieldIssues(completeness, {
      normalizedCategory,
      categoryLabel: categoryPolicy?.label || "category",
    });
    const managedSemantic = evaluateManagedSemanticFields({
      fields,
      passport: normalizedPassport,
      typeDef: resolvedTypeDef,
      company,
      profile,
      normalizedCategory,
      semanticModelKey,
    });
    const blockingIssues = dedupeIssues([
      ...audienceLayerIssues,
      ...semanticIssues,
      ...requiredFieldIssues,
      ...profileIssues,
      ...managedSemantic.issues,
      ...category.issues,
    ]);
    const workflowReleaseAllowed = blockingIssues.length === 0;
    const directReleaseAllowed = workflowReleaseAllowed && completeness.missingFields.length === 0;
    const workflowRequired = workflowReleaseAllowed && completeness.missingFields.length > 0;

    return {
      profile,
      companyIdentity: company ? {
        companyId: company.id,
        companyName: company.companyName || null,
        economicOperatorIdentifier: company.economicOperatorIdentifier || null,
        economicOperatorIdentifierScheme: company.economicOperatorIdentifierScheme || null,
      } : null,
      passportType: resolvedTypeDef.typeName || null,
      semanticModelKey,
      isBatteryPassport: categoryPolicy?.productKind === "battery",
      categoryPolicyKind: categoryPolicy?.kind || null,
      completeness,
      accessIssues,
      governanceIssues,
      audienceLayerIssues,
      profileIssues,
      semanticIssues,
      requiredFieldIssues,
      managedSemanticFields: managedSemantic.managedFields,
      managedSemanticIssues: managedSemantic.issues,
      category,
      blockingIssues,
      directReleaseAllowed,
      workflowReleaseAllowed,
      workflowRequired,
    };
  }

  return {
    loadPassportTypeDefinition,
    evaluatePassport,
    resolveProfileMetadata,
  };
};
