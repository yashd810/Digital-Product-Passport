"use strict";

const {
  systemPassportFields,
} = require("../../shared/passports/passport-helpers");

const importBuiltInEditableFields = new Set([
  "dppId",
  "modelName",
  "internalAliasId",
]);

const policyManagedImportFields = new Set([
  "lineageId",
  "uniqueProductIdentifier",
  "productImage",
  "granularity",
  "passportPolicyKey",
  "contentSpecificationIds",
  "carrierPolicyKey",
  "economicOperatorId",
  "economicOperatorIdentifierScheme",
  "facilityId",
  "manufacturingFacilityId",
]);

const importManagedFieldKeys = new Set([
  ...systemPassportFields,
  ...policyManagedImportFields,
]);

const managedImportFieldLabels = new Map([
  ["carrier policy key", "carrierPolicyKey"],
  ["content specification ids", "contentSpecificationIds"],
  ["dpp status", "releaseStatus"],
  ["economic operator id", "economicOperatorId"],
  ["economic operator identifier scheme", "economicOperatorIdentifierScheme"],
  ["facility id", "facilityId"],
  ["granularity", "granularity"],
  ["manufacturing facility id", "manufacturingFacilityId"],
  ["passport policy key", "passportPolicyKey"],
  ["release status", "releaseStatus"],
  ["unique product identifier", "uniqueProductIdentifier"],
  ["version number", "versionNumber"],
]);

function normalizeLabel(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isImportBuiltInEditableField(key) {
  return importBuiltInEditableFields.has(String(key || "").trim());
}

function isManagedImportFieldKey(key) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey || isImportBuiltInEditableField(normalizedKey)) return false;
  return importManagedFieldKeys.has(normalizedKey);
}

function isManagedImportFieldLabel(label) {
  const normalizedLabel = String(label || "").trim();
  if (!normalizedLabel) return false;
  return isManagedImportFieldKey(normalizedLabel)
    || isManagedImportFieldKey(managedImportFieldLabels.get(normalizeLabel(normalizedLabel)));
}

function resolveCsvImportField(rawLabel, typeSchema = {}) {
  const key = String(rawLabel || "").trim();
  if (!key) return null;
  const schemaFields = Array.isArray(typeSchema.schemaFields)
    ? typeSchema.schemaFields
    : [];
  const normalizedLabel = normalizeLabel(key);
  const schemaField = schemaFields.find((field) =>
    field?.key === key || normalizeLabel(field?.label) === normalizedLabel
  );

  if (schemaField?.key) return schemaField;

  const builtInByKey = {
    dppId: { key: "dppId", type: "text" },
    modelName: { key: "modelName", type: "text" },
    internalAliasId: { key: "internalAliasId", type: "text" },
  };

  return builtInByKey[key] || null;
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
  return `System-managed fields (${keys.join(", ")}) cannot be imported as passport row data. They are assigned by the passport type and passport policy.`;
}

module.exports = {
  importBuiltInEditableFields,
  importManagedFieldKeys,
  buildManagedImportErrorMessage,
  getInvalidImportFieldKeys,
  getManagedImportFieldKeys,
  isImportBuiltInEditableField,
  isImportFieldAllowed,
  isManagedImportFieldKey,
  isManagedImportFieldLabel,
  resolveCsvImportField,
};
