"use strict";

const path = require("path");
require("dotenv").config({
  path: process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "../../../docker/.env"),
});

const crypto = require("crypto");
const { Pool } = require("pg");
const createDidService = require("../src/services/did-service");
const createProductIdentifierService = require("../src/services/product-identifier-service");
const createCanonicalPassportSerializer = require("../src/services/canonicalPassportSerializer");
const createSigningService = require("../src/services/signing-service");
const canonicalizeJson = require("../src/shared/passports/json-canonicalization");
const logger = require("../src/services/logger");
const {
  getTable,
  normalizePassportRow,
} = require("../src/shared/passports/passport-helpers");

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
});

async function loadTypeDef(passportType) {
  const result = await pool.query(
    `SELECT type_name AS "typeName",
            display_name AS "displayName",
            product_category AS "productCategory",
            semantic_model_key AS "semanticModelKey",
            fields_json AS "fieldsJson"
     FROM passport_types
     WHERE type_name = $1
     LIMIT 1`,
    [passportType]
  );
  return result.rows[0] || null;
}

async function loadPassportForSignature(signatureRow, passportType) {
  const tableName = getTable(passportType);
  const liveRes = await pool.query(
    `SELECT *
     FROM ${tableName}
     WHERE "dppId" = $1
       AND "versionNumber" = $2
       AND "deletedAt" IS NULL
     LIMIT 1`,
    [signatureRow.passportDppId, signatureRow.versionNumber]
  );
  if (liveRes.rows.length) {
    return normalizePassportRow({
      ...liveRes.rows[0],
      passportType,
    });
  }

  const archiveRes = await pool.query(
    `SELECT "rowData"
     FROM passport_archives
     WHERE "dppId" = $1
       AND "versionNumber" = $2
     ORDER BY "archivedAt" DESC
     LIMIT 1`,
    [signatureRow.passportDppId, signatureRow.versionNumber]
  );
  if (!archiveRes.rows.length) return null;
  const rowData = typeof archiveRes.rows[0].rowData === "string"
    ? JSON.parse(archiveRes.rows[0].rowData)
    : archiveRes.rows[0].rowData;
  return normalizePassportRow({
    ...(rowData || {}),
    passportType,
  });
}

function buildSignedVc({ vc, signingService, releasedAt }) {
  const signingKey = signingService.getSigningKey();
  if (!signingKey) throw new Error("Signing key is not loaded");
  const trustMetadata = signingService.getSigningTrustMetadata();
  const jws = signingService.createJws(vc, signingKey);
  const vcWithProof = {
    ...vc,
    proof: {
      type: "JsonWebSignature2020",
      created: releasedAt,
      verificationMethod: `${signingService.issuerDid()}#key-1`,
      proofPurpose: "assertionMethod",
      jws,
      issuerCertificateId: trustMetadata.issuerCertificateId,
      globallyUniqueOperatorId: trustMetadata.globallyUniqueOperatorId,
      trustFramework: trustMetadata.trustFramework,
      certificateProfile: trustMetadata.certificateProfile,
    },
  };

  return {
    dataHash: crypto.createHash("sha256").update(canonicalizeJson(vc)).digest("hex"),
    signature: jws.split(".")[2],
    keyId: signingKey.keyId,
    signatureAlgorithm: signingKey.algorithmVersion,
    releasedAt,
    vcJson: JSON.stringify(vcWithProof),
  };
}

async function main() {
  const didService = createDidService({
    didDomain: process.env.DID_WEB_DOMAIN || "www.claros-dpp.online",
    publicOrigin: process.env.PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000",
    apiOrigin: process.env.SERVER_URL || "http://localhost:3001",
  });
  const productIdentifierService = createProductIdentifierService({ didService, pool });
  const canonicalPassportSerializer = createCanonicalPassportSerializer({ didService, productIdentifierService });
  const signingService = createSigningService({
    pool,
    crypto,
    canonicalizeJson,
    didService,
    buildCanonicalPassportPayload: canonicalPassportSerializer.buildCanonicalPassportPayload,
  });
  await signingService.loadOrGenerateSigningKey();

  const signatureRows = await pool.query(
    `SELECT "passportDppId", "versionNumber", "dataHash", signature, algorithm, "signingKeyId", "releasedAt", "signedAt", "vcJson"
     FROM passport_signatures
     ORDER BY "passportDppId" ASC, "versionNumber" ASC`
  );

  let checked = 0;
  let updated = 0;
  let skipped = 0;

  for (const signatureRow of signatureRows.rows) {
    checked += 1;
    const registryRes = await pool.query(
      `SELECT "passportType"
       FROM passport_registry
       WHERE "dppId" = $1
       LIMIT 1`,
      [signatureRow.passportDppId]
    );
    const passportType = registryRes.rows[0]?.passportType || null;
    if (!passportType) {
      skipped += 1;
      continue;
    }

    const [typeDef, passport] = await Promise.all([
      loadTypeDef(passportType),
      loadPassportForSignature(signatureRow, passportType),
    ]);
    if (!typeDef || !passport) {
      skipped += 1;
      continue;
    }

    const releasedAt = signatureRow.releasedAt instanceof Date
      ? signatureRow.releasedAt.toISOString()
      : new Date(signatureRow.releasedAt || signatureRow.signedAt || Date.now()).toISOString();
    const vc = await signingService.buildVC(passport, typeDef, releasedAt);
    const repaired = buildSignedVc({ vc, signingService, releasedAt });

    if (
      repaired.dataHash === signatureRow.dataHash &&
      repaired.signature === signatureRow.signature &&
      repaired.vcJson === signatureRow.vcJson &&
      repaired.signatureAlgorithm === signatureRow.algorithm &&
      repaired.keyId === signatureRow.signingKeyId
    ) {
      continue;
    }

    await pool.query(
      `UPDATE passport_signatures
       SET "dataHash" = $3,
           signature = $4,
           algorithm = $5,
           "signingKeyId" = $6,
           "releasedAt" = $7,
           "vcJson" = $8
       WHERE "passportDppId" = $1
         AND "versionNumber" = $2`,
      [
        signatureRow.passportDppId,
        signatureRow.versionNumber,
        repaired.dataHash,
        repaired.signature,
        repaired.signatureAlgorithm,
        repaired.keyId,
        repaired.releasedAt,
        repaired.vcJson,
      ]
    );

    await pool.query(
      `UPDATE dpp_release_records
       SET "dppHash" = $3,
           "releasedAt" = $4
       WHERE "dppId" = $1
         AND "releaseVersion" = $2`,
      [
        signatureRow.passportDppId,
        signatureRow.versionNumber,
        repaired.dataHash,
        repaired.releasedAt,
      ]
    );

    updated += 1;
  }

  console.log(JSON.stringify({ checked, updated, skipped }, null, 2));
}

main()
  .catch((error) => {
    logger.error({ err: error }, "[Repair passport signatures] failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
