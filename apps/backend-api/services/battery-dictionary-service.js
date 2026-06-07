"use strict";

const createSemanticModelRegistry = require("./semantic-model-registry");

const BATTERY_FAMILY = "battery";
const BATTERY_VERSION = "v1";
const FALLBACK_BATTERY_MODEL_KEY = "claros_battery_dictionary_v1";

module.exports = function createBatteryDictionaryService({ semanticModelRegistry = null } = {}) {
  const registry = semanticModelRegistry || createSemanticModelRegistry();

  function getBatteryModel() {
    return registry.getModelByPath?.(BATTERY_FAMILY, BATTERY_VERSION)
      || registry.getModel?.(FALLBACK_BATTERY_MODEL_KEY)
      || null;
  }

  function getBatteryModelKey() {
    return getBatteryModel()?.semanticModelKey || FALLBACK_BATTERY_MODEL_KEY;
  }

  function getManifest() { return getBatteryModel()?.manifest || null; }
  function getTerms() { return registry.getTerms?.(getBatteryModelKey()) || []; }
  function getCategories() { return registry.getCategories?.(getBatteryModelKey()) || []; }
  function getUnits() { return registry.getUnits?.(getBatteryModelKey()) || []; }
  function getFieldMap() { return registry.getFieldMap?.(getBatteryModelKey()) || {}; }
  function getContext() { return registry.getContext?.(getBatteryModelKey()) || null; }
  function getDcatCatalog() { return registry.getDcatCatalog?.(getBatteryModelKey()) || null; }
  function getCategoryRules() { return registry.getCategoryRules?.(getBatteryModelKey()) || null; }

  function getTermBySlug(slug) {
    return registry.getTermBySlug?.(getBatteryModelKey(), slug) || null;
  }

  function getTermsByCategory(categoryKey) {
    return getTerms().filter((term) => term.category === categoryKey);
  }

  function resolveFieldKey(fieldKey) {
    return registry.resolveFieldKey?.(getBatteryModelKey(), fieldKey) || null;
  }

  function getTermByFieldKey(fieldKey) {
    return registry.getTermByFieldKey?.(getBatteryModelKey(), fieldKey) || null;
  }

  function getTermByIri(iri) {
    return registry.getTermByIri?.(getBatteryModelKey(), iri) || null;
  }

  function getCategoryRequirementForField(fieldKey, category) {
    return registry.getCategoryRequirementForField?.(getBatteryModelKey(), fieldKey, category) || null;
  }

  function buildJsonLdContext(typeDef) {
    return registry.buildJsonLdContext?.(typeDef, getBatteryModelKey()) || [];
  }

  return {
    getManifest,
    getTerms,
    getCategories,
    getUnits,
    getFieldMap,
    getContext,
    getDcatCatalog,
    getCategoryRules,
    getTermBySlug,
    getTermsByCategory,
    resolveFieldKey,
    getTermByFieldKey,
    getTermByIri,
    getCategoryRequirementForField,
    buildJsonLdContext,
  };
};
