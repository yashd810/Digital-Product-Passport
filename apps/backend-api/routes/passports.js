"use strict";

const logger = require("../services/logger");
const { generateDppRecordId } = require("../services/dpp-record-id");
const { recordSignedDppRelease } = require("../services/dpp-release-record-service");
const {
  extractCarrierAuthenticityMutation,
  applyCarrierAuthenticityMutation,
  buildCarrierAuthenticityResponseFields,
  normalizeCarrierAuthenticityMetadata,
  validateQrPrintSpecification,
} = require("../helpers/carrier-authenticity");
const registerApiKeyRoutes = require("../src/modules/passports/register-api-key-routes");
const registerAccessGrantRoutes = require("../src/modules/passports/register-access-grant-routes");
const registerAuditAnalyticsRoutes = require("../src/modules/passports/register-audit-analytics-routes");
const registerBackupRoutes = require("../src/modules/passports/register-backup-routes");
const registerCarrierSecurityRoutes = require("../src/modules/passports/register-carrier-security-routes");
const registerCompanyPassportReadRoutes = require("../src/modules/passports/register-company-passport-read-routes");
const registerBulkLifecycleRoutes = require("../src/modules/passports/register-bulk-lifecycle-routes");
const registerCreateRoutes = require("../src/modules/passports/register-create-routes");
const registerDeleteRoutes = require("../src/modules/passports/register-delete-routes");
const registerHistoryReadRoutes = require("../src/modules/passports/register-history-read-routes");
const registerLifecycleRoutes = require("../src/modules/passports/register-lifecycle-routes");
const registerPreviewManagementRoutes = require("../src/modules/passports/register-preview-management-routes");
const registerPublicApiV1Routes = require("../src/modules/passports/register-public-api-v1-routes");
const registerPassportSupportRoutes = require("../src/modules/passports/register-support-routes");
const registerUpdateRoutes = require("../src/modules/passports/register-update-routes");

module.exports = function registerPassportRoutes(app, {
  pool,
  fs,
  crypto,
  authenticateToken,
  checkCompanyAccess,
  checkCompanyAdmin,
  requireEditor,
  authenticateApiKey,
  requireApiKeyScope,
  publicReadRateLimit,
  apiKeyReadRateLimit,
  assetWriteRateLimit,
  upload,
  hashSecret,
  createAccessKeyMaterial,
  createDeviceKeyMaterial,
  // passport service helpers
  IN_REVISION_STATUSES_SQL,
  EDITABLE_RELEASE_STATUSES_SQL,
  REVISION_BLOCKING_STATUSES_SQL,
  EDIT_SESSION_TIMEOUT_HOURS,
  EDIT_SESSION_TIMEOUT_SQL,
  IN_REVISION_STATUS,
  SYSTEM_PASSPORT_FIELDS,
  // pure helpers from passport-helpers.js
  getTable,
  normalizePassportRow,
  normalizeReleaseStatus,
  isEditablePassportStatus,
  normalizeProductIdValue,
  generateProductIdValue,
  normalizePassportRequestBody,
  extractExplicitFacilityId,
  getWritablePassportColumns,
  getStoredPassportValues,
  toStoredPassportValue,
  coerceBulkFieldValue,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  buildPreviewPassportPath,
  isPublicHistoryStatus,
  // db helpers from passport-service.js
  logAudit,
  getPassportTypeSchema,
  findExistingPassportByProductId,
  getPassportLineageContext,
  getPassportVersionsByLineage,
  fetchCompanyPassportRecord,
  resolveCompanyPreviewPassport,
  archivePassportSnapshot,
  archivePassportSnapshots,
  updatePassportRowById,
  buildPassportVersionHistory,
  clearExpiredEditSessions,
  listActiveEditSessions,
  markOlderVersionsObsolete,
  verifyAuditLogChain,
  buildAuditLogRootSummary,
  listAuditLogAnchors,
  anchorAuditLogRoot,
  stripRestrictedFieldsForPublicView,
  getCompanyNameMap,
  queryTableStats,
  submitPassportToWorkflow,
  // signing service
  signPassport,
  signPortableDataConstruct,
  buildBatteryPassJsonExport,
  storageService,
  complianceService,
  accessRightsService,
  productIdentifierService,
  backupProviderService,
  buildExpandedPassportPayload
  ,
  createPassportTable = null
}) {
  const insertPassportRegistry = async ({
    client = pool,
    dppId: dppId,
    lineageId,
    companyId,
    passportType,
    accessKeyHash = null,
    accessKeyPrefix = null,
    accessKeyLastRotatedAt = null,
    deviceApiKeyHash = null,
    deviceApiKeyPrefix = null,
    deviceKeyLastRotatedAt = null
  }) => client.query(
    `INSERT INTO passport_registry
       (dpp_id, lineage_id, company_id, passport_type,
        access_key_hash, access_key_prefix, access_key_last_rotated_at,
        device_api_key_hash, device_api_key_prefix, device_key_last_rotated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (dpp_id) DO NOTHING`,
    [
    dppId,
    lineageId,
    companyId,
    passportType,
    accessKeyHash,
    accessKeyPrefix,
    accessKeyLastRotatedAt,
    deviceApiKeyHash,
    deviceApiKeyPrefix,
    deviceKeyLastRotatedAt]

  );

  const VALID_GRANULARITIES = new Set(["model", "batch", "item"]);
  const ALLOWED_API_KEY_SCOPES = new Set(["dpp:read", "dpp:update", "dpp:history:read", "dpp:element:read", "*"]);
  const API_KEY_PREFIX_LENGTH = 16;
  const ARCHIVED_HISTORY_REASON_SQL = `('before_archive_delete','before_bulk_archive_delete')`;
  const ARCHIVED_HISTORY_FILTER_SQL = `(snapshot_reason IS NULL OR snapshot_reason IN ${ARCHIVED_HISTORY_REASON_SQL})`;
  const API_KEY_ALLOWED_OPERATOR_TYPES = new Set(
    [...accessRightsService.VALID_AUDIENCES].filter((audience) => audience !== "consumers" && audience !== "legitimate_interest")
  );
  const API_KEY_ACCESS_MODES = new Set(["read", "update"]);
  const API_KEY_CONFIDENTIALITY_LEVELS = ["public", "restricted", "confidential", "trade_secret", "regulated"];
  const API_KEY_CONFIDENTIALITY_RANK = new Map(
    API_KEY_CONFIDENTIALITY_LEVELS.map((level, index) => [level, index])
  );
  const getActorIdentifier = (user) =>
    user?.actorIdentifier ||
    user?.globallyUniqueOperatorId ||
    user?.operatorIdentifier ||
    user?.economicOperatorId ||
    user?.email ||
    (user?.userId ? `user:${user.userId}` : null);

  function buildStoredProductIdentifiers({ companyId, passportType, productId, granularity }) {
    const normalized = productIdentifierService.normalizeProductIdentifiers({
      companyId,
      passportType,
      rawProductId: productId,
      granularity
    });
    return {
      product_id: normalized.productIdInput || null,
      product_identifier_did: normalized.productIdentifierDid || null
    };
  }

  async function hasReleasedLineageVersion({ tableName, lineageId, excludeDppId = null }) {
    const params = [lineageId];
    let excludeSql = "";
    if (excludeDppId) {
      params.push(excludeDppId);
      excludeSql = ` AND dpp_id <> $${params.length}`;
    }
    const result = await pool.query(
      `SELECT 1
       FROM ${tableName}
       WHERE lineage_id = $1
         AND release_status IN ('released', 'obsolete')
         AND deleted_at IS NULL${excludeSql}
       LIMIT 1`,
      params
    );
    return result.rows.length > 0;
  }

  function parseApiKeyScopes(scopes) {
    const normalized = Array.isArray(scopes) ?
    scopes.map((scope) => String(scope || "").trim()).filter(Boolean) :
    ["dpp:read"];
    const unique = [...new Set(normalized)];
    const invalid = unique.filter((scope) => !ALLOWED_API_KEY_SCOPES.has(scope));
    if (invalid.length) {
      const error = new Error(`Invalid API key scope(s): ${invalid.join(", ")}`);
      error.statusCode = 400;
      throw error;
    }
    return unique.length ? unique : ["dpp:read"];
  }

  function normalizeApiKeyOperatorType(value) {
    const normalized = String(value || "").trim();
    return normalized || "economic_operator";
  }

  function parseApiKeyOperatorType(value) {
    const operatorType = normalizeApiKeyOperatorType(value);
    if (!API_KEY_ALLOWED_OPERATOR_TYPES.has(operatorType)) {
      const error = new Error(`Invalid API key operator type "${operatorType}"`);
      error.statusCode = 400;
      throw error;
    }
    return operatorType;
  }

  function parseApiKeyAccessMode(value, scopes = []) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized) {
      if (!API_KEY_ACCESS_MODES.has(normalized)) {
        const error = new Error(`Invalid API key access mode "${normalized}"`);
        error.statusCode = 400;
        throw error;
      }
      return normalized;
    }
    return Array.isArray(scopes) && (scopes.includes("dpp:update") || scopes.includes("*")) ? "update" : "read";
  }

  function parseApiKeyMaxConfidentiality(value) {
    const normalized = String(value || "").trim().toLowerCase() || "regulated";
    if (!API_KEY_CONFIDENTIALITY_RANK.has(normalized)) {
      const error = new Error(`Invalid API key confidentiality level "${normalized}"`);
      error.statusCode = 400;
      throw error;
    }
    return normalized;
  }

  function buildApiKeyScopesForAccessMode(accessMode, requestedScopes = []) {
    const derived = new Set(parseApiKeyScopes(requestedScopes));
    derived.add("dpp:read");
    if (accessMode === "update") derived.add("dpp:update");
    return [...derived];
  }

  function flattenTypeFields(typeDef) {
    return (typeDef?.fields_json?.sections || []).flatMap((section) => section.fields || []);
  }

  function getApiKeyAudiences(apiKey) {
    return new Set(accessRightsService.expandAudienceAssignments([apiKey?.operatorType || "economic_operator"]));
  }

  function isConfidentialityAllowedForApiKey(fieldConfidentiality, maxConfidentiality) {
    const normalizedField = String(fieldConfidentiality || "public").trim().toLowerCase() || "public";
    const normalizedMax = String(maxConfidentiality || "regulated").trim().toLowerCase() || "regulated";
    const fieldRank = API_KEY_CONFIDENTIALITY_RANK.get(normalizedField);
    const maxRank = API_KEY_CONFIDENTIALITY_RANK.get(normalizedMax);
    if (fieldRank === undefined || maxRank === undefined) return false;
    return fieldRank <= maxRank;
  }

  function buildApiKeyFieldReadDecision(field, apiKey) {
    const access = Array.isArray(field?.access) && field.access.length ? field.access : ["public"];
    const confidentiality = String(field?.confidentiality || (access.includes("public") ? "public" : "restricted")).trim().toLowerCase() || "public";
    const audiences = getApiKeyAudiences(apiKey);
    const matchedAudience = access.find((audience) => audience === "public" || audiences.has(audience)) || null;
    const confidentialityAllowed = isConfidentialityAllowedForApiKey(confidentiality, apiKey?.maxConfidentiality);
    return {
      allowed: Boolean(matchedAudience) && confidentialityAllowed,
      matchedAudience,
      confidentiality,
      audiences: access,
    };
  }

  function buildApiKeyFieldWriteDecision(field, apiKey) {
    const updateAuthority = Array.isArray(field?.updateAuthority) && field.updateAuthority.length
      ? field.updateAuthority
      : (Array.isArray(field?.update_authority) && field.update_authority.length
        ? field.update_authority
        : ["economic_operator"]);
    const confidentiality = String(field?.confidentiality || "public").trim().toLowerCase() || "public";
    const audiences = getApiKeyAudiences(apiKey);
    const matchedAuthority = updateAuthority.find((audience) => audiences.has(audience)) || null;
    const confidentialityAllowed = isConfidentialityAllowedForApiKey(confidentiality, apiKey?.maxConfidentiality);
    return {
      allowed: apiKey?.accessMode === "update" && Boolean(matchedAuthority) && confidentialityAllowed,
      matchedAuthority,
      confidentiality,
      updateAuthority,
    };
  }

  function sanitizePassportForApiKey(passport, typeDef, apiKey) {
    if (!passport || !typeDef) return passport;
    const sanitized = { ...passport };
    for (const field of flattenTypeFields(typeDef)) {
      const decision = buildApiKeyFieldReadDecision(field, apiKey);
      if (!decision.allowed) {
        delete sanitized[field.key];
      }
    }
    return sanitized;
  }

  function buildApiKeyHashRecord(rawKey) {
    const keySalt = crypto.randomBytes(16).toString("hex");
    return {
      keyPrefix: String(rawKey || "").slice(0, API_KEY_PREFIX_LENGTH),
      keySalt,
      hashAlgorithm: "hmac_sha256",
      keyHash: crypto.createHmac("sha256", keySalt).update(String(rawKey || "")).digest("hex")
    };
  }

  async function getCompanyDppPolicy(companyId) {
    const result = await pool.query(
      `SELECT c.id,
              COALESCE(p.default_granularity, 'item') AS default_granularity,
              COALESCE(p.allow_granularity_override, false) AS allow_granularity_override,
              COALESCE(p.mint_model_dids, true) AS mint_model_dids,
              COALESCE(p.mint_item_dids, true) AS mint_item_dids,
              COALESCE(p.mint_facility_dids, false) AS mint_facility_dids,
              COALESCE(p.vc_issuance_enabled, true) AS vc_issuance_enabled,
              COALESCE(p.jsonld_export_enabled, true) AS jsonld_export_enabled,
              COALESCE(p.claros_battery_dictionary_enabled, true) AS claros_battery_dictionary_enabled
       FROM companies c
       LEFT JOIN company_dpp_policies p ON p.company_id = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  async function loadCompanyComplianceIdentity(companyId) {
    const result = await pool.query(
      `SELECT economic_operator_identifier, economic_operator_identifier_scheme
       FROM companies
       WHERE id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  async function resolveManagedFacilityId({ companyId, requestedFields = {} }) {
    const candidateFacilityId = extractExplicitFacilityId(requestedFields);
    if (!candidateFacilityId) {
      const defaultFacilityRes = await pool.query(
        `SELECT facility_identifier
         FROM company_facilities
         WHERE company_id = $1
           AND is_active = true
         ORDER BY updated_at DESC, id DESC`,
        [companyId]
      );
      if (defaultFacilityRes.rows.length === 1) {
        return defaultFacilityRes.rows[0].facility_identifier || null;
      }
      return null;
    }
    return candidateFacilityId;
  }

  function hasOwnValue(source, key) {
    return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
  }

  function hasExplicitFacilityOverride(source = {}) {
    return (
      hasOwnValue(source, "facility_id")
      || hasOwnValue(source, "facilityId")
      || hasOwnValue(source, "facility_identifier")
      || hasOwnValue(source, "facilityIdentifier")
      || hasOwnValue(source, "manufacturing_facility_id")
      || hasOwnValue(source, "manufacturingFacilityId")
      || hasOwnValue(source, "manufacturing_facility_identifier")
      || hasOwnValue(source, "manufacturingFacilityIdentifier")
      || hasOwnValue(source, "manufacturing_facility")
      || hasOwnValue(source, "manufacturingFacility")
    );
  }

  function serializeProfileDefaultValue(value) {
    if (Array.isArray(value)) return JSON.stringify(value);
    return value ?? null;
  }

  async function buildComplianceManagedFields({
    companyId,
    passportType,
    granularity,
    requestedFields = {},
    facilitySource = requestedFields,
    existingFields = null,
  }) {
    const profile = complianceService.resolveProfileMetadata({ passportType, granularity });
    const companyIdentity = await loadCompanyComplianceIdentity(companyId);
    let resolvedFacilityId = null;
    if (hasExplicitFacilityOverride(facilitySource)) {
      resolvedFacilityId = await resolveManagedFacilityId({ companyId, requestedFields: facilitySource });
    } else {
      resolvedFacilityId = extractExplicitFacilityId(existingFields);
      if (!resolvedFacilityId) {
        resolvedFacilityId = await resolveManagedFacilityId({ companyId, requestedFields: facilitySource });
      }
    }
    return {
      compliance_profile_key: profile.key,
      content_specification_ids: serializeProfileDefaultValue(
        requestedFields.content_specification_ids || profile.contentSpecificationIds
      ),
      carrier_policy_key: requestedFields.carrier_policy_key || profile.defaultCarrierPolicyKey || null,
      economic_operator_id: requestedFields.economic_operator_id || companyIdentity?.economic_operator_identifier || null,
      economic_operator_identifier_scheme:
        requestedFields.economic_operator_identifier_scheme
        || companyIdentity?.economic_operator_identifier_scheme
        || null,
      facility_id: resolvedFacilityId
    };
  }

  function buildCarrierAuthenticityStorageValue(value) {
    return value ? JSON.stringify(value) : null;
  }

  function buildPublicAccessUrl(pathname) {
    if (!pathname) return null;
    const origin = process.env.PUBLIC_ORIGIN || process.env.APP_URL || "http://localhost:3001";
    try {
      return new URL(pathname, origin).toString();
    } catch {
      return pathname;
    }
  }

  function buildPassportCarrierPublicPath(passport, companyName = "") {
    if (!passport) return null;

    if (normalizeReleaseStatus(passport.release_status) === "released") {
      return buildCurrentPublicPassportPath({
        companyName,
        modelName: passport.model_name,
        productId: passport.product_id,
      });
    }

    return buildPreviewPassportPath({
      companyName,
      modelName: passport.model_name,
      productId: passport.product_id,
      fallbackDppId: passport.dppId || passport.dpp_id,
    });
  }

  function getTrustedViewerOrigin() {
    return process.env.PUBLIC_APP_URL || process.env.PUBLIC_VIEWER_URL || process.env.APP_URL || "http://localhost:3000";
  }

  function getTrustedViewerHost() {
    try {
      return new URL(getTrustedViewerOrigin()).host;
    } catch {
      return "";
    }
  }

  function parseUrlHost(value) {
    try {
      return new URL(String(value || "")).host || "";
    } catch {
      return "";
    }
  }

  async function recordPassportSecurityEvent({
    dppId,
    companyId = null,
    eventType,
    severity = "info",
    source = "system",
    details = {},
  }) {
    if (!dppId || !eventType) return;
    await pool.query(
      `INSERT INTO passport_security_events
         (passport_dpp_id, company_id, event_type, severity, source, details)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [dppId, companyId, eventType, severity, source, JSON.stringify(details || {})]
    ).catch(() => {});
  }

  function normalizeEvidenceItems(value) {
    if (!value) return [];
    const items = Array.isArray(value) ? value : [value];
    return items
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return null;
        return Object.fromEntries(
          Object.entries(item)
            .filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && String(entryValue).trim() !== "")
            .map(([key, entryValue]) => [key, typeof entryValue === "string" ? entryValue.trim().slice(0, 1000) : entryValue])
        );
      })
      .filter((item) => item && Object.keys(item).length);
  }

  function buildDataCarrierVerificationRecord(source = {}, actor = {}) {
    const verifiedAt = source.verifiedAt || source.verified_at || new Date().toISOString();
    return {
      evidenceType: "physical_data_carrier_verification",
      verifiedAt,
      recordedAt: new Date().toISOString(),
      recordedBy: actor.userId || null,
      printGrade: String(source.printGrade || source.print_grade || "").trim().slice(0, 32) || null,
      gradingStandard: String(source.gradingStandard || source.grading_standard || "ISO/IEC 15415 or ISO/IEC 15416").trim().slice(0, 160),
      verifierDevice: String(source.verifierDevice || source.verifier_device || "").trim().slice(0, 160) || null,
      verifierSerialNumber: String(source.verifierSerialNumber || source.verifier_serial_number || "").trim().slice(0, 160) || null,
      labelSpecificationId: String(source.labelSpecificationId || source.label_specification_id || "").trim().slice(0, 160) || null,
      hriPlacement: String(source.hriPlacement || source.hri_placement || "").trim().slice(0, 80) || null,
      scannerTests: normalizeEvidenceItems(source.scannerTests || source.scanner_tests),
      durabilityTests: normalizeEvidenceItems(source.durabilityTests || source.durability_tests),
      placementChecks: normalizeEvidenceItems(source.placementChecks || source.placement_checks),
      evidenceUris: (Array.isArray(source.evidenceUris || source.evidence_uris) ? (source.evidenceUris || source.evidence_uris) : [source.evidenceUri || source.evidence_uri])
        .map((uri) => String(uri || "").trim().slice(0, 2000))
        .filter(Boolean),
      notes: String(source.notes || "").trim().slice(0, 2000) || null,
    };
  }

  async function maybeSignCarrierPayload({
    passport,
    companyName = "",
    metadata,
    forceSign = false,
  }) {
    if (!metadata) return metadata;
    const enrichedMetadata = {
      ...metadata,
      trustedViewerOrigin: metadata.trustedViewerOrigin || getTrustedViewerOrigin(),
      trustedViewerHost: metadata.trustedViewerHost || getTrustedViewerHost(),
      counterfeitRiskLevel: metadata.counterfeitRiskLevel || (String(passport?.granularity || "item").toLowerCase() === "item" ? "high" : "medium"),
      antiCounterfeitInstructions: metadata.antiCounterfeitInstructions || [
        "Only trust the QR code when it opens on the verified DPP viewer domain.",
        "Do not enter passwords or payment details on a public DPP page.",
        "Use the signature or certificate details to verify protected carriers when available.",
      ],
    };
    if (!forceSign && enrichedMetadata.signedCarrierPayload) return enrichedMetadata;
    if (typeof signPortableDataConstruct !== "function") return enrichedMetadata;

    const publicPath = buildPassportCarrierPublicPath(passport, companyName);
    const publicAccessUrl = buildPublicAccessUrl(publicPath);
    const dppId = passport?.dppId || passport?.dpp_id || null;
    const productId = passport?.product_id || null;
    const credential = await signPortableDataConstruct({
      type: "DataCarrierBindingCredential",
      id: `${publicAccessUrl || `urn:dpp:${dppId || "unknown"}` }#carrier-binding`,
      subjectId: `${publicAccessUrl || `urn:dpp:${dppId || "unknown"}` }#carrier`,
      payload: {
        digitalProductPassportId: dppId,
        uniqueProductIdentifier: productId,
        publicAccessUrl,
        carrierSecurityStatus: metadata.carrierSecurityStatus || null,
        carrierAuthenticationMethod: metadata.carrierAuthenticationMethod || null,
        carrierVerificationInstructions: metadata.carrierVerificationInstructions || null,
        carrierCompatibilityProfiles: enrichedMetadata.carrierCompatibilityProfiles || [],
        physicalCarrierSecurityFeatures: enrichedMetadata.physicalCarrierSecurityFeatures || [],
      },
      contexts: ["https://api.claros-dpp.online/contexts/dpp/v1"],
    });

    if (!credential) return enrichedMetadata;

    return {
      ...enrichedMetadata,
      issuerCertificateId: enrichedMetadata.issuerCertificateId || credential.trustMetadata?.issuerCertificateId || null,
      signedCarrierPayload: {
        format: "claros_dpp_carrier_binding_v1",
        dataHash: credential.dataHash,
        keyId: credential.keyId,
        signatureAlgorithm: credential.signatureAlgorithm,
        signedAt: credential.signedAt,
        credential: credential.document,
      },
    };
  }

  async function loadLatestLivePassport({ companyId, dppId: dppId, passportType, releaseStatusSql = null }) {
    const tableName = getTable(passportType);
    const result = await pool.query(
      `SELECT *
       FROM ${tableName}
       WHERE dpp_id = $1
         AND company_id = $2
         ${releaseStatusSql ? `AND release_status IN ${releaseStatusSql}` : ""}
         AND deleted_at IS NULL
       ORDER BY version_number DESC
       LIMIT 1`,
      [dppId, companyId]
    );
    return result.rows[0] || null;
  }

  async function evaluateCompliance(passport, passportType) {
    return complianceService.evaluatePassport(
      { ...normalizePassportRow(passport), passport_type: passportType },
      passportType
    );
  }

  async function reconcileManagedReleaseFields({ passport, companyId, passportType, userId }) {
    if (!passport) return passport;

    const typeSchema = await getPassportTypeSchema(passportType);
    if (!typeSchema) return passport;

    const nextFields = {};
    const effectiveGranularity = passport.granularity || "item";
    const normalizedProductId = normalizeProductIdValue(passport.product_id);

    if (normalizedProductId) {
      const storedProductIdentifiers = buildStoredProductIdentifiers({
        companyId,
        passportType: typeSchema.typeName,
        productId: normalizedProductId,
        granularity: effectiveGranularity,
      });
      if (storedProductIdentifiers.product_id && storedProductIdentifiers.product_id !== passport.product_id) {
        nextFields.product_id = storedProductIdentifiers.product_id;
      }
      if (storedProductIdentifiers.product_identifier_did !== passport.product_identifier_did) {
        nextFields.product_identifier_did = storedProductIdentifiers.product_identifier_did;
      }
    }

    const complianceManagedFields = await buildComplianceManagedFields({
      companyId,
      passportType: typeSchema.typeName,
      granularity: effectiveGranularity,
      requestedFields: passport,
      existingFields: passport,
    });

    if (complianceManagedFields.compliance_profile_key !== passport.compliance_profile_key) {
      nextFields.compliance_profile_key = complianceManagedFields.compliance_profile_key;
    }
    if (complianceManagedFields.content_specification_ids !== passport.content_specification_ids) {
      nextFields.content_specification_ids = complianceManagedFields.content_specification_ids;
    }
    if (complianceManagedFields.carrier_policy_key !== passport.carrier_policy_key) {
      nextFields.carrier_policy_key = complianceManagedFields.carrier_policy_key;
    }
    if (complianceManagedFields.economic_operator_id !== passport.economic_operator_id) {
      nextFields.economic_operator_id = complianceManagedFields.economic_operator_id;
    }
    if (complianceManagedFields.economic_operator_identifier_scheme !== passport.economic_operator_identifier_scheme) {
      nextFields.economic_operator_identifier_scheme = complianceManagedFields.economic_operator_identifier_scheme;
    }
    if (complianceManagedFields.facility_id !== passport.facility_id) {
      nextFields.facility_id = complianceManagedFields.facility_id;
    }

    const updateKeys = Object.keys(nextFields);
    if (!updateKeys.length) {
      return passport;
    }

    const updateResult = await updatePassportRowById({
      tableName: getTable(typeSchema.typeName),
      rowId: passport.id,
      userId,
      data: nextFields,
      includeUpdatedRow: true,
    });

    return updateResult.updatedRow || { ...passport, ...nextFields };
  }

  async function replicatePassportToBackup({
    passport,
    passportType = null,
    companyName = "",
    reason = "manual",
    snapshotScope = "released_current"
  }) {
    if (!backupProviderService || !passport?.dppId || !passport?.company_id) {
      return { success: true, skipped: true, reason: "BACKUP_SERVICE_UNAVAILABLE" };
    }

    const resolvedPassportType = passportType || passport.passport_type;
    if (!resolvedPassportType) {
      return { success: true, skipped: true, reason: "PASSPORT_TYPE_REQUIRED" };
    }

    const typeDef = await complianceService.loadPassportTypeDefinition(resolvedPassportType);
    const resolvedCompanyName = companyName ||
    (await getCompanyNameMap([passport.company_id])).get(String(passport.company_id)) ||
    "";

    return backupProviderService.replicatePassportSnapshot({
      passport: { ...normalizePassportRow(passport), passport_type: resolvedPassportType },
      typeDef,
      companyName: resolvedCompanyName,
      reason,
      snapshotScope
    });
  }

  async function replicateAccessControlEventToBackup({
    companyId,
    eventType,
    severity = "normal",
    actorUserId = null,
    actorIdentifier = null,
    affectedUserId = null,
    affectedApiKeyId = null,
    affectedGrantId = null,
    passportDppId = null,
    audience = null,
    elementIdPath = null,
    revocationMode = "standard",
    reason = null,
    metadata = {},
  }) {
    if (!backupProviderService || !companyId || !backupProviderService.replicateAccessControlEvent) {
      return { success: true, skipped: true, reason: "BACKUP_SERVICE_UNAVAILABLE" };
    }

    return backupProviderService.replicateAccessControlEvent({
      companyId,
      eventType,
      severity,
      actorUserId,
      actorIdentifier,
      affectedUserId,
      affectedApiKeyId,
      affectedGrantId,
      passportDppId,
      audience,
      elementIdPath,
      revocationMode,
      reason,
      metadata,
    });
  }

  async function replicateAuditAnchorToBackup({
    companyId,
    anchoredBy = null,
    actorIdentifier = null,
    anchor,
    summary
  }) {
    if (!backupProviderService || !companyId || !backupProviderService.replicateAuditAnchorEvent) {
      return { success: true, skipped: true, reason: "BACKUP_SERVICE_UNAVAILABLE" };
    }
    return backupProviderService.replicateAuditAnchorEvent({
      companyId,
      actorUserId: anchoredBy,
      actorIdentifier,
      anchor,
      summary
    });
  }

  function withAuditActorAliases(row) {
    if (!row || typeof row !== "object") return row;
    return {
      ...row,
      globallyUniqueOperatorId: row.actor_identifier || null,
      globallyUniqueOperatorIdentifier: row.actor_identifier || null,
    };
  }

  function isFullRepresentationRequest(value) {
    return String(value || "").trim().toLowerCase() === "full";
  }

  async function loadCompanySerializationContext(companyId) {
    const result = await pool.query(
      `SELECT c.id,
              c.company_name,
              c.did_slug,
              COALESCE(p.default_granularity, 'item') AS dpp_granularity,
              COALESCE(p.default_granularity, 'item') AS default_granularity
       FROM companies c
       LEFT JOIN company_dpp_policies p ON p.company_id = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  function resolveGranularityForCreate(companyPolicy, requestedGranularity) {
    const fallbackGranularity = String(companyPolicy?.default_granularity || "item").trim().toLowerCase();
    const normalizedRequested = requestedGranularity === undefined || requestedGranularity === null || requestedGranularity === "" ?
    null :
    String(requestedGranularity).trim().toLowerCase();

    if (normalizedRequested && !VALID_GRANULARITIES.has(normalizedRequested)) {
      const error = new Error("granularity must be one of: model, batch, item");
      error.statusCode = 400;
      throw error;
    }

    if (!companyPolicy) return normalizedRequested || fallbackGranularity;

    if (!companyPolicy.allow_granularity_override && normalizedRequested && normalizedRequested !== fallbackGranularity) {
      const error = new Error(`Granularity override is disabled for this company. The enforced value is "${fallbackGranularity}".`);
      error.statusCode = 403;
      throw error;
    }

    const effectiveGranularity = normalizedRequested && companyPolicy.allow_granularity_override ?
    normalizedRequested :
    fallbackGranularity;

    if (effectiveGranularity === "model" && companyPolicy.mint_model_dids === false) {
      const error = new Error("Model-level DIDs are disabled for this company policy.");
      error.statusCode = 400;
      throw error;
    }
    if ((effectiveGranularity === "item" || effectiveGranularity === "batch") && companyPolicy.mint_item_dids === false) {
      const error = new Error("Item-level DIDs are disabled for this company policy.");
      error.statusCode = 400;
      throw error;
    }

    return effectiveGranularity;
  }


  // ─── API KEY MANAGEMENT ────────────────────────────────────────────────────

  registerApiKeyRoutes(app, {
    pool,
    logger,
    authenticateToken,
    checkCompanyAdmin,
    logAudit,
    buildApiKeyHashRecord,
    buildApiKeyScopesForAccessMode,
    parseApiKeyAccessMode,
    parseApiKeyOperatorType,
    parseApiKeyMaxConfidentiality,
    replicateAccessControlEventToBackup,
  });

  registerPublicApiV1Routes(app, {
    pool,
    logger,
    authenticateApiKey,
    requireApiKeyScope,
    apiKeyReadRateLimit,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    getTable,
    normalizePassportRow,
    sanitizePassportForApiKey,
    flattenTypeFields,
    buildApiKeyFieldWriteDecision,
    archivePassportSnapshot,
    updatePassportRowById,
    logAudit,
    EDITABLE_RELEASE_STATUSES_SQL,
  });

  // ─── PASSPORT CRUD ─────────────────────────────────────────────────────────

  registerCreateRoutes(app, {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    generateDppRecordId,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    createPassportTable,
    getTable,
    normalizeProductIdValue,
    generateProductIdValue,
    getCompanyDppPolicy,
    resolveGranularityForCreate,
    buildStoredProductIdentifiers,
    buildComplianceManagedFields,
    findExistingPassportByProductId,
    normalizeReleaseStatus,
    SYSTEM_PASSPORT_FIELDS,
    getWritablePassportColumns,
    toStoredPassportValue,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    maybeSignCarrierPayload,
    buildCarrierAuthenticityStorageValue,
    getCompanyNameMap,
    insertPassportRegistry,
    logAudit,
    archivePassportSnapshot,
    getActorIdentifier,
  });

  registerCompanyPassportReadRoutes(app, {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    normalizePassportRequestBody,
    getTable,
    normalizePassportRow,
    normalizeReleaseStatus,
    normalizeProductIdValue,
    getPassportTypeSchema,
    fetchCompanyPassportRecord,
    buildBatteryPassJsonExport,
    buildExpandedPassportPayload,
    complianceService,
    productIdentifierService,
    isFullRepresentationRequest,
    loadCompanySerializationContext,
    IN_REVISION_STATUS,
    IN_REVISION_STATUSES_SQL,
    EDITABLE_RELEASE_STATUSES_SQL,
    ARCHIVED_HISTORY_FILTER_SQL,
  });

  registerPreviewManagementRoutes(app, {
    pool,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    createAccessKeyMaterial,
    EDIT_SESSION_TIMEOUT_HOURS,
    stripRestrictedFieldsForPublicView,
    getCompanyNameMap,
    resolveCompanyPreviewPassport,
    clearExpiredEditSessions,
    listActiveEditSessions,
    buildPreviewPassportPath,
    buildCurrentPublicPassportPath,
    buildInactivePublicPassportPath,
    logAudit,
  });

  registerUpdateRoutes(app, {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    createPassportTable,
    getTable,
    getWritablePassportColumns,
    getStoredPassportValues,
    normalizeProductIdValue,
    normalizeReleaseStatus,
    isEditablePassportStatus,
    updatePassportRowById,
    archivePassportSnapshot,
    archivePassportSnapshots,
    getActorIdentifier,
    logAudit,
    EDITABLE_RELEASE_STATUSES_SQL,
    IN_REVISION_STATUSES_SQL,
    VALID_GRANULARITIES,
    hasReleasedLineageVersion,
    buildStoredProductIdentifiers,
    findExistingPassportByProductId,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    maybeSignCarrierPayload,
    buildCarrierAuthenticityStorageValue,
    getCompanyNameMap,
    buildComplianceManagedFields,
    SYSTEM_PASSPORT_FIELDS,
  });

  registerLifecycleRoutes(app, {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    generateDppRecordId,
    normalizePassportRequestBody,
    getTable,
    normalizeProductIdValue,
    normalizePassportRow,
    normalizeReleaseStatus,
    findExistingPassportByProductId,
    buildStoredProductIdentifiers,
    productIdentifierService,
    getPassportLineageContext,
    archivePassportSnapshot,
    archivePassportSnapshots,
    insertPassportRegistry,
    logAudit,
    replicatePassportToBackup,
    loadLatestLivePassport,
    reconcileManagedReleaseFields,
    evaluateCompliance,
    EDITABLE_RELEASE_STATUSES_SQL,
    REVISION_BLOCKING_STATUSES_SQL,
    ARCHIVED_HISTORY_FILTER_SQL,
    markOlderVersionsObsolete,
    complianceService,
    signPassport,
    recordSignedDppRelease,
    getActorIdentifier,
    IN_REVISION_STATUS,
    submitPassportToWorkflow,
    VALID_GRANULARITIES,
  });

  // ─── BULK REVISE ───────────────────────────────────────────────────────────

  registerBulkLifecycleRoutes(app, {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    generateDppRecordId,
    normalizePassportRequestBody,
    getTable,
    normalizeReleaseStatus,
    toStoredPassportValue,
    coerceBulkFieldValue,
    archivePassportSnapshot,
    archivePassportSnapshots,
    insertPassportRegistry,
    logAudit,
    replicatePassportToBackup,
    evaluateCompliance,
    EDITABLE_RELEASE_STATUSES_SQL,
    REVISION_BLOCKING_STATUSES_SQL,
    ARCHIVED_HISTORY_FILTER_SQL,
    markOlderVersionsObsolete,
    signPassport,
    recordSignedDppRelease,
    getActorIdentifier,
    IN_REVISION_STATUS,
    submitPassportToWorkflow,
    getPassportLineageContext,
  });

  registerDeleteRoutes(app, {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    getTable,
    normalizeProductIdValue,
    normalizeReleaseStatus,
    isEditablePassportStatus,
    findExistingPassportByProductId,
    archivePassportSnapshot,
    getActorIdentifier,
    logAudit,
    EDITABLE_RELEASE_STATUSES_SQL,
  });

  // ─── DIFF & HISTORY ────────────────────────────────────────────────────────

  registerHistoryReadRoutes(app, {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    getPassportLineageContext,
    getPassportVersionsByLineage,
    buildPassportVersionHistory,
    productIdentifierService,
  });
  registerPassportSupportRoutes(app, {
    pool,
    crypto,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    upload,
    storageService,
    logAudit,
    getTable,
    getPassportLineageContext,
    normalizePassportRow,
    isPublicHistoryStatus,
    EDITABLE_RELEASE_STATUSES_SQL,
  });

  registerAuditAnalyticsRoutes(app, {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    checkCompanyAdmin,
    queryTableStats,
    getTable,
    verifyAuditLogChain,
    buildAuditLogRootSummary,
    listAuditLogAnchors,
    anchorAuditLogRoot,
    withAuditActorAliases,
    replicateAuditAnchorToBackup,
    ARCHIVED_HISTORY_FILTER_SQL,
  });

  registerAccessGrantRoutes(app, {
    pool,
    accessRightsService,
    authenticateToken,
    checkCompanyAccess,
    checkCompanyAdmin,
    logAudit,
    replicateAccessControlEventToBackup,
  });
  registerBackupRoutes(app, {
    backupProviderService,
    productIdentifierService,
    authenticateToken,
    checkCompanyAccess,
    checkCompanyAdmin,
    logAudit,
    loadLatestLivePassport,
    normalizePassportRow,
    stripRestrictedFieldsForPublicView,
    getCompanyNameMap,
    replicatePassportToBackup,
  });
  registerCarrierSecurityRoutes(app, {
    pool,
    crypto,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    publicReadRateLimit,
    hashSecret,
    createDeviceKeyMaterial,
    logAudit,
    normalizePassportRequestBody,
    getTable,
    normalizePassportRow,
    getCompanyNameMap,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    buildCarrierAuthenticityResponseFields,
    normalizeCarrierAuthenticityMetadata,
    validateQrPrintSpecification,
    maybeSignCarrierPayload,
    buildCarrierAuthenticityStorageValue,
    buildDataCarrierVerificationRecord,
    recordPassportSecurityEvent,
    getTrustedViewerHost,
    parseUrlHost,
  });

};
