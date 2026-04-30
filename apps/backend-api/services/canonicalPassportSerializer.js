"use strict";

const batteryDictionaryFieldMap = require("../resources/semantics/battery/v1/field-map.json");
const batteryDictionaryTerms = require("../resources/semantics/battery/v1/terms.json");
const batteryCategoryRules = require("../resources/semantics/battery/v1/category-rules.json");
const { buildCarrierAuthenticityResponseFields } = require("../helpers/carrier-authenticity");
const {
  BATTERY_DICTIONARY_MODEL_KEY,
  LEGACY_BATTERY_PASSPORT_TYPE,
  shouldUseBatteryDictionary: shouldTargetBatteryDictionary,
} = require("./battery-dictionary-targeting");

function createCanonicalPassportSerializer({ didService, productIdentifierService = null }) {
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
  const SUPPORTED_BATTERY_CATEGORIES = Array.isArray(batteryCategoryRules?.categories)
    ? batteryCategoryRules.categories
    : ["EV", "LMT", "Industrial", "Stationary"];
  const HEADER_FIELD_ALIASES = {
    granularity: new Set(["granularity", "dpp_granularity", "dppgranularity"]),
    dppSchemaVersion: new Set(["dpp_schema_version", "dppschemaversion"]),
    dppStatus: new Set(["dpp_status", "dppstatus"]),
    economicOperatorId: new Set([
      "economic_operator_id",
      "economic_operator_identifier",
      "economicoperatorid",
      "economicoperatoridentifier",
    ]),
    facilityId: new Set([
      "facility_id",
      "facility_identifier",
      "facilityid",
      "facilityidentifier",
    ]),
    contentSpecificationIds: new Set([
      "content_specification_ids",
      "content_specification_id",
      "contentspecificationids",
      "contentspecificationid",
    ]),
  };

  function toIsoTimestamp(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function toTitleCaseGranularity(value) {
    const normalized = String(value || "model").trim().toLowerCase();
    if (!normalized) return "Model";
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  function toDppStatus(releaseStatus) {
    const normalized = String(releaseStatus || "").trim().toLowerCase();
    if (normalized === "released") return "Active";
    if (normalized === "active") return "Active";
    if (normalized === "archived") return "Archived";
    if (normalized === "invalid") return "Invalid";
    if (normalized === "obsolete") return "Inactive";
    if (normalized === "inactive") return "Inactive";
    if (["draft", "in_review", "in_revision", "revised"].includes(normalized)) return "Inactive";
    return "Invalid";
  }

  function buildClarosExtensions({ passportType = null, versionNumber = null, internalId = null } = {}) {
    const claros = {};
    if (passportType) claros.passportType = passportType;
    if (versionNumber !== null && versionNumber !== undefined) claros.versionNumber = versionNumber;
    if (internalId) claros.internalId = internalId;
    return Object.keys(claros).length ? { claros } : null;
  }

  function looksLikeJson(value) {
    const text = String(value || "").trim();
    return (text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"));
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeLookupKey(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function parseBoolean(value) {
    if (typeof value === "boolean") return value;
    const normalized = normalizeText(value).toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
    return value;
  }

  function parseNumeric(value, integerOnly = false) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return integerOnly ? Math.trunc(value) : value;
    }
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return value;
    const parsed = integerOnly ? Number.parseInt(trimmed, 10) : Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }

  function parseArrayValue(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (looksLikeJson(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : value;
      } catch {
        return value;
      }
    }
    return trimmed.split(",").map((entry) => entry.trim()).filter(Boolean);
  }

  function coerceTypedFieldValue(fieldDef, rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === "") return null;
    if (typeof rawValue === "number" || typeof rawValue === "boolean") return rawValue;
    if (Array.isArray(rawValue)) return rawValue;
    if (typeof rawValue === "object") return rawValue;

    if (fieldDef?.type === "boolean" || fieldDef?.dataType === "boolean") {
      return parseBoolean(rawValue);
    }

    if (fieldDef?.type === "table") {
      if (looksLikeJson(rawValue)) {
        try {
          return JSON.parse(rawValue);
        } catch {
          return rawValue;
        }
      }
      return rawValue;
    }

    if (fieldDef?.dataType === "number") return parseNumeric(rawValue, false);
    if (fieldDef?.dataType === "integer") return parseNumeric(rawValue, true);

    if (looksLikeJson(rawValue)) {
      try {
        return JSON.parse(rawValue);
      } catch {
        return rawValue;
      }
    }

    return rawValue;
  }

  function getSchemaFieldDefinitions(typeDef) {
    return (typeDef?.fields_json?.sections || [])
      .flatMap((section) => section.fields || [])
      .filter((field) => field?.key);
  }

  function findSchemaFieldDefinition(typeDef, elementIdPath) {
    return getSchemaFieldDefinitions(typeDef).find((field) =>
      field.key === elementIdPath
      || field.semanticId === elementIdPath
      || field.semantic_id === elementIdPath
      || field.elementId === elementIdPath
      || field.element_id === elementIdPath
    ) || null;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isScalarValue(value) {
    return value === null
      || value === undefined
      || typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean";
  }

  const semanticIdByAlias = (() => {
    const map = new Map();
    for (const [fieldKey, iri] of Object.entries(batteryDictionaryFieldMap || {})) {
      if (fieldKey && iri) map.set(String(fieldKey), iri);
    }
    for (const term of batteryDictionaryTerms || []) {
      const semanticId = term?.iri || term?.termIri || null;
      if (!semanticId) continue;
      const aliases = new Set([
        term.slug,
        term.internalKey,
        term.internal_key,
        term.elementId,
        term.element_id,
      ]);
      for (const fieldKey of (term.appFieldKeys || [])) {
        aliases.add(fieldKey);
      }
      for (const alias of aliases) {
        if (alias) map.set(String(alias), semanticId);
      }
    }
    return map;
  })();

  const semanticTermByAlias = (() => {
    const map = new Map();
    for (const term of batteryDictionaryTerms || []) {
      const aliases = new Set([
        term.slug,
        term.internalKey,
        term.internal_key,
        term.elementId,
        term.element_id,
      ]);
      for (const fieldKey of (term.appFieldKeys || [])) {
        aliases.add(fieldKey);
      }
      for (const alias of aliases) {
        if (alias) map.set(String(alias), term);
      }
    }
    return map;
  })();

  function resolveDictionaryReference(fieldDef, elementIdPath = null) {
    const explicitReference = fieldDef?.semanticId || fieldDef?.semantic_id || null;
    if (explicitReference) return explicitReference;

    const candidates = [
      fieldDef?.key,
      fieldDef?.elementId,
      fieldDef?.element_id,
      elementIdPath,
    ].filter(Boolean);

    for (const candidate of candidates) {
      const resolved = semanticIdByAlias.get(String(candidate));
      if (resolved) return resolved;
    }

    return null;
  }

  function resolveSemanticTerm(fieldDef, elementIdPath = null) {
    const explicitReference = fieldDef?.semanticId || fieldDef?.semantic_id || null;
    if (explicitReference) {
      const byReference = batteryDictionaryTerms.find((term) =>
        term?.iri === explicitReference || term?.termIri === explicitReference
      );
      if (byReference) return byReference;
    }

    const candidates = [
      fieldDef?.key,
      fieldDef?.elementId,
      fieldDef?.element_id,
      elementIdPath,
    ].filter(Boolean);

    for (const candidate of candidates) {
      const term = semanticTermByAlias.get(String(candidate));
      if (term) return term;
    }

    return null;
  }

  function isBlankValue(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return normalizeText(value) === "";
    if (Array.isArray(value)) return value.length === 0;
    if (isPlainObject(value)) return Object.keys(value).length === 0;
    return false;
  }

  function isNumericString(value) {
    return /^-?\d+(\.\d+)?$/.test(normalizeText(value));
  }

  function isIntegerString(value) {
    return /^-?\d+$/.test(normalizeText(value));
  }

  function isDateTimeLike(value) {
    const text = normalizeText(value);
    if (!text || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return false;
    return !Number.isNaN(Date.parse(text));
  }

  function isDateLike(value) {
    const text = normalizeText(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const parsed = new Date(`${text}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
  }

  function isYearMonthLike(value) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(normalizeText(value));
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

  function isMultiLanguageValue(value) {
    if (!isPlainObject(value)) return false;
    const entries = Object.entries(value);
    if (!entries.length) return false;
    return entries.every(([key, entryValue]) =>
      isLanguageTagLike(key) && (typeof entryValue === "string" || typeof entryValue === "number" || typeof entryValue === "boolean")
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

  function isRelatedResourceValue(fieldDef, value) {
    const fieldType = normalizeText(fieldDef?.type).toLowerCase();
    if (["url", "file", "symbol"].includes(fieldType)) return true;
    if (isPlainObject(value)) {
      return ["url", "uri", "href", "src", "downloadUrl", "fileName", "mimeType"]
        .some((key) => Object.prototype.hasOwnProperty.call(value, key));
    }
    return false;
  }

  function isBase64BinaryLike(value) {
    const text = normalizeText(value);
    if (!text) return false;
    return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text);
  }

  function normalizeBatteryCategory(value) {
    const normalized = normalizeLookupKey(value);
    if (!normalized) return null;
    return CATEGORY_ALIASES.get(normalized) || null;
  }

  function isBatteryDictionaryPassport(typeDef, passportType = null) {
    return shouldTargetBatteryDictionary({ passportType, typeDef });
  }

  function isMandatoryRequirementLevel(level) {
    return level === "mandatory_battreg" || level === "mandatory_espr_jtc24";
  }

  function getCategoryRequirementForField(fieldKey, normalizedCategory) {
    if (!fieldKey || !normalizedCategory) return null;
    const requirementLevel = batteryCategoryRules?.requirementsByFieldKey?.[String(fieldKey)]?.requirements?.[normalizedCategory] || null;
    if (!requirementLevel) return null;
    return {
      requirementLevel,
      applicable: APPLICABLE_REQUIREMENT_LEVELS.has(requirementLevel),
      mandatory: isMandatoryRequirementLevel(requirementLevel),
    };
  }

  function findPassportCategoryField(typeDef) {
    return getSchemaFieldDefinitions(typeDef).find((field) =>
      field?.key === "battery_category"
      || field?.semanticId === "https://www.claros-dpp.online/dictionary/battery/v1/terms/battery-category"
      || field?.semantic_id === "https://www.claros-dpp.online/dictionary/battery/v1/terms/battery-category"
      || normalizeLookupKey(field?.label) === "battery category"
    ) || null;
  }

  function resolveNormalizedBatteryCategory(passport, typeDef) {
    const categoryField = findPassportCategoryField(typeDef);
    const rawCategory = categoryField?.key ? passport?.[categoryField.key] : passport?.battery_category;
    return {
      raw: rawCategory || null,
      normalized: normalizeBatteryCategory(rawCategory),
    };
  }

  function coerceValueToSemanticType(value, term) {
    if (!term || isBlankValue(value)) return value;

    const jsonType = normalizeText(term?.dataType?.jsonType).toLowerCase();
    const xsdType = normalizeText(term?.dataType?.xsdType).toLowerCase();

    if (jsonType === "boolean" || xsdType.endsWith(":boolean")) {
      return parseBoolean(value);
    }
    if (jsonType === "number" || xsdType.endsWith(":decimal")) {
      return parseNumeric(value, false);
    }
    if (jsonType === "integer" || xsdType.endsWith(":integer") || xsdType.endsWith(":int")) {
      return parseNumeric(value, true);
    }
    if (xsdType.endsWith(":datetime")) {
      const isoValue = value instanceof Date ? value.toISOString() : toIsoTimestamp(value);
      return isoValue || value;
    }
    if (xsdType.endsWith(":date")) {
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
      }
      const text = normalizeText(value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
      const parsed = new Date(text);
      return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
    }
    if (xsdType.endsWith(":gyearmonth")) {
      const text = normalizeText(value);
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return text;
      if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(text)) return text.slice(0, 7);
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) return value;
      return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
    }
    if (xsdType.endsWith(":anyuri")) {
      return normalizeText(value);
    }
    if (xsdType.endsWith(":base64binary")) {
      if (Buffer.isBuffer(value)) return value.toString("base64");
      return normalizeText(value);
    }
    if (jsonType === "string" || xsdType.endsWith(":string")) {
      return typeof value === "string" ? value : String(value);
    }

    return value;
  }

  function buildSemanticValidationIssues(value, term, fieldDef, key, options = {}) {
    if (!term || isBlankValue(value)) return [];

    const issues = [];
    const jsonType = normalizeText(term?.dataType?.jsonType).toLowerCase();
    const xsdType = normalizeText(term?.dataType?.xsdType).toLowerCase();
    const cardinality = normalizeText(term?.cardinality || term?.valueCardinality).toLowerCase();
    const pattern = normalizeText(term?.pattern || term?.valuePattern);
    const unit = normalizeText(term?.unit).toLowerCase();

    const pushIssue = (code, message, extras = {}) => {
      issues.push({
        key,
        code,
        message,
        dictionaryReference: resolveDictionaryReference(fieldDef, key),
        ...extras,
      });
    };

    if (cardinality) {
      const expectsMany = ["many", "multiple", "multi", "array", "set", "list"].includes(cardinality);
      const expectsOne = ["one", "single", "scalar"].includes(cardinality);
      if (expectsMany && !Array.isArray(value)) {
        pushIssue("SEMANTIC_CARDINALITY_MISMATCH", `Expected multiple values for "${key}" but found a single value.`);
      }
      if (expectsOne && Array.isArray(value)) {
        pushIssue("SEMANTIC_CARDINALITY_MISMATCH", `Expected a single value for "${key}" but found multiple values.`);
      }
    }

    if (Array.isArray(value) && hasMixedArrayItemTypes(value)) {
      pushIssue("SEMANTIC_ARRAY_ITEM_TYPE_MISMATCH", `Array value for "${key}" contains mixed JSON item types.`);
    }

    const isMultiLanguageFieldValue = (isExplicitMultiLanguageField(fieldDef) || isMultiLanguageValue(value)) && isPlainObject(value);

    if (jsonType === "boolean" || xsdType.endsWith(":boolean")) {
      if (typeof value !== "boolean") {
        pushIssue("SEMANTIC_TYPE_MISMATCH", `Expected boolean value for "${key}".`);
      }
    } else if (jsonType === "number" || xsdType.endsWith(":decimal")) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        pushIssue("SEMANTIC_TYPE_MISMATCH", `Expected decimal number value for "${key}".`);
      }
    } else if (jsonType === "integer" || xsdType.endsWith(":integer") || xsdType.endsWith(":int")) {
      if (!Number.isInteger(value)) {
        pushIssue("SEMANTIC_TYPE_MISMATCH", `Expected integer value for "${key}".`);
      }
    } else if (xsdType.endsWith(":datetime")) {
      if (typeof value !== "string" || !isDateTimeLike(value)) {
        pushIssue("SEMANTIC_TYPE_MISMATCH", `Expected xsd:dateTime string for "${key}".`);
      }
    } else if (xsdType.endsWith(":date")) {
      if (typeof value !== "string" || !isDateLike(value)) {
        pushIssue("SEMANTIC_TYPE_MISMATCH", `Expected xsd:date string for "${key}".`);
      }
    } else if (xsdType.endsWith(":gyearmonth")) {
      if (typeof value !== "string" || !isYearMonthLike(value)) {
        pushIssue("SEMANTIC_TYPE_MISMATCH", `Expected xsd:gYearMonth string for "${key}".`);
      }
    } else if (xsdType.endsWith(":anyuri")) {
      if (typeof value !== "string" || !isUriLike(value)) {
        pushIssue("SEMANTIC_TYPE_MISMATCH", `Expected xsd:anyURI string for "${key}".`);
      }
    } else if (xsdType.endsWith(":base64binary")) {
      if (typeof value !== "string" || !isBase64BinaryLike(value)) {
        pushIssue("SEMANTIC_TYPE_MISMATCH", `Expected xsd:base64Binary string for "${key}".`);
      }
    } else if ((jsonType === "string" || xsdType.endsWith(":string")) && !isMultiLanguageFieldValue) {
      if (typeof value !== "string") {
        pushIssue("SEMANTIC_TYPE_MISMATCH", `Expected string value for "${key}".`);
      }
    }

    if (pattern && typeof value === "string") {
      try {
        const regex = new RegExp(pattern);
        if (!regex.test(value)) {
          pushIssue("SEMANTIC_PATTERN_MISMATCH", `Value for "${key}" does not match its declared pattern.`);
        }
      } catch {
        // Ignore malformed repository patterns rather than breaking export.
      }
    }

    if (unit && unit !== "none" && isPlainObject(value) && value.unit && normalizeText(value.unit).toLowerCase() !== unit) {
      pushIssue("SEMANTIC_UNIT_MISMATCH", `Value for "${key}" uses unit "${value.unit}" but dictionary expects "${term.unit}".`);
    }

    const explicitAllowedValues = resolveAllowedValues(fieldDef, term, options);
    if (explicitAllowedValues.length) {
      const invalidValues = extractDisallowedValues(value, explicitAllowedValues);
      if (invalidValues.length) {
        pushIssue(
          "SEMANTIC_ALLOWED_VALUE_MISMATCH",
          `Value for "${key}" must be one of: ${explicitAllowedValues.join(", ")}.`,
          { allowedValues: explicitAllowedValues, invalidValues }
        );
      }
    }

    const multiLanguageIssues = buildLanguageTagValidationIssues(value, fieldDef, key);
    if (multiLanguageIssues.length) {
      issues.push(...multiLanguageIssues.map((issue) => ({
        ...issue,
        dictionaryReference: resolveDictionaryReference(fieldDef, key),
      })));
    }

    return issues;
  }

  function isRequiredField(fieldDef, categoryRequirement = null) {
    if (categoryRequirement?.applicable && categoryRequirement.mandatory) return true;
    return fieldDef?.required === true || fieldDef?.mandatory === true;
  }

  function normalizeAllowedOptionValue(option) {
    if (option === null || option === undefined) return null;
    if (typeof option === "string" || typeof option === "number" || typeof option === "boolean") {
      return String(option);
    }
    if (typeof option === "object") {
      if (option.value !== undefined && option.value !== null) return String(option.value);
      if (option.key !== undefined && option.key !== null) return String(option.key);
      if (option.id !== undefined && option.id !== null) return String(option.id);
      if (option.label !== undefined && option.label !== null) return String(option.label);
    }
    return null;
  }

  function resolveAllowedValues(fieldDef, semanticTerm = null, options = {}) {
    const values = new Set();
    const fieldOptions = Array.isArray(fieldDef?.options)
      ? fieldDef.options
      : (Array.isArray(fieldDef?.choices) ? fieldDef.choices : []);
    for (const option of fieldOptions) {
      const normalized = normalizeAllowedOptionValue(option);
      if (normalized !== null) values.add(normalized);
    }

    const normalizedKeyCandidates = new Set([
      fieldDef?.key,
      fieldDef?.elementId,
      fieldDef?.element_id,
      semanticTerm?.internalKey,
      semanticTerm?.internal_key,
      ...(semanticTerm?.appFieldKeys || []),
    ].filter(Boolean));

    if (
      normalizedKeyCandidates.has("battery_category")
      || normalizeLookupKey(fieldDef?.label) === "battery category"
      || semanticTerm?.slug === "battery-category"
    ) {
      SUPPORTED_BATTERY_CATEGORIES.forEach((entry) => values.add(entry));
    }

    return [...values];
  }

  function extractDisallowedValues(value, allowedValues) {
    if (!allowedValues.length || isBlankValue(value)) return [];
    const allowedLookup = new Map(allowedValues.map((entry) => [normalizeText(entry).toLowerCase(), entry]));
    const valuesToCheck = Array.isArray(value) ? value : [value];
    return valuesToCheck.filter((entry) => {
      if (entry === null || entry === undefined) return false;
      return !allowedLookup.has(normalizeText(entry).toLowerCase());
    });
  }

  function isExplicitMultiLanguageField(fieldDef) {
    const key = normalizeText(fieldDef?.key).toLowerCase();
    return resolveExplicitObjectType(fieldDef) === "MultiLanguageDataElement"
      || key.endsWith("_i18n")
      || key.endsWith("_intl")
      || key.includes("multilang")
      || key.includes("localized");
  }

  function buildLanguageTagValidationIssues(value, fieldDef, key) {
    const issues = [];
    const shouldValidateLanguageTags = isExplicitMultiLanguageField(fieldDef) || isMultiLanguageValue(value);
    if (!shouldValidateLanguageTags || !isPlainObject(value)) return issues;

    const pushIssue = (code, message, extras = {}) => {
      issues.push({
        key,
        code,
        message,
        ...extras,
      });
    };

    for (const [languageTag, localizedValue] of Object.entries(value)) {
      if (!isLanguageTagLike(languageTag)) {
        pushIssue(
          "SEMANTIC_LANGUAGE_TAG_INVALID",
          `Value for "${key}" uses invalid language tag "${languageTag}".`,
          { languageTag }
        );
      }
      if (!isScalarValue(localizedValue)) {
        pushIssue(
          "SEMANTIC_MULTILANGUAGE_VALUE_INVALID",
          `Value for "${key}" contains non-scalar content for language tag "${languageTag}".`,
          { languageTag }
        );
      }
    }

    return issues;
  }

  function buildSchemaValidationIssues(value, fieldDef, key, options = {}) {
    if (isBlankValue(value)) return [];

    const issues = [];
    const normalizedDataType = normalizeText(fieldDef?.dataType).toLowerCase();
    const normalizedFieldType = normalizeText(fieldDef?.type).toLowerCase();
    const expectedUnit = normalizeText(fieldDef?.unit).toLowerCase();
    const skipTypeValidation = options.skipTypeValidation === true;

    const pushIssue = (code, message, extras = {}) => {
      issues.push({
        key,
        code,
        message,
        dictionaryReference: resolveDictionaryReference(fieldDef, key),
        ...extras,
      });
    };

    if (Array.isArray(value) && hasMixedArrayItemTypes(value)) {
      pushIssue("FIELD_ARRAY_ITEM_TYPE_MISMATCH", `Array value for "${key}" contains mixed JSON item types.`);
    }

    if (!skipTypeValidation && (normalizedDataType === "boolean" || normalizedFieldType === "boolean")) {
      if (typeof value !== "boolean") {
        pushIssue("FIELD_TYPE_MISMATCH", `Expected boolean value for "${key}".`);
      }
    } else if (!skipTypeValidation && normalizedDataType === "integer") {
      if (!Number.isInteger(value)) {
        pushIssue("FIELD_TYPE_MISMATCH", `Expected integer value for "${key}".`);
      }
    } else if (!skipTypeValidation && (normalizedDataType === "number" || normalizedDataType === "decimal")) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        pushIssue("FIELD_TYPE_MISMATCH", `Expected decimal number value for "${key}".`);
      }
    } else if (!skipTypeValidation && (normalizedDataType === "date" || normalizedFieldType === "date")) {
      if (typeof value !== "string" || !isDateLike(value)) {
        pushIssue("FIELD_TYPE_MISMATCH", `Expected date-compatible value for "${key}".`);
      }
    } else if (!skipTypeValidation && normalizedDataType === "datetime") {
      if (typeof value !== "string" || !isDateTimeLike(value)) {
        pushIssue("FIELD_TYPE_MISMATCH", `Expected date-time-compatible value for "${key}".`);
      }
    } else if (!skipTypeValidation && (normalizedDataType === "uri" || normalizedFieldType === "url")) {
      if (typeof value !== "string" || !isUriLike(value)) {
        pushIssue("FIELD_TYPE_MISMATCH", `Expected URL/URI value for "${key}".`);
      }
    }

    const explicitAllowedValues = resolveAllowedValues(fieldDef);
    if (explicitAllowedValues.length) {
      const invalidValues = extractDisallowedValues(value, explicitAllowedValues);
      if (invalidValues.length) {
        pushIssue(
          "FIELD_ALLOWED_VALUE_MISMATCH",
          `Value for "${key}" must be one of: ${explicitAllowedValues.join(", ")}.`,
          { allowedValues: explicitAllowedValues, invalidValues }
        );
      }
    }

    const multiLanguageIssues = buildLanguageTagValidationIssues(value, fieldDef, key);
    issues.push(...multiLanguageIssues.map((issue) => ({
      ...issue,
      dictionaryReference: resolveDictionaryReference(fieldDef, key),
    })));

    if (expectedUnit && expectedUnit !== "none" && isPlainObject(value) && value.unit && normalizeText(value.unit).toLowerCase() !== expectedUnit) {
      pushIssue("FIELD_UNIT_MISMATCH", `Value for "${key}" uses unit "${value.unit}" but field metadata expects "${fieldDef.unit}".`);
    }

    return issues;
  }

  function summarizeValidationIssues(issues = []) {
    const countsByCode = {};
    for (const issue of issues) {
      countsByCode[issue.code] = (countsByCode[issue.code] || 0) + 1;
    }
    return {
      valid: issues.length === 0,
      issueCount: issues.length,
      countsByCode,
    };
  }

  function inferValueDataType(fieldDef, value, semanticTerm = null) {
    const semanticJsonType = normalizeText(semanticTerm?.dataType?.jsonType).toLowerCase();
    const semanticXsdType = normalizeText(semanticTerm?.dataType?.xsdType).toLowerCase();

    if (semanticJsonType === "boolean" || semanticXsdType.endsWith(":boolean")) return "Boolean";
    if (semanticJsonType === "integer" || semanticXsdType.endsWith(":integer") || semanticXsdType.endsWith(":int")) return "Integer";
    if (semanticJsonType === "number" || semanticXsdType.endsWith(":decimal")) return "Decimal";
    if (semanticXsdType.endsWith(":datetime")) return "DateTime";
    if (semanticXsdType.endsWith(":date")) return "Date";
    if (semanticXsdType.endsWith(":gyearmonth")) return "YearMonth";
    if (semanticXsdType.endsWith(":anyuri")) return "URI";
    if (semanticXsdType.endsWith(":base64binary")) return "Base64Binary";

    const normalizedDataType = String(fieldDef?.dataType || "").trim().toLowerCase();
    const normalizedFieldType = String(fieldDef?.type || "").trim().toLowerCase();

    if (normalizedDataType === "boolean" || normalizedFieldType === "boolean" || typeof value === "boolean") {
      return "Boolean";
    }
    if (normalizedDataType === "integer") return "Integer";
    if (normalizedDataType === "number" || normalizedDataType === "decimal" || typeof value === "number") {
      return Number.isInteger(value) ? "Integer" : "Decimal";
    }
    if (normalizedFieldType === "date") return "Date";
    if (normalizedFieldType === "url") return "URI";
    if (normalizedFieldType === "file") return "Binary";
    if (normalizedFieldType === "table") {
      if (Array.isArray(value)) return "Array";
      return "Object";
    }
    if (Array.isArray(value)) return "Array";
    if (isPlainObject(value)) return "Object";
    return "String";
  }

  function normalizeExpandedObjectType(valueKind) {
    const normalized = normalizeText(valueKind).toLowerCase();
    if (!normalized) return null;

    if ([
      "dataelementcollection",
      "collection",
      "object",
    ].includes(normalized)) return "DataElementCollection";

    if ([
      "singlevalueddataelement",
      "single",
      "scalar",
    ].includes(normalized)) return "SingleValuedDataElement";

    if ([
      "multivalueddataelement",
      "multi",
      "multiple",
      "array",
      "list",
    ].includes(normalized)) return "MultiValuedDataElement";

    if ([
      "relatedresource",
      "related_resource",
      "resource",
      "uri_resource",
    ].includes(normalized)) return "RelatedResource";

    if ([
      "multilanguagedataelement",
      "multilanguage",
      "multi_language",
      "multilingual",
      "i18n",
      "localized",
    ].includes(normalized)) return "MultiLanguageDataElement";

    return null;
  }

  function resolveExplicitObjectType(fieldDef) {
    return normalizeExpandedObjectType(
      fieldDef?.expandedObjectType
      || fieldDef?.objectTypeHint
      || fieldDef?.valueKind
      || fieldDef?.value_kind
      || fieldDef?.objectType
    );
  }

  function inferObjectType(fieldDef, value) {
    const explicitObjectType = resolveExplicitObjectType(fieldDef);
    if (explicitObjectType) return explicitObjectType;
    if (isRelatedResourceValue(fieldDef, value)) return "RelatedResource";
    if (isMultiLanguageValue(value)) return "MultiLanguageDataElement";
    if (Array.isArray(value)) return "MultiValuedDataElement";
    if (isPlainObject(value)) return "DataElementCollection";
    return "SingleValuedDataElement";
  }

  function buildNestedElements(value) {
    if (Array.isArray(value)) {
      return value.map((item, index) => buildExpandedDataElement({
        elementIdPath: String(index),
        value: item,
      }));
    }
    if (isPlainObject(value)) {
      return Object.entries(value).map(([childKey, childValue]) => buildExpandedDataElement({
        elementIdPath: childKey,
        value: childValue,
      }));
    }
    return [];
  }

  function buildExpandedDataElement({ typeDef = null, elementIdPath, value, fieldDef = null } = {}) {
    const resolvedFieldDef = fieldDef || findSchemaFieldDefinition(typeDef, elementIdPath);
    const semanticTerm = resolveSemanticTerm(resolvedFieldDef, elementIdPath);
    const resolvedElementId = resolvedFieldDef?.elementId
      || resolvedFieldDef?.element_id
      || resolvedFieldDef?.key
      || elementIdPath
      || null;
    return {
      elementId: resolvedElementId,
      objectType: inferObjectType(resolvedFieldDef, value),
      dictionaryReference: resolveDictionaryReference(resolvedFieldDef, elementIdPath),
      valueDataType: inferValueDataType(resolvedFieldDef, value, semanticTerm),
      value,
      elements: buildNestedElements(value),
    };
  }

  function findHeaderAliasValue(fieldValues, aliasSet) {
    for (const [fieldKey, value] of Object.entries(fieldValues)) {
      const compactKey = String(fieldKey || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (aliasSet.has(fieldKey) || aliasSet.has(compactKey)) {
        return value;
      }
    }
    return null;
  }

  function buildCanonicalPassportPayload(passport, typeDef, options = {}) {
    const publicOrigin = didService?.getPublicOrigin?.() || "http://localhost:3000";
    const company = options.company || null;
    const passportType = String(passport?.passport_type || typeDef?.type_name || options.passportType || "battery").trim().toLowerCase() || "battery";
    const didPassportType = "battery";
    const stableId = didService?.normalizeStableId?.(passport?.lineage_id || passport?.dppId || passport?.dpp_id || passport?.guid);
    const resolvedGranularity = String(
      options.granularity
      || findHeaderAliasValue(passport || {}, HEADER_FIELD_ALIASES.granularity)
      || passport?.granularity
      || company?.dpp_granularity
      || "model"
    ).trim().toLowerCase() || "model";
    const companySlug = company?.did_slug
      ? didService.normalizeCompanySlug(company.did_slug)
      : didService.normalizeCompanySlug(company?.company_name || `company-${passport.company_id}`);
    const companyDid = didService.generateCompanyDid(companySlug);
    const subjectDid = resolvedGranularity === "item"
      ? didService.generateItemDid(didPassportType, stableId)
      : didService.generateModelDid(didPassportType, stableId);
    const dppDid = didService.generateDppDid(resolvedGranularity, stableId);
    const derivedProductIdentifierDid = passport?.product_id
      ? productIdentifierService?.buildCanonicalProductDid?.({
          companyId: passport.company_id,
          passportType,
          rawProductId: passport.product_id,
          granularity: resolvedGranularity,
        }) || null
      : null;

    const schemaFields = (typeDef?.fields_json?.sections || [])
      .flatMap((section) => section.fields || [])
      .filter((field) => field?.key);

    const fields = {};
    const validationIssues = [];
    const categoryInfo = isBatteryDictionaryPassport(typeDef, passportType)
      ? resolveNormalizedBatteryCategory(passport, typeDef)
      : { raw: null, normalized: null };
    for (const fieldDef of schemaFields) {
      const semanticTerm = resolveSemanticTerm(fieldDef, fieldDef.key);
      const categoryRequirement = categoryInfo.normalized
        ? getCategoryRequirementForField(fieldDef.key, categoryInfo.normalized)
        : null;
      if (isBatteryDictionaryPassport(typeDef, passportType) && !semanticTerm) {
        validationIssues.push({
          key: fieldDef.key,
          code: "SEMANTIC_TERM_NOT_FOUND",
          message: `Field "${fieldDef.key}" is not mapped to a dictionary term in terms.json.`,
          dictionaryReference: resolveDictionaryReference(fieldDef, fieldDef.key),
        });
        continue;
      }
      const rawValue = passport?.[fieldDef.key];
      if (isRequiredField(fieldDef, categoryRequirement) && isBlankValue(rawValue)) {
        validationIssues.push({
          key: fieldDef.key,
          code: categoryRequirement?.mandatory
            ? "CATEGORY_REQUIRED_FIELD_MISSING"
            : "REQUIRED_FIELD_MISSING",
          message: categoryRequirement?.mandatory
            ? `Field "${fieldDef.key}" is mandatory for battery category "${categoryInfo.normalized}" but is missing from the export.`
            : `Field "${fieldDef.key}" is required but is missing from the export.`,
          dictionaryReference: resolveDictionaryReference(fieldDef, fieldDef.key),
          ...(categoryRequirement?.requirementLevel ? { requirementLevel: categoryRequirement.requirementLevel } : {}),
          ...(categoryInfo.normalized ? { batteryCategory: categoryInfo.normalized } : {}),
        });
      }
      const typedValue = coerceValueToSemanticType(
        coerceTypedFieldValue(fieldDef, rawValue),
        semanticTerm
      );
      if (typedValue === null) continue;
      const issues = [
        ...buildSemanticValidationIssues(typedValue, semanticTerm, fieldDef, fieldDef.key, {
          batteryCategory: categoryInfo.normalized,
        }),
        ...buildSchemaValidationIssues(typedValue, fieldDef, fieldDef.key, {
          skipTypeValidation: Boolean(semanticTerm),
        }),
      ];
      if (issues.length) {
        validationIssues.push(...issues);
        continue;
      }
      fields[fieldDef.key] = typedValue;
    }

    const dppSchemaVersion = findHeaderAliasValue(fields, HEADER_FIELD_ALIASES.dppSchemaVersion) || passport?.dpp_schema_version || "prEN 18223:2025";
    const rawDppStatus = findHeaderAliasValue(fields, HEADER_FIELD_ALIASES.dppStatus) || passport?.dpp_status || null;
    const dppStatus = toDppStatus(passport?.release_status || rawDppStatus);
    const economicOperatorId = findHeaderAliasValue(fields, HEADER_FIELD_ALIASES.economicOperatorId) || passport?.economic_operator_id || companyDid;
    const facilityId = findHeaderAliasValue(fields, HEADER_FIELD_ALIASES.facilityId) || passport?.facility_id || null;
    const contentSpecificationIdsRaw =
      findHeaderAliasValue(fields, HEADER_FIELD_ALIASES.contentSpecificationIds)
      || passport?.content_specification_ids
      || typeDef?.semantic_model_key
      || [];
    const contentSpecificationIds = Array.isArray(contentSpecificationIdsRaw)
      ? contentSpecificationIdsRaw
      : parseArrayValue(contentSpecificationIdsRaw);

    Object.values(HEADER_FIELD_ALIASES).forEach((aliases) => {
      Object.keys(fields).forEach((fieldKey) => {
        const compactKey = String(fieldKey || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (aliases.has(fieldKey) || aliases.has(compactKey)) {
          delete fields[fieldKey];
        }
      });
    });

    const resolvedVersionNumber = Number(passport.version_number) || 1;
    const extensions = buildClarosExtensions({
      passportType,
      versionNumber: resolvedVersionNumber,
      internalId: passport?.dppId || passport?.dpp_id || passport?.guid || null,
    });
    if (extensions?.claros) {
      extensions.claros.validation = summarizeValidationIssues(validationIssues);
      if (categoryInfo.raw || categoryInfo.normalized) {
        extensions.claros.validation.batteryCategory = {
          raw: categoryInfo.raw,
          normalized: categoryInfo.normalized,
          supported: SUPPORTED_BATTERY_CATEGORIES,
        };
      }
      if (validationIssues.length) {
        extensions.claros.validationIssues = validationIssues;
      }
    }

    const localProductId = passport.product_id || null;
    const uniqueProductIdentifier = passport.product_identifier_did || derivedProductIdentifierDid || localProductId;

    return {
      digitalProductPassportId: passport?.dppId || passport?.dpp_id || passport?.guid || dppDid,
      uniqueProductIdentifier,
      localProductId,
      granularity: toTitleCaseGranularity(resolvedGranularity),
      dppSchemaVersion,
      dppStatus,
      lastUpdated: toIsoTimestamp(passport.updated_at || passport.created_at),
      economicOperatorId,
      facilityId,
      contentSpecificationIds: Array.isArray(contentSpecificationIds) ? contentSpecificationIds : [],
      complianceProfileKey: passport.compliance_profile_key || null,
      carrierPolicyKey: passport.carrier_policy_key || null,
      ...buildCarrierAuthenticityResponseFields(passport.carrier_authenticity),
      subjectDid,
      dppDid,
      companyDid,
      fields,
      ...(extensions ? { extensions } : {}),
    };
  }

  function buildExpandedPassportPayload(passport, typeDef, options = {}) {
    const canonicalPayload = buildCanonicalPassportPayload(passport, typeDef, options);
    const elements = getSchemaFieldDefinitions(typeDef)
      .map((fieldDef) => ({
        fieldDef,
        value: canonicalPayload.fields?.[fieldDef.key],
      }))
      .filter(({ value }) => value !== undefined && value !== null)
      .map(({ fieldDef, value }) => buildExpandedDataElement({
        typeDef,
        elementIdPath: fieldDef.key,
        value,
        fieldDef,
      }));

    const { fields, ...headerPayload } = canonicalPayload;
    void fields;
    return {
      ...headerPayload,
      elements,
    };
  }

  return {
    toDppStatus,
    coerceTypedFieldValue,
    buildExpandedDataElement,
    buildExpandedPassportPayload,
    buildCanonicalPassportPayload,
  };
}

module.exports = createCanonicalPassportSerializer;
