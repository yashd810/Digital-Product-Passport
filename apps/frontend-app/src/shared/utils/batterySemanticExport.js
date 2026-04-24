import batteryPassDinSpec99100 from "../semantics/battery-pass-din-spec-99100.json";

const BATTERY_PASS_MODEL_KEY = "claros_battery_dictionary_v1";
const LEGACY_BATTERY_PASS_MODEL_KEY = "battery_pass_din_spec_99100";
const LEGACY_CLAROS_BATTERY_MODEL_KEY = "claros_battery_v1";
const BATTERY_CONTEXT_URL = "https://www.claros-dpp.online/dictionary/battery/v1/context.jsonld";

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

function normalizeSemanticModelKey(modelKey) {
  return String(modelKey || "").trim().toLowerCase();
}

export function isBatteryPassExportType(passportType) {
  return String(passportType || "").trim().toLowerCase() === batteryPassDinSpec99100.passportType;
}

function shouldUseBatteryDictionary(passportType, options = {}) {
  if (!isBatteryPassExportType(passportType)) return false;
  const modelKey = normalizeSemanticModelKey(options.semanticModelKey);
  return (
    !modelKey ||
    modelKey === BATTERY_PASS_MODEL_KEY ||
    modelKey === LEGACY_BATTERY_PASS_MODEL_KEY ||
    modelKey === LEGACY_CLAROS_BATTERY_MODEL_KEY
  );
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
  const options = arguments[2] || {};

  const resolvedType = String(passportType || passports[0]?.passport_type || "").trim().toLowerCase();
  const graph = passports.map((passport) => sanitizePassport(passport, resolvedType));
  const contexts = [DPP_CONTEXT];

  if (shouldUseBatteryDictionary(resolvedType, options)) {
    contexts.push(BATTERY_CONTEXT_URL);
  }

  return {
    "@context": contexts,
    "@graph": graph,
    ...(shouldUseBatteryDictionary(resolvedType, options)
      ? {
          passport_type: batteryPassDinSpec99100.passportType,
          semantic_model: {
            semanticModelKey: BATTERY_PASS_MODEL_KEY,
            contextUrl: BATTERY_CONTEXT_URL,
            legacyRequestedModelKey: normalizeSemanticModelKey(options.semanticModelKey) === LEGACY_BATTERY_PASS_MODEL_KEY
              ? LEGACY_BATTERY_PASS_MODEL_KEY
              : null,
          },
        }
      : {}),
  };
}

export const buildBatteryPassJsonExport = buildPassportJsonLdExport;
