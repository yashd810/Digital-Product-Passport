"use strict";

const nodeCrypto = require("crypto");
const logger = require("./logger");
const canonicalizeJson = require("./json-canonicalization");

const IN_REVISION_STATUSES_SQL       = `('in_revision','revised')`;
const EDITABLE_RELEASE_STATUSES_SQL  = `('draft','in_revision','revised')`;
const REVISION_BLOCKING_STATUSES_SQL = `('draft','in_revision','revised','in_review')`;
const EDIT_SESSION_TIMEOUT_HOURS     = 12;
const EDIT_SESSION_TIMEOUT_SQL       = `${EDIT_SESSION_TIMEOUT_HOURS} hours`;

module.exports = function createPassportService({
  pool,
  // pure helpers (from passport-helpers.js)
  getTable,
  normalizePassportRow,
  normalizeReleaseStatus,
  isPublicHistoryStatus,
  isEditablePassportStatus,
  normalizeProductIdValue,
  generateProductIdValue,
  IN_REVISION_STATUS,
  SYSTEM_PASSPORT_FIELDS,
  getWritablePassportColumns,
  getStoredPassportValues,
  toStoredPassportValue,
  coerceBulkFieldValue,
  comparableHistoryFieldValue,
  formatHistoryFieldValue,
  getHistoryFieldDefs,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  productIdentifierService,
  // email service
  createTransporter,
  brandedEmail,
}) {
  // ─── AUDIT / NOTIFICATION ────────────────────────────────────────────────

  function buildAuditEventPayload({
    createdAt = null,
    companyId = null,
    userId = null,
    action,
    tableName = null,
    recordId = null,
    oldData = null,
    newData = null,
    actorIdentifier = null,
    audience = null,
  }) {
    return {
      createdAt,
      companyId,
      userId,
      action,
      tableName,
      recordId,
      oldData,
      newData,
      actorIdentifier,
      audience,
    };
  }

  function computeHashChainValue(previousHash, payload) {
    return nodeCrypto
      .createHash("sha256")
      .update(`${previousHash || ""}:${canonicalizeJson(payload)}`)
      .digest("hex");
  }

  function buildHashPayloadVersion({ hashVersion = 1, createdAt = null, companyId, userId, action, tableName, recordId, oldData, newData, actorIdentifier, audience }) {
    if (Number(hashVersion) >= 2) {
      return buildAuditEventPayload({
        createdAt,
        companyId,
        userId,
        action,
        tableName,
        recordId,
        oldData,
        newData,
        actorIdentifier,
        audience,
      });
    }
    return buildAuditEventPayload({
      companyId,
      userId,
      action,
      tableName,
      recordId,
      oldData,
      newData,
      actorIdentifier,
      audience,
    });
  }

  async function logAudit(companyId, userId, action, tableName, passportDppId, oldData, newData, options = {}) {
    try {
      const createdAt = options.createdAt || new Date().toISOString();
      const hashVersion = 2;
      const previousHashRes = await pool.query(
        `SELECT event_hash
         FROM audit_logs
         WHERE (
           ($1::int IS NULL AND company_id IS NULL)
           OR company_id = $1
         )
         ORDER BY id DESC
         LIMIT 1`,
        [companyId || null]
      ).catch(() => ({ rows: [] }));
      const previousEventHash = previousHashRes.rows[0]?.event_hash || null;
      const actorIdentifier =
          options.actorIdentifier
          || options.globallyUniqueOperatorId
          || options.globallyUniqueOperatorIdentifier
          || options.operatorIdentifier
          || options.economicOperatorId
          || options.economicOperatorIdentifier
          || (userId ? `user:${userId}` : null);
      const payload = buildHashPayloadVersion({
        hashVersion,
        createdAt,
        companyId: companyId || null,
        userId: userId || null,
        action,
        tableName: tableName || null,
        recordId: passportDppId || null,
        oldData: oldData || null,
        newData: newData || null,
        actorIdentifier,
        audience: options.audience || null,
      });
      const eventHash = computeHashChainValue(previousEventHash, payload);

      await pool.query(
        `INSERT INTO audit_logs (
           company_id,user_id,action,table_name,record_id,old_values,new_values,
           actor_identifier,audience,previous_event_hash,event_hash,created_at,hash_version
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          companyId || null,
          userId || null,
          action,
          tableName,
          passportDppId || null,
          oldData ? JSON.stringify(oldData) : null,
          newData ? JSON.stringify(newData) : null,
          actorIdentifier,
          options.audience || null,
          previousEventHash,
          eventHash,
          createdAt,
          hashVersion,
        ]
      );
    } catch (e) { logger.error("Audit log error (non-fatal):", e.message); }
  }

  async function verifyAuditLogChain(companyId = null) {
    const result = await pool.query(
      `SELECT id, company_id, user_id, action, table_name, record_id, old_values, new_values,
              actor_identifier, audience, previous_event_hash, event_hash, created_at, hash_version
       FROM audit_logs
       WHERE (
         ($1::int IS NULL AND company_id IS NULL)
         OR company_id = $1
       )
       ORDER BY id ASC`,
      [companyId || null]
    );

    let previousHash = null;
    const failures = [];

    for (const row of result.rows) {
      const hashVersion = Number.parseInt(row.hash_version, 10) || 1;
      const payload = buildHashPayloadVersion({
        hashVersion,
        createdAt: row.created_at || null,
        companyId: row.company_id || null,
        userId: row.user_id || null,
        action: row.action,
        tableName: row.table_name || null,
        recordId: row.record_id || null,
        oldData: row.old_values || null,
        newData: row.new_values || null,
        actorIdentifier: row.actor_identifier || null,
        audience: row.audience || null,
      });
      const expectedHash = computeHashChainValue(previousHash, payload);

      if (row.previous_event_hash !== previousHash || row.event_hash !== expectedHash) {
        failures.push({
          id: row.id,
          hashVersion,
          expectedPreviousEventHash: previousHash,
          storedPreviousEventHash: row.previous_event_hash,
          expectedEventHash: expectedHash,
          storedEventHash: row.event_hash,
        });
      }

      previousHash = row.event_hash || expectedHash;
    }

    return {
      verified: failures.length === 0,
      checkedEntries: result.rows.length,
      failures,
      latestEventHash: previousHash,
    };
  }

  async function buildAuditLogRootSummary(companyId = null) {
    const integrity = await verifyAuditLogChain(companyId);
    const aggregate = await pool.query(
      `SELECT COUNT(*)::int AS log_count,
              MIN(id) AS first_log_id,
              MAX(id) AS latest_log_id,
              MAX(created_at) AS latest_created_at
       FROM audit_logs
       WHERE (
         ($1::int IS NULL AND company_id IS NULL)
         OR company_id = $1
       )`,
      [companyId || null]
    );

    const row = aggregate.rows[0] || {};
    return {
      companyId: companyId || null,
      verified: integrity.verified,
      failures: integrity.failures,
      checkedEntries: integrity.checkedEntries,
      logCount: Number.parseInt(row.log_count, 10) || 0,
      firstLogId: row.first_log_id ? Number.parseInt(row.first_log_id, 10) : null,
      latestLogId: row.latest_log_id ? Number.parseInt(row.latest_log_id, 10) : null,
      latestCreatedAt: row.latest_created_at || null,
      latestEventHash: integrity.latestEventHash || null,
    };
  }

  async function listAuditLogAnchors(companyId = null) {
    const result = await pool.query(
      `SELECT id, company_id, log_count, first_log_id, latest_log_id, root_event_hash,
              previous_anchor_hash, anchor_hash, anchor_type, anchor_reference,
              notes, metadata_json, anchored_by, anchored_at, created_at
       FROM audit_log_anchors
       WHERE (
         ($1::int IS NULL AND company_id IS NULL)
         OR company_id = $1
       )
       ORDER BY anchored_at DESC, id DESC`,
      [companyId || null]
    ).catch(() => ({ rows: [] }));
    return result.rows;
  }

  async function anchorAuditLogRoot({
    companyId = null,
    anchoredBy = null,
    anchorType = "internal_record",
    anchorReference = null,
    notes = null,
    metadata = {},
  } = {}) {
    const summary = await buildAuditLogRootSummary(companyId);
    const previousAnchorRes = await pool.query(
      `SELECT anchor_hash
       FROM audit_log_anchors
       WHERE (
         ($1::int IS NULL AND company_id IS NULL)
         OR company_id = $1
       )
       ORDER BY id DESC
       LIMIT 1`,
      [companyId || null]
    ).catch(() => ({ rows: [] }));

    const previousAnchorHash = previousAnchorRes.rows[0]?.anchor_hash || null;
    const anchorPayload = {
      companyId: companyId || null,
      logCount: summary.logCount,
      firstLogId: summary.firstLogId,
      latestLogId: summary.latestLogId,
      rootEventHash: summary.latestEventHash || null,
      anchorType: anchorType || "internal_record",
      anchorReference: anchorReference || null,
      notes: notes || null,
      metadata: metadata && typeof metadata === "object" ? metadata : {},
      anchoredBy: anchoredBy || null,
      verified: summary.verified,
    };
    const anchorHash = computeHashChainValue(previousAnchorHash, anchorPayload);

    const result = await pool.query(
      `INSERT INTO audit_log_anchors (
         company_id, log_count, first_log_id, latest_log_id, root_event_hash,
         previous_anchor_hash, anchor_hash, anchor_type, anchor_reference,
         notes, metadata_json, anchored_by, anchored_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,NOW())
       RETURNING *`,
      [
        companyId || null,
        summary.logCount,
        summary.firstLogId,
        summary.latestLogId,
        summary.latestEventHash || null,
        previousAnchorHash,
        anchorHash,
        anchorType || "internal_record",
        anchorReference || null,
        notes || null,
        JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}),
        anchoredBy || null,
      ]
    );

    return {
      anchor: result.rows[0] || null,
      summary,
    };
  }

  async function createNotification(userId, type, title, message, passportDppId, actionUrl) {
    if (!userId) return;
    try {
      await pool.query(
        `INSERT INTO notifications (user_id,type,title,message,passport_dpp_id,action_url)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, type, title, message || null, passportDppId || null, actionUrl || null]
      );
    } catch (e) { logger.error("Notification error (non-fatal):", e.message); }
  }

  // ─── PASSPORT TYPE SCHEMA ────────────────────────────────────────────────

  async function getPassportTypeSchema(typeName) {
    const normalizedInput = String(typeName || "").trim();
    if (!normalizedInput) return null;
    const typeRes = await pool.query(
      `SELECT type_name, display_name, fields_json
       FROM passport_types
       WHERE type_name = $1 OR LOWER(display_name) = LOWER($1)
       LIMIT 1`,
      [normalizedInput]
    );
    if (!typeRes.rows.length) return null;
    const sections = typeRes.rows[0]?.fields_json?.sections || [];
    const schemaFields = sections.flatMap(section => section.fields || []);
    return {
      typeName: typeRes.rows[0].type_name,
      displayName: typeRes.rows[0].display_name,
      schemaFields,
      allowedKeys: new Set(schemaFields.map(field => field.key).filter(Boolean)),
    };
  }

  // ─── PASSPORT QUERIES ────────────────────────────────────────────────────

  async function findExistingPassportByProductId({
    tableName,
    companyId,
    productId,
    excludeDppId = null,
    excludeGuid = null,
    excludeLineageId = null,
  }) {
    if (!productId) return null;
    const params = [companyId, productId];
    let exclusionSql = "";
    const resolvedExcludeDppId = excludeDppId || excludeGuid || null;
    if (resolvedExcludeDppId) {
      params.push(resolvedExcludeDppId);
      exclusionSql += ` AND dpp_id <> $${params.length}`;
    }
    if (excludeLineageId) {
      params.push(excludeLineageId);
      exclusionSql += ` AND lineage_id <> $${params.length}`;
    }
    const existing = await pool.query(
      `SELECT id, dpp_id AS "dppId", lineage_id, product_id, release_status, version_number
       FROM ${tableName}
       WHERE company_id = $1
         AND product_id = $2
         AND deleted_at IS NULL${exclusionSql}
       ORDER BY version_number DESC, updated_at DESC, id DESC
       LIMIT 1`,
      params
    );
    return existing.rows[0] || null;
  }

  async function getPassportLineageContext({ dppId = null, passportType, companyId = null }) {
    const tableName = getTable(passportType);
    const liveParams = [dppId];
    let liveCompanyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      liveParams.push(companyId);
      liveCompanyFilter = ` AND company_id = $${liveParams.length}`;
    }
    const liveRes = await pool.query(
      `SELECT dpp_id AS "dppId", lineage_id, product_id
       FROM ${tableName}
       WHERE dpp_id = $1${liveCompanyFilter}
       ORDER BY version_number DESC
       LIMIT 1`,
      liveParams
    );
    if (liveRes.rows.length) return liveRes.rows[0];

    const archiveParams = [dppId, passportType];
    let archiveCompanyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      archiveParams.push(companyId);
      archiveCompanyFilter = ` AND company_id = $${archiveParams.length}`;
    }
    const archiveRes = await pool.query(
      `SELECT dpp_id AS "dppId", lineage_id, product_id
       FROM passport_archives
       WHERE dpp_id = $1
         AND passport_type = $2${archiveCompanyFilter}
       ORDER BY version_number DESC
       LIMIT 1`,
      archiveParams
    );
    return archiveRes.rows[0] || null;
  }

  function buildArchiveSnapshotRow(passport) {
    if (!passport || typeof passport !== "object") return null;
    const rowData = { ...passport };
    delete rowData.id;
    return rowData;
  }

  async function archivePassportSnapshot({
    passport,
    passportType,
    archivedBy = null,
    actorIdentifier = null,
    snapshotReason = "state_snapshot",
    client = pool,
  }) {
    const rowData = buildArchiveSnapshotRow(passport);
    if (!rowData || !passportType) return null;

    const dppId = rowData.dpp_id || rowData.dppId || null;
    const lineageId = rowData.lineage_id || dppId || null;
    if (!dppId || !lineageId) return null;

    await client.query(
      `INSERT INTO passport_archives
         (dpp_id, lineage_id, company_id, passport_type, version_number, model_name,
          product_id, product_identifier_did, release_status, row_data, archived_by,
          actor_identifier, snapshot_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        dppId,
        lineageId,
        rowData.company_id || null,
        passportType,
        Number.isFinite(Number(rowData.version_number)) ? Number(rowData.version_number) : 1,
        rowData.model_name || null,
        rowData.product_id || null,
        rowData.product_identifier_did || null,
        rowData.release_status || null,
        JSON.stringify(rowData),
        archivedBy || null,
        actorIdentifier || null,
        snapshotReason || "state_snapshot",
      ]
    );

    return rowData;
  }

  async function archivePassportSnapshots({
    passports,
    passportType,
    archivedBy = null,
    actorIdentifier = null,
    snapshotReason = "state_snapshot",
    client = pool,
  }) {
    if (!Array.isArray(passports) || !passports.length || !passportType) return 0;
    let count = 0;
    for (const passport of passports) {
      await archivePassportSnapshot({
        passport,
        passportType,
        archivedBy,
        actorIdentifier,
        snapshotReason,
        client,
      });
      count += 1;
    }
    return count;
  }

  async function getPassportVersionsByLineage({ lineageId, passportType, companyId = null }) {
    const tableName = getTable(passportType);
    const liveParams = [lineageId];
    let liveCompanyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      liveParams.push(companyId);
      liveCompanyFilter = ` AND company_id = $${liveParams.length}`;
    }
    const liveRes = await pool.query(
      `SELECT *
       FROM ${tableName}
       WHERE lineage_id = $1
         AND deleted_at IS NULL${liveCompanyFilter}
       ORDER BY version_number DESC, updated_at DESC`,
      liveParams
    );

    const archiveParams = [lineageId, passportType];
    let archiveCompanyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      archiveParams.push(companyId);
      archiveCompanyFilter = ` AND company_id = $${archiveParams.length}`;
    }
    const archiveRes = await pool.query(
      `SELECT dpp_id AS "dppId", lineage_id, company_id, passport_type, version_number, model_name, product_id, product_identifier_did, release_status, archived_at, row_data
       FROM passport_archives
       WHERE lineage_id = $1
         AND passport_type = $2${archiveCompanyFilter}
       ORDER BY version_number DESC, archived_at DESC`,
      archiveParams
    );

    const liveVersions = liveRes.rows.map(normalizePassportRow);
    const seenDppIds = new Set(liveVersions.map((row) => row.dppId));
    const archiveVersions = archiveRes.rows
      .map((row) => {
        const rowData = typeof row.row_data === "string" ? JSON.parse(row.row_data) : row.row_data;
        return {
          ...rowData,
          dpp_id: row.dppId || rowData?.dpp_id || rowData?.dppId,
          lineage_id: row.lineage_id || rowData?.lineage_id,
          company_id: row.company_id || rowData?.company_id,
          passport_type: row.passport_type || rowData?.passport_type,
          version_number: row.version_number ?? rowData?.version_number,
          model_name: row.model_name || rowData?.model_name,
          product_id: row.product_id || rowData?.product_id,
          product_identifier_did: row.product_identifier_did || rowData?.product_identifier_did,
          release_status: row.release_status || rowData?.release_status,
          archived: true,
          archived_at: row.archived_at,
        };
      })
      .map(normalizePassportRow)
      .filter((row) => row?.dppId && !seenDppIds.has(row.dppId));

    return [...liveVersions, ...archiveVersions]
      .sort((a, b) => Number(b.version_number || 0) - Number(a.version_number || 0));
  }

  async function getCompanyNameMap(companyIds) {
    const uniqueCompanyIds = [...new Set((companyIds || []).filter(Boolean).map((value) => String(value)))];
    if (!uniqueCompanyIds.length) return new Map();
    const result = await pool.query(
      "SELECT id, company_name FROM companies WHERE id = ANY($1::int[])",
      [uniqueCompanyIds.map((value) => Number.parseInt(value, 10)).filter(Number.isFinite)]
    );
    return new Map(result.rows.map((row) => [String(row.id), row.company_name || ""]));
  }

  async function stripRestrictedFieldsForPublicView(passport, passportType) {
    if (!passport || !passportType) return passport;
    const sanitized = { ...passport };
    try {
      const typeRes = await pool.query(
        "SELECT fields_json FROM passport_types WHERE type_name = $1",
        [passportType]
      );
      if (!typeRes.rows.length) return sanitized;
      const sections = typeRes.rows[0].fields_json?.sections || [];
      for (const section of sections) {
        for (const field of (section.fields || [])) {
          const access = field.access || ["public"];
          if (!access.includes("public")) delete sanitized[field.key];
        }
      }
    } catch {
      return sanitized;
    }
    return sanitized;
  }

  async function fetchCompanyPassportRecord({ companyId, dppId = null, passportType = null, versionNumber = null }) {
    let resolvedPassportType = passportType || null;
    const hasExplicitVersion = Number.isFinite(Number(versionNumber));
    const parsedVersionNumber = hasExplicitVersion ? Number(versionNumber) : null;

    if (!resolvedPassportType) {
      const regRes = await pool.query(
        "SELECT passport_type FROM passport_registry WHERE dpp_id = $1 AND company_id = $2",
        [dppId, companyId]
      );
      if (regRes.rows.length) resolvedPassportType = regRes.rows[0].passport_type;
    }

    if (!resolvedPassportType) {
      const archiveTypeRes = await pool.query(
        `SELECT passport_type
         FROM passport_archives
         WHERE dpp_id = $1 AND company_id = $2
         ORDER BY version_number DESC, archived_at DESC
         LIMIT 1`,
        [dppId, companyId]
      );
      if (archiveTypeRes.rows.length) resolvedPassportType = archiveTypeRes.rows[0].passport_type;
    }

    if (!resolvedPassportType) return null;

    const tableName = getTable(resolvedPassportType);
    const liveParams = [dppId, companyId];
    let liveVersionSql = "";
    if (parsedVersionNumber !== null) {
      liveParams.push(parsedVersionNumber);
      liveVersionSql = ` AND p.version_number = $${liveParams.length}`;
    }
    const liveRes = await pool.query(
      `SELECT p.*, u.email AS created_by_email, u.first_name, u.last_name
       FROM ${tableName} p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.dpp_id = $1 AND p.company_id = $2 AND p.deleted_at IS NULL${liveVersionSql}
       ORDER BY p.version_number DESC, p.updated_at DESC
       LIMIT 1`,
      liveParams
    );
    if (liveRes.rows.length) {
      return {
        passport: { ...normalizePassportRow(liveRes.rows[0]), passport_type: resolvedPassportType },
        archived: false,
      };
    }

    const archiveParams = [dppId, companyId, resolvedPassportType];
    let archiveVersionSql = "";
    if (parsedVersionNumber !== null) {
      archiveParams.push(parsedVersionNumber);
      archiveVersionSql = ` AND pa.version_number = $${archiveParams.length}`;
    }
    const archiveRes = await pool.query(
      `SELECT pa.row_data
       FROM passport_archives pa
       WHERE pa.dpp_id = $1 AND pa.company_id = $2 AND pa.passport_type = $3${archiveVersionSql}
       ORDER BY pa.version_number DESC, pa.archived_at DESC
       LIMIT 1`,
      archiveParams
    );
    if (!archiveRes.rows.length) return null;

    const rowData = typeof archiveRes.rows[0].row_data === "string"
      ? JSON.parse(archiveRes.rows[0].row_data)
      : archiveRes.rows[0].row_data;

    return {
      passport: { ...normalizePassportRow(rowData), passport_type: resolvedPassportType, archived: true },
      archived: true,
    };
  }

  async function resolveReleasedPassportByDppId(dppId) {
    const normalizedDppId = String(dppId || "").trim();
    if (!normalizedDppId) return { passport: null, archived: false };

    const reg = await pool.query(
      "SELECT passport_type FROM passport_registry WHERE dpp_id = $1 LIMIT 1",
      [normalizedDppId]
    );
    if (!reg.rows.length) return { passport: null, archived: false };

    const passportType = reg.rows[0].passport_type;
    const tableName = getTable(passportType);

    const liveRes = await pool.query(
      `SELECT * FROM ${tableName}
       WHERE dpp_id = $1
         AND release_status = 'released'
         AND deleted_at IS NULL
       ORDER BY version_number DESC
       LIMIT 1`,
      [normalizedDppId]
    );
    if (liveRes.rows.length) {
      return {
        passport: { ...normalizePassportRow(liveRes.rows[0]), passport_type: passportType },
        archived: false,
      };
    }

    const archiveRes = await pool.query(
      `SELECT row_data FROM passport_archives
       WHERE dpp_id = $1
         AND passport_type = $2
         AND release_status = 'released'
       ORDER BY version_number DESC
       LIMIT 1`,
      [normalizedDppId, passportType]
    );
    if (!archiveRes.rows.length) return { passport: null, archived: false };

    const rowData = typeof archiveRes.rows[0].row_data === "string"
      ? JSON.parse(archiveRes.rows[0].row_data)
      : archiveRes.rows[0].row_data;
    return {
      passport: { ...normalizePassportRow(rowData), passport_type: passportType, archived: true },
      archived: true,
    };
  }

  async function resolveReleasedPassportByProductId(productId, {
    versionNumber = null,
    companyId = null,
    passportType = "battery",
    granularity = "item",
    strictProductId = false,
  } = {}) {
    const normalizedProductId = normalizeProductIdValue(productId);
    if (!normalizedProductId) return { passport: null, archived: false };
    const isDidIdentifier = productIdentifierService?.isDidIdentifier?.(normalizedProductId);
    const candidates = strictProductId
      ? [normalizedProductId]
      : isDidIdentifier
      ? [normalizedProductId]
      : productIdentifierService?.buildLookupCandidates?.({
          companyId,
          passportType,
          productId: normalizedProductId,
          granularity,
        }) || [normalizedProductId];
    const matchSql = strictProductId
      ? "product_id = ANY($1::text[])"
      : "(product_id = ANY($1::text[]) OR product_identifier_did = ANY($1::text[]))";

    const ptRows = await pool.query("SELECT type_name FROM passport_types ORDER BY type_name");
    const matches = [];

    for (const { type_name } of ptRows.rows) {
      const tableName = getTable(type_name);
      const liveParams = candidates;
      let versionSql = "";
      let companySql = "";
      let companyParamOffset = liveParams.length;
      if (companyId !== null && companyId !== undefined) {
        liveParams.push(companyId);
        companyParamOffset = liveParams.length;
        companySql = ` AND company_id = $${companyParamOffset}`;
      }
      if (versionNumber !== null && versionNumber !== undefined) {
        liveParams.push(versionNumber);
        versionSql = ` AND version_number = $${liveParams.length}`;
      }

      const liveRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE ${matchSql}
           AND ${
             versionNumber !== null && versionNumber !== undefined
               ? "release_status IN ('released', 'obsolete')"
               : "release_status = 'released'"
           }${companySql}
           AND deleted_at IS NULL${versionSql}
         ORDER BY version_number DESC, updated_at DESC
         LIMIT 1`,
        liveParams
      );
      if (liveRes.rows.length) {
        matches.push({
          passport: { ...normalizePassportRow(liveRes.rows[0]), passport_type: type_name },
          archived: false,
        });
        continue;
      }

      const archiveParams = [candidates, type_name];
      let archiveCompanySql = "";
      if (companyId !== null && companyId !== undefined) {
        archiveParams.push(companyId);
        archiveCompanySql = ` AND company_id = $${archiveParams.length}`;
      }
      if (versionNumber !== null && versionNumber !== undefined) {
        archiveParams.push(versionNumber);
      }
      const archiveRes = await pool.query(
        `SELECT product_identifier_did, row_data
         FROM passport_archives
         WHERE ${matchSql}
           AND passport_type = $2${archiveCompanySql}
           AND ${
             versionNumber !== null && versionNumber !== undefined
               ? "release_status IN ('released', 'obsolete')"
               : "release_status = 'released'"
           }${versionNumber !== null && versionNumber !== undefined ? ` AND version_number = $${archiveParams.length}` : ""}
         ORDER BY version_number DESC, archived_at DESC
         LIMIT 1`,
        archiveParams
      );
      if (archiveRes.rows.length) {
        const rowData = typeof archiveRes.rows[0].row_data === "string"
          ? JSON.parse(archiveRes.rows[0].row_data)
          : archiveRes.rows[0].row_data;
        matches.push({
          passport: {
            ...normalizePassportRow(rowData),
            product_identifier_did: archiveRes.rows[0].product_identifier_did || rowData?.product_identifier_did,
            passport_type: type_name,
            archived: true,
          },
          archived: true,
        });
      }
    }

    if (!matches.length) return { passport: null, archived: false };
    if (matches.length > 1) {
      const error = new Error(`Multiple released passports share product identifier "${normalizedProductId}".`);
      error.code = "AMBIGUOUS_PRODUCT_ID";
      throw error;
    }
    return matches[0];
  }

  async function resolvePublicPassportByDppId(dppId, { versionNumber = null } = {}) {
    const normalizedDppId = String(dppId || "").trim();
    if (!normalizedDppId) return { passport: null, archived: false };

    const reg = await pool.query(
      "SELECT passport_type FROM passport_registry WHERE dpp_id = $1 LIMIT 1",
      [normalizedDppId]
    );
    if (!reg.rows.length) return { passport: null, archived: false };

    const passportType = reg.rows[0].passport_type;
    const tableName = getTable(passportType);

    if (versionNumber !== null && versionNumber !== undefined) {
      const lineageContext = await getPassportLineageContext({ dppId: normalizedDppId, passportType });
      if (!lineageContext?.lineage_id) return { passport: null, archived: false };

      const liveRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE lineage_id = $1
           AND version_number = $2
           AND release_status IN ('released', 'obsolete')
           AND deleted_at IS NULL
         ORDER BY updated_at DESC
         LIMIT 1`,
        [lineageContext.lineage_id, versionNumber]
      );
      if (liveRes.rows.length) {
        const passport = { ...normalizePassportRow(liveRes.rows[0]), passport_type: passportType };
        const visibilityRes = await pool.query(
          `SELECT is_public
           FROM passport_history_visibility
           WHERE passport_dpp_id = $1 AND version_number = $2
           LIMIT 1`,
          [passport.dppId, versionNumber]
        );
        const isVisible = visibilityRes.rows.length
          ? !!visibilityRes.rows[0].is_public
          : isPublicHistoryStatus(passport.release_status);
        return isVisible ? { passport, archived: false } : { passport: null, archived: false };
      }

      const archiveRes = await pool.query(
        `SELECT row_data
         FROM passport_archives
         WHERE lineage_id = $1
           AND passport_type = $2
           AND version_number = $3
           AND release_status IN ('released', 'obsolete')
         ORDER BY archived_at DESC
         LIMIT 1`,
        [lineageContext.lineage_id, passportType, versionNumber]
      );
      if (!archiveRes.rows.length) return { passport: null, archived: false };

      const rowData = typeof archiveRes.rows[0].row_data === "string"
        ? JSON.parse(archiveRes.rows[0].row_data)
        : archiveRes.rows[0].row_data;
      const passport = { ...normalizePassportRow(rowData), passport_type: passportType, archived: true };
      const visibilityRes = await pool.query(
        `SELECT is_public
         FROM passport_history_visibility
         WHERE passport_dpp_id = $1 AND version_number = $2
         LIMIT 1`,
        [passport.dppId, versionNumber]
      );
      const isVisible = visibilityRes.rows.length
        ? !!visibilityRes.rows[0].is_public
        : isPublicHistoryStatus(passport.release_status);
      return isVisible ? { passport, archived: true } : { passport: null, archived: false };
    }

    return resolveReleasedPassportByDppId(normalizedDppId);
  }

  async function resolveCompanyPreviewPassportByProductId(companyId, productId) {
    const normalizedProductId = normalizeProductIdValue(productId);
    if (!companyId || !normalizedProductId) return { passport: null, archived: false };
    const candidates = productIdentifierService?.buildLookupCandidates?.({
      companyId,
      productId: normalizedProductId,
    }) || [normalizedProductId];

    const ptRows = await pool.query("SELECT type_name FROM passport_types ORDER BY type_name");
    const liveMatches = [];

    for (const { type_name } of ptRows.rows) {
      const tableName = getTable(type_name);
      const liveRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE company_id = $1
           AND (product_id = ANY($2::text[]) OR product_identifier_did = ANY($2::text[]))
           AND deleted_at IS NULL
         ORDER BY version_number DESC, updated_at DESC, id DESC
         LIMIT 1`,
        [companyId, candidates]
      );
      if (liveRes.rows.length) {
        liveMatches.push({
          passport: { ...normalizePassportRow(liveRes.rows[0]), passport_type: type_name },
          archived: false,
        });
      }
    }

    if (liveMatches.length > 1) {
      const error = new Error(`Multiple passports in company "${companyId}" share product identifier "${normalizedProductId}".`);
      error.code = "AMBIGUOUS_PRODUCT_ID";
      throw error;
    }
    if (liveMatches.length === 1) return liveMatches[0];

    const archiveMatches = [];
    for (const { type_name } of ptRows.rows) {
      const archiveRes = await pool.query(
        `SELECT row_data
         FROM passport_archives
         WHERE company_id = $1
           AND passport_type = $2
           AND (product_id = ANY($3::text[]) OR product_identifier_did = ANY($3::text[]))
         ORDER BY version_number DESC, archived_at DESC
         LIMIT 1`,
        [companyId, type_name, candidates]
      );
      if (archiveRes.rows.length) {
        const rowData = typeof archiveRes.rows[0].row_data === "string"
          ? JSON.parse(archiveRes.rows[0].row_data)
          : archiveRes.rows[0].row_data;
        archiveMatches.push({
          passport: { ...normalizePassportRow(rowData), passport_type: type_name, archived: true },
          archived: true,
        });
      }
    }

    if (archiveMatches.length > 1) {
      const error = new Error(`Multiple archived passports in company "${companyId}" share product identifier "${normalizedProductId}".`);
      error.code = "AMBIGUOUS_PRODUCT_ID";
      throw error;
    }
    return archiveMatches[0] || { passport: null, archived: false };
  }

  async function resolveCompanyPreviewPassport({ companyId, passportKey }) {
    const normalizedPassportKey = normalizeProductIdValue(passportKey);
    if (normalizedPassportKey) {
      const productMatch = await resolveCompanyPreviewPassportByProductId(companyId, normalizedPassportKey);
      if (productMatch?.passport) return productMatch;
    }
    return fetchCompanyPassportRecord({ companyId, dppId: passportKey });
  }

  async function updatePassportRowById({ tableName, rowId, userId, data, excluded = SYSTEM_PASSPORT_FIELDS, includeUpdatedRow = false }) {
    const updateCols = getWritablePassportColumns(data, excluded);
    if (!updateCols.length) return [];

    const vals = getStoredPassportValues(updateCols, data);
    const sets = updateCols.map((col, i) => `${col} = $${i + 1}`).join(", ");
    const result = await pool.query(
      `UPDATE ${tableName}
       SET ${sets}, updated_by = $${vals.length + 1}, updated_at = NOW()
       WHERE id = $${vals.length + 2}
       ${includeUpdatedRow ? "RETURNING *" : ""}`,
      [...vals, userId, rowId]
    );
    if (includeUpdatedRow) {
      return {
        updateCols,
        updatedRow: result.rows[0] || null,
      };
    }
    return updateCols;
  }

  const buildPassportVersionHistory = async ({
    dppId = null,
    passportType,
    companyId = null,
    publicOnly = false,
  }) => {
    const typeRes = await pool.query(
      "SELECT display_name, fields_json FROM passport_types WHERE type_name = $1",
      [passportType]
    );
    const typeRow = typeRes.rows[0] || null;
    const fieldDefs = getHistoryFieldDefs(typeRow);

    const lineageContext = await getPassportLineageContext({ dppId, passportType, companyId });
    if (!lineageContext?.lineage_id) {
      return {
        passportType,
        displayName: typeRow?.display_name || passportType,
        history: [],
      };
    }

    const versions = await getPassportVersionsByLineage({
      lineageId: lineageContext.lineage_id,
      passportType,
      companyId,
    });

    const creatorIds = [...new Set(versions.map((row) => row.created_by).filter(Boolean))];
    const creatorMap = new Map();
    const companyNameMap = await getCompanyNameMap(versions.map((row) => row.company_id).filter(Boolean));
    if (creatorIds.length) {
      const userRes = await pool.query(
        "SELECT id, first_name, last_name, email FROM users WHERE id = ANY($1::int[])",
        [creatorIds]
      );
      userRes.rows.forEach((row) => {
        creatorMap.set(
          row.id,
          `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email || `User #${row.id}`
        );
      });
    }

    const versionDppIds = versions.map((row) => row.dppId).filter(Boolean);
    const visibilityRes = versionDppIds.length
      ? await pool.query(
          `SELECT passport_dpp_id, version_number, is_public
           FROM passport_history_visibility
           WHERE passport_dpp_id = ANY($1::text[])`,
          [versionDppIds]
        )
      : { rows: [] };
    const visibilityMap = new Map(
      visibilityRes.rows.map((row) => [`${row.passport_dpp_id}:${Number(row.version_number)}`, !!row.is_public])
    );

    const ascending = [...versions].sort((a, b) => Number(a.version_number) - Number(b.version_number));
    const previousByVersion = new Map();
    ascending.forEach((version, index) => {
      previousByVersion.set(Number(version.version_number), index > 0 ? ascending[index - 1] : null);
    });

    const latestVersionNumber = versions[0]?.version_number ?? null;
    const latestReleasedVersionNumber = versions
      .filter((row) => isPublicHistoryStatus(row.release_status))
      .reduce((max, row) => Math.max(max, Number(row.version_number || 0)), 0);

    const history = versions
      .map((version) => {
        const versionNumber = Number(version.version_number);
        const previous = previousByVersion.get(versionNumber) || null;
        const normalizedStatus = normalizeReleaseStatus(version.release_status);
        const defaultPublic = isPublicHistoryStatus(normalizedStatus);
        const visibilityKey = `${version.dppId}:${versionNumber}`;
        const isPublic = visibilityMap.has(visibilityKey)
          ? visibilityMap.get(visibilityKey)
          : defaultPublic;

        if (publicOnly && (!defaultPublic || !isPublic)) return null;

        const changedFields = previous
          ? fieldDefs.flatMap((field) => {
              const beforeComparable = comparableHistoryFieldValue(field, previous[field.key]);
              const afterComparable = comparableHistoryFieldValue(field, version[field.key]);
              if (beforeComparable === afterComparable) return [];
              return [{
                key: field.key,
                label: field.label || field.key,
                before: formatHistoryFieldValue(field, previous[field.key]),
                after: formatHistoryFieldValue(field, version[field.key]),
              }];
            })
          : [];

        return {
          version_number: versionNumber,
          release_status: normalizedStatus,
          created_at: version.created_at,
          updated_at: version.updated_at,
          created_by_name: creatorMap.get(version.created_by) || null,
          is_public: isPublic,
          dppId: version.dppId,
          public_path: buildCurrentPublicPassportPath({
            companyName: companyNameMap.get(String(version.company_id)) || "",
            manufacturerName: version.manufacturer,
            manufacturedBy: version.manufactured_by,
            modelName: version.model_name,
            productId: version.product_id,
          }),
          inactive_path: buildInactivePublicPassportPath({
            companyName: companyNameMap.get(String(version.company_id)) || "",
            manufacturerName: version.manufacturer,
            manufacturedBy: version.manufactured_by,
            modelName: version.model_name,
            productId: version.product_id,
            versionNumber,
          }),
          changed_fields: changedFields,
          change_count: changedFields.length,
          summary: previous
            ? (changedFields.length
                ? `${changedFields.length} field${changedFields.length === 1 ? "" : "s"} changed from v${previous.version_number}.`
                : `No field changes detected from v${previous.version_number}.`)
            : "Initial version.",
          is_current: publicOnly
            ? versionNumber === Number(latestReleasedVersionNumber || latestVersionNumber)
            : versionNumber === Number(latestVersionNumber),
        };
      })
      .filter(Boolean);

    return {
      passportType,
      displayName: typeRow?.display_name || passportType,
      history,
    };
  };

  // ─── EDIT SESSION HELPERS ────────────────────────────────────────────────

  async function clearExpiredEditSessions() {
    await pool.query(
      `DELETE FROM passport_edit_sessions
       WHERE last_activity_at < NOW() - INTERVAL '${EDIT_SESSION_TIMEOUT_SQL}'`
    );
  }

  async function listActiveEditSessions(passportDppId, currentUserId = null) {
    await clearExpiredEditSessions();
    const params = [passportDppId];
    let currentUserFilter = "";
    if (currentUserId) {
      params.push(currentUserId);
      currentUserFilter = ` AND pes.user_id <> $${params.length}`;
    }
    const res = await pool.query(
      `SELECT
         pes.user_id,
         pes.last_activity_at,
         u.first_name,
         u.last_name,
         u.email
       FROM passport_edit_sessions pes
       JOIN users u ON u.id = pes.user_id
       WHERE pes.passport_dpp_id = $1
         AND pes.last_activity_at >= NOW() - INTERVAL '${EDIT_SESSION_TIMEOUT_SQL}'
         ${currentUserFilter}
       ORDER BY pes.last_activity_at DESC`,
      params
    );
    return res.rows.map((row) => ({
      user_id: row.user_id,
      name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email,
      email: row.email,
      last_activity_at: row.last_activity_at,
    }));
  }

  // ─── MARK OBSOLETE ────────────────────────────────────────────────────────

  async function markOlderVersionsObsolete(tableName, dppId, newVersionNumber, passportType = null) {
    try {
      const lineageRes = await pool.query(
        `SELECT lineage_id FROM ${tableName} WHERE dpp_id = $1 LIMIT 1`, [dppId]
      );
      if (!lineageRes.rows.length) return;
      const lineageId = lineageRes.rows[0].lineage_id;
      const resolvedPassportType = passportType || tableName.replace(/^passports_/, "");
      const affectedRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE lineage_id = $1
           AND version_number < $2
           AND release_status = 'released'
           AND deleted_at IS NULL`,
        [lineageId, newVersionNumber]
      );
      if (affectedRes.rows.length) {
        await archivePassportSnapshots({
          passports: affectedRes.rows,
          passportType: resolvedPassportType,
          snapshotReason: "before_mark_obsolete",
        });
      }
      await pool.query(
        `UPDATE ${tableName}
         SET release_status = 'obsolete', updated_at = NOW()
         WHERE lineage_id = $1
           AND version_number < $2
           AND release_status = 'released'
           AND deleted_at IS NULL
         RETURNING *`,
        [lineageId, newVersionNumber]
      );
      const updatedRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE lineage_id = $1
           AND version_number < $2
           AND release_status = 'obsolete'
           AND deleted_at IS NULL`,
        [lineageId, newVersionNumber]
      );
      if (updatedRes.rows.length) {
        await archivePassportSnapshots({
          passports: updatedRes.rows,
          passportType: resolvedPassportType,
          snapshotReason: "after_mark_obsolete",
        });
      }
    } catch (e) {
      logger.error("Mark obsolete error (non-fatal):", e.message);
    }
  }

  // ─── ANALYTICS HELPERS ────────────────────────────────────────────────────

  async function getLatestCompanyPassports({ companyId, passportType }) {
    const tableName = getTable(passportType);
    const result = await pool.query(
      `SELECT DISTINCT ON (lineage_id) *
       FROM ${tableName}
       WHERE company_id = $1
         AND deleted_at IS NULL
       ORDER BY lineage_id, version_number DESC, updated_at DESC`,
      [companyId]
    );
    return result.rows.map((row) => {
      const normalized = normalizePassportRow(row);
      return {
        ...normalized,
        is_editable: isEditablePassportStatus(normalized.release_status),
      };
    });
  }

  async function createPassportTable(typeName) {
    const tableName = getTable(typeName);
    const typeRes = await pool.query(
      "SELECT fields_json FROM passport_types WHERE type_name = $1",
      [typeName]
    );
    if (!typeRes.rows.length)
      throw new Error(`Passport type '${typeName}' not found in passport_types`);

    const sections = typeRes.rows[0].fields_json?.sections || [];
    const ddlCols = [];
    for (const section of sections) {
      for (const field of (section.fields || [])) {
        const colType = field.type === "boolean" ? "BOOLEAN DEFAULT false" : "TEXT";
        ddlCols.push(`    ${field.key} ${colType}`);
      }
    }
    const customColsDDL = ddlCols.length ? ",\n" + ddlCols.join(",\n") : "";

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id             SERIAL       PRIMARY KEY,
        dpp_id         TEXT         NOT NULL,
        lineage_id     TEXT         NOT NULL,
        company_id     INTEGER      NOT NULL,
        model_name     VARCHAR(255),
        product_id     VARCHAR(255) NOT NULL,
        product_identifier_did TEXT,
        compliance_profile_key VARCHAR(120) NOT NULL DEFAULT 'generic_dpp_v1',
        content_specification_ids TEXT,
        carrier_policy_key VARCHAR(120),
        carrier_authenticity JSONB,
        economic_operator_id TEXT,
        facility_id TEXT,
        granularity    VARCHAR(20)  NOT NULL DEFAULT 'model',
        release_status VARCHAR(50)  NOT NULL DEFAULT 'draft',
        version_number INTEGER      NOT NULL DEFAULT 1,
        qr_code        TEXT,
        created_by     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
        updated_by     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        deleted_at     TIMESTAMPTZ${customColsDDL}
      )
    `);

    await pool.query(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${tableName}_guid_key`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${tableName}_dpp_id_version_unique ON ${tableName}(dpp_id, version_number) WHERE deleted_at IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_company ON ${tableName}(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_dpp_id ON ${tableName}(dpp_id) WHERE deleted_at IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_lineage ON ${tableName}(lineage_id) WHERE deleted_at IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_status ON ${tableName}(release_status) WHERE deleted_at IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_product_identifier_did ON ${tableName}(company_id, product_identifier_did) WHERE deleted_at IS NULL`);
  }

  async function queryTableStats(typeName, companyId = null) {
    const tableName = getTable(typeName);
    const params = [];
    let companyFilter = "";
    if (companyId !== null && companyId !== undefined) {
      companyFilter = " AND company_id = $1";
      params.push(companyId);
    }
    const r = await pool.query(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(CASE WHEN release_status = 'draft'     THEN 1 END) AS draft,
        COUNT(CASE WHEN release_status = 'released'  THEN 1 END) AS released,
        COUNT(CASE WHEN release_status IN ${IN_REVISION_STATUSES_SQL} THEN 1 END) AS revised,
        COUNT(CASE WHEN release_status = 'in_review' THEN 1 END) AS in_review,
        COUNT(CASE WHEN release_status = 'obsolete'  THEN 1 END) AS obsolete
      FROM ${tableName}
      WHERE deleted_at IS NULL${companyFilter}
    `, params);
    const row = r.rows[0];
    return {
      total:     parseInt(row.total),
      draft:     parseInt(row.draft),
      released:  parseInt(row.released),
      revised:   parseInt(row.revised),
      in_review: parseInt(row.in_review),
      obsolete:  parseInt(row.obsolete),
    };
  }

  // ─── WORKFLOW SUBMISSION ──────────────────────────────────────────────────

  async function submitPassportToWorkflow({
    companyId,
    dppId = null,
    passportType,
    userId,
    reviewerId,
    approverId,
  }) {
    const tableName = getTable(passportType);
    const resolvedReviewerId = reviewerId ? parseInt(reviewerId, 10) : null;
    const resolvedApproverId = approverId ? parseInt(approverId, 10) : null;

    if (!resolvedReviewerId && !resolvedApproverId) {
      throw new Error("At least one reviewer or approver is required to submit a revision to workflow.");
    }

    const pRes = await pool.query(
      `SELECT * FROM ${tableName}
       WHERE dpp_id = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
       ORDER BY version_number DESC LIMIT 1`,
      [dppId]
    );
    if (!pRes.rows.length) throw new Error("Editable passport not found");
    const passport = normalizePassportRow(pRes.rows[0]);

    await archivePassportSnapshot({
      passport: pRes.rows[0],
      passportType,
      archivedBy: userId,
      snapshotReason: "before_submit_review",
    });

    await pool.query(
      `UPDATE ${tableName} SET release_status = 'in_review', updated_at = NOW()
       WHERE dpp_id = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}`,
      [dppId]
    );

    const updatedRes = await pool.query(
      `SELECT *
       FROM ${tableName}
       WHERE dpp_id = $1
       ORDER BY version_number DESC LIMIT 1`,
      [dppId]
    );
    if (updatedRes.rows.length) {
      await archivePassportSnapshot({
        passport: updatedRes.rows[0],
        passportType,
        archivedBy: userId,
        snapshotReason: "after_submit_review",
      });
    }

    const wfRes = await pool.query(
      `INSERT INTO passport_workflow
         (passport_dpp_id, passport_type, company_id, submitted_by, reviewer_id, approver_id,
          review_status, approval_status, overall_status, previous_release_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'in_progress',$9)
       RETURNING id`,
      [
        dppId,
        passportType,
        companyId,
        userId,
        resolvedReviewerId,
        resolvedApproverId,
        resolvedReviewerId ? "pending" : "skipped",
        resolvedApproverId ? "pending" : "skipped",
        normalizeReleaseStatus(passport.release_status) || IN_REVISION_STATUS,
      ]
    );

    const appUrl = process.env.APP_URL || "http://localhost:3000";

    if (resolvedReviewerId) {
      await createNotification(
        resolvedReviewerId,
        "workflow_review",
        `Review requested: ${passport.product_id}`,
        `v${passport.version_number} needs your review`,
        dppId,
        "/dashboard/workflow"
      );
      try {
        const reviewer = await pool.query("SELECT email, first_name FROM users WHERE id = $1", [resolvedReviewerId]);
        const submitter = await pool.query("SELECT first_name, last_name, email FROM users WHERE id = $1", [userId]);
        if (reviewer.rows.length) {
          const reviewerName = reviewer.rows[0].first_name || "Reviewer";
          const submitterName =
            `${submitter.rows[0]?.first_name || ""} ${submitter.rows[0]?.last_name || ""}`.trim() ||
            submitter.rows[0]?.email ||
            "A colleague";
          await createTransporter().sendMail({
            from: process.env.EMAIL_FROM || "noreply@example.com",
            to: reviewer.rows[0].email,
            subject: `[DPP] Review requested — ${passport.product_id}`,
            html: brandedEmail({
              preheader: `${submitterName} submitted a passport for your review`,
              bodyHtml: `
                <p>Hi <strong>${reviewerName}</strong>,</p>
                <p><strong>${submitterName}</strong> has submitted a passport for your review.</p>
                <div class="info-box">
                  <div class="info-row"><span class="info-label">Serial Number</span><span class="info-value">${passport.product_id}</span></div>
                  ${passport.model_name ? `<div class="info-row"><span class="info-label">Model</span><span class="info-value">${passport.model_name}</span></div>` : ""}
                  <div class="info-row"><span class="info-label">Version</span><span class="info-value">v${passport.version_number}</span></div>
                  <div class="info-row"><span class="info-label">Type</span><span class="info-value">${passportType}</span></div>
                </div>
                <div class="cta-wrap"><a href="${appUrl}/dashboard/workflow" class="cta-btn">🔍 Review Now →</a></div>`,
            }),
          });
        }
      } catch (e) {
        logger.error("Review email error:", e.message);
      }
    }

    if (resolvedApproverId && !resolvedReviewerId) {
      await createNotification(
        resolvedApproverId,
        "workflow_approval",
        `Approval requested: ${passport.product_id}`,
        `v${passport.version_number} needs your approval`,
        dppId,
        "/dashboard/workflow"
      );
    }

    await logAudit(companyId, userId, "SUBMIT_REVIEW", tableName, dppId, null, {
      reviewerId: resolvedReviewerId,
      approverId: resolvedApproverId,
      status: "in_review",
    });

    return { workflowId: wfRes.rows[0].id };
  }

  return {
    // SQL constants (useful for route files to construct queries)
    IN_REVISION_STATUSES_SQL,
    EDITABLE_RELEASE_STATUSES_SQL,
    REVISION_BLOCKING_STATUSES_SQL,
    EDIT_SESSION_TIMEOUT_HOURS,
    EDIT_SESSION_TIMEOUT_SQL,
    // functions
    logAudit,
    verifyAuditLogChain,
    buildAuditLogRootSummary,
    listAuditLogAnchors,
    anchorAuditLogRoot,
    createNotification,
    getPassportTypeSchema,
    findExistingPassportByProductId,
    getPassportLineageContext,
    getPassportVersionsByLineage,
    getCompanyNameMap,
    stripRestrictedFieldsForPublicView,
    fetchCompanyPassportRecord,
    resolveReleasedPassportByDppId,
    resolveReleasedPassportByProductId,
    resolvePublicPassportByDppId,
    resolveCompanyPreviewPassportByProductId,
    resolveCompanyPreviewPassport,
    archivePassportSnapshot,
    archivePassportSnapshots,
    updatePassportRowById,
    buildPassportVersionHistory,
    clearExpiredEditSessions,
    listActiveEditSessions,
    markOlderVersionsObsolete,
    getLatestCompanyPassports,
    createPassportTable,
    queryTableStats,
    submitPassportToWorkflow,
  };
};
