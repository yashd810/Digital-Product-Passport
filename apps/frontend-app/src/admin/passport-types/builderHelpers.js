import { languages } from "../../app/providers/i18n";
import { flattenSchemaFieldsFromSections } from "../../shared/passports/passportSchemaUtils";

export const transLangs = languages.filter((language) => language.code !== "en");

export const confidentialityLevels = [
  { value: "public", label: "Public" },
  { value: "restricted", label: "Restricted" },
];

export const confidentialityLevelLabels = Object.fromEntries(
  confidentialityLevels.map((entry) => [entry.value, entry.label])
);

export const fieldTypes = [
  { value: "text",     label: "Text (single line)" },
  { value: "textarea", label: "Text (multi-line)" },
  { value: "boolean",  label: "Yes / No" },
  { value: "date",     label: "Date" },
  { value: "datetime", label: "Date and time" },
  { value: "url",      label: "URL / URI" },
  { value: "file",     label: "File upload (PDF)" },
  { value: "table",    label: "Table (rows × columns)" },
  { value: "symbol",   label: "Symbol (from repository)" },
  { value: "object",   label: "Nested semantic object" },
  { value: "objectList", label: "Nested semantic object list" },
  { value: "select",   label: "Controlled enum" },
  { value: "multiselect", label: "Controlled enum list" },
  { value: "scalarList", label: "Scalar value list" },
];

export const defaultSystemPassportHeaderSection = {
  key: "passportHeader",
  label: "Passport Header",
};

export const systemHeaderManagedDefinitions = [
  {
    slotKey: "digitalProductPassportId",
    label: "Digital Product Passport ID",
    semanticId: "dpp:digitalProductPassportId",
    managedKey: "internalManagedDigitalProductPassportId",
    required: true,
  },
  {
    slotKey: "uniqueProductIdentifier",
    label: "Unique Product Identifier",
    semanticId: "dpp:uniqueProductIdentifier",
    managedKey: "internalManagedUniqueProductIdentifier",
    required: true,
  },
  {
    slotKey: "internalAliasId",
    label: "Internal Alias ID",
    semanticId: "dpp:internalAliasId",
    managedKey: "internalManagedInternalAliasId",
    required: true,
  },
  {
    slotKey: "granularity",
    label: "Granularity",
    semanticId: "dpp:granularity",
    managedKey: "internalManagedGranularity",
    required: true,
  },
  {
    slotKey: "dppSchemaVersion",
    label: "DPP Schema Version",
    semanticId: "dpp:dppSchemaVersion",
    managedKey: "internalManagedDppSchemaVersion",
    required: true,
  },
  {
    slotKey: "dppStatus",
    label: "DPP Status",
    semanticId: "dpp:dppStatus",
    managedKey: "internalManagedDppStatus",
    required: true,
  },
  {
    slotKey: "lastUpdate",
    label: "Last Update",
    semanticId: "dpp:lastUpdate",
    managedKey: "internalManagedLastUpdate",
    required: true,
  },
  {
    slotKey: "economicOperatorId",
    label: "Economic Operator ID",
    semanticId: "dpp:economicOperatorId",
    managedKey: "internalManagedEconomicOperatorId",
    required: true,
  },
  {
    slotKey: "facilityId",
    label: "Facility ID",
    semanticId: "dpp:facilityId",
    managedKey: "internalManagedFacilityId",
    required: false,
  },
  {
    slotKey: "contentSpecificationIds",
    label: "Content Specification IDs",
    semanticId: "dpp:contentSpecificationIds",
    managedKey: "internalManagedContentSpecificationIds",
    required: true,
  },
  {
    slotKey: "subjectDid",
    label: "Subject DID",
    semanticId: "dpp:subjectDid",
    managedKey: "internalManagedSubjectDid",
    required: true,
  },
  {
    slotKey: "dppDid",
    label: "DPP DID",
    semanticId: "dpp:dppDid",
    managedKey: "internalManagedDppDid",
    required: true,
  },
  {
    slotKey: "companyDid",
    label: "Company DID",
    semanticId: "dpp:companyDid",
    managedKey: "internalManagedCompanyDid",
    required: true,
  },
];

const systemHeaderManagedDefinitionByKey = new Map(
  systemHeaderManagedDefinitions.map((definition) => [definition.managedKey, definition])
);

function normalizeSystemHeaderFieldMappings(input = {}) {
  if (!Array.isArray(input?.fieldMappings)) return [];
  return input.fieldMappings
    .map((mapping) => ({
      slotKey: String(mapping?.slotKey || "").trim(),
      sourceType: String(mapping?.sourceType || (mapping?.managedKey ? "managed" : "field")).trim().toLowerCase(),
      label: String(mapping?.label || "").trim(),
      fieldKey: String(mapping?.fieldKey || "").trim(),
      managedKey: String(mapping?.managedKey || "").trim(),
    }))
    .filter((mapping) => {
      if (mapping.sourceType === "managed") return Boolean(mapping.managedKey);
      return Boolean(mapping.fieldKey);
    });
}

export function getSystemHeaderManagedDefinition(managedKey = "") {
  return systemHeaderManagedDefinitionByKey.get(String(managedKey || "").trim()) || null;
}

export function normalizeSystemPassportHeader(input = {}) {
  const section = input?.section || {};
  const fieldMappings = normalizeSystemHeaderFieldMappings(input);
  const rawFieldKeys = fieldMappings.length
    ? fieldMappings.map((mapping) => mapping.sourceType === "field" ? mapping.fieldKey : "").filter(Boolean)
    : (Array.isArray(input?.fieldKeys)
      ? input.fieldKeys
      : (Array.isArray(input?.fields) ? input.fields.map((field) => field?.key) : []));
  const fieldKeys = [];
  const seen = new Set();
  for (const key of rawFieldKeys) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || seen.has(normalizedKey)) continue;
    seen.add(normalizedKey);
    fieldKeys.push(normalizedKey);
  }
  return {
    section: {
      key: defaultSystemPassportHeaderSection.key,
      label: String(section.label || "").trim() || defaultSystemPassportHeaderSection.label,
    },
    fieldMappings,
    fieldKeys,
  };
}

export function resolveSystemHeaderEntries(sections = [], systemHeader = {}) {
  const normalized = normalizeSystemPassportHeader(systemHeader);
  const fieldMap = new Map(
    flattenSchemaFieldsFromSections(Array.isArray(sections) ? sections : [])
      .filter((field) => field?.key)
      .map((field) => [field.key, field])
  );
  if (normalized.fieldMappings.length) {
    return normalized.fieldMappings.map((mapping) => {
      if (mapping.sourceType === "managed") {
        const managedDefinition = getSystemHeaderManagedDefinition(mapping.managedKey);
        if (!managedDefinition) return null;
        return {
          slotKey: mapping.slotKey || managedDefinition.slotKey,
          sourceType: "managed",
          managedKey: managedDefinition.managedKey,
          label: managedDefinition.label,
          semanticId: managedDefinition.semanticId,
          required: managedDefinition.required,
          field: null,
          fieldKey: "",
          type: "managed",
        };
      }

      const field = fieldMap.get(mapping.fieldKey);
      if (!field) return null;
      return {
        slotKey: mapping.slotKey || field.key,
        sourceType: "field",
        managedKey: "",
        label: field.label || field.key,
        semanticId: field.semanticId || "",
        required: field.required === true,
        field,
        fieldKey: field.key,
        type: field.type || "",
      };
    }).filter(Boolean);
  }

  return normalized.fieldKeys.map((key) => {
    const field = fieldMap.get(key);
    if (!field) return null;
    return {
      slotKey: field.key,
      sourceType: "field",
      managedKey: "",
      label: field.label || field.key,
      semanticId: field.semanticId || "",
      required: field.required === true,
      field,
      fieldKey: field.key,
      type: field.type || "",
    };
  }).filter(Boolean);
}

export const iconPresets = ["📋","⚡","🧵","🏗️","🎮","🏢","📦","🌿","🛡️","🔬","⚙️","🌊","🔥","🌱"];

export function normalizeProductCategoryName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function buildProductCategoryOptions({
  savedCategories = [],
  passportTypes = [],
  draftType = null,
} = {}) {
  const byName = new Map();
  const addCategory = ({ name, icon = "📋", id = null, source = "derived", managed = false } = {}) => {
    const normalizedName = normalizeProductCategoryName(name);
    if (!normalizedName) return;
    const existing = byName.get(normalizedName);
    if (!existing) {
      byName.set(normalizedName, {
        id: id || normalizedName,
        name: normalizedName,
        icon: icon || "📋",
        managed,
        source,
      });
      return;
    }
    if (!existing.managed && managed) {
      byName.set(normalizedName, {
        ...existing,
        id: id || existing.id,
        icon: icon || existing.icon,
        managed: true,
        source,
      });
    }
  };

  for (const category of Array.isArray(savedCategories) ? savedCategories : []) {
    addCategory({
      id: category.id,
      name: category.name,
      icon: category.icon,
      source: "catalog",
      managed: true,
    });
  }

  for (const type of Array.isArray(passportTypes) ? passportTypes : []) {
    addCategory({
      name: type.productCategory,
      icon: type.productIcon,
      source: "passportType",
    });
  }

  if (draftType) {
    addCategory({
      name: draftType.productCategory,
      icon: draftType.productIcon,
      source: "draft",
    });
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export const toSlug = (str) =>
  toFieldKey(str);

export const toFieldKey = (str) => {
  const parts = String(str || "")
    .trim()
    .replace(/[^A-Za-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "";

  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
};

export const rekeySection = (sec) => ({
  ...sec,
  key: sec._keyManual ? sec.key : toSlug(sec.label),
  fields: (() => {
    const seen = new Set();
    return (sec.fields || []).map((field) => {
      if (field._keyManual) {
        seen.add(field.key);
        return field;
      }
      const key = field.key || toFieldKey(field.label);
      seen.add(key);
      return { ...field, key };
    });
  })(),
});

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseDelimitedValues(value) {
  return String(value || "")
    .split(/[|;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseGovernanceList(rawValue, validEntries) {
  const requested = parseDelimitedValues(rawValue)
    .map((entry) => normalizeToken(entry));
  const matched = [...new Set(
    requested
      .map((token) => validEntries.find((entry) => normalizeToken(entry.value) === token)?.value || null)
      .filter(Boolean)
  )];
  return matched;
}

function parseHeaderIndexMap(headerRow = []) {
  const indexMap = new Map();
  headerRow.forEach((column, index) => {
    indexMap.set(normalizeToken(column), index);
  });
  return indexMap;
}

export const parseCSV = (text) => {
  const lines = text.trim().split(/\r?\n/);
  const rows = lines.map((line) => {
    const cols = [];
    let cur = "";
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') {
        inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        cols.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    return cols;
  });

  const headerIndexMap = parseHeaderIndexMap(rows[0] || []);
  const hasStructuredHeader = headerIndexMap.has("fieldlabel")
    || headerIndexMap.has("field")
    || headerIndexMap.has("label")
    || headerIndexMap.has("fieldname");
  const start = hasStructuredHeader ? 1 : 0;
  const validTypes = new Set(["text", "textarea", "boolean", "date", "url", "file", "table", "symbol"]);
  const fieldIndex = hasStructuredHeader
    ? (headerIndexMap.get("fieldlabel")
      ?? headerIndexMap.get("fieldname")
      ?? headerIndexMap.get("field")
      ?? headerIndexMap.get("label")
      ?? 0)
    : 0;
  const sectionIndex = hasStructuredHeader
    ? (headerIndexMap.get("sectionlabel")
      ?? headerIndexMap.get("section")
      ?? 1)
    : 1;
  const typeIndex = hasStructuredHeader
    ? (headerIndexMap.get("fieldtype")
      ?? headerIndexMap.get("type")
      ?? 2)
    : 2;
  const confidentialityIndex = hasStructuredHeader
    ? (headerIndexMap.get("confidentiality")
      ?? headerIndexMap.get("classification"))
    : undefined;

  return rows.slice(start)
    .filter((row) => row[fieldIndex])
    .map((row) => {
      const rawType = row[typeIndex]?.trim().toLowerCase() || "";
      return {
        fieldLabel: row[fieldIndex],
        sectionLabel: row[sectionIndex]?.trim() || "General",
        fieldType: validTypes.has(rawType) ? rawType : "text",
        confidentiality: parseGovernanceList(row[confidentialityIndex], confidentialityLevels, ["public"])[0] || "public",
      };
    });
};

export const buildSectionsFromCSV = (rows) => {
  const map = new Map();
  for (const { fieldLabel, sectionLabel, fieldType, confidentiality } of rows) {
    if (!map.has(sectionLabel)) map.set(sectionLabel, []);
    map.get(sectionLabel).push({
      label: fieldLabel,
      type: fieldType,
      confidentiality,
    });
  }
  return [...map.entries()].map(([sectionLabel, fields]) => ({
    localId: Math.random().toString(36).slice(2),
    key: toSlug(sectionLabel),
    label: sectionLabel,
    fields: fields.map(({ label, type, confidentiality }) => ({
      localId: Math.random().toString(36).slice(2),
      key: toFieldKey(label),
      label,
      type,
      confidentiality: confidentiality || "public",
    })),
  }));
};

export const downloadTemplate = () => {
  const csv = [
    "Field Label,Section,Type,Confidentiality",
    "Manufacturer,General,text,public",
    "Model Number,General,text,public",
    "Internal Alias ID,General,text,public",
    "Weight (kg),Technical Specifications,text,public",
    "Dimensions,Technical Specifications,text,public",
    "Material Composition,Technical Specifications,textarea,public",
    "Is Recyclable,Sustainability,boolean,public",
    "Manufacture Date,General,date,public",
    "Product URL,General,url,public",
    "Recycled Content (%),Sustainability,text,public",
    "Carbon Footprint,Sustainability,text,restricted",
    "Compliance Certificate,Compliance Documents,file,restricted",
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "passport-type-template.csv";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
};

export function newSection(label = "") {
  return {
    localId: Math.random().toString(36).slice(2),
    key: toSlug(label),
    label,
    labelI18n: {},
    fields: [],
  };
}

export function newField(label = "") {
  return {
    localId: Math.random().toString(36).slice(2),
    key: toFieldKey(label),
    label,
    labelI18n: {},
    type: "text",
    confidentiality: "public",
  };
}
