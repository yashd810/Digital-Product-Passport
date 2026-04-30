"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function normalizeObjectPrefix(value) {
  return normalizeText(value || "backup-provider", "backup-provider").
  replace(/^\/+/, "").
  replace(/\/+$/, "");
}

function normalizeHash(value) {
  return normalizeText(value || "").toLowerCase();
}

function normalizeStorageSegment(value, fallback = "event") {
  const normalized = normalizeText(value, fallback).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

module.exports = function createBackupProviderService({
  pool,
  storageService,
  buildCanonicalPassportPayload
}) {
  function parseStoredJson(value, fallback = null) {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "object" && !Buffer.isBuffer(value)) return value;
    try {
      return JSON.parse(String(value));
    } catch {
      return fallback;
    }
  }

  function getContinuityPolicy({ companyId = null } = {}) {
    const rpoMinutes = parsePositiveInteger(process.env.BACKUP_POLICY_RPO_MINUTES, 15);
    const rtoHours = parsePositiveInteger(process.env.BACKUP_POLICY_RTO_HOURS, 4);
    const verificationFrequency = normalizeText(process.env.BACKUP_POLICY_VERIFICATION_FREQUENCY, "daily");
    const restoreTestFrequency = normalizeText(process.env.BACKUP_POLICY_RESTORE_TEST_FREQUENCY, "quarterly");
    const verificationMethod = normalizeText(
      process.env.BACKUP_POLICY_VERIFICATION_METHOD,
      "Replicated backup objects are hash-verified against recorded payload hashes."
    );
    const restoreTestMethod = normalizeText(
      process.env.BACKUP_POLICY_RESTORE_TEST_METHOD,
      "Perform a documented restore rehearsal from backup storage into a non-production environment."
    );

    return {
      companyId: companyId !== null && companyId !== undefined ? Number.parseInt(companyId, 10) : null,
      rpoMinutes,
      rtoHours,
      replicationTriggerPolicy: {
        release: true,
        archive: true,
        controlledUpdate: true,
        standardsDelete: true,
        manualReplication: true,
      },
      verificationFrequency,
      restoreTestFrequency,
      verificationMethod,
      restoreTestMethod,
      backupProviderRequired: toBoolean(process.env.BACKUP_PROVIDER_ENABLED, false),
      evidenceSource: "application_policy",
    };
  }

  function buildImplicitProvider(companyId = null) {
    if (!toBoolean(process.env.BACKUP_PROVIDER_ENABLED, false)) return null;
    return {
      id: null,
      company_id: companyId ? Number.parseInt(companyId, 10) : null,
      provider_key: normalizeText(process.env.BACKUP_PROVIDER_KEY, "oci-object-storage"),
      provider_type: normalizeText(process.env.BACKUP_PROVIDER_TYPE, "oci_object_storage"),
      display_name: normalizeText(process.env.BACKUP_PROVIDER_DISPLAY_NAME, "OCI Object Storage Backup"),
      object_prefix: normalizeObjectPrefix(process.env.BACKUP_PROVIDER_OBJECT_PREFIX),
      public_base_url: normalizeText(process.env.BACKUP_PROVIDER_PUBLIC_BASE_URL || process.env.STORAGE_S3_PUBLIC_BASE_URL, ""),
      supports_public_handover: toBoolean(process.env.BACKUP_PROVIDER_SUPPORTS_PUBLIC_HANDOVER, true),
      config_json: {
        region: normalizeText(process.env.BACKUP_PROVIDER_REGION || process.env.STORAGE_S3_REGION, ""),
        bucket: normalizeText(process.env.BACKUP_PROVIDER_BUCKET || process.env.STORAGE_S3_BUCKET, ""),
        endpoint: normalizeText(process.env.BACKUP_PROVIDER_ENDPOINT || process.env.STORAGE_S3_ENDPOINT, ""),
        mode: "implicit_env"
      },
      is_active: true,
      is_backup_provider: true,
      is_implicit: true
    };
  }

  async function listProviders({ companyId = null, activeOnly = true } = {}) {
    const params = [];
    const filters = ["is_backup_provider = true"];

    if (activeOnly) filters.push("is_active = true");
    if (companyId !== null && companyId !== undefined) {
      params.push(Number.parseInt(companyId, 10));
      filters.push(`(company_id IS NULL OR company_id = $${params.length})`);
    }

    const result = await pool.query(
      `SELECT id, company_id, provider_key, provider_type, display_name, object_prefix, public_base_url,
              supports_public_handover, config_json, is_active, created_at, updated_at
       FROM backup_service_providers
       WHERE ${filters.join(" AND ")}
       ORDER BY company_id NULLS FIRST, provider_key ASC`,
      params
    ).catch(() => ({ rows: [] }));

    const rows = [...result.rows];
    const implicitProvider = buildImplicitProvider(companyId);
    if (implicitProvider && !rows.some((row) => row.provider_key === implicitProvider.provider_key)) {
      rows.unshift(implicitProvider);
    }
    return rows;
  }

  function buildBackupEnvelope({
    passport,
    typeDef,
    companyName = "",
    reason = "manual",
    snapshotScope = "released_current",
    documentation = null,
    provider
  }) {
    const canonicalPayload = buildCanonicalPassportPayload(passport, typeDef, { companyName });
    return {
      backupProvider: {
        providerKey: provider.provider_key,
        providerType: provider.provider_type,
        displayName: provider.display_name,
        supportsPublicHandover: provider.supports_public_handover !== false
      },
      snapshotScope,
      reason,
      capturedAt: new Date().toISOString(),
      source: {
        companyId: passport.company_id || null,
        companyName: companyName || null,
        passportDppId: passport.dppId || null,
        lineageId: passport.lineage_id || passport.dppId || null,
        passportType: passport.passport_type || typeDef?.type_name || null,
        versionNumber: Number(passport.version_number) || 1,
        releaseStatus: passport.release_status || null
      },
      documentation: documentation || {
        includedByReference: [],
        attachmentCopies: [],
        mandatoryDocumentCount: 0,
        publicDocumentCount: 0,
      },
      passport: canonicalPayload
    };
  }

  function buildStorageKey({ provider, passport, snapshotScope }) {
    const lineageId = normalizeText(passport.lineage_id || passport.dppId || "unknown-lineage", "unknown-lineage");
    const versionNumber = Number(passport.version_number) || 1;
    return path.posix.join(
      normalizeObjectPrefix(provider.object_prefix),
      `company-${passport.company_id || "unknown"}`,
      `passport-${lineageId}`,
      `v${versionNumber}`,
      `${snapshotScope}.json`
    );
  }

  function buildAttachmentStorageKey({ provider, passport, attachment, fallbackFieldKey = "document" }) {
    const lineageId = normalizeText(passport.lineage_id || passport.dppId || "unknown-lineage", "unknown-lineage");
    const versionNumber = Number(passport.version_number) || 1;
    const fieldKey = normalizeStorageSegment(attachment?.field_key || fallbackFieldKey, "document");
    const publicId = normalizeStorageSegment(attachment?.public_id || Date.now(), "document");
    const ext = path.extname(String(attachment?.storage_key || attachment?.file_path || attachment?.file_url || "")).toLowerCase();
    const safeExt = ext && ext.length <= 10 ? ext.replace(/[^a-z0-9.]/g, "") : "";
    return path.posix.join(
      normalizeObjectPrefix(provider.object_prefix),
      `company-${passport.company_id || "unknown"}`,
      `passport-${lineageId}`,
      `v${versionNumber}`,
      "documents",
      `${fieldKey}-${publicId}${safeExt || ""}`
    );
  }

  function collectTypeFields(typeDef) {
    return Array.isArray(typeDef?.fields_json?.sections) ?
      typeDef.fields_json.sections.flatMap((section) => Array.isArray(section?.fields) ? section.fields : []) :
      [];
  }

  function isFileLikeField(fieldDef) {
    const candidates = [
      fieldDef?.type,
      fieldDef?.dataType,
      fieldDef?.inputType,
      fieldDef?.fieldType,
    ].map((value) => String(value || "").trim().toLowerCase());
    return candidates.includes("file") || candidates.includes("document");
  }

  function isMandatoryField(fieldDef) {
    return fieldDef?.required === true || fieldDef?.mandatory === true;
  }

  async function loadPassportAttachments({ companyId, passportDppId }) {
    const result = await pool.query(
      `SELECT id, public_id, company_id, passport_dpp_id, field_key, file_path, storage_key, storage_provider,
              file_url, mime_type, size_bytes, is_public, created_at
       FROM passport_attachments
       WHERE company_id = $1
         AND passport_dpp_id = $2
       ORDER BY created_at DESC, id DESC`,
      [companyId, passportDppId]
    ).catch(() => ({ rows: [] }));
    return result.rows;
  }

  async function readAttachmentBuffer(attachment) {
    if (attachment?.storage_key && storageService?.fetchObject) {
      const objectResponse = await storageService.fetchObject(attachment.storage_key);
      return Buffer.from(await objectResponse.arrayBuffer());
    }
    if (attachment?.file_path) {
      return fs.promises.readFile(path.resolve(attachment.file_path));
    }
    return null;
  }

  async function buildDocumentationManifest({ passport, typeDef, provider }) {
    const fieldDefs = collectTypeFields(typeDef);
    const fileFieldMap = new Map(
      fieldDefs
        .filter((fieldDef) => fieldDef?.key && isFileLikeField(fieldDef))
        .map((fieldDef) => [fieldDef.key, fieldDef])
    );
    const attachments = await loadPassportAttachments({
      companyId: passport.company_id,
      passportDppId: passport.dppId,
    });
    const appBaseUrl = normalizeText(
      process.env.PUBLIC_APP_URL ||
      process.env.APP_URL ||
      process.env.SERVER_URL,
      "http://localhost:3001"
    ).replace(/\/+$/, "");

    const attachmentCopies = [];
    const includedByReference = [];

    for (const attachment of attachments) {
      const fieldDef = fileFieldMap.get(attachment.field_key) || null;
      const publicDownloadUrl = attachment.public_id ? `${appBaseUrl}/public-files/${attachment.public_id}` : null;
      const manifestEntry = {
        fieldKey: attachment.field_key || null,
        label: fieldDef?.label || attachment.field_key || "Attachment",
        mandatory: isMandatoryField(fieldDef),
        accessMode: attachment.is_public ? "public_download" : "controlled_private",
        isPublic: attachment.is_public === true,
        publicDownloadUrl: attachment.is_public ? publicDownloadUrl : null,
        sourceReference: attachment.file_url || publicDownloadUrl || null,
        sourceReferenceType: attachment.public_id ? "public_file_route" : "stored_attachment",
        mimeType: attachment.mime_type || "application/octet-stream",
        sizeBytes: attachment.size_bytes || null,
      };

      let backupCopy = null;
      try {
        const buffer = await readAttachmentBuffer(attachment);
        if (buffer) {
          const copied = await storageService.saveObject({
            key: buildAttachmentStorageKey({ provider, passport, attachment, fallbackFieldKey: attachment.field_key }),
            buffer,
            contentType: attachment.mime_type || "application/octet-stream",
            cacheControl: "private, max-age=0, no-store",
          });
          backupCopy = {
            storageKey: copied?.storageKey || null,
            publicUrl: copied?.url || null,
            contentHash: sha256Hex(buffer),
            contentType: attachment.mime_type || "application/octet-stream",
            storedAt: new Date().toISOString(),
          };
        }
      } catch (error) {
        backupCopy = {
          storageKey: null,
          publicUrl: null,
          contentHash: null,
          contentType: attachment.mime_type || "application/octet-stream",
          storedAt: new Date().toISOString(),
          error: error.message,
        };
      }

      attachmentCopies.push({
        ...manifestEntry,
        backupCopyStatus: backupCopy?.storageKey ? "copied" : "copy_failed",
        backupCopy,
      });
    }

    for (const [fieldKey, fieldDef] of fileFieldMap.entries()) {
      const matchingAttachment = attachments.find((attachment) => attachment.field_key === fieldKey);
      const fieldValue = passport?.[fieldKey];
      if (matchingAttachment) continue;
      if (!normalizeText(fieldValue)) continue;

      includedByReference.push({
        fieldKey,
        label: fieldDef?.label || fieldKey,
        mandatory: isMandatoryField(fieldDef),
        referenceUrl: String(fieldValue),
        referenceType: String(fieldValue).includes("/public-files/") ? "public_file_route" : "external_reference",
        downloadable: /^https?:\/\//i.test(String(fieldValue)),
        preservedAccessMode: "reference_only",
        backupCopyStatus: isMandatoryField(fieldDef) ? "reference_only_unbacked" : "reference_only",
      });
    }

    const mandatoryCopyFailures = [
      ...attachmentCopies.filter((item) => item.mandatory && item.backupCopyStatus !== "copied"),
      ...includedByReference.filter((item) => item.mandatory),
    ].map((item) => item.fieldKey || item.label || "document");

    return {
      includedByReference,
      attachmentCopies,
      mandatoryDocumentCount: [...attachmentCopies, ...includedByReference].filter((item) => item.mandatory).length,
      publicDocumentCount: attachmentCopies.filter((item) => item.isPublic).length,
      mandatoryBackupSatisfied: mandatoryCopyFailures.length === 0,
      mandatoryCopyFailures,
    };
  }

  function buildAccessControlEventEnvelope({
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
    provider
  }) {
    return {
      backupProvider: {
        providerKey: provider.provider_key,
        providerType: provider.provider_type,
        displayName: provider.display_name,
        supportsPublicHandover: provider.supports_public_handover !== false,
      },
      eventCategory: "access_control",
      eventType: normalizeText(eventType, "ACCESS_CONTROL_CHANGE"),
      severity: normalizeText(severity, "normal"),
      recordedAt: new Date().toISOString(),
      revocationMode: normalizeText(revocationMode, "standard"),
      reason: reason || null,
      source: {
        companyId: companyId ? Number.parseInt(companyId, 10) : null,
        passportDppId: passportDppId || null,
        actorUserId: actorUserId || null,
        actorIdentifier: actorIdentifier || null,
      },
      target: {
        affectedUserId: affectedUserId || null,
        affectedApiKeyId: affectedApiKeyId || null,
        affectedGrantId: affectedGrantId || null,
        audience: audience || null,
        elementIdPath: elementIdPath || null,
      },
      metadata: metadata && typeof metadata === "object" ? metadata : {},
    };
  }

  function buildAccessControlEventStorageKey({ provider, companyId, eventType, severity }) {
    const now = new Date();
    const datePrefix = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      String(now.getUTCDate()).padStart(2, "0"),
    ].join("/");
    return path.posix.join(
      normalizeObjectPrefix(provider.object_prefix),
      `company-${companyId || "unknown"}`,
      "security-events",
      datePrefix,
      `${normalizeStorageSegment(eventType)}-${normalizeStorageSegment(severity)}-${Date.now()}.json`
    );
  }

  function buildAuditAnchorEnvelope({
    companyId,
    actorUserId = null,
    actorIdentifier = null,
    anchor,
    summary,
    provider
  }) {
    return {
      backupProvider: {
        providerKey: provider.provider_key,
        providerType: provider.provider_type,
        displayName: provider.display_name,
        supportsPublicHandover: provider.supports_public_handover !== false,
      },
      eventCategory: "audit_anchor",
      recordedAt: new Date().toISOString(),
      source: {
        companyId: companyId ? Number.parseInt(companyId, 10) : null,
        actorUserId: actorUserId || null,
        actorIdentifier: actorIdentifier || null,
      },
      anchor: anchor || null,
      summary: summary || null,
    };
  }

  function buildAuditAnchorStorageKey({ provider, companyId, anchorId }) {
    const now = new Date();
    const datePrefix = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      String(now.getUTCDate()).padStart(2, "0"),
    ].join("/");
    return path.posix.join(
      normalizeObjectPrefix(provider.object_prefix),
      `company-${companyId || "unknown"}`,
      "audit-anchors",
      datePrefix,
      `anchor-${normalizeStorageSegment(anchorId || Date.now(), "anchor")}.json`
    );
  }

  async function recordReplication({
    provider,
    passport,
    envelope,
    snapshotScope,
    replicationStatus,
    storageProvider,
    storageKey,
    publicUrl,
    errorMessage = null
  }) {
    const payloadJson = JSON.stringify(envelope);
    const payloadHash = crypto.createHash("sha256").update(payloadJson).digest("hex");
    const result = await pool.query(
      `INSERT INTO passport_backup_replications (
         backup_provider_id, backup_provider_key, passport_dpp_id, lineage_id, company_id, passport_type,
         version_number, dpp_id, snapshot_scope, replication_status, storage_provider, storage_key, public_url,
         payload_hash, payload_json, error_message, verification_status, verification_error_message,
         verified_payload_hash, replicated_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, 'pending', NULL, NULL, NOW(), NOW())
       ON CONFLICT (backup_provider_key, passport_dpp_id, version_number, snapshot_scope)
       DO UPDATE SET
         replication_status = EXCLUDED.replication_status,
         storage_provider = EXCLUDED.storage_provider,
         storage_key = EXCLUDED.storage_key,
         public_url = EXCLUDED.public_url,
         payload_hash = EXCLUDED.payload_hash,
         payload_json = EXCLUDED.payload_json,
         error_message = EXCLUDED.error_message,
         verification_status = 'pending',
         verification_error_message = NULL,
         verified_payload_hash = NULL,
         replicated_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [
      provider.id || null,
      provider.provider_key,
      passport.dppId,
      passport.lineage_id || passport.dppId,
      passport.company_id,
      passport.passport_type || null,
      Number(passport.version_number) || 1,
      envelope?.passport?.digitalProductPassportId || null,
      snapshotScope,
      replicationStatus,
      storageProvider || null,
      storageKey || null,
      publicUrl || null,
      payloadHash,
      payloadJson,
      errorMessage]

    );
    return result.rows[0] || null;
  }

  async function replicatePassportSnapshot({
    passport,
    typeDef,
    companyName = "",
    reason = "manual",
    snapshotScope = "released_current",
    providerKey = null
  }) {
    if (!passport?.dppId || !passport?.company_id) {
      return { success: false, error: "Passport identity is required for backup replication", results: [] };
    }

    const providers = (await listProviders({ companyId: passport.company_id })).
    filter((provider) => !providerKey || provider.provider_key === providerKey);

    if (!providers.length) {
      return { success: true, skipped: true, reason: "NO_BACKUP_PROVIDER", results: [] };
    }

    const results = [];
    for (const provider of providers) {
      const documentation = await buildDocumentationManifest({
        passport,
        typeDef,
        provider,
      });
      const envelope = buildBackupEnvelope({
        passport,
        typeDef,
        companyName,
        reason,
        snapshotScope,
        documentation,
        provider
      });

      let replicationStatus = "synced";
      let storageProvider = storageService?.provider || storageService?.name || null;
      let storageKey = null;
      let publicUrl = null;
      let errorMessage = null;

      try {
        if (documentation.mandatoryBackupSatisfied === false) {
          throw new Error(`Mandatory document backup is incomplete for field(s): ${documentation.mandatoryCopyFailures.join(", ")}`);
        }
        if (!storageService?.saveObject) {
          throw new Error("Configured storage service does not support backup writes");
        }
        const stored = await storageService.saveObject({
          key: buildStorageKey({ provider, passport, snapshotScope }),
          buffer: Buffer.from(JSON.stringify(envelope, null, 2), "utf8"),
          contentType: "application/json",
          cacheControl: "private, max-age=0, no-store"
        });
        storageKey = stored?.storageKey || null;
        publicUrl = stored?.url || null;
      } catch (error) {
        replicationStatus = "failed";
        errorMessage = error.message;
      }

      const row = await recordReplication({
        provider,
        passport,
        envelope,
        snapshotScope,
        replicationStatus,
        storageProvider,
        storageKey,
        publicUrl,
        errorMessage
      });
      results.push(row || {
        backup_provider_key: provider.provider_key,
        replication_status: replicationStatus,
        error_message: errorMessage
      });
    }

    return {
      success: results.every((row) => row.replication_status === "synced"),
      results
    };
  }

  async function replicateAccessControlEvent({
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
    providerKey = null,
  }) {
    if (!companyId) {
      return { success: false, error: "companyId is required for access-control event replication", results: [] };
    }

    const providers = (await listProviders({ companyId })).
      filter((provider) => !providerKey || provider.provider_key === providerKey);

    if (!providers.length) {
      return { success: true, skipped: true, reason: "NO_BACKUP_PROVIDER", results: [] };
    }

    const results = [];
    for (const provider of providers) {
      const envelope = buildAccessControlEventEnvelope({
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
        provider,
      });

      let replicationStatus = "synced";
      let storageKey = null;
      let publicUrl = null;
      let errorMessage = null;

      try {
        if (!storageService?.saveObject) {
          throw new Error("Configured storage service does not support backup writes");
        }
        const stored = await storageService.saveObject({
          key: buildAccessControlEventStorageKey({ provider, companyId, eventType, severity }),
          buffer: Buffer.from(JSON.stringify(envelope, null, 2), "utf8"),
          contentType: "application/json",
          cacheControl: "private, max-age=0, no-store",
        });
        storageKey = stored?.storageKey || null;
        publicUrl = stored?.url || null;
      } catch (error) {
        replicationStatus = "failed";
        errorMessage = error.message;
      }

      results.push({
        backup_provider_key: provider.provider_key,
        event_type: envelope.eventType,
        severity: envelope.severity,
        revocation_mode: envelope.revocationMode,
        replication_status: replicationStatus,
        storage_provider: storageService?.provider || storageService?.name || null,
        storage_key: storageKey,
        public_url: publicUrl,
        error_message: errorMessage,
      });
    }

    return {
      success: results.every((row) => row.replication_status === "synced"),
      results,
    };
  }

  async function replicateAuditAnchorEvent({
    companyId,
    actorUserId = null,
    actorIdentifier = null,
    anchor,
    summary,
    providerKey = null,
  }) {
    if (!companyId) {
      return { success: false, error: "companyId is required for audit-anchor replication", results: [] };
    }

    const providers = (await listProviders({ companyId })).
      filter((provider) => !providerKey || provider.provider_key === providerKey);

    if (!providers.length) {
      return { success: true, skipped: true, reason: "NO_BACKUP_PROVIDER", results: [] };
    }

    const results = [];
    for (const provider of providers) {
      const envelope = buildAuditAnchorEnvelope({
        companyId,
        actorUserId,
        actorIdentifier,
        anchor,
        summary,
        provider,
      });

      let replicationStatus = "synced";
      let storageKey = null;
      let publicUrl = null;
      let errorMessage = null;

      try {
        if (!storageService?.saveObject) {
          throw new Error("Configured storage service does not support backup writes");
        }
        const stored = await storageService.saveObject({
          key: buildAuditAnchorStorageKey({ provider, companyId, anchorId: anchor?.id }),
          buffer: Buffer.from(JSON.stringify(envelope, null, 2), "utf8"),
          contentType: "application/json",
          cacheControl: "private, max-age=0, no-store",
        });
        storageKey = stored?.storageKey || null;
        publicUrl = stored?.url || null;
      } catch (error) {
        replicationStatus = "failed";
        errorMessage = error.message;
      }

      results.push({
        backup_provider_key: provider.provider_key,
        event_category: "audit_anchor",
        anchor_id: anchor?.id || null,
        root_event_hash: anchor?.root_event_hash || anchor?.rootEventHash || summary?.latestEventHash || null,
        replication_status: replicationStatus,
        storage_provider: storageService?.provider || storageService?.name || null,
        storage_key: storageKey,
        public_url: publicUrl,
        error_message: errorMessage,
      });
    }

    return {
      success: results.every((row) => row.replication_status === "synced"),
      results,
    };
  }

  async function updateVerificationResult({
    id,
    verificationStatus,
    verificationErrorMessage = null,
    verifiedPayloadHash = null
  }) {
    const result = await pool.query(
      `UPDATE passport_backup_replications
       SET verification_status = $2,
           verification_error_message = $3,
           verified_payload_hash = $4,
           last_verified_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
      id,
      verificationStatus,
      verificationErrorMessage,
      verifiedPayloadHash]

    );
    return result.rows[0] || null;
  }

  function computeEnvelopeHash(payload) {
    const payloadJson = JSON.stringify(payload);
    return crypto.createHash("sha256").update(payloadJson).digest("hex");
  }

  async function verifyBackupDocumentCopies(documentation) {
    const copies = Array.isArray(documentation?.attachmentCopies) ? documentation.attachmentCopies : [];
    for (const entry of copies) {
      const storageKey = entry?.backupCopy?.storageKey || null;
      const expectedHash = normalizeHash(entry?.backupCopy?.contentHash || "");
      if (!storageKey || !expectedHash) {
        if (entry?.mandatory) {
          throw new Error(`Mandatory backup document for field "${entry.fieldKey || "document"}" is missing a verified copy`);
        }
        continue;
      }
      const objectResponse = await storageService.fetchObject(storageKey);
      const buffer = Buffer.from(await objectResponse.arrayBuffer());
      const actualHash = normalizeHash(sha256Hex(buffer));
      if (expectedHash !== actualHash) {
        throw new Error(`Backup document hash mismatch for field "${entry.fieldKey || "document"}"`);
      }
    }
  }

  async function verifyReplicationRecord(row) {
    if (!storageService?.fetchObject) {
      return updateVerificationResult({
        id: row.id,
        verificationStatus: "failed",
        verificationErrorMessage: "Configured storage service does not support backup verification reads"
      });
    }
    if (!row?.storage_key) {
      return updateVerificationResult({
        id: row.id,
        verificationStatus: "failed",
        verificationErrorMessage: "Replication record is missing a storage key"
      });
    }

    try {
      const objectResponse = await storageService.fetchObject(row.storage_key);
      const buffer = Buffer.from(await objectResponse.arrayBuffer());
      const parsed = JSON.parse(buffer.toString("utf8"));
      const verifiedPayloadHash = computeEnvelopeHash(parsed);
      const expectedPayloadHash = normalizeHash(row.payload_hash);
      const actualPayloadHash = normalizeHash(verifiedPayloadHash);

      if (!parsed?.passport?.digitalProductPassportId) {
        throw new Error("Backup payload is missing digitalProductPassportId");
      }
      if (!parsed?.source?.passportDppId || String(parsed.source.passportDppId) !== String(row.passport_dpp_id)) {
        throw new Error("Backup payload passport GUID does not match the replication record");
      }
      if (expectedPayloadHash && expectedPayloadHash !== actualPayloadHash) {
        throw new Error("Backup payload hash does not match the recorded replication hash");
      }
      await verifyBackupDocumentCopies(parsed.documentation);

      return updateVerificationResult({
        id: row.id,
        verificationStatus: "verified",
        verifiedPayloadHash
      });
    } catch (error) {
      return updateVerificationResult({
        id: row.id,
        verificationStatus: "failed",
        verificationErrorMessage: error.message
      });
    }
  }

  async function listReplications({ companyId, passportDppId }) {
    const result = await pool.query(
      `SELECT id, backup_provider_id, backup_provider_key, passport_dpp_id, lineage_id, company_id, passport_type,
              version_number, dpp_id, snapshot_scope, replication_status, storage_provider, storage_key, public_url,
              payload_hash, payload_json, error_message, verification_status, verification_error_message,
              verified_payload_hash, last_verified_at, created_at, updated_at
       FROM passport_backup_replications
       WHERE company_id = $1
         AND passport_dpp_id = $2
       ORDER BY version_number DESC, updated_at DESC, id DESC`,
      [companyId, passportDppId]
    ).catch(() => ({ rows: [] }));
    return result.rows.map((row) => {
      const payloadJson = parseStoredJson(row.payload_json, {});
      const documentation = payloadJson?.documentation || {};
      return {
        ...row,
        documentation_summary: {
          mandatoryDocumentCount: Number(documentation.mandatoryDocumentCount) || 0,
          publicDocumentCount: Number(documentation.publicDocumentCount) || 0,
          mandatoryBackupSatisfied: documentation.mandatoryBackupSatisfied !== false,
          mandatoryCopyFailures: Array.isArray(documentation.mandatoryCopyFailures) ? documentation.mandatoryCopyFailures : [],
          attachmentCopyCount: Array.isArray(documentation.attachmentCopies) ? documentation.attachmentCopies.length : 0,
          referenceOnlyCount: Array.isArray(documentation.includedByReference) ? documentation.includedByReference.length : 0,
        },
      };
    });
  }

  async function findLatestVerifiedPublicReplication({
    companyId,
    passportDppId = null,
    lineageId = null
  }) {
    const normalizedCompanyId = Number.parseInt(companyId, 10);
    if (!Number.isFinite(normalizedCompanyId)) {
      throw new Error("companyId is required");
    }

    const params = [normalizedCompanyId];
    const filters = ["company_id = $1", "replication_status = 'synced'", "verification_status = 'verified'"];

    if (passportDppId) {
      params.push(normalizeText(passportDppId));
      filters.push(`passport_dpp_id = $${params.length}`);
    }
    if (lineageId) {
      params.push(normalizeText(lineageId));
      filters.push(`lineage_id = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT id, backup_provider_id, backup_provider_key, passport_dpp_id, lineage_id, company_id, passport_type,
              version_number, dpp_id, snapshot_scope, replication_status, storage_provider, storage_key, public_url,
              payload_hash, payload_json, verification_status, verified_payload_hash, updated_at
       FROM passport_backup_replications
       WHERE ${filters.join(" AND ")}
       ORDER BY version_number DESC, updated_at DESC, id DESC
       LIMIT 25`,
      params
    ).catch(() => ({ rows: [] }));

    if (!result.rows.length) return null;

    const providers = await listProviders({ companyId: normalizedCompanyId, activeOnly: true });
    const providerMap = new Map(providers.map((provider) => [provider.provider_key, provider]));

    for (const row of result.rows) {
      const provider = providerMap.get(row.backup_provider_key) || null;
      const supportsPublicHandover = provider ? provider.supports_public_handover !== false : true;
      if (!supportsPublicHandover) continue;
      return {
        ...row,
        payload_json: parseStoredJson(row.payload_json, {}),
        provider: provider || null,
      };
    }

    return null;
  }

  async function listPublicHandovers({
    companyId,
    passportDppId = null
  }) {
    const normalizedCompanyId = Number.parseInt(companyId, 10);
    if (!Number.isFinite(normalizedCompanyId)) {
      throw new Error("companyId is required");
    }

    const params = [normalizedCompanyId];
    let passportFilterSql = "";
    if (passportDppId) {
      params.push(normalizeText(passportDppId));
      passportFilterSql = ` AND passport_dpp_id = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT id, company_id, passport_dpp_id, lineage_id, passport_type, product_id, version_number,
              backup_provider_id, backup_provider_key, source_replication_id, storage_key, public_url,
              public_company_name, public_row_data, handover_status, verification_status, notes,
              activated_by, deactivated_by, activated_at, deactivated_at, created_at, updated_at
       FROM backup_public_handovers
       WHERE company_id = $1${passportFilterSql}
       ORDER BY activated_at DESC, id DESC`,
      params
    ).catch(() => ({ rows: [] }));

    return result.rows.map((row) => ({
      ...row,
      public_row_data: parseStoredJson(row.public_row_data, {}),
    }));
  }

  async function getActivePublicHandover({
    companyId = null,
    passportDppId = null,
    productId = null,
    versionNumber = null
  }) {
    const params = [];
    const filters = ["handover_status = 'active'"];

    if (companyId !== null && companyId !== undefined) {
      params.push(Number.parseInt(companyId, 10));
      filters.push(`company_id = $${params.length}`);
    }
    if (passportDppId) {
      params.push(normalizeText(passportDppId));
      filters.push(`passport_dpp_id = $${params.length}`);
    }
    if (productId) {
      params.push(normalizeText(productId));
      filters.push(`product_id = $${params.length}`);
    }
    if (versionNumber !== null && versionNumber !== undefined) {
      params.push(Number.parseInt(versionNumber, 10));
      filters.push(`version_number = $${params.length}`);
    }

    if (!passportDppId && !productId) return null;

    const result = await pool.query(
      `SELECT id, company_id, passport_dpp_id, lineage_id, passport_type, product_id, version_number,
              backup_provider_id, backup_provider_key, source_replication_id, storage_key, public_url,
              public_company_name, public_row_data, handover_status, verification_status, notes,
              activated_by, deactivated_by, activated_at, deactivated_at, created_at, updated_at
       FROM backup_public_handovers
       WHERE ${filters.join(" AND ")}
       ORDER BY activated_at DESC, id DESC`,
      params
    ).catch(() => ({ rows: [] }));

    if (!result.rows.length) return null;
    if (productId && !passportDppId && result.rows.length > 1) {
      const error = new Error("Multiple backup public handovers match this product identifier.");
      error.code = "AMBIGUOUS_PRODUCT_ID";
      throw error;
    }

    const row = result.rows[0];
    return {
      ...row,
      public_row_data: parseStoredJson(row.public_row_data, {}),
    };
  }

  async function activatePublicHandover({
    companyId,
    passportDppId,
    lineageId = null,
    passportType,
    productId,
    versionNumber = 1,
    publicRowData,
    publicCompanyName = "",
    activatedBy = null,
    actorIdentifier = null,
    notes = null
  }) {
    const normalizedCompanyId = Number.parseInt(companyId, 10);
    if (!Number.isFinite(normalizedCompanyId)) {
      throw new Error("companyId is required");
    }
    const normalizedPassportDppId = normalizeText(passportDppId);
    if (!normalizedPassportDppId) {
      throw new Error("passportDppId is required");
    }
    if (!normalizeText(passportType)) {
      throw new Error("passportType is required");
    }
    if (!normalizeText(productId)) {
      throw new Error("productId is required");
    }
    if (!publicRowData || typeof publicRowData !== "object") {
      throw new Error("publicRowData is required");
    }

    const companyResult = await pool.query(
      `SELECT id, company_name, is_active
       FROM companies
       WHERE id = $1
       LIMIT 1`,
      [normalizedCompanyId]
    );
    const company = companyResult.rows[0] || null;
    if (!company) {
      throw new Error("Company not found");
    }
    if (company.is_active !== false) {
      throw new Error("Backup public handover can only be activated when the economic operator is inactive");
    }

    const replication = await findLatestVerifiedPublicReplication({
      companyId: normalizedCompanyId,
      passportDppId: normalizedPassportDppId,
      lineageId,
    });
    if (!replication) {
      throw new Error("A verified backup replication that supports public handover is required");
    }

    await pool.query(
      `UPDATE backup_public_handovers
       SET handover_status = 'inactive',
           deactivated_by = COALESCE($3, deactivated_by),
           deactivated_at = NOW(),
           updated_at = NOW()
       WHERE company_id = $1
         AND passport_dpp_id = $2
         AND handover_status = 'active'`,
      [normalizedCompanyId, normalizedPassportDppId, activatedBy || null]
    ).catch(() => {});

    const result = await pool.query(
      `INSERT INTO backup_public_handovers (
         company_id, passport_dpp_id, lineage_id, passport_type, product_id, version_number,
         backup_provider_id, backup_provider_key, source_replication_id, storage_key, public_url,
         public_company_name, public_row_data, handover_status, verification_status, notes,
         activated_by, activated_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, 'active', 'verified', $14, $15, NOW(), NOW(), NOW())
       RETURNING *`,
      [
        normalizedCompanyId,
        normalizedPassportDppId,
        normalizeText(lineageId || normalizedPassportDppId),
        normalizeText(passportType),
        normalizeText(productId),
        Number.parseInt(versionNumber, 10) || 1,
        replication.backup_provider_id || null,
        replication.backup_provider_key,
        replication.id,
        replication.storage_key || null,
        replication.public_url || null,
        normalizeText(publicCompanyName, company.company_name || ""),
        JSON.stringify(publicRowData),
        notes || null,
        activatedBy || null,
      ]
    );

    return {
      ...(result.rows[0] || null),
      actor_identifier: actorIdentifier || null,
      public_row_data: parseStoredJson(result.rows[0]?.public_row_data, {}),
      source_replication: replication,
    };
  }

  async function deactivatePublicHandover({
    companyId,
    passportDppId,
    deactivatedBy = null,
    notes = null
  }) {
    const normalizedCompanyId = Number.parseInt(companyId, 10);
    const normalizedPassportDppId = normalizeText(passportDppId);
    if (!Number.isFinite(normalizedCompanyId) || !normalizedPassportDppId) {
      throw new Error("companyId and passportDppId are required");
    }

    const result = await pool.query(
      `UPDATE backup_public_handovers
       SET handover_status = 'inactive',
           notes = COALESCE($4, notes),
           deactivated_by = $3,
           deactivated_at = NOW(),
           updated_at = NOW()
       WHERE company_id = $1
         AND passport_dpp_id = $2
         AND handover_status = 'active'
       RETURNING *`,
      [normalizedCompanyId, normalizedPassportDppId, deactivatedBy || null, notes || null]
    );

    const row = result.rows[0] || null;
    if (!row) return null;
    return {
      ...row,
      public_row_data: parseStoredJson(row.public_row_data, {}),
    };
  }

  async function verifyReplications({
    companyId,
    passportDppId,
    replicationId = null
  }) {
    const params = [companyId, passportDppId];
    let replicationFilterSql = "";
    if (replicationId !== null && replicationId !== undefined) {
      params.push(Number.parseInt(replicationId, 10));
      replicationFilterSql = ` AND id = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT id, passport_dpp_id, payload_hash, storage_key
       FROM passport_backup_replications
       WHERE company_id = $1
         AND passport_dpp_id = $2${replicationFilterSql}
       ORDER BY version_number DESC, updated_at DESC, id DESC`,
      params
    ).catch(() => ({ rows: [] }));

    if (!result.rows.length) {
      return {
        success: false,
        verified: 0,
        failed: 0,
        results: [],
        error: "No backup replication records were found"
      };
    }

    const verificationResults = [];
    for (const row of result.rows) {
      verificationResults.push(await verifyReplicationRecord(row));
    }

    const verified = verificationResults.filter((row) => row?.verification_status === "verified").length;
    const failed = verificationResults.length - verified;
    return {
      success: failed === 0,
      verified,
      failed,
      results: verificationResults
    };
  }

  async function upsertProvider({
    companyId = null,
    providerKey,
    providerType = "oci_object_storage",
    displayName,
    objectPrefix = "backup-provider",
    publicBaseUrl = null,
    supportsPublicHandover = true,
    config = {},
    createdBy = null,
    isActive = true
  }) {
    const normalizedKey = normalizeText(providerKey);
    if (!normalizedKey) {
      throw new Error("provider_key is required");
    }

    const result = await pool.query(
      `INSERT INTO backup_service_providers (
         company_id, provider_key, provider_type, display_name, object_prefix, public_base_url,
         supports_public_handover, config_json, is_active, is_backup_provider, created_by, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, true, $10, NOW())
       ON CONFLICT (provider_key)
       DO UPDATE SET
         company_id = EXCLUDED.company_id,
         provider_type = EXCLUDED.provider_type,
         display_name = EXCLUDED.display_name,
         object_prefix = EXCLUDED.object_prefix,
         public_base_url = EXCLUDED.public_base_url,
         supports_public_handover = EXCLUDED.supports_public_handover,
         config_json = EXCLUDED.config_json,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()
       RETURNING *`,
      [
      companyId ? Number.parseInt(companyId, 10) : null,
      normalizedKey,
      normalizeText(providerType, "oci_object_storage"),
      normalizeText(displayName, normalizedKey),
      normalizeObjectPrefix(objectPrefix),
      publicBaseUrl ? normalizeText(publicBaseUrl) : null,
      supportsPublicHandover !== false,
      JSON.stringify(parseJson(config, {})),
      isActive !== false,
      createdBy || null]

    );
    return result.rows[0] || null;
  }

  async function revokeProvider({ providerKey }) {
    const result = await pool.query(
      `UPDATE backup_service_providers
       SET is_active = false,
           updated_at = NOW()
       WHERE provider_key = $1
       RETURNING *`,
      [providerKey]
    );
    return result.rows[0] || null;
  }

  return {
    activatePublicHandover,
    deactivatePublicHandover,
    findLatestVerifiedPublicReplication,
    getActivePublicHandover,
    getContinuityPolicy,
    listPublicHandovers,
    listProviders,
    listReplications,
    upsertProvider,
    revokeProvider,
    replicateAccessControlEvent,
    replicateAuditAnchorEvent,
    replicatePassportSnapshot,
    verifyReplications
  };
};
