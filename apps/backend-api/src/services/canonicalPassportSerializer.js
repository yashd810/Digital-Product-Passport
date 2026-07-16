"use strict";

const { buildCarrierAuthenticityResponseFields } = require("../shared/passports/carrier-authenticity");
const createSemanticModelRegistry = require("./semantic-model-registry");
const { buildCanonicalIdentityBundle } = require("../shared/identifiers/canonical-identity-bundle");
const {
  coerceSemanticGraphPropertyValue,
  flattenSchemaFieldsFromSections,
  getPassportFieldValue,
} = require("../shared/passports/passport-helpers");
const { getPassportFieldDataTypeError } = require("../shared/passports/passport-field-data-types");
const { isResourceField, isSafePassportUri } = require("../shared/passports/passport-uri");
const {
  getSemanticGraphClass,
  isManyProperty,
  runtimeFieldFromSemanticProperty,
} = require("../shared/passports/passport-semantic-graph");

function createCanonicalPassportSerializer({
  didService,
  productIdentifierService = null,
  semanticModelRegistry = createSemanticModelRegistry(),
}) {
  const headerFieldKeys = {
    granularity: new Set(["granularity"]),
    dppSchemaVersion: new Set(["dppSchemaVersion"]),
    dppStatus: new Set(["dppStatus"]),
    economicOperatorId: new Set(["economicOperatorId"]),
    facilityId: new Set(["facilityId"]),
    contentSpecificationIds: new Set(["contentSpecificationIds"]),
  };
  const headerFieldConfig = {
    digitalProductPassportId: { required: true, semanticId: "dpp:digitalProductPassportId", valueSource: "system" },
    uniqueProductIdentifier: { required: true, semanticId: "dpp:uniqueProductIdentifier", valueSource: "system" },
    internalAliasId: { required: true, semanticId: "dpp:internalAliasId", valueSource: "system" },
    granularity: { required: true, semanticId: "dpp:granularity", valueSource: "system" },
    dppSchemaVersion: { required: true, semanticId: "dpp:dppSchemaVersion", valueSource: "system" },
    dppStatus: { required: true, semanticId: "dpp:dppStatus", valueSource: "system" },
    lastUpdate: { required: true, semanticId: "dpp:lastUpdate", valueSource: "system" },
    economicOperatorId: { required: true, semanticId: "dpp:economicOperatorId", valueSource: "system" },
    facilityId: { required: false, semanticId: "dpp:facilityId", valueSource: "system" },
    contentSpecificationIds: { required: true, semanticId: "dpp:contentSpecificationIds", valueSource: "system" },
    subjectDid: { required: true, semanticId: "dpp:subjectDid", valueSource: "system" },
    dppDid: { required: true, semanticId: "dpp:dppDid", valueSource: "system" },
    companyDid: { required: true, semanticId: "dpp:companyDid", valueSource: "system" },
  };
  const semanticLookupCache = new Map();

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
    if (["draft", "inReview", "inRevision"].includes(normalized)) return "Inactive";
    return "Invalid";
  }

  function buildPlatformExtensions({ passportType = null, versionNumber = null, internalId = null } = {}) {
    const platform = {};
    if (passportType) platform.passportType = passportType;
    if (versionNumber !== null && versionNumber !== undefined) platform.versionNumber = versionNumber;
    if (internalId) platform.internalId = internalId;
    return Object.keys(platform).length ? { platform } : null;
  }

  function looksLikeJson(value) {
    const text = String(value || "").trim();
    return (text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"));
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  const maxSemanticPatternLength = 256;
  const maxSemanticPatternInputLength = 4096;

  function compileSafeSemanticPattern(value) {
    const pattern = normalizeText(value);
    if (!pattern || pattern.length > maxSemanticPatternLength) return null;

    let index = pattern.startsWith("^") ? 1 : 0;
    let hasAtom = false;
    while (index < pattern.length) {
      if (pattern[index] === "$") {
        if (index !== pattern.length - 1 || !hasAtom) return null;
        break;
      }

      const token = pattern[index];
      if (token === "\\") {
        const escaped = pattern[index + 1];
        // Backreferences turn a regular expression into a potentially
        // super-linear matcher, so semantic patterns deliberately do not
        // support them.
        if (!escaped || /[1-9]/.test(escaped) || escaped === "k") return null;
        index += 2;
      } else if (token === "[") {
        index += 1;
        let closed = false;
        while (index < pattern.length) {
          if (pattern[index] === "\\") {
            if (!pattern[index + 1]) return null;
            index += 2;
            continue;
          }
          if (pattern[index] === "[") return null;
          if (pattern[index] === "]") {
            closed = true;
            index += 1;
            break;
          }
          index += 1;
        }
        if (!closed) return null;
      } else if (/[\\()[\]|*+?{}^$]/.test(token)) {
        // Groups, alternation, and unbounded repetitions are not needed for
        // dictionary identifier formats and can cause catastrophic backtracking.
        return null;
      } else {
        index += 1;
      }

      hasAtom = true;
      if (pattern[index] === "?") {
        index += 1;
      } else if (pattern[index] === "{") {
        const closingBrace = pattern.indexOf("}", index + 1);
        if (closingBrace < 0) return null;
        const parts = pattern.slice(index + 1, closingBrace).split(",");
        if (parts.length > 2 || parts.some((part) => !/^\d+$/.test(part))) return null;
        const minimum = Number(parts[0]);
        const maximum = Number(parts[parts.length - 1]);
        if (!Number.isSafeInteger(minimum)
          || !Number.isSafeInteger(maximum)
          || minimum > maximum
          || maximum > 1024) {
          return null;
        }
        index = closingBrace + 1;
      }
    }

    if (!hasAtom) return null;
    try {
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- The parser above accepts only bounded, group-free, backreference-free semantic identifier patterns before compilation.
      return new RegExp(pattern, "u");
    } catch {
      return null;
    }
  }

  function isUriLikeValue(value) {
    return isSafePassportUri(value);
  }

  function parseBoolean(value) {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return value;
    const normalized = normalizeText(value).toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
    return value;
  }

  function parseNumeric(value, integerOnly = false) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    const numericPattern = integerOnly ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/;
    if (!numericPattern.test(trimmed)) return value;
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

    if (normalizeText(fieldDef?.dataType).toLowerCase() === "decimal") {
      return parseNumeric(rawValue, false);
    }
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

  function readTypeValue(typeDef, camelKey) {
    if (!typeDef || typeof typeDef !== "object") return null;
    if (typeDef[camelKey] !== undefined) return typeDef[camelKey];
    return null;
  }

  function getFieldsJson(typeDef) {
    return readTypeValue(typeDef, "fieldsJson") || {};
  }

  function getSemanticModelKey(typeDef, options = {}) {
    return normalizeText(
      options.semanticModelKey
      || readTypeValue(typeDef, "semanticModelKey")
      || getFieldsJson(typeDef)?.semanticModelKey
      || ""
    );
  }

  function getTypeName(typeDef) {
    return readTypeValue(typeDef, "typeName") || "";
  }

  function getSemanticModelByKey(modelKey) {
    const key = normalizeText(modelKey);
    if (!key) return null;
    return semanticModelRegistry?.getModel?.(key) || null;
  }

  function resolveSemanticModel(typeDef, passportType = null, options = {}) {
    const semanticModelKey = getSemanticModelKey(typeDef, options);
    const explicitModel = getSemanticModelByKey(semanticModelKey);
    if (explicitModel) return explicitModel;
    return null;
  }

  function getSchemaFieldDefinitions(typeDef) {
    return flattenSchemaFieldsFromSections(getFieldsJson(typeDef).sections || [])
      .filter((field) => field?.key);
  }

  function findSchemaFieldDefinition(typeDef, elementIdPath) {
    const normalizedPath = normalizeText(elementIdPath);
    const rootPath = normalizedPath.split(/[.[\]]/).filter(Boolean)[0] || normalizedPath;
    return getSchemaFieldDefinitions(typeDef).find((field) =>
      field.elementIdPath === normalizedPath
      || field.elementIdPath === rootPath
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

  function getTermSemanticId(term) {
    return term?.iri || term?.termIri || null;
  }

  function getSemanticLookup(semanticModel) {
    if (!semanticModel?.semanticModelKey) {
      return {
        semanticTermByIri: new Map(),
      };
    }

    const cacheKey = semanticModel.semanticModelKey;
    if (semanticLookupCache.has(cacheKey)) return semanticLookupCache.get(cacheKey);

    const semanticTermByIri = new Map();
    const terms = semanticModel.terms || semanticModelRegistry?.getTerms?.(cacheKey) || [];

    for (const term of terms || []) {
      const semanticId = getTermSemanticId(term);
      if (semanticId) semanticTermByIri.set(String(semanticId), term);
    }

    const lookup = {
      semanticTermByIri,
    };
    semanticLookupCache.set(cacheKey, lookup);
    return lookup;
  }

  function resolveDictionaryReference(fieldDef, elementIdPath = null, semanticModel = null) {
    const explicitReference = fieldDef?.semanticId || null;
    if (explicitReference) return explicitReference;
    return null;
  }

  function resolveSemanticTerm(fieldDef, elementIdPath = null, semanticModel = null) {
    const { semanticTermByIri } = getSemanticLookup(semanticModel);
    const explicitReference = fieldDef?.semanticId || null;
    if (explicitReference) {
      const byReference = semanticTermByIri.get(String(explicitReference))
        || semanticModelRegistry?.getTermByIri?.(semanticModel?.semanticModelKey, explicitReference);
      if (byReference) return byReference;
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

  function isBase64BinaryLike(value) {
    const text = normalizeText(value);
    if (!text) return false;
    return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text);
  }

  function coerceValueToSemanticType(value, term) {
    if (!term || isBlankValue(value)) return value;

    const jsonType = normalizeText(term?.dataType?.jsonType).toLowerCase();
    const xsdType = normalizeText(term?.dataType?.xsdType).toLowerCase();

    if (jsonType === "array") {
      return parseArrayValue(value);
    }
    if (jsonType === "object" && typeof value === "string" && looksLikeJson(value)) {
      try {
        const parsed = JSON.parse(value);
        return isPlainObject(parsed) ? parsed : value;
      } catch {
        return value;
      }
    }
    if (jsonType === "boolean" || xsdType.endsWith(":boolean")) {
      return parseBoolean(value);
    }
    if (jsonType === "decimal" || xsdType.endsWith(":decimal")) {
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
      return typeof value === "object" ? value : (typeof value === "string" ? value : String(value));
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
        dictionaryReference: resolveDictionaryReference(fieldDef, key, options.semanticModel),
        ...extras,
      });
    };

    if (cardinality) {
      const expectsMany = ["many", "multiple", "multi", "array", "set", "list"].includes(cardinality);
      const expectsOne = ["one", "single", "scalar"].includes(cardinality);
      if (expectsMany && !Array.isArray(value)) {
        pushIssue("semanticCardinalityMismatch", `Expected multiple values for "${key}" but found a single value.`);
      }
      if (expectsOne && Array.isArray(value)) {
        pushIssue("semanticCardinalityMismatch", `Expected a single value for "${key}" but found multiple values.`);
      }
    }

    if (Array.isArray(value) && hasMixedArrayItemTypes(value)) {
      pushIssue("semanticArrayItemTypeMismatch", `Array value for "${key}" contains mixed JSON item types.`);
    }

    const isMultiLanguageFieldValue = (isExplicitMultiLanguageField(fieldDef) || isMultiLanguageValue(value)) && isPlainObject(value);

    if (jsonType === "array") {
      if (!Array.isArray(value)) {
        pushIssue("semanticTypeMismatch", `Expected array value for "${key}".`);
      }
    } else if (jsonType === "object") {
      if (!isPlainObject(value)) {
        pushIssue("semanticTypeMismatch", `Expected object value for "${key}".`);
      }
    } else if (jsonType === "boolean" || xsdType.endsWith(":boolean")) {
      if (typeof value !== "boolean") {
        pushIssue("semanticTypeMismatch", `Expected boolean value for "${key}".`);
      }
    } else if (jsonType === "decimal" || xsdType.endsWith(":decimal")) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        pushIssue("semanticTypeMismatch", `Expected decimal value for "${key}".`);
      }
    } else if (jsonType === "integer" || xsdType.endsWith(":integer") || xsdType.endsWith(":int")) {
      if (!Number.isInteger(value)) {
        pushIssue("semanticTypeMismatch", `Expected integer value for "${key}".`);
      }
    } else if (xsdType.endsWith(":datetime")) {
      if (typeof value !== "string" || !isDateTimeLike(value)) {
        pushIssue("semanticTypeMismatch", `Expected xsd:dateTime string for "${key}".`);
      }
    } else if (xsdType.endsWith(":date")) {
      if (typeof value !== "string" || !isDateLike(value)) {
        pushIssue("semanticTypeMismatch", `Expected xsd:date string for "${key}".`);
      }
    } else if (xsdType.endsWith(":gyearmonth")) {
      if (typeof value !== "string" || !isYearMonthLike(value)) {
        pushIssue("semanticTypeMismatch", `Expected xsd:gYearMonth string for "${key}".`);
      }
    } else if (xsdType.endsWith(":anyuri")) {
      if (typeof value !== "string" || !isSafePassportUri(value, { resource: isResourceField(fieldDef) })) {
        pushIssue("semanticTypeMismatch", `Expected xsd:anyURI string for "${key}".`);
      }
    } else if (xsdType.endsWith(":base64binary")) {
      if (typeof value !== "string" || !isBase64BinaryLike(value)) {
        pushIssue("semanticTypeMismatch", `Expected xsd:base64Binary string for "${key}".`);
      }
    } else if ((jsonType === "string" || xsdType.endsWith(":string")) && !isMultiLanguageFieldValue) {
      if (typeof value !== "string") {
        pushIssue("semanticTypeMismatch", `Expected string value for "${key}".`);
      }
    }

    if (pattern && typeof value === "string") {
      const regex = compileSafeSemanticPattern(pattern);
      if (!regex) {
        pushIssue("semanticPatternUnsupported", `Dictionary pattern for "${key}" is not a bounded safe pattern.`);
      } else if (value.length > maxSemanticPatternInputLength) {
        pushIssue("semanticPatternInputTooLong", `Value for "${key}" is too long to validate against a dictionary pattern.`);
      } else if (!regex.test(value)) {
        pushIssue("semanticPatternMismatch", `Value for "${key}" does not match its declared pattern.`);
      }
    }

    if (unit && unit !== "none" && isPlainObject(value) && value.unit && normalizeText(value.unit).toLowerCase() !== unit) {
      pushIssue("semanticUnitMismatch", `Value for "${key}" uses unit "${value.unit}" but dictionary expects "${term.unit}".`);
    }

    const explicitAllowedValues = resolveAllowedValues(fieldDef, term, options);
    if (explicitAllowedValues.length) {
      const invalidValues = extractDisallowedValues(value, explicitAllowedValues);
      if (invalidValues.length) {
        pushIssue(
          "semanticAllowedValueMismatch",
          `Value for "${key}" must be one of: ${explicitAllowedValues.join(", ")}.`,
          { allowedValues: explicitAllowedValues, invalidValues }
        );
      }
    }

    const multiLanguageIssues = buildLanguageTagValidationIssues(value, fieldDef, key);
    if (multiLanguageIssues.length) {
      issues.push(...multiLanguageIssues.map((issue) => ({
        ...issue,
        dictionaryReference: resolveDictionaryReference(fieldDef, key, options.semanticModel),
      })));
    }

    return issues;
  }

  function isRequiredField(fieldDef) {
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
    return resolveExplicitObjectType(fieldDef) === "MultiLanguageDataElement";
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
          "semanticLanguageTagInvalid",
          `Value for "${key}" uses invalid language tag "${languageTag}".`,
          { languageTag }
        );
      }
      if (!isScalarValue(localizedValue)) {
        pushIssue(
          "semanticMultilanguageValueInvalid",
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
        dictionaryReference: resolveDictionaryReference(fieldDef, key, options.semanticModel),
        ...extras,
      });
    };

    if (Array.isArray(value) && hasMixedArrayItemTypes(value)) {
      pushIssue("fieldArrayItemTypeMismatch", `Array value for "${key}" contains mixed JSON item types.`);
    }

    if (!skipTypeValidation && (normalizedDataType === "boolean" || normalizedFieldType === "boolean")) {
      if (typeof value !== "boolean") {
        pushIssue("fieldTypeMismatch", `Expected boolean value for "${key}".`);
      }
    } else if (!skipTypeValidation && normalizedDataType === "integer") {
      if (!Number.isInteger(value)) {
        pushIssue("fieldTypeMismatch", `Expected integer value for "${key}".`);
      }
    } else if (!skipTypeValidation && normalizedDataType === "decimal") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        pushIssue("fieldTypeMismatch", `Expected decimal value for "${key}".`);
      }
    } else if (!skipTypeValidation && (normalizedDataType === "date" || normalizedFieldType === "date")) {
      if (typeof value !== "string" || !isDateLike(value)) {
        pushIssue("fieldTypeMismatch", `Expected date value for "${key}".`);
      }
    } else if (!skipTypeValidation && normalizedDataType === "datetime") {
      if (typeof value !== "string" || !isDateTimeLike(value)) {
        pushIssue("fieldTypeMismatch", `Expected date-time value for "${key}".`);
      }
    } else if (!skipTypeValidation && (normalizedDataType === "uri" || normalizedFieldType === "url")) {
      if (typeof value !== "string" || !isSafePassportUri(value, { resource: isResourceField(fieldDef) })) {
        pushIssue("fieldTypeMismatch", `Expected URL/URI value for "${key}".`);
      }
    }

    const explicitAllowedValues = resolveAllowedValues(fieldDef, null, options);
    if (explicitAllowedValues.length) {
      const invalidValues = extractDisallowedValues(value, explicitAllowedValues);
      if (invalidValues.length) {
        pushIssue(
          "fieldAllowedValueMismatch",
          `Value for "${key}" must be one of: ${explicitAllowedValues.join(", ")}.`,
          { allowedValues: explicitAllowedValues, invalidValues }
        );
      }
    }

    const multiLanguageIssues = buildLanguageTagValidationIssues(value, fieldDef, key);
    issues.push(...multiLanguageIssues.map((issue) => ({
      ...issue,
      dictionaryReference: resolveDictionaryReference(fieldDef, key, options.semanticModel),
    })));

    if (expectedUnit && expectedUnit !== "none" && isPlainObject(value) && value.unit && normalizeText(value.unit).toLowerCase() !== expectedUnit) {
      pushIssue("fieldUnitMismatch", `Value for "${key}" uses unit "${value.unit}" but field metadata expects "${fieldDef.unit}".`);
    }

    return issues;
  }

  function buildFieldDefinitionValidationIssues(fieldDef, key, options = {}) {
    const dataTypeError = getPassportFieldDataTypeError(fieldDef, { requireExplicit: true });
    if (!dataTypeError) return [];
    return [{
      key,
      code: "fieldSchemaDataTypeInvalid",
      message: dataTypeError,
      dictionaryReference: resolveDictionaryReference(fieldDef, key, options.semanticModel),
    }];
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

  function resolveValueDataType(fieldDef, semanticTerm = null) {
    const explicitValueDataType = normalizeText(fieldDef?.valueDataType);
    if (explicitValueDataType) return explicitValueDataType;
    const semanticJsonType = normalizeText(semanticTerm?.dataType?.jsonType).toLowerCase();
    const semanticXsdType = normalizeText(semanticTerm?.dataType?.xsdType).toLowerCase();

    if (semanticJsonType === "boolean" || semanticXsdType.endsWith(":boolean")) return "Boolean";
    if (semanticJsonType === "integer" || semanticXsdType.endsWith(":integer") || semanticXsdType.endsWith(":int")) return "Integer";
    if (semanticJsonType === "decimal" || semanticXsdType.endsWith(":decimal")) return "Decimal";
    if (semanticJsonType === "array") return "Array";
    if (semanticJsonType === "object") return "Object";
    if (semanticXsdType.endsWith(":datetime")) return "DateTime";
    if (semanticXsdType.endsWith(":date")) return "Date";
    if (semanticXsdType.endsWith(":gyearmonth")) return "YearMonth";
    if (semanticXsdType.endsWith(":anyuri")) return "URI";
    if (semanticXsdType.endsWith(":base64binary")) return "Base64Binary";

    return null;
  }

  function normalizeObjectType(value) {
    const normalized = normalizeText(value);
    return [
      "DataElementCollection",
      "SingleValuedDataElement",
      "MultiValuedDataElement",
      "RelatedResource",
      "MultiLanguageDataElement",
    ].includes(normalized) ? normalized : null;
  }

  function resolveExplicitObjectType(fieldDef) {
    return normalizeObjectType(
      fieldDef?.objectType
    );
  }

  function resolveObjectType(fieldDef) {
    const explicitObjectType = resolveExplicitObjectType(fieldDef);
    if (explicitObjectType) return explicitObjectType;
    return null;
  }

  function coerceCanonicalFieldValue(
    fieldDef,
    rawValue,
    semanticTerm = null,
    semanticModel = null,
    semanticGraph = null
  ) {
    const fieldValue = coerceTypedFieldValue(fieldDef, rawValue);
    if (fieldValue === null) return null;
    if (!fieldDef?.rangeKind || !semanticGraph) {
      throw new Error(`Field "${fieldDef?.key || "unknown"}" is missing required semantic graph metadata.`);
    }
    return coerceValueToSemanticType(
      coerceSemanticGraphPropertyValue(
        fieldDef,
        fieldValue,
        semanticGraph,
        fieldDef.label || fieldDef.key
      ),
      semanticTerm
    );
  }

  function buildSemanticClassProperties(value, classDef, semanticModel, semanticGraph) {
    if (!isPlainObject(value) || !classDef) return [];
    return (classDef.properties || [])
      .filter((property) => Object.prototype.hasOwnProperty.call(value, property.key))
      .map((property) => buildExpandedDataElement({
        elementIdPath: property.key,
        value: value[property.key],
        fieldDef: runtimeFieldFromSemanticProperty(property, semanticGraph),
        semanticModel,
        semanticGraph,
      }));
  }

  function buildNestedElements(value, semanticModel = null, fieldDef = null, semanticGraph = null) {
    if (!fieldDef?.rangeKind || !semanticGraph) {
      throw new Error(`Field "${fieldDef?.key || "unknown"}" is missing required semantic graph metadata.`);
    }
    if (fieldDef.rangeKind === "class") {
      if (fieldDef.relationshipType === "reference") return [];
      const classDef = getSemanticGraphClass(semanticGraph, fieldDef.rangeClassKey);
      if (isManyProperty(fieldDef)) {
        if (!Array.isArray(value)) return [];
        return value.map((item, index) => ({
          elementId: String(index),
          objectType: "DataElementCollection",
          dictionaryReference: classDef?.semanticId || fieldDef.rangeIri || null,
          valueDataType: "Object",
          value: item,
          elements: buildSemanticClassProperties(item, classDef, semanticModel, semanticGraph),
        }));
      }
      return buildSemanticClassProperties(value, classDef, semanticModel, semanticGraph);
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => buildExpandedDataElement({
        elementIdPath: String(index),
        value: item,
        semanticModel,
      }));
    }
    if (isPlainObject(value)) {
      return Object.entries(value).map(([childKey, childValue]) => buildExpandedDataElement({
        elementIdPath: childKey,
        value: childValue,
        semanticModel,
      }));
    }
    return [];
  }

  function buildExpandedDataElement({
    typeDef = null,
    elementIdPath,
    value,
    fieldDef = null,
    semanticModel = null,
    semanticGraph = null,
  } = {}) {
    const resolvedFieldDef = fieldDef || findSchemaFieldDefinition(typeDef, elementIdPath);
    const resolvedSemanticModel = semanticModel || resolveSemanticModel(typeDef, getTypeName(typeDef));
    const resolvedSemanticGraph = semanticGraph || getFieldsJson(typeDef)?.semanticGraph;
    if (!resolvedSemanticGraph) {
      throw new Error("Canonical passport serialization requires a semantic class graph.");
    }
    const semanticTerm = resolveSemanticTerm(resolvedFieldDef, elementIdPath, resolvedSemanticModel);
    const resolvedElementId = resolvedFieldDef?.elementIdPath
      || elementIdPath
      || null;
    return {
      elementId: resolvedElementId,
      objectType: resolveObjectType(resolvedFieldDef),
      dictionaryReference: resolveDictionaryReference(resolvedFieldDef, elementIdPath, resolvedSemanticModel),
      valueDataType: resolveValueDataType(resolvedFieldDef, semanticTerm),
      value,
      elements: buildNestedElements(value, resolvedSemanticModel, resolvedFieldDef, resolvedSemanticGraph),
    };
  }

  function getHeaderFieldConfig(typeDef, key) {
    return headerFieldConfig[key] || null;
  }

  function pushMissingHeaderIssue(validationIssues, typeDef, key, value) {
    const headerField = getHeaderFieldConfig(typeDef, key);
    if (!headerField?.required || !isBlankValue(value)) return;
    validationIssues.push({
      key,
      code: "requiredHeaderFieldMissing",
      message: `Required passport header field "${key}" is missing from the generated standards payload.`,
      dictionaryReference: headerField.semanticId || null,
      valueSource: headerField.valueSource || null,
    });
  }

  function buildCanonicalPassportPayload(passport, typeDef, options = {}) {
    const company = options.company || null;
    const companyName = String(options.companyName || "").trim();
    const passportType = String(passport?.passportType || getTypeName(typeDef) || options.passportType || "passport").trim().toLowerCase() || "passport";
    const semanticModel = resolveSemanticModel(typeDef, passportType, options);
    const canonicalIdentity = buildCanonicalIdentityBundle({
      passport,
      company,
      companyName,
      granularity: options.granularity || null,
      passportType,
      typeDef,
      didService,
      productIdentifierService,
    });
    const resolvedGranularity = canonicalIdentity.resolvedGranularity || "item";
    const companyDid = canonicalIdentity.companyDid || null;
    const subjectDid = canonicalIdentity.subjectDid || null;
    const dppDid = canonicalIdentity.dppDid || null;
    const derivedProductIdentifierDid = canonicalIdentity.uniqueProductIdentifier || null;

    const schemaFields = getSchemaFieldDefinitions(typeDef);
    const semanticGraph = getFieldsJson(typeDef)?.semanticGraph;
    if (!semanticGraph) {
      throw new Error("Canonical passport serialization requires a semantic class graph.");
    }

    const fields = {};
    const validationIssues = [];
    for (const fieldDef of schemaFields) {
      const definitionIssues = buildFieldDefinitionValidationIssues(fieldDef, fieldDef.key, {
        semanticModel,
      });
      if (definitionIssues.length) {
        validationIssues.push(...definitionIssues);
        continue;
      }
      const semanticTerm = resolveSemanticTerm(fieldDef, fieldDef.key, semanticModel);
      if (semanticModel && !semanticTerm) {
        validationIssues.push({
          key: fieldDef.key,
          code: "semanticTermNotFound",
          message: `Field "${fieldDef.key}" is not mapped to a term in semantic model "${semanticModel.semanticModelKey}".`,
          dictionaryReference: resolveDictionaryReference(fieldDef, fieldDef.key, semanticModel),
        });
        continue;
      }
      const rawValue = getPassportFieldValue(passport, fieldDef.key);
      if (isRequiredField(fieldDef) && isBlankValue(rawValue)) {
        validationIssues.push({
          key: fieldDef.key,
          code: "requiredFieldMissing",
          message: `Field "${fieldDef.key}" is required but is missing from the export.`,
          dictionaryReference: resolveDictionaryReference(fieldDef, fieldDef.key, semanticModel),
        });
      }
      let typedValue;
      try {
        typedValue = coerceCanonicalFieldValue(
          fieldDef,
          rawValue,
          semanticTerm,
          semanticModel,
          semanticGraph
        );
      } catch (error) {
        validationIssues.push({
          key: fieldDef.key,
          code: "semanticGraphValueInvalid",
          message: error.message,
          dictionaryReference: resolveDictionaryReference(fieldDef, fieldDef.key, semanticModel),
        });
        continue;
      }
      if (typedValue === null) continue;
      const issues = [
        ...buildSemanticValidationIssues(typedValue, semanticTerm, fieldDef, fieldDef.key, {
          semanticModel,
        }),
        ...buildSchemaValidationIssues(typedValue, fieldDef, fieldDef.key, {
          skipTypeValidation: Boolean(semanticTerm),
          semanticModel,
        }),
      ];
      if (issues.length) {
        validationIssues.push(...issues);
        continue;
      }
      fields[fieldDef.key] = typedValue;
    }

    const dppSchemaVersion = passport?.dppSchemaVersion || typeDef?.fieldsJson?.dppSchemaVersion || "prEN 18223:2025";
    const rawDppStatus = passport?.dppStatus || null;
    const dppStatus = toDppStatus(passport?.releaseStatus || rawDppStatus);
    const economicOperatorId = passport?.economicOperatorId || company?.economicOperatorIdentifier || companyDid;
    const facilityId = passport?.facilityId || passport?.facilityIdentifier || null;
    const contentSpecificationIdsRaw =
      passport?.contentSpecificationIds
      || typeDef?.semanticModelKey
      || typeDef?.fieldsJson?.semanticModelKey
      || [];
    const contentSpecificationIds = Array.isArray(contentSpecificationIdsRaw)
      ? contentSpecificationIdsRaw
      : parseArrayValue(contentSpecificationIdsRaw);

    Object.values(headerFieldKeys).forEach((headerKeys) => {
      Object.keys(fields).forEach((fieldKey) => {
        if (headerKeys.has(fieldKey)) {
          delete fields[fieldKey];
        }
      });
    });

    const internalAliasId = passport.internalAliasId || null;
    const businessIdentifier = productIdentifierService?.extractBusinessProductIdentifier?.(passport || {}, typeDef) || "";
    const storedProductIdentifier = isUriLikeValue(passport.uniqueProductIdentifier)
      ? passport.uniqueProductIdentifier
      : null;
    const uniqueProductIdentifier = derivedProductIdentifierDid || (businessIdentifier ? storedProductIdentifier : null) || null;
    const storedPassportIdentifier = isUriLikeValue(passport?.dppId || passport?.guid)
      ? (passport?.dppId || passport?.guid)
      : null;
    const digitalProductPassportId = dppDid || storedPassportIdentifier || canonicalIdentity.digitalProductPassportId || null;
    const lastUpdate = toIsoTimestamp(passport.updatedAt || passport.createdAt);
    const headerValues = {
      digitalProductPassportId,
      uniqueProductIdentifier,
      internalAliasId,
      granularity: toTitleCaseGranularity(resolvedGranularity),
      dppSchemaVersion,
      dppStatus,
      lastUpdate,
      economicOperatorId,
      facilityId,
      contentSpecificationIds: Array.isArray(contentSpecificationIds) ? contentSpecificationIds : [],
      subjectDid,
      dppDid,
      companyDid,
    };
    for (const [key, value] of Object.entries(headerValues)) {
      pushMissingHeaderIssue(validationIssues, typeDef, key, value);
    }

    const resolvedVersionNumber = Number(passport.versionNumber) || 1;
    const extensions = buildPlatformExtensions({
      passportType,
      versionNumber: resolvedVersionNumber,
      internalId: passport?.dppId || passport?.guid || null,
    });
    if (extensions?.platform) {
      extensions.platform.validation = summarizeValidationIssues(validationIssues);
      if (validationIssues.length) {
        extensions.platform.validationIssues = validationIssues;
      }
    }

    return {
      digitalProductPassportId,
      uniqueProductIdentifier,
      internalAliasId,
      granularity: headerValues.granularity,
      dppSchemaVersion,
      dppStatus,
      lastUpdate,
      economicOperatorId,
      facilityId,
      contentSpecificationIds: Array.isArray(contentSpecificationIds) ? contentSpecificationIds : [],
      passportPolicyKey: passport.passportPolicyKey || null,
      carrierPolicyKey: passport.carrierPolicyKey || null,
      ...buildCarrierAuthenticityResponseFields(passport.carrierAuthenticity),
      subjectDid,
      dppDid,
      companyDid,
      fields,
      ...(extensions ? { extensions } : {}),
    };
  }

  function buildExpandedPassportPayload(passport, typeDef, options = {}) {
    const passportType = String(passport?.passportType || getTypeName(typeDef) || options.passportType || "passport").trim().toLowerCase() || "passport";
    const semanticModel = resolveSemanticModel(typeDef, passportType, options);
    const canonicalPayload = buildCanonicalPassportPayload(passport, typeDef, options);
    const canonicalFields = canonicalPayload.fields || {};
    const elements = getSchemaFieldDefinitions(typeDef)
      .map((fieldDef) => ({
        fieldDef,
        value: Object.prototype.hasOwnProperty.call(canonicalFields, fieldDef.key)
          ? canonicalFields[fieldDef.key]
          : undefined,
      }))
      .filter(({ value }) => value !== undefined && value !== null)
      .map(({ fieldDef, value }) => buildExpandedDataElement({
        typeDef,
        elementIdPath: fieldDef.key,
        value,
        fieldDef,
        semanticModel,
        semanticGraph: getFieldsJson(typeDef)?.semanticGraph,
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
