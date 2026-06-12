"use strict";

const { rewriteRepositoryLinksDeep } = require("../repository/repository-file-links");

const IN_REVISION_STATUS = "in_revision";

const SYSTEM_PASSPORT_FIELDS = new Set([
  "id",
  "dppId",
  "lineageId",
  "companyId",
  "createdBy",
  "createdAt",
  "passportType",
  "versionNumber",
  "releaseStatus",
  "deletedAt",
  "qrCode",
  "carrierAuthenticity",
  "carrierSecurityStatus",
  "carrierAuthenticationMethod",
  "carrierVerificationInstructions",
  "signedCarrierPayload",
  "issuerCertificateId",
  "carrierCompatibilityProfiles",
  "physicalCarrierSecurityFeatures",
  "trustedViewerOrigin",
  "trustedViewerHost",
  "counterfeitRiskLevel",
  "antiCounterfeitInstructions",
  "safetyWarnings",
  "qrPrintSpecification",
  "signCarrierPayload",
  "createdByEmail",
  "firstName",
  "lastName",
  "updatedBy",
  "updatedAt",
]);

const EDITABLE_PASSPORT_STATUSES = new Set(["draft", IN_REVISION_STATUS]);

const toStorageSlug = (typeName) =>
  String(typeName || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

const getTable = (typeName) => {
  if (!typeName) throw new Error("typeName is required for table lookup");
  const safe = toStorageSlug(typeName);
  if (!safe) throw new Error("typeName must contain at least one alphanumeric character");
  return `${safe}_passports`;
};

const normalizeReleaseStatus = (status) => status;

const isPublicHistoryStatus = (status) => {
  const normalized = normalizeReleaseStatus(status);
  return normalized === "released" || normalized === "obsolete";
};

const isEditablePassportStatus = (status) =>
  EDITABLE_PASSPORT_STATUSES.has(normalizeReleaseStatus(status));

const extractSchemaFields = (schema) => {
  if (!schema || typeof schema !== "object") return [];
  if (Array.isArray(schema.schemaFields)) return schema.schemaFields.filter((field) => field?.key);
  if (Array.isArray(schema.sections)) {
    return schema.sections
      .flatMap((section) => Array.isArray(section?.fields) ? section.fields : [])
      .filter((field) => field?.key);
  }
  return [];
};

const mapCompanyRow = (row = {}) => ({
  id: row.id ?? null,
  companyName: row.companyName ?? "",
  companyLogo: row.companyLogo ?? null,
  didSlug: row.didSlug ?? null,
  economicOperatorIdentifier: row.economicOperatorIdentifier ?? null,
  economicOperatorIdentifierScheme: row.economicOperatorIdentifierScheme ?? null,
  customerTrustLevel: row.customerTrustLevel ?? null,
  dppGranularity: row.dppGranularity ?? row.defaultGranularity ?? "item",
  defaultGranularity: row.defaultGranularity ?? row.dppGranularity ?? "item",
  jsonldExportEnabled: row.jsonldExportEnabled ?? true,
  isActive: row.isActive ?? null,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

const mapCompanyFacilityRow = (row = {}) => ({
  id: row.id ?? null,
  companyId: row.companyId ?? null,
  facilityIdentifier: row.facilityIdentifier ?? "",
  identifierScheme: row.identifierScheme ?? "",
  displayName: row.displayName ?? null,
  metadataJson: row.metadataJson ?? {},
  isActive: row.isActive ?? true,
  createdBy: row.createdBy ?? null,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

const mapPassportTemplateFieldRow = (row = {}) => ({
  fieldKey: row.fieldKey ?? "",
  fieldValue: row.fieldValue ?? null,
  isModelData: row.isModelData ?? false,
});

const mapPassportTypeRow = (row = {}) => ({
  id: row.id ?? null,
  typeName: row.typeName ?? null,
  displayName: row.displayName ?? null,
  productCategory: row.productCategory ?? null,
  productIcon: row.productIcon ?? null,
  semanticModelKey: row.semanticModelKey ?? null,
  fieldsJson: row.fieldsJson ?? null,
  accessGranted: row.accessGranted ?? null,
  createdBy: row.createdBy ?? null,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

const quoteSqlIdentifier = (value) => {
  const identifier = String(value || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, "\"\"")}"`;
};

const joinQuotedSqlIdentifiers = (identifiers = []) =>
  identifiers.map((identifier) => quoteSqlIdentifier(identifier)).join(", ");

const getDisplayName = (rowData = {}) => {
  const explicitName = typeof rowData.createdByName === "string" ? rowData.createdByName.trim() : "";
  if (explicitName) return explicitName;

  const firstName = typeof rowData.firstName === "string" ? rowData.firstName.trim() : "";
  const lastName = typeof rowData.lastName === "string" ? rowData.lastName.trim() : "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  return null;
};

const normalizePassportRow = (row, schema) => {
  if (!row) return row;
  const dppId = row.dppId ?? null;
  const companyId = row.companyId ?? null;
  const schemaFields = extractSchemaFields(schema);

  // Deserialize JSONB fields
  let rowData = { ...row };

  if (schemaFields.length > 0) {
    const jsonbFields = new Set();
    schemaFields.forEach((field) => {
      if (field && field.key) {
        const storageType = String(field.storageType || field.valueType || "").trim().toLowerCase();
        if (field.type === "table" || field.repeated === true || field.structured === true || ["json", "jsonb", "object", "array"].includes(storageType)) {
          jsonbFields.add(field.key);
        }
      }
    });

    for (const key of jsonbFields) {
      if (typeof rowData[key] === "string" && rowData[key]) {
        try {
          rowData[key] = JSON.parse(rowData[key]);
        } catch {}
      }
    }
  } else {
    for (const [key, value] of Object.entries(rowData)) {
      if (typeof value === "string" && value && value.trim().startsWith("{")) {
        try {
          rowData[key] = JSON.parse(value);
        } catch {}
      } else if (typeof value === "string" && value && value.trim().startsWith("[")) {
        try {
          rowData[key] = JSON.parse(value);
        } catch {}
      }
    }
  }

  const normalized = rewriteRepositoryLinksDeep({
    ...rowData,
    dppId,
    companyId,
    lineageId: rowData.lineageId ?? null,
    passportType: rowData.passportType ?? null,
    modelName: rowData.modelName ?? null,
    internalAliasId: rowData.internalAliasId ?? null,
    uniqueProductIdentifier: rowData.uniqueProductIdentifier ?? null,
    productImage: rowData.productImage ?? null,
    complianceProfileKey: rowData.complianceProfileKey ?? null,
    contentSpecificationIds: rowData.contentSpecificationIds ?? null,
    carrierPolicyKey: rowData.carrierPolicyKey ?? null,
    carrierAuthenticity: rowData.carrierAuthenticity ?? null,
    economicOperatorId: rowData.economicOperatorId ?? null,
    economicOperatorIdentifierScheme: rowData.economicOperatorIdentifierScheme ?? null,
    facilityId: rowData.facilityId ?? null,
    releaseStatus: normalizeReleaseStatus(rowData.releaseStatus),
    versionNumber: rowData.versionNumber ?? null,
    qrCode: rowData.qrCode ?? null,
    createdBy: rowData.createdBy ?? null,
    createdByName: getDisplayName(rowData),
    updatedBy: rowData.updatedBy ?? null,
    createdAt: rowData.createdAt ?? null,
    updatedAt: rowData.updatedAt ?? null,
    deletedAt: rowData.deletedAt ?? null,
    carrierSecurityStatus: rowData.carrierSecurityStatus ?? null,
    carrierAuthenticationMethod: rowData.carrierAuthenticationMethod ?? null,
    carrierVerificationInstructions: rowData.carrierVerificationInstructions ?? null,
    signedCarrierPayload: rowData.signedCarrierPayload ?? null,
    issuerCertificateId: rowData.issuerCertificateId ?? null,
    carrierCompatibilityProfiles: rowData.carrierCompatibilityProfiles ?? null,
    physicalCarrierSecurityFeatures: rowData.physicalCarrierSecurityFeatures ?? null,
    trustedViewerOrigin: rowData.trustedViewerOrigin ?? null,
    trustedViewerHost: rowData.trustedViewerHost ?? null,
    counterfeitRiskLevel: rowData.counterfeitRiskLevel ?? null,
    antiCounterfeitInstructions: rowData.antiCounterfeitInstructions ?? null,
    safetyWarnings: rowData.safetyWarnings ?? null,
    qrPrintSpecification: rowData.qrPrintSpecification ?? null,
    signCarrierPayload: rowData.signCarrierPayload ?? null,
  }, {
    appBaseUrl: process.env.PUBLIC_APP_URL || process.env.APP_URL || process.env.SERVER_URL || "http://localhost:3001",
  });

  return normalized;
};

const getPassportFieldLookupKeys = (fieldKey) => {
  const exactKey = String(fieldKey || "").trim();
  return exactKey ? [exactKey] : [];
};

const getPassportFieldValue = (passport, fieldKey) => {
  if (!passport || !fieldKey) return undefined;
  for (const lookupKey of getPassportFieldLookupKeys(fieldKey)) {
    if (Object.prototype.hasOwnProperty.call(passport, lookupKey)) {
      return passport[lookupKey];
    }
  }
  return undefined;
};

const toStoredPassportValue = (value) =>
  (Array.isArray(value) || (typeof value === "object" && value !== null))
    ? JSON.stringify(value)
    : value;

const normalizePassportRequestBody = (body = {}) => {
  return { ...body };
};

const normalizeInternalAliasIdValue = (value) =>
  typeof value === "string" ? value.trim() : "";

const INTERNAL_ALIAS_REQUEST_ARRAY_KEYS = [
  "internalAliasId",
  "internalAliasIds",
  "productIdentifiers",
];

const collectRequestedInternalAliasIds = (body = {}) => {
  for (const key of INTERNAL_ALIAS_REQUEST_ARRAY_KEYS) {
    const candidate = body?.[key];
    if (!Array.isArray(candidate)) continue;
    return candidate
      .map((value) => {
        const normalized = normalizeInternalAliasIdValue(String(value ?? ""));
        try {
          return decodeURIComponent(normalized);
        } catch {
          return normalized;
        }
      })
      .filter(Boolean);
  }
  return [];
};

const generateInternalAliasIdValue = (dppId) =>
  String(dppId || "").trim();

const FACILITY_FIELD_CANDIDATES = [
  "facilityId",
  "manufacturingFacilityId",
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

const getWritablePassportColumns = (data, excluded = SYSTEM_PASSPORT_FIELDS) =>
  Object.keys(data).filter((key) =>
    data[key] !== undefined &&
    !excluded.has(key) &&
    /^[a-z][A-Za-z0-9_]*$/.test(key)
  );

const getStoredPassportValues = (keys, data) =>
  keys.map((key) => toStoredPassportValue(data[key]));

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
  internalAliasId = "",
}) => {
  const resolvedProductId = normalizeInternalAliasIdValue(internalAliasId);
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
  internalAliasId = "",
  versionNumber,
}) => {
  const resolvedProductId = normalizeInternalAliasIdValue(internalAliasId);
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
  internalAliasId = "",
  fallbackDppId = "",
}) => {
  const routeKey = normalizeInternalAliasIdValue(internalAliasId) || String(fallbackDppId || "").trim();
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
  const internalAliasId = normalizeInternalAliasIdValue(decodePathSegment(match[3]));
  const versionNumber = inactiveMatch ? Number.parseInt(decodePathSegment(match[4]), 10) : null;
  if (!internalAliasId) return null;

  const companyRows = await pool.query(
    `SELECT id,
            company_name AS "companyName",
            did_slug AS "didSlug"
     FROM companies
     ORDER BY id ASC`
  );

  const matchingCompanies = companyRows.rows.filter((company) => {
    const companySlug = String(company.didSlug || "").trim().toLowerCase();
    const nameSlug = slugifyRouteSegment(company.companyName || "", "manufacturer");
    return companySlug === manufacturerSlug || nameSlug === manufacturerSlug;
  });
  if (!matchingCompanies.length) return null;

  for (const company of matchingCompanies) {
    const registryRows = await pool.query(
      `SELECT "dppId", "passportType"
       FROM passport_registry
       WHERE "companyId" = $1
       ORDER BY "createdAt" DESC`,
      [company.id]
    );

    for (const registryRow of registryRows.rows) {
      const tableName = getTable(registryRow.passportType);
      try {
        const params = [company.id, internalAliasId];
        let versionClause = "";
        let statusClause = `"releaseStatus" = 'released'`;

        if (Number.isFinite(versionNumber)) {
          params.push(versionNumber);
          versionClause = ` AND "versionNumber" = $${params.length}`;
          statusClause = `"releaseStatus" IN ('released', 'obsolete')`;
        }

        const row = await pool.query(
          `SELECT *
           FROM ${tableName}
           WHERE "companyId" = $1
             AND "internalAliasId" = $2
             AND "deletedAt" IS NULL
             AND ${statusClause}${versionClause}
           ORDER BY "versionNumber" DESC, "updatedAt" DESC
           LIMIT 1`,
          params
        );
        const passport = normalizePassportRow(row.rows[0]);
        if (!passport) continue;

        const actualModelSlug = slugifyRouteSegment(passport.modelName || passport.internalAliasId, "product");
        if (actualModelSlug !== modelSlug) continue;

        const stableId = didService.normalizeStableId(passport.lineageId || passport.dppId);
        const granularity = didService.normalizeGranularity(passport.granularity || "model");
        const companySlug = didService.normalizeCompanySlug(company.companyName || company.didSlug || `company-${company.id}`);
        const facilityStableId = inferFacilityStableId(passport);

        const subjectNamespace = didService.normalizePassportTypeSegment(company.companyName || company.didSlug || "passport");
        return {
          passportDppId: passport.dppId,
          passportType: registryRow.passportType,
          companyId: company.id,
          productDid: granularity === "item"
            ? didService.generateItemDid(subjectNamespace, stableId)
            : granularity === "batch"
              ? didService.generateBatchDid(subjectNamespace, stableId)
              : didService.generateModelDid(subjectNamespace, stableId),
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
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
        return parsed;
      }
    } catch {
      // Fall through to the explicit table-shape error below.
    }
    throw new Error(`Expected table rows as a JSON array of objects for ${fieldDef?.label || fieldDef?.key}`);
  }

  if (fieldDef?.type === "table" && Array.isArray(rawValue)) {
    if (rawValue.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      return rawValue;
    }
    throw new Error(`Expected table rows as objects for ${fieldDef?.label || fieldDef?.key}`);
  }

  return rawValue;
};

const getHistoryFieldDefs = (typeRow) => {
  const baseFields = [
    { key: "modelName", label: "Model Name", type: "text" },
    { key: "internalAliasId", label: "Internal Alias ID", type: "text" },
  ];
  const schemaFields = (typeRow?.fieldsJson?.sections || [])
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
        .map((row) => row && typeof row === "object" && !Array.isArray(row)
          ? Object.values(row).filter(Boolean).join(" | ")
          : "")
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

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getAssetFieldMap = (typeSchema) => {
  const map = new Map();
  [
    { key: "dppId", label: "Passport DPP ID", type: "text", system: true },
    { key: "internalAliasId", label: "Internal Alias ID", type: "text", system: true },
    { key: "modelName", label: "Model Name", type: "text", system: true },
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
    if (Array.isArray(rawValue)) {
      const isRowObjectArray = rawValue.every((row) => row && typeof row === "object" && !Array.isArray(row));
      return isRowObjectArray
        ? { ok: true, value: rawValue }
        : { ok: false, error: `Expected table rows as objects for ${fieldDef?.label || fieldDef?.key}` };
    }
    if (typeof rawValue === "string") {
      try {
        const parsed = JSON.parse(rawValue);
        if (Array.isArray(parsed) && parsed.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
          return { ok: true, value: parsed };
        }
      } catch {}
    }
    return { ok: false, error: `Expected table rows as a JSON array of objects for ${fieldDef?.label || fieldDef?.key}` };
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
  SYSTEM_PASSPORT_FIELDS,
  EDITABLE_PASSPORT_STATUSES,
  getTable,
  normalizeReleaseStatus,
  isPublicHistoryStatus,
  isEditablePassportStatus,
  normalizePassportRow,
  toStoredPassportValue,
  normalizePassportRequestBody,
  normalizeInternalAliasIdValue,
  collectRequestedInternalAliasIds,
  generateInternalAliasIdValue,
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
  extractSchemaFields,
  mapCompanyRow,
  mapCompanyFacilityRow,
  mapPassportTemplateFieldRow,
  mapPassportTypeRow,
  quoteSqlIdentifier,
  joinQuotedSqlIdentifiers,
  getPassportFieldLookupKeys,
  getPassportFieldValue,
  getAssetFieldMap,
  getValueAtPath,
  normalizeAssetHeaders,
  coerceAssetFieldValue,
  toDynamicStoredValue,
};
