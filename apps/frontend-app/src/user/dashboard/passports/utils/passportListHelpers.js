import { PASSPORT_SECTIONS_MAP } from "../../../../passports/config/PassportFields";
import { isReleasedPassportStatus } from "../../../../passports/utils/passportStatus";

export function formatPassportTypeLabel(passportType) {
  if (!passportType) return "Passport";
  return String(passportType)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function sortPassportsByVersionDesc(a, b) {
  const versionDiff = Number(b?.version_number || 0) - Number(a?.version_number || 0);
  if (versionDiff !== 0) return versionDiff;
  return new Date(b?.updated_at || b?.created_at || 0).getTime() - new Date(a?.updated_at || a?.created_at || 0).getTime();
}

export function getPassportGroupKey(passport) {
  if (passport?.lineage_id) return `lineage:${passport.lineage_id}`;
  if (passport?.product_id) return `product:${passport.passport_type || "passport"}:${passport.product_id}`;
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

export function calcCompleteness(passport, typeDefinitions = []) {
  const pType = passport.passport_type;
  if (!pType) return null;

  const dynamicType = typeDefinitions.find((type) => type.type_name === pType);
  const dynamicFields = dynamicType?.fields_json?.sections?.flatMap((section) => section.fields || []) || [];
  const staticFields = PASSPORT_SECTIONS_MAP[pType]
    ? Object.values(PASSPORT_SECTIONS_MAP[pType]).flatMap((section) => section.fields)
    : [];
  const allFields = dynamicFields.length ? dynamicFields : staticFields;

  if (!allFields.length) return null;
  const optional = allFields.filter((field) => field.type !== "file");
  if (!optional.length) return null;

  const filled = optional.filter((field) => {
    const value = passport[field.key];
    if (value === null || value === undefined || value === "") return false;
    if (field.type === "boolean") return value === true;
    return String(value).trim() !== "";
  }).length;

  return Math.round((filled / optional.length) * 100);
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
