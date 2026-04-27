"use strict";

const VALID_ACCESS_LEVELS = new Set([
  "public",
  "notified_bodies",
  "market_surveillance",
  "eu_commission",
  "legitimate_interest",
  "economic_operator",
  "delegated_operator",
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
  "notified_bodies",
  "market_surveillance",
  "eu_commission",
  "system",
]);

const BATTERY_PASS_PASSPORT_TYPE = "din_spec_99100";
const BATTERY_SEMANTIC_MODEL_KEY = "claros_battery_dictionary_v1";
const APPLICABLE_REQUIREMENT_LEVELS = new Set([
  "mandatory_battreg",
  "mandatory_espr_jtc24",
  "voluntary",
]);

const CATEGORY_ALIASES = new Map([
  ["ev", "EV"],
  ["electricvehicle", "EV"],
  ["electric_vehicle", "EV"],
  ["electric vehicle", "EV"],
  ["lmt", "LMT"],
  ["lightmeansoftransport", "LMT"],
  ["light_means_of_transport", "LMT"],
  ["light means of transport", "LMT"],
  ["industrial", "Industrial"],
  ["stationary", "Stationary"],
  ["stationarystorage", "Stationary"],
  ["stationary_storage", "Stationary"],
  ["stationary storage", "Stationary"],
]);

const PROFILE_CATALOG = {
  generic_dpp_v1: {
    key: "generic_dpp_v1",
    displayName: "Generic DPP Profile v1",
    requiredPassportFields: ["compliance_profile_key", "content_specification_ids"],
    requireCompanyOperatorIdentifier: true,
    requireCarrierPolicy: false,
    requireFacilityAtGranularities: [],
    defaultCarrierPolicyKey: "web_public_entry_v1",
  },
  battery_dpp_v1: {
    key: "battery_dpp_v1",
    displayName: "Battery DPP Profile v1",
    requiredPassportFields: ["compliance_profile_key", "content_specification_ids", "carrier_policy_key"],
    requireCompanyOperatorIdentifier: true,
    requireCarrierPolicy: true,
    requireFacilityAtGranularities: ["batch", "item"],
    defaultCarrierPolicyKey: "battery_qr_public_entry_v1",
  },
};

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
  const sections = typeDef?.fields_json?.sections || [];
  return sections.flatMap((section) =>
    (section.fields || []).map((field) => ({
      ...field,
      section_key: section.key || null,
      section_label: section.label || null,
    }))
  );
}

function parseTableValue(value) {
  if (Array.isArray(value)) return value;
  const text = normalizeText(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
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
  return false;
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
  if (!text || !/[tT]/.test(text)) return false;
  return !Number.isNaN(Date.parse(text));
}

function isDateLike(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return true;
  return !Number.isNaN(Date.parse(text));
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

function normalizeBatteryCategory(value) {
  const normalized = normalizeLookupKey(value);
  if (!normalized) return null;
  return CATEGORY_ALIASES.get(normalized) || null;
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
  return level === "mandatory_battreg" || level === "mandatory_espr_jtc24";
}

module.exports = function createComplianceService({ pool, batteryDictionaryService }) {
  const manifest = batteryDictionaryService.getManifest();
  const categoryRules = batteryDictionaryService.getCategoryRules ? batteryDictionaryService.getCategoryRules() : null;
  const supportedBatteryCategories = Array.isArray(manifest?.batteryCategoryScope)
    ? manifest.batteryCategoryScope
    : ["EV", "LMT", "Industrial", "Stationary"];

  async function loadPassportTypeDefinition(passportType) {
    const result = await pool.query(
      `SELECT id, type_name, display_name, semantic_model_key, fields_json
       FROM passport_types
       WHERE type_name = $1
       LIMIT 1`,
      [passportType]
    );
    return result.rows[0] || null;
  }

  function isBatteryPassport(typeDef, passportType = null) {
    return normalizeText(typeDef?.semantic_model_key).toLowerCase() === BATTERY_SEMANTIC_MODEL_KEY
      || normalizeText(passportType || typeDef?.type_name).toLowerCase() === BATTERY_PASS_PASSPORT_TYPE;
  }

  async function loadCompanyGovernance(companyId) {
    if (!companyId) return null;
    const result = await pool.query(
      `SELECT id, company_name, did_slug, economic_operator_identifier, economic_operator_identifier_scheme
       FROM companies
       WHERE id = $1
       LIMIT 1`,
      [companyId]
    ).catch(() => ({ rows: [] }));
    return result.rows[0] || null;
  }

  function resolveProfileMetadata({ passportType = null, typeDef = null, granularity = null } = {}) {
    const batteryProfile = PROFILE_CATALOG.battery_dpp_v1;
    const genericProfile = PROFILE_CATALOG.generic_dpp_v1;
    const profile = isBatteryPassport(typeDef, passportType) ? batteryProfile : genericProfile;
    return {
      ...profile,
      granularity: String(granularity || "item").trim().toLowerCase() || "item",
      contentSpecificationIds: isBatteryPassport(typeDef, passportType)
        ? [BATTERY_SEMANTIC_MODEL_KEY]
        : [typeDef?.semantic_model_key || "generic_dpp_v1"],
    };
  }

  function findSemanticTermForField(field) {
    if (field?.semanticId && typeof batteryDictionaryService.getTermByIri === "function") {
      const termByIri = batteryDictionaryService.getTermByIri(field.semanticId);
      if (termByIri) return termByIri;
    }
    if (field?.key) {
      const termByField = batteryDictionaryService.getTermByFieldKey(field.key);
      if (termByField) return termByField;
    }
    return null;
  }

  function getCategoryApplicabilityForField(fieldKey, normalizedCategory) {
    if (!normalizedCategory) return null;
    const requirementLevel = batteryDictionaryService.getCategoryRequirementForField
      ? batteryDictionaryService.getCategoryRequirementForField(fieldKey, normalizedCategory)
      : null;
    if (!requirementLevel) return null;
    return {
      requirementLevel,
      applicable: APPLICABLE_REQUIREMENT_LEVELS.has(requirementLevel),
      mandatory: isMandatoryRequirementLevel(requirementLevel),
    };
  }

  function buildCompleteness(fields, passport, options = {}) {
    const normalizedCategory = options.normalizedCategory || null;
    const missingFields = [];
    let filledFields = 0;
    let applicableFields = 0;
    const applicableFieldDetails = [];
    const ignoredFieldDetails = [];

    for (const field of fields) {
      const applicability = getCategoryApplicabilityForField(field.key, normalizedCategory);
      const isApplicable = applicability ? applicability.applicable : true;
      const requirementLevel = applicability?.requirementLevel || null;
      const isMandatory = applicability ? applicability.mandatory : true;

      if (!isApplicable) {
        ignoredFieldDetails.push({
          key: field.key,
          label: field.label || field.key,
          requirementLevel,
          section: field.section_label || field.section_key || null,
        });
        continue;
      }

      applicableFields += 1;
      const value = passport?.[field.key];
      if (hasMeaningfulValue(field, value)) {
        filledFields += 1;
        applicableFieldDetails.push({
          key: field.key,
          label: field.label || field.key,
          requirementLevel,
          mandatory: isMandatory,
          filled: true,
          section: field.section_label || field.section_key || null,
        });
      } else {
        const missingField = {
          key: field.key,
          label: field.label || field.key,
          type: field.type || "text",
          access: Array.isArray(field.access) ? field.access : ["public"],
          requirementLevel,
          mandatory: isMandatory,
          section: field.section_label || field.section_key || null,
        };
        missingFields.push(missingField);
        applicableFieldDetails.push({
          key: field.key,
          label: field.label || field.key,
          requirementLevel,
          mandatory: isMandatory,
          filled: false,
          section: field.section_label || field.section_key || null,
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
          section: field.section_label || field.section_key || null,
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
          section: field.section_label || field.section_key || null,
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
          section: field.section_label || field.section_key || null,
        }));
      } else if (!VALID_CONFIDENTIALITY_LEVELS.has(confidentiality)) {
        issues.push(createIssue({
          code: "FIELD_CONFIDENTIALITY_INVALID",
          message: `Field "${field.label || field.key}" uses unsupported confidentiality value "${field.confidentiality}".`,
          key: field.key,
          label: field.label || field.key,
          section: field.section_label || field.section_key || null,
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
          section: field.section_label || field.section_key || null,
        }));
      } else {
        const invalidAuthorities = updateAuthority.filter((entry) => !VALID_UPDATE_AUTHORITIES.has(entry));
        if (invalidAuthorities.length) {
          issues.push(createIssue({
            code: "FIELD_UPDATE_AUTHORITY_INVALID",
            message: `Field "${field.label || field.key}" uses unsupported updateAuthority values: ${invalidAuthorities.join(", ")}.`,
            key: field.key,
            label: field.label || field.key,
            section: field.section_label || field.section_key || null,
          }));
        }
      }
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
      if (!normalizeText(company?.economic_operator_identifier)) {
        issues.push(createIssue({
          code: "ECONOMIC_OPERATOR_IDENTIFIER_MISSING",
          message: "The company must declare an economic operator identifier before regulated release.",
          key: "economic_operator_identifier",
        }));
      }
      if (!normalizeText(company?.economic_operator_identifier_scheme)) {
        issues.push(createIssue({
          code: "ECONOMIC_OPERATOR_IDENTIFIER_SCHEME_MISSING",
          message: "The company must declare which identifier scheme governs its economic operator identifier.",
          key: "economic_operator_identifier_scheme",
        }));
      }
    }

    if (profile.requireCarrierPolicy && !normalizeText(passport?.carrier_policy_key)) {
      issues.push(createIssue({
        code: "CARRIER_POLICY_MISSING",
        message: `Compliance profile "${profile.displayName}" requires a carrier_policy_key before release.`,
        key: "carrier_policy_key",
      }));
    }

    if ((profile.requireFacilityAtGranularities || []).includes(granularity) && !normalizeText(passport?.facility_id)) {
      issues.push(createIssue({
        code: "FACILITY_IDENTIFIER_MISSING",
        message: `Granularity "${granularity}" requires a facility_id under compliance profile "${profile.displayName}".`,
        key: "facility_id",
      }));
    }

    if (normalizeText(passport?.compliance_profile_key) && normalizeText(passport?.compliance_profile_key) !== profile.key) {
      issues.push(createIssue({
        code: "COMPLIANCE_PROFILE_MISMATCH",
        message: `Passport declares compliance profile "${passport.compliance_profile_key}" but the resolved profile is "${profile.key}".`,
        key: "compliance_profile_key",
      }));
    }

    return issues;
  }

  function validateSemanticData(fields, passport) {
    const issues = [];

    for (const field of fields) {
      const term = findSemanticTermForField(field);
      if (!term) continue;

      if (!isSchemaFieldCompatibleWithTerm(field, term)) {
        issues.push(createIssue({
          code: "SEMANTIC_FIELD_TYPE_MISMATCH",
          message: `Field "${field.label || field.key}" is configured as "${field.type}" but its semantic datatype expects ${formatExpectedType(term)}.`,
          key: field.key,
          label: field.label || field.key,
          expectedType: formatExpectedType(term),
          section: field.section_label || field.section_key || null,
        }));
      }

      const value = passport?.[field.key];
      if (!hasMeaningfulValue(field, value)) continue;

      if (!isValueCompatibleWithTerm(value, term)) {
        issues.push(createIssue({
          code: "SEMANTIC_VALUE_TYPE_MISMATCH",
          message: `Field "${field.label || field.key}" has a value that does not match the semantic datatype ${formatExpectedType(term)}.`,
          key: field.key,
          label: field.label || field.key,
          expectedType: formatExpectedType(term),
          section: field.section_label || field.section_key || null,
        }));
      }
    }

    return issues;
  }

  function evaluateBatteryCategory(fields, passport, completeness) {
    const categoryField = fields.find((field) => field.key === "battery_category")
      || fields.find((field) => normalizeLookupKey(field.label) === "battery category");

    const rawCategory = categoryField ? passport?.[categoryField.key] : null;
    const normalizedCategory = normalizeBatteryCategory(rawCategory);
    const issues = [];

    if (categoryField && hasMeaningfulValue(categoryField, rawCategory) && !normalizedCategory) {
      issues.push(createIssue({
        code: "BATTERY_CATEGORY_UNSUPPORTED",
        message: `Battery category "${rawCategory}" is not one of the supported categories: ${supportedBatteryCategories.join(", ")}.`,
        key: categoryField.key,
        label: categoryField.label || categoryField.key,
        section: categoryField.section_label || categoryField.section_key || null,
      }));
    }
    const ruleCoverage = normalizedCategory
      ? fields
        .map((field) => {
          const applicability = getCategoryApplicabilityForField(field.key, normalizedCategory);
          if (!applicability) return null;
          return {
            key: field.key,
            label: field.label || field.key,
            requirementLevel: applicability.requirementLevel,
            applicable: applicability.applicable,
            mandatory: applicability.mandatory,
            filled: applicability.applicable ? hasMeaningfulValue(field, passport?.[field.key]) : null,
          };
        })
        .filter(Boolean)
      : [];

    return {
      raw: rawCategory || null,
      normalized: normalizedCategory,
      supported: supportedBatteryCategories,
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
    const resolvedTypeDef = providedTypeDef || await loadPassportTypeDefinition(passportType || passport?.passport_type || "");
    if (!resolvedTypeDef) {
      const issue = createIssue({
        code: "PASSPORT_TYPE_NOT_FOUND",
        message: `Passport type "${passportType || passport?.passport_type || ""}" could not be resolved for compliance validation.`,
      });
      return {
        passportType: passportType || passport?.passport_type || null,
        semanticModelKey: null,
        isBatteryPassport: false,
        completeness: { totalFields: 0, filledFields: 0, missingFields: [], percentage: 0 },
        accessIssues: [issue],
        semanticIssues: [],
        category: { raw: null, normalized: null, supported: supportedBatteryCategories, focusFields: [], missingFocusFields: [], issues: [] },
        blockingIssues: [issue],
        directReleaseAllowed: false,
        workflowReleaseAllowed: false,
        workflowRequired: false,
      };
    }

    const fields = flattenSchemaFields(resolvedTypeDef);
    const normalizedCategory = isBatteryPassport(resolvedTypeDef, passportType || passport?.passport_type)
      ? normalizeBatteryCategory((passport || {}).battery_category)
      : null;
    const profile = resolveProfileMetadata({
      passportType: passportType || passport?.passport_type,
      typeDef: resolvedTypeDef,
      granularity: passport?.granularity,
    });
    const company = await loadCompanyGovernance(passport?.company_id);
    const completeness = buildCompleteness(fields, passport || {}, { normalizedCategory });
    const accessIssues = validateAccess(fields);
    const governanceIssues = validateFieldGovernance(fields);
    const semanticIssues = validateSemanticData(fields, passport || {});
    const batteryCategory = isBatteryPassport(resolvedTypeDef, passportType || passport?.passport_type)
      ? evaluateBatteryCategory(fields, passport || {}, completeness)
      : {
          raw: null,
          normalized: null,
          supported: supportedBatteryCategories,
          sourceWorkbook: categoryRules?.sourceWorkbook || null,
          sheetName: categoryRules?.sheetName || null,
          mandatoryFieldCount: 0,
          voluntaryFieldCount: 0,
          missingMandatoryFields: [],
          missingVoluntaryFields: [],
          ignoredFields: [],
          ruleCoverage: [],
          issues: [],
        };

    const profileIssues = validateProfileGovernance({ passport: passport || {}, profile, company });
    const blockingIssues = [...accessIssues, ...governanceIssues, ...semanticIssues, ...profileIssues, ...batteryCategory.issues];
    const workflowReleaseAllowed = blockingIssues.length === 0;
    const directReleaseAllowed = workflowReleaseAllowed && completeness.missingFields.length === 0;
    const workflowRequired = workflowReleaseAllowed && completeness.missingFields.length > 0;

    return {
      profile,
      companyIdentity: company ? {
        companyId: company.id,
        companyName: company.company_name || null,
        economicOperatorIdentifier: company.economic_operator_identifier || null,
        economicOperatorIdentifierScheme: company.economic_operator_identifier_scheme || null,
      } : null,
      passportType: resolvedTypeDef.type_name,
      semanticModelKey: resolvedTypeDef.semantic_model_key || null,
      isBatteryPassport: isBatteryPassport(resolvedTypeDef, passportType || passport?.passport_type),
      completeness,
      accessIssues,
      governanceIssues,
      profileIssues,
      semanticIssues,
      category: batteryCategory,
      blockingIssues,
      directReleaseAllowed,
      workflowReleaseAllowed,
      workflowRequired,
    };
  }

  return {
    loadPassportTypeDefinition,
    evaluatePassport,
    isBatteryPassport,
    resolveProfileMetadata,
  };
};
