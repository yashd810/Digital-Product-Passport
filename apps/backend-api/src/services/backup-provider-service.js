"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");
const {
  buildPublicPassportSnapshot,
} = require("../shared/passports/public-passport-snapshot");
const {
  flattenSchemaFieldsFromSections,
} = require("../shared/passports/passport-helpers");
const { getApiOrigin } = require("../shared/security/configured-origin");

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

function isPathInsideBase(targetPath, basePath) {
  if (!targetPath || !basePath) return false;
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(basePath);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(`${resolvedBase}${path.sep}`);
}

function normalizeProviderRecord(provider = {}) {
  if (!provider || typeof provider !== "object") return null;
  const providerKey = provider.providerKey || "";
  const providerType = provider.providerType || "";
  const displayName = provider.displayName || providerKey;
  const objectPrefix = provider.objectPrefix || "backup-provider";
  const publicBaseUrl = provider.publicBaseUrl ?? null;
  const supportsPublicHandover = provider.supportsPublicHandover;
  const configJson = provider.configJson ?? {};
  const isActive = provider.isActive ?? true;
  const companyId = provider.companyId ?? null;

  return {
    ...provider,
    id: provider.id ?? null,
    companyId,
    providerKey,
    providerType,
    displayName,
    objectPrefix: normalizeObjectPrefix(objectPrefix),
    publicBaseUrl,
    supportsPublicHandover: supportsPublicHandover !== false,
    configJson,
    isActive: isActive !== false,
    isImplicit: provider.isImplicit ?? false,
  };
}

module.exports = function createBackupProviderService({
  pool,
  storageService,
  buildCanonicalPassportPayload,
  apiOrigin = null,
}) {
  function parseStoredJson(value, fallback = null) {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "object" && !Buffer.isBuffer(value)) return value;
    try {
      return JSON.parse(String(value));
    } catch (_error) {
      return fallback;
    }
  }

  function isBackupProviderRequired() {
    return toBoolean(process.env.BACKUP_PROVIDER_REQUIRED, false);
  }

  function isAutomaticPublicHandoverEnabled() {
    return toBoolean(process.env.BACKUP_PUBLIC_HANDOVER_AUTO_ENABLE, true);
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
    const archivalStorageMode = normalizeText(
      process.env.BACKUP_ARCHIVAL_STORAGE_MODE,
      ""
    );
    const archivalRetentionDays = parsePositiveInteger(
      process.env.BACKUP_ARCHIVAL_RETENTION_DAYS,
      0
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
      archivalStorage: {
        mode: archivalStorageMode || null,
        retentionDays: archivalRetentionDays || null,
        immutabilityEvidenceUri: normalizeText(process.env.BACKUP_ARCHIVAL_IMMUTABILITY_EVIDENCE_URI, "") || null,
      },
      backupProviderEnabled: toBoolean(process.env.BACKUP_PROVIDER_ENABLED, false),
      backupProviderRequired: isBackupProviderRequired(),
      automaticPublicHandoverEnabled: isAutomaticPublicHandoverEnabled(),
      evidenceSource: "applicationPolicy",
    };
  }

  function evidenceStatus(condition) {
    return condition ? "proven" : "notProven";
  }

  async function getContinuityEvidence({ companyId } = {}) {
    const normalizedCompanyId = Number.parseInt(companyId, 10);
    if (!Number.isFinite(normalizedCompanyId)) {
      throw new Error("companyId is required");
    }

    const policy = getContinuityPolicy({ companyId: normalizedCompanyId });
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS "replicationCount",
         COUNT(*) FILTER (WHERE "replicationStatus" = 'synced')::int AS "syncedReplicationCount",
         COUNT(*) FILTER (WHERE "replicationStatus" = 'failed')::int AS "failedReplicationCount",
         COUNT(*) FILTER (WHERE "verificationStatus" = 'verified')::int AS "verifiedReplicationCount",
         COUNT(*) FILTER (WHERE "verificationStatus" = 'failed')::int AS "failedVerificationCount",
         MAX("replicatedAt") AS "latestReplicationAt",
         MAX("lastVerifiedAt") AS "latestVerificationAt"
       FROM "passportBackupReplications"
       WHERE "companyId" = $1`,
      [normalizedCompanyId]
    ).catch(() => ({ rows: [] }));

    const row = result.rows[0] || {};
    const latestReplicationAt = row.latestReplicationAt ? new Date(row.latestReplicationAt) : null;
    const latestVerificationAt = row.latestVerificationAt ? new Date(row.latestVerificationAt) : null;
    const now = new Date();
    const observedReplicationAgeMinutes = latestReplicationAt ?
      Math.max(0, Math.round((now.getTime() - latestReplicationAt.getTime()) / 60000)) :
      null;
    const restoreDrillEvidenceUri = normalizeText(process.env.BACKUP_RESTORE_DRILL_EVIDENCE_URI, "");
    const lastRestoreDrillAt = normalizeText(process.env.BACKUP_LAST_RESTORE_DRILL_AT, "");
    const immutableEvidenceUri = normalizeText(process.env.BACKUP_ARCHIVAL_IMMUTABILITY_EVIDENCE_URI, "");
    const archivalStorageMode = normalizeText(process.env.BACKUP_ARCHIVAL_STORAGE_MODE, "");
    const backupProviderConfigured = Number(row.replicationCount) > 0 || buildImplicitProvider(normalizedCompanyId) !== null;
    const missingEvidence = [];
    if (policy.backupProviderRequired && !backupProviderConfigured) missingEvidence.push("backupProvider");
    if (!(Number(row.verifiedReplicationCount) > 0 && latestVerificationAt)) missingEvidence.push("replicationVerification");
    if (!(lastRestoreDrillAt && restoreDrillEvidenceUri)) missingEvidence.push("restoreDrillEvidence");
    if (!(archivalStorageMode && immutableEvidenceUri)) missingEvidence.push("immutabilityEvidence");
    const readinessStatus = missingEvidence.length ? "notReady" : "ready";

    return {
      companyId: normalizedCompanyId,
      policy,
      readiness: {
        status: readinessStatus,
        backupProviderConfigured,
        missingEvidence,
      },
      replicationEvidence: {
        status: evidenceStatus(Number(row.syncedReplicationCount) > 0 && observedReplicationAgeMinutes !== null && observedReplicationAgeMinutes <= policy.rpoMinutes),
        rpoMinutes: policy.rpoMinutes,
        observedReplicationAgeMinutes,
        latestReplicationAt: latestReplicationAt ? latestReplicationAt.toISOString() : null,
        replicationCount: Number(row.replicationCount) || 0,
        syncedReplicationCount: Number(row.syncedReplicationCount) || 0,
        failedReplicationCount: Number(row.failedReplicationCount) || 0,
      },
      verificationEvidence: {
        status: evidenceStatus(Number(row.verifiedReplicationCount) > 0 && latestVerificationAt),
        verificationFrequency: policy.verificationFrequency,
        latestVerificationAt: latestVerificationAt ? latestVerificationAt.toISOString() : null,
        verifiedReplicationCount: Number(row.verifiedReplicationCount) || 0,
        failedVerificationCount: Number(row.failedVerificationCount) || 0,
      },
      restoreDrillEvidence: {
        status: evidenceStatus(Boolean(lastRestoreDrillAt && restoreDrillEvidenceUri)),
        rtoHours: policy.rtoHours,
        restoreTestFrequency: policy.restoreTestFrequency,
        lastRestoreDrillAt: lastRestoreDrillAt || null,
        evidenceUri: restoreDrillEvidenceUri || null,
      },
      immutableArchivalEvidence: {
        status: evidenceStatus(Boolean(archivalStorageMode && immutableEvidenceUri)),
        mode: archivalStorageMode || null,
        retentionDays: policy.archivalStorage.retentionDays,
        evidenceUri: immutableEvidenceUri || null,
      },
    };
  }

  function buildImplicitProvider(companyId = null) {
    if (!toBoolean(process.env.BACKUP_PROVIDER_ENABLED, false)) return null;
    return normalizeProviderRecord({
      id: null,
      companyId: companyId ? Number.parseInt(companyId, 10) : null,
      providerKey: normalizeText(process.env.BACKUP_PROVIDER_KEY, "oci-object-storage"),
      providerType: normalizeText(process.env.BACKUP_PROVIDER_TYPE, "ociObjectStorage"),
      displayName: normalizeText(process.env.BACKUP_PROVIDER_DISPLAY_NAME, "OCI Object Storage Backup"),
      objectPrefix: normalizeObjectPrefix(process.env.BACKUP_PROVIDER_OBJECT_PREFIX),
      publicBaseUrl: normalizeText(process.env.BACKUP_PROVIDER_PUBLIC_BASE_URL, ""),
      supportsPublicHandover: toBoolean(process.env.BACKUP_PROVIDER_SUPPORTS_PUBLIC_HANDOVER, true),
      configJson: {
        region: normalizeText(process.env.BACKUP_PROVIDER_REGION || process.env.STORAGE_S3_REGION, ""),
        bucket: normalizeText(process.env.BACKUP_PROVIDER_BUCKET || process.env.STORAGE_S3_BUCKET, ""),
        endpoint: normalizeText(process.env.BACKUP_PROVIDER_ENDPOINT || process.env.STORAGE_S3_ENDPOINT, ""),
        mode: "implicitEnv"
      },
      isActive: true,
      isBackupProvider: true,
      isImplicit: true
    });
  }

  function mapPublicHandoverRow(row) {
    if (!row) return null;
    const publicRowData = parseStoredJson(row.publicRowData, {});
    return {
      ...row,
      companyId: row.companyId ?? null,
      passportDppId: row.passportDppId ?? null,
      lineageId: row.lineageId ?? null,
      passportType: row.passportType ?? null,
      internalAliasId: row.internalAliasId ?? null,
      versionNumber: row.versionNumber ?? null,
      backupProviderId: row.backupProviderId ?? null,
      backupProviderKey: row.backupProviderKey ?? null,
      sourceReplicationId: row.sourceReplicationId ?? null,
      storageKey: row.storageKey ?? null,
      publicUrl: row.publicUrl ?? null,
      publicCompanyName: row.publicCompanyName ?? null,
      publicRowData: publicRowData,
      handoverStatus: row.handoverStatus ?? null,
      verificationStatus: row.verificationStatus ?? null,
      activatedBy: row.activatedBy ?? null,
      deactivatedBy: row.deactivatedBy ?? null,
      activatedAt: row.activatedAt ?? null,
      deactivatedAt: row.deactivatedAt ?? null,
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
    };
  }

  async function listProviders({ companyId = null, activeOnly = true } = {}) {
    const params = [];
    const filters = ["isBackupProvider = true"];

    if (activeOnly) filters.push("isActive = true");
    if (companyId !== null && companyId !== undefined) {
      params.push(Number.parseInt(companyId, 10));
      filters.push(`("companyId" IS NULL OR "companyId" = $${params.length})`);
    }

    const result = await pool.query(
      `SELECT id, "companyId" AS "companyId", "providerKey" AS "providerKey", "providerType" AS "providerType", "displayName" AS "displayName", "objectPrefix" AS "objectPrefix", "publicBaseUrl" AS "publicBaseUrl",
              "supportsPublicHandover" AS "supportsPublicHandover", "configJson" AS "configJson", "isActive" AS "isActive", "createdAt" AS "createdAt", "updatedAt" AS "updatedAt"
       FROM "backupServiceProviders"
       WHERE ${filters.join(" AND ")}
       ORDER BY "companyId" NULLS FIRST, "providerKey" ASC`,
      params
    ).catch(() => ({ rows: [] }));

    const rows = result.rows.map(normalizeProviderRecord).filter(Boolean);
    const implicitProvider = buildImplicitProvider(companyId);
    if (implicitProvider && !rows.some((row) => row.providerKey === implicitProvider.providerKey)) {
      rows.unshift(implicitProvider);
    }
    return rows;
  }

  function buildNoProviderResult(reason = "noBackupProvider") {
    if (isBackupProviderRequired()) {
      return {
        success: false,
        skipped: false,
        reason,
        error: "A backup provider is required in this environment, but none is configured.",
        results: [],
      };
    }
    return { success: true, skipped: true, reason, results: [] };
  }

  function buildBackupEnvelope({
    passport,
    typeDef,
    companyName = "",
    reason = "manual",
    snapshotScope = "releasedCurrent",
    documentation = null,
    provider
  }) {
    const canonicalPayload = buildCanonicalPassportPayload(passport, typeDef, { companyName });
    const publicRowData = buildPublicPassportSnapshot(passport, typeDef);
    return {
      backupProvider: {
        providerKey: provider.providerKey,
        providerType: provider.providerType,
        displayName: provider.displayName,
        supportsPublicHandover: provider.supportsPublicHandover !== false
      },
      snapshotScope,
      reason,
      capturedAt: new Date().toISOString(),
      source: {
        companyId: passport.companyId || null,
        companyName: companyName || null,
        passportDppId: passport.dppId || null,
        lineageId: passport.lineageId || passport.dppId || null,
        passportType: passport.passportType || typeDef?.typeName || null,
        versionNumber: Number(passport.versionNumber) || 1,
        releaseStatus: passport.releaseStatus || null
      },
      documentation: documentation || {
        includedByReference: [],
        attachmentCopies: [],
        mandatoryDocumentCount: 0,
        publicDocumentCount: 0,
      },
      publicRowData,
      passport: canonicalPayload
    };
  }

  function buildStorageKey({ provider, passport, snapshotScope }) {
    const lineageId = normalizeText(passport.lineageId || passport.dppId || "unknown-lineage", "unknown-lineage");
    const versionNumber = Number(passport.versionNumber) || 1;
    return path.posix.join(
      normalizeObjectPrefix(provider.objectPrefix),
      `company-${passport.companyId || "unknown"}`,
      `passport-${lineageId}`,
      `v${versionNumber}`,
      `${snapshotScope}.json`
    );
  }

  function buildAttachmentStorageKey({ provider, passport, attachment, fallbackFieldKey = "document" }) {
    const lineageId = normalizeText(passport.lineageId || passport.dppId || "unknown-lineage", "unknown-lineage");
    const versionNumber = Number(passport.versionNumber) || 1;
    const fieldKey = normalizeStorageSegment(attachment?.fieldKey || fallbackFieldKey, "document");
    const publicId = normalizeStorageSegment(attachment?.publicId || Date.now(), "document");
    const ext = path.extname(String(
      attachment?.storageKey ||
      attachment?.filePath ||
      attachment?.fileUrl ||
      ""
    )).toLowerCase();
    const safeExt = ext && ext.length <= 10 ? ext.replace(/[^a-z0-9.]/g, "") : "";
    return path.posix.join(
      normalizeObjectPrefix(provider.objectPrefix),
      `company-${passport.companyId || "unknown"}`,
      `passport-${lineageId}`,
      `v${versionNumber}`,
      "documents",
      `${fieldKey}-${publicId}${safeExt || ""}`
    );
  }

  function collectTypeFields(typeDef) {
    return Array.isArray(typeDef?.fieldsJson?.sections) ?
      flattenSchemaFieldsFromSections(typeDef.fieldsJson.sections) :
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
      `SELECT id,
              "publicId" AS "publicId",
              "companyId" AS "companyId",
              "passportDppId" AS "passportDppId",
              "fieldKey" AS "fieldKey",
              "filePath" AS "filePath",
              "storageKey" AS "storageKey",
              "storageProvider" AS "storageProvider",
              "fileUrl" AS "fileUrl",
              "mimeType" AS "mimeType",
              "sizeBytes" AS "sizeBytes",
              "isPublic" AS "isPublic",
              "createdAt" AS "createdAt"
       FROM "passportAttachments"
       WHERE "companyId" = $1
         AND "passportDppId" = $2
       ORDER BY "createdAt" DESC, id DESC`,
      [companyId, passportDppId]
    ).catch(() => ({ rows: [] }));
    return result.rows;
  }

  async function readAttachmentBuffer(attachment) {
    if (attachment?.storageKey && storageService?.fetchObject) {
      const objectResponse = await storageService.fetchObject(attachment.storageKey);
      return Buffer.from(await objectResponse.arrayBuffer());
    }
    if (attachment?.filePath) {
      return readLocalAttachmentFile(attachment.filePath);
    }
    return null;
  }

  function getAllowedLocalAttachmentRoots() {
    const roots = [];
    const addRoot = (value) => {
      if (!value) return;
      const resolved = path.resolve(String(value));
      if (!roots.includes(resolved)) roots.push(resolved);
    };

    if (typeof storageService?.getLocalAbsolutePath === "function") {
      try {
        addRoot(storageService.getLocalAbsolutePath(""));
      } catch {
        // Ignore storage providers that cannot expose a local root.
      }
    }
    addRoot(storageService?.filesBaseDir);
    addRoot(storageService?.repoBaseDir);
    addRoot(storageService?.uploadsBaseDir);
    return roots;
  }

  async function readLocalAttachmentFile(filePath) {
    const absolutePath = path.resolve(String(filePath || ""));
    const allowedRoots = getAllowedLocalAttachmentRoots();
    if (!allowedRoots.some((root) => isPathInsideBase(absolutePath, root))) {
      const error = new Error("Attachment file path resolves outside configured storage directories");
      error.code = "invalidAttachmentFilePath";
      throw error;
    }
    return fs.promises.readFile(absolutePath);
  }

  async function buildDocumentationManifest({ passport, typeDef, provider }) {
    const fieldDefs = collectTypeFields(typeDef);
    const fileFieldMap = new Map(
      fieldDefs
        .filter((fieldDef) => fieldDef?.key && isFileLikeField(fieldDef))
        .map((fieldDef) => [fieldDef.key, fieldDef])
    );
    const attachments = await loadPassportAttachments({
      companyId: passport.companyId,
      passportDppId: passport.dppId,
    });
    const appBaseUrl = apiOrigin || getApiOrigin();

    const attachmentCopies = [];
    const includedByReference = [];

    for (const attachment of attachments) {
      const fieldDef = fileFieldMap.get(attachment.fieldKey) || null;
      const publicDownloadUrl = attachment.publicId ? `${appBaseUrl}/public-files/${attachment.publicId}` : null;
      const manifestEntry = {
        fieldKey: attachment.fieldKey || null,
        label: fieldDef?.label || attachment.fieldKey || "Attachment",
        mandatory: isMandatoryField(fieldDef),
        deliveryMode: attachment.isPublic ? "publicDownload" : "controlledPrivate",
        isPublic: attachment.isPublic === true,
        publicDownloadUrl: attachment.isPublic ? publicDownloadUrl : null,
        sourceReference: attachment.fileUrl || publicDownloadUrl || null,
        sourceReferenceType: attachment.publicId ? "publicFileRoute" : "storedAttachment",
        mimeType: attachment.mimeType || "application/octet-stream",
        sizeBytes: attachment.sizeBytes || null,
      };

      let backupCopy = null;
      try {
        const buffer = await readAttachmentBuffer(attachment);
        if (buffer) {
          const copied = await storageService.saveObject({
            key: buildAttachmentStorageKey({ provider, passport, attachment, fallbackFieldKey: attachment.fieldKey }),
            buffer,
            contentType: attachment.mimeType || "application/octet-stream",
            cacheControl: "private, max-age=0, no-store",
          });
          backupCopy = {
            storageKey: copied?.storageKey || null,
            publicUrl: copied?.url || null,
            contentHash: sha256Hex(buffer),
            contentType: attachment.mimeType || "application/octet-stream",
            storedAt: new Date().toISOString(),
          };
        }
      } catch (error) {
        backupCopy = {
          storageKey: null,
          publicUrl: null,
          contentHash: null,
          contentType: attachment.mimeType || "application/octet-stream",
          storedAt: new Date().toISOString(),
          error: error.message,
        };
      }

      attachmentCopies.push({
        ...manifestEntry,
        backupCopyStatus: backupCopy?.storageKey ? "copied" : "copyFailed",
        backupCopy,
      });
    }

    for (const [fieldKey, fieldDef] of fileFieldMap.entries()) {
      const matchingAttachment = attachments.find((attachment) => attachment.fieldKey === fieldKey);
      const fieldValue = passport?.[fieldKey];
      if (matchingAttachment) continue;
      if (!normalizeText(fieldValue)) continue;

      includedByReference.push({
        fieldKey,
        label: fieldDef?.label || fieldKey,
        mandatory: isMandatoryField(fieldDef),
        referenceUrl: String(fieldValue),
        referenceType: String(fieldValue).includes("/public-files/") ? "publicFileRoute" : "externalReference",
        downloadable: /^https?:\/\//i.test(String(fieldValue)),
        preservedAccessMode: "referenceOnly",
        backupCopyStatus: isMandatoryField(fieldDef) ? "referenceOnlyUnbacked" : "referenceOnly",
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
        providerKey: provider.providerKey,
        providerType: provider.providerType,
        displayName: provider.displayName,
        supportsPublicHandover: provider.supportsPublicHandover !== false,
      },
      eventCategory: "accessControl",
      eventType: normalizeText(eventType, "accessControlChange"),
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
      normalizeObjectPrefix(provider.objectPrefix),
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
        providerKey: provider.providerKey,
        providerType: provider.providerType,
        displayName: provider.displayName,
        supportsPublicHandover: provider.supportsPublicHandover !== false,
      },
      eventCategory: "auditAnchor",
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
      normalizeObjectPrefix(provider.objectPrefix),
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
      `INSERT INTO "passportBackupReplications" (
         "backupProviderId", "backupProviderKey", "passportDppId", "lineageId", "companyId", "passportType",
         "versionNumber", "dppId", "snapshotScope", "replicationStatus", "storageProvider", "storageKey", "publicUrl",
         "payloadHash", "payloadJson", "errorMessage", "verificationStatus", "verificationErrorMessage",
         "verifiedPayloadHash", "replicatedAt", "updatedAt"
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, 'pending', NULL, NULL, NOW(), NOW())
       ON CONFLICT ("backupProviderKey", "passportDppId", "versionNumber", "snapshotScope")
       DO UPDATE SET
         "replicationStatus" = EXCLUDED."replicationStatus",
         "storageProvider" = EXCLUDED."storageProvider",
         "storageKey" = EXCLUDED."storageKey",
         "publicUrl" = EXCLUDED."publicUrl",
         "payloadHash" = EXCLUDED."payloadHash",
         "payloadJson" = EXCLUDED."payloadJson",
         "errorMessage" = EXCLUDED."errorMessage",
         "verificationStatus" = 'pending',
         "verificationErrorMessage" = NULL,
         "verifiedPayloadHash" = NULL,
         "replicatedAt" = NOW(),
         "updatedAt" = NOW()
       RETURNING *`,
      [
      provider.id || null,
      provider.providerKey,
      passport.dppId,
      passport.lineageId || passport.dppId,
      passport.companyId,
      passport.passportType || null,
      Number(passport.versionNumber) || 1,
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
    snapshotScope = "releasedCurrent",
    providerKey = null
  }) {
    if (!passport?.dppId || !passport?.companyId) {
      return { success: false, error: "Passport identity is required for backup replication", results: [] };
    }

    const providers = (await listProviders({ companyId: passport.companyId })).
    filter((provider) => !providerKey || provider.providerKey === providerKey);

    if (!providers.length) {
      return buildNoProviderResult("noBackupProvider");
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
        backupProviderKey: provider.providerKey,
        replicationStatus: replicationStatus,
        errorMessage: errorMessage
      });
    }

    return {
      success: results.every((row) => row.replicationStatus === "synced"),
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
      filter((provider) => !providerKey || provider.providerKey === providerKey);

    if (!providers.length) {
      return buildNoProviderResult("noBackupProvider");
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
        backupProviderKey: provider.providerKey,
        eventType: envelope.eventType,
        severity: envelope.severity,
        revocationMode: envelope.revocationMode,
        replicationStatus: replicationStatus,
        storageProvider: storageService?.provider || storageService?.name || null,
        storageKey: storageKey,
        publicUrl: publicUrl,
        errorMessage: errorMessage,
      });
    }

    return {
      success: results.every((row) => row.replicationStatus === "synced"),
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
      filter((provider) => !providerKey || provider.providerKey === providerKey);

    if (!providers.length) {
      return buildNoProviderResult("noBackupProvider");
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
        backupProviderKey: provider.providerKey,
        eventCategory: "auditAnchor",
        anchorId: anchor?.id || null,
        rootEventHash: anchor?.rootEventHash || summary?.latestEventHash || null,
        replicationStatus: replicationStatus,
        storageProvider: storageService?.provider || storageService?.name || null,
        storageKey: storageKey,
        publicUrl: publicUrl,
        errorMessage: errorMessage,
      });
    }

    return {
      success: results.every((row) => row.replicationStatus === "synced"),
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
      `UPDATE "passportBackupReplications"
       SET "verificationStatus" = $2,
           "verificationErrorMessage" = $3,
           "verifiedPayloadHash" = $4,
           "lastVerifiedAt" = NOW(),
           "updatedAt" = NOW()
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
    if (!row?.storageKey) {
      return updateVerificationResult({
        id: row.id,
        verificationStatus: "failed",
        verificationErrorMessage: "Replication record is missing a storage key"
      });
    }

    try {
      const objectResponse = await storageService.fetchObject(row.storageKey);
      const buffer = Buffer.from(await objectResponse.arrayBuffer());
      const parsed = JSON.parse(buffer.toString("utf8"));
      const verifiedPayloadHash = computeEnvelopeHash(parsed);
      const expectedPayloadHash = normalizeHash(row.payloadHash);
      const actualPayloadHash = normalizeHash(verifiedPayloadHash);

      if (!parsed?.passport?.digitalProductPassportId) {
        throw new Error("Backup payload is missing digitalProductPassportId");
      }
      if (!parsed?.source?.passportDppId || String(parsed.source.passportDppId) !== String(row.passportDppId)) {
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
      `SELECT id, "backupProviderId", "backupProviderKey", "passportDppId", "lineageId", "companyId", "passportType",
              "versionNumber", "dppId", "snapshotScope", "replicationStatus", "storageProvider", "storageKey", "publicUrl",
              "payloadHash", "payloadJson", "errorMessage", "verificationStatus", "verificationErrorMessage",
              "verifiedPayloadHash", "lastVerifiedAt", "createdAt", "updatedAt"
       FROM "passportBackupReplications"
       WHERE "companyId" = $1
         AND "passportDppId" = $2
       ORDER BY "versionNumber" DESC, "updatedAt" DESC, id DESC`,
      [companyId, passportDppId]
    ).catch(() => ({ rows: [] }));
    return result.rows.map((row) => {
      const payloadJson = parseStoredJson(row.payloadJson, {});
      const documentation = payloadJson?.documentation || {};
      return {
        id: row.id,
        backupProviderId: row.backupProviderId,
        backupProviderKey: row.backupProviderKey,
        passportDppId: row.passportDppId,
        lineageId: row.lineageId,
        companyId: row.companyId,
        passportType: row.passportType,
        versionNumber: row.versionNumber,
        dppId: row.dppId,
        snapshotScope: row.snapshotScope,
        replicationStatus: row.replicationStatus,
        storageProvider: row.storageProvider,
        storageKey: row.storageKey,
        publicUrl: row.publicUrl,
        payloadHash: row.payloadHash,
        payloadJson,
        errorMessage: row.errorMessage,
        verificationStatus: row.verificationStatus,
        verificationErrorMessage: row.verificationErrorMessage,
        verifiedPayloadHash: row.verifiedPayloadHash,
        lastVerifiedAt: row.lastVerifiedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        documentationSummary: {
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
    const filters = [`"companyId" = $1`, `"replicationStatus" = 'synced'`, `"verificationStatus" = 'verified'`];

    if (passportDppId) {
      params.push(normalizeText(passportDppId));
      filters.push(`"passportDppId" = $${params.length}`);
    }
    if (lineageId) {
      params.push(normalizeText(lineageId));
      filters.push(`"lineageId" = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT id, "backupProviderId", "backupProviderKey", "passportDppId", "lineageId", "companyId", "passportType",
              "versionNumber", "dppId", "snapshotScope", "replicationStatus", "storageProvider", "storageKey", "publicUrl",
              "payloadHash", "payloadJson", "verificationStatus", "verifiedPayloadHash", "updatedAt"
       FROM "passportBackupReplications"
       WHERE ${filters.join(" AND ")}
       ORDER BY "versionNumber" DESC, "updatedAt" DESC, id DESC
       LIMIT 25`,
      params
    ).catch(() => ({ rows: [] }));

    if (!result.rows.length) return null;

    const providers = await listProviders({ companyId: normalizedCompanyId, activeOnly: true });
    const providerMap = new Map(providers.map((provider) => [provider.providerKey, provider]));

    for (const row of result.rows) {
      const provider = providerMap.get(row.backupProviderKey) || null;
      const supportsPublicHandover = provider ? provider.supportsPublicHandover !== false : true;
      if (!supportsPublicHandover) continue;
      return {
        ...row,
        payloadJson: parseStoredJson(row.payloadJson, {}),
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
      passportFilterSql = ` AND "passportDppId" = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT id, "companyId", "passportDppId", "lineageId", "passportType", "internalAliasId", "versionNumber",
              "backupProviderId", "backupProviderKey", "sourceReplicationId", "storageKey", "publicUrl",
              "publicCompanyName", "publicRowData", "handoverStatus", "verificationStatus", notes,
              "activatedBy", "deactivatedBy", "activatedAt", "deactivatedAt", "createdAt", "updatedAt"
       FROM "backupPublicHandovers"
       WHERE "companyId" = $1${passportFilterSql}
       ORDER BY "activatedAt" DESC, id DESC`,
      params
    ).catch(() => ({ rows: [] }));

    return result.rows.map(mapPublicHandoverRow).filter(Boolean);
  }

  async function getActivePublicHandover({
    companyId = null,
    passportDppId = null,
    internalAliasId = null,
    versionNumber = null
  }) {
    const params = [];
    const filters = [`"handoverStatus" = 'active'`];

    if (companyId !== null && companyId !== undefined) {
      params.push(Number.parseInt(companyId, 10));
      filters.push(`"companyId" = $${params.length}`);
    }
    if (passportDppId) {
      params.push(normalizeText(passportDppId));
      filters.push(`"passportDppId" = $${params.length}`);
    }
    if (internalAliasId) {
      params.push(normalizeText(internalAliasId));
      filters.push(`"internalAliasId" = $${params.length}`);
    }
    if (versionNumber !== null && versionNumber !== undefined) {
      params.push(Number.parseInt(versionNumber, 10));
      filters.push(`"versionNumber" = $${params.length}`);
    }

    if (!passportDppId && !internalAliasId) return null;

    const result = await pool.query(
      `SELECT id, "companyId", "passportDppId", "lineageId", "passportType", "internalAliasId", "versionNumber",
              "backupProviderId", "backupProviderKey", "sourceReplicationId", "storageKey", "publicUrl",
              "publicCompanyName", "publicRowData", "handoverStatus", "verificationStatus", notes,
              "activatedBy", "deactivatedBy", "activatedAt", "deactivatedAt", "createdAt", "updatedAt"
       FROM "backupPublicHandovers"
       WHERE ${filters.join(" AND ")}
       ORDER BY "activatedAt" DESC, id DESC`,
      params
    ).catch(() => ({ rows: [] }));

    if (!result.rows.length) return null;
    if (internalAliasId && !passportDppId && result.rows.length > 1) {
      const error = new Error("Multiple backup public handovers match this product identifier.");
      error.code = "ambiguousProductId";
      throw error;
    }

    return mapPublicHandoverRow(result.rows[0]);
  }

  async function activatePublicHandover({
    companyId,
    passportDppId,
    lineageId = null,
    passportType,
    internalAliasId,
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
    if (!normalizeText(internalAliasId)) {
      throw new Error("internalAliasId is required");
    }
    if (!publicRowData || typeof publicRowData !== "object") {
      throw new Error("publicRowData is required");
    }

    const companyResult = await pool.query(
      `SELECT id, "companyName", "isActive"
       FROM companies
       WHERE id = $1
       LIMIT 1`,
      [normalizedCompanyId]
    );
    const company = companyResult.rows[0] || null;
    if (!company) {
      throw new Error("Company not found");
    }
    if (company.isActive !== false) {
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
      `UPDATE "backupPublicHandovers"
       SET "handoverStatus" = 'inactive',
           "deactivatedBy" = COALESCE($3, "deactivatedBy"),
           "deactivatedAt" = NOW(),
           "updatedAt" = NOW()
       WHERE "companyId" = $1
         AND "passportDppId" = $2
         AND "handoverStatus" = 'active'`,
      [normalizedCompanyId, normalizedPassportDppId, activatedBy || null]
    ).catch((error) => {
      logger.warn({
        err: error,
        companyId: normalizedCompanyId,
        passportDppId: normalizedPassportDppId,
      }, "Failed to deactivate existing backup public handovers");
    });

    const result = await pool.query(
      `INSERT INTO "backupPublicHandovers" (
         "companyId", "passportDppId", "lineageId", "passportType", "internalAliasId", "versionNumber",
         "backupProviderId", "backupProviderKey", "sourceReplicationId", "storageKey", "publicUrl",
         "publicCompanyName", "publicRowData", "handoverStatus", "verificationStatus", notes,
         "activatedBy", "activatedAt", "createdAt", "updatedAt"
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, 'active', 'verified', $14, $15, NOW(), NOW(), NOW())
       RETURNING *`,
      [
        normalizedCompanyId,
        normalizedPassportDppId,
        normalizeText(lineageId || normalizedPassportDppId),
        normalizeText(passportType),
        normalizeText(internalAliasId),
        Number.parseInt(versionNumber, 10) || 1,
        replication.backupProviderId || null,
        replication.backupProviderKey,
        replication.id,
        replication.storageKey || null,
        replication.publicUrl || null,
        normalizeText(publicCompanyName, company.companyName || ""),
        JSON.stringify(publicRowData),
        notes || null,
        activatedBy || null,
      ]
    );

    return {
      ...mapPublicHandoverRow(result.rows[0]),
      actorIdentifier: actorIdentifier || null,
      sourceReplication: replication,
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
      `UPDATE "backupPublicHandovers"
       SET "handoverStatus" = 'inactive',
           notes = COALESCE($4, notes),
           "deactivatedBy" = $3,
           "deactivatedAt" = NOW(),
           "updatedAt" = NOW()
       WHERE "companyId" = $1
         AND "passportDppId" = $2
         AND "handoverStatus" = 'active'
       RETURNING *`,
      [normalizedCompanyId, normalizedPassportDppId, deactivatedBy || null, notes || null]
    );

    const row = result.rows[0] || null;
    if (!row) return null;
    return mapPublicHandoverRow(row);
  }

  async function ensureAutomaticPublicHandover({
    passportDppId = null,
    internalAliasId = null,
    versionNumber = null,
  }) {
    if (!isAutomaticPublicHandoverEnabled()) return null;
    if (!passportDppId && !internalAliasId) return null;

    const filters = ["replicationStatus = 'synced'", "verificationStatus = 'verified'"];
    const params = [];

    if (passportDppId) {
      params.push(normalizeText(passportDppId));
      filters.push(`"passportDppId" = $${params.length}`);
    }
    if (internalAliasId) {
      params.push(normalizeText(internalAliasId));
      filters.push(`"internalAliasId" = $${params.length}`);
    }
    if (versionNumber !== null && versionNumber !== undefined) {
      params.push(Number.parseInt(versionNumber, 10) || 1);
      filters.push(`"versionNumber" = $${params.length}`);
    }

    const replicationResult = await pool.query(
      `SELECT id,
              "backupProviderId" AS "backupProviderId",
              "backupProviderKey" AS "backupProviderKey",
              "passportDppId" AS "passportDppId",
              "lineageId" AS "lineageId",
              "companyId" AS "companyId",
              "passportType" AS "passportType",
              "internalAliasId" AS "internalAliasId",
              "versionNumber" AS "versionNumber",
              "publicUrl" AS "publicUrl",
              "verificationStatus" AS "verificationStatus",
              "payloadJson" AS "payloadJson",
              "updatedAt" AS "updatedAt"
       FROM "passportBackupReplications"
       WHERE ${filters.join(" AND ")}
       ORDER BY "updatedAt" DESC, id DESC
       LIMIT 10`,
      params
    ).catch(() => ({ rows: [] }));

    for (const replication of replicationResult.rows) {
      const existing = await getActivePublicHandover({
        companyId: replication.companyId,
        passportDppId: replication.passportDppId,
      });
      if (existing) return existing;

      const companyResult = await pool.query(
        `SELECT id, "companyName" AS "companyName", "isActive" AS "isActive"
         FROM companies
         WHERE id = $1
         LIMIT 1`,
        [replication.companyId]
      ).catch(() => ({ rows: [] }));
      const company = companyResult.rows[0] || null;
      if (!company || company.isActive !== false) continue;

      const payloadJson = parseStoredJson(replication.payloadJson, {});
      const publicRowData = payloadJson?.publicRowData && typeof payloadJson.publicRowData === "object"
        ? payloadJson.publicRowData
        : null;
      const payloadSource = payloadJson?.source && typeof payloadJson.source === "object" ? payloadJson.source : {};
      if (!publicRowData) continue;

      return activatePublicHandover({
        companyId: replication.companyId,
        passportDppId: replication.passportDppId,
        lineageId: replication.lineageId || payloadSource.lineageId || replication.passportDppId,
        passportType: replication.passportType || payloadSource.passportType,
        internalAliasId: replication.internalAliasId || publicRowData.internalAliasId,
        versionNumber: replication.versionNumber || payloadSource.versionNumber || 1,
        publicRowData,
        publicCompanyName: company.companyName || "",
        activatedBy: null,
        actorIdentifier: "system:auto-backup-handover",
        notes: "Automatically activated from verified backup replication because the economic operator is inactive.",
      });
    }

    return null;
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
      `SELECT id, "passportDppId", "payloadHash", "storageKey"
       FROM "passportBackupReplications"
       WHERE "companyId" = $1
         AND "passportDppId" = $2${replicationFilterSql}
       ORDER BY "versionNumber" DESC, "updatedAt" DESC, id DESC`,
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

    const verified = verificationResults.filter((row) => row?.verificationStatus === "verified").length;
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
    providerType = "ociObjectStorage",
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
      throw new Error("providerKey is required");
    }

    const result = await pool.query(
      `INSERT INTO "backupServiceProviders" (
         "companyId", "providerKey", "providerType", "displayName", "objectPrefix", "publicBaseUrl",
         "supportsPublicHandover", "configJson", "isActive", "isBackupProvider", "createdBy", "updatedAt"
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, true, $10, NOW())
       ON CONFLICT ("providerKey")
       DO UPDATE SET
         "companyId" = EXCLUDED."companyId",
         "providerType" = EXCLUDED."providerType",
         "displayName" = EXCLUDED."displayName",
         "objectPrefix" = EXCLUDED."objectPrefix",
         "publicBaseUrl" = EXCLUDED."publicBaseUrl",
         "supportsPublicHandover" = EXCLUDED."supportsPublicHandover",
         "configJson" = EXCLUDED."configJson",
         "isActive" = EXCLUDED."isActive",
         "updatedAt" = NOW()
       RETURNING *`,
      [
      companyId ? Number.parseInt(companyId, 10) : null,
      normalizedKey,
      normalizeText(providerType, "ociObjectStorage"),
      normalizeText(displayName, normalizedKey),
      normalizeObjectPrefix(objectPrefix),
      publicBaseUrl ? normalizeText(publicBaseUrl) : null,
      supportsPublicHandover !== false,
      JSON.stringify(parseJson(config, {})),
      isActive !== false,
      createdBy || null]

    );
    const row = result.rows[0] || null;
    if (!row) return null;
    return {
      id: row.id,
      companyId: row.companyId,
      providerKey: row.providerKey,
      providerType: row.providerType,
      displayName: row.displayName,
      objectPrefix: row.objectPrefix,
      publicBaseUrl: row.publicBaseUrl,
      supportsPublicHandover: row.supportsPublicHandover,
      configJson: row.configJson,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async function revokeProvider({ providerKey }) {
    const result = await pool.query(
      `UPDATE "backupServiceProviders"
       SET "isActive" = false,
           "updatedAt" = NOW()
       WHERE "providerKey" = $1
       RETURNING *`,
      [providerKey]
    );
    const row = result.rows[0] || null;
    if (!row) return null;
    return {
      id: row.id,
      companyId: row.companyId,
      providerKey: row.providerKey,
      providerType: row.providerType,
      displayName: row.displayName,
      objectPrefix: row.objectPrefix,
      publicBaseUrl: row.publicBaseUrl,
      supportsPublicHandover: row.supportsPublicHandover,
      configJson: row.configJson,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    activatePublicHandover,
    deactivatePublicHandover,
    ensureAutomaticPublicHandover,
    findLatestVerifiedPublicReplication,
    getActivePublicHandover,
    getContinuityEvidence,
    getContinuityPolicy,
    isBackupProviderRequired,
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
