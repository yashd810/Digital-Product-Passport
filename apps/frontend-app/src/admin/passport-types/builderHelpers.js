import { LANGUAGES } from "../../app/providers/i18n";

export const TRANS_LANGS = LANGUAGES.filter((language) => language.code !== "en");

export const ACCESS_LEVELS = [
  { value: "public",              label: "Public" },
  { value: "consumers",           label: "Consumers" },
  { value: "economic_operator",   label: "Economic Operators" },
  { value: "manufacturer",        label: "Manufacturers" },
  { value: "authorized_representative", label: "Authorized Representatives" },
  { value: "importer",            label: "Importers" },
  { value: "distributor",         label: "Distributors" },
  { value: "dealer",              label: "Dealers" },
  { value: "fulfilment_service_provider", label: "Fulfilment Service Providers" },
  { value: "delegated_operator",  label: "Delegated Operators" },
  { value: "professional_repairer", label: "Professional Repairers" },
  { value: "independent_operator", label: "Independent Operators" },
  { value: "recycler",            label: "Recyclers" },
  { value: "notified_bodies",     label: "Notified Bodies" },
  { value: "market_surveillance", label: "Market Surveillance Authorities" },
  { value: "customs_authority",   label: "Customs Authorities" },
  { value: "eu_commission",       label: "The EU Commission" },
  { value: "main_dpp_service_provider", label: "Main DPP Service Providers" },
  { value: "backup_dpp_service_provider", label: "Back-up DPP Service Providers" },
  { value: "legitimate_interest", label: "Person with Legitimate Interest" },
];

export const CONFIDENTIALITY_LEVELS = [
  { value: "public", label: "Public" },
  { value: "restricted", label: "Restricted" },
  { value: "confidential", label: "Confidential" },
  { value: "trade_secret", label: "Trade Secret" },
  { value: "regulated", label: "Regulated" },
];

export const UPDATE_AUTHORITIES = [
  { value: "economic_operator", label: "Economic Operators" },
  { value: "manufacturer", label: "Manufacturers" },
  { value: "authorized_representative", label: "Authorized Representatives" },
  { value: "importer", label: "Importers" },
  { value: "distributor", label: "Distributors" },
  { value: "dealer", label: "Dealers" },
  { value: "fulfilment_service_provider", label: "Fulfilment Service Providers" },
  { value: "delegated_operator", label: "Delegated Operators" },
  { value: "professional_repairer", label: "Professional Repairers" },
  { value: "independent_operator", label: "Independent Operators" },
  { value: "recycler", label: "Recyclers" },
  { value: "notified_bodies", label: "Notified Bodies" },
  { value: "market_surveillance", label: "Market Surveillance Authorities" },
  { value: "customs_authority", label: "Customs Authorities" },
  { value: "eu_commission", label: "The EU Commission" },
  { value: "main_dpp_service_provider", label: "Main DPP Service Providers" },
  { value: "backup_dpp_service_provider", label: "Back-up DPP Service Providers" },
  { value: "system", label: "System" },
];

export const ACCESS_LEVEL_LABELS = Object.fromEntries(
  ACCESS_LEVELS.map((entry) => [entry.value, entry.label])
);

export const CONFIDENTIALITY_LEVEL_LABELS = Object.fromEntries(
  CONFIDENTIALITY_LEVELS.map((entry) => [entry.value, entry.label])
);

export const UPDATE_AUTHORITY_LABELS = Object.fromEntries(
  UPDATE_AUTHORITIES.map((entry) => [entry.value, entry.label])
);

export const FIELD_TYPES = [
  { value: "text",     label: "Text (single line)" },
  { value: "textarea", label: "Text (multi-line)" },
  { value: "boolean",  label: "Yes / No" },
  { value: "date",     label: "Date" },
  { value: "url",      label: "URL / URI" },
  { value: "file",     label: "File upload (PDF)" },
  { value: "table",    label: "Table (rows × columns)" },
  { value: "symbol",   label: "Symbol (from repository)" },
];

export const DEFAULT_SYSTEM_PASSPORT_HEADER_SECTION = {
  key: "passportHeader",
  label: "Passport Header",
};

export const SYSTEM_HEADER_MANAGED_DEFINITIONS = [
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

const SYSTEM_HEADER_MANAGED_DEFINITION_BY_KEY = new Map(
  SYSTEM_HEADER_MANAGED_DEFINITIONS.map((definition) => [definition.managedKey, definition])
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
  return SYSTEM_HEADER_MANAGED_DEFINITION_BY_KEY.get(String(managedKey || "").trim()) || null;
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
      key: DEFAULT_SYSTEM_PASSPORT_HEADER_SECTION.key,
      label: String(section.label || "").trim() || DEFAULT_SYSTEM_PASSPORT_HEADER_SECTION.label,
    },
    fieldMappings,
    fieldKeys,
  };
}

export function resolveSystemHeaderFields(sections = [], systemHeader = {}) {
  return resolveSystemHeaderEntries(sections, systemHeader)
    .filter((entry) => entry.sourceType === "field" && entry.field)
    .map((entry) => entry.field);
}

export function resolveSystemHeaderEntries(sections = [], systemHeader = {}) {
  const normalized = normalizeSystemPassportHeader(systemHeader);
  const fieldMap = new Map(
    (Array.isArray(sections) ? sections : [])
      .flatMap((section) => Array.isArray(section?.fields) ? section.fields : [])
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

export const ICON_PRESETS = ["📋","⚡","🧵","🏗️","🎮","🏢","📦","🔋","🌿","🛡️","🔬","⚙️","🌊","🔥","🌱"];

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
      source: "passport_type",
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
  const accessIndex = hasStructuredHeader
    ? (headerIndexMap.get("access")
      ?? headerIndexMap.get("audience")
      ?? headerIndexMap.get("audiences"))
    : undefined;
  const confidentialityIndex = hasStructuredHeader
    ? (headerIndexMap.get("confidentiality")
      ?? headerIndexMap.get("classification"))
    : undefined;
  const updateAuthorityIndex = hasStructuredHeader
    ? (headerIndexMap.get("updateauthority")
      ?? headerIndexMap.get("updateauthorities")
      ?? headerIndexMap.get("authority"))
    : undefined;

  return rows.slice(start)
    .filter((row) => row[fieldIndex])
    .map((row) => {
      const rawType = row[typeIndex]?.trim().toLowerCase() || "";
      return {
        fieldLabel: row[fieldIndex],
        sectionLabel: row[sectionIndex]?.trim() || "General",
        fieldType: validTypes.has(rawType) ? rawType : "text",
        access: parseGovernanceList(row[accessIndex], ACCESS_LEVELS, ["public"]),
        confidentiality: parseGovernanceList(row[confidentialityIndex], CONFIDENTIALITY_LEVELS, ["public"])[0] || "public",
        updateAuthority: parseGovernanceList(row[updateAuthorityIndex], UPDATE_AUTHORITIES, ["economic_operator"]),
      };
    });
};

export const buildSectionsFromCSV = (rows) => {
  const map = new Map();
  for (const { fieldLabel, sectionLabel, fieldType, access, confidentiality, updateAuthority } of rows) {
    if (!map.has(sectionLabel)) map.set(sectionLabel, []);
    map.get(sectionLabel).push({
      label: fieldLabel,
      type: fieldType,
      access,
      confidentiality,
      updateAuthority,
    });
  }
  return [...map.entries()].map(([sectionLabel, fields]) => ({
    localId: Math.random().toString(36).slice(2),
    key: toSlug(sectionLabel),
    label: sectionLabel,
    fields: fields.map(({ label, type, access, confidentiality, updateAuthority }) => ({
      localId: Math.random().toString(36).slice(2),
      key: toFieldKey(label),
      label,
      type,
      access: Array.isArray(access) && access.length ? access : ["public"],
      confidentiality: confidentiality || "public",
      updateAuthority: Array.isArray(updateAuthority) && updateAuthority.length ? updateAuthority : ["economic_operator"],
    })),
  }));
};

export const downloadTemplate = () => {
  const csv = [
    "Field Label,Section,Type,Access,Confidentiality,Update Authority",
    "Manufacturer,General,text,manufacturer|market_surveillance,regulated,economic_operator|market_surveillance",
    "Model Number,General,text,public,public,economic_operator",
    "Internal Alias ID,General,text,public,public,economic_operator",
    "Weight (kg),Technical Specifications,text,public,public,economic_operator",
    "Dimensions,Technical Specifications,text,public,public,economic_operator",
    "Material Composition,Technical Specifications,textarea,public,public,economic_operator",
    "Is Recyclable,Sustainability,boolean,public,public,economic_operator",
    "Manufacture Date,General,date,public,public,economic_operator",
    "Product URL,General,url,public,public,economic_operator",
    "Recycled Content (%),Sustainability,text,public,public,economic_operator",
    "Carbon Footprint,Sustainability,text,legitimate_interest,restricted,economic_operator",
    "Compliance Certificate,Compliance Documents,file,notified_bodies|market_surveillance,regulated,economic_operator|notified_bodies",
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "passport_type_template.csv";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
};

export function newSection(label = "") {
  return {
    localId: Math.random().toString(36).slice(2),
    key: toSlug(label),
    label,
    label_i18n: {},
    fields: [],
  };
}

export function newField(label = "") {
  return {
    localId: Math.random().toString(36).slice(2),
    key: toFieldKey(label),
    label,
    label_i18n: {},
    type: "text",
    access: ["public"],
    confidentiality: "public",
    updateAuthority: ["economic_operator"],
  };
}
