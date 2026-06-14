"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const PORT = Number.parseInt(process.env.PORT || "5055", 10);
const APP_DIR = __dirname;
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  const fileName = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(APP_DIR, fileName);
  if (!filePath.startsWith(APP_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function clean(value) {
  return String(value || "").trim();
}

function titleCase(value) {
  return clean(value)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function kebabCase(value) {
  return clean(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function camelCase(value) {
  const words = clean(value).match(/[A-Za-z0-9]+/g) || [];
  return words.map((word, index) => {
    const lower = word.toLowerCase();
    if (index === 0) return lower;
    return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
  }).join("");
}

function pascalCase(value) {
  const camel = camelCase(value);
  return `${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

function parseJsonArray(value, label) {
  if (Array.isArray(value)) return value;
  const text = String(value || "").trim();
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array.`);
  }
  return parsed;
}

function normalizeTableColumnKey(value) {
  const text = clean(value);
  if (/^[a-z][A-Za-z0-9]*$/.test(text)) return text;
  return camelCase(text);
}

function normalizeTableColumns(columns = [], fieldLabel = "Table") {
  const normalized = (columns || []).map((column, index) => {
    const columnKey = normalizeTableColumnKey(column.columnKey || column.key || column.columnLabel || column.label || `column${index + 1}`);
    const columnLabel = clean(column.columnLabel || column.label) || titleCase(columnKey || `column ${index + 1}`);
    const semanticSlug = kebabCase(column.semanticSlug || columnLabel || columnKey);
    const unitKey = clean(column.unitKey || column.unit || "none").toLowerCase() || "none";
    return {
      columnKey,
      columnLabel,
      semanticSlug,
      dataType: normalizeJsonType(column.dataType),
      unitKey,
      unitLabel: clean(column.unitLabel) || (unitKey === "none" ? "None" : titleCase(unitKey)),
      unitSymbol: unitKey === "none" ? "" : clean(column.unitSymbol || unitKey),
      objectType: normalizeObjectType(column.objectType, `${fieldLabel} column "${columnLabel}"`),
      valueDataType: normalizeValueDataType(column.valueDataType, `${fieldLabel} column "${columnLabel}"`),
      required: Boolean(column.required),
    };
  }).filter((column) => column.columnKey);

  if (!normalized.length) {
    throw new Error(`${fieldLabel} table fields must define at least one column.`);
  }

  const duplicateColumn = normalized.find((column, index) =>
    normalized.findIndex((candidate) => candidate.columnKey === column.columnKey) !== index
  );
  if (duplicateColumn) {
    throw new Error(`Duplicate table column key: ${duplicateColumn.columnKey}`);
  }

  return normalized;
}

function normalizeTableDefaultRows(rawRows, columns, fieldLabel) {
  const parsedRows = parseJsonArray(rawRows, `${fieldLabel} default rows`);
  return parsedRows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`${fieldLabel} default row ${index + 1} must be an object keyed by column key.`);
    }
    return Object.fromEntries(columns.map((column) => [column.columnKey, row[column.columnKey] ?? ""]));
  });
}

function semanticBase(spec) {
  const { family, version, baseUrl } = spec.module;
  return `${baseUrl}/dictionary/${family}/${version}`;
}

function apiBase(spec) {
  const { family, version, baseUrl } = spec.module;
  return `${baseUrl}/api/dictionary/${family}/${version}`;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function splitList(value) {
  return clean(value)
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeVersion(value) {
  const version = clean(value || "v1").toLowerCase();
  if (/^v\d+$/.test(version)) return version;
  if (/^\d+$/.test(version)) return `v${version}`;
  return kebabCase(version) || "v1";
}

function normalizeJsonType(value) {
  const type = clean(value || "string").toLowerCase();
  if (["number", "decimal", "float"].includes(type)) return "number";
  if (["integer", "int"].includes(type)) return "integer";
  if (["boolean", "bool"].includes(type)) return "boolean";
  if (type === "date") return "date";
  if (["datetime", "date-time"].includes(type)) return "datetime";
  if (["uri", "url"].includes(type)) return "uri";
  return "string";
}

function dataTypeFor(value) {
  const jsonType = normalizeJsonType(value);
  if (jsonType === "number") return { format: "Decimal", jsonType: "number", xsdType: "xsd:decimal" };
  if (jsonType === "integer") return { format: "Integer", jsonType: "integer", xsdType: "xsd:integer" };
  if (jsonType === "boolean") return { format: "Boolean", jsonType: "boolean", xsdType: "xsd:boolean" };
  if (jsonType === "date") return { format: "Date", jsonType: "string", xsdType: "xsd:date" };
  if (jsonType === "datetime") return { format: "DateTime", jsonType: "string", xsdType: "xsd:dateTime" };
  if (jsonType === "uri") return { format: "URI/URL", jsonType: "string", xsdType: "xsd:anyURI" };
  return { format: "String", jsonType: "string", xsdType: "xsd:string" };
}

const OBJECT_TYPES = new Set([
  "SingleValuedDataElement",
  "MultiValuedDataElement",
  "DataElementCollection",
  "RelatedResource",
  "MultiLanguageDataElement",
]);

const VALUE_DATA_TYPES = new Set([
  "String",
  "Boolean",
  "Integer",
  "Decimal",
  "Date",
  "DateTime",
  "URI",
  "Binary",
  "Array",
  "Object",
]);

function normalizeObjectType(value, label) {
  const normalized = clean(value);
  if (!OBJECT_TYPES.has(normalized)) {
    throw new Error(`${label} objectType must be one of: ${[...OBJECT_TYPES].join(", ")}`);
  }
  return normalized;
}

function normalizeValueDataType(value, label) {
  const normalized = clean(value);
  if (!VALUE_DATA_TYPES.has(normalized)) {
    throw new Error(`${label} valueDataType must be one of: ${[...VALUE_DATA_TYPES].join(", ")}`);
  }
  return normalized;
}

function xsdContextType(xsdType) {
  const suffix = clean(xsdType).replace(/^xsd:/, "");
  if (!suffix || suffix === "string") return null;
  return `http://www.w3.org/2001/XMLSchema#${suffix}`;
}

function jsValue(value) {
  return JSON.stringify(value);
}

function validateSpec(input) {
  const module = input.module || {};
  const roles = input.roles || {};
  const family = kebabCase(module.family);
  const version = normalizeVersion(module.version);
  const moduleKey = clean(module.moduleKey) || `${family}:${version}`;
  const typeName = clean(module.typeName) || `${camelCase(family)}Passport${pascalCase(version)}`;
  const displayName = clean(module.displayName) || `${titleCase(family)} Passport ${version}`;
  const productCategory = clean(module.productCategory) || titleCase(family);
  const productIcon = clean(module.productIcon) || "PT";
  const semanticModelKey = clean(module.semanticModelKey) || `claros_${family.replace(/-/g, "_")}_dictionary_${version}`;
  const complianceProfileKey = clean(module.complianceProfileKey) || `${camelCase(family)}Dpp${pascalCase(version)}`;
  const requiredPassportFields = splitList(module.requiredPassportFields || "complianceProfileKey, contentSpecificationIds");
  const requireCompanyOperatorIdentifier = module.requireCompanyOperatorIdentifier !== false;
  const requireCarrierPolicy = Boolean(module.requireCarrierPolicy);
  const enforceSemanticMapping = module.enforceSemanticMapping !== false;
  const requirePublicAccessLayer = module.requirePublicAccessLayer !== false;
  const requireFacilityAtGranularities = Array.isArray(module.requireFacilityAtGranularities)
    ? module.requireFacilityAtGranularities.map(clean).filter(Boolean)
    : splitList(module.requireFacilityAtGranularities);
  const defaultCarrierPolicyKey = clean(module.defaultCarrierPolicyKey || "web_public_entry_v1");
  const managedSemanticFields = parseJsonArray(module.managedSemanticFieldsText || module.managedSemanticFields || "[]", "Managed semantic fields");
  const baseUrl = clean(module.baseUrl || "https://www.claros-dpp.online").replace(/\/+$/, "");
  const dictionaryName = clean(module.dictionaryName) || `Claros ${titleCase(family)} Dictionary`;
  const dictionaryDescription = clean(module.dictionaryDescription)
    || `Internal ${family} passport dictionary used for Digital Product Passport implementations.`;
  const businessIdentifierField = clean(roles.businessIdentifierField || module.businessIdentifierField);
  const summaryFieldKeys = new Set(Array.isArray(roles.summaryFieldKeys) ? roles.summaryFieldKeys.map(clean).filter(Boolean) : []);
  const heroFieldKeys = new Set(Array.isArray(roles.heroFieldKeys) ? roles.heroFieldKeys.map(clean).filter(Boolean) : []);
  const trustFieldKeys = new Set(Array.isArray(roles.trustFieldKeys) ? roles.trustFieldKeys.map(clean).filter(Boolean) : []);
  const presentations = roles.presentations && typeof roles.presentations === "object" ? roles.presentations : {};
  const summaryRoles = roles.summaryRoles && typeof roles.summaryRoles === "object" ? roles.summaryRoles : {};
  const lifecycleRoles = roles.lifecycleRoles && typeof roles.lifecycleRoles === "object" ? roles.lifecycleRoles : {};
  const mediaRoles = roles.mediaRoles && typeof roles.mediaRoles === "object" ? roles.mediaRoles : {};
  const objectTypes = roles.objectTypes && typeof roles.objectTypes === "object" ? roles.objectTypes : {};
  const valueDataTypes = roles.valueDataTypes && typeof roles.valueDataTypes === "object" ? roles.valueDataTypes : {};
  const compositionFieldKey = clean(roles.compositionFieldKey);
  const compositionLabelColumnKey = normalizeTableColumnKey(roles.compositionLabelColumnKey);
  const compositionValueColumnKey = normalizeTableColumnKey(roles.compositionValueColumnKey);

  if (!family) throw new Error("Product family is required");
  if (!/^[a-z][A-Za-z0-9]{1,99}$/.test(typeName)) {
    throw new Error("typeName must be camelCase letters/numbers, 2-100 chars, start with lowercase");
  }
  for (const granularity of requireFacilityAtGranularities) {
    if (!["model", "batch", "item"].includes(granularity)) {
      throw new Error(`Facility granularity "${granularity}" must be one of: model, batch, item.`);
    }
  }

  const sections = (input.sections || []).map((section) => ({
    key: clean(section.key) || camelCase(section.label),
    label: clean(section.label) || titleCase(section.key),
    fields: (section.fields || []).map((field) => {
      const fieldKey = clean(field.fieldKey) || clean(field.key) || camelCase(field.fieldLabel || field.label);
      const fieldLabel = clean(field.fieldLabel) || clean(field.label) || titleCase(fieldKey);
      const semanticSlug = kebabCase(field.semanticSlug || fieldLabel || fieldKey);
      const categoryKey = kebabCase(field.categoryKey || "general");
      const categoryLabel = clean(field.categoryLabel) || titleCase(categoryKey);
      const unitKey = clean(field.unitKey || field.unit || "none").toLowerCase() || "none";
      const unitSymbol = unitKey === "none" ? "n.a." : clean(field.unitSymbol || field.unitDisplay || unitKey);
      const jsonType = normalizeJsonType(field.dataType);
      const fieldType = clean(field.fieldType || field.type || (jsonType === "boolean" ? "checkbox" : "text"));
      const normalized = {
        fieldKey,
        fieldLabel,
        fieldType,
        semanticSlug,
        definition: clean(field.definition) || `${fieldLabel} for the ${productCategory} passport.`,
        specRef: clean(field.specRef),
        dataType: jsonType,
        categoryKey,
        categoryLabel,
        categoryDescription: clean(field.categoryDescription) || `${categoryLabel} attributes.`,
        unitKey,
        unitLabel: clean(field.unitLabel) || (unitKey === "none" ? "None" : titleCase(unitKey)),
        unitSymbol,
        accessRights: clean(field.accessRights || field.access || "public").toLowerCase(),
        defaultRequirement: clean(field.defaultRequirement || "optional").toLowerCase(),
        queryable: Boolean(field.queryable),
        indexed: Boolean(field.indexed),
        storageType: clean(field.storageType),
      };

      if (fieldType === "table") {
        const tableColumns = normalizeTableColumns(field.tableColumns || field.table_columns || [], fieldLabel);
        normalized.tableColumns = tableColumns;
        normalized.tableDefaultRows = normalizeTableDefaultRows(field.tableDefaultRowsText || field.table_default_rows || "[]", tableColumns, fieldLabel);
      }

      return normalized;
    }),
  })).filter((section) => section.key && section.fields.length);

  if (!sections.length) throw new Error("At least one section with one field is required");

  const fieldKeys = sections.flatMap((section) => section.fields.map((field) => field.fieldKey));
  const duplicateField = fieldKeys.find((key, index) => fieldKeys.indexOf(key) !== index);
  if (duplicateField) throw new Error(`Duplicate field key: ${duplicateField}`);
  const fieldByKey = new Map(sections.flatMap((section) => section.fields.map((field) => [field.fieldKey, field])));
  const requireKnownFieldKey = (fieldKey, label) => {
    if (fieldKey && !fieldByKey.has(fieldKey)) {
      throw new Error(`${label} "${fieldKey}" must exist as a generated field.`);
    }
  };
  if (!businessIdentifierField) {
    throw new Error("Business identifier field is required.");
  }
  requireKnownFieldKey(businessIdentifierField, "Business identifier field");
  for (const fieldKey of [...summaryFieldKeys, ...heroFieldKeys, ...trustFieldKeys]) {
    requireKnownFieldKey(fieldKey, "Display role field");
  }
  for (const fieldKey of [
    ...Object.keys(presentations),
    ...Object.keys(summaryRoles),
    ...Object.keys(lifecycleRoles),
    ...Object.keys(mediaRoles),
    ...Object.keys(objectTypes),
    ...Object.keys(valueDataTypes),
  ]) {
    requireKnownFieldKey(fieldKey, "Role metadata field");
  }
  requireKnownFieldKey(compositionFieldKey, "Composition chart field");

  for (const field of fieldByKey.values()) {
    field.displayRole = heroFieldKeys.has(field.fieldKey)
      ? "hero"
      : trustFieldKeys.has(field.fieldKey)
        ? "trust"
        : summaryFieldKeys.has(field.fieldKey)
          ? "summary"
          : "detail";
    field.presentation = clean(presentations[field.fieldKey]);
    if (!field.presentation) {
      throw new Error(`Presentation is required for field "${field.fieldKey}".`);
    }
    field.summaryRole = clean(summaryRoles[field.fieldKey]);
    field.lifecycleRole = clean(lifecycleRoles[field.fieldKey]);
    field.mediaRole = clean(mediaRoles[field.fieldKey]);
    field.elementIdPath = field.fieldKey;
    field.objectType = normalizeObjectType(objectTypes[field.fieldKey], `Field "${field.fieldKey}"`);
    field.valueDataType = normalizeValueDataType(valueDataTypes[field.fieldKey], `Field "${field.fieldKey}"`);
    for (const column of field.tableColumns || []) {
      column.elementIdPath = `${field.fieldKey}.${column.columnKey}`;
    }
  }

  if (compositionFieldKey) {
    const field = fieldByKey.get(compositionFieldKey);
    if (field.fieldType !== "table") {
      throw new Error("Composition chart field must be a table field.");
    }
    if (!compositionLabelColumnKey || !compositionValueColumnKey) {
      throw new Error("Composition chart must define both label and data columns.");
    }
    if (compositionLabelColumnKey === compositionValueColumnKey) {
      throw new Error("Composition chart must use different label and data columns.");
    }
    const columnKeys = new Set((field.tableColumns || []).map((column) => column.columnKey));
    if (!columnKeys.has(compositionLabelColumnKey) || !columnKeys.has(compositionValueColumnKey)) {
      throw new Error("Composition chart columns must exist on the selected table field.");
    }
    field.composition = true;
    field.compositionLabelColumnKey = compositionLabelColumnKey;
    field.compositionValueColumnKey = compositionValueColumnKey;
    field.presentation = "compositionChart";
  }

  for (const section of sections) {
    if (!/^[a-z][A-Za-z0-9]{0,199}$/.test(section.key)) {
      throw new Error(`Invalid section key: ${section.key}`);
    }
    for (const field of section.fields) {
      if (!/^[a-z][A-Za-z0-9]{0,199}$/.test(field.fieldKey)) {
        throw new Error(`Invalid field key: ${field.fieldKey}`);
      }
      if (field.fieldType === "table") {
        for (const column of field.tableColumns || []) {
          if (!/^[a-z][A-Za-z0-9]{0,199}$/.test(column.columnKey)) {
            throw new Error(`Invalid table column key: ${column.columnKey}`);
          }
        }
      }
    }
  }

  return {
    module: {
      family,
      version,
      moduleKey,
      typeName,
      displayName,
      productCategory,
      productIcon,
      semanticModelKey,
      complianceProfileKey,
      requiredPassportFields,
      requireCompanyOperatorIdentifier,
      requireCarrierPolicy,
      enforceSemanticMapping,
      requirePublicAccessLayer,
      requireFacilityAtGranularities,
      defaultCarrierPolicyKey,
      managedSemanticFields,
      baseUrl,
      dictionaryName,
      dictionaryDescription,
      businessIdentifierField,
    },
    sections,
  };
}

function buildTerms(spec) {
  const { family } = spec.module;
  const prefix = family.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "DPP";
  const classPrefix = `claros${pascalCase(family)}Class`;
  let number = 0;
  return spec.sections.flatMap((section) => section.fields.flatMap((field) => {
    const domainClassKey = pascalCase(field.categoryKey || field.categoryLabel);
    const toTerm = ({ specRef, slug, label, definition, internalKey, dataType, unitKey }) => {
      number += 1;
      return {
        specRef: specRef || `${prefix}-${String(number).padStart(3, "0")}`,
        slug,
        label,
        definition,
        category: field.categoryKey,
        internalKey,
        dataType: dataTypeFor(dataType),
        domain: {
          iri: `${semanticBase(spec)}/classes/${domainClassKey}`,
          curie: `${classPrefix}:${domainClassKey}`,
          label: field.categoryLabel,
        },
        unit: unitKey,
      };
    };

    const terms = [toTerm({
      specRef: field.specRef,
      slug: field.semanticSlug,
      label: field.fieldLabel,
      definition: field.definition,
      internalKey: field.fieldKey,
      dataType: field.dataType,
      unitKey: field.unitKey,
    })];

    for (const column of field.tableColumns || []) {
      terms.push(toTerm({
        slug: column.semanticSlug,
        label: column.columnLabel,
        definition: `${column.columnLabel} within ${field.fieldLabel}.`,
        internalKey: column.columnKey,
        dataType: column.dataType,
        unitKey: column.unitKey,
      }));
    }

    return terms;
  }));
}

function buildCategories(spec) {
  const fields = spec.sections.flatMap((section) => section.fields);
  return uniqueBy(fields, (field) => field.categoryKey).map((field) => ({
    key: field.categoryKey,
    label: field.categoryLabel,
    description: field.categoryDescription,
  }));
}

function buildUnits(spec) {
  const fields = spec.sections.flatMap((section) => section.fields.flatMap((field) => {
    const units = [];
    if (field.unitKey && field.unitKey !== "none") units.push(field);
    for (const column of field.tableColumns || []) {
      if (column.unitKey && column.unitKey !== "none") units.push(column);
    }
    return units;
  }));
  return uniqueBy(fields, (field) => field.unitKey).map((field) => ({
    key: field.unitKey,
    label: field.unitLabel || field.columnLabel,
    symbol: field.unitSymbol || "",
  }));
}

function termIri(spec, term) {
  return `${semanticBase(spec)}/terms/${term.slug}`;
}

function buildContext(spec, terms) {
  const context = {
    "@version": 1.1,
    [spec.module.family]: `${semanticBase(spec)}/terms/`,
  };

  for (const term of terms) {
    const type = xsdContextType(term.dataType.xsdType);
    const compactId = `${spec.module.family}:${term.slug}`;
    context[term.internalKey] = type ? { "@id": compactId, "@type": type } : compactId;
  }

  return { "@context": context };
}

function buildManifest(spec) {
  const { family, version, baseUrl, semanticModelKey, dictionaryName, dictionaryDescription } = spec.module;
  const publicBase = semanticBase(spec);
  const dictionaryApiBase = apiBase(spec);
  const catalogUrl = `${publicBase}/catalog.jsonld`;
  return {
    semanticModelKey,
    name: dictionaryName,
    version: "1.0.0",
    description: dictionaryDescription,
    versioning: {
      dictionaryVersion: "1.0.0",
    },
    publisher: {
      name: "Claros DPP",
      url: baseUrl,
    },
    issuerDid: `did:web:${baseUrl.replace(/^https?:\/\//, "")}`,
    baseIri: publicBase,
    contextUrl: `${publicBase}/context.jsonld`,
    termsUrl: `${dictionaryApiBase}/terms`,
    unitsUrl: `${dictionaryApiBase}/units`,
    categoriesUrl: `${dictionaryApiBase}/categories`,
    categoryRulesUrl: `${dictionaryApiBase}/category-rules`,
    catalogUrl,
    interoperabilityProfile: {
      catalogUrl,
    },
  };
}

function buildCatalog(spec, terms = []) {
  const { family, semanticModelKey, dictionaryName, dictionaryDescription } = spec.module;
  const publicBase = semanticBase(spec);
  const dictionaryApiBase = apiBase(spec);
  return {
    "@context": {
      "@version": 1.1,
      dcat: "http://www.w3.org/ns/dcat#",
      dcterms: "http://purl.org/dc/terms/",
      skos: "http://www.w3.org/2004/02/skos/core#",
    },
    "@id": `${publicBase}/catalog.jsonld`,
    "@type": "dcat:Catalog",
    "dcterms:title": dictionaryName,
    "dcterms:description": dictionaryDescription,
    "dcat:dataset": {
      "@id": `${publicBase}/dataset`,
      "@type": "dcat:Dataset",
      "dcterms:identifier": semanticModelKey,
      "dcterms:title": dictionaryName,
      "dcat:keyword": [
        `${family} passport`,
        "digital product passport",
        "semantic dictionary",
      ],
      "dcat:distribution": [
        {
          "@id": `${publicBase}/distributions/terms-json`,
          "@type": "dcat:Distribution",
          "dcterms:title": `${titleCase(family)} dictionary terms JSON`,
          "dcat:accessURL": { "@id": `${dictionaryApiBase}/terms` },
          "dcat:mediaType": "application/json",
        },
        {
          "@id": `${publicBase}/distributions/context-jsonld`,
          "@type": "dcat:Distribution",
          "dcterms:title": `${titleCase(family)} dictionary JSON-LD context`,
          "dcat:accessURL": { "@id": `${publicBase}/context.jsonld` },
          "dcat:mediaType": "application/ld+json",
        },
        {
          "@id": `${publicBase}/distributions/category-rules-json`,
          "@type": "dcat:Distribution",
          "dcterms:title": `${titleCase(family)} category applicability rules`,
          "dcat:accessURL": { "@id": `${dictionaryApiBase}/category-rules` },
          "dcat:mediaType": "application/json",
        },
      ],
    },
    "dcat:service": {
      "@id": `${publicBase}/service`,
      "@type": "dcat:DataService",
      "dcterms:title": `${dictionaryName} API`,
      "dcat:endpointURL": { "@id": dictionaryApiBase },
      "dcat:servesDataset": { "@id": `${publicBase}/dataset` },
    },
    termCount: terms.length,
  };
}

function requirementLevelFor(value) {
  if (value === "required") return "mandatory_espr_jtc24";
  if (value === "recommended") return "voluntary";
  return null;
}

function buildCategoryRules(spec) {
  return {
    supportedCategories: [],
    categories: [],
    legend: {
      mandatory_espr_jtc24: "required",
      voluntary: "recommended",
      not_applicable: "optional",
    },
    requirementsBySemanticId: {},
  };
}

function buildModuleJs(spec) {
  const {
    family,
    version,
    moduleKey,
    typeName,
    displayName,
    productCategory,
    productIcon,
    semanticModelKey,
    complianceProfileKey,
    baseUrl,
    businessIdentifierField,
    requiredPassportFields,
    requireCompanyOperatorIdentifier,
    requireCarrierPolicy,
    enforceSemanticMapping,
    requirePublicAccessLayer,
    requireFacilityAtGranularities,
    defaultCarrierPolicyKey,
    managedSemanticFields,
  } = spec.module;
  const constName = `${family.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_${version.toUpperCase()}_SEMANTIC_BASE`;
  const semanticBase = `${baseUrl}/dictionary/${family}/${version}/terms`;

  const sectionLines = spec.sections.map((section) => {
    const fieldLines = section.fields.map((field) => {
      const args = {
        key: field.fieldKey,
        label: field.fieldLabel,
        semanticSlug: field.semanticSlug,
      };
      if (field.fieldType !== "text") args.type = field.fieldType;
      if (field.accessRights !== "public") args.accessLevel = "restricted";
      if (field.unitKey !== "none") args.unit = field.unitSymbol;
      if (field.dataType !== "string") args.dataType = field.dataType === "integer" ? "integer" : field.dataType;
      if (field.queryable) args.queryable = true;
      if (field.indexed) args.indexed = true;
      if (field.storageType) args.storageType = field.storageType;
      args.displayRole = field.displayRole;
      if (field.summaryRole) args.summaryRole = field.summaryRole;
      if (field.lifecycleRole) args.lifecycleRole = field.lifecycleRole;
      if (field.mediaRole) args.mediaRole = field.mediaRole;
      args.presentation = field.presentation;
      args.elementIdPath = field.elementIdPath;
      args.objectType = field.objectType;
      args.valueDataType = field.valueDataType;
      if (field.fieldType === "table") {
        args.tableColumns = (field.tableColumns || []).map((column) => ({
          key: column.columnKey,
          label: column.columnLabel,
          semanticSlug: column.semanticSlug,
          elementIdPath: column.elementIdPath,
          objectType: column.objectType,
          valueDataType: column.valueDataType,
          ...(column.unitKey !== "none" ? { unit: column.unitSymbol || column.unitKey } : {}),
          ...(column.dataType !== "string" ? { dataType: column.dataType } : {}),
          ...(column.required ? { required: true } : {}),
        }));
        args.tableDefaultRows = field.tableDefaultRows || [];
        if (field.composition) args.composition = true;
        if (field.compositionLabelColumnKey) args.compositionLabelColumnKey = field.compositionLabelColumnKey;
        if (field.compositionValueColumnKey) args.compositionValueColumnKey = field.compositionValueColumnKey;
      }
      return `        field(${jsValue(args)})`;
    }).join(",\n");
    return `    {\n      key: ${jsValue(section.key)},\n      label: ${jsValue(section.label)},\n      fields: [\n${fieldLines}\n      ],\n    }`;
  }).join(",\n");

  return `"use strict";

const ${constName} = ${jsValue(semanticBase)};

const publicFieldDefaults = {
  access: ["public"],
  confidentiality: "public",
  updateAuthority: ["economic_operator"],
};

const restrictedFieldDefaults = {
  access: ["economic_operator", "manufacturer", "market_surveillance", "notified_bodies"],
  confidentiality: "restricted",
  updateAuthority: ["economic_operator", "manufacturer"],
};

function term(slug) {
  return \`${"${" + constName + "}"}/\${slug}\`;
}

function field({
  key,
  label,
  semanticSlug,
  type = "text",
  accessLevel = "public",
  unit = "",
  dataType = "string",
  queryable = false,
  indexed = false,
  storageType = "",
  tableColumns = [],
  tableDefaultRows = [],
  composition = false,
  compositionLabelColumnKey = "",
  compositionValueColumnKey = "",
  displayRole,
  summaryRole = "",
  lifecycleRole = "",
  mediaRole = "",
  presentation,
  elementIdPath,
  objectType,
  valueDataType,
}) {
  const access = accessLevel === "restricted" ? restrictedFieldDefaults : publicFieldDefaults;
  return {
    ...access,
    key,
    label,
    type,
    semanticId: term(semanticSlug),
    elementIdPath,
    unit,
    dataType,
    objectType,
    valueDataType,
    displayRole,
    ...(summaryRole ? { summaryRole } : {}),
    ...(lifecycleRole ? { lifecycleRole } : {}),
    ...(mediaRole ? { mediaRole } : {}),
    presentation,
    ...(queryable ? { queryable: true } : {}),
    ...(indexed ? { indexed: true } : {}),
    ...(storageType ? { storageType } : {}),
    ...(type === "table" ? {
      table_cols: tableColumns.length,
      table_columns: tableColumns.map((column) => ({
        key: column.key,
        label: column.label,
        semanticId: term(column.semanticSlug),
        elementIdPath: column.elementIdPath,
        objectType: column.objectType,
        valueDataType: column.valueDataType,
        ...(column.unit ? { unit: column.unit } : {}),
        ...(column.dataType ? { dataType: column.dataType } : {}),
        ...(column.required ? { required: true } : {}),
      })),
      table_default_rows: tableDefaultRows,
      ...(composition ? { composition: true } : {}),
      ...(compositionLabelColumnKey ? { compositionLabelColumnKey } : {}),
      ...(compositionValueColumnKey ? { compositionValueColumnKey } : {}),
    } : {}),
  };
}

module.exports = {
  moduleKey: ${jsValue(moduleKey)},
  typeName: ${jsValue(typeName)},
  displayName: ${jsValue(displayName)},
  productCategory: ${jsValue(productCategory)},
  productIcon: ${jsValue(productIcon)},
  semanticModelKey: ${jsValue(semanticModelKey)},
  identity: {
    businessIdentifierField: ${businessIdentifierField ? jsValue(businessIdentifierField) : "null"},
  },
  complianceProfile: {
    key: ${jsValue(complianceProfileKey)},
    displayName: ${jsValue(`${displayName.replace(/\s+v\d+$/i, "")} DPP Profile ${version}`)},
    contentSpecificationIds: [${jsValue(semanticModelKey)}],
    requiredPassportFields: ${jsValue(requiredPassportFields)},
    requireCompanyOperatorIdentifier: ${requireCompanyOperatorIdentifier ? "true" : "false"},
    requireCarrierPolicy: ${requireCarrierPolicy ? "true" : "false"},
    requireFacilityAtGranularities: ${jsValue(requireFacilityAtGranularities)},
    defaultCarrierPolicyKey: ${jsValue(defaultCarrierPolicyKey)},
    enforceSemanticMapping: ${enforceSemanticMapping ? "true" : "false"},
    requirePublicAccessLayer: ${requirePublicAccessLayer ? "true" : "false"},
    managedSemanticFields: ${JSON.stringify(managedSemanticFields, null, 4).replace(/\n/g, "\n    ")},
  },
  schemaVersion: 1,
  lifecycle: {
    source: "code",
    stability: "versioned",
    changePolicy: "Breaking schema or semantic changes require a new module and typeName.",
  },
  sections: [
${sectionLines}
  ],
};
`;
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildArtifacts(input) {
  const spec = validateSpec(input);
  const terms = buildTerms(spec);
  const categories = buildCategories(spec);
  const units = buildUnits(spec);
  const context = buildContext(spec, terms);
  const manifest = buildManifest(spec);
  const catalog = buildCatalog(spec, terms);
  const categoryRules = buildCategoryRules(spec);
  const moduleFileName = `${spec.module.family}-${spec.module.version}.js`;
  const semanticDir = `apps/backend-api/resources/semantics/${spec.module.family}/${spec.module.version}`;

  return {
    spec,
    artifacts: [
      {
        path: `apps/backend-api/src/passport-modules/${moduleFileName}`,
        content: buildModuleJs(spec),
      },
      { path: `${semanticDir}/manifest.json`, content: prettyJson(manifest) },
      { path: `${semanticDir}/terms.json`, content: prettyJson(terms) },
      { path: `${semanticDir}/context.jsonld`, content: prettyJson(context) },
      { path: `${semanticDir}/categories.json`, content: prettyJson(categories) },
      { path: `${semanticDir}/units.json`, content: prettyJson(units) },
      { path: `${semanticDir}/catalog.jsonld`, content: prettyJson(catalog) },
      { path: `${semanticDir}/category-rules.json`, content: prettyJson(categoryRules) },
    ],
  };
}

function safeRepoPath(relativePath) {
  const fullPath = path.resolve(REPO_ROOT, relativePath);
  if (!fullPath.startsWith(REPO_ROOT)) {
    throw new Error(`Refusing to write outside repo: ${relativePath}`);
  }
  return fullPath;
}

async function writeArtifacts(input) {
  const { artifacts, spec } = buildArtifacts(input);
  const overwrite = Boolean(input.overwrite);
  const conflicts = artifacts
    .map((artifact) => artifact.path)
    .filter((relativePath) => fs.existsSync(safeRepoPath(relativePath)));

  if (conflicts.length && !overwrite) {
    const error = new Error("Some target files already exist. Enable overwrite to replace them.");
    error.statusCode = 409;
    error.conflicts = conflicts;
    throw error;
  }

  for (const artifact of artifacts) {
    const fullPath = safeRepoPath(artifact.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, artifact.content, "utf8");
  }

  return { spec, written: artifacts.map((artifact) => artifact.path) };
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === "GET" && pathname === "/api/status") {
      sendJson(res, 200, { repoRoot: REPO_ROOT, port: PORT });
      return;
    }

    if (req.method === "POST" && pathname === "/api/preview") {
      const input = await readBody(req);
      const result = buildArtifacts(input);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && pathname === "/api/write") {
      const input = await readBody(req);
      const result = await writeArtifacts(input);
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: "API route not found" });
  } catch (error) {
    sendJson(res, error.statusCode || 400, {
      error: error.message,
      conflicts: error.conflicts || undefined,
    });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url.pathname);
    return;
  }
  serveStatic(req, res, url.pathname);
});

if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Passport module generator running at http://127.0.0.1:${PORT}`);
    console.log(`Repo root: ${REPO_ROOT}`);
  });
}

module.exports = {
  buildArtifacts,
  validateSpec,
};
