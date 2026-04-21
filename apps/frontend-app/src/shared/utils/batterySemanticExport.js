import batteryPassDinSpec99100 from "../semantics/battery-pass-din-spec-99100.json";

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
  Object.values(batteryPassDinSpec99100.fieldSemanticIds || {}).forEach((semanticId) => {
    const fragment = String(semanticId || "").split("#").pop();
    const internalKey = toBatteryPassInternalKey(fragment);
    if (internalKey) map[internalKey] = semanticId;
  });
  Object.entries(batteryPassDinSpec99100.fieldSemanticIds || {}).forEach(([fieldKey, semanticId]) => {
    map[fieldKey] = semanticId;
  });
  return map;
})();

export function isBatteryPassExportType(passportType) {
  return String(passportType || "").trim().toLowerCase() === batteryPassDinSpec99100.passportType;
}

function collectSemanticIds(passport) {
  const semanticIds = {};
  Object.entries(SEMANTIC_ID_BY_INTERNAL_KEY).forEach(([fieldKey, semanticId]) => {
    if (passport[fieldKey] === undefined || passport[fieldKey] === null || passport[fieldKey] === "") return;
    semanticIds[fieldKey] = semanticId;
  });
  return semanticIds;
}

function buildInlineContext(passports, passportType) {
  const ctx = {};

  if (isBatteryPassExportType(passportType)) {
    ctx.batteryPass = batteryPassDinSpec99100.source.repository;
  }

  const seen = new Set();
  passports.forEach((passport) => {
    Object.entries(collectSemanticIds(passport)).forEach(([fieldKey, semanticId]) => {
      if (seen.has(fieldKey)) return;
      ctx[fieldKey] = { "@id": semanticId };
      seen.add(fieldKey);
    });
  });
  return ctx;
}

function sanitizePassport(passport, passportType) {
  const clean = { "@type": "DigitalProductPassport" };
  const resolvedPassportType = passport.passport_type || passportType || null;

  Object.entries(passport || {}).forEach(([key, value]) => {
    if (value === undefined) return;
    if (key === "_semanticIds") return;
    clean[key] = value;
  });

  if (resolvedPassportType && !clean.passport_type) {
    clean.passport_type = resolvedPassportType;
  }

  return clean;
}

export function buildPassportJsonLdExport(passports, passportType) {
  if (!Array.isArray(passports)) return passports;

  const resolvedType = String(passportType || passports[0]?.passport_type || "").trim().toLowerCase();
  const graph = passports.map((passport) => sanitizePassport(passport, resolvedType));
  const inlineContext = buildInlineContext(graph, resolvedType);
  const contexts = [DPP_CONTEXT];

  if (isBatteryPassExportType(resolvedType)) {
    contexts.push(...batteryPassDinSpec99100.contextUrls);
  }
  if (Object.keys(inlineContext).length) {
    contexts.push(inlineContext);
  }

  return {
    "@context": contexts,
    "@graph": graph,
    ...(isBatteryPassExportType(resolvedType)
      ? {
          passport_type: batteryPassDinSpec99100.passportType,
          semantic_model: batteryPassDinSpec99100.source,
        }
      : {}),
  };
}

export const buildBatteryPassJsonExport = buildPassportJsonLdExport;
