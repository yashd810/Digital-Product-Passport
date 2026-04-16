import { LANGUAGES } from "../../app/providers/i18n";

export const TRANS_LANGS = LANGUAGES.filter((language) => language.code !== "en");

export const ACCESS_LEVELS = [
  { value: "public",              label: "Public" },
  { value: "notified_bodies",     label: "Notified Bodies" },
  { value: "market_surveillance", label: "Market Surveillance Authorities" },
  { value: "eu_commission",       label: "The EU Commission" },
  { value: "legitimate_interest", label: "Person with Legitimate Interest" },
];

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

export const ICON_PRESETS = ["📋","⚡","🧵","🏗️","🎮","🏢","📦","🔋","🌿","🛡️","🔬","⚙️","🌊","🔥","🌱"];

export const toSlug = (str) =>
  str.trim().toLowerCase()
    .replace(/[^a-z0-9\s]+/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join("_");

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
      const key = toSlug(field.label);
      seen.add(key);
      return { ...field, key };
    });
  })(),
});

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

  const headerWords = /^(field|label|name|section|column|col|header)$/i;
  const start = headerWords.test(rows[0]?.[0] || "") ? 1 : 0;
  const validTypes = new Set(["text", "textarea", "boolean", "date", "url", "file", "table", "symbol"]);

  return rows.slice(start)
    .filter((row) => row[0])
    .map((row) => {
      const rawType = row[2]?.trim().toLowerCase() || "";
      return {
        fieldLabel: row[0],
        sectionLabel: row[1]?.trim() || "General",
        fieldType: validTypes.has(rawType) ? rawType : "text",
      };
    });
};

export const buildSectionsFromCSV = (rows) => {
  const map = new Map();
  for (const { fieldLabel, sectionLabel, fieldType } of rows) {
    if (!map.has(sectionLabel)) map.set(sectionLabel, []);
    map.get(sectionLabel).push({ label: fieldLabel, type: fieldType });
  }
  return [...map.entries()].map(([sectionLabel, fields]) => ({
    _id: Math.random().toString(36).slice(2),
    key: toSlug(sectionLabel),
    label: sectionLabel,
    fields: fields.map(({ label, type }) => ({
      _id: Math.random().toString(36).slice(2),
      key: toSlug(label),
      label,
      type,
    })),
  }));
};

export const downloadTemplate = () => {
  const csv = [
    "Field Label,Section,Type",
    "Manufacturer,General,text",
    "Model Number,General,text",
    "Serial Number,General,text",
    "Weight (kg),Technical Specifications,text",
    "Dimensions,Technical Specifications,text",
    "Material Composition,Technical Specifications,textarea",
    "Is Recyclable,Sustainability,boolean",
    "Manufacture Date,General,date",
    "Product URL,General,url",
    "Recycled Content (%),Sustainability,text",
    "Carbon Footprint,Sustainability,text",
    "Compliance Certificate,Compliance Documents,file",
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
    _id: Math.random().toString(36).slice(2),
    key: toSlug(label),
    label,
    label_i18n: {},
    fields: [],
  };
}

export function newField(label = "") {
  return {
    _id: Math.random().toString(36).slice(2),
    key: toSlug(label),
    label,
    label_i18n: {},
    type: "text",
    access: ["public"],
  };
}
