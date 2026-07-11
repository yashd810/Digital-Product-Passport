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
        `SELECT "eventHash"
         FROM "auditLogs"
         WHERE (
           ($1::int IS NULL AND "companyId" IS NULL)
           OR "companyId" = $1
         )
         ORDER BY id DESC
         LIMIT 1`,
        [companyId || null]
      ).catch(() => ({ rows: [] }));
      const previousEventHash = previousHashRes.rows[0]?.eventHash || null;
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
        `INSERT INTO "auditLogs" (
           "companyId","userId",action,"tableName","recordId","oldValues","newValues",
           "actorIdentifier",audience,"previousEventHash","eventHash","createdAt","hashVersion"
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
      `SELECT id, "companyId", "userId", action, "tableName", "recordId", "oldValues", "newValues",
              "actorIdentifier", audience, "previousEventHash", "eventHash", "createdAt", "hashVersion"
       FROM "auditLogs"
       WHERE (
         ($1::int IS NULL AND "companyId" IS NULL)
         OR "companyId" = $1
       )
       ORDER BY id ASC`,
      [companyId || null]
    );

    let previousHash = null;
    const failures = [];

    for (const row of result.rows) {
      const hashVersion = Number.parseInt(row.hashVersion, 10) || 1;
      const payload = buildHashPayloadVersion({
        hashVersion,
        createdAt: row.createdAt || null,
        companyId: row.companyId || null,
        userId: row.userId || null,
        action: row.action,
        tableName: row.tableName || null,
        recordId: row.recordId || null,
        oldData: row.oldValues || null,
        newData: row.newValues || null,
        actorIdentifier: row.actorIdentifier || null,
        audience: row.audience || null,
      });
      const expectedHash = computeHashChainValue(previousHash, payload);

      if (row.previousEventHash !== previousHash || row.eventHash !== expectedHash) {
        failures.push({
          id: row.id,
          hashVersion,
          expectedPreviousEventHash: previousHash,
          storedPreviousEventHash: row.previousEventHash,
          expectedEventHash: expectedHash,
          storedEventHash: row.eventHash,
        });
      }

      previousHash = row.eventHash || expectedHash;
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
      `SELECT COUNT(*)::int AS "logCount",
              MIN(id) AS "firstLogId",
              MAX(id) AS "latestLogId",
              MAX("createdAt") AS "latestCreatedAt"
       FROM "auditLogs"
       WHERE (
         ($1::int IS NULL AND "companyId" IS NULL)
         OR "companyId" = $1
       )`,
      [companyId || null]
    );

    const row = aggregate.rows[0] || {};
    return {
      companyId: companyId || null,
      verified: integrity.verified,
      failures: integrity.failures,
      checkedEntries: integrity.checkedEntries,
      logCount: Number.parseInt(row.logCount, 10) || 0,
      firstLogId: row.firstLogId ? Number.parseInt(row.firstLogId, 10) : null,
      latestLogId: row.latestLogId ? Number.parseInt(row.latestLogId, 10) : null,
      latestCreatedAt: row.latestCreatedAt || null,
      latestEventHash: integrity.latestEventHash || null,
    };
  }

  async function listAuditLogAnchors(companyId = null) {
    const result = await pool.query(
      `SELECT id, "companyId", "logCount", "firstLogId", "latestLogId", "rootEventHash",
              "previousAnchorHash", "anchorHash", "anchorType", "anchorReference",
              notes, "metadataJson", "anchoredBy", "anchoredAt", "createdAt"
       FROM "auditLogAnchors"
       WHERE (
         ($1::int IS NULL AND "companyId" IS NULL)
         OR "companyId" = $1
       )
       ORDER BY "anchoredAt" DESC, id DESC`,
      [companyId || null]
    ).catch(() => ({ rows: [] }));
    return result.rows;
  }

  async function anchorAuditLogRoot({
    companyId = null,
    anchoredBy = null,
    anchorType = "internalRecord",
    anchorReference = null,
    notes = null,
    metadata = {},
  } = {}) {
    const summary = await buildAuditLogRootSummary(companyId);
    const previousAnchorRes = await pool.query(
      `SELECT "anchorHash"
       FROM "auditLogAnchors"
       WHERE (
         ($1::int IS NULL AND "companyId" IS NULL)
         OR "companyId" = $1
       )
       ORDER BY id DESC
       LIMIT 1`,
      [companyId || null]
    ).catch(() => ({ rows: [] }));

    const previousAnchorHash = previousAnchorRes.rows[0]?.anchorHash || null;
    const anchorPayload = {
      companyId: companyId || null,
      logCount: summary.logCount,
      firstLogId: summary.firstLogId,
      latestLogId: summary.latestLogId,
      rootEventHash: summary.latestEventHash || null,
      anchorType: anchorType || "internalRecord",
      anchorReference: anchorReference || null,
      notes: notes || null,
      metadata: metadata && typeof metadata === "object" ? metadata : {},
      anchoredBy: anchoredBy || null,
      verified: summary.verified,
    };
    const anchorHash = computeHashChainValue(previousAnchorHash, anchorPayload);

    const result = await pool.query(
      `INSERT INTO "auditLogAnchors" (
         "companyId", "logCount", "firstLogId", "latestLogId", "rootEventHash",
         "previousAnchorHash", "anchorHash", "anchorType", "anchorReference",
         notes, "metadataJson", "anchoredBy", "anchoredAt"
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
        anchorType || "internalRecord",
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
