"use strict";

const BATTERY_DICTIONARY_MODEL_KEY = "claros_battery_dictionary_v1";
const LEGACY_BATTERY_PASSPORT_TYPE = "din_spec_99100";

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

function isBatteryUmbrellaCategory(umbrellaCategory) {
  const normalized = normalizeKey(umbrellaCategory);
  if (!normalized) return false;
  return normalized.includes("battery");
}

function isLegacyBatteryPassportType(passportType) {
  return normalizeText(passportType).toLowerCase() === LEGACY_BATTERY_PASSPORT_TYPE;
}

function hasRequiredBatterySemanticModel({ umbrellaCategory = null, semanticModelKey = null } = {}) {
  if (!isBatteryUmbrellaCategory(umbrellaCategory)) return true;
  return normalizeText(semanticModelKey) === BATTERY_DICTIONARY_MODEL_KEY;
}

function shouldUseBatteryDictionary({ passportType = null, typeDef = null, options = {} } = {}) {
  if (isBatteryUmbrellaCategory(options.umbrellaCategory || typeDef?.umbrella_category)) {
    return true;
  }

  if (normalizeSemanticModelKey(options.semanticModelKey || typeDef?.semantic_model_key) === BATTERY_DICTIONARY_MODEL_KEY) {
    return true;
  }

  return isLegacyBatteryPassportType(passportType || typeDef?.type_name);
}

module.exports = {
  BATTERY_DICTIONARY_MODEL_KEY,
  LEGACY_BATTERY_PASSPORT_TYPE,
  normalizeSemanticModelKey,
  isBatteryUmbrellaCategory,
  isLegacyBatteryPassportType,
  hasRequiredBatterySemanticModel,
  shouldUseBatteryDictionary,
};
