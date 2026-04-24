#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_PATH = path.join(ROOT, "apps/backend-api/resources/battery-terms-source.json");
const OUTPUT_DIR = path.join(ROOT, "apps/backend-api/resources/semantics/battery/v1");
const FRONTEND_SEMANTICS_DIR = path.join(ROOT, "apps/frontend-app/src/shared/semantics");
const LEGACY_TERMS_PATH = path.join(OUTPUT_DIR, "terms.json");
const LEGACY_CATEGORIES_PATH = path.join(OUTPUT_DIR, "categories.json");
const LEGACY_UNITS_PATH = path.join(OUTPUT_DIR, "units.json");
const LEGACY_FIELD_MAP_PATH = path.join(OUTPUT_DIR, "field-map.json");
const LEGACY_SPEC_PATH = path.join(ROOT, "apps/backend-api/resources/semantics/battery-pass-din-spec-99100.json");

const BASE_IRI = "https://www.claros-dpp.online/dictionary/battery/v1";
const TERM_BASE_IRI = `${BASE_IRI}/terms/`;
const API_BASE = "https://www.claros-dpp.online/api/dictionary/battery/v1";
const MODEL_KEY = "claros_battery_dictionary_v1";
const LEGACY_MODEL_KEY = "battery_pass_din_spec_99100";

const DATA_TYPE_MAP = {
  String: { format: "String", jsonType: "string", xsdType: "xsd:string" },
  Decimal: { format: "Decimal", jsonType: "number", xsdType: "xsd:decimal" },
  Integer: { format: "Integer", jsonType: "integer", xsdType: "xsd:integer" },
  "Timestamp UTC-based": { format: "Timestamp UTC-based", jsonType: "string", xsdType: "xsd:dateTime" },
  "URI/URL": { format: "URI/URL", jsonType: "string", xsdType: "xsd:anyURI" },
  "ID (string)": { format: "ID (string)", jsonType: "string", xsdType: "xsd:string" },
  "Array (string)": { format: "Array (string)", jsonType: "array", xsdType: "xsd:string", items: { type: "string" } },
  "Date[YYYY-MM]": { format: "Date[YYYY-MM]", jsonType: "string", xsdType: "xsd:gYearMonth" },
};

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function ensureArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a JSON array`);
  }
  return value;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/['"]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function toWords(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/['"]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function toCamelCase(value) {
  const words = toWords(value);
  if (!words.length) return "";
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

function toSnakeCase(value) {
  return toWords(value).map((word) => word.toLowerCase()).join("_");
}

function toCategoryKey(value) {
  return slugify(value);
}

function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildUnitKey(unitDisplay, legacyUnitsByDisplay) {
  if (!unitDisplay || unitDisplay === "n.a.") return "none";
  if (legacyUnitsByDisplay.has(unitDisplay)) return legacyUnitsByDisplay.get(unitDisplay).key;
  return String(unitDisplay)
    .toLowerCase()
    .replace(/°/g, "deg_")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_") || "none";
}

function buildUnitDescription(unitDisplay) {
  if (!unitDisplay || unitDisplay === "n.a.") {
    return "No unit applicable; the attribute is dimensionless or textual";
  }
  return `Unit extracted from the BatteryPass long list: ${unitDisplay}`;
}

function buildCategoryDescription(label, legacyCategoryByLabel) {
  return legacyCategoryByLabel.get(label)?.description
    || `Battery passport attributes grouped under ${label}.`;
}

function buildTermContextEntry(slug, dataType) {
  const entry = { "@id": `clarosBattery:${slug}` };
  if (dataType.jsonType === "array") {
    entry["@container"] = "@set";
    entry["@type"] = dataType.xsdType;
    return entry;
  }
  entry["@type"] = dataType.xsdType;
  return entry;
}

function main() {
  const sourceTerms = ensureArray(readJson(SOURCE_PATH), "battery-terms-source.json");
  const legacyTerms = ensureArray(readJson(LEGACY_TERMS_PATH, []), "legacy terms");
  const legacyCategories = ensureArray(readJson(LEGACY_CATEGORIES_PATH, []), "legacy categories");
  const legacyUnits = ensureArray(readJson(LEGACY_UNITS_PATH, []), "legacy units");
  const legacyFieldMap = readJson(LEGACY_FIELD_MAP_PATH, {}) || {};
  const legacySpec = readJson(LEGACY_SPEC_PATH, {}) || {};

  const sourceStat = fs.statSync(SOURCE_PATH);
  const generatedAt = sourceStat.mtime.toISOString();

  const legacyTermByNumber = new Map(
    legacyTerms.map((term) => [Number(term.number || term.specRef || term.id), term])
  );
  const legacyCategoryByLabel = new Map(
    legacyCategories.map((category) => [String(category.label || ""), category])
  );
  const legacyUnitsByDisplay = new Map(
    legacyUnits.map((unit) => [String(unit.display || ""), unit])
  );

  const terms = sourceTerms
    .slice()
    .sort((a, b) => Number(a.number) - Number(b.number))
    .map((sourceTerm) => {
      const number = Number(sourceTerm.number);
      const legacy = legacyTermByNumber.get(number) || {};
      const attributeName = String(sourceTerm.attribute_name || "").trim();
      const categoryLabel = String(sourceTerm.category || "").trim();
      const slug = legacy.slug || slugify(attributeName);
      const internalKey = toCamelCase(attributeName);
      const elementId = internalKey;
      const dataType = DATA_TYPE_MAP[sourceTerm.data_format];

      if (!dataType) {
        throw new Error(`Unsupported data_format "${sourceTerm.data_format}" for term #${number}`);
      }

      const appFieldKeys = Array.isArray(legacy.appFieldKeys) && legacy.appFieldKeys.length
        ? legacy.appFieldKeys.slice().sort()
        : [toSnakeCase(attributeName)];

      const unit = buildUnitKey(sourceTerm.unit, legacyUnitsByDisplay);
      const iri = `${TERM_BASE_IRI}${slug}`;

      return {
        id: number,
        number,
        specRef: number,
        slug,
        iri,
        termIri: iri,
        label: attributeName,
        attributeName,
        definition: String(sourceTerm.short_definition || "").trim(),
        shortDefinition: String(sourceTerm.short_definition || "").trim(),
        category: toCategoryKey(categoryLabel),
        categoryLabel,
        subcategory: sourceTerm.subcategory || null,
        internalKey,
        internal_key: internalKey,
        elementId,
        element_id: elementId,
        dataType,
        unit,
        unitDisplay: sourceTerm.unit || "n.a.",
        accessRights: legacy.accessRights || null,
        staticOrDynamic: legacy.staticOrDynamic || null,
        regulationReferences: Array.isArray(legacy.regulationReferences) ? legacy.regulationReferences : [],
        appFieldKeys,
      };
    });

  const fieldMap = {};
  for (const term of terms) {
    for (const fieldKey of term.appFieldKeys) {
      fieldMap[fieldKey] = term.iri;
    }
  }

  const categoriesByKey = new Map();
  for (const term of terms) {
    const key = term.category;
    if (!categoriesByKey.has(key)) {
      categoriesByKey.set(key, {
        key,
        label: term.categoryLabel,
        description: buildCategoryDescription(term.categoryLabel, legacyCategoryByLabel),
        termCount: 0,
        terms: [],
      });
    }
    const category = categoriesByKey.get(key);
    category.termCount += 1;
    category.terms.push({
      number: term.number,
      slug: term.slug,
      internalKey: term.internalKey,
      label: term.label,
      iri: term.iri,
    });
  }

  const categories = [...categoriesByKey.values()].sort((a, b) => {
    const aNumber = a.terms[0]?.number || 0;
    const bNumber = b.terms[0]?.number || 0;
    return aNumber - bNumber;
  });

  const unitsByKey = new Map();
  for (const term of terms) {
    if (unitsByKey.has(term.unit)) continue;
    const legacyUnit = legacyUnitsByDisplay.get(term.unitDisplay);
    unitsByKey.set(term.unit, {
      key: term.unit,
      display: term.unitDisplay || "n.a.",
      description: legacyUnit?.description || buildUnitDescription(term.unitDisplay),
      xsdType: term.dataType.xsdType,
      jsonType: term.dataType.jsonType,
    });
  }

  const units = [...unitsByKey.values()].sort((a, b) => a.display.localeCompare(b.display));

  const compatibilityMap = {};
  for (const [fieldKey, semanticId] of Object.entries(legacySpec.fieldSemanticIds || {})) {
    const termIri = fieldMap[fieldKey];
    if (termIri) {
      compatibilityMap[semanticId] = termIri;
    }
  }

  const context = {
    "@context": {
      "@version": 1.1,
      clarosBattery: TERM_BASE_IRI,
      xsd: "http://www.w3.org/2001/XMLSchema#",
    },
  };

  for (const term of terms) {
    context["@context"][term.internalKey] = buildTermContextEntry(term.slug, term.dataType);
    for (const fieldKey of term.appFieldKeys) {
      context["@context"][fieldKey] = buildTermContextEntry(term.slug, term.dataType);
    }
  }

  const manifest = {
    semanticModelKey: MODEL_KEY,
    legacySemanticModelKeys: [LEGACY_MODEL_KEY, "claros_battery_v1"],
    name: "Claros Battery Dictionary",
    version: "1.0.0",
    description: "Internal battery passport dictionary derived from the BatteryPass Data Attribute Longlist v1.3.",
    batteryCategoryScope: ["EV", "LMT", "Industrial", "Stationary"],
    sourceWorkbook: "2026_BatteryPass-Ready_DataAttributeLongList_v1.3.xlsx",
    generatedAt,
    publisher: {
      name: "Claros DPP",
      url: "https://www.claros-dpp.online",
    },
    issuerDid: "did:web:www.claros-dpp.online",
    baseIri: BASE_IRI,
    contextUrl: `${BASE_IRI}/context.jsonld`,
    termsUrl: `${API_BASE}/terms`,
    unitsUrl: `${API_BASE}/units`,
    categoriesUrl: `${API_BASE}/categories`,
    fieldMapUrl: `${API_BASE}/field-map`,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(FRONTEND_SEMANTICS_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, "manifest.json"), stableStringify(manifest));
  fs.writeFileSync(path.join(OUTPUT_DIR, "terms.json"), stableStringify(terms));
  fs.writeFileSync(path.join(OUTPUT_DIR, "categories.json"), stableStringify(categories));
  fs.writeFileSync(path.join(OUTPUT_DIR, "units.json"), stableStringify(units));
  fs.writeFileSync(path.join(OUTPUT_DIR, "context.jsonld"), stableStringify(context));
  fs.writeFileSync(path.join(OUTPUT_DIR, "compatibility-map.json"), stableStringify(compatibilityMap));
  fs.writeFileSync(path.join(OUTPUT_DIR, "field-map.json"), stableStringify(fieldMap));
  fs.writeFileSync(path.join(FRONTEND_SEMANTICS_DIR, "battery-dictionary-terms.generated.json"), stableStringify(terms));

  console.log(`Generated battery dictionary artifacts for ${terms.length} terms in ${OUTPUT_DIR}`);
}

main();
