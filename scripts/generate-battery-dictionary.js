#!/usr/bin/env node
"use strict";

// Maintenance script.
// Not used at runtime. Run manually when battery-terms-source.json changes.
// Regenerates backend dictionary JSON files and frontend generated term list.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_PATH = path.join(ROOT, "apps/backend-api/resources/battery-terms-source.json");
const SOURCE_WORKBOOK_PATH = path.join(ROOT, "data/2026_BatteryPass-Ready_DataAttributeLongList_v1.3.xlsx");
const OUTPUT_DIR = path.join(ROOT, "apps/backend-api/resources/semantics/battery/v1");
const FRONTEND_SEMANTICS_DIR = path.join(ROOT, "apps/frontend-app/src/shared/semantics");
const LEGACY_TERMS_PATH = path.join(OUTPUT_DIR, "terms.json");
const LEGACY_CATEGORIES_PATH = path.join(OUTPUT_DIR, "categories.json");
const LEGACY_UNITS_PATH = path.join(OUTPUT_DIR, "units.json");
const LEGACY_FIELD_MAP_PATH = path.join(OUTPUT_DIR, "field-map.json");

const BASE_IRI = "https://www.claros-dpp.online/dictionary/battery/v1";
const TERM_BASE_IRI = `${BASE_IRI}/terms/`;
const API_BASE = "https://www.claros-dpp.online/api/dictionary/battery/v1";
const MODEL_KEY = "claros_battery_dictionary_v1";
const WORKBOOK_SHEET_NAME = "Data attribute longlist_DR_v1.3";
const DPP_CLASS_IRI = `${BASE_IRI}/classes/DigitalBatteryPassport`;
const GENERIC_DPP_CLASS_IRI = "https://schema.digitalproductpassport.eu/ns/dpp#DigitalProductPassport";
const DCAT_AP_301_IRI = "https://semiceu.github.io/DCAT-AP/releases/3.0.1/";
const DCAT_3_IRI = "https://www.w3.org/TR/vocab-dcat-3/";
const DOMAIN_CLASS_BASE_IRI = `${BASE_IRI}/classes/`;

const DOMAIN_CLASSES = {
  DigitalBatteryPassport: {
    label: "Digital Battery Passport",
  },
  DPPInfo: {
    label: "DPP Information",
  },
  BatteryIdentifiers: {
    label: "Battery Identifiers",
  },
  OperatorIdentifiers: {
    label: "Operator Identifiers",
  },
  ProductData: {
    label: "Product Data",
  },
  RestrictedProductInfo: {
    label: "Restricted Product Info",
  },
  BatteryAttributes: {
    label: "Battery Attributes",
  },
  BatteryCompliancePublic: {
    label: "Battery Compliance Public",
  },
  BatteryComplianceRestricted: {
    label: "Battery Compliance Restricted",
  },
  BatteryCarbonFootprint: {
    label: "Battery Carbon Footprint",
  },
  SupplyChainDueDiligence: {
    label: "Supply Chain Due Diligence",
  },
  BatteryMaterialsPublic: {
    label: "Battery Materials Public",
  },
  BatteryMaterialsRestricted: {
    label: "Battery Materials Restricted",
  },
  BatteryCircularityPublic: {
    label: "Battery Circularity Public",
  },
  BatteryCircularityRestricted: {
    label: "Battery Circularity Restricted",
  },
  RecycledRenewableContent: {
    label: "Recycled and Renewable Content",
  },
  EndUserInformation: {
    label: "End-User Information",
  },
  PerformanceDurabilityPublic: {
    label: "Performance and Durability Public",
  },
  PerformanceDurabilityRestricted: {
    label: "Performance and Durability Restricted",
  },
  PowerCapabilityPublic: {
    label: "Power Capability Public",
  },
  PowerCapabilityRestricted: {
    label: "Power Capability Restricted",
  },
  RoundTripEfficiencyPublic: {
    label: "Round Trip Efficiency Public",
  },
  RoundTripEfficiencyRestricted: {
    label: "Round Trip Efficiency Restricted",
  },
  InternalResistancePublic: {
    label: "Internal Resistance Public",
  },
  InternalResistanceRestricted: {
    label: "Internal Resistance Restricted",
  },
  BatteryLifetimePublic: {
    label: "Battery Lifetime Public",
  },
  BatteryLifetimeRestricted: {
    label: "Battery Lifetime Restricted",
  },
  TemperatureConditionsPublic: {
    label: "Temperature Conditions Public",
  },
  TemperatureConditionsRestricted: {
    label: "Temperature Conditions Restricted",
  },
  NegativeEvents: {
    label: "Negative Events",
  },
};

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

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function getXmlAttribute(tag, name) {
  const match = String(tag || "").match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : "";
}

function stripXmlTags(value) {
  return decodeXml(String(value || "").replace(/<[^>]+>/g, ""));
}

function columnIndex(cellRef) {
  const letters = String(cellRef || "").replace(/[^A-Z]/gi, "").toUpperCase();
  let index = 0;
  for (const letter of letters) {
    index = (index * 26) + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

function normalizeSpreadsheetValue(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function normalizeHeader(value) {
  return normalizeSpreadsheetValue(value)
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeDataFormat(value) {
  return normalizeSpreadsheetValue(value).replace(/\s+/g, " ");
}

function parseRequirementMarker(value) {
  const marker = normalizeSpreadsheetValue(value).toLowerCase();
  if (marker === "x") return "mandatory_battreg";
  if (marker === "(x)") return "mandatory_espr_jtc24";
  if (marker === "o") return "voluntary";
  return null;
}

function parseGranularityMarker(value) {
  const marker = normalizeSpreadsheetValue(value).toLowerCase();
  if (marker === "x") return "mandatory";
  if (marker === "o") return "voluntary";
  return null;
}

function splitReferenceList(value) {
  const normalized = normalizeSpreadsheetValue(value);
  if (!normalized || normalized === "-") return [];
  return normalized
    .split(/;\s*|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function expandCurie(value) {
  if (String(value).startsWith("xsd:")) {
    return `http://www.w3.org/2001/XMLSchema#${String(value).slice(4)}`;
  }
  if (String(value).startsWith("dcat:")) {
    return `http://www.w3.org/ns/dcat#${String(value).slice(5)}`;
  }
  if (String(value).startsWith("dcterms:")) {
    return `http://purl.org/dc/terms/${String(value).slice(8)}`;
  }
  return value;
}

function buildDomainClass(classKey) {
  const definition = DOMAIN_CLASSES[classKey] || DOMAIN_CLASSES.DigitalBatteryPassport;
  const domain = {
    iri: `${DOMAIN_CLASS_BASE_IRI}${classKey}`,
    curie: `clarosBatteryClass:${classKey}`,
    label: definition.label,
    broaderClass: {
      iri: DPP_CLASS_IRI,
      curie: "clarosBatteryClass:DigitalBatteryPassport",
      label: "Digital Battery Passport",
    },
  };
  if (classKey === "DigitalBatteryPassport") {
    domain.broaderClass = {
      iri: GENERIC_DPP_CLASS_IRI,
      curie: "dpp:DigitalProductPassport",
      label: "Digital Product Passport",
    };
  }
  return domain;
}

function isPublicTerm(term) {
  return /^public$/i.test(String(term.accessRights || ""));
}

function resolveDomainClassKey(term) {
  const number = Number(term.number);
  const category = String(term.categoryLabel || term.sourceCategory || "").toLowerCase();
  const subcategory = String(term.sourceSubcategory || term.subcategory || "").toLowerCase();

  if (number >= 1 && number <= 4) return "DPPInfo";
  if (number >= 5 && number <= 8) return "BatteryIdentifiers";
  if (number >= 9 && number <= 11) return "OperatorIdentifiers";
  if (number >= 12 && number <= 15) return "ProductData";
  if (number === 16 || number === 20) return "RestrictedProductInfo";
  if (number >= 17 && number <= 19) return "BatteryAttributes";

  if (category.includes("labels") || category.includes("conformity")) {
    return number === 27 ? "BatteryComplianceRestricted" : "BatteryCompliancePublic";
  }
  if (category.includes("carbon footprint")) return "BatteryCarbonFootprint";
  if (category.includes("supply chain")) return "SupplyChainDueDiligence";
  if (category.includes("materials")) {
    return number === 41 ? "BatteryMaterialsRestricted" : "BatteryMaterialsPublic";
  }
  if (category.includes("circularity")) {
    if (subcategory.includes("recycled") || number >= 48 && number <= 55) return "RecycledRenewableContent";
    if (subcategory.includes("end-users") || number >= 56 && number <= 58) return "EndUserInformation";
    return isPublicTerm(term) ? "BatteryCircularityPublic" : "BatteryCircularityRestricted";
  }
  if (category.includes("performance")) {
    const publicTerm = isPublicTerm(term);
    if (subcategory.includes("capacity") || subcategory.includes("voltage")) {
      return publicTerm ? "PerformanceDurabilityPublic" : "PerformanceDurabilityRestricted";
    }
    if (subcategory.includes("power")) {
      return publicTerm ? "PowerCapabilityPublic" : "PowerCapabilityRestricted";
    }
    if (subcategory.includes("round trip") || subcategory.includes("self-discharge")) {
      return publicTerm ? "RoundTripEfficiencyPublic" : "RoundTripEfficiencyRestricted";
    }
    if (subcategory.includes("internal resistance")) {
      return publicTerm ? "InternalResistancePublic" : "InternalResistanceRestricted";
    }
    if (subcategory.includes("battery lifetime")) {
      return publicTerm ? "BatteryLifetimePublic" : "BatteryLifetimeRestricted";
    }
    if (subcategory.includes("temperature")) {
      return publicTerm ? "TemperatureConditionsPublic" : "TemperatureConditionsRestricted";
    }
    if (subcategory.includes("negative")) return "NegativeEvents";
  }

  return "DigitalBatteryPassport";
}

async function readBatteryPassWorkbookRows(workbookPath) {
  if (!fs.existsSync(workbookPath)) return [];

  const JSZip = require(path.join(ROOT, "apps/backend-api/node_modules/jszip"));
  const zip = await JSZip.loadAsync(fs.readFileSync(workbookPath));
  const sharedStringsXml = zip.file("xl/sharedStrings.xml")
    ? await zip.file("xl/sharedStrings.xml").async("string")
    : "";
  const sharedStrings = [];
  for (const match of sharedStringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const parts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1]));
    sharedStrings.push(parts.join(""));
  }

  const workbookXml = await zip.file("xl/workbook.xml").async("string");
  const workbookRelsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const rels = new Map();
  for (const match of workbookRelsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    rels.set(getXmlAttribute(match[1], "Id"), getXmlAttribute(match[1], "Target"));
  }

  let sheetRelId = "";
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    if (getXmlAttribute(match[1], "name") === WORKBOOK_SHEET_NAME) {
      sheetRelId = getXmlAttribute(match[1], "r:id");
      break;
    }
  }
  const target = rels.get(sheetRelId);
  if (!target) return [];

  const sheetPath = `xl/${target.replace(/^\/+/, "")}`;
  const sheetXml = await zip.file(sheetPath).async("string");
  const rows = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(getXmlAttribute(rowMatch[1], "r"));
    const cells = {};
    let maxIndex = -1;
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const cellRef = getXmlAttribute(cellMatch[1], "r");
      const type = getXmlAttribute(cellMatch[1], "t");
      const index = columnIndex(cellRef);
      const valueMatch = cellMatch[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      const inlineMatch = cellMatch[2].match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
      let value = "";
      if (type === "s" && valueMatch) {
        value = sharedStrings[Number(valueMatch[1])] || "";
      } else if (inlineMatch) {
        value = stripXmlTags(inlineMatch[1]);
      } else if (valueMatch) {
        value = decodeXml(valueMatch[1]);
      }
      cells[index] = normalizeSpreadsheetValue(value);
      maxIndex = Math.max(maxIndex, index);
    }
    if (maxIndex >= 0) {
      rows.push({
        rowNumber,
        values: Array.from({ length: maxIndex + 1 }, (_, index) => cells[index] || ""),
      });
    }
  }
  return rows;
}

function buildWorkbookMetadataByNumber(rows) {
  const headerRow = rows.find((row) => row.rowNumber === 7);
  if (!headerRow) return new Map();

  const headers = new Map();
  headerRow.values.forEach((value, index) => {
    headers.set(normalizeHeader(value), index);
  });

  const get = (row, header) => normalizeSpreadsheetValue(row.values[headers.get(header)] || "");
  const byNumber = new Map();
  let previousNumber = 0;
  for (const row of rows.filter((candidate) => candidate.rowNumber > 7)) {
    const explicitNumber = Number(get(row, "#"));
    const sourceAttributeName = get(row, "attribute");
    const number = explicitNumber || (sourceAttributeName ? previousNumber + 1 : 0);
    if (!number) continue;
    previousNumber = number;
    byNumber.set(number, {
      sourceWorkbookRow: row.rowNumber,
      dinDkeSpec99100Chapter: get(row, "din dke spec 99100 chapter"),
      batteryCategoryRequirements: {
        EV: parseRequirementMarker(get(row, "ev")),
        LMT: parseRequirementMarker(get(row, "lmt")),
        Industrial: parseRequirementMarker(get(row, "other industrial >2kwh")),
        Stationary: parseRequirementMarker(get(row, "stationary >2kwh")),
      },
      sourceCategory: get(row, "attribute category"),
      sourceSubcategory: get(row, "attribute sub-category"),
      sourceAttributeName,
      sourceShortDefinition: get(row, "short definition/understanding"),
      regulatoryRequirement: get(row, "requirements per regulation(s), incl. mandated standardization and da/ia"),
      dinSpecRecommendation: get(row, "requirements or recommendations per din-dke spec 99100 and additional requirements"),
      sourceRegulationReference: get(row, "regulation reference"),
      unitDisplay: get(row, "unit of attribute or sign (if applicable)") || "n.a.",
      dataFormat: normalizeDataFormat(get(row, "data format")),
      accessRights: get(row, "access rights according to battery regulation"),
      staticOrDynamic: get(row, "data behavioural characteristic: static vs. dynamic"),
      updateRequirement: get(row, "update requirement for dynamic data, or, where defined"),
      granularityLevel: get(row, "granularity level i: model vs individual battery"),
      componentGranularity: {
        pack: parseGranularityMarker(get(row, "pack")),
        module: parseGranularityMarker(get(row, "module")),
        cell: parseGranularityMarker(get(row, "cell")),
      },
    });
  }
  return byNumber;
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

function buildSemanticBinding(term) {
  const domain = buildDomainClass(term.domainClassKey || resolveDomainClassKey(term));
  return {
    rdfProperty: term.iri,
    rdfType: [
      "rdf:Property",
      "owl:DatatypeProperty",
      "skos:Concept",
    ],
    domain,
    range: {
      iri: expandCurie(term.dataType.xsdType),
      curie: term.dataType.xsdType,
      label: term.dataType.format,
      jsonType: term.dataType.jsonType,
      items: term.dataType.items || null,
    },
  };
}

function buildDcatCatalog({ manifest, terms, generatedAt }) {
  const datasetId = `${BASE_IRI}/dataset`;
  return {
    "@context": {
      "@version": 1.1,
      "@protected": true,
      dcat: "http://www.w3.org/ns/dcat#",
      dcterms: "http://purl.org/dc/terms/",
      foaf: "http://xmlns.com/foaf/0.1/",
      adms: "http://www.w3.org/ns/adms#",
      skos: "http://www.w3.org/2004/02/skos/core#",
      vcard: "http://www.w3.org/2006/vcard/ns#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
      clarosBattery: TERM_BASE_IRI,
      clarosBatteryClass: `${BASE_IRI}/classes/`,
    },
    "@id": `${BASE_IRI}/catalog`,
    "@type": "dcat:Catalog",
    "dcterms:title": "Claros Battery Dictionary Catalog",
    "dcterms:description": "DCAT-AP-aligned metadata catalog for the Claros battery semantic dictionary and its machine-readable distributions.",
    "dcterms:publisher": {
      "@id": "https://www.claros-dpp.online",
      "@type": "foaf:Organization",
      "foaf:name": "Claros DPP",
    },
    "dcterms:language": "en",
    "dcterms:modified": {
      "@value": generatedAt,
      "@type": "xsd:dateTime",
    },
    "dcterms:conformsTo": [
      { "@id": DCAT_3_IRI, "dcterms:title": "Data Catalog Vocabulary (DCAT) Version 3" },
      { "@id": DCAT_AP_301_IRI, "dcterms:title": "DCAT-AP 3.0.1" },
    ],
    "dcat:themeTaxonomy": {
      "@id": `${BASE_IRI}/category-scheme`,
      "@type": "skos:ConceptScheme",
      "dcterms:title": "Battery passport attribute categories",
    },
    "dcat:dataset": {
      "@id": datasetId,
      "@type": "dcat:Dataset",
      "dcterms:identifier": manifest.semanticModelKey,
      "dcterms:title": manifest.name,
      "dcterms:description": manifest.description,
      "dcterms:publisher": {
        "@id": "https://www.claros-dpp.online",
        "@type": "foaf:Organization",
        "foaf:name": "Claros DPP",
      },
      "dcterms:language": "en",
      "dcterms:issued": { "@value": generatedAt, "@type": "xsd:dateTime" },
      "dcterms:modified": { "@value": generatedAt, "@type": "xsd:dateTime" },
      "dcterms:conformsTo": [
        { "@id": DCAT_3_IRI },
        { "@id": DCAT_AP_301_IRI },
        { "@id": manifest.contextUrl },
      ],
      "dcat:keyword": [
        "battery passport",
        "digital product passport",
        "semantic dictionary",
        "BatteryPass",
        "DCAT-AP",
      ],
      "dcat:theme": [
        { "@id": "http://publications.europa.eu/resource/authority/data-theme/TECH" },
        { "@id": "http://publications.europa.eu/resource/authority/data-theme/ENVI" },
      ],
      "dcat:landingPage": { "@id": BASE_IRI },
      "dcat:contactPoint": {
        "@type": "vcard:Organization",
        "vcard:fn": "Claros DPP",
        "vcard:hasURL": { "@id": "https://www.claros-dpp.online" },
      },
      "dcat:distribution": [
        {
          "@id": `${BASE_IRI}/distributions/terms-json`,
          "@type": "dcat:Distribution",
          "dcterms:title": "Battery dictionary terms JSON",
          "dcat:accessURL": { "@id": manifest.termsUrl },
          "dcat:downloadURL": { "@id": manifest.termsUrl },
          "dcat:mediaType": "application/json",
          "dcterms:format": "JSON",
        },
        {
          "@id": `${BASE_IRI}/distributions/context-jsonld`,
          "@type": "dcat:Distribution",
          "dcterms:title": "Battery dictionary JSON-LD context",
          "dcat:accessURL": { "@id": manifest.contextUrl },
          "dcat:downloadURL": { "@id": manifest.contextUrl },
          "dcat:mediaType": "application/ld+json",
          "dcterms:format": "JSON-LD",
        },
        {
          "@id": `${BASE_IRI}/distributions/category-rules-json`,
          "@type": "dcat:Distribution",
          "dcterms:title": "Battery category applicability rules",
          "dcat:accessURL": { "@id": manifest.categoryRulesUrl },
          "dcat:downloadURL": { "@id": manifest.categoryRulesUrl },
          "dcat:mediaType": "application/json",
          "dcterms:format": "JSON",
        },
        {
          "@id": `${BASE_IRI}/distributions/field-map-json`,
          "@type": "dcat:Distribution",
          "dcterms:title": "Application field to semantic term map",
          "dcat:accessURL": { "@id": manifest.fieldMapUrl },
          "dcat:downloadURL": { "@id": manifest.fieldMapUrl },
          "dcat:mediaType": "application/json",
          "dcterms:format": "JSON",
        },
      ],
    },
    "dcat:service": {
      "@id": `${BASE_IRI}/service`,
      "@type": "dcat:DataService",
      "dcterms:title": "Claros Battery Dictionary API",
      "dcat:endpointURL": { "@id": API_BASE },
      "dcat:servesDataset": { "@id": datasetId },
    },
    "dcat:record": {
      "@id": `${BASE_IRI}/records/dataset`,
      "@type": "dcat:CatalogRecord",
      "dcterms:title": "Catalog record for the Claros Battery Dictionary",
      "dcterms:modified": { "@value": generatedAt, "@type": "xsd:dateTime" },
      "foaf:primaryTopic": { "@id": datasetId },
    },
    termCount: terms.length,
  };
}

async function main() {
  const sourceTerms = ensureArray(readJson(SOURCE_PATH), "battery-terms-source.json");
  const legacyTerms = ensureArray(readJson(LEGACY_TERMS_PATH, []), "legacy terms");
  const legacyCategories = ensureArray(readJson(LEGACY_CATEGORIES_PATH, []), "legacy categories");
  const legacyUnits = ensureArray(readJson(LEGACY_UNITS_PATH, []), "legacy units");
  const legacyFieldMap = readJson(LEGACY_FIELD_MAP_PATH, {}) || {};
  const workbookRows = await readBatteryPassWorkbookRows(SOURCE_WORKBOOK_PATH);
  const workbookMetadataByNumber = buildWorkbookMetadataByNumber(workbookRows);

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
      const workbookMetadata = workbookMetadataByNumber.get(number) || {};

      if (!dataType) {
        throw new Error(`Unsupported data_format "${sourceTerm.data_format}" for term #${number}`);
      }

      const appFieldKeys = Array.isArray(legacy.appFieldKeys) && legacy.appFieldKeys.length
        ? legacy.appFieldKeys.slice().sort()
        : [toSnakeCase(attributeName)];

      const unit = buildUnitKey(sourceTerm.unit, legacyUnitsByDisplay);
      const iri = `${TERM_BASE_IRI}${slug}`;
      const termForDomain = {
        number,
        categoryLabel,
        sourceCategory: workbookMetadata.sourceCategory || categoryLabel,
        sourceSubcategory: workbookMetadata.sourceSubcategory || sourceTerm.subcategory || null,
        subcategory: sourceTerm.subcategory || null,
        accessRights: workbookMetadata.accessRights || legacy.accessRights || null,
      };
      const domainClassKey = resolveDomainClassKey(termForDomain);
      const domain = buildDomainClass(domainClassKey);

      return {
        id: number,
        number,
        specRef: number,
        slug,
        iri,
        termIri: iri,
        label: attributeName,
        attributeName,
        sourceAttributeName: workbookMetadata.sourceAttributeName || attributeName,
        definition: String(sourceTerm.short_definition || "").trim(),
        shortDefinition: String(sourceTerm.short_definition || "").trim(),
        sourceShortDefinition: workbookMetadata.sourceShortDefinition || null,
        category: toCategoryKey(categoryLabel),
        categoryLabel,
        subcategory: sourceTerm.subcategory || null,
        sourceCategory: workbookMetadata.sourceCategory || categoryLabel,
        sourceSubcategory: workbookMetadata.sourceSubcategory || sourceTerm.subcategory || null,
        internalKey,
        internal_key: internalKey,
        elementId,
        element_id: elementId,
        dataType,
        rdfType: [
          "rdf:Property",
          "owl:DatatypeProperty",
          "skos:Concept",
        ],
        domainClassKey,
        domain,
        range: {
          iri: expandCurie(dataType.xsdType),
          curie: dataType.xsdType,
          label: dataType.format,
          jsonType: dataType.jsonType,
          items: dataType.items || null,
        },
        unit,
        unitDisplay: sourceTerm.unit || "n.a.",
        accessRights: workbookMetadata.accessRights || legacy.accessRights || null,
        staticOrDynamic: workbookMetadata.staticOrDynamic || legacy.staticOrDynamic || null,
        updateRequirement: workbookMetadata.updateRequirement || null,
        granularityLevel: workbookMetadata.granularityLevel || null,
        dinDkeSpec99100Chapter: workbookMetadata.dinDkeSpec99100Chapter || null,
        batteryCategoryRequirements: workbookMetadata.batteryCategoryRequirements || null,
        componentGranularity: workbookMetadata.componentGranularity || null,
        regulatoryRequirement: workbookMetadata.regulatoryRequirement || null,
        dinSpecRecommendation: workbookMetadata.dinSpecRecommendation || null,
        sourceRegulationReference: workbookMetadata.sourceRegulationReference || null,
        regulationReferences: splitReferenceList(workbookMetadata.sourceRegulationReference).length
          ? splitReferenceList(workbookMetadata.sourceRegulationReference)
          : (Array.isArray(legacy.regulationReferences) ? legacy.regulationReferences : []),
        semanticBinding: null,
        conformsTo: [
          DCAT_3_IRI,
          DCAT_AP_301_IRI,
        ],
        sourceWorkbookRow: workbookMetadata.sourceWorkbookRow || null,
        appFieldKeys,
      };
    });

  for (const term of terms) {
    term.semanticBinding = buildSemanticBinding(term);
  }

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

  const context = {
    "@context": {
      "@version": 1.1,
      "@protected": true,
      id: "@id",
      type: "@type",
      clarosBattery: TERM_BASE_IRI,
      clarosBatteryClass: `${BASE_IRI}/classes/`,
      DigitalBatteryPassport: "clarosBatteryClass:DigitalBatteryPassport",
      DigitalProductPassport: "dpp:DigitalProductPassport",
      dcat: "http://www.w3.org/ns/dcat#",
      dcterms: "http://purl.org/dc/terms/",
      dpp: "https://schema.digitalproductpassport.eu/ns/dpp#",
      owl: "http://www.w3.org/2002/07/owl#",
      rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      skos: "http://www.w3.org/2004/02/skos/core#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
    },
  };

  for (const classKey of Object.keys(DOMAIN_CLASSES)) {
    context["@context"][classKey] = `clarosBatteryClass:${classKey}`;
  }

  for (const term of terms) {
    context["@context"][term.internalKey] = buildTermContextEntry(term.slug, term.dataType);
    for (const fieldKey of term.appFieldKeys) {
      context["@context"][fieldKey] = buildTermContextEntry(term.slug, term.dataType);
    }
  }

  const manifest = {
    semanticModelKey: MODEL_KEY,
    name: "Claros Battery Dictionary",
    version: "1.0.0",
    description: "Internal battery passport dictionary derived from the BatteryPass Data Attribute Longlist v1.3.",
    authority: {
      modelClass: "internal-derived-dictionary",
      officialStatus: "implementation-vocabulary",
      stewardingOrganization: "Claros DPP",
      normativeSource: {
        title: "BatteryPass Data Attribute Longlist",
        version: "1.3",
        artifactType: "workbook",
        sourceWorkbook: "2026_BatteryPass-Ready_DataAttributeLongList_v1.3.xlsx",
        sourceProject: "BatteryPass",
        sourceRepository: "https://github.com/batterypass/BatteryPassDataModel",
        sourceAuthority: "BatteryPass consortium",
      },
      derivationNotice: "This dictionary is curated by Claros DPP for implementation use. It is derived from BatteryPass source material and is not itself an official EU or BatteryPass controlled vocabulary publication.",
    },
    governance: {
      steward: {
        name: "Claros DPP",
        did: "did:web:www.claros-dpp.online",
        url: "https://www.claros-dpp.online",
      },
      maintenanceModel: "curated-release",
      changeControl: "Dictionary updates are made in-repository, regenerated from a pinned source workbook, and released as versioned static artifacts.",
      reviewProcess: "Changes should preserve traceable mappings back to source attributes, term identifiers, category applicability, and regulation references where available.",
    },
    versioning: {
      dictionaryVersion: "1.0.0",
      semanticModelKey: MODEL_KEY,
      sourceVersion: "BatteryPass Data Attribute Longlist v1.3",
      generatedAt,
      compatibilityPolicy: "IRIs under /dictionary/battery/v1 remain stable for non-breaking revisions. Breaking semantic changes require a new version path and semantic model key.",
    },
    regulatoryTraceability: {
      scope: "Battery passport implementation aligned to the Claros battery semantic model.",
      traceabilityMethod: "Each term carries source-oriented metadata from the pinned BatteryPass workbook, including DIN/DKE chapter, source row, regulatory requirements, access rights, static/dynamic behavior, model/item granularity, component granularity, category applicability, datatype, and regulation references.",
      applicabilityModel: "Battery-category applicability is captured separately in category-rules.json and linked to exports during validation.",
      limitations: [
        "This manifest documents implementation provenance, not normative legal endorsement.",
        "Formal compliance claims should cite both the upstream BatteryPass source version and this Claros dictionary version.",
      ],
    },
    interoperabilityProfile: {
      targetFramework: "Interoperable Europe semantic interoperability",
      dcatVersion: "DCAT 3",
      dcatApVersion: "DCAT-AP 3.0.1",
      conformsTo: [
        DCAT_3_IRI,
        DCAT_AP_301_IRI,
      ],
      catalogUrl: `${BASE_IRI}/catalog.jsonld`,
      datasetUrl: `${BASE_IRI}/dataset`,
      dataServiceUrl: `${BASE_IRI}/service`,
      termModel: "Each dictionary term is represented as a dereferenceable RDF property and SKOS concept with explicit rdfs:domain and rdfs:range metadata. Domains use section-specific battery passport classes informed by the DBP v0.2 reference vocabulary rather than a single generic container.",
      domainModel: Object.fromEntries(
        Object.entries(DOMAIN_CLASSES).map(([classKey, definition]) => [
          classKey,
          {
            iri: `${DOMAIN_CLASS_BASE_IRI}${classKey}`,
            label: definition.label,
          },
        ])
      ),
      referenceVocabulary: {
        title: "Digital Battery Passport vocabulary v0.2 reference",
        vocabularyUrl: "https://dpp.vocabulary.spherity.com/dbp/v0.2/batteryPass.html",
        contextUrl: "https://dpp.vocabulary.spherity.com/dbp/v0.2/batteryPass.context.jsonld",
        ontologyUrl: "https://dpp.vocabulary.spherity.com/dbp/v0.2/batteryPass.ttl",
        usage: "Used as an implementation reference for protected JSON-LD context conventions and section-specific battery passport domain classes; Claros term IRIs remain canonical for this dictionary.",
      },
      controlledVocabularies: [
        "DCAT",
        "DCAT-AP",
        "Dublin Core Terms",
        "SKOS",
        "RDFS",
        "XSD",
      ],
    },
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
    categoryRulesUrl: `${API_BASE}/category-rules`,
    fieldMapUrl: `${API_BASE}/field-map`,
    catalogUrl: `${BASE_IRI}/catalog.jsonld`,
  };

  const dcatCatalog = buildDcatCatalog({ manifest, terms, generatedAt });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(FRONTEND_SEMANTICS_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, "manifest.json"), stableStringify(manifest));
  fs.writeFileSync(path.join(OUTPUT_DIR, "terms.json"), stableStringify(terms));
  fs.writeFileSync(path.join(OUTPUT_DIR, "categories.json"), stableStringify(categories));
  fs.writeFileSync(path.join(OUTPUT_DIR, "units.json"), stableStringify(units));
  fs.writeFileSync(path.join(OUTPUT_DIR, "context.jsonld"), stableStringify(context));
  fs.writeFileSync(path.join(OUTPUT_DIR, "catalog.jsonld"), stableStringify(dcatCatalog));
  fs.writeFileSync(path.join(OUTPUT_DIR, "field-map.json"), stableStringify(fieldMap));
  fs.writeFileSync(path.join(FRONTEND_SEMANTICS_DIR, "battery-dictionary-terms.generated.json"), stableStringify(terms));

  console.log(`Generated battery dictionary artifacts for ${terms.length} terms in ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
