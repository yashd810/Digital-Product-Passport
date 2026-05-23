"use strict";

const { rewriteLegacyRepositoryLinksDeep } = require("../repository/repository-file-links");

const IN_REVISION_STATUS = "in_revision";

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
  "carrier_authenticity",
  "carrier_security_status",
  "carrier_authentication_method",
  "carrier_verification_instructions",
  "signed_carrier_payload",
  "issuer_certificate_id",
  "carrier_compatibility_profiles",
  "physical_carrier_security_features",
  "trusted_viewer_origin",
  "trusted_viewer_host",
  "counterfeit_risk_level",
  "anti_counterfeit_instructions",
  "safety_warnings",
  "qr_print_specification",
  "sign_carrier_payload",
  "created_by_email",
  "first_name",
  "last_name",
  "updated_by",
  "updated_at",
]);

const EDITABLE_PASSPORT_STATUSES = new Set(["draft", IN_REVISION_STATUS]);

const getTable = (typeName) => {
  if (!typeName) throw new Error("typeName is required for table lookup");
  const safe = String(typeName).replace(/[^a-z0-9_]/g, "_");
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
  if (schema.fields_json && typeof schema.fields_json === "object") {
    return extractSchemaFields(schema.fields_json);
  }
  return [];
};

const normalizePassportRow = (row, schema) => {
  if (!row) return row;
  const dppId = row.dppId ?? row.dpp_id ?? null;
  const companyId = row.companyId ?? row.company_id ?? null;
  const schemaFields = extractSchemaFields(schema);
  
  // Deserialize JSONB fields
  let rowData = { ...row };
  
  // Build lowercase-to-camelCase key mapping from schema
  const lowercaseToSchemaKey = {};
  if (schemaFields.length > 0) {
    schemaFields.forEach((field) => {
      if (field && field.key) {
        const lowerKey = String(field.key).toLowerCase();
        lowercaseToSchemaKey[lowerKey] = field.key;
      }
    });
  }
  
  if (Object.keys(lowercaseToSchemaKey).length > 0) {
    const normalized = {};
    for (const [key, value] of Object.entries(rowData)) {
      const lowerKey = String(key).toLowerCase();
      const schemaKey = lowercaseToSchemaKey[lowerKey];
      if (schemaKey && schemaKey !== key) {
        normalized[schemaKey] = value;
      } else {
        normalized[key] = value;
      }
    }
    rowData = normalized;
  }
  
  if (schemaFields.length > 0) {
    const jsonbFields = new Set();
    schemaFields.forEach((field) => {
      if (field && field.key) {
        const storageType = String(field.storageType || field.storage_type || field.valueType || "").trim().toLowerCase();
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
  
  const normalized = rewriteLegacyRepositoryLinksDeep({
    ...rowData,
    dpp_id: rowData.dpp_id ?? dppId,
    dppId,
    company_id: rowData.company_id ?? companyId,
    companyId,
    release_status: normalizeReleaseStatus(rowData.release_status),
  }, {
    appBaseUrl: process.env.PUBLIC_APP_URL || process.env.APP_URL || process.env.SERVER_URL || "http://localhost:3001",
  });
  return normalized;
};

const toSnakeCaseFieldKey = (value) =>
  String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();

const toCompactFieldKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const getPassportFieldLookupKeys = (fieldKey) => {
  const exactKey = String(fieldKey || "").trim();
  if (!exactKey) return [];
  return [...new Set([
    exactKey,
    exactKey.toLowerCase(),
    toSnakeCaseFieldKey(exactKey),
    toCompactFieldKey(exactKey),
  ].filter(Boolean))];
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
  const normalized = { ...body };
  if (normalized.passport_type === undefined && normalized.passportType !== undefined) {
    normalized.passport_type = normalized.passportType;
  }
  if (normalized.model_name === undefined && normalized.modelName !== undefined) {
    normalized.model_name = normalized.modelName;
  }
  if (normalized.internal_alias_id === undefined) {
    if (normalized.internalAliasId !== undefined) normalized.internal_alias_id = normalized.internalAliasId;
    else if (normalized.product_id !== undefined) normalized.internal_alias_id = normalized.product_id;
    else if (normalized.productId !== undefined) normalized.internal_alias_id = normalized.productId;
    else if (normalized.localProductId !== undefined) normalized.internal_alias_id = normalized.localProductId;
  }
  if (normalized.product_identifier_did === undefined) {
    if (normalized.uniqueProductIdentifier !== undefined) normalized.product_identifier_did = normalized.uniqueProductIdentifier;
    else if (normalized.unique_product_identifier !== undefined) normalized.product_identifier_did = normalized.unique_product_identifier;
  }
  if (normalized.serial_number === undefined) {
    if (normalized.product_serial_number !== undefined) normalized.serial_number = normalized.product_serial_number;
    else if (normalized.battery_serial_number !== undefined) normalized.serial_number = normalized.battery_serial_number;
    else if (normalized.serialNumber !== undefined) normalized.serial_number = normalized.serialNumber;
    else if (normalized.serial !== undefined) normalized.serial_number = normalized.serial;
    else if (normalized.batterySerialNumber !== undefined) normalized.serial_number = normalized.batterySerialNumber;
    else if (normalized.productSerialNumber !== undefined) normalized.serial_number = normalized.productSerialNumber;
  }
  if (normalized.battery_serial_number === undefined && normalized.serial_number !== undefined) {
    normalized.battery_serial_number = normalized.serial_number;
  }
  if (normalized.economic_operator_id === undefined && normalized.economicOperatorId !== undefined) {
    normalized.economic_operator_id = normalized.economicOperatorId;
  }
  if (normalized.economic_operator_identifier_scheme === undefined) {
    if (normalized.economicOperatorIdentifierScheme !== undefined) {
      normalized.economic_operator_identifier_scheme = normalized.economicOperatorIdentifierScheme;
    } else if (normalized.operatorIdentifierScheme !== undefined) {
      normalized.economic_operator_identifier_scheme = normalized.operatorIdentifierScheme;
    }
  }
  if (normalized.facility_id === undefined && normalized.facilityId !== undefined) {
    normalized.facility_id = normalized.facilityId;
  }
  if (normalized.dpp_id === undefined) {
    if (normalized.dppId !== undefined) normalized.dpp_id = normalized.dppId;
  }
  if (normalized.carrier_authenticity === undefined && normalized.carrierAuthenticity !== undefined) {
    normalized.carrier_authenticity = normalized.carrierAuthenticity;
  }
  if (normalized.carrier_security_status === undefined && normalized.carrierSecurityStatus !== undefined) {
    normalized.carrier_security_status = normalized.carrierSecurityStatus;
  }
  if (normalized.carrier_authentication_method === undefined && normalized.carrierAuthenticationMethod !== undefined) {
    normalized.carrier_authentication_method = normalized.carrierAuthenticationMethod;
  }
  if (normalized.carrier_verification_instructions === undefined && normalized.carrierVerificationInstructions !== undefined) {
    normalized.carrier_verification_instructions = normalized.carrierVerificationInstructions;
  }
  if (normalized.signed_carrier_payload === undefined && normalized.signedCarrierPayload !== undefined) {
    normalized.signed_carrier_payload = normalized.signedCarrierPayload;
  }
  if (normalized.issuer_certificate_id === undefined && normalized.issuerCertificateId !== undefined) {
    normalized.issuer_certificate_id = normalized.issuerCertificateId;
  }
  if (normalized.carrier_compatibility_profiles === undefined && normalized.carrierCompatibilityProfiles !== undefined) {
    normalized.carrier_compatibility_profiles = normalized.carrierCompatibilityProfiles;
  }
  if (normalized.physical_carrier_security_features === undefined && normalized.physicalCarrierSecurityFeatures !== undefined) {
    normalized.physical_carrier_security_features = normalized.physicalCarrierSecurityFeatures;
  }
  if (normalized.trusted_viewer_origin === undefined && normalized.trustedViewerOrigin !== undefined) {
    normalized.trusted_viewer_origin = normalized.trustedViewerOrigin;
  }
  if (normalized.trusted_viewer_host === undefined && normalized.trustedViewerHost !== undefined) {
    normalized.trusted_viewer_host = normalized.trustedViewerHost;
  }
  if (normalized.counterfeit_risk_level === undefined && normalized.counterfeitRiskLevel !== undefined) {
    normalized.counterfeit_risk_level = normalized.counterfeitRiskLevel;
  }
  if (normalized.anti_counterfeit_instructions === undefined && normalized.antiCounterfeitInstructions !== undefined) {
    normalized.anti_counterfeit_instructions = normalized.antiCounterfeitInstructions;
  }
  if (normalized.safety_warnings === undefined && normalized.safetyWarnings !== undefined) {
    normalized.safety_warnings = normalized.safetyWarnings;
  }
  if (normalized.qr_print_specification === undefined && normalized.qrPrintSpecification !== undefined) {
    normalized.qr_print_specification = normalized.qrPrintSpecification;
  }
  if (normalized.sign_carrier_payload === undefined && normalized.signCarrierPayload !== undefined) {
    normalized.sign_carrier_payload = normalized.signCarrierPayload;
  }
  delete normalized.passportType;
  delete normalized.modelName;
  delete normalized.internalAliasId;
  delete normalized.product_id;
  delete normalized.productId;
  delete normalized.localProductId;
  delete normalized.uniqueProductIdentifier;
  delete normalized.unique_product_identifier;
  delete normalized.economicOperatorId;
  delete normalized.economicOperatorIdentifierScheme;
  delete normalized.operatorIdentifierScheme;
  delete normalized.facilityId;
  delete normalized.dppId;
  delete normalized.carrierAuthenticity;
  delete normalized.carrierSecurityStatus;
  delete normalized.carrierAuthenticationMethod;
  delete normalized.carrierVerificationInstructions;
  delete normalized.signedCarrierPayload;
  delete normalized.issuerCertificateId;
  delete normalized.carrierCompatibilityProfiles;
  delete normalized.physicalCarrierSecurityFeatures;
  delete normalized.trustedViewerOrigin;
  delete normalized.trustedViewerHost;
  delete normalized.counterfeitRiskLevel;
  delete normalized.antiCounterfeitInstructions;
  delete normalized.safetyWarnings;
  delete normalized.qrPrintSpecification;
  delete normalized.signCarrierPayload;
  return normalized;
};

const normalizeInternalAliasIdValue = (value) =>
  typeof value === "string" ? value.trim() : "";

const INTERNAL_ALIAS_REQUEST_ARRAY_KEYS = [
  "internalAliasId",
  "internalAliasIds",
  "localProductId",
  "localProductIds",
  "productId",
  "productIds",
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

const addLegacyInternalAliasAliases = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const internalAliasId = payload.internalAliasId ?? payload.internal_alias_id ?? null;
  if (!internalAliasId) return payload;
  return {
    ...payload,
    ...(payload.localProductId === undefined ? { localProductId: internalAliasId } : {}),
    ...(payload.productId === undefined ? { productId: internalAliasId } : {}),
  };
};

const generateInternalAliasIdValue = (dppId) =>
  String(dppId || "").trim();

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
        const params = [company.id, internalAliasId];
        let versionClause = "";
        let statusClause = "release_status = 'released'";

        if (Number.isFinite(versionNumber)) {
          params.push(versionNumber);
          versionClause = ` AND version_number = $${params.length}`;
          statusClause = "release_status IN ('released', 'obsolete')";
        }

        const row = await pool.query(
          `SELECT dpp_id AS "dppId", lineage_id, company_id, internal_alias_id, model_name, granularity, release_status, version_number, *
           FROM ${tableName}
           WHERE company_id = $1
             AND internal_alias_id = $2
             AND deleted_at IS NULL
             AND ${statusClause}${versionClause}
           ORDER BY version_number DESC, updated_at DESC
           LIMIT 1`,
          params
        );
        const passport = row.rows[0];
        if (!passport) continue;

        const actualModelSlug = slugifyRouteSegment(passport.model_name || passport.internal_alias_id, "product");
        if (actualModelSlug !== modelSlug) continue;

        const stableId = didService.normalizeStableId(passport.lineage_id || passport.dppId);
        const granularity = didService.normalizeGranularity(passport.granularity || "model");
        const companySlug = didService.normalizeCompanySlug(company.company_name || company.did_slug || `company-${company.id}`);
        const facilityStableId = inferFacilityStableId(passport);

        const subjectNamespace = didService.normalizePassportTypeSegment(company.company_name || company.did_slug || "battery");
        return {
          passportDppId: passport.dppId,
          passportType: registryRow.passport_type,
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
    try { return JSON.parse(trimmed); } catch { return rawValue; }
  }

  return rawValue;
};

const getHistoryFieldDefs = (typeRow) => {
  const baseFields = [
    { key: "model_name", label: "Model Name", type: "text" },
    { key: "internal_alias_id", label: "Internal Alias ID", type: "text" },
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
    if (rows && typeof rows === "object" && !Array.isArray(rows)) {
      rows = Array.isArray(rows.rows) ? rows.rows : rows;
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

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getAssetFieldMap = (typeSchema) => {
  const map = new Map();
  [
    { key: "dppId", label: "Passport DPP ID", type: "text", system: true },
    { key: "internal_alias_id", label: "Internal Alias ID", type: "text", system: true },
    { key: "model_name", label: "Model Name", type: "text", system: true },
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
    if (rawValue && typeof rawValue === "object" && Array.isArray(rawValue.rows)) {
      return { ok: true, value: rawValue };
    }
    if (typeof rawValue === "string") {
      try {
        const parsed = JSON.parse(rawValue);
        if (Array.isArray(parsed)) return { ok: true, value: parsed };
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.rows)) return { ok: true, value: parsed };
      } catch {}
    }
    return { ok: false, error: `Expected table data for ${fieldDef?.label || fieldDef?.key}` };
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
  addLegacyInternalAliasAliases,
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
  getPassportFieldLookupKeys,
  getPassportFieldValue,
  getAssetFieldMap,
  getValueAtPath,
  normalizeAssetHeaders,
  coerceAssetFieldValue,
  toDynamicStoredValue,
};
