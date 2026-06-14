"use strict";

const nodeCrypto = require("crypto");
const canonicalizeJson = require("../../services/json-canonicalization");

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

function buildHashPayloadVersion({
  hashVersion = 1,
  createdAt = null,
  companyId,
  userId,
  action,
  tableName,
  recordId,
  oldData,
  newData,
  actorIdentifier,
  audience,
}) {
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

function createAuditServiceHelpers({ pool, logger }) {
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
    } catch (e) {
      logger.error("Audit log error (non-fatal):", e.message);
    }
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
        `INSERT INTO notifications ("userId",type,title,message,"passportDppId","actionUrl")
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, type, title, message || null, passportDppId || null, actionUrl || null]
      );
    } catch (e) {
      logger.error("Notification error (non-fatal):", e.message);
    }
  }

  return {
    logAudit,
    verifyAuditLogChain,
    buildAuditLogRootSummary,
    listAuditLogAnchors,
    anchorAuditLogRoot,
    createNotification,
  };
}

module.exports = {
  createAuditServiceHelpers,
};
