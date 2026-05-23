"use strict";

const { rewriteLegacyRepositoryLinksDeep } = require("../repository/repository-file-links");
const { SYSTEM_PASSPORT_COLUMN_MAPPINGS } = require("./system-passport-columns");

const IN_REVISION_STATUS = "in_revision";

const SYSTEM_PASSPORT_FIELDS = new Set([
  "id",
  "dppId",
  "lineageId",
  "companyId",
  "createdBy",
  "createdAt",
  "passportType",
  "passport_type",
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
  "created_by_email",
  "first_name",
  "last_name",
  "updatedBy",
  "updatedAt",
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

const quoteSqlIdentifier = (value) => {
  const identifier = String(value || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, "\"\"")}"`;
};

const joinQuotedSqlIdentifiers = (identifiers = []) =>
  identifiers.map((identifier) => quoteSqlIdentifier(identifier)).join(", ");

const LEGACY_PASSPORT_KEY_ALIASES = new Map([
  ["passport_type", "passportType"],
  ["model_name", "modelName"],
  ["internal_alias_id", "internalAliasId"],
  ["product_identifier_did", "uniqueProductIdentifier"],
  ["economic_operator_id", "economicOperatorId"],
  ["economic_operator_identifier_scheme", "economicOperatorIdentifierScheme"],
  ["facility_id", "facilityId"],
  ["dpp_id", "dppId"],
  ["carrier_authenticity", "carrierAuthenticity"],
  ["carrier_security_status", "carrierSecurityStatus"],
  ["carrier_authentication_method", "carrierAuthenticationMethod"],
  ["carrier_verification_instructions", "carrierVerificationInstructions"],
  ["signed_carrier_payload", "signedCarrierPayload"],
  ["issuer_certificate_id", "issuerCertificateId"],
  ["carrier_compatibility_profiles", "carrierCompatibilityProfiles"],
  ["physical_carrier_security_features", "physicalCarrierSecurityFeatures"],
  ["trusted_viewer_origin", "trustedViewerOrigin"],
  ["trusted_viewer_host", "trustedViewerHost"],
  ["counterfeit_risk_level", "counterfeitRiskLevel"],
  ["anti_counterfeit_instructions", "antiCounterfeitInstructions"],
  ["safety_warnings", "safetyWarnings"],
  ["qr_print_specification", "qrPrintSpecification"],
  ["sign_carrier_payload", "signCarrierPayload"],
]);

const LEGACY_PASSPORT_KEYS = new Set([
  "passport_type",
  ...SYSTEM_PASSPORT_COLUMN_MAPPINGS.map((item) => item.legacyKey).filter(Boolean),
  ...LEGACY_PASSPORT_KEY_ALIASES.keys(),
]);

const normalizePassportRow = (row, schema) => {
  if (!row) return row;
  const dppId = row.dppId ?? row.dpp_id ?? null;
  const companyId = row.companyId ?? row.company_id ?? null;
  const schemaFields = extractSchemaFields(schema);
  
  // Deserialize JSONB fields
  let rowData = { ...row };

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
  
  const normalizedSource = { ...rowData };
  for (const legacyKey of LEGACY_PASSPORT_KEYS) {
    delete normalizedSource[legacyKey];
  }

  const normalized = rewriteLegacyRepositoryLinksDeep({
    ...normalizedSource,
    dppId,
    companyId,
    lineageId: rowData.lineageId ?? rowData.lineage_id ?? null,
    passportType: rowData.passportType ?? rowData.passport_type ?? null,
    modelName: rowData.modelName ?? rowData.model_name ?? null,
    internalAliasId: rowData.internalAliasId ?? rowData.internal_alias_id ?? null,
    uniqueProductIdentifier: rowData.uniqueProductIdentifier ?? rowData.product_identifier_did ?? null,
    productImage: rowData.productImage ?? rowData.product_image ?? null,
    complianceProfileKey: rowData.complianceProfileKey ?? rowData.compliance_profile_key ?? null,
    contentSpecificationIds: rowData.contentSpecificationIds ?? rowData.content_specification_ids ?? null,
    carrierPolicyKey: rowData.carrierPolicyKey ?? rowData.carrier_policy_key ?? null,
    carrierAuthenticity: rowData.carrierAuthenticity ?? rowData.carrier_authenticity ?? null,
    economicOperatorId: rowData.economicOperatorId ?? rowData.economic_operator_id ?? null,
    economicOperatorIdentifierScheme: rowData.economicOperatorIdentifierScheme ?? rowData.economic_operator_identifier_scheme ?? null,
    facilityId: rowData.facilityId ?? rowData.facility_id ?? null,
    releaseStatus: normalizeReleaseStatus(rowData.releaseStatus ?? rowData.release_status),
    versionNumber: rowData.versionNumber ?? rowData.version_number ?? null,
    qrCode: rowData.qrCode ?? rowData.qr_code ?? null,
    createdBy: rowData.createdBy ?? rowData.created_by ?? null,
    updatedBy: rowData.updatedBy ?? rowData.updated_by ?? null,
    createdAt: rowData.createdAt ?? rowData.created_at ?? null,
    updatedAt: rowData.updatedAt ?? rowData.updated_at ?? null,
    deletedAt: rowData.deletedAt ?? rowData.deleted_at ?? null,
    carrierSecurityStatus: rowData.carrierSecurityStatus ?? rowData.carrier_security_status ?? null,
    carrierAuthenticationMethod: rowData.carrierAuthenticationMethod ?? rowData.carrier_authentication_method ?? null,
    carrierVerificationInstructions: rowData.carrierVerificationInstructions ?? rowData.carrier_verification_instructions ?? null,
    signedCarrierPayload: rowData.signedCarrierPayload ?? rowData.signed_carrier_payload ?? null,
    issuerCertificateId: rowData.issuerCertificateId ?? rowData.issuer_certificate_id ?? null,
    carrierCompatibilityProfiles: rowData.carrierCompatibilityProfiles ?? rowData.carrier_compatibility_profiles ?? null,
    physicalCarrierSecurityFeatures: rowData.physicalCarrierSecurityFeatures ?? rowData.physical_carrier_security_features ?? null,
    trustedViewerOrigin: rowData.trustedViewerOrigin ?? rowData.trusted_viewer_origin ?? null,
    trustedViewerHost: rowData.trustedViewerHost ?? rowData.trusted_viewer_host ?? null,
    counterfeitRiskLevel: rowData.counterfeitRiskLevel ?? rowData.counterfeit_risk_level ?? null,
    antiCounterfeitInstructions: rowData.antiCounterfeitInstructions ?? rowData.anti_counterfeit_instructions ?? null,
    safetyWarnings: rowData.safetyWarnings ?? rowData.safety_warnings ?? null,
    qrPrintSpecification: rowData.qrPrintSpecification ?? rowData.qr_print_specification ?? null,
    signCarrierPayload: rowData.signCarrierPayload ?? rowData.sign_carrier_payload ?? null,
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
  const normalized = { ...body };
  if (normalized.passportType === undefined && normalized.passport_type !== undefined) {
    normalized.passportType = normalized.passport_type;
  }
  if (normalized.passport_type === undefined && normalized.passportType !== undefined) {
    normalized.passport_type = normalized.passportType;
  }
  if (normalized.modelName === undefined && normalized.model_name !== undefined) {
    normalized.modelName = normalized.model_name;
  }
  if (normalized.model_name === undefined && normalized.modelName !== undefined) {
    normalized.model_name = normalized.modelName;
  }
  if (normalized.internalAliasId === undefined && normalized.internal_alias_id !== undefined) {
    normalized.internalAliasId = normalized.internal_alias_id;
  }
  if (normalized.internal_alias_id === undefined) {
    if (normalized.internalAliasId !== undefined) normalized.internal_alias_id = normalized.internalAliasId;
  }
  if (normalized.uniqueProductIdentifier === undefined && normalized.product_identifier_did !== undefined) {
    normalized.uniqueProductIdentifier = normalized.product_identifier_did;
  }
  if (normalized.product_identifier_did === undefined) {
    if (normalized.uniqueProductIdentifier !== undefined) normalized.product_identifier_did = normalized.uniqueProductIdentifier;
  }
  if (normalized.economicOperatorId === undefined && normalized.economic_operator_id !== undefined) {
    normalized.economicOperatorId = normalized.economic_operator_id;
  }
  if (normalized.economic_operator_id === undefined && normalized.economicOperatorId !== undefined) {
    normalized.economic_operator_id = normalized.economicOperatorId;
  }
  if (normalized.economicOperatorIdentifierScheme === undefined && normalized.economic_operator_identifier_scheme !== undefined) {
    normalized.economicOperatorIdentifierScheme = normalized.economic_operator_identifier_scheme;
  }
  if (normalized.economic_operator_identifier_scheme === undefined) {
    if (normalized.economicOperatorIdentifierScheme !== undefined) {
      normalized.economic_operator_identifier_scheme = normalized.economicOperatorIdentifierScheme;
    }
  }
  if (normalized.facilityId === undefined && normalized.facility_id !== undefined) {
    normalized.facilityId = normalized.facility_id;
  }
  if (normalized.facility_id === undefined && normalized.facilityId !== undefined) {
    normalized.facility_id = normalized.facilityId;
  }
  if (normalized.dppId === undefined && normalized.dpp_id !== undefined) {
    normalized.dppId = normalized.dpp_id;
  }
  if (normalized.dpp_id === undefined) {
    if (normalized.dppId !== undefined) normalized.dpp_id = normalized.dppId;
  }
  if (normalized.carrierAuthenticity === undefined && normalized.carrier_authenticity !== undefined) {
    normalized.carrierAuthenticity = normalized.carrier_authenticity;
  }
  if (normalized.carrier_authenticity === undefined && normalized.carrierAuthenticity !== undefined) {
    normalized.carrier_authenticity = normalized.carrierAuthenticity;
  }
  if (normalized.carrierSecurityStatus === undefined && normalized.carrier_security_status !== undefined) {
    normalized.carrierSecurityStatus = normalized.carrier_security_status;
  }
  if (normalized.carrier_security_status === undefined && normalized.carrierSecurityStatus !== undefined) {
    normalized.carrier_security_status = normalized.carrierSecurityStatus;
  }
  if (normalized.carrierAuthenticationMethod === undefined && normalized.carrier_authentication_method !== undefined) {
    normalized.carrierAuthenticationMethod = normalized.carrier_authentication_method;
  }
  if (normalized.carrier_authentication_method === undefined && normalized.carrierAuthenticationMethod !== undefined) {
    normalized.carrier_authentication_method = normalized.carrierAuthenticationMethod;
  }
  if (normalized.carrierVerificationInstructions === undefined && normalized.carrier_verification_instructions !== undefined) {
    normalized.carrierVerificationInstructions = normalized.carrier_verification_instructions;
  }
  if (normalized.carrier_verification_instructions === undefined && normalized.carrierVerificationInstructions !== undefined) {
    normalized.carrier_verification_instructions = normalized.carrierVerificationInstructions;
  }
  if (normalized.signedCarrierPayload === undefined && normalized.signed_carrier_payload !== undefined) {
    normalized.signedCarrierPayload = normalized.signed_carrier_payload;
  }
  if (normalized.signed_carrier_payload === undefined && normalized.signedCarrierPayload !== undefined) {
    normalized.signed_carrier_payload = normalized.signedCarrierPayload;
  }
  if (normalized.issuerCertificateId === undefined && normalized.issuer_certificate_id !== undefined) {
    normalized.issuerCertificateId = normalized.issuer_certificate_id;
  }
  if (normalized.issuer_certificate_id === undefined && normalized.issuerCertificateId !== undefined) {
    normalized.issuer_certificate_id = normalized.issuerCertificateId;
  }
  if (normalized.carrierCompatibilityProfiles === undefined && normalized.carrier_compatibility_profiles !== undefined) {
    normalized.carrierCompatibilityProfiles = normalized.carrier_compatibility_profiles;
  }
  if (normalized.carrier_compatibility_profiles === undefined && normalized.carrierCompatibilityProfiles !== undefined) {
    normalized.carrier_compatibility_profiles = normalized.carrierCompatibilityProfiles;
  }
  if (normalized.physicalCarrierSecurityFeatures === undefined && normalized.physical_carrier_security_features !== undefined) {
    normalized.physicalCarrierSecurityFeatures = normalized.physical_carrier_security_features;
  }
  if (normalized.physical_carrier_security_features === undefined && normalized.physicalCarrierSecurityFeatures !== undefined) {
    normalized.physical_carrier_security_features = normalized.physicalCarrierSecurityFeatures;
  }
  if (normalized.trustedViewerOrigin === undefined && normalized.trusted_viewer_origin !== undefined) {
    normalized.trustedViewerOrigin = normalized.trusted_viewer_origin;
  }
  if (normalized.trusted_viewer_origin === undefined && normalized.trustedViewerOrigin !== undefined) {
    normalized.trusted_viewer_origin = normalized.trustedViewerOrigin;
  }
  if (normalized.trustedViewerHost === undefined && normalized.trusted_viewer_host !== undefined) {
    normalized.trustedViewerHost = normalized.trusted_viewer_host;
  }
  if (normalized.trusted_viewer_host === undefined && normalized.trustedViewerHost !== undefined) {
    normalized.trusted_viewer_host = normalized.trustedViewerHost;
  }
  if (normalized.counterfeitRiskLevel === undefined && normalized.counterfeit_risk_level !== undefined) {
    normalized.counterfeitRiskLevel = normalized.counterfeit_risk_level;
  }
  if (normalized.counterfeit_risk_level === undefined && normalized.counterfeitRiskLevel !== undefined) {
    normalized.counterfeit_risk_level = normalized.counterfeitRiskLevel;
  }
  if (normalized.antiCounterfeitInstructions === undefined && normalized.anti_counterfeit_instructions !== undefined) {
    normalized.antiCounterfeitInstructions = normalized.anti_counterfeit_instructions;
  }
  if (normalized.anti_counterfeit_instructions === undefined && normalized.antiCounterfeitInstructions !== undefined) {
    normalized.anti_counterfeit_instructions = normalized.antiCounterfeitInstructions;
  }
  if (normalized.safetyWarnings === undefined && normalized.safety_warnings !== undefined) {
    normalized.safetyWarnings = normalized.safety_warnings;
  }
  if (normalized.safety_warnings === undefined && normalized.safetyWarnings !== undefined) {
    normalized.safety_warnings = normalized.safetyWarnings;
  }
  if (normalized.qrPrintSpecification === undefined && normalized.qr_print_specification !== undefined) {
    normalized.qrPrintSpecification = normalized.qr_print_specification;
  }
  if (normalized.qr_print_specification === undefined && normalized.qrPrintSpecification !== undefined) {
    normalized.qr_print_specification = normalized.qrPrintSpecification;
  }
  if (normalized.signCarrierPayload === undefined && normalized.sign_carrier_payload !== undefined) {
    normalized.signCarrierPayload = normalized.sign_carrier_payload;
  }
  if (normalized.sign_carrier_payload === undefined && normalized.signCarrierPayload !== undefined) {
    normalized.sign_carrier_payload = normalized.signCarrierPayload;
  }
  for (const [legacyKey, appKey] of LEGACY_PASSPORT_KEY_ALIASES.entries()) {
    if (normalized[appKey] === undefined && normalized[legacyKey] !== undefined) {
      normalized[appKey] = normalized[legacyKey];
    }
  }
  for (const legacyKey of LEGACY_PASSPORT_KEYS) {
    delete normalized[legacyKey];
  }
  return normalized;
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

const addLegacyInternalAliasAliases = (payload) => {
  return payload;
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
