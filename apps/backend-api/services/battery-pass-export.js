"use strict";

const fs = require("fs");
const path = require("path");

const batteryPassDinSpec99100 = require("../resources/semantics/battery-pass-din-spec-99100.json");
const batteryDictionaryManifest = require("../resources/semantics/battery/v1/manifest.json");
const batteryDictionaryTerms = require("../resources/semantics/battery/v1/terms.json");
const compatibilityMap = require("../resources/semantics/battery/v1/compatibility-map.json");
const clarosBatteryContext = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../resources/semantics/battery/v1/context.jsonld"), "utf8")
);

const BATTERY_PASS_MODEL_KEY = "claros_battery_dictionary_v1";
const LEGACY_BATTERY_PASS_MODEL_KEY = "battery_pass_din_spec_99100";
const LEGACY_CLAROS_BATTERY_MODEL_KEY = "claros_battery_v1";
const BATTERY_CONTEXT_URL = batteryDictionaryManifest.contextUrl || "https://www.claros-dpp.online/dictionary/battery/v1/context.jsonld";
const CLAROS_CONTEXT_ENTRIES = clarosBatteryContext?.["@context"] || {};

const DPP_CONTEXT = {
  "@version": 1.1,
  dpp: "https://schema.digitalproductpassport.eu/ns/dpp#",
  DigitalProductPassport: "dpp:DigitalProductPassport",
  digitalProductPassportId: "dpp:digitalProductPassportId",
  uniqueProductIdentifier: "dpp:uniqueProductIdentifier",
  granularity: "dpp:granularity",
  dppSchemaVersion: "dpp:dppSchemaVersion",
  dppStatus: "dpp:dppStatus",
  lastUpdate: { "@id": "dpp:lastUpdate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  economicOperatorId: "dpp:economicOperatorId",
  facilityId: "dpp:facilityId",
  contentSpecificationIds: "dpp:contentSpecificationIds",
  subjectDid: "dpp:subjectDid",
  dppDid: "dpp:dppDid",
  companyDid: "dpp:companyDid",
  guid: "dpp:guid",
  passport_type: "dpp:passportType",
  passportType: "dpp:passportType",
  semantic_model: "dpp:semanticModel",
  model_name: "dpp:modelName",
  modelName: "dpp:modelName",
  product_id: "dpp:productId",
  release_status: "dpp:releaseStatus",
  version_number: { "@id": "dpp:versionNumber", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
  versionNumber: { "@id": "dpp:versionNumber", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
  archived_at: { "@id": "dpp:archivedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  created_at: { "@id": "dpp:createdAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  updated_at: { "@id": "dpp:updatedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
};

function toBatteryPassInternalKey(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

const SEMANTIC_ID_BY_INTERNAL_KEY = (() => {
  const map = {};
  for (const term of batteryDictionaryTerms) {
    const semanticId = term.iri || term.termIri;
    if (!semanticId) continue;
    const aliases = new Set([
      term.internalKey,
      term.internal_key,
      toBatteryPassInternalKey(term.internalKey),
      toBatteryPassInternalKey(term.label),
    ]);
    for (const fieldKey of (term.appFieldKeys || [])) {
      aliases.add(fieldKey);
    }
    for (const alias of aliases) {
      if (alias) map[alias] = semanticId;
    }
  }
  return map;
})();

function getSemanticIdForFieldKey(fieldKey) {
  if (!fieldKey) return null;
  return SEMANTIC_ID_BY_INTERNAL_KEY[fieldKey] || null;
}

function normalizeSemanticModelKey(modelKey) {
  return String(modelKey || "").trim().toLowerCase();
}

function resolveRequestedBatteryModelKey(options = {}, typeDef = null) {
  const explicitModelKey = normalizeSemanticModelKey(options.semanticModelKey || typeDef?.semantic_model_key);
  return explicitModelKey || BATTERY_PASS_MODEL_KEY;
}

function isLegacyBatterySemanticModel(modelKey) {
  return modelKey === LEGACY_BATTERY_PASS_MODEL_KEY;
}

function isSupportedBatterySemanticModel(modelKey) {
  return [
    BATTERY_PASS_MODEL_KEY,
    LEGACY_BATTERY_PASS_MODEL_KEY,
    LEGACY_CLAROS_BATTERY_MODEL_KEY,
  ].includes(modelKey);
}

function isBatteryPassExportType(passportType) {
  return String(passportType || "").trim().toLowerCase() === batteryPassDinSpec99100.passportType;
}

function shouldUseBatteryDictionary(passportType, options = {}, typeDef = null) {
  if (!isBatteryPassExportType(passportType)) return false;
  const modelKey = resolveRequestedBatteryModelKey(options, typeDef);
  return isSupportedBatterySemanticModel(modelKey);
}

function resolveDictionaryTermIri(fieldKey, semanticId = null, options = {}, typeDef = null) {
  const modelKey = resolveRequestedBatteryModelKey(options, typeDef);
  if (semanticId && compatibilityMap[semanticId]) {
    return compatibilityMap[semanticId];
  }
  if (semanticId && /^https?:\/\//i.test(String(semanticId))) {
    return semanticId;
  }
  if (semanticId && !isLegacyBatterySemanticModel(modelKey)) {
    return semanticId;
  }
  return getSemanticIdForFieldKey(fieldKey);
}

function buildInlineContext(passports, passportType, options = {}) {
  const ctx = {};

  if (!shouldUseBatteryDictionary(passportType, options)) return ctx;

  const seenKeys = new Set();
  for (const passport of passports || []) {
    for (const [key, value] of Object.entries(passport || {})) {
      if (value === undefined || key === "_semanticIds") continue;
      seenKeys.add(key);
    }
  }

  for (const fieldKey of seenKeys) {
    const semanticId = getSemanticIdForFieldKey(fieldKey);
    if (semanticId && !CLAROS_CONTEXT_ENTRIES[fieldKey]) {
      ctx[fieldKey] = { "@id": semanticId };
    }
  }

  return ctx;
}

function sanitizePassport(passport, passportType) {
  const clean = { "@type": "DigitalProductPassport" };
  const resolvedPassportType = passport.passport_type || passportType || null;

  for (const [key, value] of Object.entries(passport || {})) {
    if (value === undefined) continue;
    if (key === "_semanticIds") continue;
    clean[key] = value;
  }

  if (resolvedPassportType && !clean.passport_type) {
    clean.passport_type = resolvedPassportType;
  }

  return clean;
}

function buildPassportJsonLdContext(typeDef, passportType = null, options = {}) {
  const resolvedType = String(passportType || typeDef?.type_name || "").trim().toLowerCase();
  const contexts = [DPP_CONTEXT];

  if (!shouldUseBatteryDictionary(resolvedType, options, typeDef)) {
    return contexts;
  }

  contexts.push(BATTERY_CONTEXT_URL);

  const inlineContext = {};
  const sections = typeDef?.fields_json?.sections || [];
  for (const section of sections) {
    for (const field of (section.fields || [])) {
      if (!field?.key) continue;
      const semanticId = resolveDictionaryTermIri(field.key, field.semanticId, options, typeDef);
      if (!semanticId || CLAROS_CONTEXT_ENTRIES[field.key]) continue;
      inlineContext[field.key] = { "@id": semanticId };
    }
  }

  if (Object.keys(inlineContext).length > 0) {
    contexts.push(inlineContext);
  }

  return contexts;
}

function buildPassportJsonLdExport(passports, passportType) {
  if (!Array.isArray(passports)) return passports;
  const options = arguments[2] || {};

  const resolvedType = String(passportType || passports[0]?.passport_type || "").trim().toLowerCase();
  const graph = passports.map((passport) => sanitizePassport(passport, resolvedType));
  const inlineContext = buildInlineContext(graph, resolvedType, options);
  const contexts = [DPP_CONTEXT];

  if (shouldUseBatteryDictionary(resolvedType, options)) {
    contexts.push(BATTERY_CONTEXT_URL);
  }
  if (Object.keys(inlineContext).length) {
    contexts.push(inlineContext);
  }

  return {
    "@context": contexts,
    "@graph": graph,
    ...(shouldUseBatteryDictionary(resolvedType, options)
      ? {
          passport_type: batteryPassDinSpec99100.passportType,
          semantic_model: {
            semanticModelKey: BATTERY_PASS_MODEL_KEY,
            contextUrl: batteryDictionaryManifest.contextUrl,
            termsUrl: batteryDictionaryManifest.termsUrl,
            issuerDid: batteryDictionaryManifest.issuerDid,
            legacyRequestedModelKey: isLegacyBatterySemanticModel(resolveRequestedBatteryModelKey(options))
              ? LEGACY_BATTERY_PASS_MODEL_KEY
              : null,
          },
        }
      : {}),
  };
}

const buildBatteryPassJsonExport = buildPassportJsonLdExport;

module.exports = {
  buildPassportJsonLdContext,
  isBatteryPassExportType,
  buildPassportJsonLdExport,
  buildBatteryPassJsonExport,
};
