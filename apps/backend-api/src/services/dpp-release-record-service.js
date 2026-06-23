"use strict";

async function storePassportSignature(pool, {
  passportDppId,
  versionNumber,
  sigData
}) {
  const insertResult = await pool.query(
    `INSERT INTO "passportSignatures" (
      "passportDppId",
      "versionNumber",
      "dataHash",
      signature,
      algorithm,
      "signingKeyId",
      "releasedAt",
      "vcJson"
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT ("passportDppId", "versionNumber") DO NOTHING
    RETURNING id`,
    [
      passportDppId,
      versionNumber,
      sigData.dataHash,
      sigData.signature,
      sigData.signatureAlgorithm,
      sigData.keyId,
      sigData.releasedAt,
      sigData.vcJson || null
    ]
  );
  if (insertResult.rows[0]?.id) return insertResult.rows[0].id;

  const existingResult = await pool.query(
    `SELECT id
     FROM "passportSignatures"
     WHERE "passportDppId" = $1
       AND "versionNumber" = $2`,
    [passportDppId, versionNumber]
  );
  return existingResult.rows[0]?.id || null;
}

async function resolveReleaseCompanyName(pool, companyId) {
  const result = await pool.query(
    `SELECT COALESCE(NULLIF("legalName", ''), "companyName") AS companyname
     FROM companies
     WHERE id = $1`,
    [companyId]
  );
  return result.rows[0]?.companyname || "";
}

async function storeDppReleaseRecord(pool, {
  dppId,
  companyId,
  releasedByUserId,
  releasedByEmail,
  releaseVersion,
  dppHash,
  signatureId = null,
  releaseNote = null,
  releasedAt = null
}) {
  const companyname = await resolveReleaseCompanyName(pool, companyId);
  const result = await pool.query(
    `INSERT INTO "dppReleaseRecords" (
      "dppId",
      companyname,
      "releasedByUserId",
      "releasedByEmail",
      "releaseVersion",
      "dppHash",
      "signatureId",
      "releaseNote",
      "releasedAt"
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz, NOW()))
    ON CONFLICT ("dppId", "releaseVersion")
    DO UPDATE SET
      companyname = EXCLUDED.companyname,
      "releasedByUserId" = EXCLUDED."releasedByUserId",
      "releasedByEmail" = EXCLUDED."releasedByEmail",
      "dppHash" = EXCLUDED."dppHash",
      "signatureId" = EXCLUDED."signatureId",
      "releaseNote" = EXCLUDED."releaseNote",
      "releasedAt" = EXCLUDED."releasedAt"
    RETURNING *`,
    [
      dppId,
      companyname,
      releasedByUserId,
      releasedByEmail || `user:${releasedByUserId}`,
      releaseVersion,
      dppHash,
      signatureId,
      releaseNote,
      releasedAt
    ]
  );
  return result.rows[0] || null;
}

async function recordSignedDppRelease(pool, {
  passportDppId,
  companyId,
  releasedByUserId,
  releasedByEmail,
  versionNumber,
  sigData,
  releaseNote = null
}) {
  const signatureId = await storePassportSignature(pool, {
    passportDppId,
    versionNumber,
    sigData
  });

  return storeDppReleaseRecord(pool, {
    dppId: passportDppId,
    companyId,
    releasedByUserId,
    releasedByEmail,
    releaseVersion: versionNumber,
    dppHash: sigData.dataHash,
    signatureId,
    releaseNote,
    releasedAt: sigData.releasedAt
  });
}

module.exports = {
  recordSignedDppRelease,
  storeDppReleaseRecord,
  storePassportSignature,
};
