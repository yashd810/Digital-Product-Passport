const BATTERY_PASS_PASSPORT_TYPE = "din_spec_99100";
const BATTERY_PASS_MODEL_KEY = "claros_battery_dictionary_v1";
const BATTERY_CONTEXT_URL = "https://www.claros-dpp.online/dictionary/battery/v1/context.jsonld";

const DPP_CONTEXT = {
  "@version": 1.1,
  dpp: "https://schema.digitalproductpassport.eu/ns/dpp#",
  DigitalProductPassport: "dpp:DigitalProductPassport",
  digitalProductPassportId: "dpp:digitalProductPassportId",
  uniqueProductIdentifier: "dpp:uniqueProductIdentifier",
  granularity: "dpp:granularity",
  dppSchemaVersion: "dpp:dppSchemaVersion",
  dppStatus: "dpp:dppStatus",
  lastUpdated: { "@id": "dpp:lastUpdate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  lastUpdate: { "@id": "dpp:lastUpdate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  economicOperatorId: "dpp:economicOperatorId",
  facilityId: "dpp:facilityId",
  contentSpecificationIds: "dpp:contentSpecificationIds",
  subjectDid: "dpp:subjectDid",
  dppDid: "dpp:dppDid",
  companyDid: "dpp:companyDid",
  elements: "dpp:elements",
  elementId: "dpp:elementId",
  objectType: "dpp:objectType",
  dictionaryReference: { "@id": "dpp:dictionaryReference", "@type": "@id" },
  valueDataType: "dpp:valueDataType",
  value: "dpp:value",
  extensions: "dpp:extensions",
  claros: "dpp:claros",
  passportType: "dpp:passportType",
  versionNumber: { "@id": "dpp:versionNumber", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
  internalId: "dpp:internalId",
  dppId: "dpp:dppId",
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

function normalizeCategoryKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isBatteryUmbrellaCategory(umbrellaCategory) {
  const normalized = normalizeCategoryKey(umbrellaCategory);
  return Boolean(normalized) && normalized.includes("battery");
}

export function isBatteryPassExportType(passportType) {
  return String(passportType || "").trim().toLowerCase() === BATTERY_PASS_PASSPORT_TYPE;
}

function shouldUseBatteryDictionary(passportType, options = {}) {
  if (isBatteryUmbrellaCategory(options.umbrellaCategory)) return true;
  const modelKey = normalizeSemanticModelKey(options.semanticModelKey);
  if (modelKey === BATTERY_PASS_MODEL_KEY) return true;
  if (modelKey) return isBatteryPassExportType(passportType);
  return isBatteryPassExportType(passportType);
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
          passport_type: resolvedType || graph[0]?.passport_type || null,
          semantic_model: {
            semanticModelKey: BATTERY_PASS_MODEL_KEY,
            contextUrl: BATTERY_CONTEXT_URL,
          },
        }
      : {}),
  };
}

export const buildBatteryPassJsonExport = buildPassportJsonLdExport;
