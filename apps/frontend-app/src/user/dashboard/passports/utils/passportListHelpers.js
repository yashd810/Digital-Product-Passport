import { PASSPORT_SECTIONS_MAP } from "../../../../passports/config/PassportFields";
import { isReleasedPassportStatus } from "../../../../passports/utils/passportStatus";

const BASE_COMPLETENESS_FIELDS = [
  { key: "model_name", type: "text" },
];

const FIELD_KEY_ALIASES = {
  digitalProductPassportId: ["dppId", "dpp_id"],
  dppId: ["dpp_id", "digitalProductPassportId"],
  dpp_id: ["dppId", "digitalProductPassportId"],
  uniqueProductIdentifier: ["product_identifier_did"],
  internalAliasId: ["internal_alias_id"],
  modelName: ["model_name"],
  model_name: ["modelName"],
  internalAliasId: ["internal_alias_id", "internalAliasId"],
  internal_alias_id: ["internalAliasId", "internalAliasId"],
  serial_number: ["serialNumber", "serial", "battery_serial_number", "batterySerialNumber", "product_serial_number", "productSerialNumber"],
  serialNumber: ["serial_number", "serial", "battery_serial_number", "batterySerialNumber", "product_serial_number", "productSerialNumber"],
  batterySerialNumber: ["battery_serial_number", "serial_number", "serial", "serialNumber"],
  battery_serial_number: ["batterySerialNumber", "serial_number", "serial", "serialNumber"],
  dppStatus: ["release_status"],
  release_status: ["dppStatus"],
  lastUpdate: ["updated_at", "created_at"],
  economicOperatorId: ["economic_operator_id"],
  economic_operator_id: ["economicOperatorId"],
  facilityId: ["facility_id"],
  facility_id: ["facilityId"],
  contentSpecificationIds: ["content_specification_ids"],
  content_specification_ids: ["contentSpecificationIds"],
};

export function formatPassportTypeLabel(passportType) {
  if (!passportType) return "Passport";
  return String(passportType)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function sortPassportsByVersionDesc(a, b) {
  const versionDiff = Number(b?.version_number || 0) - Number(a?.version_number || 0);
  if (versionDiff !== 0) return versionDiff;
  return getPassportDateTimestamp(b) - getPassportDateTimestamp(a);
}

export function getPassportDateValue(passport) {
  if (!passport || typeof passport !== "object") return null;
  return passport.created_at
    || passport.createdAt
    || passport.updated_at
    || passport.updatedAt
    || null;
}

export function getPassportDateTimestamp(passport) {
  const dateValue = getPassportDateValue(passport);
  if (!dateValue) return 0;
  const timestamp = new Date(dateValue).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function formatPassportDate(passport, locale) {
  const dateValue = getPassportDateValue(passport);
  if (!dateValue) return "—";
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(locale);
}

export function getPassportGroupKey(passport) {
  if (passport?.lineage_id) return `lineage:${passport.lineage_id}`;
  if (passport?.internal_alias_id) return `product:${passport.passport_type || "passport"}:${passport.internal_alias_id}`;
  return `dppId:${passport?.dppId || ""}`;
}

export function parseCsvRow(line) {
  line = line.replace(/\r$/, "");
  const cells = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (c === "," && !inQ) {
      cells.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

export function parseCsvText(text) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map(parseCsvRow);
}

function getFieldCandidates(key) {
  const foldedKey = typeof key === "string" ? key.toLowerCase() : key;
  return [...new Set([key, foldedKey, ...(FIELD_KEY_ALIASES[key] || [])].filter(Boolean))];
}

function getPassportFieldValue(passport, key) {
  for (const candidate of getFieldCandidates(key)) {
    if (Object.prototype.hasOwnProperty.call(passport, candidate)) {
      return passport[candidate];
    }
  }
  return undefined;
}

export function getPassportSerialNumber(passport) {
  const value = getPassportFieldValue(passport || {}, "serial_number");
  return value == null ? "" : String(value).trim();
}

function normalizeSerialHint(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isLikelySerialField(field = {}) {
  const hints = [
    field.key,
    field.label,
    field.elementId,
    field.element_id,
    field.semanticId,
    field.semantic_id,
    field.dictionaryReference,
  ];
  return hints.some((hint) => {
    const normalized = normalizeSerialHint(hint);
    return normalized.includes("serialnumber") || normalized === "serial";
  });
}

export function getPassportSerialNumberForType(passport, typeDefinitions = []) {
  const explicitSerial = getPassportSerialNumber(passport);
  if (explicitSerial) return explicitSerial;

  const passportType = passport?.passport_type || passport?.passportType;
  const typeFields = passportType ? getTypeFields(passportType, typeDefinitions) : [];
  const serialField = typeFields.find(isLikelySerialField);
  if (!serialField?.key) return "";

  const value = getPassportFieldValue(passport || {}, serialField.key);
  return value == null ? "" : String(value).trim();
}

function hasCompletionValue(value, field = {}) {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;

  const text = String(value).trim();
  if (!text) return false;

  if (field.type === "boolean") {
    return ["true", "false", "yes", "no", "1", "0"].includes(text.toLowerCase());
  }

  if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}"))) {
    try {
      const parsed = JSON.parse(text);
      return hasCompletionValue(parsed, field);
    } catch {
      return true;
    }
  }

  return true;
}

function getTypeFields(passportType, typeDefinitions = []) {
  const dynamicType = typeDefinitions.find((type) => type.type_name === passportType);
  const dynamicFields = dynamicType?.fields_json?.sections?.flatMap((section) => section.fields || []) || [];
  if (dynamicFields.length) return dynamicFields;

  return PASSPORT_SECTIONS_MAP[passportType]
    ? Object.values(PASSPORT_SECTIONS_MAP[passportType]).flatMap((section) => section.fields)
    : [];
}

export function calcCompleteness(passport, typeDefinitions = []) {
  if (!passport) return null;

  const pType = passport.passport_type || passport.passportType;
  const typeFields = pType ? getTypeFields(pType, typeDefinitions) : [];
  const authorFields = typeFields.filter((field) => field.type !== "file" && !field.dynamic);
  const fieldsToMeasure = [
    ...BASE_COMPLETENESS_FIELDS,
    ...authorFields.filter((field) => !BASE_COMPLETENESS_FIELDS.some((baseField) => baseField.key === field.key)),
  ];

  if (!fieldsToMeasure.length) return null;

  const filled = fieldsToMeasure.filter((field) =>
    hasCompletionValue(getPassportFieldValue(passport, field.key), field)
  ).length;

  return Math.round((filled / fieldsToMeasure.length) * 100);
}

export function dedupeLatestReleasedPassports(passports = []) {
  const latestByLineage = new Map();
  passports.forEach((passport) => {
    if (!passport?.dppId || !isReleasedPassportStatus(passport.release_status)) return;
    const key = passport.lineage_id || passport.dppId;
    const current = latestByLineage.get(key);
    if (!current || Number(passport.version_number || 0) > Number(current.version_number || 0)) {
      latestByLineage.set(key, passport);
    }
  });
  return [...latestByLineage.values()];
}
