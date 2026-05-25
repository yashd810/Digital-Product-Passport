"use strict";

const BATTERY_DICTIONARY_MODEL_KEY = "claros_battery_dictionary_v1";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSemanticModelKey(modelKey) {
  return normalizeText(modelKey).toLowerCase();
}

function isBatteryProductCategory(productCategory) {
  const normalized = normalizeKey(productCategory);
  if (!normalized) return false;
  return normalized.includes("battery");
}

function hasRequiredBatterySemanticModel({ productCategory = null, semanticModelKey = null } = {}) {
  if (!isBatteryProductCategory(productCategory)) return true;
  return normalizeText(semanticModelKey) === BATTERY_DICTIONARY_MODEL_KEY;
}

function shouldUseBatteryDictionary({ passportType = null, typeDef = null, options = {} } = {}) {
  if (isBatteryProductCategory(options.productCategory || typeDef?.productCategory)) {
    return true;
  }

  if (normalizeSemanticModelKey(options.semanticModelKey || typeDef?.semanticModelKey) === BATTERY_DICTIONARY_MODEL_KEY) {
    return true;
  }

  return false;
}

module.exports = {
  BATTERY_DICTIONARY_MODEL_KEY,
  normalizeSemanticModelKey,
  isBatteryProductCategory,
  hasRequiredBatterySemanticModel,
  shouldUseBatteryDictionary,
};
