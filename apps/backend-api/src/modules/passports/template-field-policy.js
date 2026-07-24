"use strict";

const semanticRelationshipsSectionToken = "semanticrelationships";

function normalizeSchemaKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isSemanticRelationshipsSectionKey(value) {
  return normalizeSchemaKey(value) === semanticRelationshipsSectionToken;
}

function isSemanticRelationshipSchemaField(field = {}) {
  return Array.isArray(field.sectionPath)
    && field.sectionPath.some((section) => isSemanticRelationshipsSectionKey(section?.key));
}

function buildTemplateFieldPolicy(typeSchema = null) {
  const allowedFieldKeys = new Set();
  const semanticRelationshipFieldKeys = new Set();

  for (const field of Array.isArray(typeSchema?.schemaFields) ? typeSchema.schemaFields : []) {
    const fieldKey = String(field?.key || "").trim();
    if (!fieldKey) continue;
    if (isSemanticRelationshipSchemaField(field)) {
      semanticRelationshipFieldKeys.add(fieldKey);
    } else {
      allowedFieldKeys.add(fieldKey);
    }
  }

  // Schema field keys are expected to be globally unique. If a malformed
  // schema reuses one inside the generated semantic section, fail closed:
  // template storage cannot distinguish those two meanings by field key.
  for (const fieldKey of semanticRelationshipFieldKeys) {
    allowedFieldKeys.delete(fieldKey);
  }

  return {
    allowedFieldKeys,
    semanticRelationshipFieldKeys,
  };
}

function hasUserPopulatedTemplateValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.some(hasUserPopulatedTemplateValue);
  if (typeof value === "object") {
    return Object.values(value).some(hasUserPopulatedTemplateValue);
  }
  return String(value).trim().length > 0;
}

function toStoredTemplateFieldValue(value) {
  if (value && typeof value === "object") return JSON.stringify(value);
  return value;
}

function createTemplateFieldValidationError(message, code) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function normalizeTemplateFieldsForStorage(fields, policy) {
  if (fields === undefined || fields === null) return [];
  if (!Array.isArray(fields)) {
    throw createTemplateFieldValidationError("fields must be an array", "invalidTemplateFields");
  }

  const allowedFieldKeys = policy?.allowedFieldKeys || new Set();
  const semanticRelationshipFieldKeys = policy?.semanticRelationshipFieldKeys || new Set();
  const seen = new Set();
  const normalized = [];

  for (const field of fields) {
    if (!field || typeof field !== "object" || Array.isArray(field)) {
      throw createTemplateFieldValidationError("Each template field must be an object", "invalidTemplateField");
    }
    const fieldKey = String(field.fieldKey || "").trim();
    if (!fieldKey) {
      throw createTemplateFieldValidationError("Each template field requires fieldKey", "invalidTemplateFieldKey");
    }
    if (semanticRelationshipFieldKeys.has(fieldKey)) {
      throw createTemplateFieldValidationError(
        `Semantic relationship field "${fieldKey}" is schema metadata and cannot be overridden by a template`,
        "semanticRelationshipTemplateOverride"
      );
    }
    if (!allowedFieldKeys.has(fieldKey)) {
      throw createTemplateFieldValidationError(
        `Template field "${fieldKey}" is not a user-input field in this passport type`,
        "unknownTemplateField"
      );
    }
    if (seen.has(fieldKey)) {
      throw createTemplateFieldValidationError(
        `Template field "${fieldKey}" is duplicated`,
        "duplicateTemplateField"
      );
    }
    seen.add(fieldKey);

    if (!hasUserPopulatedTemplateValue(field.fieldValue)) continue;
    normalized.push({
      fieldKey,
      fieldValue: toStoredTemplateFieldValue(field.fieldValue),
      isModelData: field.isModelData === true,
    });
  }

  return normalized;
}

function filterStoredTemplateFields(fields, policy) {
  const allowedFieldKeys = policy?.allowedFieldKeys || new Set();
  return (Array.isArray(fields) ? fields : []).filter((field) =>
    allowedFieldKeys.has(String(field?.fieldKey || "").trim())
    && hasUserPopulatedTemplateValue(field?.fieldValue)
  );
}

module.exports = {
  buildTemplateFieldPolicy,
  filterStoredTemplateFields,
  hasUserPopulatedTemplateValue,
  isSemanticRelationshipSchemaField,
  isSemanticRelationshipsSectionKey,
  normalizeTemplateFieldsForStorage,
};
