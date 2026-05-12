"use strict";

async function storePassportSignature(pool, {
  passportDppId,
  versionNumber,
  sigData
}) {
  const insertResult = await pool.query(
    `INSERT INTO passport_signatures (
      passport_dpp_id,
      version_number,
      data_hash,
      signature,
      algorithm,
      signing_key_id,
      released_at,
      vc_json
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (passport_dpp_id, version_number) DO NOTHING
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
     FROM passport_signatures
     WHERE passport_dpp_id = $1
       AND version_number = $2`,
    [passportDppId, versionNumber]
  );
  return existingResult.rows[0]?.id || null;
}

async function resolveReleaseCompanyName(pool, companyId) {
  const result = await pool.query(
    `SELECT COALESCE(NULLIF(legal_name, ''), company_name) AS companyname
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
    `INSERT INTO dpp_release_records (
      dpp_id,
      companyname,
      released_by_user_id,
      released_by_email,
      release_version,
      dpp_hash,
      signature_id,
      release_note,
      released_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz, NOW()))
    ON CONFLICT (dpp_id, release_version)
    DO UPDATE SET
      companyname = EXCLUDED.companyname,
      released_by_user_id = EXCLUDED.released_by_user_id,
      released_by_email = EXCLUDED.released_by_email,
      dpp_hash = EXCLUDED.dpp_hash,
      signature_id = EXCLUDED.signature_id,
      release_note = EXCLUDED.release_note,
      released_at = EXCLUDED.released_at
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
