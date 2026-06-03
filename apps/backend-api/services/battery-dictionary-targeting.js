"use strict";

const BATTERY_DICTIONARY_MODEL_KEY = "claros_battery_dictionary_v1";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSemanticModelKey(modelKey) {
  return normalizeText(modelKey).toLowerCase();
}

module.exports = {
  BATTERY_DICTIONARY_MODEL_KEY,
  normalizeSemanticModelKey,
};
