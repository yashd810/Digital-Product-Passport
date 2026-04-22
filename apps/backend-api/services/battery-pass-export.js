"use strict";

const batteryPassDinSpec99100 = require("../resources/semantics/battery-pass-din-spec-99100.json");
const BATTERY_PASS_MODEL_KEY = "battery_pass_din_spec_99100";

const DPP_CONTEXT = {
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
  for (const semanticId of new Set(Object.values(batteryPassDinSpec99100.fieldSemanticIds || {}))) {
    const fragment = String(semanticId || "").split("#").pop();
    const internalKey = toBatteryPassInternalKey(fragment);
    if (internalKey) map[internalKey] = semanticId;
  }
  for (const [fieldKey, semanticId] of Object.entries(batteryPassDinSpec99100.fieldSemanticIds || {})) {
    map[fieldKey] = semanticId;
  }
  return map;
})();

function getSemanticIdForFieldKey(fieldKey) {
  if (!fieldKey) return null;
  return SEMANTIC_ID_BY_INTERNAL_KEY[fieldKey] || null;
}

function isBatteryPassExportType(passportType) {
  return String(passportType || "").trim().toLowerCase() === batteryPassDinSpec99100.passportType;
}

function isBatteryPassSemanticExport(passportType, options = {}) {
  return (
    isBatteryPassExportType(passportType) &&
    String(options.semanticModelKey || "").trim().toLowerCase() === BATTERY_PASS_MODEL_KEY
  );
}

function buildInlineContext(passports, passportType, options = {}) {
  const ctx = {};

  if (!isBatteryPassSemanticExport(passportType, options)) return ctx;

  ctx.batteryPass = batteryPassDinSpec99100.source.repository;
  for (const [fieldKey, semanticId] of Object.entries(SEMANTIC_ID_BY_INTERNAL_KEY)) {
    ctx[fieldKey] = { "@id": semanticId };
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

function buildPassportJsonLdContext(typeDef, passportType = null) {
  const options = arguments[2] || {};
  const resolvedType = String(passportType || typeDef?.type_name || "").trim().toLowerCase();
  const contexts = [DPP_CONTEXT];
  const inlineContext = {};
  const sections = typeDef?.fields_json?.sections || [];

  if (!isBatteryPassSemanticExport(resolvedType, options)) {
    return contexts;
  }

  for (const section of sections) {
    for (const field of (section.fields || [])) {
      if (!field?.key) continue;
      const semanticId = field.semanticId || getSemanticIdForFieldKey(field.key);
      if (!semanticId) continue;
      inlineContext[field.key] = { "@id": semanticId };
    }
  }

  if (isBatteryPassSemanticExport(resolvedType, options)) {
    contexts.push(...batteryPassDinSpec99100.contextUrls);
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

  if (isBatteryPassSemanticExport(resolvedType, options)) {
    contexts.push(...batteryPassDinSpec99100.contextUrls);
  }
  if (Object.keys(inlineContext).length) {
    contexts.push(inlineContext);
  }

  return {
    "@context": contexts,
    "@graph": graph,
    ...(isBatteryPassSemanticExport(resolvedType, options)
      ? {
          passport_type: batteryPassDinSpec99100.passportType,
          semantic_model: batteryPassDinSpec99100.source,
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
