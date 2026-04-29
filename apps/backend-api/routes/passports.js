"use strict";

const logger = require("../services/logger");
const { generateDppRecordId } = require("../services/dpp-record-id");

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
  buildBatteryPassJsonExport,
  storageService,
  complianceService,
  accessRightsService,
  productIdentifierService,
  backupProviderService,
  buildExpandedPassportPayload
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
  const ALLOWED_API_KEY_SCOPES = new Set(["dpp:read", "dpp:history:read", "dpp:element:read", "*"]);
  const API_KEY_PREFIX_LENGTH = 16;

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
              COALESCE(p.default_granularity, c.dpp_granularity, 'item') AS default_granularity,
              COALESCE(p.allow_granularity_override, NOT COALESCE(c.granularity_locked, false)) AS allow_granularity_override,
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
    if (!candidateFacilityId) return null;

    const facilityRes = await pool.query(
      `SELECT facility_identifier
       FROM company_facilities
       WHERE company_id = $1
         AND facility_identifier = $2
         AND is_active = true
       LIMIT 1`,
      [companyId, candidateFacilityId]
    );
    if (!facilityRes.rows.length) {
      const error = new Error(`Unknown or inactive facility identifier "${candidateFacilityId}"`);
      error.statusCode = 400;
      throw error;
    }
    return candidateFacilityId;
  }

  function serializeProfileDefaultValue(value) {
    if (Array.isArray(value)) return JSON.stringify(value);
    return value ?? null;
  }

  async function buildComplianceManagedFields({ companyId, passportType, granularity, requestedFields = {} }) {
    const profile = complianceService.resolveProfileMetadata({ passportType, granularity });
    const companyIdentity = await loadCompanyComplianceIdentity(companyId);
    const resolvedFacilityId = await resolveManagedFacilityId({ companyId, requestedFields });
    return {
      compliance_profile_key: requestedFields.compliance_profile_key || profile.key,
      content_specification_ids: serializeProfileDefaultValue(
        requestedFields.content_specification_ids || profile.contentSpecificationIds
      ),
      carrier_policy_key: requestedFields.carrier_policy_key || profile.defaultCarrierPolicyKey || null,
      economic_operator_id: requestedFields.economic_operator_id || companyIdentity?.economic_operator_identifier || null,
      facility_id: resolvedFacilityId
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

  function isFullRepresentationRequest(value) {
    return ["expanded", "full"].includes(String(value || "").trim().toLowerCase());
  }

  async function loadCompanySerializationContext(companyId) {
    const result = await pool.query(
      `SELECT c.id,
              c.company_name,
              c.did_slug,
              COALESCE(p.default_granularity, c.dpp_granularity, 'item') AS dpp_granularity,
              COALESCE(p.default_granularity, c.dpp_granularity, 'item') AS default_granularity
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

  app.get("/api/companies/:companyId/api-keys", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, name, key_prefix, scopes, expires_at, created_at, last_used_at, is_active
         FROM api_keys WHERE company_id = $1 ORDER BY created_at DESC`,
        [req.params.companyId]
      );
      res.json(r.rows);
    } catch (e) {res.status(500).json({ error: "Failed to fetch API keys" });}
  });

  app.post("/api/companies/:companyId/api-keys", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const { name, scopes, expires_at, expiresAt } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
      const parsedScopes = parseApiKeyScopes(scopes);
      const resolvedExpiry = expires_at || expiresAt || null;
      const expiresAtValue = resolvedExpiry ? new Date(resolvedExpiry) : null;
      if (expiresAtValue && Number.isNaN(expiresAtValue.getTime())) {
        return res.status(400).json({ error: "expires_at must be a valid ISO timestamp" });
      }

      const count = await pool.query(
        "SELECT COUNT(*) FROM api_keys WHERE company_id = $1 AND is_active = true",
        [req.params.companyId]
      );
      if (parseInt(count.rows[0].count) >= 10)
      return res.status(400).json({ error: "Maximum of 10 active API keys per company" });

      const rawKey = "dpp_" + crypto.randomBytes(20).toString("hex");
      const keyRecord = buildApiKeyHashRecord(rawKey);

      const r = await pool.query(
        `INSERT INTO api_keys (company_id, name, key_hash, key_prefix, key_salt, hash_algorithm, scopes, expires_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, name, key_prefix, scopes, expires_at, created_at`,
        [
        req.params.companyId,
        name.trim(),
        keyRecord.keyHash,
        keyRecord.keyPrefix,
        keyRecord.keySalt,
        keyRecord.hashAlgorithm,
        parsedScopes,
        expiresAtValue,
        req.user.userId]

      );
      res.status(201).json({ ...r.rows[0], key: rawKey });
    } catch (e) {logger.error("Create API key error:", e.message);res.status(500).json({ error: "Failed to create API key" });}
  });

  app.delete("/api/companies/:companyId/api-keys/:keyId", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        "UPDATE api_keys SET is_active = false, updated_at = NOW() WHERE id = $1 AND company_id = $2 RETURNING id, company_id, name, scopes, expires_at, is_active",
        [req.params.keyId, req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Key not found" });
      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REVOKE_API_KEY",
        "api_keys",
        String(req.params.keyId),
        r.rows[0],
        { revoked: true },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
          audience: "company_admin",
        }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "API_KEY_REVOKED",
        severity: "high",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedApiKeyId: req.params.keyId,
        revocationMode: "standard",
        metadata: {
          scopes: r.rows[0].scopes || [],
          keyName: r.rows[0].name || null,
        },
      }).catch(() => {});
      res.json({ success: true });
    } catch (e) {res.status(500).json({ error: "Failed to revoke API key" });}
  });

  app.post("/api/companies/:companyId/api-keys/:keyId/revoke", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const reason = req.body?.reason || "API key access revoked";
      const r = await pool.query(
        `UPDATE api_keys
         SET is_active = false,
             updated_at = NOW()
         WHERE id = $1 AND company_id = $2
         RETURNING id, company_id, name, scopes, expires_at, is_active`,
        [req.params.keyId, req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Key not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REVOKE_API_KEY",
        "api_keys",
        String(req.params.keyId),
        r.rows[0],
        { revoked: true, reason },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
          audience: "company_admin",
        }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "API_KEY_REVOKED",
        severity: "high",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedApiKeyId: req.params.keyId,
        revocationMode: "standard",
        reason,
        metadata: {
          scopes: r.rows[0].scopes || [],
          keyName: r.rows[0].name || null,
        },
      }).catch(() => {});

      res.json({ success: true, revoked: true, emergency: false, apiKey: r.rows[0] });
    } catch {
      res.status(500).json({ error: "Failed to revoke API key" });
    }
  });

  app.post("/api/companies/:companyId/api-keys/:keyId/emergency-revoke", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const reason = req.body?.reason || "Emergency API key revocation";
      const effectiveAt = new Date().toISOString();
      const r = await pool.query(
        `UPDATE api_keys
         SET is_active = false,
             expires_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND company_id = $2
         RETURNING id, company_id, name, scopes, expires_at, is_active`,
        [req.params.keyId, req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Key not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "EMERGENCY_REVOKE_API_KEY",
        "api_keys",
        String(req.params.keyId),
        r.rows[0],
        { revoked: true, emergency: true, reason, effective_at: effectiveAt },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
          audience: "company_admin",
        }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "API_KEY_EMERGENCY_REVOKED",
        severity: "critical",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedApiKeyId: req.params.keyId,
        revocationMode: "emergency",
        reason,
        metadata: {
          effectiveAt,
          scopes: r.rows[0].scopes || [],
          keyName: r.rows[0].name || null,
        },
      }).catch(() => {});

      res.json({
        success: true,
        revoked: true,
        emergency: true,
        effectiveAt,
        apiKey: r.rows[0],
      });
    } catch {
      res.status(500).json({ error: "Failed to emergency-revoke API key" });
    }
  });

  // ─── PUBLIC API v1 ─────────────────────────────────────────────────────────

  app.use("/api/v1", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-API-Key, Content-Type");
    res.header("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/api/v1/passports", authenticateApiKey, requireApiKeyScope("dpp:read"), apiKeyReadRateLimit, async (req, res) => {
    try {
      const { type, status, search, limit = "100", offset = "0" } = req.query;
      if (!type) return res.status(400).json({ error: "'type' query parameter is required" });

      const companyId = req.apiKey.companyId;
      const tableName = getTable(type);
      const cap = Math.min(parseInt(limit) || 100, 500);
      const off = Math.max(parseInt(offset) || 0, 0);

      let q = `
        WITH latest AS (
          SELECT DISTINCT ON (lineage_id) *
          FROM ${tableName}
          WHERE deleted_at IS NULL AND company_id = $1
          ORDER BY lineage_id, version_number DESC, updated_at DESC
        )
        SELECT * FROM latest WHERE 1=1
      `;
      const params = [companyId];
      let i = 2;
      if (status) {q += ` AND release_status = $${i++}`;params.push(status);}
      if (search) {
        q += ` AND (model_name ILIKE $${i} OR product_id ILIKE $${i} OR product_identifier_did ILIKE $${i})`;
        params.push(`%${search}%`);
        i++;
      }
      q += ` ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`;
      params.push(cap, off);

      const r = await pool.query(q, params);
      res.json({
        passport_type: type,
        count: r.rows.length,
        limit: cap,
        offset: off,
        passports: r.rows.map((p) => ({ ...p, passport_type: type }))
      });
    } catch (e) {logger.error("API v1 list error:", e.message);res.status(500).json({ error: "Failed to fetch passports" });}
  });

  app.get("/api/v1/passports/:dppId", authenticateApiKey, requireApiKeyScope("dpp:read"), apiKeyReadRateLimit, async (req, res) => {
    try {
      const { dppId: dppId } = req.params;
      const companyId = req.apiKey.companyId;

      const reg = await pool.query(
        "SELECT passport_type FROM passport_registry WHERE dpp_id = $1 AND company_id = $2",
        [dppId, companyId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const tableName = getTable(reg.rows[0].passport_type);
      const r = await pool.query(
        `SELECT * FROM ${tableName} WHERE dpp_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [dppId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
      res.json({ ...r.rows[0], passport_type: reg.rows[0].passport_type });
    } catch (e) {logger.error("API v1 get error:", e.message);res.status(500).json({ error: "Failed to fetch passport" });}
  });

  // ─── PASSPORT CRUD ─────────────────────────────────────────────────────────

  app.post("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const normalizedBody = normalizePassportRequestBody(req.body);
      const {
        passport_type,
        model_name,
        product_id,
        granularity: requestedGranularity,
        compliance_profile_key,
        content_specification_ids,
        carrier_policy_key,
        economic_operator_id,
        facility_id,
        ...fields
      } = normalizedBody;
      const userId = req.user.userId;

      if (!passport_type) return res.status(400).json({ error: "passport_type is required" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });

      const resolvedPassportType = typeSchema.typeName;
      const tableName = getTable(resolvedPassportType);
      const dppId = generateDppRecordId();
      const lineageId = dppId;
      const normalizedProductId = normalizeProductIdValue(product_id) || generateProductIdValue(dppId);
      const companyPolicy = await getCompanyDppPolicy(companyId);
      const effectiveGranularity = resolveGranularityForCreate(companyPolicy, requestedGranularity);
      const storedProductIdentifiers = buildStoredProductIdentifiers({
        companyId,
        passportType: resolvedPassportType,
        productId: normalizedProductId,
        granularity: effectiveGranularity
      });
      const complianceManagedFields = await buildComplianceManagedFields({
        companyId,
        passportType: resolvedPassportType,
        granularity: effectiveGranularity,
        requestedFields: {
          ...fields,
          compliance_profile_key,
          content_specification_ids,
          carrier_policy_key,
          economic_operator_id,
          facility_id
        }
      });

      const existingByProductId = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId });
      if (existingByProductId) {
        return res.status(409).json({
          error: `A passport with Serial Number "${normalizedProductId}" already exists.`,
          existing_dpp_id: existingByProductId.dppId,
          release_status: normalizeReleaseStatus(existingByProductId.release_status)
        });
      }

      const invalidFieldKeys = Object.keys(fields).filter((key) =>
      !SYSTEM_PASSPORT_FIELDS.has(key) && !typeSchema.allowedKeys.has(key)
      );
      if (invalidFieldKeys.length) {
        return res.status(400).json({ error: "Unknown passport field(s) in request body", fields: invalidFieldKeys });
      }
      const dataFields = getWritablePassportColumns(fields).filter((key) => typeSchema.allowedKeys.has(key));
      const processedFields = Object.fromEntries(dataFields.map((key) => [key, toStoredPassportValue(fields[key])]));

      const allCols = [
      "dppId",
      "lineage_id",
      "company_id",
      "model_name",
      "product_id",
      "product_identifier_did",
      "compliance_profile_key",
      "content_specification_ids",
      "carrier_policy_key",
      "economic_operator_id",
      "facility_id",
      "granularity",
      "created_by",
      ...dataFields];

      const allVals = [
      dppId,
      lineageId,
      companyId,
      model_name || null,
      storedProductIdentifiers.product_id,
      storedProductIdentifiers.product_identifier_did,
      complianceManagedFields.compliance_profile_key,
      complianceManagedFields.content_specification_ids,
      complianceManagedFields.carrier_policy_key,
      complianceManagedFields.economic_operator_id,
      complianceManagedFields.facility_id,
      effectiveGranularity,
      userId,
      ...dataFields.map((k) => processedFields[k])];

      const places = allCols.map((_, i) => `$${i + 1}`).join(", ");

      const client = await pool.connect();
      let result;
      try {
        await client.query("BEGIN");
        result = await client.query(
          `INSERT INTO ${tableName} (${allCols.join(", ")}) VALUES (${places}) RETURNING *`,
          allVals
        );
        await insertPassportRegistry({
          client,
          dppId: dppId,
          lineageId,
          companyId,
          passportType: resolvedPassportType
        });
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      await logAudit(companyId, userId, "CREATE", tableName, dppId, null, {
        product_id: storedProductIdentifiers.product_id,
        product_identifier_did: storedProductIdentifiers.product_identifier_did,
        passport_type: resolvedPassportType,
        model_name,
        granularity: effectiveGranularity,
        compliance_profile_key: complianceManagedFields.compliance_profile_key
      });
      res.status(201).json({ success: true, passport: result.rows[0] });
    } catch (e) {
      logger.error("Create passport error:", e.message);
      res.status(e.statusCode || 500).json({ error: e.message || "Failed to create passport" });
    }
  });

  app.post("/api/companies/:companyId/passports/bulk", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const normalizedBody = normalizePassportRequestBody(req.body);
      const { passport_type, passports } = normalizedBody;
      const userId = req.user.userId;

      if (!passport_type) return res.status(400).json({ error: "passport_type is required" });
      if (!Array.isArray(passports) || passports.length === 0) return res.status(400).json({ error: "passports must be a non-empty array" });
      if (passports.length > 500) return res.status(400).json({ error: "Maximum 500 passports per bulk request" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });

      const resolvedPassportType = typeSchema.typeName;
      const tableName = getTable(resolvedPassportType);
      const companyPolicy = await getCompanyDppPolicy(companyId);
      const results = [];
      let created = 0,skipped = 0,failed = 0;

      for (let i = 0; i < passports.length; i++) {
        const item = normalizePassportRequestBody(passports[i] || {});
        const {
          model_name,
          product_id,
          granularity: requestedGranularity,
          compliance_profile_key,
          content_specification_ids,
          carrier_policy_key,
          economic_operator_id,
          facility_id,
          ...fields
        } = item;
        const dppId = generateDppRecordId();
        const lineageId = dppId;
        const normalizedProductId = normalizeProductIdValue(product_id) || generateProductIdValue(dppId);

        try {
          const existingByProductId = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId });
          if (existingByProductId) {
            results.push({ index: i, product_id: normalizedProductId, success: false, error: `A passport with Serial Number "${normalizedProductId}" already exists — skipped` });
            skipped++;continue;
          }
          const invalidFieldKeys = Object.keys(fields).filter((key) => !SYSTEM_PASSPORT_FIELDS.has(key) && !typeSchema.allowedKeys.has(key));
          if (invalidFieldKeys.length) {
            results.push({ index: i, product_id: normalizedProductId, success: false, error: `Unknown passport field(s): ${invalidFieldKeys.join(", ")}` });
            failed++;continue;
          }
          const effectiveGranularity = resolveGranularityForCreate(companyPolicy, requestedGranularity);
          const storedProductIdentifiers = buildStoredProductIdentifiers({
            companyId,
            passportType: resolvedPassportType,
            productId: normalizedProductId,
            granularity: effectiveGranularity
          });
          const complianceManagedFields = await buildComplianceManagedFields({
            companyId,
            passportType: resolvedPassportType,
            granularity: effectiveGranularity,
            requestedFields: {
              ...fields,
              compliance_profile_key,
              content_specification_ids,
              carrier_policy_key,
              economic_operator_id,
              facility_id
            }
          });
          const dataFields = getWritablePassportColumns(fields).filter((key) => typeSchema.allowedKeys.has(key));
          const processedFields = Object.fromEntries(dataFields.map((key) => [key, toStoredPassportValue(fields[key])]));
          const allCols = [
          "dppId", "lineage_id", "company_id", "model_name", "product_id", "product_identifier_did",
          "compliance_profile_key", "content_specification_ids", "carrier_policy_key", "economic_operator_id", "facility_id",
          "granularity", "created_by", ...dataFields];

          const allVals = [
          dppId,
          lineageId,
          companyId,
          model_name || null,
          storedProductIdentifiers.product_id,
          storedProductIdentifiers.product_identifier_did,
          complianceManagedFields.compliance_profile_key,
          complianceManagedFields.content_specification_ids,
          complianceManagedFields.carrier_policy_key,
          complianceManagedFields.economic_operator_id,
          complianceManagedFields.facility_id,
          effectiveGranularity,
          userId,
          ...dataFields.map((k) => processedFields[k])];

          const places = allCols.map((_, idx) => `$${idx + 1}`).join(", ");

          const r = await pool.query(
            `INSERT INTO ${tableName} (${allCols.join(", ")}) VALUES (${places}) RETURNING dpp_id, model_name, product_id, product_identifier_did`,
            allVals
          );
          await insertPassportRegistry({
            dppId: dppId,
            lineageId,
            companyId,
            passportType: resolvedPassportType
          });
          await logAudit(companyId, userId, "CREATE", tableName, dppId, null, {
            product_id: storedProductIdentifiers.product_id,
            product_identifier_did: storedProductIdentifiers.product_identifier_did,
            passport_type: resolvedPassportType,
            model_name,
            granularity: effectiveGranularity,
            bulk: true
          });
          results.push({
            index: i,
            success: true,
            dppId: dppId,
            product_id: storedProductIdentifiers.product_id,
            product_identifier_did: storedProductIdentifiers.product_identifier_did,
            model_name: model_name || null,
            granularity: effectiveGranularity,
            compliance_profile_key: complianceManagedFields.compliance_profile_key
          });
          created++;
        } catch (e) {
          results.push({ index: i, product_id: normalizedProductId, success: false, error: e.message });
          failed++;
        }
      }

      res.status(207).json({ summary: { total: passports.length, created, skipped, failed }, results });
    } catch (e) {
      logger.error("Bulk create error:", e.message);
      res.status(500).json({ error: "Bulk create failed" });
    }
  });

  app.get("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const { passportType, search, status } = req.query;
      if (!passportType) return res.status(400).json({ error: "passportType query param is required" });

      const tableName = getTable(passportType);
      let q = `SELECT p.*, u.email AS created_by_email, u.first_name, u.last_name
               FROM ${tableName} p
               LEFT JOIN users u ON u.id = p.created_by
               WHERE p.deleted_at IS NULL AND p.company_id = $1`;
      const params = [companyId];let i = 2;

      if (status) {
        const normalizedStatus = normalizeReleaseStatus(status);
        if (normalizedStatus === IN_REVISION_STATUS) {
          q += ` AND p.release_status IN ${IN_REVISION_STATUSES_SQL}`;
        } else {
          q += ` AND p.release_status = $${i++}`;
          params.push(normalizedStatus);
        }
      }
      if (search) {
        q += ` AND (p.model_name ILIKE $${i} OR p.product_id ILIKE $${i} OR p.product_identifier_did ILIKE $${i})`;
        params.push(`%${search}%`);
        i++;
      }
      q += " ORDER BY p.lineage_id, p.version_number DESC";

      const r = await pool.query(q, params);
      res.json(r.rows.map((row) => ({ ...normalizePassportRow(row), passport_type: passportType })));
    } catch (e) {res.status(500).json({ error: "Failed to fetch passports" });}
  });

  app.post("/api/companies/:companyId/passports/bulk-fetch", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      let passport_type, identifiers;
      if (Array.isArray(req.body)) {
        identifiers = req.body;
        passport_type = identifiers[0]?.passport_type || identifiers[0]?.passportType;
      } else {
        const normalizedBody = normalizePassportRequestBody(req.body);
        passport_type = normalizedBody.passport_type;
        identifiers = normalizedBody.passports || normalizedBody.identifiers;
      }
      if (!passport_type) return res.status(400).json({ error: "passport_type required" });
      if (!Array.isArray(identifiers) || !identifiers.length) return res.status(400).json({ error: "passports or identifiers array required" });
      if (identifiers.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);
      const results = [];

      for (const item of identifiers) {
        const raw = typeof item === "string" ? { product_id: item } : item || {};
        const dppId = raw.dppId;
        const productId = normalizeProductIdValue(raw.product_id || raw.productId);
        try {
          let row = null;
          if (dppId) {
            const r = await pool.query(
              `SELECT p.*, u.email AS created_by_email, u.first_name, u.last_name
               FROM ${tableName} p LEFT JOIN users u ON u.id = p.created_by
               WHERE p.dpp_id = $1 AND p.company_id = $2 AND p.deleted_at IS NULL LIMIT 1`,
              [dppId, companyId]
            );
            row = r.rows[0];
          }
          if (!row && productId) {
            const productIdCandidates = productIdentifierService.buildLookupCandidates({
              companyId,
              passportType: typeSchema.typeName,
              productId
            });
            const r = await pool.query(
              `WITH latest AS (
                 SELECT DISTINCT ON (lineage_id) *
                 FROM ${tableName}
                 WHERE (product_id = ANY($1::text[]) OR product_identifier_did = ANY($1::text[]))
                   AND company_id = $2
                   AND deleted_at IS NULL
                 ORDER BY lineage_id, version_number DESC, updated_at DESC
               )
               SELECT latest.*, u.email AS created_by_email, u.first_name, u.last_name
               FROM latest LEFT JOIN users u ON u.id = latest.created_by
               ORDER BY latest.version_number DESC LIMIT 1`,
              [productIdCandidates, companyId]
            );
            row = r.rows[0];
          }
          if (row) {
            results.push({ ...normalizePassportRow(row), passport_type: typeSchema.typeName, _status: "found" });
          } else {
            results.push({ dppId: dppId || undefined, product_id: productId || undefined, _status: "not_found" });
          }
        } catch (e) {
          results.push({ dppId: dppId || undefined, product_id: productId || undefined, _status: "error", error: e.message });
        }
      }
      res.json({ total: identifiers.length, found: results.filter((r) => r._status === "found").length, results });
    } catch (e) {
      logger.error("Bulk fetch error:", e.message);
      res.status(500).json({ error: "Bulk fetch failed" });
    }
  });

  app.get("/api/companies/:companyId/passports/export-drafts", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const passportType = req.query.passportType;
      const fmt = (req.query.format || "csv").toLowerCase();
      const statusFilter = (req.query.status || "draft").toLowerCase();

      if (!passportType) return res.status(400).json({ error: "passportType is required" });

      const typeRes = await pool.query("SELECT fields_json, umbrella_category, semantic_model_key FROM passport_types WHERE type_name=$1", [passportType]);
      if (!typeRes.rows.length) return res.status(404).json({ error: "Passport type not found" });

      const sections = typeRes.rows[0]?.fields_json?.sections || [];
      const schemaFields = sections.flatMap((s) => s.fields || []);
      const tableName = getTable(passportType);
      const cols = ["dppId", "model_name", "product_id", "release_status", ...schemaFields.map((f) => f.key)];
      const safeColsSql = cols.map((c) => /^[a-z][a-z0-9_]*$/.test(c) ? c : null).filter(Boolean);

      let statusSql;
      if (statusFilter === "all") {
        statusSql = "";
      } else if (statusFilter === "released") {
        statusSql = ` AND release_status = 'released'`;
      } else if (statusFilter === "in_revision" || statusFilter === "revised") {
        statusSql = ` AND release_status IN ${IN_REVISION_STATUSES_SQL}`;
      } else {
        statusSql = ` AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}`;
      }

      const passRes = await pool.query(
        `SELECT ${safeColsSql.join(", ")} FROM ${tableName}
         WHERE company_id=$1${statusSql} AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [companyId]
      );
      const rows = passRes.rows;

      if (fmt === "json" || fmt === "jsonld") {
        res.setHeader("Content-Type", "application/ld+json");
        res.setHeader("Content-Disposition", `attachment; filename="${passportType}_export.jsonld"`);
        return res.json(buildBatteryPassJsonExport(rows, passportType, {
          semanticModelKey: typeRes.rows[0]?.semantic_model_key || null,
          umbrellaCategory: typeRes.rows[0]?.umbrella_category || null
        }));
      }

      const escCell = (v) => {
        const str = Array.isArray(v) || typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "");
        return `"${str.replace(/"/g, '""')}"`;
      };
      const fieldRows = [
      ["dppId", ...rows.map((r) => r.dppId)],
      ["model_name", ...rows.map((r) => r.model_name || "")],
      ["product_id", ...rows.map((r) => r.product_id || "")],
      ["release_status", ...rows.map((r) => r.release_status || "")],
      ...schemaFields.map((f) => [f.label || f.key, ...rows.map((r) => r[f.key] ?? "")])];

      const headerRow = ["Field Name", ...rows.map((_, i) => `Passport ${i + 1}`)];
      const csvLines = [headerRow, ...fieldRows].map((row) => row.map(escCell).join(","));

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${passportType}_export.csv"`);
      res.send(csvLines.join("\n"));
    } catch (e) {
      logger.error("Export by type error:", e.message);
      res.status(500).json({ error: "Export failed" });
    }
  });

  app.get("/api/companies/:companyId/passports/archived", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const { search, passportType } = req.query;

      let q = `SELECT pa.*, u.email AS archived_by_email, u.first_name AS archived_by_first_name, u.last_name AS archived_by_last_name
               FROM passport_archives pa
               LEFT JOIN users u ON u.id = pa.archived_by
               WHERE pa.company_id = $1`;
      const params = [companyId];
      let i = 2;

      if (passportType) {q += ` AND pa.passport_type = $${i++}`;params.push(passportType);}
      if (search) {
        q += ` AND (pa.model_name ILIKE $${i} OR pa.product_id ILIKE $${i} OR pa.product_identifier_did ILIKE $${i} OR pa.dppId::text ILIKE $${i})`;
        params.push(`%${search}%`);
        i++;
      }

      q = `
        SELECT
          sub.*,
          COALESCE(phv.is_public, sub.release_status IN ('released', 'obsolete')) AS is_public,
          public_version.version_number AS public_version_number
        FROM (${q}) sub
        LEFT JOIN passport_history_visibility phv
          ON phv.passport_dpp_id = sub.dpp_id
         AND phv.version_number = sub.version_number
        LEFT JOIN LATERAL (
          SELECT pa_public.version_number
          FROM passport_archives pa_public
          LEFT JOIN passport_history_visibility phv_public
            ON phv_public.passport_dpp_id = pa_public.dpp_id
           AND phv_public.version_number = pa_public.version_number
          WHERE pa_public.lineage_id = sub.lineage_id
            AND pa_public.company_id = sub.company_id
            AND pa_public.release_status IN ('released', 'obsolete')
            AND COALESCE(phv_public.is_public, true) = true
          ORDER BY pa_public.version_number DESC, pa_public.archived_at DESC
          LIMIT 1
        ) public_version ON true
        ORDER BY sub.lineage_id, sub.version_number DESC, sub.archived_at DESC
      `;

      const r = await pool.query(q, params);
      res.json(r.rows);
    } catch (e) {
      logger.error("Archived list error:", e.message);
      res.status(500).json({ error: "Failed to fetch archived passports" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, dppId: dppId } = req.params;
      const { passportType } = req.query;
      const versionNumber = req.query.versionNumber ? Number.parseInt(req.query.versionNumber, 10) : null;
      if (!passportType) return res.status(400).json({ error: "passportType query param required" });
      if (req.query.versionNumber && !Number.isFinite(versionNumber)) {
        return res.status(400).json({ error: "versionNumber must be a valid integer" });
      }

      const resolved = await fetchCompanyPassportRecord({ companyId, dppId: dppId, passportType, versionNumber });
      if (!resolved?.passport) return res.status(404).json({ error: "Passport not found" });

      if (isFullRepresentationRequest(req.query.representation)) {
        const [typeDef, company] = await Promise.all([
        pool.query(
          `SELECT type_name, umbrella_category, semantic_model_key, fields_json
             FROM passport_types
             WHERE type_name = $1
             LIMIT 1`,
          [resolved.passport.passport_type || passportType]
        ),
        loadCompanySerializationContext(companyId)]
        );
        if (!typeDef.rows.length) {
          return res.status(404).json({ error: "Passport type not found" });
        }
        return res.json(
          buildExpandedPassportPayload(resolved.passport, typeDef.rows[0], {
            company,
            granularity: company?.default_granularity || company?.dpp_granularity || resolved.passport.granularity || "model"
          })
        );
      }

      res.json(resolved.passport);
    } catch (e) {res.status(500).json({ error: "Failed to fetch passport" });}
  });

  app.get("/api/companies/:companyId/passports/:dppId/compliance", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, dppId: dppId } = req.params;
      const { passportType } = req.query;
      if (!passportType) return res.status(400).json({ error: "passportType query param required" });

      const resolved = await fetchCompanyPassportRecord({ companyId, dppId: dppId, passportType });
      if (!resolved?.passport) return res.status(404).json({ error: "Passport not found" });

      const compliance = await complianceService.evaluatePassport(resolved.passport, passportType);
      res.json(compliance);
    } catch (e) {
      logger.error("Compliance fetch error:", e.message);
      res.status(500).json({ error: "Failed to evaluate passport compliance" });
    }
  });

  app.get("/api/companies/:companyId/passports/:passportKey/preview", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, passportKey } = req.params;
      const resolved = await resolveCompanyPreviewPassport({ companyId, passportKey });
      if (!resolved?.passport) return res.status(404).json({ error: "Passport not found" });

      const passport = await stripRestrictedFieldsForPublicView(resolved.passport, resolved.passport.passport_type);
      const companyNameMap = await getCompanyNameMap([passport.company_id]);
      const companyName = companyNameMap.get(String(passport.company_id)) || "";

      res.json({
        ...passport,
        preview_mode: true,
        preview_path: buildPreviewPassportPath({ companyName, manufacturerName: passport.manufacturer, manufacturedBy: passport.manufactured_by, modelName: passport.model_name, productId: passport.product_id, fallbackGuid: passport.dppId }),
        public_path: buildCurrentPublicPassportPath({ companyName, manufacturerName: passport.manufacturer, manufacturedBy: passport.manufactured_by, modelName: passport.model_name, productId: passport.product_id }),
        inactive_path: buildInactivePublicPassportPath({ companyName, manufacturerName: passport.manufacturer, manufacturedBy: passport.manufactured_by, modelName: passport.model_name, productId: passport.product_id, versionNumber: passport.version_number })
      });
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") return res.status(409).json({ error: e.message });
      res.status(500).json({ error: "Failed to fetch passport preview" });
    }
  });

  // ─── EDIT SESSIONS ─────────────────────────────────────────────────────────

  app.get("/api/companies/:companyId/passports/:dppId/edit-session", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const editors = await listActiveEditSessions(req.params.dppId, req.user.userId);
      res.json({ editors, timeoutHours: EDIT_SESSION_TIMEOUT_HOURS, serverTime: new Date().toISOString() });
    } catch (e) {res.status(500).json({ error: "Failed to fetch edit session" });}
  });

  app.post("/api/companies/:companyId/passports/:dppId/edit-session", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId: dppId } = req.params;
      const { passportType } = req.body;
      if (!passportType) return res.status(400).json({ error: "passportType required" });

      await clearExpiredEditSessions();
      await pool.query(
        `INSERT INTO passport_edit_sessions (passport_dpp_id, company_id, passport_type, user_id, last_activity_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (passport_dpp_id, user_id)
         DO UPDATE SET company_id = EXCLUDED.company_id, passport_type = EXCLUDED.passport_type, last_activity_at = NOW(), updated_at = NOW()`,
        [dppId, companyId, passportType, req.user.userId]
      );

      const editors = await listActiveEditSessions(dppId, req.user.userId);
      res.json({ success: true, editors, timeoutHours: EDIT_SESSION_TIMEOUT_HOURS, lastActivityAt: new Date().toISOString() });
    } catch (e) {res.status(500).json({ error: "Failed to update edit session" });}
  });

  app.delete("/api/companies/:companyId/passports/:dppId/edit-session", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      await pool.query(
        "DELETE FROM passport_edit_sessions WHERE passport_dpp_id = $1 AND user_id = $2",
        [req.params.dppId, req.user.userId]
      );
      res.json({ success: true });
    } catch (e) {res.status(500).json({ error: "Failed to clear edit session" });}
  });

  // ─── ACCESS KEY ────────────────────────────────────────────────────────────

  app.get("/api/companies/:companyId/passports/:dppId/access-key", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT access_key_hash, access_key_prefix, access_key_last_rotated_at
         FROM passport_registry
         WHERE dpp_id = $1 AND company_id = $2`,
        [req.params.dppId, req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
      res.json({
        hasAccessKey: !!r.rows[0].access_key_hash,
        keyPrefix: r.rows[0].access_key_prefix || null,
        lastRotatedAt: r.rows[0].access_key_last_rotated_at || null,
        revealable: false
      });
    } catch (e) {res.status(500).json({ error: "Failed to get access key" });}
  });

  app.post("/api/companies/:companyId/passports/:dppId/access-key/regenerate", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { dppId: dppId, companyId } = req.params;
      const material = createAccessKeyMaterial();
      const updated = await pool.query(
        `UPDATE passport_registry
         SET access_key = NULL,
             access_key_hash = $1,
             access_key_prefix = $2,
             access_key_last_rotated_at = NOW()
         WHERE dpp_id = $3 AND company_id = $4
         RETURNING access_key_prefix, access_key_last_rotated_at`,
        [material.hash, material.prefix, dppId, companyId]
      );
      if (!updated.rows.length) return res.status(404).json({ error: "Passport not found" });
      await logAudit(companyId, req.user.userId, "ROTATE_ACCESS_KEY", "passport_registry", dppId, null, { key_prefix: material.prefix });
      res.json({
        accessKey: material.rawKey,
        keyPrefix: updated.rows[0].access_key_prefix,
        lastRotatedAt: updated.rows[0].access_key_last_rotated_at
      });
    } catch (e) {res.status(500).json({ error: "Failed to rotate access key" });}
  });

  // ─── BULK UPDATE ALL ───────────────────────────────────────────────────────

  app.patch("/api/companies/:companyId/passports/bulk-update-all", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { passport_type, passportType, filter, update } = normalizePassportRequestBody(req.body);

      const requestedType = passport_type || passportType;
      if (!requestedType) return res.status(400).json({ error: "passport_type required" });
      if (!update || typeof update !== "object" || !Object.keys(update).length)
      return res.status(400).json({ error: "update object with at least one field is required" });

      const typeSchema = await getPassportTypeSchema(requestedType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);

      const invalidKeys = Object.keys(update).filter((key) =>
      !typeSchema.allowedKeys.has(key) && key !== "model_name" && key !== "product_id"
      );
      if (invalidKeys.length) return res.status(400).json({ error: `Unknown field(s): ${invalidKeys.join(", ")}` });
      if (update.product_id !== undefined) return res.status(400).json({ error: "Cannot bulk-update product_id — it must be unique per passport." });

      const params = [companyId];
      let filterSql = "";
      const filterObj = filter || {};
      const statusFilter = (filterObj.status || "editable").toLowerCase();

      if (statusFilter === "all_editable" || statusFilter === "editable" || statusFilter === "draft") {
        filterSql += ` AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}`;
      } else if (statusFilter === "draft_only") {
        filterSql += ` AND release_status = 'draft'`;
      } else if (statusFilter === "in_revision") {
        filterSql += ` AND release_status IN ${IN_REVISION_STATUSES_SQL}`;
      } else {
        return res.status(400).json({ error: `Invalid status filter "${statusFilter}". Use: editable, draft_only, in_revision` });
      }

      if (filterObj.product_id_like) {
        params.push(`%${filterObj.product_id_like}%`);
        filterSql += ` AND (product_id ILIKE $${params.length} OR product_identifier_did ILIKE $${params.length})`;
      }
      if (filterObj.model_name_like) {params.push(`%${filterObj.model_name_like}%`);filterSql += ` AND model_name ILIKE $${params.length}`;}
      if (filterObj.created_after) {params.push(filterObj.created_after);filterSql += ` AND created_at >= $${params.length}`;}
      if (filterObj.created_before) {params.push(filterObj.created_before);filterSql += ` AND created_at <= $${params.length}`;}

      const countRes = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${tableName} WHERE company_id = $1${filterSql} AND deleted_at IS NULL`,
        params
      );
      const matchCount = parseInt(countRes.rows[0].cnt, 10);
      if (matchCount === 0) return res.json({ summary: { matched: 0, updated: 0 }, message: "No passports matched the filter" });
      if (matchCount > 1000 && !req.body.confirm_large_update)
      return res.status(400).json({ error: `This will update ${matchCount} passports. Send confirm_large_update: true to proceed.`, matched: matchCount });

      const updateKeys = getWritablePassportColumns(update);
      if (!updateKeys.length) return res.status(400).json({ error: "No valid fields to update" });

      const updateVals = getStoredPassportValues(updateKeys, update);
      const setOffset = params.length;
      const sets = updateKeys.map((col, i) => `${col} = $${setOffset + i + 1}`).join(", ");
      const allParams = [...params, ...updateVals, userId];
      const updatedByIdx = allParams.length;

      const updateRes = await pool.query(
        `UPDATE ${tableName}
         SET ${sets}, updated_by = $${updatedByIdx}, updated_at = NOW()
         WHERE company_id = $1${filterSql} AND deleted_at IS NULL
         RETURNING dpp_id`,
        allParams
      );
      const updatedGuids = updateRes.rows.map((r) => r.dppId);

      await logAudit(companyId, userId, "BULK_UPDATE_ALL", tableName, null, null, {
        filter: filterObj, fields_updated: updateKeys, count: updatedGuids.length
      });

      res.json({ summary: { matched: matchCount, updated: updatedGuids.length, fields_updated: updateKeys }, dppIds: updatedGuids });
    } catch (e) {
      logger.error("Bulk update all error:", e.message);
      res.status(500).json({ error: "Bulk update all failed", detail: e.message });
    }
  });

  // ─── PATCH SINGLE ──────────────────────────────────────────────────────────

  app.patch("/api/companies/:companyId/passports/:dppId", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId: dppId } = req.params;
      const normalizedBody = normalizePassportRequestBody(req.body);
      const { passport_type, passportType, ...fields } = normalizedBody;
      const userId = req.user.userId;

      const requestedPassportType = passport_type || passportType;
      if (!requestedPassportType) return res.status(400).json({ error: "passportType is required in body" });
      const typeSchema = await getPassportTypeSchema(requestedPassportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);

      const current = await pool.query(
        `SELECT id, lineage_id, product_id, granularity FROM ${tableName}
         WHERE dpp_id = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL LIMIT 1`,
        [dppId]
      );
      if (!current.rows.length) return res.status(404).json({ error: "Passport not found or not editable." });
      const rowId = current.rows[0].id;

      if (fields.product_id !== undefined) {
        const normalizedProductId = normalizeProductIdValue(fields.product_id);
        if (!normalizedProductId) return res.status(400).json({ error: "product_id cannot be blank" });
        const existingByProductId = await findExistingPassportByProductId({
          tableName, companyId, productId: normalizedProductId, excludeGuid: dppId, excludeLineageId: current.rows[0].lineage_id
        });
        if (existingByProductId) {
          return res.status(409).json({
            error: `A passport with Serial Number "${normalizedProductId}" already exists.`,
            existing_dpp_id: existingByProductId.dppId,
            release_status: normalizeReleaseStatus(existingByProductId.release_status)
          });
        }
        const storedProductIdentifiers = buildStoredProductIdentifiers({
          companyId,
          passportType: typeSchema.typeName,
          productId: normalizedProductId,
          granularity: current.rows[0].granularity || "item"
        });
        fields.product_id = storedProductIdentifiers.product_id;
        fields.product_identifier_did = storedProductIdentifiers.product_identifier_did;
      }

      const updateFields = await updatePassportRowById({ tableName, rowId, userId, data: fields });
      if (!updateFields.length) return res.status(400).json({ error: "No fields to update" });

      await logAudit(companyId, userId, "UPDATE", tableName, dppId, null, { fields_updated: updateFields });
      res.json({ success: true });
    } catch (e) {
      logger.error("PATCH /passports/:dppId error:", e.message);
      res.status(500).json({ error: "Failed to update passport", detail: e.message });
    }
  });

  // ─── BULK PATCH ────────────────────────────────────────────────────────────

  app.patch("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      let passport_type, passports;

      if (Array.isArray(req.body)) {
        passports = req.body;
        passport_type = passports[0]?.passport_type || passports[0]?.passportType;
      } else {
        const normalizedBody = normalizePassportRequestBody(req.body);
        passport_type = normalizedBody.passport_type;
        passports = normalizedBody.passports;
      }
      if (!passport_type) return res.status(400).json({ error: "passport_type required" });
      if (!Array.isArray(passports) || !passports.length) return res.status(400).json({ error: "passports array required" });
      if (passports.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);

      let updated = 0,skipped = 0,failed = 0;
      const details = [];

      for (const item of passports) {
        const normalizedItem = normalizePassportRequestBody(item || {});
        const { dppId: incomingGuid, passport_type: _pt, passportType: _pt2, ...fields } = normalizedItem;
        const normalizedProductId = normalizeProductIdValue(fields.product_id);

        try {
          if (!incomingGuid && !normalizedProductId) {
            details.push({ status: "failed", error: "Each item needs a dppId or product_id to match against" });
            failed++;continue;
          }

          const builtInCols = new Set(["product_id", "model_name"]);
          const invalidKeys = Object.keys(fields).filter((key) =>
          !SYSTEM_PASSPORT_FIELDS.has(key) && !typeSchema.allowedKeys.has(key) && !builtInCols.has(key)
          );
          if (invalidKeys.length) {
            details.push({ dppId: incomingGuid, product_id: normalizedProductId || undefined, status: "failed", error: `Unknown field(s): ${invalidKeys.join(", ")}` });
            failed++;continue;
          }

          let rowId,matchedGuid,matchedLineageId = null;
          if (incomingGuid) {
            const byGuid = await pool.query(
              `SELECT id, dpp_id, lineage_id, granularity FROM ${tableName} WHERE dpp_id=$1 AND company_id=$2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL`,
              [incomingGuid, companyId]
            );
            if (byGuid.rows.length) {rowId = byGuid.rows[0].id;matchedGuid = byGuid.rows[0].dppId;matchedLineageId = byGuid.rows[0].lineage_id;}
          }
          if (!rowId && normalizedProductId) {
            const byProductId = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId });
            if (byProductId && isEditablePassportStatus(normalizeReleaseStatus(byProductId.release_status))) {
              rowId = byProductId.id;matchedGuid = byProductId.dppId;matchedLineageId = byProductId.lineage_id;
            }
          }
          if (!rowId) {
            details.push({ dppId: incomingGuid, product_id: normalizedProductId || undefined, status: "skipped", reason: "No matching editable passport found" });
            skipped++;continue;
          }
          if (fields.product_id !== undefined) {
            if (!normalizedProductId) {
              details.push({ dppId: matchedGuid, status: "failed", error: "product_id cannot be blank" });
              failed++;continue;
            }
            const dup = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId, excludeGuid: matchedGuid, excludeLineageId: matchedLineageId });
            if (dup) {
              details.push({ dppId: matchedGuid, product_id: normalizedProductId, status: "failed", error: `Serial Number "${normalizedProductId}" already belongs to another passport` });
              failed++;continue;
            }
            const matchedGranularityRes = await pool.query(
              `SELECT granularity FROM ${tableName} WHERE id = $1 LIMIT 1`,
              [rowId]
            );
            const storedProductIdentifiers = buildStoredProductIdentifiers({
              companyId,
              passportType: typeSchema.typeName,
              productId: normalizedProductId,
              granularity: matchedGranularityRes.rows[0]?.granularity || "item"
            });
            fields.product_id = storedProductIdentifiers.product_id;
            fields.product_identifier_did = storedProductIdentifiers.product_identifier_did;
          }

          const updateCols = await updatePassportRowById({ tableName, rowId, userId, data: fields });
          if (!updateCols.length) {
            details.push({ dppId: matchedGuid, product_id: normalizedProductId || undefined, status: "skipped", reason: "No changes detected" });
            skipped++;continue;
          }

          await logAudit(companyId, userId, "UPDATE", tableName, matchedGuid, null, { source: "bulk_patch", fields_updated: updateCols });
          details.push({ dppId: matchedGuid, product_id: normalizedProductId || undefined, status: "updated", fields_updated: updateCols });
          updated++;
        } catch (e) {
          logger.error("Bulk PATCH item error:", e.message);
          details.push({ dppId: incomingGuid, product_id: normalizedProductId || undefined, status: "failed", error: e.message });
          failed++;
        }
      }

      res.json({ summary: { updated, skipped, failed, total: passports.length }, details });
    } catch (e) {
      logger.error("Bulk PATCH error:", e.message);
      res.status(500).json({ error: "Bulk update failed", detail: e.message });
    }
  });

  // ─── RELEASE ───────────────────────────────────────────────────────────────

  app.patch("/api/companies/:companyId/passports/:dppId/release", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId: dppId } = req.params;
      const { passportType } = req.body;
      if (!passportType) return res.status(400).json({ error: "passportType required in body" });

      const currentPassport = await loadLatestLivePassport({
        companyId,
        dppId: dppId,
        passportType,
        releaseStatusSql: EDITABLE_RELEASE_STATUSES_SQL
      });
      if (!currentPassport) return res.status(404).json({ error: "Passport not found or already released" });

      const compliance = await evaluateCompliance(currentPassport, passportType);
      if (!compliance.directReleaseAllowed) {
        if (compliance.workflowRequired) {
          return res.status(409).json({
            error: "Passport is incomplete. Assign at least a reviewer or approver before it can be released.",
            code: "WORKFLOW_REQUIRED_FOR_INCOMPLETE_PASSPORT",
            compliance
          });
        }
        return res.status(422).json({
          error: "Passport failed compliance validation. Fix the blocking issues before release.",
          code: "PASSPORT_COMPLIANCE_FAILED",
          compliance
        });
      }

      const tableName = getTable(passportType);
      const r = await pool.query(
        `UPDATE ${tableName} SET release_status = 'released', updated_at = NOW()
         WHERE dpp_id = $1 AND company_id = $2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}
         RETURNING *`,
        [dppId, companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found or already released" });
      const released = r.rows[0];

      const typeDef = await complianceService.loadPassportTypeDefinition(passportType);
      const sigData = await signPassport({ ...released, passport_type: passportType }, typeDef || null);
      if (sigData) {
        await pool.query(
          `INSERT INTO passport_signatures (passport_dpp_id, version_number, data_hash, signature, algorithm, signing_key_id, released_at, vc_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (passport_dpp_id, version_number) DO NOTHING`,
          [dppId, released.version_number, sigData.dataHash, sigData.signature, sigData.legacyAlgorithm, sigData.keyId, sigData.releasedAt, sigData.vcJson || null]
        );
      }

      await markOlderVersionsObsolete(tableName, dppId, released.version_number);
      // Make all attachments for this passport publicly accessible now that it is released
      await pool.query(
        "UPDATE passport_attachments SET is_public = true WHERE passport_dpp_id = $1",
        [dppId]
      ).catch(() => {});
      await logAudit(companyId, req.user.userId, "RELEASE", tableName, dppId, { release_status: "draft_or_in_revision" }, { release_status: "released" });
      await replicatePassportToBackup({
        passport: { ...released, passport_type: passportType },
        passportType,
        reason: "release",
        snapshotScope: "released_current"
      }).catch(() => {});
      res.json({ success: true, passport: normalizePassportRow(released), compliance });
    } catch (e) {res.status(500).json({ error: "Failed to release passport" });}
  });

  // ─── REVISE ────────────────────────────────────────────────────────────────

  app.post("/api/companies/:companyId/passports/:dppId/revise", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId: dppId } = req.params;
      const { passportType } = req.body;
      const userId = req.user.userId;

      if (!passportType) return res.status(400).json({ error: "passportType required in body" });
      const tableName = getTable(passportType);

      const current = await pool.query(
        `SELECT * FROM ${tableName} WHERE dpp_id = $1 AND release_status = 'released' LIMIT 1`,
        [dppId]
      );
      if (!current.rows.length) return res.status(404).json({ error: "Released passport not found" });

      const src = current.rows[0];
      const dup = await pool.query(
        `SELECT id FROM ${tableName} WHERE lineage_id = $1 AND release_status IN ${REVISION_BLOCKING_STATUSES_SQL} AND deleted_at IS NULL`,
        [src.lineage_id]
      );
      if (dup.rows.length) return res.status(409).json({ error: "An editable revision already exists." });

      const newGuid = generateDppRecordId();
      const newVersion = src.version_number + 1;
      const excluded = new Set(["id", "dppId", "created_at", "updated_at", "updated_by", "qr_code", "lineage_id"]);
      const cols = Object.keys(src).filter((k) => !excluded.has(k));
      const vals = cols.map((k) => {
        if (k === "version_number") return newVersion;
        if (k === "release_status") return IN_REVISION_STATUS;
        if (k === "created_by") return userId;
        if (k === "deleted_at") return null;
        return src[k];
      });

      const allCols = ["dppId", "lineage_id", ...cols];
      const allVals = [newGuid, src.lineage_id, ...vals];
      const places = allCols.map((_, i) => `$${i + 1}`).join(", ");
      await pool.query(`INSERT INTO ${tableName} (${allCols.join(", ")}) VALUES (${places})`, allVals);

      const sourceRegistry = await pool.query(
        `SELECT access_key_hash, access_key_prefix, access_key_last_rotated_at,
                device_api_key_hash, device_api_key_prefix, device_key_last_rotated_at
         FROM passport_registry
         WHERE dpp_id = $1 AND company_id = $2
         LIMIT 1`,
        [dppId, companyId]
      );
      const sourceKeys = sourceRegistry.rows[0] || {};
      await insertPassportRegistry({
        dppId: newGuid,
        lineageId: src.lineage_id,
        companyId,
        passportType,
        accessKeyHash: sourceKeys.access_key_hash || null,
        accessKeyPrefix: sourceKeys.access_key_prefix || null,
        accessKeyLastRotatedAt: sourceKeys.access_key_last_rotated_at || null,
        deviceApiKeyHash: sourceKeys.device_api_key_hash || null,
        deviceApiKeyPrefix: sourceKeys.device_api_key_prefix || null,
        deviceKeyLastRotatedAt: sourceKeys.device_key_last_rotated_at || null
      });

      await logAudit(companyId, userId, "REVISE", tableName, newGuid, { version_number: src.version_number }, { version_number: newVersion });
      res.json({ success: true, dppId: newGuid, newVersion, release_status: IN_REVISION_STATUS });
    } catch (e) {res.status(500).json({ error: "Failed to revise passport" });}
  });

  // ─── BULK REVISE ───────────────────────────────────────────────────────────

  app.post("/api/companies/:companyId/passports/bulk-revise", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const {
        items, changes, revisionNote = "", submitToWorkflow = false,
        reviewerId = null, approverId = null,
        scopeType = "selected", scopeMeta = {}
      } = req.body || {};

      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items must be a non-empty array" });
      if (items.length > 500) return res.status(400).json({ error: "Maximum 500 passports per bulk revise request" });
      if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length)
      return res.status(400).json({ error: "changes must be a non-empty object" });
      if (submitToWorkflow && !reviewerId && !approverId)
      return res.status(400).json({ error: "Select at least one reviewer or approver to auto-submit revisions to workflow." });
      if (reviewerId && approverId && String(reviewerId) === String(approverId))
      return res.status(400).json({ error: "Reviewer and approver must be different users." });

      const uniqueGuids = [...new Set(items.map((item) => String(item?.dppId || "").trim()).filter(Boolean))];
      if (!uniqueGuids.length) return res.status(400).json({ error: "No valid passport GUIDs were provided." });

      const registryRes = await pool.query(
        `SELECT dpp_id, passport_type FROM passport_registry WHERE company_id = $1 AND dpp_id = ANY($2::text[])`,
        [companyId, uniqueGuids]
      );

      const registryByGuid = new Map(registryRes.rows.map((row) => [row.dppId, row.passport_type]));
      const resolvedItems = uniqueGuids.
      map((dppId) => ({ dppId: dppId, passport_type: registryByGuid.get(dppId) || null })).
      filter((item) => item.passport_type);

      if (!resolvedItems.length) return res.status(404).json({ error: "No matching passports were found for this company." });

      const passportTypes = [...new Set(resolvedItems.map((item) => item.passport_type))];
      const batchPassportType = passportTypes.length === 1 ? passportTypes[0] : null;

      const batchRes = await pool.query(
        `INSERT INTO passport_revision_batches
           (company_id, passport_type, requested_by, scope_type, scope_meta, revision_note, changes_json,
            submit_to_workflow, reviewer_id, approver_id, total_targeted)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, created_at`,
        [companyId, batchPassportType, userId, scopeType, JSON.stringify(scopeMeta || {}), revisionNote || null, JSON.stringify(changes), !!submitToWorkflow,
        reviewerId ? parseInt(reviewerId, 10) : null, approverId ? parseInt(approverId, 10) : null, resolvedItems.length]
      );
      const batch = batchRes.rows[0];

      const details = [];
      let revised = 0,skipped = 0,failed = 0;

      const groupedItems = resolvedItems.reduce((acc, item) => {
        if (!acc[item.passport_type]) acc[item.passport_type] = [];
        acc[item.passport_type].push(item.dppId);
        return acc;
      }, {});

      for (const [passportType, dppIds] of Object.entries(groupedItems)) {
        const tableName = getTable(passportType);
        const typeRes = await pool.query("SELECT fields_json, display_name FROM passport_types WHERE type_name = $1", [passportType]);
        const sections = typeRes.rows[0]?.fields_json?.sections || [];
        const fieldMap = new Map(sections.flatMap((section) => section.fields || []).map((field) => [field.key, field]));
        fieldMap.set("model_name", { key: "model_name", label: "Model Name", type: "text" });
        fieldMap.set("product_id", { key: "product_id", label: "Serial Number", type: "text" });

        const applicableChanges = Object.entries(changes).filter(([key]) => fieldMap.has(key) && /^[a-z][a-z0-9_]+$/.test(key));

        const releasedRes = await pool.query(
          `SELECT * FROM ${tableName}
           WHERE company_id = $1 AND dpp_id = ANY($2::text[]) AND release_status = 'released' AND deleted_at IS NULL`,
          [companyId, dppIds]
        );
        const releasedByGuid = new Map(releasedRes.rows.map((row) => [row.dppId, row]));

        for (const dppId of dppIds) {
          const insertBatchItem = async (status, message, sourceVersion = null, newVersion = null) => {
            await pool.query(
              `INSERT INTO passport_revision_batch_items
                 (batch_id, passport_dpp_id, passport_type, source_version_number, new_version_number, status, message)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [batch.id, dppId, passportType, sourceVersion, newVersion, status, message || null]
            );
          };

          const source = releasedByGuid.get(dppId);
          if (!source) {
            const message = "No released passport version was found for this GUID.";
            details.push({ dppId: dppId, passport_type: passportType, status: "skipped", message });
            skipped++;
            await insertBatchItem("skipped", message);
            continue;
          }

          const blockerRes = await pool.query(
            `SELECT dpp_id, version_number, release_status FROM ${tableName}
             WHERE company_id = $1 AND lineage_id = $2 AND release_status IN ${REVISION_BLOCKING_STATUSES_SQL} AND deleted_at IS NULL
             ORDER BY version_number DESC LIMIT 1`,
            [companyId, source.lineage_id]
          );
          const blocker = blockerRes.rows[0];
          if (blocker) {
            const blockerStatus = normalizeReleaseStatus(blocker.release_status);
            const message = blockerStatus === "in_review" ?
            "A revision is already in workflow for this passport." :
            "An editable revision already exists for this passport.";
            details.push({ dppId: dppId, passport_type: passportType, status: "skipped", source_version_number: source.version_number, message });
            skipped++;
            await insertBatchItem("skipped", message, source.version_number, blocker.version_number || null);
            continue;
          }

          if (!applicableChanges.length) {
            const message = "None of the requested change fields apply to this passport type.";
            details.push({ dppId: dppId, passport_type: passportType, status: "skipped", source_version_number: source.version_number, message });
            skipped++;
            await insertBatchItem("skipped", message, source.version_number, null);
            continue;
          }

          try {
            const sourceVersion = parseInt(source.version_number, 10) || 1;
            const newVersion = sourceVersion + 1;
            const newGuid = generateDppRecordId();
            const excluded = new Set(["id", "dppId", "created_at", "updated_at", "updated_by", "qr_code", "lineage_id"]);
            const columns = Object.keys(source).filter((key) => !excluded.has(key));
            const mappedChanges = Object.fromEntries(
              applicableChanges.map(([key, value]) => [key, coerceBulkFieldValue(fieldMap.get(key), value)])
            );

            const values = columns.map((key) => {
              if (key === "version_number") return newVersion;
              if (key === "release_status") return IN_REVISION_STATUS;
              if (key === "created_by") return userId;
              if (key === "deleted_at") return null;
              if (Object.prototype.hasOwnProperty.call(mappedChanges, key)) return toStoredPassportValue(mappedChanges[key]);
              return source[key];
            });

            const allColumns = ["dppId", "lineage_id", ...columns];
            const allValues = [newGuid, source.lineage_id, ...values];
            const placeholders = allColumns.map((_, index) => `$${index + 1}`).join(", ");
            await pool.query(`INSERT INTO ${tableName} (${allColumns.join(", ")}) VALUES (${placeholders})`, allValues);

            const sourceRegistry = await pool.query(
              `SELECT access_key_hash, access_key_prefix, access_key_last_rotated_at,
                      device_api_key_hash, device_api_key_prefix, device_key_last_rotated_at
               FROM passport_registry
               WHERE dpp_id = $1 AND company_id = $2
               LIMIT 1`,
              [dppId, companyId]
            );
            const sourceKeys = sourceRegistry.rows[0] || {};
            await insertPassportRegistry({
              dppId: newGuid,
              lineageId: source.lineage_id,
              companyId,
              passportType,
              accessKeyHash: sourceKeys.access_key_hash || null,
              accessKeyPrefix: sourceKeys.access_key_prefix || null,
              accessKeyLastRotatedAt: sourceKeys.access_key_last_rotated_at || null,
              deviceApiKeyHash: sourceKeys.device_api_key_hash || null,
              deviceApiKeyPrefix: sourceKeys.device_api_key_prefix || null,
              deviceKeyLastRotatedAt: sourceKeys.device_key_last_rotated_at || null
            });

            let detailStatus = submitToWorkflow ? "submitted" : "revised";
            let detailMessage = revisionNote || null;

            if (submitToWorkflow) {
              try {
                await submitPassportToWorkflow({ companyId, dppId: newGuid, passportType, userId, reviewerId, approverId });
                detailMessage = detailMessage ? `${detailMessage} Submitted to workflow.` : "Revision created and submitted to workflow.";
              } catch (workflowError) {
                detailStatus = "revised";
                detailMessage = detailMessage ?
                `${detailMessage} Workflow submission failed: ${workflowError.message}` :
                `Revision created, but workflow submission failed: ${workflowError.message}`;
              }
            }

            await logAudit(companyId, userId, "BULK_REVISE", tableName, newGuid,
            { version_number: sourceVersion, release_status: source.release_status },
            { version_number: newVersion, release_status: submitToWorkflow ? "in_review" : IN_REVISION_STATUS, batch_id: batch.id, revision_note: revisionNote || null, fields_updated: Object.keys(mappedChanges) }
            );

            details.push({ dppId: newGuid, passport_type: passportType, status: detailStatus, source_version_number: sourceVersion, new_version_number: newVersion, message: detailMessage });
            revised++;
            await insertBatchItem(detailStatus, detailMessage, sourceVersion, newVersion);
          } catch (e) {
            const message = e.message || "Bulk revise failed for this passport.";
            details.push({ dppId: dppId, passport_type: passportType, status: "failed", source_version_number: source.version_number || null, message });
            failed++;
            await insertBatchItem("failed", message, source.version_number || null, null);
          }
        }
      }

      await pool.query(
        `UPDATE passport_revision_batches SET revised_count=$1, skipped_count=$2, failed_count=$3, updated_at=NOW() WHERE id=$4`,
        [revised, skipped, failed, batch.id]
      );

      res.json({
        success: true,
        batch: { id: batch.id, created_at: batch.created_at, passport_type: batchPassportType, scope_type: scopeType },
        summary: { targeted: resolvedItems.length, revised, skipped, failed },
        details
      });
    } catch (e) {
      logger.error("Bulk revise error:", e.message);
      res.status(500).json({ error: "Bulk revise failed" });
    }
  });

  // ─── DELETE ────────────────────────────────────────────────────────────────

  app.delete("/api/companies/:companyId/passports/:dppId", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId: dppId } = req.params;
      const { passportType } = req.body;
      if (!passportType) return res.status(400).json({ error: "passportType required in body" });

      const tableName = getTable(passportType);
      const r = await pool.query(
        `UPDATE ${tableName} SET deleted_at = NOW()
         WHERE dpp_id = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
         RETURNING dpp_id`,
        [dppId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found or cannot delete a released passport" });
      await logAudit(companyId, req.user.userId, "DELETE", tableName, dppId, { dppId: dppId }, null);
      res.json({ success: true });
    } catch (e) {res.status(500).json({ error: "Failed to delete passport" });}
  });

  app.delete("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      let passport_type, identifiers;

      if (Array.isArray(req.body)) {
        identifiers = req.body;
        passport_type = identifiers[0]?.passport_type || identifiers[0]?.passportType;
      } else {
        const normalizedBody = normalizePassportRequestBody(req.body);
        passport_type = normalizedBody.passport_type;
        identifiers = normalizedBody.passports || normalizedBody.identifiers;
      }
      if (!passport_type) return res.status(400).json({ error: "passport_type required" });
      if (!Array.isArray(identifiers) || !identifiers.length) return res.status(400).json({ error: "passports or identifiers array required" });
      if (identifiers.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);

      let deleted = 0,skipped = 0,failed = 0;
      const details = [];

      for (const item of identifiers) {
        const raw = typeof item === "string" ? { product_id: item } : item || {};
        const dppId = raw.dppId;
        const productId = normalizeProductIdValue(raw.product_id || raw.productId);
        try {
          if (!dppId && !productId) {details.push({ status: "failed", error: "Each item needs a dppId or product_id" });failed++;continue;}
          let matchedGuid = null;
          if (dppId) {
            const r = await pool.query(
              `UPDATE ${tableName} SET deleted_at = NOW()
               WHERE dpp_id = $1 AND company_id = $2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
               RETURNING dpp_id`,
              [dppId, companyId]
            );
            if (r.rows.length) matchedGuid = r.rows[0].dppId;
          }
          if (!matchedGuid && productId) {
            const existing = await findExistingPassportByProductId({ tableName, companyId, productId });
            if (existing && isEditablePassportStatus(normalizeReleaseStatus(existing.release_status))) {
              const r = await pool.query(`UPDATE ${tableName} SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING dpp_id`, [existing.id]);
              if (r.rows.length) matchedGuid = r.rows[0].dppId;
            }
          }
          if (!matchedGuid) {
            details.push({ dppId: dppId || undefined, product_id: productId || undefined, status: "skipped", reason: "Not found or not deletable" });
            skipped++;continue;
          }
          await logAudit(companyId, userId, "DELETE", tableName, matchedGuid, { dppId: matchedGuid }, null);
          details.push({ dppId: matchedGuid, product_id: productId || undefined, status: "deleted" });
          deleted++;
        } catch (e) {
          details.push({ dppId: dppId || undefined, product_id: productId || undefined, status: "failed", error: e.message });
          failed++;
        }
      }

      res.json({ summary: { deleted, skipped, failed, total: identifiers.length }, details });
    } catch (e) {
      logger.error("Bulk DELETE error:", e.message);
      res.status(500).json({ error: "Bulk delete failed", detail: e.message });
    }
  });

  // ─── BULK RELEASE ──────────────────────────────────────────────────────────

  app.post("/api/companies/:companyId/passports/bulk-release", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { items } = req.body || {};

      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items must be a non-empty array of { dppId, passportType }" });
      if (items.length > 500) return res.status(400).json({ error: "Maximum 500 passports per bulk release request" });

      const invalid = items.filter((i) => !i?.dppId || !i?.passportType && !i?.passport_type);
      if (invalid.length) return res.status(400).json({ error: `${invalid.length} item(s) missing dppId or passportType` });

      let released = 0,skipped = 0,failed = 0;
      const details = [];

      for (const item of items) {
        const dppId = item?.dppId;
        const passportType = item?.passportType || item?.passport_type;
        if (!dppId || !passportType) {details.push({ dppId: dppId, status: "failed", message: "Missing dppId or passportType" });failed++;continue;}
        try {
          const tableName = getTable(passportType);
          const r = await pool.query(
            `UPDATE ${tableName} SET release_status = 'released', updated_at = NOW()
             WHERE dpp_id = $1 AND company_id = $2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
             RETURNING *`,
            [dppId, companyId]
          );
          if (!r.rows.length) {details.push({ dppId: dppId, status: "skipped", message: "Not found or already released" });skipped++;continue;}
          const releasedRow = r.rows[0];

          const typeRes = await pool.query("SELECT * FROM passport_types WHERE type_name = $1", [passportType]);
          const sigData = await signPassport({ ...releasedRow, passport_type: passportType }, typeRes.rows[0] || null);
          if (sigData) {
            await pool.query(
              `INSERT INTO passport_signatures (passport_dpp_id, version_number, data_hash, signature, algorithm, signing_key_id, released_at, vc_json)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (passport_dpp_id, version_number) DO NOTHING`,
              [dppId, releasedRow.version_number, sigData.dataHash, sigData.signature, sigData.legacyAlgorithm, sigData.keyId, sigData.releasedAt, sigData.vcJson || null]
            );
          }

          await markOlderVersionsObsolete(tableName, dppId, releasedRow.version_number);
          await logAudit(companyId, userId, "RELEASE", tableName, dppId, { release_status: "draft_or_in_revision" }, { release_status: "released" });
          details.push({ dppId: dppId, status: "released", version: releasedRow.version_number });
          released++;
        } catch (e) {details.push({ dppId: dppId, status: "failed", message: e.message });failed++;}
      }

      res.json({ summary: { released, skipped, failed, total: items.length }, details });
    } catch (e) {
      logger.error("Bulk release error:", e.message);
      res.status(500).json({ error: "Bulk release failed", detail: e.message });
    }
  });

  // ─── BULK WORKFLOW ─────────────────────────────────────────────────────────

  app.post("/api/companies/:companyId/passports/bulk-workflow", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { items, reviewerId, approverId } = req.body || {};

      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items must be a non-empty array of { dppId, passportType }" });
      if (items.length > 500) return res.status(400).json({ error: "Maximum 500 passports per bulk workflow request" });
      if (!reviewerId && !approverId) return res.status(400).json({ error: "Select at least one reviewer or approver." });

      const invalid = items.filter((i) => !i?.dppId || !i?.passportType && !i?.passport_type);
      if (invalid.length) return res.status(400).json({ error: `${invalid.length} item(s) missing dppId or passportType` });

      let submitted = 0,skipped = 0,failed = 0;
      const details = [];

      for (const item of items) {
        const dppId = item?.dppId;
        const passportType = item?.passportType || item?.passport_type;
        if (!dppId || !passportType) {details.push({ dppId: dppId, status: "failed", message: "Missing dppId or passportType" });failed++;continue;}
        try {
          await submitPassportToWorkflow({ companyId, dppId: dppId, passportType, userId, reviewerId, approverId });
          details.push({ dppId: dppId, status: "submitted" });
          submitted++;
        } catch (e) {details.push({ dppId: dppId, status: "skipped", message: e.message });skipped++;}
      }

      res.json({ summary: { submitted, skipped, failed, total: items.length }, details });
    } catch (e) {
      logger.error("Bulk workflow error:", e.message);
      res.status(500).json({ error: "Bulk workflow submit failed", detail: e.message });
    }
  });

  // ─── ARCHIVE ───────────────────────────────────────────────────────────────

  app.post("/api/companies/:companyId/passports/:dppId/archive", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId: dppId } = req.params;
      const { passportType } = req.body;
      const userId = req.user.userId;
      if (!passportType) return res.status(400).json({ error: "passportType required" });

      const tableName = getTable(passportType);
      const lineageContext = await getPassportLineageContext({ dppId: dppId, passportType, companyId });
      if (!lineageContext?.lineage_id) return res.status(404).json({ error: "Passport not found" });

      const rows = await pool.query(
        `SELECT * FROM ${tableName} WHERE lineage_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [lineageContext.lineage_id, companyId]
      );
      if (!rows.rows.length) return res.status(404).json({ error: "Passport not found" });

      for (const row of rows.rows) {
        const { id, deleted_at, ...rowData } = row;
        await pool.query(
          `INSERT INTO passport_archives (dpp_id, lineage_id, company_id, passport_type, version_number, model_name, product_id, product_identifier_did, release_status, row_data, archived_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [row.dppId, row.lineage_id, companyId, passportType, row.version_number, row.model_name, row.product_id, row.product_identifier_did || null, row.release_status, JSON.stringify(rowData), userId]
        );
      }
      await pool.query(
        `UPDATE ${tableName} SET deleted_at = NOW() WHERE lineage_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [lineageContext.lineage_id, companyId]
      );
      for (const row of rows.rows) {
        await replicatePassportToBackup({
          passport: { ...row, passport_type: passportType },
          passportType,
          reason: "archive",
          snapshotScope: "archived_history"
        }).catch(() => {});
      }

      await logAudit(companyId, userId, "ARCHIVE", tableName, dppId, null, { versions_archived: rows.rows.length });
      res.json({ success: true, versions_archived: rows.rows.length });
    } catch (e) {
      logger.error("Archive error:", e.message);
      res.status(500).json({ error: "Failed to archive passport" });
    }
  });

  app.post("/api/companies/:companyId/passports/bulk-archive", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { items } = req.body || {};
      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items required" });
      if (items.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      const invalid = items.filter((i) => !i?.dppId || !i?.passportType && !i?.passport_type);
      if (invalid.length) return res.status(400).json({ error: `${invalid.length} item(s) missing dppId or passportType` });

      let archived = 0,skipped = 0;
      for (const item of items) {
        const dppId = item?.dppId;
        const passportType = item?.passportType || item?.passport_type;
        if (!dppId || !passportType) {skipped++;continue;}
        try {
          const tableName = getTable(passportType);
          const lineageContext = await getPassportLineageContext({ dppId: dppId, passportType, companyId });
          if (!lineageContext?.lineage_id) {skipped++;continue;}
          const rows = await pool.query(
            `SELECT * FROM ${tableName} WHERE lineage_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [lineageContext.lineage_id, companyId]
          );
          if (!rows.rows.length) {skipped++;continue;}
          for (const row of rows.rows) {
            const { id, deleted_at, ...rowData } = row;
            await pool.query(
              `INSERT INTO passport_archives (dpp_id, lineage_id, company_id, passport_type, version_number, model_name, product_id, product_identifier_did, release_status, row_data, archived_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [row.dppId, row.lineage_id, companyId, passportType, row.version_number, row.model_name, row.product_id, row.product_identifier_did || null, row.release_status, JSON.stringify(rowData), userId]
            );
          }
          await pool.query(
            `UPDATE ${tableName} SET deleted_at = NOW() WHERE lineage_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [lineageContext.lineage_id, companyId]
          );
          for (const row of rows.rows) {
            await replicatePassportToBackup({
              passport: { ...row, passport_type: passportType },
              passportType,
              reason: "bulk_archive",
              snapshotScope: "archived_history"
            }).catch(() => {});
          }
          await logAudit(companyId, userId, "ARCHIVE", tableName, dppId, null, { versions_archived: rows.rows.length });
          archived++;
        } catch {skipped++;}
      }
      res.json({ summary: { archived, skipped, total: items.length } });
    } catch (e) {
      logger.error("Bulk archive error:", e.message);
      res.status(500).json({ error: "Bulk archive failed" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/unarchive", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId: dppId } = req.params;
      const userId = req.user.userId;

      const archiveContext = await pool.query(
        `SELECT lineage_id FROM passport_archives WHERE (dpp_id = $1 OR lineage_id = $1) AND company_id = $2 ORDER BY version_number DESC LIMIT 1`,
        [dppId, companyId]
      );
      if (!archiveContext.rows.length) return res.status(404).json({ error: "Archived passport not found" });

      const archiveRows = await pool.query(
        `SELECT * FROM passport_archives WHERE lineage_id = $1 AND company_id = $2 ORDER BY version_number ASC`,
        [archiveContext.rows[0].lineage_id, companyId]
      );
      if (!archiveRows.rows.length) return res.status(404).json({ error: "Archived passport not found" });

      const passportType = archiveRows.rows[0].passport_type;
      const tableName = getTable(passportType);

      for (const ar of archiveRows.rows) {
        const existing = await pool.query(
          `SELECT id FROM ${tableName} WHERE dpp_id = $1 AND version_number = $2`,
          [ar.dppId, ar.version_number]
        );
        if (existing.rows.length) {
          await pool.query(`UPDATE ${tableName} SET deleted_at = NULL WHERE dpp_id = $1 AND version_number = $2`, [ar.dppId, ar.version_number]);
        }
      }
      await pool.query(
        `UPDATE ${tableName} SET deleted_at = NULL WHERE lineage_id = $1 AND company_id = $2`,
        [archiveRows.rows[0].lineage_id, companyId]
      );
      await pool.query(`DELETE FROM passport_archives WHERE lineage_id = $1 AND company_id = $2`, [archiveRows.rows[0].lineage_id, companyId]);

      await logAudit(companyId, userId, "UNARCHIVE", tableName, dppId, null, { versions_restored: archiveRows.rows.length });
      res.json({ success: true, versions_restored: archiveRows.rows.length });
    } catch (e) {
      logger.error("Unarchive error:", e.message);
      res.status(500).json({ error: "Failed to unarchive passport" });
    }
  });

  app.post("/api/companies/:companyId/passports/bulk-unarchive", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { dppIds } = req.body || {};
      if (!Array.isArray(dppIds) || !dppIds.length) return res.status(400).json({ error: "dppIds required" });
      if (dppIds.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      let restored = 0,skipped = 0;
      for (const dppId of dppIds) {
        try {
          const contextRes = await pool.query(
            `SELECT lineage_id, passport_type FROM passport_archives WHERE (dpp_id = $1 OR lineage_id = $1) AND company_id = $2 ORDER BY version_number DESC LIMIT 1`,
            [dppId, companyId]
          );
          if (!contextRes.rows.length) {skipped++;continue;}
          const lineageId = contextRes.rows[0].lineage_id;
          const archiveRows = await pool.query(`SELECT * FROM passport_archives WHERE lineage_id = $1 AND company_id = $2`, [lineageId, companyId]);
          if (!archiveRows.rows.length) {skipped++;continue;}
          const passportType = archiveRows.rows[0].passport_type;
          const tableName = getTable(passportType);
          await pool.query(`UPDATE ${tableName} SET deleted_at = NULL WHERE lineage_id = $1 AND company_id = $2`, [lineageId, companyId]);
          await pool.query(`DELETE FROM passport_archives WHERE lineage_id = $1 AND company_id = $2`, [lineageId, companyId]);
          await logAudit(companyId, userId, "UNARCHIVE", tableName, dppId, null, { versions_restored: archiveRows.rows.length });
          restored++;
        } catch {skipped++;}
      }
      res.json({ summary: { restored, skipped, total: dppIds.length } });
    } catch (e) {
      logger.error("Bulk unarchive error:", e.message);
      res.status(500).json({ error: "Bulk unarchive failed" });
    }
  });

  // ─── DIFF & HISTORY ────────────────────────────────────────────────────────

  app.get("/api/companies/:companyId/passports/:dppId/diff", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { dppId: dppId } = req.params;
      const { passportType } = req.query;
      if (!passportType) return res.status(400).json({ error: "passportType required" });

      const lineageContext = await getPassportLineageContext({ dppId: dppId, passportType, companyId: req.params.companyId });
      if (!lineageContext?.lineage_id) return res.status(404).json({ error: "Passport not found" });
      const versions = await getPassportVersionsByLineage({ lineageId: lineageContext.lineage_id, passportType, companyId: req.params.companyId });
      res.json({ versions: [...versions].sort((a, b) => Number(a.version_number || 0) - Number(b.version_number || 0)), passportType });
    } catch (e) {res.status(500).json({ error: "Failed" });}
  });

  app.get("/api/companies/:companyId/passports/:dppId/history", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, dppId: dppId } = req.params;
      const reg = await pool.query(
        `SELECT passport_type FROM passport_registry WHERE dpp_id = $1 AND company_id = $2`,
        [dppId, companyId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const passportType = reg.rows[0].passport_type;
      const historyPayload = await buildPassportVersionHistory({ dppId: dppId, passportType, companyId, publicOnly: false });
      res.json(historyPayload);
    } catch (e) {res.status(500).json({ error: "Failed to fetch passport history" });}
  });

  app.patch("/api/companies/:companyId/passports/:dppId/history/:versionNumber", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId: dppId, versionNumber } = req.params;
      const { isPublic } = req.body || {};
      const parsedVersion = parseInt(versionNumber, 10);

      if (!Number.isFinite(parsedVersion) || parsedVersion < 1) return res.status(400).json({ error: "A valid version number is required." });
      if (typeof isPublic !== "boolean") return res.status(400).json({ error: "isPublic must be true or false." });

      const reg = await pool.query(
        `SELECT passport_type FROM passport_registry WHERE dpp_id = $1 AND company_id = $2`,
        [dppId, companyId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const passportType = reg.rows[0].passport_type;
      const lineageContext = await getPassportLineageContext({ dppId: dppId, passportType, companyId });
      if (!lineageContext?.lineage_id) return res.status(404).json({ error: "Passport not found" });

      const tableName = getTable(passportType);
      const versionRes = await pool.query(
        `SELECT dpp_id, version_number, release_status FROM ${tableName}
         WHERE lineage_id = $1 AND company_id = $2 AND version_number = $3 AND deleted_at IS NULL LIMIT 1`,
        [lineageContext.lineage_id, companyId, parsedVersion]
      );
      if (!versionRes.rows.length) return res.status(404).json({ error: "Passport version not found" });

      const versionRow = normalizePassportRow(versionRes.rows[0]);
      if (!isPublicHistoryStatus(versionRow.release_status) && isPublic)
      return res.status(400).json({ error: "Only released or obsolete versions can be shown publicly." });

      const existingVisibilityRes = await pool.query(
        `SELECT is_public FROM passport_history_visibility WHERE passport_dpp_id = $1 AND version_number = $2`,
        [versionRow.dppId, parsedVersion]
      );
      const previousVisibility = existingVisibilityRes.rows.length ?
      !!existingVisibilityRes.rows[0].is_public :
      isPublicHistoryStatus(versionRow.release_status);

      await pool.query(
        `INSERT INTO passport_history_visibility (passport_dpp_id, version_number, is_public, updated_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,NOW(),NOW())
         ON CONFLICT (passport_dpp_id, version_number) DO UPDATE SET is_public = EXCLUDED.is_public, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [versionRow.dppId, parsedVersion, isPublic, req.user.userId]
      );

      await logAudit(companyId, req.user.userId, "UPDATE_HISTORY_VISIBILITY", tableName, dppId,
      { version_number: parsedVersion, is_public: previousVisibility },
      { version_number: parsedVersion, is_public: isPublic }
      );

      res.json({ success: true, version_number: parsedVersion, is_public: isPublic });
    } catch (e) {res.status(500).json({ error: "Failed to update history visibility" });}
  });

  // ─── FILE UPLOAD ───────────────────────────────────────────────────────────

  app.post(
    "/api/companies/:companyId/passports/:dppId/upload",
    authenticateToken, checkCompanyAccess, requireEditor, upload.single("file"),
    async (req, res) => {
      try {
        const { companyId, dppId: dppId } = req.params;
        const { fieldKey, passportType } = req.body;
        if (!req.file) return res.status(400).json({ error: "No file received" });
        if (!fieldKey || !passportType) {
          return res.status(400).json({ error: "fieldKey and passportType required" });
        }
        if (!/^[a-zA-Z][a-zA-Z0-9_]+$/.test(fieldKey)) {
          return res.status(400).json({ error: "Invalid fieldKey" });
        }

        const tableName = getTable(passportType);
        const stored = await storageService.savePassportFile({
          dppId: dppId,
          fieldKey,
          originalName: req.file.originalname,
          buffer: req.file.buffer,
          contentType: req.file.mimetype
        });
        const fileUrl = stored.url;

        const row = await pool.query(
          `SELECT id FROM ${tableName}
           WHERE dpp_id = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
           ORDER BY version_number DESC LIMIT 1`,
          [dppId]
        );
        if (!row.rows.length) {
          return res.status(404).json({ error: "Editable passport not found" });
        }

        // Register in passport_attachments with an opaque public_id for app-mediated serving
        const publicId = crypto.randomBytes(10).toString("base64url").slice(0, 16);
        const appUrl = process.env.APP_URL || "http://localhost:3001";
        const publicFileUrl = `${appUrl}/public-files/${publicId}`;
        await pool.query(
          `INSERT INTO passport_attachments
             (public_id, company_id, passport_dpp_id, field_key, file_path, storage_key, storage_provider, file_url, mime_type, size_bytes, is_public)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false)
           ON CONFLICT (public_id) DO NOTHING`,
          [
          publicId, companyId, dppId, fieldKey,
          stored.path || null,
          stored.storageKey || null,
          stored.provider || null,
          fileUrl,
          req.file.mimetype || "application/octet-stream",
          req.file.size || null]

        ).catch(() => {});

        await pool.query(
          `UPDATE ${tableName} SET ${fieldKey} = $1, updated_at = NOW() WHERE id = $2`,
          [publicFileUrl, row.rows[0].id]
        );
        await logAudit(companyId, req.user.userId, "UPLOAD", tableName, dppId, null, { fieldKey, publicFileUrl });
        res.json({ success: true, url: publicFileUrl, fieldKey });
      } catch (e) {
        if (e.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large. Max 20 MB." });
        res.status(500).json({ error: "Upload failed" });
      }
    }
  );

  // ─── ANALYTICS, ACTIVITY, AUDIT LOGS ──────────────────────────────────────

  app.get("/api/companies/:companyId/analytics", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;

      const accessRes = await pool.query(`
        SELECT pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon
        FROM company_passport_access cpa
        JOIN passport_types pt ON pt.id = cpa.passport_type_id
        WHERE cpa.company_id = $1
      `, [companyId]);

      let totalPassports = 0;
      const analytics = [];
      const trendMonths = [];
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonthIndex = now.getMonth();
      const trendStart = new Date(currentYear, 0, 1);

      for (let monthIndex = 0; monthIndex <= currentMonthIndex; monthIndex += 1) {
        trendMonths.push(new Date(currentYear, monthIndex, 1));
      }
      const trendSeriesMap = {};

      for (const { type_name, display_name, umbrella_category, umbrella_icon } of accessRes.rows) {
        try {
          const stats = await queryTableStats(type_name, companyId);
          if (stats.total === 0) continue;
          totalPassports += stats.total;
          analytics.push({ passport_type: type_name, display_name, umbrella_category, umbrella_icon, draft_count: stats.draft, released_count: stats.released, revised_count: stats.revised, in_review_count: stats.in_review, obsolete_count: stats.obsolete });

          const tableName = getTable(type_name);
          const baselineRes = await pool.query(
            `SELECT COUNT(*) AS count FROM ${tableName} WHERE company_id = $1 AND deleted_at IS NULL AND created_at < $2`,
            [companyId, trendStart.toISOString()]
          );
          const monthlyRes = await pool.query(
            `SELECT date_trunc('month', created_at) AS month_bucket, COUNT(*) AS count
             FROM ${tableName}
             WHERE company_id = $1 AND deleted_at IS NULL AND created_at >= $2
             GROUP BY 1 ORDER BY 1`,
            [companyId, trendStart.toISOString()]
          );

          if (!trendSeriesMap[umbrella_category]) {
            trendSeriesMap[umbrella_category] = {
              umbrella_category, umbrella_icon, baseline: 0,
              monthlyCounts: Object.fromEntries(trendMonths.map((month) => [month.toISOString().slice(0, 7), 0]))
            };
          }
          trendSeriesMap[umbrella_category].baseline += parseInt(baselineRes.rows[0]?.count || 0, 10);
          monthlyRes.rows.forEach((row) => {
            const key = new Date(row.month_bucket).toISOString().slice(0, 7);
            trendSeriesMap[umbrella_category].monthlyCounts[key] = (trendSeriesMap[umbrella_category].monthlyCounts[key] || 0) + parseInt(row.count || 0, 10);
          });
        } catch (e) {logger.error(`Analytics error for ${companyId}/${type_name}:`, e.message);}
      }

      const scanRes = await pool.query(
        `SELECT COUNT(DISTINCT (pse.passport_dpp_id, pse.viewer_user_id)) FROM passport_scan_events pse
         JOIN passport_registry pr ON pr.dpp_id = pse.passport_dpp_id
         WHERE pr.company_id = $1 AND pse.viewer_user_id IS NOT NULL`,
        [companyId]
      );
      const scanStats = parseInt(scanRes.rows[0].count) || 0;
      const archivedRes = await pool.query(`SELECT COUNT(DISTINCT dpp_id) FROM passport_archives WHERE company_id = $1`, [companyId]);
      const archivedCount = parseInt(archivedRes.rows[0].count) || 0;
      totalPassports += archivedCount;

      const trend = {
        labels: trendMonths.map((month) => month.toLocaleString("en-US", { month: "short" })),
        series: Object.values(trendSeriesMap).map((series) => {
          let running = series.baseline;
          return {
            umbrella_category: series.umbrella_category,
            umbrella_icon: series.umbrella_icon,
            values: trendMonths.map((month) => {const key = month.toISOString().slice(0, 7);running += series.monthlyCounts[key] || 0;return running;})
          };
        })
      };

      res.json({ totalPassports, analytics, scanStats, archivedCount, trend });
    } catch (e) {res.status(500).json({ error: "Failed to fetch analytics" });}
  });

  app.get("/api/companies/:companyId/activity", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
      const r = await pool.query(
        `SELECT al.*, u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         WHERE al.company_id = $1 ORDER BY al.created_at DESC LIMIT $2`,
        [req.params.companyId, limit]
      );
      res.json(r.rows);
    } catch {res.status(500).json({ error: "Failed" });}
  });

  app.get("/api/companies/:companyId/audit-logs", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 500);
      const offset = Math.max(parseInt(req.query.offset) || 0, 0);
      const r = await pool.query(
        `SELECT al.*, u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         WHERE al.company_id = $1 ORDER BY al.created_at DESC LIMIT $2 OFFSET $3`,
        [req.params.companyId, limit, offset]
      );
      res.json(r.rows);
    } catch {res.status(500).json({ error: "Failed to fetch audit logs" });}
  });

  app.get("/api/companies/:companyId/audit-logs/integrity", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const report = await verifyAuditLogChain(Number.parseInt(req.params.companyId, 10));
      res.json(report);
    } catch {
      res.status(500).json({ error: "Failed to verify audit log integrity" });
    }
  });

  app.get("/api/companies/:companyId/audit-logs/root", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const summary = await buildAuditLogRootSummary(Number.parseInt(req.params.companyId, 10));
      res.json(summary);
    } catch {
      res.status(500).json({ error: "Failed to build audit log root summary" });
    }
  });

  app.get("/api/companies/:companyId/audit-logs/anchors", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const companyId = Number.parseInt(req.params.companyId, 10);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
      const anchors = await listAuditLogAnchors(companyId);
      res.json({
        companyId,
        anchors: anchors.slice(0, limit),
      });
    } catch {
      res.status(500).json({ error: "Failed to list audit log anchors" });
    }
  });

  app.post("/api/companies/:companyId/audit-logs/anchors", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const companyId = Number.parseInt(req.params.companyId, 10);
      const anchorType = String(req.body?.anchorType || req.body?.anchor_type || "internal_record").trim() || "internal_record";
      const anchorReference = req.body?.anchorReference ?? req.body?.anchor_reference ?? null;
      const notes = req.body?.notes ?? null;
      const metadata = req.body?.metadata ?? req.body?.metadata_json ?? {};
      const anchored = await anchorAuditLogRoot({
        companyId,
        anchoredBy: req.user?.userId || null,
        anchorType,
        anchorReference: anchorReference == null ? null : String(anchorReference),
        notes: notes == null ? null : String(notes),
        metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {},
      });
      res.status(201).json(anchored);
    } catch {
      res.status(500).json({ error: "Failed to anchor audit log root" });
    }
  });

  function canViewGrantCompany(req, companyId) {
    return req.user?.role === "super_admin" || String(req.user?.companyId) === String(companyId);
  }

  function canManageGrantCompany(req, companyId) {
    return req.user?.role === "super_admin" || (
      req.user?.role === "company_admin" &&
      String(req.user?.companyId) === String(companyId)
    );
  }

  function parseGrantExpiry(rawValue) {
    if (rawValue === undefined) return { provided: false, value: undefined };
    if (rawValue === null || rawValue === "") return { provided: true, value: null };
    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
      return { error: "expires_at must be a valid ISO timestamp" };
    }
    return { provided: true, value: parsed };
  }

  function normalizeGrantElementPath(rawValue) {
    if (rawValue === undefined) return { provided: false, value: undefined };
    if (rawValue === null) return { provided: true, value: null };
    const trimmed = String(rawValue).trim();
    if (!trimmed) return { provided: true, value: null };
    return {
      provided: true,
      value: accessRightsService?.normalizeGrantElementIdPath?.(trimmed) || trimmed,
    };
  }

  function normalizeAccessGrantPayload(body = {}, options = {}) {
    const audience = body.audience !== undefined ? String(body.audience || "").trim() : undefined;
    if (options.requireAudience && (!audience || !accessRightsService.VALID_AUDIENCES.has(audience) || audience === "public")) {
      return { error: "audience must be a non-public supported audience" };
    }
    if (audience !== undefined && audience && (!accessRightsService.VALID_AUDIENCES.has(audience) || audience === "public")) {
      return { error: "audience must be a non-public supported audience" };
    }

    const dppId = body.dppId ?? body.passport_dpp_id ?? body.passportDppId;
    const normalizedDppId = dppId !== undefined ? String(dppId || "").trim() : undefined;
    if (options.requireDppId && !normalizedDppId) {
      return { error: "dppId is required" };
    }

    const granteeUserInput = body.granteeUserId ?? body.grantee_user_id;
    const hasGranteeUserId = granteeUserInput !== undefined;
    const granteeUserId = hasGranteeUserId ? Number.parseInt(granteeUserInput, 10) : undefined;
    if (options.requireGranteeUserId && !Number.isFinite(granteeUserId)) {
      return { error: "grantee_user_id is required" };
    }
    if (hasGranteeUserId && !Number.isFinite(granteeUserId)) {
      return { error: "grantee_user_id must be a valid integer" };
    }

    const expiry = parseGrantExpiry(body.expiresAt ?? body.expires_at);
    if (expiry.error) return expiry;

    const elementPath = normalizeGrantElementPath(body.elementIdPath ?? body.element_id_path);
    if (elementPath.error) return elementPath;

    return {
      dppId: normalizedDppId,
      audience,
      granteeUserId,
      reason: body.reason !== undefined ? (body.reason || null) : undefined,
      expiresAt: expiry.value,
      expiresAtProvided: expiry.provided,
      elementIdPath: elementPath.value,
      elementIdPathProvided: elementPath.provided,
      isActive: body.isActive ?? body.is_active,
    };
  }

  async function resolvePassportGrantTarget(dppId) {
    const result = await pool.query(
      `SELECT dpp_id AS "dppId", lineage_id, company_id, passport_type
       FROM passport_registry
       WHERE dpp_id = $1
       LIMIT 1`,
      [dppId]
    );
    return result.rows[0] || null;
  }

  async function loadPassportAccessGrant(grantId) {
    const result = await pool.query(
      `SELECT pag.*,
              pr.lineage_id,
              pr.passport_type
       FROM passport_access_grants pag
       LEFT JOIN passport_registry pr ON pr.dpp_id = pag.passport_dpp_id
       WHERE pag.id = $1
       LIMIT 1`,
      [grantId]
    );
    return result.rows[0] || null;
  }

  function mapPassportAccessGrantRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      dppId: row.passport_dpp_id,
      passport_dpp_id: row.passport_dpp_id,
      companyId: row.company_id,
      company_id: row.company_id,
      audience: row.audience,
      elementIdPath: row.element_id_path,
      element_id_path: row.element_id_path,
      granteeUserId: row.grantee_user_id,
      grantee_user_id: row.grantee_user_id,
      grantedBy: row.granted_by,
      granted_by: row.granted_by,
      reason: row.reason,
      expiresAt: row.expires_at,
      expires_at: row.expires_at,
      isActive: row.is_active,
      is_active: row.is_active,
      createdAt: row.created_at,
      created_at: row.created_at,
      updatedAt: row.updated_at,
      updated_at: row.updated_at,
      granteeEmail: row.grantee_email,
      grantee_email: row.grantee_email,
      granteeFirstName: row.grantee_first_name,
      grantee_first_name: row.grantee_first_name,
      granteeLastName: row.grantee_last_name,
      grantee_last_name: row.grantee_last_name,
      grantorEmail: row.grantor_email,
      grantor_email: row.grantor_email,
      passportType: row.passport_type,
      passport_type: row.passport_type,
      lineageId: row.lineage_id,
      lineage_id: row.lineage_id,
    };
  }

  app.get("/api/passports/:dppId/access-grants", authenticateToken, async (req, res) => {
    try {
      const dppId = String(req.params.dppId || "").trim();
      if (!dppId) return res.status(400).json({ error: "dppId is required" });

      const target = await resolvePassportGrantTarget(dppId);
      if (!target) return res.status(404).json({ error: "Passport not found" });
      if (!canViewGrantCompany(req, target.company_id)) {
        return res.status(403).json({ error: "Unauthorised access to this company" });
      }

      const result = await pool.query(
        `SELECT pag.id, pag.passport_dpp_id, pag.company_id, pag.audience, pag.element_id_path,
                pag.grantee_user_id, pag.granted_by, pag.reason, pag.expires_at, pag.is_active,
                pag.created_at, pag.updated_at,
                pr.passport_type, pr.lineage_id,
                grantee.email AS grantee_email, grantee.first_name AS grantee_first_name, grantee.last_name AS grantee_last_name,
                grantor.email AS grantor_email
         FROM passport_access_grants pag
         LEFT JOIN passport_registry pr ON pr.dpp_id = pag.passport_dpp_id
         LEFT JOIN users grantee ON grantee.id = pag.grantee_user_id
         LEFT JOIN users grantor ON grantor.id = pag.granted_by
         WHERE pag.company_id = $1
           AND pag.passport_dpp_id = $2
         ORDER BY pag.created_at DESC`,
        [target.company_id, dppId]
      );

      res.json({
        dppId,
        companyId: target.company_id,
        grants: result.rows.map(mapPassportAccessGrantRow),
      });
    } catch {
      res.status(500).json({ error: "Failed to fetch passport access grants" });
    }
  });

  app.post("/api/access-grants", authenticateToken, async (req, res) => {
    try {
      const parsed = normalizeAccessGrantPayload(req.body, {
        requireDppId: true,
        requireAudience: true,
        requireGranteeUserId: true,
      });
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const target = await resolvePassportGrantTarget(parsed.dppId);
      if (!target) return res.status(404).json({ error: "Passport not found" });
      if (!canManageGrantCompany(req, target.company_id)) {
        return res.status(403).json({ error: "Company admin access required" });
      }

      const result = await pool.query(
        `INSERT INTO passport_access_grants (
           passport_dpp_id, company_id, audience, element_id_path, grantee_user_id, granted_by, reason, expires_at, is_active, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
         ON CONFLICT (passport_dpp_id, audience, grantee_user_id, element_id_path)
         DO UPDATE SET
           granted_by = EXCLUDED.granted_by,
           reason = EXCLUDED.reason,
           expires_at = EXCLUDED.expires_at,
           is_active = true,
           updated_at = NOW()
         RETURNING *`,
        [
          parsed.dppId,
          target.company_id,
          parsed.audience,
          parsed.elementIdPath || null,
          parsed.granteeUserId,
          req.user.userId,
          parsed.reason ?? null,
          parsed.expiresAt ?? null,
        ]
      );

      await logAudit(
        target.company_id,
        req.user.userId,
        "GRANT_PASSPORT_AUDIENCE",
        "passport_access_grants",
        parsed.dppId,
        null,
        {
          audience: parsed.audience,
          grantee_user_id: parsed.granteeUserId,
          element_id_path: parsed.elementIdPath || null,
          expires_at: parsed.expiresAt ? parsed.expiresAt.toISOString() : null,
        },
        { audience: parsed.audience }
      );

      res.status(201).json({
        success: true,
        grant: mapPassportAccessGrantRow(result.rows[0]),
      });
    } catch (error) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "An equivalent access grant already exists" });
      }
      res.status(500).json({ error: "Failed to create access grant" });
    }
  });

  app.patch("/api/access-grants/:grantId", authenticateToken, async (req, res) => {
    try {
      const grantId = Number.parseInt(req.params.grantId, 10);
      if (!Number.isFinite(grantId)) return res.status(400).json({ error: "grantId must be a valid integer" });

      const existing = await loadPassportAccessGrant(grantId);
      if (!existing) return res.status(404).json({ error: "Grant not found" });
      if (!canManageGrantCompany(req, existing.company_id)) {
        return res.status(403).json({ error: "Company admin access required" });
      }

      const parsed = normalizeAccessGrantPayload(req.body || {});
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const updates = [];
      const values = [];
      let index = 1;

      if (parsed.audience !== undefined) {
        updates.push(`audience = $${index++}`);
        values.push(parsed.audience);
      }
      if (parsed.elementIdPathProvided) {
        updates.push(`element_id_path = $${index++}`);
        values.push(parsed.elementIdPath || null);
      }
      if (parsed.granteeUserId !== undefined) {
        updates.push(`grantee_user_id = $${index++}`);
        values.push(parsed.granteeUserId);
      }
      if (parsed.reason !== undefined) {
        updates.push(`reason = $${index++}`);
        values.push(parsed.reason);
      }
      if (parsed.expiresAtProvided) {
        updates.push(`expires_at = $${index++}`);
        values.push(parsed.expiresAt ?? null);
      }
      if (parsed.isActive !== undefined) {
        updates.push(`is_active = $${index++}`);
        values.push(Boolean(parsed.isActive));
      }

      updates.push(`updated_at = NOW()`);
      updates.push(`granted_by = $${index++}`);
      values.push(req.user.userId);

      if (updates.length <= 2) {
        return res.status(400).json({ error: "No supported access grant fields were provided" });
      }

      values.push(grantId);
      const result = await pool.query(
        `UPDATE passport_access_grants
         SET ${updates.join(", ")}
         WHERE id = $${index}
         RETURNING *`,
        values
      );

      await logAudit(
        existing.company_id,
        req.user.userId,
        "UPDATE_PASSPORT_ACCESS_GRANT",
        "passport_access_grants",
        existing.passport_dpp_id,
        existing,
        result.rows[0],
        { audience: result.rows[0]?.audience || existing.audience }
      );

      res.json({
        success: true,
        grant: mapPassportAccessGrantRow(result.rows[0]),
      });
    } catch (error) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "An equivalent access grant already exists" });
      }
      res.status(500).json({ error: "Failed to update access grant" });
    }
  });

  app.delete("/api/access-grants/:grantId", authenticateToken, async (req, res) => {
    try {
      const grantId = Number.parseInt(req.params.grantId, 10);
      if (!Number.isFinite(grantId)) return res.status(400).json({ error: "grantId must be a valid integer" });

      const existing = await loadPassportAccessGrant(grantId);
      if (!existing) return res.status(404).json({ error: "Grant not found" });
      if (!canManageGrantCompany(req, existing.company_id)) {
        return res.status(403).json({ error: "Company admin access required" });
      }

      const result = await pool.query(
        `DELETE FROM passport_access_grants
         WHERE id = $1
         RETURNING *`,
        [grantId]
      );

      await logAudit(
        existing.company_id,
        req.user.userId,
        "DELETE_PASSPORT_ACCESS_GRANT",
        "passport_access_grants",
        existing.passport_dpp_id,
        existing,
        null,
        { audience: existing.audience }
      );

      res.json({
        success: true,
        deleted: true,
        grant: mapPassportAccessGrantRow(result.rows[0]),
      });
    } catch {
      res.status(500).json({ error: "Failed to delete access grant" });
    }
  });

  app.post("/api/access-grants/:grantId/revoke", authenticateToken, async (req, res) => {
    try {
      const grantId = Number.parseInt(req.params.grantId, 10);
      if (!Number.isFinite(grantId)) return res.status(400).json({ error: "grantId must be a valid integer" });

      const existing = await loadPassportAccessGrant(grantId);
      if (!existing) return res.status(404).json({ error: "Grant not found" });
      if (!canManageGrantCompany(req, existing.company_id)) {
        return res.status(403).json({ error: "Company admin access required" });
      }

      const reason = req.body?.reason !== undefined ? (req.body.reason || existing.reason || null) : existing.reason;
      const result = await pool.query(
        `UPDATE passport_access_grants
         SET is_active = false,
             reason = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [grantId, reason]
      );

      await logAudit(
        existing.company_id,
        req.user.userId,
        "REVOKE_PASSPORT_AUDIENCE",
        "passport_access_grants",
        existing.passport_dpp_id,
        existing,
        { ...result.rows[0], revoked: true },
        { audience: existing.audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: existing.company_id,
        eventType: "PASSPORT_ACCESS_GRANT_REVOKED",
        severity: "high",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: existing.grantee_user_id,
        affectedGrantId: grantId,
        passportDppId: existing.passport_dpp_id,
        audience: existing.audience,
        elementIdPath: existing.element_id_path,
        revocationMode: "standard",
        reason,
      }).catch(() => {});

      res.json({
        success: true,
        revoked: true,
        emergency: false,
        grant: mapPassportAccessGrantRow(result.rows[0]),
      });
    } catch {
      res.status(500).json({ error: "Failed to revoke access grant" });
    }
  });

  app.post("/api/access-grants/:grantId/emergency-revoke", authenticateToken, async (req, res) => {
    try {
      const grantId = Number.parseInt(req.params.grantId, 10);
      if (!Number.isFinite(grantId)) return res.status(400).json({ error: "grantId must be a valid integer" });

      const existing = await loadPassportAccessGrant(grantId);
      if (!existing) return res.status(404).json({ error: "Grant not found" });
      if (!canManageGrantCompany(req, existing.company_id)) {
        return res.status(403).json({ error: "Company admin access required" });
      }

      const reason = req.body?.reason !== undefined ?
        req.body.reason || "Emergency access revocation" :
        existing.reason || "Emergency access revocation";
      const result = await pool.query(
        `UPDATE passport_access_grants
         SET is_active = false,
             expires_at = NOW(),
             reason = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [grantId, reason]
      );

      await logAudit(
        existing.company_id,
        req.user.userId,
        "EMERGENCY_REVOKE_PASSPORT_AUDIENCE",
        "passport_access_grants",
        existing.passport_dpp_id,
        existing,
        { ...result.rows[0], revoked: true, emergency: true },
        { audience: existing.audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: existing.company_id,
        eventType: "PASSPORT_ACCESS_GRANT_EMERGENCY_REVOKED",
        severity: "critical",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: existing.grantee_user_id,
        affectedGrantId: grantId,
        passportDppId: existing.passport_dpp_id,
        audience: existing.audience,
        elementIdPath: existing.element_id_path,
        revocationMode: "emergency",
        reason,
        metadata: {
          effectiveAt: result.rows[0]?.expires_at || null,
        },
      }).catch(() => {});

      res.json({
        success: true,
        revoked: true,
        emergency: true,
        grant: mapPassportAccessGrantRow(result.rows[0]),
      });
    } catch {
      res.status(500).json({ error: "Failed to emergency-revoke access grant" });
    }
  });

  app.get("/api/companies/:companyId/access-audiences/users/:userId", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, audience, reason, expires_at, is_active, created_at, updated_at
         FROM user_access_audiences
         WHERE company_id = $1
           AND user_id = $2
         ORDER BY audience, created_at DESC`,
        [req.params.companyId, req.params.userId]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch access audiences" });
    }
  });

  app.post("/api/companies/:companyId/access-audiences/users/:userId", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const audience = String(req.body?.audience || "").trim();
      if (!accessRightsService.VALID_AUDIENCES.has(audience) || audience === "public") {
        return res.status(400).json({ error: "audience must be a non-public supported audience" });
      }
      const expiresAt = req.body?.expires_at ? new Date(req.body.expires_at) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return res.status(400).json({ error: "expires_at must be a valid ISO timestamp" });
      }

      const result = await pool.query(
        `INSERT INTO user_access_audiences (
           user_id, company_id, audience, granted_by, reason, expires_at, is_active, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
         ON CONFLICT (user_id, company_id, audience)
         DO UPDATE SET
           granted_by = EXCLUDED.granted_by,
           reason = EXCLUDED.reason,
           expires_at = EXCLUDED.expires_at,
           is_active = true,
           updated_at = NOW()
         RETURNING id, audience, reason, expires_at, is_active, created_at, updated_at`,
        [
        req.params.userId,
        req.params.companyId,
        audience,
        req.user.userId,
        req.body?.reason || null,
        expiresAt]

      );

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "GRANT_USER_AUDIENCE",
        "user_access_audiences",
        req.params.userId,
        null,
        { audience, expires_at: expiresAt ? expiresAt.toISOString() : null },
        { audience }
      );

      res.status(201).json(result.rows[0]);
    } catch {
      res.status(500).json({ error: "Failed to grant access audience" });
    }
  });

  app.delete("/api/companies/:companyId/access-audiences/users/:userId/:audience", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const audience = String(req.params.audience || "").trim();
      if (!accessRightsService.VALID_AUDIENCES.has(audience) || audience === "public") {
        return res.status(400).json({ error: "audience must be a non-public supported audience" });
      }

      const result = await pool.query(
        `UPDATE user_access_audiences
         SET is_active = false,
             updated_at = NOW()
         WHERE company_id = $1
           AND user_id = $2
           AND audience = $3
         RETURNING id, audience, user_id, is_active, updated_at`,
        [req.params.companyId, req.params.userId, audience]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Access audience not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REVOKE_USER_AUDIENCE",
        "user_access_audiences",
        req.params.userId,
        result.rows[0],
        { revoked: true, audience },
        { audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "USER_AUDIENCE_REVOKED",
        severity: "high",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: req.params.userId,
        audience,
        revocationMode: "standard",
      }).catch(() => {});

      res.json({ success: true, accessAudience: result.rows[0] });
    } catch {
      res.status(500).json({ error: "Failed to revoke access audience" });
    }
  });

  app.post("/api/companies/:companyId/access-audiences/:grantId/revoke", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const grantId = Number.parseInt(req.params.grantId, 10);
      if (!Number.isFinite(grantId)) return res.status(400).json({ error: "grantId must be a valid integer" });

      const existing = await pool.query(
        `SELECT id, user_id, company_id, audience, granted_by, reason, expires_at, is_active
         FROM user_access_audiences
         WHERE id = $1 AND company_id = $2`,
        [grantId, req.params.companyId]
      );
      if (!existing.rows.length) return res.status(404).json({ error: "Access audience grant not found" });

      const reason = req.body?.reason || existing.rows[0].reason || "User audience revoked";
      const result = await pool.query(
        `UPDATE user_access_audiences
         SET is_active = false,
             reason = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, audience, user_id, is_active, updated_at, reason`,
        [grantId, reason]
      );

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REVOKE_USER_AUDIENCE",
        "user_access_audiences",
        String(existing.rows[0].user_id),
        existing.rows[0],
        { ...result.rows[0], revoked: true },
        { audience: existing.rows[0].audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "USER_AUDIENCE_REVOKED",
        severity: "high",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: existing.rows[0].user_id,
        audience: existing.rows[0].audience,
        revocationMode: "standard",
        reason,
      }).catch(() => {});

      res.json({ success: true, revoked: true, emergency: false, accessAudience: result.rows[0] });
    } catch {
      res.status(500).json({ error: "Failed to revoke access audience" });
    }
  });

  app.post("/api/companies/:companyId/access-audiences/:grantId/emergency-revoke", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const grantId = Number.parseInt(req.params.grantId, 10);
      if (!Number.isFinite(grantId)) return res.status(400).json({ error: "grantId must be a valid integer" });

      const existing = await pool.query(
        `SELECT id, user_id, company_id, audience, granted_by, reason, expires_at, is_active
         FROM user_access_audiences
         WHERE id = $1 AND company_id = $2`,
        [grantId, req.params.companyId]
      );
      if (!existing.rows.length) return res.status(404).json({ error: "Access audience grant not found" });

      const reason = req.body?.reason || existing.rows[0].reason || "Emergency user audience revocation";
      const effectiveAt = new Date().toISOString();
      const result = await pool.query(
        `UPDATE user_access_audiences
         SET is_active = false,
             expires_at = NOW(),
             reason = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, audience, user_id, is_active, updated_at, expires_at, reason`,
        [grantId, reason]
      );

      await pool.query(
        `UPDATE users
         SET session_version = COALESCE(session_version, 1) + 1,
             updated_at = NOW()
         WHERE id = $1 AND company_id = $2`,
        [existing.rows[0].user_id, req.params.companyId]
      ).catch(() => {});

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "EMERGENCY_REVOKE_USER_AUDIENCE",
        "user_access_audiences",
        String(existing.rows[0].user_id),
        existing.rows[0],
        { ...result.rows[0], revoked: true, emergency: true, effective_at: effectiveAt },
        { audience: existing.rows[0].audience }
      );
      await replicateAccessControlEventToBackup({
        companyId: req.params.companyId,
        eventType: "USER_AUDIENCE_EMERGENCY_REVOKED",
        severity: "critical",
        actorUserId: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.email || `user:${req.user.userId}`,
        affectedUserId: existing.rows[0].user_id,
        audience: existing.rows[0].audience,
        revocationMode: "emergency",
        reason,
        metadata: { effectiveAt, sessionsRevoked: true },
      }).catch(() => {});

      res.json({
        success: true,
        revoked: true,
        emergency: true,
        effectiveAt,
        accessAudience: result.rows[0],
      });
    } catch {
      res.status(500).json({ error: "Failed to emergency-revoke access audience" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/access-grants", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT pag.id, pag.audience, pag.element_id_path, pag.grantee_user_id, pag.granted_by, pag.reason,
                pag.expires_at, pag.is_active, pag.created_at, pag.updated_at,
                u.email AS grantee_email, u.first_name AS grantee_first_name, u.last_name AS grantee_last_name
         FROM passport_access_grants pag
         LEFT JOIN users u ON u.id = pag.grantee_user_id
         WHERE pag.company_id = $1
           AND pag.passport_dpp_id = $2
         ORDER BY pag.created_at DESC`,
        [req.params.companyId, req.params.dppId]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch passport access grants" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/access-grants", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const audience = String(req.body?.audience || "").trim();
      if (!accessRightsService.VALID_AUDIENCES.has(audience) || audience === "public") {
        return res.status(400).json({ error: "audience must be a non-public supported audience" });
      }
      const granteeUserId = Number.parseInt(req.body?.grantee_user_id, 10);
      if (!Number.isFinite(granteeUserId)) {
        return res.status(400).json({ error: "grantee_user_id is required" });
      }
      const expiresAt = req.body?.expires_at ? new Date(req.body.expires_at) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return res.status(400).json({ error: "expires_at must be a valid ISO timestamp" });
      }

      const result = await pool.query(
        `INSERT INTO passport_access_grants (
           passport_dpp_id, company_id, audience, element_id_path, grantee_user_id, granted_by, reason, expires_at, is_active, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
         ON CONFLICT (passport_dpp_id, audience, grantee_user_id, element_id_path)
         DO UPDATE SET
           granted_by = EXCLUDED.granted_by,
           reason = EXCLUDED.reason,
           expires_at = EXCLUDED.expires_at,
           is_active = true,
           updated_at = NOW()
         RETURNING *`,
        [
        req.params.dppId,
        req.params.companyId,
        audience,
        req.body?.element_id_path || null,
        granteeUserId,
        req.user.userId,
        req.body?.reason || null,
        expiresAt]

      );

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "GRANT_PASSPORT_AUDIENCE",
        "passport_access_grants",
        req.params.dppId,
        null,
        {
          audience,
          grantee_user_id: granteeUserId,
          element_id_path: req.body?.element_id_path || null,
          expires_at: expiresAt ? expiresAt.toISOString() : null
        },
        { audience }
      );

      res.status(201).json(result.rows[0]);
    } catch {
      res.status(500).json({ error: "Failed to grant passport access" });
    }
  });

  app.delete("/api/companies/:companyId/passports/:dppId/access-grants/:grantId", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE passport_access_grants
         SET is_active = false,
             updated_at = NOW()
         WHERE id = $1
           AND company_id = $2
           AND passport_dpp_id = $3
         RETURNING id, audience, grantee_user_id, element_id_path`,
        [req.params.grantId, req.params.companyId, req.params.dppId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Grant not found" });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REVOKE_PASSPORT_AUDIENCE",
        "passport_access_grants",
        req.params.dppId,
        result.rows[0],
        { revoked: true },
        { audience: result.rows[0].audience }
      );

      res.json({ success: true, grant: result.rows[0] });
    } catch {
      res.status(500).json({ error: "Failed to revoke passport access" });
    }
  });

  app.get("/api/companies/:companyId/backup-providers", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      if (!backupProviderService) return res.json([]);
      const providers = await backupProviderService.listProviders({ companyId: req.params.companyId });
      res.json(providers);
    } catch {
      res.status(500).json({ error: "Failed to fetch backup providers" });
    }
  });

  app.post("/api/companies/:companyId/backup-providers", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      if (!backupProviderService) return res.status(503).json({ error: "Backup provider service is unavailable" });
      const provider = await backupProviderService.upsertProvider({
        companyId: req.params.companyId,
        providerKey: req.body?.provider_key || req.body?.providerKey,
        providerType: req.body?.provider_type || req.body?.providerType || "oci_object_storage",
        displayName: req.body?.display_name || req.body?.displayName || "OCI Object Storage Backup",
        objectPrefix: req.body?.object_prefix || req.body?.objectPrefix || "backup-provider",
        publicBaseUrl: req.body?.public_base_url || req.body?.publicBaseUrl || null,
        supportsPublicHandover: req.body?.supports_public_handover !== false && req.body?.supportsPublicHandover !== false,
        config: req.body?.config_json || req.body?.config || {},
        createdBy: req.user.userId,
        isActive: req.body?.is_active !== false && req.body?.isActive !== false
      });
      await logAudit(
        req.params.companyId,
        req.user.userId,
        "UPSERT_BACKUP_PROVIDER",
        "backup_service_providers",
        null,
        null,
        { provider_key: provider.provider_key, provider_type: provider.provider_type }
      );
      res.status(201).json(provider);
    } catch (error) {
      res.status(400).json({ error: error.message || "Failed to upsert backup provider" });
    }
  });

  app.delete("/api/companies/:companyId/backup-providers/:providerKey", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      if (!backupProviderService) return res.status(503).json({ error: "Backup provider service is unavailable" });
      const provider = await backupProviderService.revokeProvider({ providerKey: req.params.providerKey });
      if (!provider) return res.status(404).json({ error: "Backup provider not found" });
      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REVOKE_BACKUP_PROVIDER",
        "backup_service_providers",
        null,
        { provider_key: req.params.providerKey },
        { revoked: true }
      );
      res.json({ success: true, provider });
    } catch {
      res.status(500).json({ error: "Failed to revoke backup provider" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/backup-replications", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      if (!backupProviderService) return res.json([]);
      const replications = await backupProviderService.listReplications({
        companyId: req.params.companyId,
        passportDppId: req.params.dppId
      });
      res.json(replications);
    } catch {
      res.status(500).json({ error: "Failed to fetch backup replications" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/backup-replications", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      if (!backupProviderService) return res.status(503).json({ error: "Backup provider service is unavailable" });
      const passportType = req.body?.passportType || req.body?.passport_type;
      if (!passportType) return res.status(400).json({ error: "passportType required in body" });

      const currentPassport = await loadLatestLivePassport({
        companyId: req.params.companyId,
        dppId: req.params.dppId,
        passportType,
        releaseStatusSql: "('released','obsolete')"
      });
      if (!currentPassport) return res.status(404).json({ error: "Released passport not found" });

      const result = await replicatePassportToBackup({
        passport: { ...currentPassport, passport_type: passportType },
        passportType,
        reason: "manual_replication",
        snapshotScope: req.body?.snapshotScope || req.body?.snapshot_scope || "released_current"
      });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "REPLICATE_PASSPORT_BACKUP",
        "passport_backup_replications",
        req.params.dppId,
        null,
        { passportType, resultCount: result.results?.length || 0 }
      );

      res.status(202).json(result);
    } catch {
      res.status(500).json({ error: "Failed to replicate passport backup" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/backup-replications/verify", authenticateToken, checkCompanyAdmin, async (req, res) => {
    try {
      if (!backupProviderService) return res.status(503).json({ error: "Backup provider service is unavailable" });
      const replicationId = req.body?.replicationId ?? req.body?.replication_id ?? null;
      if (replicationId !== null && replicationId !== undefined && !Number.isFinite(Number(replicationId))) {
        return res.status(400).json({ error: "replicationId must be a valid integer" });
      }
      const result = await backupProviderService.verifyReplications({
        companyId: req.params.companyId,
        passportDppId: req.params.dppId,
        replicationId
      });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "VERIFY_PASSPORT_BACKUP",
        "passport_backup_replications",
        req.params.dppId,
        null,
        {
          replicationId: replicationId || null,
          verified: result.verified || 0,
          failed: result.failed || 0
        }
      );

      if (result.error) {
        return res.status(404).json({ error: result.error, results: result.results || [] });
      }
      return res.status(result.success ? 200 : 207).json(result);
    } catch {
      res.status(500).json({ error: "Failed to verify backup replications" });
    }
  });

  // ─── QR CODE ───────────────────────────────────────────────────────────────

  app.post("/api/passports/:dppId/qrcode", authenticateToken, requireEditor, async (req, res) => {
    try {
      const { qrCode, passportType } = req.body;
      if (!qrCode || !passportType) return res.status(400).json({ error: "qrCode and passportType required" });

      // Validate QR value is an HTTPS URL, not a raw DID string
      if (!qrCode.startsWith("https://") && !qrCode.startsWith("http://")) {
        return res.status(400).json({ error: "QR code must be an HTTPS URL" });
      }

      const reg = await pool.query("SELECT company_id FROM passport_registry WHERE dpp_id = $1", [req.params.dppId]);
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found in registry" });

      // Enforce company ownership — editors can only update passports in their own company
      const passportCompanyId = String(reg.rows[0].company_id);
      if (req.user.role !== "super_admin" && String(req.user.companyId) !== passportCompanyId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const tableName = getTable(passportType);
      await pool.query(`UPDATE ${tableName} SET qr_code = $1, updated_at = NOW() WHERE dpp_id = $2`, [qrCode, req.params.dppId]);
      res.json({ success: true });
    } catch {res.status(500).json({ error: "Failed to save QR code" });}
  });

  app.get("/api/passports/:dppId/qrcode", publicReadRateLimit, async (req, res) => {
    try {
      const { dppId: dppId } = req.params;
      const reg = await pool.query("SELECT passport_type FROM passport_registry WHERE dpp_id = $1", [dppId]);
      if (!reg.rows.length) return res.status(404).json({ error: "QR code not found" });

      const { passport_type } = reg.rows[0];
      const tableName = getTable(passport_type);
      const r = await pool.query(`SELECT qr_code FROM ${tableName} WHERE dpp_id = $1 AND deleted_at IS NULL LIMIT 1`, [dppId]);
      if (!r.rows.length || !r.rows[0].qr_code) return res.status(404).json({ error: "QR code not found" });

      res.json({ qrCode: r.rows[0].qr_code });
    } catch {res.status(500).json({ error: "Failed to fetch QR code" });}
  });

  // ─── SCAN ──────────────────────────────────────────────────────────────────

  app.post("/api/passports/:dppId/scan", (req, res, next) => {
    // dynamic rate limit - imported as assetWriteRateLimit equiv for scans
    next();
  }, async (req, res) => {
    try {
      const { dppId: dppId } = req.params;
      const { userAgent, referrer, userId } = req.body || {};

      const reg = await pool.query("SELECT passport_type FROM passport_registry WHERE dpp_id = $1", [dppId]);
      if (!reg.rows.length) return res.json({ success: true });

      const tbl = getTable(reg.rows[0].passport_type);
      const check = await pool.query(
        `SELECT 1 FROM ${tbl} WHERE dpp_id = $1 AND release_status = 'released' AND deleted_at IS NULL`,
        [dppId]
      );
      if (!check.rows.length) return res.json({ success: true });

      const parsedUserId = Number.parseInt(userId, 10);
      if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) return res.json({ success: true });

      await pool.query(
        `INSERT INTO passport_scan_events (passport_dpp_id, viewer_user_id, user_agent, referrer)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (passport_dpp_id, viewer_user_id) WHERE viewer_user_id IS NOT NULL DO NOTHING`,
        [dppId, parsedUserId, userAgent || null, referrer || null]
      );
      res.json({ success: true });
    } catch {res.json({ success: true });}
  });

  app.get("/api/passports/:dppId/scan-stats", publicReadRateLimit, async (req, res) => {
    try {
      const { dppId: dppId } = req.params;
      const total = await pool.query(
        `SELECT COUNT(DISTINCT viewer_user_id) FROM passport_scan_events WHERE passport_dpp_id = $1 AND viewer_user_id IS NOT NULL`,
        [dppId]
      );
      const byDay = await pool.query(
        `SELECT DATE(scanned_at) AS day, COUNT(DISTINCT viewer_user_id) AS count
         FROM passport_scan_events WHERE passport_dpp_id = $1 AND viewer_user_id IS NOT NULL
         GROUP BY DATE(scanned_at) ORDER BY day DESC LIMIT 30`,
        [dppId]
      );
      res.json({ total: parseInt(total.rows[0].count), byDay: byDay.rows });
    } catch {res.status(500).json({ error: "Failed" });}
  });

  // ─── DYNAMIC VALUES ────────────────────────────────────────────────────────

  app.get("/api/passports/:dppId/dynamic-values", publicReadRateLimit, async (req, res) => {
    try {
      const { dppId: dppId } = req.params;
      const r = await pool.query(
        `SELECT DISTINCT ON (field_key) field_key, value, updated_at
         FROM passport_dynamic_values WHERE passport_dpp_id = $1 ORDER BY field_key, updated_at DESC`,
        [dppId]
      );
      const values = {};
      for (const row of r.rows) {values[row.field_key] = { value: row.value, updatedAt: row.updated_at };}
      res.json({ values });
    } catch (e) {res.status(500).json({ error: "Failed to fetch dynamic values" });}
  });

  app.get("/api/passports/:dppId/dynamic-values/:fieldKey/history", publicReadRateLimit, async (req, res) => {
    try {
      const { dppId: dppId, fieldKey } = req.params;
      const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
      const r = await pool.query(
        `SELECT value, updated_at FROM passport_dynamic_values WHERE passport_dpp_id = $1 AND field_key = $2 ORDER BY updated_at ASC LIMIT $3`,
        [dppId, fieldKey, limit]
      );
      res.json({ history: r.rows.map((row) => ({ value: row.value, updatedAt: row.updated_at })) });
    } catch (e) {res.status(500).json({ error: "Failed to fetch history" });}
  });

  app.post("/api/passports/:dppId/dynamic-values", async (req, res) => {
    try {
      const { dppId: dppId } = req.params;
      const deviceKey = req.headers["x-device-key"];
      if (!deviceKey) return res.status(401).json({ error: "x-device-key header required" });

      const reg = await pool.query(
        "SELECT device_api_key_hash FROM passport_registry WHERE dpp_id = $1",
        [dppId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });
      const storedHash = String(reg.rows[0].device_api_key_hash || "");
      if (!storedHash) return res.status(403).json({ error: "Device key is not configured for this passport" });
      const submittedHash = hashSecret(String(deviceKey || ""));
      const storedBuf = Buffer.from(storedHash, "hex");
      const submittedBuf = Buffer.from(submittedHash, "hex");
      if (storedBuf.length !== submittedBuf.length || !crypto.timingSafeEqual(storedBuf, submittedBuf))
      return res.status(403).json({ error: "Invalid device key" });

      const updates = req.body;
      if (!updates || typeof updates !== "object" || Array.isArray(updates))
      return res.status(400).json({ error: "Body must be an object of { fieldKey: value }" });

      const entries = Object.entries(updates).filter(([k]) => /^[a-z0-9_]{1,100}$/.test(k));
      if (!entries.length) return res.status(400).json({ error: "No valid field keys provided" });

      for (const [fieldKey, value] of entries) {
        let storedValue = value;
        if (value !== null && value !== undefined) {
          if (Array.isArray(value) || typeof value === "object") storedValue = JSON.stringify(value);else
          storedValue = String(value);
        }
        await pool.query(
          `INSERT INTO passport_dynamic_values (passport_dpp_id, field_key, value, updated_at) VALUES ($1, $2, $3, NOW())`,
          [dppId, fieldKey, storedValue]
        );
      }

      res.json({ success: true, updated: entries.map(([k]) => k) });
    } catch (e) {res.status(500).json({ error: "Failed to update dynamic values" });}
  });

  app.get("/api/companies/:companyId/passports/:dppId/device-key", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { dppId: dppId } = req.params;
      const r = await pool.query(
        `SELECT device_api_key_hash, device_api_key_prefix, device_key_last_rotated_at
         FROM passport_registry
         WHERE dpp_id = $1 AND company_id = $2`,
        [dppId, req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
      res.json({
        hasDeviceKey: !!r.rows[0].device_api_key_hash,
        keyPrefix: r.rows[0].device_api_key_prefix || null,
        lastRotatedAt: r.rows[0].device_key_last_rotated_at || null,
        revealable: false
      });
    } catch (e) {res.status(500).json({ error: "Failed to fetch device key" });}
  });

  app.post("/api/companies/:companyId/passports/:dppId/device-key/regenerate", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { dppId: dppId } = req.params;
      const material = createDeviceKeyMaterial();
      const r = await pool.query(
        `UPDATE passport_registry
         SET device_api_key = NULL,
             device_api_key_hash = $1,
             device_api_key_prefix = $2,
             device_key_last_rotated_at = NOW()
         WHERE dpp_id = $3 AND company_id = $4
         RETURNING device_api_key_prefix, device_key_last_rotated_at`,
        [material.hash, material.prefix, dppId, req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
      await logAudit(req.params.companyId, req.user.userId, "ROTATE_DEVICE_KEY", "passport_registry", dppId, null, { key_prefix: material.prefix });
      res.json({
        deviceKey: material.rawKey,
        keyPrefix: r.rows[0].device_api_key_prefix,
        lastRotatedAt: r.rows[0].device_key_last_rotated_at
      });
    } catch (e) {res.status(500).json({ error: "Failed to regenerate device key" });}
  });

  app.patch("/api/companies/:companyId/passports/:dppId/dynamic-values", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { dppId: dppId } = req.params;
      const updates = req.body;
      if (!updates || typeof updates !== "object" || Array.isArray(updates))
      return res.status(400).json({ error: "Body must be an object of { fieldKey: value }" });

      const entries = Object.entries(updates).filter(([k]) => /^[a-z0-9_]{1,100}$/.test(k));
      if (!entries.length) return res.status(400).json({ error: "No valid field keys provided" });

      for (const [fieldKey, value] of entries) {
        await pool.query(
          `INSERT INTO passport_dynamic_values (passport_dpp_id, field_key, value, updated_at) VALUES ($1, $2, $3, NOW())`,
          [dppId, fieldKey, value === null || value === undefined ? null : String(value)]
        );
      }
      res.json({ success: true });
    } catch (e) {res.status(500).json({ error: "Failed to update dynamic values" });}
  });

  // ─── PASSPORT TYPES PER COMPANY ────────────────────────────────────────────

  app.get("/api/companies/:companyId/passport-types", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT DISTINCT pt.id, pt.type_name, pt.display_name, pt.umbrella_category, pt.umbrella_icon, pt.semantic_model_key, pt.fields_json,
          (NOT cpa.access_revoked) AS access_granted
        FROM passport_types pt
        JOIN company_passport_access cpa ON pt.id = cpa.passport_type_id
        WHERE cpa.company_id = $1
        ORDER BY pt.umbrella_category, pt.display_name
      `, [req.params.companyId]);
      res.json(r.rows);
    } catch (e) {logger.error("passport-types fetch error:", e.message);res.status(500).json({ error: "Failed to fetch passport types" });}
  });
};
