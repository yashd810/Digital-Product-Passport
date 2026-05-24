import { PASSPORT_SECTIONS_MAP } from "../../../../passports/config/PassportFields";
import { isReleasedPassportStatus } from "../../../../passports/utils/passportStatus";

const BASE_COMPLETENESS_FIELDS = [
  { key: "modelName", type: "text" },
];

export function formatPassportTypeLabel(passportType) {
  if (!passportType) return "Passport";
  return String(passportType)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function sortPassportsByVersionDesc(a, b) {
  const versionDiff = Number(b?.versionNumber || 0) - Number(a?.versionNumber || 0);
  if (versionDiff !== 0) return versionDiff;
  return getPassportDateTimestamp(b) - getPassportDateTimestamp(a);
}

export function getPassportDateValue(passport) {
  if (!passport || typeof passport !== "object") return null;
  return passport.createdAt
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
  if (passport?.lineageId) return `lineage:${passport.lineageId}`;
  if (passport?.internalAliasId) return `product:${passport.passportType || "passport"}:${passport.internalAliasId}`;
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

function getPassportFieldValue(passport, key) {
  return Object.prototype.hasOwnProperty.call(passport, key) ? passport[key] : undefined;
}

export function getPassportSerialNumber(passport) {
  const value = getPassportFieldValue(passport || {}, "batterySerialNumber")
    ?? getPassportFieldValue(passport || {}, "serialNumber")
    ?? getPassportFieldValue(passport || {}, "productSerialNumber");
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
    field.semanticId,
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

  const passportType = passport?.passportType;
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
  const dynamicType = typeDefinitions.find((type) => type.typeName === passportType);
  const dynamicFields = dynamicType?.fieldsJson?.sections?.flatMap((section) => section.fields || []) || [];
  if (dynamicFields.length) return dynamicFields;

  return PASSPORT_SECTIONS_MAP[passportType]
    ? Object.values(PASSPORT_SECTIONS_MAP[passportType]).flatMap((section) => section.fields)
    : [];
}

export function calcCompleteness(passport, typeDefinitions = []) {
  if (!passport) return null;

  const pType = passport.passportType;
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
    if (!passport?.dppId || !isReleasedPassportStatus(passport.releaseStatus)) return;
    const key = passport.lineageId || passport.dppId;
    const current = latestByLineage.get(key);
    if (!current || Number(passport.versionNumber || 0) > Number(current.versionNumber || 0)) {
      latestByLineage.set(key, passport);
    }
  });
  return [...latestByLineage.values()];
}
