"use strict";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const IN_REVISION_STATUS = "in_revision";
const LEGACY_IN_REVISION_STATUS = "revised";

const SYSTEM_PASSPORT_FIELDS = new Set([
  "id",
  "dpp_id",
  "dppId",
  "lineage_id",
  "company_id",
  "created_by",
  "created_at",
  "passport_type",
  "version_number",
  "release_status",
  "deleted_at",
  "qr_code",
  "created_by_email",
  "first_name",
  "last_name",
  "updated_by",
  "updated_at",
]);

const EDITABLE_PASSPORT_STATUSES = new Set(["draft", IN_REVISION_STATUS]);

// ─── TABLE HELPERS ────────────────────────────────────────────────────────────

const getTable = (typeName) => {
  if (!typeName) throw new Error("typeName is required for table lookup");
  const safe = String(typeName).replace(/[^a-z0-9_]/g, "_");
  return `${safe}_passports`;
};

// ─── STATUS HELPERS ───────────────────────────────────────────────────────────

const normalizeReleaseStatus = (status) =>
  status === LEGACY_IN_REVISION_STATUS ? IN_REVISION_STATUS : status;

const isPublicHistoryStatus = (status) => {
  const normalized = normalizeReleaseStatus(status);
  return normalized === "released" || normalized === "obsolete";
};

const isEditablePassportStatus = (status) =>
  EDITABLE_PASSPORT_STATUSES.has(normalizeReleaseStatus(status));

// ─── ROW NORMALIZATION ────────────────────────────────────────────────────────

const normalizePassportRow = (row) => {
  if (!row) return row;
  const dppId = row.dppId ?? row.dpp_id ?? null;
  const normalized = {
    ...row,
    dpp_id: row.dpp_id ?? dppId,
    dppId,
    release_status: normalizeReleaseStatus(row.release_status),
  };
  return normalized;
};

const toStoredPassportValue = (value) =>
  (Array.isArray(value) || (typeof value === "object" && value !== null))
    ? JSON.stringify(value)
    : value;

const normalizePassportRequestBody = (body = {}) => {
  const normalized = { ...body };
  if (normalized.passport_type === undefined && normalized.passportType !== undefined) {
    normalized.passport_type = normalized.passportType;
  }
  if (normalized.model_name === undefined && normalized.modelName !== undefined) {
    normalized.model_name = normalized.modelName;
  }
  if (normalized.product_id === undefined && normalized.productId !== undefined) {
    normalized.product_id = normalized.productId;
  }
  if (normalized.dpp_id === undefined) {
    if (normalized.dppId !== undefined) normalized.dpp_id = normalized.dppId;
  }
  delete normalized.passportType;
  delete normalized.modelName;
  delete normalized.productId;
  delete normalized.dppId;
  return normalized;
};

const normalizeProductIdValue = (value) =>
  typeof value === "string" ? value.trim() : "";

const generateProductIdValue = (dppId) =>
  `PID-${String(dppId || "").replace(/^dpp_/i, "").slice(0, 8)}`;

const FACILITY_FIELD_CANDIDATES = [
  "facility_id",
  "facilityId",
  "facility_identifier",
  "facilityIdentifier",
  "manufacturing_facility_id",
  "manufacturingFacilityId",
  "manufacturing_facility_identifier",
  "manufacturingFacilityIdentifier",
  "manufacturing_facility",
  "manufacturingFacility",
];

const extractExplicitFacilityId = (source) => {
  if (!source || typeof source !== "object") return null;
  for (const key of FACILITY_FIELD_CANDIDATES) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
};

// ─── COLUMN HELPERS ───────────────────────────────────────────────────────────

const getWritablePassportColumns = (data, excluded = SYSTEM_PASSPORT_FIELDS) =>
  Object.keys(data).filter((key) =>
    data[key] !== undefined &&
    !excluded.has(key) &&
    /^[a-z][a-z0-9_]+$/.test(key)
  );

const getStoredPassportValues = (keys, data) =>
  keys.map((key) => toStoredPassportValue(data[key]));

// ─── PATH / URL BUILDERS ──────────────────────────────────────────────────────

const slugifyRouteSegment = (value, fallback = "item") => {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const slug = normalized
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return slug || fallback;
};

const buildCurrentPublicPassportPath = ({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  productId = "",
}) => {
  const resolvedProductId = normalizeProductIdValue(productId);
  if (!resolvedProductId) return null;
  const manufacturerSlug = slugifyRouteSegment(companyName || manufacturerName || manufacturedBy, "manufacturer");
  const modelSlug = slugifyRouteSegment(modelName || resolvedProductId, "product");
  return `/dpp/${manufacturerSlug}/${modelSlug}/${encodeURIComponent(resolvedProductId)}`;
};

const buildInactivePublicPassportPath = ({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  productId = "",
  versionNumber,
}) => {
  const resolvedProductId = normalizeProductIdValue(productId);
  if (!resolvedProductId || versionNumber === null || versionNumber === undefined || versionNumber === "") return null;
  const manufacturerSlug = slugifyRouteSegment(companyName || manufacturerName || manufacturedBy, "manufacturer");
  const modelSlug = slugifyRouteSegment(modelName || resolvedProductId, "product");
  return `/dpp/inactive/${manufacturerSlug}/${modelSlug}/${encodeURIComponent(resolvedProductId)}/${encodeURIComponent(versionNumber)}`;
};

const buildPreviewPassportPath = ({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  productId = "",
  fallbackDppId = "",
}) => {
  const routeKey = normalizeProductIdValue(productId) || String(fallbackDppId || "").trim();
  if (!routeKey) return null;
  const manufacturerSlug = slugifyRouteSegment(companyName || manufacturerName || manufacturedBy, "manufacturer");
  const modelSlug = slugifyRouteSegment(modelName || routeKey, "product");
  return `/dpp/preview/${manufacturerSlug}/${modelSlug}/${encodeURIComponent(routeKey)}`;
};

const decodePathSegment = (value) => {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
};

const inferFacilityStableId = (passport) => extractExplicitFacilityId(passport);

async function resolvePublicPathToSubjects({ pool, publicPath, getTable, didService }) {
  const rawPath = String(publicPath || "").trim();
  if (!rawPath) return null;

  let pathname = rawPath;
  try {
    pathname = new URL(rawPath, didService?.getPublicOrigin?.() || "http://localhost").pathname || rawPath;
  } catch {}

  const currentMatch = pathname.match(/^\/dpp\/([^/]+)\/([^/]+)\/([^/]+)$/i);
  const inactiveMatch = pathname.match(/^\/dpp\/inactive\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/i);
  const match = inactiveMatch || currentMatch;
  if (!match) return null;

  const manufacturerSlug = String(match[1] || "").toLowerCase();
  const modelSlug = String(match[2] || "").toLowerCase();
  const productId = normalizeProductIdValue(decodePathSegment(match[3]));
  const versionNumber = inactiveMatch ? Number.parseInt(decodePathSegment(match[4]), 10) : null;
  if (!productId) return null;

  const companyRows = await pool.query(
    `SELECT id, company_name, did_slug
     FROM companies
     ORDER BY id ASC`
  );

  const matchingCompanies = companyRows.rows.filter((company) => {
    const companySlug = String(company.did_slug || "").trim().toLowerCase();
    const nameSlug = slugifyRouteSegment(company.company_name || "", "manufacturer");
    return companySlug === manufacturerSlug || nameSlug === manufacturerSlug;
  });
  if (!matchingCompanies.length) return null;

  for (const company of matchingCompanies) {
    const registryRows = await pool.query(
      `SELECT dpp_id AS "dppId", passport_type
       FROM passport_registry
       WHERE company_id = $1
       ORDER BY created_at DESC`,
      [company.id]
    );

    for (const registryRow of registryRows.rows) {
      const tableName = getTable(registryRow.passport_type);
      try {
        const params = [company.id, productId];
        let versionClause = "";
        let statusClause = "release_status = 'released'";

        if (Number.isFinite(versionNumber)) {
          params.push(versionNumber);
          versionClause = ` AND version_number = $${params.length}`;
          statusClause = "release_status IN ('released', 'obsolete')";
        }

        const row = await pool.query(
          `SELECT dpp_id AS "dppId", lineage_id, company_id, product_id, model_name, granularity, release_status, version_number, *
           FROM ${tableName}
           WHERE company_id = $1
             AND product_id = $2
             AND deleted_at IS NULL
             AND ${statusClause}${versionClause}
           ORDER BY version_number DESC, updated_at DESC
           LIMIT 1`,
          params
        );
        const passport = row.rows[0];
        if (!passport) continue;

        const actualModelSlug = slugifyRouteSegment(passport.model_name || passport.product_id, "product");
        if (actualModelSlug !== modelSlug) continue;

        const stableId = didService.normalizeStableId(passport.lineage_id || passport.dppId);
        const granularity = didService.normalizeGranularity(passport.granularity || "model");
        const companySlug = didService.normalizeCompanySlug(company.did_slug || company.company_name || `company-${company.id}`);
        const facilityStableId = inferFacilityStableId(passport);

        return {
          passportDppId: passport.dppId,
          passportType: registryRow.passport_type,
          companyId: company.id,
          productDid: granularity === "item"
            ? didService.generateItemDid("battery", stableId)
            : didService.generateModelDid("battery", stableId),
          dppDid: didService.generateDppDid(granularity, stableId),
          companyDid: didService.generateCompanyDid(companySlug),
          facilityDid: facilityStableId ? didService.generateFacilityDid(facilityStableId) : null,
          granularity,
          canonicalPath: pathname,
        };
      } catch {
        continue;
      }
    }
  }

  return null;
}

// ─── HISTORY / DIFF HELPERS ───────────────────────────────────────────────────

const coerceBulkFieldValue = (fieldDef, rawValue) => {
  if (rawValue === null || rawValue === undefined) return rawValue;

  if (fieldDef?.type === "boolean") {
    if (typeof rawValue === "boolean") return rawValue;
    const normalized = String(rawValue).trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }

  if (fieldDef?.type === "table" && typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) return rawValue;
    try { return JSON.parse(trimmed); } catch { return rawValue; }
  }

  return rawValue;
};

const getHistoryFieldDefs = (typeRow) => {
  const baseFields = [
    { key: "model_name", label: "Model Name", type: "text" },
    { key: "product_id", label: "Serial Number", type: "text" },
  ];
  const schemaFields = (typeRow?.fields_json?.sections || [])
    .flatMap((section) => section.fields || [])
    .filter((field) => field?.key);
  const seen = new Set();
  return [...baseFields, ...schemaFields].filter((field) => {
    if (seen.has(field.key)) return false;
    seen.add(field.key);
    return true;
  });
};

const formatHistoryFieldValue = (fieldDef, rawValue) => {
  if (rawValue === null || rawValue === undefined || rawValue === "") return "—";
  if (fieldDef?.type === "boolean") return rawValue ? "Yes" : "No";
  if (fieldDef?.type === "file") return "File uploaded";
  if (fieldDef?.type === "symbol") return "Symbol updated";

  if (fieldDef?.type === "table") {
    let rows = rawValue;
    if (typeof rawValue === "string") {
      try { rows = JSON.parse(rawValue); } catch { rows = rawValue; }
    }
    if (Array.isArray(rows)) {
      const formatted = rows
        .map((row) => Array.isArray(row) ? row.filter(Boolean).join(" | ") : String(row || ""))
        .filter(Boolean)
        .join(" ; ");
      return formatted.length > 180 ? `${formatted.slice(0, 177)}...` : formatted || "—";
    }
  }

  if (typeof rawValue === "object") {
    const json = JSON.stringify(rawValue);
    return json.length > 180 ? `${json.slice(0, 177)}...` : json;
  }

  const text = String(rawValue);
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
};

const comparableHistoryFieldValue = (fieldDef, rawValue) => {
  if (rawValue === null || rawValue === undefined || rawValue === "") return "";
  if (fieldDef?.type === "boolean") return rawValue ? "true" : "false";

  if (fieldDef?.type === "table") {
    let rows = rawValue;
    if (typeof rawValue === "string") {
      try { rows = JSON.parse(rawValue); } catch { rows = rawValue; }
    }
    return Array.isArray(rows) || (typeof rows === "object" && rows !== null)
      ? JSON.stringify(rows)
      : String(rows);
  }

  return (Array.isArray(rawValue) || (typeof rawValue === "object" && rawValue !== null))
    ? JSON.stringify(rawValue)
    : String(rawValue).trim();
};

// ─── ASSET MANAGEMENT HELPERS ─────────────────────────────────────────────────

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getAssetFieldMap = (typeSchema) => {
  const map = new Map();
  [
    { key: "dppId",      label: "Passport DPP ID",  type: "text", system: true },
    { key: "product_id", label: "Serial Number",  type: "text", system: true },
    { key: "model_name", label: "Model Name",     type: "text", system: true },
  ].forEach((field) => map.set(field.key, field));
  (typeSchema?.schemaFields || []).forEach((field) => {
    if (field?.key) map.set(field.key, field);
  });
  return map;
};

const getValueAtPath = (value, pathExpression) => {
  if (!pathExpression) return value;
  return String(pathExpression)
    .split(".")
    .filter(Boolean)
    .reduce((acc, part) => {
      if (acc === undefined || acc === null) return undefined;
      const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, key, indexText] = arrayMatch;
        const next = key ? acc[key] : acc;
        return Array.isArray(next) ? next[Number(indexText)] : undefined;
      }
      return acc[part];
    }, value);
};

const normalizeAssetHeaders = (headers) => {
  if (!isPlainObject(headers)) return {};
  return Object.entries(headers).reduce((acc, [key, value]) => {
    if (!key) return acc;
    acc[String(key)] = typeof value === "string" ? value : JSON.stringify(value);
    return acc;
  }, {});
};

const coerceAssetFieldValue = (fieldDef, rawValue) => {
  if (rawValue === undefined) return { ok: false, error: "value is undefined" };
  if (rawValue === null || rawValue === "") return { ok: true, value: rawValue };

  const type = fieldDef?.type || "text";

  if (type === "boolean") {
    if (typeof rawValue === "boolean") return { ok: true, value: rawValue };
    const normalized = String(rawValue).trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return { ok: true, value: true };
    if (["false", "0", "no"].includes(normalized)) return { ok: true, value: false };
    return { ok: false, error: `Expected boolean for ${fieldDef?.label || fieldDef?.key}` };
  }

  if (type === "table") {
    if (Array.isArray(rawValue)) return { ok: true, value: rawValue };
    if (typeof rawValue === "string") {
      try {
        const parsed = JSON.parse(rawValue);
        if (Array.isArray(parsed)) return { ok: true, value: parsed };
      } catch {}
    }
    return { ok: false, error: `Expected JSON array for ${fieldDef?.label || fieldDef?.key}` };
  }

  if (type === "date") {
    const date = new Date(rawValue);
    if (Number.isNaN(date.getTime())) {
      return { ok: false, error: `Expected a valid date for ${fieldDef?.label || fieldDef?.key}` };
    }
    return { ok: true, value: date.toISOString().slice(0, 10) };
  }

  if ((type === "file" || type === "symbol") && typeof rawValue === "object") {
    return { ok: false, error: `Expected a file URL string for ${fieldDef?.label || fieldDef?.key}` };
  }

  if (Array.isArray(rawValue) || typeof rawValue === "object") {
    return { ok: false, error: `Expected a primitive value for ${fieldDef?.label || fieldDef?.key}` };
  }

  return { ok: true, value: String(rawValue) };
};

const toDynamicStoredValue = (value) => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return String(value);
};

module.exports = {
  IN_REVISION_STATUS,
  LEGACY_IN_REVISION_STATUS,
  SYSTEM_PASSPORT_FIELDS,
  EDITABLE_PASSPORT_STATUSES,
  getTable,
  normalizeReleaseStatus,
  isPublicHistoryStatus,
  isEditablePassportStatus,
  normalizePassportRow,
  toStoredPassportValue,
  normalizePassportRequestBody,
  normalizeProductIdValue,
  generateProductIdValue,
  extractExplicitFacilityId,
  getWritablePassportColumns,
  getStoredPassportValues,
  slugifyRouteSegment,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  buildPreviewPassportPath,
  resolvePublicPathToSubjects,
  coerceBulkFieldValue,
  getHistoryFieldDefs,
  formatHistoryFieldValue,
  comparableHistoryFieldValue,
  isPlainObject,
  getAssetFieldMap,
  getValueAtPath,
  normalizeAssetHeaders,
  coerceAssetFieldValue,
  toDynamicStoredValue,
};
