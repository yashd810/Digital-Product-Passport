"use strict";

const path = require("path");
const fs   = require("fs");

const DICT_DIR = path.join(__dirname, "../resources/semantics/battery/v1");

function loadJson(filename) {
  const fullPath = path.join(DICT_DIR, filename);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

module.exports = function createBatteryDictionaryService() {
  const manifest        = loadJson("manifest.json");
  const terms           = loadJson("terms.json");
  const categories      = loadJson("categories.json");
  const units           = loadJson("units.json");
  const fieldMap        = loadJson("field-map.json");
  const compatibilityMap = loadJson("compatibility-map.json");
  const context         = loadJson("context.jsonld");

  // Index terms by slug and by field key for fast lookup
  const termsBySlug = {};
  const termsByFieldKey = {};
  for (const term of terms) {
    termsBySlug[term.slug] = term;
    for (const key of (term.appFieldKeys || [])) {
      termsByFieldKey[key] = term;
    }
  }

  const unitsByKey = {};
  for (const unit of units) {
    unitsByKey[unit.key] = unit;
  }

  function getManifest() { return manifest; }
  function getTerms() { return terms; }
  function getCategories() { return categories; }
  function getUnits() { return units; }
  function getFieldMap() { return fieldMap; }
  function getCompatibilityMap() { return compatibilityMap; }
  function getContext() { return context; }

  function getTermBySlug(slug) {
    return termsBySlug[String(slug || "")] || null;
  }

  function getTermsByCategory(categoryKey) {
    return terms.filter(t => t.category === categoryKey);
  }

  // Returns the Claros term IRI for a given app field key, or null
  function resolveFieldKey(fieldKey) {
    return fieldMap[String(fieldKey || "")] || null;
  }

  // Returns the term object for a given app field key, or null
  function getTermByFieldKey(fieldKey) {
    return termsByFieldKey[String(fieldKey || "")] || null;
  }

  // Build a JSON-LD context array for a passport type that uses the Claros battery dictionary
  function buildJsonLdContext(typeDef) {
    const clarosContextUrl = manifest.contextUrl || "https://www.claros-dpp.online/dictionary/battery/v1/context.jsonld";

    // Base DPP context inline object
    const dppContext = {
      "@version": 1.1,
      dpp: "https://schema.digitalproductpassport.eu/ns/dpp#",
      DigitalProductPassport: "dpp:DigitalProductPassport",
      guid: "dpp:guid",
      passport_type: "dpp:passportType",
      semantic_model: "dpp:semanticModel",
      model_name: "dpp:modelName",
      product_id: "dpp:productId",
      release_status: "dpp:releaseStatus",
      version_number: { "@id": "dpp:versionNumber", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
      created_at: { "@id": "dpp:createdAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
      updated_at: { "@id": "dpp:updatedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
    };

    const contexts = [dppContext, clarosContextUrl];

    // Add per-field inline mappings for any field not already in the context
    if (typeDef?.fields_json?.sections) {
      const inlineOverrides = {};
      for (const section of typeDef.fields_json.sections) {
        for (const field of (section.fields || [])) {
          if (!field?.key) continue;
          const termIri = resolveFieldKey(field.key) || field.semanticId;
          if (termIri && !context?.["@context"]?.[field.key]) {
            inlineOverrides[field.key] = { "@id": termIri };
          }
        }
      }
      if (Object.keys(inlineOverrides).length > 0) {
        contexts.push(inlineOverrides);
      }
    }

    return contexts;
  }

  return {
    getManifest,
    getTerms,
    getCategories,
    getUnits,
    getFieldMap,
    getCompatibilityMap,
    getContext,
    getTermBySlug,
    getTermsByCategory,
    resolveFieldKey,
    getTermByFieldKey,
    buildJsonLdContext,
  };
};
