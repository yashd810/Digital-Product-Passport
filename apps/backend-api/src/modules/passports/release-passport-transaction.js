"use strict";

const { withTransaction } = require("../../infrastructure/postgres/with-transaction");
const { flattenSchemaFieldsFromSections } = require("../../shared/passports/passport-helpers");

class ReleaseTransitionError extends Error {
  constructor(message, { code = "releaseTransitionFailed", statusCode = 500 } = {}) {
    super(message);
    this.name = "ReleaseTransitionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function getPublicAttachmentFieldKeys(typeDef) {
  return flattenSchemaFieldsFromSections(typeDef?.fieldsJson?.sections || [])
    .filter((field) => (
      field?.key
      && String(field.confidentiality || "").trim().toLowerCase() === "public"
    ))
    .map((field) => field.key);
}

function requireReleaseDependency(value, label) {
  if (typeof value !== "function") {
    throw new ReleaseTransitionError(`${label} is not configured`);
  }
  return value;
}

function requireCompletedOperation(result, label) {
  if (result === null || result === undefined) {
    throw new ReleaseTransitionError(`${label} did not complete`);
  }
  return result;
}

function buildActorIdentifier(userId, actorIdentifier, releasedByEmail) {
  return actorIdentifier || releasedByEmail || (userId ? `user:${userId}` : null);
}

function buildSnapshotSource(source) {
  const normalized = String(source || "release").trim();
  return normalized ? `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1)}` : "Release";
}

/**
 * Atomically transitions one editable passport to released status.
 *
 * A released passport is externally visible and must always have a complete
 * signed release record, audit chain, archive history, obsolete-version state,
 * and attachment visibility state.  Every one of those writes runs on the same
 * transaction client as the status transition.  Callers must perform external
 * side effects such as notifications and backup replication only after this
 * function resolves successfully.
 */
async function releasePassportAtomically({
  pool,
  tableName,
  dppId,
  companyId,
  passportType,
  userId,
  releasedByEmail = null,
  actorIdentifier = null,
  editableReleaseStatusesSql,
  typeDef = null,
  releaseNote = null,
  source = "release",
  snapshotSource = source,
  signPassport,
  recordSignedDppRelease,
  logAudit,
  archivePassportSnapshot,
  markOlderVersionsObsolete,
  afterReleaseInTransaction = null,
}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new ReleaseTransitionError("A transaction-capable database pool is required");
  }
  if (!tableName || !dppId || !companyId || !passportType || !editableReleaseStatusesSql) {
    throw new ReleaseTransitionError("Release transition is missing a required identifier");
  }

  requireReleaseDependency(signPassport, "Passport signing");
  requireReleaseDependency(recordSignedDppRelease, "Release record storage");
  requireReleaseDependency(logAudit, "Audit logging");
  requireReleaseDependency(archivePassportSnapshot, "Passport archive storage");
  requireReleaseDependency(markOlderVersionsObsolete, "Obsolete-version transition");

  const resolvedActorIdentifier = buildActorIdentifier(userId, actorIdentifier, releasedByEmail);
  const normalizedSnapshotSource = buildSnapshotSource(snapshotSource);

  return withTransaction(pool, async (client) => {
    const currentResult = await client.query(
      `SELECT *
       FROM ${tableName}
       WHERE "dppId" = $1
         AND "companyId" = $2
         AND "releaseStatus" IN ${editableReleaseStatusesSql}
         AND "deletedAt" IS NULL
       ORDER BY "versionNumber" DESC
       LIMIT 1
       FOR UPDATE`,
      [dppId, companyId]
    );
    const currentPassport = currentResult.rows[0] || null;
    if (!currentPassport) {
      throw new ReleaseTransitionError("Passport not found or already released", {
        code: "passportNotFoundOrReleased",
        statusCode: 404,
      });
    }

    requireCompletedOperation(
      await archivePassportSnapshot({
        passport: currentPassport,
        passportType,
        archivedBy: userId,
        actorIdentifier: resolvedActorIdentifier,
        snapshotReason: `before${normalizedSnapshotSource}`,
        client,
      }),
      "Pre-release archive"
    );

    const releaseResult = await client.query(
      `UPDATE ${tableName}
       SET "releaseStatus" = 'released', "updatedAt" = NOW()
       WHERE "dppId" = $1
         AND "companyId" = $2
         AND "releaseStatus" IN ${editableReleaseStatusesSql}
         AND "deletedAt" IS NULL
       RETURNING *`,
      [dppId, companyId]
    );
    const released = releaseResult.rows[0] || null;
    if (!released) {
      throw new ReleaseTransitionError("Passport not found or already released", {
        code: "passportNotFoundOrReleased",
        statusCode: 404,
      });
    }

    requireCompletedOperation(
      await archivePassportSnapshot({
        passport: released,
        passportType,
        archivedBy: userId,
        actorIdentifier: resolvedActorIdentifier,
        snapshotReason: `after${normalizedSnapshotSource}`,
        client,
      }),
      "Post-release archive"
    );

    const sigData = await signPassport({ ...released, passportType }, typeDef || null);
    if (!sigData?.signature || !sigData?.dataHash || !sigData?.keyId || !sigData?.signatureAlgorithm) {
      throw new ReleaseTransitionError("Passport signing did not produce a complete signature");
    }

    requireCompletedOperation(
      await recordSignedDppRelease(client, {
        passportDppId: dppId,
        companyId,
        releasedByUserId: userId,
        releasedByEmail,
        versionNumber: released.versionNumber,
        sigData,
        releaseNote,
      }),
      "Signed release record"
    );

    await logAudit(
      companyId,
      userId,
      "signPassport",
      "passportSignatures",
      dppId,
      null,
      {
        versionNumber: released.versionNumber,
        signingKeyId: sigData.keyId,
        signatureAlgorithm: sigData.signatureAlgorithm,
        source,
      },
      {
        client,
        actorIdentifier: resolvedActorIdentifier,
        audience: "economicOperator",
      }
    );

    await markOlderVersionsObsolete(
      tableName,
      dppId,
      released.versionNumber,
      passportType,
      {
        client,
        failOnError: true,
        archivedBy: userId,
        actorIdentifier: resolvedActorIdentifier,
      }
    );

    const publicAttachmentFieldKeys = getPublicAttachmentFieldKeys(typeDef);
    await client.query(
      `UPDATE "passportAttachments"
       SET "isPublic" = ("fieldKey" = ANY($2::text[]))
       WHERE "passportDppId" = $1`,
      [dppId, publicAttachmentFieldKeys]
    );

    await logAudit(
      companyId,
      userId,
      "release",
      tableName,
      dppId,
      { releaseStatus: currentPassport.releaseStatus || "draftOrInRevision" },
      { releaseStatus: "released", source },
      {
        client,
        actorIdentifier: resolvedActorIdentifier,
        audience: "economicOperator",
      }
    );

    if (typeof afterReleaseInTransaction === "function") {
      await afterReleaseInTransaction({ client, currentPassport, released, sigData });
    }

    return { currentPassport, released, sigData };
  });
}

module.exports = {
  ReleaseTransitionError,
  getPublicAttachmentFieldKeys,
  releasePassportAtomically,
};
