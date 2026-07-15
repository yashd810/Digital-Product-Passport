"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { createApiKeyHelpers } = require("../src/modules/passports/api-key-helpers");
const { flattenSchemaFieldsFromSections } = require("../src/shared/passports/passport-helpers");
const {
  encodePassportAttachmentAccessToken,
} = require("../src/shared/repository/repository-file-links");

dotenv.config({ path: path.resolve(__dirname, "../../../docker/.env"), quiet: true });

const typeName = "verificationProbe";
const tableName = "\"verificationProbePassports\"";
const companyName = "Codex Verification Company";

function createPool() {
  return new Pool({
    host: process.env.LIVE_VERIFY_DB_HOST || process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
}

async function fetchJson(pathname, options = {}) {
  const baseUrl = process.env.LIVE_VERIFY_API_URL || "http://127.0.0.1:3001";
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return {
    response,
    payload: await response.json().catch(() => null),
  };
}

function containsValue(payload, value) {
  return JSON.stringify(payload).includes(value);
}

function getAllowedMutationOrigin() {
  const firstConfiguredOrigin = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)[0];
  return String(
    process.env.LIVE_VERIFY_ALLOWED_ORIGIN
      || process.env.APP_URL
      || firstConfiguredOrigin
      || "http://127.0.0.1:3000"
  ).replace(/\/+$/, "");
}

async function removeProbeData(pool, companyId = null, typeId = null) {
  await pool.query(`DROP TABLE IF EXISTS ${tableName}`).catch(() => {});

  const companyIds = new Set();
  if (companyId) companyIds.add(Number(companyId));
  const staleCompanies = await pool.query(
    `SELECT id FROM companies
     WHERE "companyName" = $1
        OR "didSlug" = $2
        OR "companyName" LIKE 'Codex Foreign Verification %'
        OR "didSlug" LIKE 'codex-foreign-%'`,
    [companyName, "codex-verification-company"]
  ).catch(() => ({ rows: [] }));
  for (const row of staleCompanies.rows || []) {
    if (row.id) companyIds.add(Number(row.id));
  }

  if (companyIds.size) {
    const ids = [...companyIds].filter(Number.isFinite);
    const passportIds = await pool.query(
      `SELECT "dppId" FROM "passportRegistry" WHERE "companyId" = ANY($1::int[])`,
      [ids]
    ).catch(() => ({ rows: [] }));
    const dppIds = (passportIds.rows || []).map((row) => row.dppId).filter(Boolean);

    if (dppIds.length) {
      await pool.query(
        `DELETE FROM "passportDynamicValues" WHERE "passportDppId" = ANY($1::text[])`,
        [dppIds]
      ).catch(() => {});
      await pool.query(
        `DELETE FROM "passportHistoryVisibility" WHERE "passportDppId" = ANY($1::text[])`,
        [dppIds]
      ).catch(() => {});
    }
    await pool.query("SET session_replication_role = replica");
    try {
      await pool.query("DELETE FROM \"auditLogAnchors\" WHERE \"companyId\" = ANY($1::int[])", [ids]);
      await pool.query("DELETE FROM \"auditLogs\" WHERE \"companyId\" = ANY($1::int[])", [ids]);
    } finally {
      await pool.query("SET session_replication_role = origin");
    }
    await pool.query("DELETE FROM \"apiKeys\" WHERE \"companyId\" = ANY($1::int[])", [ids]).catch(() => {});
    await pool.query("DELETE FROM \"passportAttachments\" WHERE \"companyId\" = ANY($1::int[])", [ids]).catch(() => {});
    await pool.query("DELETE FROM \"passportArchives\" WHERE \"companyId\" = ANY($1::int[])", [ids]).catch(() => {});
    await pool.query("DELETE FROM \"passportRegistry\" WHERE \"companyId\" = ANY($1::int[])", [ids]).catch(() => {});
    await pool.query("DELETE FROM \"companyPassportAccess\" WHERE \"companyId\" = ANY($1::int[])", [ids]).catch(() => {});
    await pool.query("DELETE FROM \"companyDppPolicies\" WHERE \"companyId\" = ANY($1::int[])", [ids]).catch(() => {});
    await pool.query("DELETE FROM users WHERE \"companyId\" = ANY($1::int[])", [ids]).catch(() => {});
    await pool.query("DELETE FROM companies WHERE id = ANY($1::int[])", [ids]).catch(() => {});
  }

  if (typeId) {
    await pool.query("DELETE FROM \"passportTypes\" WHERE id = $1", [typeId]).catch(() => {});
  } else {
    await pool.query("DELETE FROM \"passportTypes\" WHERE \"typeName\" = $1", [typeName]).catch(() => {});
  }
}

async function run() {
  const pool = createPool();
  const dppId = crypto.randomUUID();
  const otherDppId = crypto.randomUUID();
  const draftDppId = crypto.randomUUID();
  const foreignDppId = crypto.randomUUID();
  const publicAttachmentId = crypto.randomBytes(10).toString("base64url").slice(0, 16);
  const restrictedAttachmentId = crypto.randomBytes(10).toString("base64url").slice(0, 16);
  const filesDir = process.env.FILES_DIR || "/tmp";
  const publicAttachmentPath = path.join(filesDir, `${publicAttachmentId}.txt`);
  const restrictedAttachmentPath = path.join(filesDir, `${restrictedAttachmentId}.txt`);
  const rawKey = `dppSg${crypto.randomBytes(24).toString("hex")}`;
  const typeWideRawKey = `dppSg${crypto.randomBytes(24).toString("hex")}`;
  const keyRecord = createApiKeyHelpers({ crypto }).buildApiKeyHashRecord(rawKey);
  const typeWideKeyRecord = createApiKeyHelpers({ crypto }).buildApiKeyHashRecord(typeWideRawKey);
  let companyId = null;
  let foreignCompanyId = null;
  let typeId = null;
  let adminToken = "";

  const rootClassKey = "verificationProbePassport";
  const rootClassIri = "https://example.test/classes/VerificationProbePassport";
  const createProbeField = (key, label, options = {}) => {
    const dataType = options.dataType || (options.type === "file" ? "uri" : "string");
    const scalarRangeIri = {
      string: "http://www.w3.org/2001/XMLSchema#string",
      uri: "http://www.w3.org/2001/XMLSchema#anyURI",
    }[dataType] || "http://www.w3.org/2001/XMLSchema#string";
    const valueDataType = dataType === "uri" ? "URI" : "String";
    const field = {
      key,
      label,
      type: options.type || "text",
      dataType,
      semanticId: `https://example.test/terms/${key}`,
      domainClassKey: rootClassKey,
      domainClassIri: rootClassIri,
      rangeKind: "scalar",
      rangeIri: scalarRangeIri,
      minCount: 0,
      maxCount: 1,
      objectType: "SingleValuedDataElement",
      valueDataType,
    };
    if (options.dynamic) field.dynamic = true;
    if (options.confidentiality) field.confidentiality = options.confidentiality;
    return field;
  };
  const probeFields = [
    createProbeField("publicField", "Public field", { confidentiality: "public" }),
    createProbeField("secretAlpha", "Secret alpha", { confidentiality: "restricted" }),
    createProbeField("secretBeta", "Secret beta", { confidentiality: "restricted" }),
    createProbeField("publicDynamic", "Public dynamic", { dynamic: true, confidentiality: "public" }),
    createProbeField("restrictedDynamicAlpha", "Restricted dynamic alpha", { dynamic: true, confidentiality: "restricted" }),
    createProbeField("restrictedDynamicBeta", "Restricted dynamic beta", { dynamic: true, confidentiality: "restricted" }),
    createProbeField("unclassifiedField", "Unclassified field"),
    createProbeField("unclassifiedDynamic", "Unclassified dynamic", { dynamic: true }),
    createProbeField("publicDocument", "Public document", { type: "file", confidentiality: "public" }),
    createProbeField("restrictedDocument", "Restricted document", { type: "file", confidentiality: "restricted" }),
  ];
  const graphProperties = probeFields.map((field) => ({
    key: field.key,
    label: field.label,
    semanticId: field.semanticId,
    domainClassKey: field.domainClassKey,
    domainClassIri: field.domainClassIri,
    rangeKind: field.rangeKind,
    rangeIri: field.rangeIri,
    dataType: field.dataType,
    minCount: field.minCount,
    maxCount: field.maxCount,
  }));
  const fieldsJson = {
    schemaVersion: 1,
    passportPolicyKey: "verificationProbeDppV1",
    passportPolicy: {
      key: "verificationProbeDppV1",
      contentSpecificationIds: ["verificationProbeDictionaryV1"],
      defaultCarrierPolicyKey: "webPublicEntryV1",
    },
    semanticGraph: {
      schemaVersion: 1,
      rootClassKey,
      classes: [{
        key: rootClassKey,
        label: "Verification Probe Passport",
        semanticId: rootClassIri,
        root: true,
        properties: graphProperties,
      }],
      enums: [],
    },
    sections: [{
      key: "verification",
      label: "Verification",
      fields: probeFields,
    }],
  };

  try {
    await removeProbeData(pool);
    companyId = (await pool.query(
      "INSERT INTO companies (\"companyName\", \"didSlug\") VALUES ($1, $2) RETURNING id",
      [companyName, "codex-verification-company"]
    )).rows[0].id;
    const adminUserId = (await pool.query(
      `INSERT INTO users (email, "passwordHash", "companyId", role)
       VALUES ($1, $2, $3, 'companyAdmin')
       RETURNING id`,
      [`verification-${dppId}@example.test`, "verification-only", companyId]
    )).rows[0].id;
    adminToken = jwt.sign(
      { userId: adminUserId, sessionVersion: 1 },
      process.env.JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: "10m",
        issuer: "dpp-api",
        audience: "dpp-app",
      }
    );
    const integrationBase = "/api/companies/codex-verification-company/integrations/v1/passports";
    const missingOriginCookieMutation = await fetchJson(integrationBase, {
      method: "POST",
      headers: {
        cookie: `${process.env.SESSION_COOKIE_NAME || "dppSession"}=${adminToken}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(missingOriginCookieMutation.response.status, 403);
    const cookieOnlyHeaders = {
      cookie: `${process.env.SESSION_COOKIE_NAME || "dppSession"}=${adminToken}`,
      "content-type": "application/json",
      origin: getAllowedMutationOrigin(),
    };
    const cookieOnlyMutations = [
      [integrationBase, { method: "POST", headers: cookieOnlyHeaders, body: "{}" }],
      [`${integrationBase}/${dppId}`, { method: "PATCH", headers: cookieOnlyHeaders, body: "{}" }],
      [`${integrationBase}/${dppId}`, { method: "DELETE", headers: cookieOnlyHeaders }],
      [`${integrationBase}/${dppId}/archive`, { method: "POST", headers: cookieOnlyHeaders, body: "{}" }],
      [`${integrationBase}/${dppId}/dynamic-values`, { method: "POST", headers: cookieOnlyHeaders, body: "{}" }],
    ];
    for (const [pathname, options] of cookieOnlyMutations) {
      const result = await fetchJson(pathname, options);
      assert.equal(result.response.status, 401);
      assert.equal(result.payload?.error, "Bearer token required");
    }
    const invalidBearerWithCookie = await fetchJson(integrationBase, {
      method: "POST",
      headers: {
        ...cookieOnlyHeaders,
        authorization: "Bearer invalid-token",
      },
      body: "{}",
    });
    assert.equal(invalidBearerWithCookie.response.status, 403);
    typeId = (await pool.query(
      `INSERT INTO "passportTypes" ("typeName", "displayName", "productCategory", "fieldsJson")
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id`,
      [typeName, "Verification probe", "Verification", JSON.stringify(fieldsJson)]
    )).rows[0].id;
    await pool.query(
      "INSERT INTO \"companyPassportAccess\" (\"companyId\", \"passportTypeId\") VALUES ($1, $2)",
      [companyId, typeId]
    );
    await pool.query("INSERT INTO \"companyDppPolicies\" (\"companyId\") VALUES ($1)", [companyId]);
    await pool.query(`
      CREATE TABLE ${tableName} (
        id SERIAL PRIMARY KEY,
        "dppId" TEXT NOT NULL,
        "lineageId" TEXT NOT NULL,
        "companyId" INTEGER NOT NULL,
        "modelName" VARCHAR(255),
        "internalAliasId" VARCHAR(255) NOT NULL,
        "uniqueProductIdentifier" TEXT,
        "passportPolicyKey" VARCHAR(120) NOT NULL,
        "contentSpecificationIds" TEXT,
        "carrierPolicyKey" VARCHAR(120),
        "carrierAuthenticity" JSONB,
        "economicOperatorId" TEXT,
        "economicOperatorIdentifierScheme" VARCHAR(80),
        "facilityId" TEXT,
        granularity VARCHAR(20) NOT NULL DEFAULT 'model',
        "releaseStatus" VARCHAR(50) NOT NULL DEFAULT 'draft',
        "versionNumber" INTEGER NOT NULL DEFAULT 1,
        "qrCode" TEXT,
        "createdBy" INTEGER,
        "updatedBy" INTEGER,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deletedAt" TIMESTAMPTZ,
        "publicField" TEXT,
        "secretAlpha" TEXT,
        "secretBeta" TEXT,
        "unmappedSecret" TEXT DEFAULT 'unmapped-row-secret',
        "publicDynamic" TEXT,
        "restrictedDynamicAlpha" TEXT,
        "restrictedDynamicBeta" TEXT,
        "unclassifiedField" TEXT DEFAULT 'unclassified-row-secret',
        "unclassifiedDynamic" TEXT,
        "publicDocument" TEXT,
        "restrictedDocument" TEXT
      )
    `);
    foreignCompanyId = (await pool.query(
      `INSERT INTO companies ("companyName", "didSlug")
       VALUES ($1, $2)
       RETURNING id`,
      [`Codex Foreign Verification ${foreignDppId}`, `codex-foreign-${foreignDppId}`]
    )).rows[0].id;
    await pool.query(
      `INSERT INTO "passportRegistry" ("dppId", "lineageId", "companyId", "passportType")
       VALUES ($1, $1, $2, $3)`,
      [foreignDppId, foreignCompanyId, typeName]
    );
    await pool.query(
      `INSERT INTO ${tableName}
        ("dppId", "lineageId", "companyId", "modelName", "internalAliasId",
         "passportPolicyKey", granularity, "releaseStatus", "versionNumber")
       VALUES ($1, $1, $2, 'Foreign upload target', $3, 'default', 'item', 'draft', 1)`,
      [foreignDppId, foreignCompanyId, `foreign-${foreignDppId}`]
    );
    const crossCompanyUploadBody = new FormData();
    crossCompanyUploadBody.append(
      "file",
      new Blob(["%PDF-1.4\nverification\n%%EOF"], { type: "application/pdf" }),
      "verification.pdf"
    );
    crossCompanyUploadBody.append("fieldKey", "publicDocument");
    crossCompanyUploadBody.append("passportType", typeName);
    const crossCompanyUpload = await fetchJson(
      `/api/companies/${companyId}/passports/${foreignDppId}/upload`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}` },
        body: crossCompanyUploadBody,
      }
    );
    assert.equal(crossCompanyUpload.response.status, 404);
    assert.equal(
      (await pool.query(
        `SELECT "publicDocument" FROM ${tableName} WHERE "dppId" = $1`,
        [foreignDppId]
      )).rows[0].publicDocument,
      null
    );
    const integrationHeaders = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    };
    const internalAliasCreate = await fetchJson(integrationBase, {
      method: "POST",
      headers: integrationHeaders,
      body: JSON.stringify({
        passportType: typeName,
        internalAliasId: `private-alias-${dppId}`,
      }),
    });
    assert.equal(internalAliasCreate.response.status, 400);

    const integrationCreate = await fetchJson(integrationBase, {
      method: "POST",
      headers: integrationHeaders,
      body: JSON.stringify({
        companyId: companyId + 999,
        passportType: typeName,
        productIdentifier: `integration-product-${dppId}`,
        modelName: "Integration probe",
        publicField: "integration-public",
        secretAlpha: "integration-secret",
      }),
    });
    assert.equal(integrationCreate.response.status, 201);
    const integrationDppId = integrationCreate.payload.dppId;
    assert.ok(integrationDppId);
    const integrationStored = await pool.query(
      `SELECT "companyId", "internalAliasId", "publicField", "secretAlpha"
       FROM ${tableName}
       WHERE "dppId" = $1`,
      [integrationDppId]
    );
    assert.equal(integrationStored.rows[0].companyId, companyId);
    assert.equal(integrationStored.rows[0].internalAliasId, `integration-product-${dppId}`);
    assert.equal(integrationStored.rows[0].publicField, "integration-public");
    assert.equal(integrationStored.rows[0].secretAlpha, "integration-secret");

    const internalAliasPatch = await fetchJson(`${integrationBase}/${integrationDppId}`, {
      method: "PATCH",
      headers: integrationHeaders,
      body: JSON.stringify({ internalAliasId: "must-not-be-external" }),
    });
    assert.equal(internalAliasPatch.response.status, 400);
    const integrationPatch = await fetchJson(`${integrationBase}/${integrationDppId}`, {
      method: "PATCH",
      headers: integrationHeaders,
      body: JSON.stringify({ publicField: "integration-public-updated" }),
    });
    assert.equal(integrationPatch.response.status, 200);
    const integrationDelete = await fetchJson(`${integrationBase}/${integrationDppId}`, {
      method: "DELETE",
      headers: integrationHeaders,
    });
    assert.equal(integrationDelete.response.status, 200);
    assert.equal(
      Number((await pool.query(
        `SELECT COUNT(*)::int AS count FROM "passportRegistry" WHERE "dppId" = $1`,
        [integrationDppId]
      )).rows[0].count),
      0
    );

    const invalidScopeGroup = await fetchJson(`/api/companies/${companyId}/api-keys`, {
      method: "POST",
      headers: integrationHeaders,
      body: JSON.stringify({
        name: "Invalid scope probe",
        passportType: typeName,
        scopeType: "unexpectedScope",
        fieldKeys: ["secretAlpha"],
      }),
    });
    assert.equal(invalidScopeGroup.response.status, 400);
    await pool.query(
      `INSERT INTO "passportRegistry" ("dppId", "lineageId", "companyId", "passportType")
       VALUES ($1, $1, $2, $3), ($4, $4, $2, $3), ($5, $5, $2, $3)`,
      [dppId, companyId, typeName, otherDppId, draftDppId]
    );

    await fs.promises.mkdir(filesDir, { recursive: true });
    await fs.promises.writeFile(publicAttachmentPath, "public-attachment-content");
    await fs.promises.writeFile(restrictedAttachmentPath, "restricted-attachment-content");
    const publicAttachmentUrl = `http://localhost:3001/public-files/${publicAttachmentId}`;
    const restrictedAttachmentUrl = `http://localhost:3001/public-files/${restrictedAttachmentId}`;
    await pool.query(
      `INSERT INTO "passportAttachments"
        ("publicId", "companyId", "passportDppId", "fieldKey", "filePath", "mimeType", "isPublic")
       VALUES
        ($1, $2, $3, 'publicDocument', $4, 'text/plain', true),
        ($5, $2, $3, 'restrictedDocument', $6, 'text/plain', false)`,
      [
        publicAttachmentId,
        companyId,
        dppId,
        publicAttachmentPath,
        restrictedAttachmentId,
        restrictedAttachmentPath,
      ]
    );

    const insertVersion = (id, version, publicValue, alpha, beta, releaseStatus = "released") => pool.query(
      `INSERT INTO ${tableName}
        ("dppId", "lineageId", "companyId", "modelName", "internalAliasId",
         "passportPolicyKey", granularity, "releaseStatus", "versionNumber",
         "publicField", "secretAlpha", "secretBeta", "publicDocument", "restrictedDocument")
       VALUES ($1, $1, $2, $3, $4, 'default', 'item', $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        companyId,
        "Verification model",
        `alias-${id}-${version}`,
        releaseStatus,
        version,
        publicValue,
        alpha,
        beta,
        publicAttachmentUrl,
        restrictedAttachmentUrl,
      ]
    );
    await insertVersion(dppId, 1, "public-v1", "alpha-v1-secret", "beta-v1-secret");
    await insertVersion(dppId, 2, "public-v2", "alpha-v2-secret", "beta-v2-secret");
    await insertVersion(otherDppId, 1, "other-public", "other-alpha-secret", "other-beta-secret");
    await insertVersion(draftDppId, 1, "draft-public", "draft-alpha-secret", "draft-beta-secret", "draft");
    await pool.query(
      `INSERT INTO "apiKeys"
        ("companyId", name, "keyHash", "keyPrefix", "keySalt", "hashAlgorithm",
         "passportType", "scopeType", "fieldKeys", "passportDppIds")
       VALUES ($1, 'Probe group', $2, $3, $4, $5, $6, 'passports',
               ARRAY['secretAlpha','restrictedDynamicAlpha','restrictedDocument']::text[], ARRAY[$7]::text[])`,
      [
        companyId,
        keyRecord.keyHash,
        keyRecord.keyPrefix,
        keyRecord.keySalt,
        keyRecord.hashAlgorithm,
        typeName,
        dppId,
      ]
    );
    await pool.query(
      `INSERT INTO "apiKeys"
        ("companyId", name, "keyHash", "keyPrefix", "keySalt", "hashAlgorithm",
         "passportType", "scopeType", "fieldKeys", "passportDppIds")
       VALUES ($1, 'Type-wide probe group', $2, $3, $4, $5, $6, 'passportType',
               ARRAY['secretAlpha']::text[], ARRAY[]::text[])`,
      [
        companyId,
        typeWideKeyRecord.keyHash,
        typeWideKeyRecord.keyPrefix,
        typeWideKeyRecord.keySalt,
        typeWideKeyRecord.hashAlgorithm,
        typeName,
      ]
    );
    await pool.query(
      `INSERT INTO "passportDynamicValues" ("passportDppId", "fieldKey", value)
         VALUES
           ($1, 'publicDynamic', 'public-dynamic-live'),
           ($1, 'restrictedDynamicAlpha', 'alpha-dynamic-live-secret'),
           ($1, 'restrictedDynamicBeta', 'beta-dynamic-live-secret'),
           ($1, 'unclassifiedDynamic', 'unclassified-dynamic-secret')`,
      [dppId]
    );
    const dynamicWrite = await fetchJson(`${integrationBase}/${dppId}/dynamic-values`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        publicDynamic: "public-dynamic-api",
        restrictedDynamicAlpha: "alpha-dynamic-api-secret",
      }),
    });
    assert.equal(dynamicWrite.response.status, 200);
    assert.deepEqual(dynamicWrite.payload.updated, ["publicDynamic", "restrictedDynamicAlpha"]);
    assert.equal((await fetchJson(`${integrationBase}/${dppId}/dynamic-values`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ secretAlpha: "not-dynamic" }),
    })).response.status, 400);
    assert.equal((await fetchJson(`${integrationBase}/${dppId}/dynamic-values`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ unknownDynamic: "not-in-schema" }),
    })).response.status, 400);

    const publicRead = await fetchJson(`/api/public/passports/${dppId}`);
    assert.equal(publicRead.response.status, 200);
    assert.equal(containsValue(publicRead.payload, "public-v2"), true);
    assert.equal(containsValue(publicRead.payload, "alpha-v2-secret"), false);
    assert.equal(containsValue(publicRead.payload, "beta-v2-secret"), false);
    assert.equal(containsValue(publicRead.payload, "unmapped-row-secret"), false);
    assert.equal(containsValue(publicRead.payload, "unclassified-row-secret"), false);
    assert.match(publicRead.payload.publicDocument, /\/public-files\/access\//);
    assert.equal(publicRead.payload.restrictedDocument, undefined);
    const publicAttachmentDirect = await fetchJson(`/public-files/${publicAttachmentId}`);
    const publicAttachmentRecord = (await pool.query(
      `SELECT "publicId", "isPublic", "filePath"
       FROM "passportAttachments"
       WHERE "publicId" = $1`,
      [publicAttachmentId]
    )).rows[0] || null;
    assert.equal(
      publicAttachmentDirect.response.status,
      200,
      JSON.stringify({
        payload: publicAttachmentDirect.payload,
        record: publicAttachmentRecord,
        fileExists: fs.existsSync(publicAttachmentPath),
        filesDir,
      })
    );
    assert.equal((await fetchJson(`/public-files/${restrictedAttachmentId}`)).response.status, 404);
    const publicAttachmentAccess = new URL(publicRead.payload.publicDocument);
    const publicAttachmentResponse = await fetch(
      `${process.env.LIVE_VERIFY_API_URL || "http://127.0.0.1:3001"}${publicAttachmentAccess.pathname}${publicAttachmentAccess.search}`
    );
    assert.equal(publicAttachmentResponse.status, 200);
    assert.equal(await publicAttachmentResponse.text(), "public-attachment-content");
    const unclassifiedSchemaField = flattenSchemaFieldsFromSections(
      publicRead.payload.viewerSchema.fieldsJson.sections
    ).find((field) => field.key === "unclassifiedField");
    assert.equal(unclassifiedSchemaField.confidentiality, "restricted");

    const invalidRead = await fetchJson(`/api/public/passports/${dppId}`, {
      headers: { "X-API-Key": "invalid-key" },
    });
    assert.equal(invalidRead.response.status, 401);

    const unlockedRead = await fetchJson(`/api/public/passports/${dppId}`, {
      headers: { "X-API-Key": rawKey },
    });
    assert.equal(unlockedRead.response.status, 200);
    assert.equal(containsValue(unlockedRead.payload, "alpha-v2-secret"), true);
    assert.equal(containsValue(unlockedRead.payload, "beta-v2-secret"), false);
    assert.equal(containsValue(unlockedRead.payload, "unmapped-row-secret"), false);
    assert.equal(containsValue(unlockedRead.payload, "unclassified-row-secret"), false);
    assert.match(unlockedRead.payload.restrictedDocument, /\/public-files\/access\//);
    const restrictedAttachmentAccess = new URL(unlockedRead.payload.restrictedDocument);
    const restrictedAttachmentResponse = await fetch(
      `${process.env.LIVE_VERIFY_API_URL || "http://127.0.0.1:3001"}${restrictedAttachmentAccess.pathname}${restrictedAttachmentAccess.search}`
    );
    assert.equal(restrictedAttachmentResponse.status, 200);
    assert.equal(await restrictedAttachmentResponse.text(), "restricted-attachment-content");
    assert.equal(
      (await fetch(`${process.env.LIVE_VERIFY_API_URL || "http://127.0.0.1:3001"}${restrictedAttachmentAccess.pathname}tampered`)).status,
      404
    );
    const mismatchedAttachmentToken = encodePassportAttachmentAccessToken({
      publicId: restrictedAttachmentId,
      passportDppId: otherDppId,
      fieldKey: "restrictedDocument",
    });
    assert.equal((await fetch(
      `${process.env.LIVE_VERIFY_API_URL || "http://127.0.0.1:3001"}/public-files/access/${mismatchedAttachmentToken}`
    )).status, 404);
    const mismatchedFieldToken = encodePassportAttachmentAccessToken({
      publicId: restrictedAttachmentId,
      passportDppId: dppId,
      fieldKey: "secretAlpha",
    });
    assert.equal((await fetch(
      `${process.env.LIVE_VERIFY_API_URL || "http://127.0.0.1:3001"}/public-files/access/${mismatchedFieldToken}`
    )).status, 404);
    assert.deepEqual(
      unlockedRead.payload.restrictedAccess.fieldKeys,
      ["secretAlpha", "restrictedDynamicAlpha", "restrictedDocument"]
    );
    assert.equal(unlockedRead.payload.unlockedPassport, undefined);
    assert.equal(unlockedRead.payload.unlockedFieldKeys, undefined);
    assert.equal(unlockedRead.payload.securityGroup, undefined);

    const publicLinkedData = await fetchJson(`/api/public/passports/${dppId}`, {
      headers: { accept: "application/ld+json" },
    });
    assert.equal(publicLinkedData.response.status, 200);
    assert.equal(containsValue(publicLinkedData.payload, "alpha-v2-secret"), false);
    assert.equal(containsValue(publicLinkedData.payload, "beta-v2-secret"), false);
    assert.equal(containsValue(publicLinkedData.payload, "unmapped-row-secret"), false);
    assert.equal(containsValue(publicLinkedData.payload, `alias-${dppId}`), false);

    const unlockedLinkedData = await fetchJson(`/api/public/passports/${dppId}`, {
      headers: { accept: "application/ld+json", "X-API-Key": rawKey },
    });
    assert.equal(unlockedLinkedData.response.status, 200);
    assert.equal(containsValue(unlockedLinkedData.payload, "alpha-v2-secret"), true);
    assert.equal(containsValue(unlockedLinkedData.payload, "beta-v2-secret"), false);
    assert.equal(containsValue(unlockedLinkedData.payload, "unmapped-row-secret"), false);

    const publicDynamic = await fetchJson(`/api/public/passports/${dppId}/dynamic-values`);
    assert.equal(publicDynamic.response.status, 200);
    assert.equal(containsValue(publicDynamic.payload, "public-dynamic-api"), true);
    assert.equal(containsValue(publicDynamic.payload, "alpha-dynamic-api-secret"), false);
    assert.equal(containsValue(publicDynamic.payload, "beta-dynamic-live-secret"), false);

    const unlockedDynamic = await fetchJson(`/api/public/passports/${dppId}/dynamic-values`, {
      headers: { "X-API-Key": rawKey },
    });
    assert.equal(unlockedDynamic.response.status, 200);
    assert.equal(containsValue(unlockedDynamic.payload, "alpha-dynamic-api-secret"), true);
    assert.equal(containsValue(unlockedDynamic.payload, "beta-dynamic-live-secret"), false);
    assert.equal(
      (await fetchJson(`/api/public/passports/${dppId}/dynamic-values/restrictedDynamicAlpha/history`)).response.status,
      403
    );
    assert.equal(
      (await fetchJson(`/api/public/passports/${dppId}/dynamic-values/restrictedDynamicAlpha/history`, {
        headers: { "X-API-Key": rawKey },
      })).response.status,
      200
    );
    assert.equal(
      (await fetchJson(`/api/public/passports/${dppId}/dynamic-values/restrictedDynamicBeta/history`, {
        headers: { "X-API-Key": rawKey },
      })).response.status,
      403
    );
    const publicDynamicValues = await fetchJson(`/api/public/passports/${dppId}/dynamic-values`);
    assert.equal(publicDynamicValues.response.status, 200);
    assert.equal(
      containsValue(publicDynamicValues.payload, "unclassified-dynamic-secret"),
      false
    );

    const publicHistory = await fetchJson(`/api/public/passports/${dppId}/history`);
    assert.equal(publicHistory.response.status, 200);
    assert.deepEqual(
      publicHistory.payload.history[0].changedFields.map((field) => field.key),
      ["publicField"]
    );

    const unlockedHistory = await fetchJson(`/api/public/passports/${dppId}/history`, {
      headers: { "X-API-Key": rawKey },
    });
    assert.equal(unlockedHistory.response.status, 200);
    assert.deepEqual(
      unlockedHistory.payload.history[0].changedFields.map((field) => field.key),
      ["publicField", "secretAlpha"]
    );

    const wrongPassport = await fetchJson(`/api/public/passports/${otherDppId}`, {
      headers: { "X-API-Key": rawKey },
    });
    assert.equal(wrongPassport.response.status, 403);
    const typeWideRead = await fetchJson(`/api/public/passports/${otherDppId}`, {
      headers: { "X-API-Key": typeWideRawKey },
    });
    assert.equal(typeWideRead.response.status, 200);
    assert.equal(containsValue(typeWideRead.payload, "other-alpha-secret"), true);
    assert.equal(containsValue(typeWideRead.payload, "other-beta-secret"), false);

    const draftSignature = await fetchJson(`/api/public/passports/${draftDppId}/signature`);
    assert.equal(draftSignature.response.status, 404);
    const invalidSignatureVersion = await fetchJson(`/api/public/passports/${dppId}/signature?version=invalid`);
    assert.equal(invalidSignatureVersion.response.status, 400);
    const invalidBundleVersion = await fetchJson(`/api/public/passports/${dppId}/verification-bundle?version=invalid`);
    assert.equal(invalidBundleVersion.response.status, 400);
    assert.equal((await fetchJson(`/api/public/passports/${dppId}/signature-proof`)).response.status, 404);
    assert.equal((await fetchJson(`/api/public/passports/${dppId}/verify`)).response.status, 404);
    for (const removedPath of [
      `/api/passports/by-product/alias-${dppId}-2`,
      `/api/passports/by-product/alias-${dppId}-2/history`,
      `/api/v1/dppsByProductId/alias-${dppId}-2`,
      `/api/v1/dppsByProductIdAndDate/alias-${dppId}-2`,
      `/api/passport-types/${typeName}`,
    ]) {
      assert.equal((await fetchJson(removedPath)).response.status, 404);
    }
    assert.equal((await fetchJson(`/api/passports/${dppId}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: getAllowedMutationOrigin() },
      body: JSON.stringify({ apiKey: rawKey }),
    })).response.status, 404);

    const archiveRow = (await pool.query(
      `SELECT * FROM ${tableName} WHERE "dppId" = $1 AND "versionNumber" = 2`,
      [dppId]
    )).rows[0];
    await pool.query(
      `INSERT INTO "passportArchives"
        ("dppId", "lineageId", "companyId", "passportType", "versionNumber",
         "modelName", "internalAliasId", "releaseStatus", "rowData", "snapshotReason")
       VALUES ($1, $1, $2, $3, 2, $4, $5, 'released', $6::jsonb, 'beforeArchiveDelete')`,
      [
        dppId,
        companyId,
        typeName,
        archiveRow.modelName,
        archiveRow.internalAliasId,
        JSON.stringify(archiveRow),
      ]
    );
    await pool.query(
      `INSERT INTO "passportArchives"
        ("dppId", "lineageId", "companyId", "passportType", "versionNumber",
         "modelName", "internalAliasId", "releaseStatus", "rowData", "snapshotReason")
       VALUES ($1, $1, $2, $3, 3, $4, $5, 'draft', $6::jsonb, 'afterDraftEdit')`,
      [
        dppId,
        companyId,
        typeName,
        archiveRow.modelName,
        `draft-alias-${dppId}`,
        JSON.stringify({
          ...archiveRow,
          versionNumber: 3,
          releaseStatus: "draft",
          publicField: "draft-archive-public",
          secretAlpha: "draft-archive-secret",
        }),
      ]
    );
    await pool.query(`UPDATE ${tableName} SET "deletedAt" = NOW() WHERE "dppId" = $1`, [dppId]);

    const archivedRead = await fetchJson(`/api/public/passports/${dppId}`, {
      headers: { "X-API-Key": rawKey },
    });
    assert.equal(archivedRead.response.status, 200);
    assert.equal(archivedRead.payload.archived, true);
    assert.equal(containsValue(archivedRead.payload, "alpha-v2-secret"), true);
    assert.equal(containsValue(archivedRead.payload, "beta-v2-secret"), false);
    assert.equal(containsValue(archivedRead.payload, "draft-archive-public"), false);
    assert.equal(containsValue(archivedRead.payload, "draft-archive-secret"), false);

    const passportSelector = await fetchJson(
      `/api/companies/${companyId}/api-keys/passport-type/${typeName}/passports`,
      { headers: { authorization: `Bearer ${adminToken}` } }
    );
    assert.equal(passportSelector.response.status, 200);
    assert.equal(passportSelector.payload.length, 3);
    assert.equal(new Set(passportSelector.payload.map((passport) => passport.dppId)).size, 3);
    assert.equal(passportSelector.payload.find((passport) => passport.dppId === dppId)?.archived, true);

    const archivedGroup = await fetchJson(`/api/companies/${companyId}/api-keys`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Archived passport probe",
        passportType: typeName,
        scopeType: "passports",
        fieldKeys: ["secretBeta"],
        passportDppIds: [dppId],
      }),
    });
    assert.equal(archivedGroup.response.status, 201);
    assert.deepEqual(archivedGroup.payload.passportDppIds, [dppId]);
    const archivedNewKeyRead = await fetchJson(`/api/public/passports/${dppId}`, {
      headers: { "X-API-Key": archivedGroup.payload.key },
    });
    assert.equal(archivedNewKeyRead.response.status, 200);
    assert.equal(containsValue(archivedNewKeyRead.payload, "alpha-v2-secret"), false);
    assert.equal(containsValue(archivedNewKeyRead.payload, "beta-v2-secret"), true);

    const integrationArchive = await fetchJson(`${integrationBase}/${otherDppId}/archive`, {
      method: "POST",
      headers: integrationHeaders,
      body: "{}",
    });
    assert.equal(integrationArchive.response.status, 200);

    console.log("Live confidentiality probe passed.");
    console.log("public=200 invalidKey=401 selectedKey=200 wrongPassport=403 history=200 archived=200 bearerGuard=401 mutations=clean");
  } finally {
    if (foreignCompanyId) {
      await pool.query("DELETE FROM companies WHERE id = $1", [foreignCompanyId]).catch(() => {});
    }
    await removeProbeData(pool, companyId, typeId);
    await fs.promises.unlink(publicAttachmentPath).catch(() => {});
    await fs.promises.unlink(restrictedAttachmentPath).catch(() => {});
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
