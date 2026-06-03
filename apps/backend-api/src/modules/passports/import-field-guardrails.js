"use strict";

const {
  SYSTEM_PASSPORT_FIELDS,
} = require("../../shared/passports/passport-helpers");

const IMPORT_BUILT_IN_EDITABLE_FIELDS = new Set([
  "dppId",
  "modelName",
  "internalAliasId",
]);

const PROFILE_MANAGED_IMPORT_FIELDS = new Set([
  "lineageId",
  "uniqueProductIdentifier",
  "productImage",
  "granularity",
  "complianceProfileKey",
  "contentSpecificationIds",
  "carrierPolicyKey",
  "economicOperatorId",
  "economicOperatorIdentifierScheme",
  "facilityId",
  "manufacturingFacilityId",
]);

const IMPORT_MANAGED_FIELD_KEYS = new Set([
  ...SYSTEM_PASSPORT_FIELDS,
  ...PROFILE_MANAGED_IMPORT_FIELDS,
]);

const normalizeImportToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const MANAGED_IMPORT_FIELD_TOKENS = new Set(
  [...IMPORT_MANAGED_FIELD_KEYS].map(normalizeImportToken)
);

function isImportBuiltInEditableField(key) {
  return IMPORT_BUILT_IN_EDITABLE_FIELDS.has(String(key || "").trim());
}

function isManagedImportFieldKey(key) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey || isImportBuiltInEditableField(normalizedKey)) return false;
  return IMPORT_MANAGED_FIELD_KEYS.has(normalizedKey);
}

function isManagedImportFieldLabel(label) {
  const normalizedLabel = String(label || "").trim();
  if (!normalizedLabel) return false;
  if (isManagedImportFieldKey(normalizedLabel)) return true;
  return MANAGED_IMPORT_FIELD_TOKENS.has(normalizeImportToken(normalizedLabel));
}

function resolveCsvImportField(rawLabel, typeSchema = {}) {
  const label = String(rawLabel || "").trim();
  if (!label) return null;

  const normalized = label.toLowerCase();
  const schemaFields = Array.isArray(typeSchema.schemaFields)
    ? typeSchema.schemaFields
    : [];
  const schemaField =
    schemaFields.find((field) => field?.label?.trim().toLowerCase() === normalized) ||
    schemaFields.find((field) => field?.key?.toLowerCase() === normalized);

  if (schemaField?.key) return schemaField;

  const builtInByToken = {
    dppid: { key: "dppId", type: "text" },
    modelname: { key: "modelName", type: "text" },
    internalaliasid: { key: "internalAliasId", type: "text" },
  };

  return builtInByToken[normalizeImportToken(label)] || null;
}

function isImportFieldAllowed(key, typeSchema = {}) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return false;
  if (isManagedImportFieldKey(normalizedKey)) return false;
  if (isImportBuiltInEditableField(normalizedKey)) return true;
  return Boolean(typeSchema?.allowedKeys?.has?.(normalizedKey));
}

function getManagedImportFieldKeys(fields = {}) {
  return Object.keys(fields).filter(isManagedImportFieldKey);
}

function getInvalidImportFieldKeys(fields = {}, typeSchema = {}) {
  return Object.keys(fields).filter((key) => !isImportFieldAllowed(key, typeSchema));
}

function buildManagedImportErrorMessage(keys = []) {
  return `System-managed fields (${keys.join(", ")}) cannot be imported as passport row data. They are assigned by the passport type and compliance profile.`;
}

module.exports = {
  IMPORT_BUILT_IN_EDITABLE_FIELDS,
  IMPORT_MANAGED_FIELD_KEYS,
  buildManagedImportErrorMessage,
  getInvalidImportFieldKeys,
  getManagedImportFieldKeys,
  isImportBuiltInEditableField,
  isImportFieldAllowed,
  isManagedImportFieldKey,
  isManagedImportFieldLabel,
  resolveCsvImportField,
};
