"use strict";

const logger = require("../services/logger");

function isSafeSqlIdentifier(value) {
  return /^[A-Za-z][A-Za-z0-9]*$/.test(String(value || ""));
}

function quoteDbIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!isSafeSqlIdentifier(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

const schemaMigrationLockKey = 18224027;

async function ensureSchemaMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "schemaMigrations" (
      id         VARCHAR(200) PRIMARY KEY,
      "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function addPassportRegistryForeignKey(pool, {
  tableName,
  columnName = "passportDppId",
  constraintName,
  nullable = false,
  onDelete = "CASCADE",
}) {
  const columnExists = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [tableName, columnName]
  );
  if (!columnExists.rows.length) {
    logger.warn({ tableName, columnName, constraintName }, "Skipping passport registry foreign key because child column is missing");
    return;
  }

  const quotedTableName = quoteDbIdentifier(tableName);
  const quotedColumnName = quoteDbIdentifier(columnName);
  await pool.query(`
    DO $$
    DECLARE orphanCount INTEGER;
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE LOWER(conname) = LOWER('${constraintName}')
      ) THEN
        SELECT COUNT(*) INTO orphanCount
        FROM ${quotedTableName} child
        LEFT JOIN "passportRegistry" parent ON parent."dppId" = child.${quotedColumnName}
        WHERE child.${quotedColumnName} IS NOT NULL
          AND parent."dppId" IS NULL;

        IF orphanCount > 0 THEN
          RAISE EXCEPTION 'Cannot add ${constraintName}: % orphan row(s) in ${tableName}.${columnName}', orphanCount;
        END IF;

        ALTER TABLE ${quotedTableName}
          ADD CONSTRAINT ${constraintName}
          FOREIGN KEY (${quotedColumnName}) REFERENCES "passportRegistry"("dppId") ON DELETE ${onDelete};
      END IF;
    END $$;
  `);

  if (!nullable) {
    await pool.query(`
      ALTER TABLE ${quotedTableName}
      ALTER COLUMN ${quotedColumnName} SET NOT NULL
    `);
  }
}

/**
 * Database initialization — creates or alters all tables and indexes.
 * Extracted from server.js to keep startup logic separate from route handling.
 *
 * Usage:
 *   const { initDb } = require("./db/init");
 *   await initDb(pool, { getTable, createPassportTable, inRevisionStatus });
 */

async function initDb(pool, {
  getTable,
  createPassportTable,
  inRevisionStatus,
}) {
  await pool.query(`SELECT pg_advisory_lock($1)`, [schemaMigrationLockKey]);
  try {
    await ensureSchemaMigrationsTable(pool);
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  // Core user and company management tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id               SERIAL PRIMARY KEY,
      "companyName"     VARCHAR(255) NOT NULL UNIQUE,
      "legalName"       TEXT,
      country          TEXT,
      "companyRegistrationNumber" TEXT,
      "vatNumber"       TEXT,
      "websiteDomain"   TEXT,
      "customerTrustLevel" TEXT DEFAULT 'basic',
      "verificationStatus" TEXT DEFAULT 'unverified',
      "authorizedContactName" TEXT,
      "authorizedContactEmail" TEXT,
      "companyLogo"      TEXT,
      "introductionText" TEXT,
      "isActive"        BOOLEAN NOT NULL DEFAULT true,
      "assetManagementEnabled" BOOLEAN NOT NULL DEFAULT false,
      "assetManagementRevokedAt" TIMESTAMPTZ,
      "didSlug"         VARCHAR(160),
      "economicOperatorIdentifier" TEXT,
      "economicOperatorIdentifierScheme" VARCHAR(80),
      "brandingJson"    JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "idxCompaniesDidSlugUnique"
      ON companies("didSlug")
      WHERE "didSlug" IS NOT NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "companyDppPolicies" (
      id SERIAL PRIMARY KEY,
      "companyId" INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
      "defaultGranularity" VARCHAR(10) NOT NULL DEFAULT 'item' CHECK ("defaultGranularity" IN ('model', 'batch', 'item')),
      "allowGranularityOverride" BOOLEAN NOT NULL DEFAULT false,
      "mintModelDids" BOOLEAN NOT NULL DEFAULT true,
      "mintItemDids" BOOLEAN NOT NULL DEFAULT true,
      "mintFacilityDids" BOOLEAN NOT NULL DEFAULT false,
      "vcIssuanceEnabled" BOOLEAN NOT NULL DEFAULT true,
      "jsonldExportEnabled" BOOLEAN NOT NULL DEFAULT true,
      "semanticDictionaryEnabled" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    INSERT INTO "companyDppPolicies" (
      "companyId",
      "defaultGranularity",
      "allowGranularityOverride"
    )
    SELECT
      c.id,
      'item',
      false
    FROM companies c
    ON CONFLICT ("companyId") DO NOTHING
  `);

  // DPP subject registry — tracks issued product/DPP DIDs per passport
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "dppSubjectRegistry" (
      id              SERIAL PRIMARY KEY,
      "companyId"      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      "passportDppId"  TEXT NOT NULL,
      "internalAliasId" TEXT NOT NULL,
      "productIdentifierDid" TEXT,
      granularity     VARCHAR(20) NOT NULL DEFAULT 'model',
      "productDid"    TEXT NOT NULL,
      "dppDid"        TEXT NOT NULL,
      "companyDid"    TEXT NOT NULL,
      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE("companyId", "internalAliasId")
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxDppSubjectRegistryGuid"
      ON "dppSubjectRegistry"("passportDppId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxDppSubjectRegistryProduct"
      ON "dppSubjectRegistry"("companyId", "internalAliasId")
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "dppRegistryRegistrations" (
      id SERIAL PRIMARY KEY,
      "passportDppId" TEXT NOT NULL,
      "companyId" INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      "productIdentifier" TEXT NOT NULL,
      "dppId" TEXT NOT NULL,
      "registryName" VARCHAR(120) NOT NULL DEFAULT 'local',
      status VARCHAR(40) NOT NULL DEFAULT 'registered',
      "registrationPayload" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "registeredBy" INTEGER,
      "registeredAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE ("registryName", "dppId")
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxDppRegistryRegistrationsGuid"
      ON "dppRegistryRegistrations"("passportDppId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxDppRegistryRegistrationsCompany"
      ON "dppRegistryRegistrations"("companyId", "registryName")
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "backupServiceProviders" (
      id                        SERIAL PRIMARY KEY,
      "companyId"                INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      "providerKey"              VARCHAR(120) NOT NULL UNIQUE,
      "providerType"             VARCHAR(60) NOT NULL DEFAULT 'ociObjectStorage',
      "displayName"              VARCHAR(255) NOT NULL,
      "objectPrefix"             TEXT NOT NULL DEFAULT 'backup-provider',
      "publicBaseUrl"           TEXT,
      "supportsPublicHandover"  BOOLEAN NOT NULL DEFAULT true,
      "configJson"               JSONB NOT NULL DEFAULT '{}'::jsonb,
      "isActive"                 BOOLEAN NOT NULL DEFAULT true,
      "isBackupProvider"        BOOLEAN NOT NULL DEFAULT true,
      "createdBy"                INTEGER,
      "createdAt"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxBackupServiceProvidersCompany"
      ON "backupServiceProviders"("companyId", "isActive", "providerKey")
  `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "passportBackupReplications" (
        id                         SERIAL PRIMARY KEY,
        "backupProviderId"         INTEGER REFERENCES "backupServiceProviders"(id) ON DELETE SET NULL,
        "backupProviderKey"        VARCHAR(120) NOT NULL,
        "passportDppId"            TEXT NOT NULL,
        "lineageId"                 TEXT,
        "companyId"                 INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        "passportType"              VARCHAR(100),
        "versionNumber"             INTEGER NOT NULL DEFAULT 1,
        "dppId"                     TEXT,
        "snapshotScope"             VARCHAR(60) NOT NULL DEFAULT 'releasedCurrent',
        "replicationStatus"         VARCHAR(40) NOT NULL DEFAULT 'pending',
        "storageProvider"           VARCHAR(60),
        "storageKey"                TEXT,
        "publicUrl"                 TEXT,
        "payloadHash"               VARCHAR(64),
        "payloadJson"               JSONB NOT NULL DEFAULT '{}'::jsonb,
        "errorMessage"              TEXT,
        "verificationStatus"        VARCHAR(40) NOT NULL DEFAULT 'pending',
        "verificationErrorMessage" TEXT,
        "verifiedPayloadHash"      VARCHAR(64),
        "lastVerifiedAt"           TIMESTAMPTZ,
        "replicatedAt"              TIMESTAMPTZ,
        "createdAt"                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE ("backupProviderKey", "passportDppId", "versionNumber", "snapshotScope")
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idxPassportBackupReplicationsPassport"
        ON "passportBackupReplications"("companyId", "passportDppId", "versionNumber" DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idxPassportBackupReplicationsStatus"
        ON "passportBackupReplications"("replicationStatus", "updatedAt" DESC)
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "passportRegistry" (
      "dppId"                     TEXT        PRIMARY KEY,
      "lineageId"                 TEXT        NOT NULL,
      "companyId"                 INTEGER     NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      "passportType"              VARCHAR(50) NOT NULL,
      "deviceApiKeyHash"          VARCHAR(64),
      "deviceApiKeyPrefix"        VARCHAR(24),
      "deviceKeyLastRotatedAt"    TIMESTAMPTZ,
        "createdAt"                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idxPassportRegistryCompany"
        ON "passportRegistry"("companyId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxPassportRegistryLineage"
      ON "passportRegistry"("lineageId")
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id               SERIAL PRIMARY KEY,
      email            VARCHAR(255) NOT NULL UNIQUE,
      "passwordHash"    VARCHAR(255) NOT NULL,
      "firstName"       VARCHAR(100),
      "lastName"        VARCHAR(100),
      "companyId"       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      role             VARCHAR(50) NOT NULL DEFAULT 'viewer',
      "isActive"        BOOLEAN NOT NULL DEFAULT true,
      "otpCode"         VARCHAR(6),
      "otpCodeHash"     TEXT,
      "otpExpiresAt"    TIMESTAMPTZ,
      "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
      "sessionVersion"  INTEGER NOT NULL DEFAULT 1,
      "pepperVersion"   INTEGER NOT NULL DEFAULT 1,
      "avatarUrl"       TEXT,
      phone            VARCHAR(50),
      "jobTitle"        VARCHAR(120),
      bio              TEXT,
      "preferredLanguage" VARCHAR(12) DEFAULT 'en',
      "defaultReviewerId" INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "defaultApproverId" INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "authSource"      VARCHAR(100) NOT NULL DEFAULT 'local',
      "ssoOnly"         BOOLEAN NOT NULL DEFAULT false,
      "lastLoginAt"    TIMESTAMPTZ,
      "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    UPDATE users
       SET role = CASE
         WHEN role = ('super' || chr(95) || 'admin') THEN 'superAdmin'
         WHEN role = ('company' || chr(95) || 'admin') THEN 'companyAdmin'
         WHEN role = 'admin' THEN 'companyAdmin'
         ELSE role
       END
     WHERE role IN (('super' || chr(95) || 'admin'), ('company' || chr(95) || 'admin'), 'admin')
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE LOWER(conname) = LOWER('usersRoleAllowedValues')
      ) THEN
        ALTER TABLE users
          ADD CONSTRAINT "usersRoleAllowedValues"
          CHECK (role IN ('superAdmin', 'companyAdmin', 'editor', 'viewer'));
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "backupPublicHandovers" (
      id                     SERIAL PRIMARY KEY,
      "companyId"             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      "passportDppId"        TEXT NOT NULL REFERENCES "passportRegistry"("dppId") ON DELETE CASCADE,
      "lineageId"             TEXT,
      "passportType"          VARCHAR(100) NOT NULL,
      "internalAliasId"      TEXT NOT NULL,
      "versionNumber"         INTEGER NOT NULL DEFAULT 1,
      "backupProviderId"     INTEGER REFERENCES "backupServiceProviders"(id) ON DELETE SET NULL,
      "backupProviderKey"    VARCHAR(100) NOT NULL,
      "sourceReplicationId"  INTEGER REFERENCES "passportBackupReplications"(id) ON DELETE SET NULL,
      "storageKey"            TEXT,
      "publicUrl"             TEXT,
      "publicCompanyName"    TEXT,
      "publicRowData"        JSONB NOT NULL DEFAULT '{}'::jsonb,
      "handoverStatus"        VARCHAR(32) NOT NULL DEFAULT 'active',
      "verificationStatus"    VARCHAR(32) NOT NULL DEFAULT 'verified',
      notes                 TEXT,
      "activatedBy"           INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "deactivatedBy"         INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "activatedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "deactivatedAt"         TIMESTAMPTZ,
      "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);


    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idxBackupPublicHandoversCompany"
        ON "backupPublicHandovers"("companyId", "activatedAt" DESC, id DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idxBackupPublicHandoversProduct"
        ON "backupPublicHandovers"("internalAliasId", "handoverStatus", "activatedAt" DESC, id DESC)
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idxBackupPublicHandoversActivePassport"
        ON "backupPublicHandovers"("passportDppId")
        WHERE "handoverStatus" = 'active'
    `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "userIdentities" (
      id               SERIAL PRIMARY KEY,
      "userId"          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "providerKey"     VARCHAR(100) NOT NULL,
      "providerSubject" VARCHAR(255) NOT NULL,
      email            VARCHAR(255),
      "rawProfile"      JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "lastLoginAt"    TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "idxUserIdentitiesProviderSubject"
      ON "userIdentities"("providerKey", "providerSubject")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxUserIdentitiesUser"
      ON "userIdentities"("userId")
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS "passportTypes" (
      id               SERIAL PRIMARY KEY,
      "typeName"        VARCHAR(100) NOT NULL UNIQUE,
      "displayName"     VARCHAR(255) NOT NULL,
      "productCategory" VARCHAR(100),
      "productIcon"    VARCHAR(10) DEFAULT '📋',
      "semanticModelKey" VARCHAR(100),
      "fieldsJson"      JSONB NOT NULL DEFAULT '{"sections":[]}',
      "isActive"        BOOLEAN NOT NULL DEFAULT true,
      "createdBy"       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "passportTypeSchemaEvents" (
      id                SERIAL PRIMARY KEY,
      "passportTypeId"  INTEGER REFERENCES "passportTypes"(id) ON DELETE SET NULL,
      "typeName"         VARCHAR(100) NOT NULL,
      "tableName"        VARCHAR(140) NOT NULL,
      "schemaVersion"    INTEGER NOT NULL DEFAULT 1,
      "eventType"        VARCHAR(60) NOT NULL,
      "changeSummary"    JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdBy"        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxPassportTypeSchemaEventsType"
      ON "passportTypeSchemaEvents"("typeName", "createdAt" DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "auditLogs" (
      id               SERIAL PRIMARY KEY,
      "companyId"       INTEGER,
      "userId"          INTEGER,
      action           VARCHAR(100) NOT NULL,
      "tableName"       VARCHAR(100),
      "recordId"        VARCHAR(100),
      "actorIdentifier" TEXT,
      audience         VARCHAR(80),
      "oldValues"       JSONB,
      "newValues"       JSONB,
      "previousEventHash" VARCHAR(64),
      "eventHash"       VARCHAR(64),
      "hashVersion"     SMALLINT NOT NULL DEFAULT 2,
      "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxAuditLogsCompanyCreated"
      ON "auditLogs"("companyId", "createdAt" DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "auditLogAnchors" (
      id                   SERIAL PRIMARY KEY,
      "companyId"           INTEGER,
      "logCount"            INTEGER NOT NULL DEFAULT 0,
      "firstLogId"         INTEGER,
      "latestLogId"        INTEGER,
      "rootEventHash"      VARCHAR(64),
      "previousAnchorHash" VARCHAR(64),
      "anchorHash"          VARCHAR(64) NOT NULL,
      "anchorType"          VARCHAR(80) NOT NULL DEFAULT 'internalRecord',
      "anchorReference"     TEXT,
      notes                TEXT,
      "metadataJson"        JSONB NOT NULL DEFAULT '{}'::jsonb,
      "anchoredBy"          INTEGER,
      "anchoredAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "idxAuditLogAnchorsHash"
      ON "auditLogAnchors"("anchorHash")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxAuditLogAnchorsCompanyAnchored"
      ON "auditLogAnchors"("companyId", "anchoredAt" DESC, id DESC)
  `);
  await pool.query(`
    CREATE OR REPLACE FUNCTION "rejectAppendOnlyMutation"()
    RETURNS trigger
    AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only; % operations are not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '55000';
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    DROP TRIGGER IF EXISTS "trgAuditLogsRejectMutation" ON "auditLogs"
  `);
  await pool.query(`
    CREATE TRIGGER "trgAuditLogsRejectMutation"
    BEFORE UPDATE OR DELETE ON "auditLogs"
    FOR EACH ROW
    EXECUTE FUNCTION "rejectAppendOnlyMutation"()
  `);
  await pool.query(`
    DROP TRIGGER IF EXISTS "trgAuditLogAnchorsRejectMutation" ON "auditLogAnchors"
  `);
  await pool.query(`
    CREATE TRIGGER "trgAuditLogAnchorsRejectMutation"
    BEFORE UPDATE OR DELETE ON "auditLogAnchors"
    FOR EACH ROW
    EXECUTE FUNCTION "rejectAppendOnlyMutation"()
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "inviteTokens" (
      id               SERIAL PRIMARY KEY,
      token            VARCHAR(36) NOT NULL UNIQUE,
      email            VARCHAR(255) NOT NULL,
      "companyId"       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      "invitedBy"       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "roleToAssign"   VARCHAR(50) NOT NULL DEFAULT 'editor',
      "approvalStatus" VARCHAR(32) NOT NULL DEFAULT 'approved',
      "approvedBy"     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "approvedAt"     TIMESTAMPTZ,
      "inviteEmailSentAt" TIMESTAMPTZ,
      used             BOOLEAN NOT NULL DEFAULT false,
      "expiresAt"       TIMESTAMPTZ NOT NULL,
      "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE LOWER(conname) = LOWER('inviteTokensRoleToAssignAllowedValues')
      ) THEN
        ALTER TABLE "inviteTokens"
          ADD CONSTRAINT "inviteTokensRoleToAssignAllowedValues"
          CHECK ("roleToAssign" IN ('superAdmin', 'companyAdmin', 'editor', 'viewer'));
      END IF;
    END $$;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxPassportRegistryCompany"
      ON "passportRegistry"("companyId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxPassportRegistryLineage"
      ON "passportRegistry"("lineageId")
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "productIdentifierLineage" (
      id                           SERIAL PRIMARY KEY,
      "companyId"                  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      "lineageId"                  TEXT    NOT NULL,
      "previousPassportDppId"      TEXT    NOT NULL,
      "replacementPassportDppId"   TEXT    NOT NULL,
      "previousIdentifier"         TEXT    NOT NULL,
      "replacementIdentifier"      TEXT    NOT NULL,
      "previousInternalAliasId"    TEXT,
      "replacementInternalAliasId" TEXT,
      "previousGranularity"        VARCHAR(20) NOT NULL CHECK ("previousGranularity" IN ('model', 'batch', 'item')),
      "replacementGranularity"     VARCHAR(20) NOT NULL CHECK ("replacementGranularity" IN ('model', 'batch', 'item')),
      "transitionReason"           TEXT,
      "createdBy"                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "createdAt"                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE ("previousPassportDppId", "replacementPassportDppId")
    )
  `);

  await pool.query(`

    CREATE INDEX IF NOT EXISTS "idxProductIdentifierLineageCompany"
      ON "productIdentifierLineage"("companyId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxProductIdentifierLineageLineage"
      ON "productIdentifierLineage"("lineageId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxProductIdentifierLineagePreviousIdentifier"
      ON "productIdentifierLineage"("previousIdentifier")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxProductIdentifierLineageReplacementIdentifier"
      ON "productIdentifierLineage"("replacementIdentifier")
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS "idxPassportTypesProductCategory" ON "passportTypes"("productCategory")');
  await pool.query('CREATE INDEX IF NOT EXISTS "idxPassportTypesActive" ON "passportTypes"("isActive")');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "companyPassportAccess" (
      id               SERIAL PRIMARY KEY,
      "companyId"       INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      "passportTypeId" INT NOT NULL REFERENCES "passportTypes"(id) ON DELETE CASCADE,
      "accessRevoked"   BOOLEAN NOT NULL DEFAULT FALSE,
      "grantedAt"       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("companyId", "passportTypeId")
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idxCpaCompany" ON "companyPassportAccess"("companyId")`);

  // Product categories — standalone managed table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "productCategories" (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL UNIQUE,
      icon       VARCHAR(10)  NOT NULL DEFAULT '📋',
      "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  // Company file repository
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "companyRepository" (
      id         SERIAL PRIMARY KEY,
      "companyId" INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      "parentId"  INT REFERENCES "companyRepository"(id) ON DELETE CASCADE,
      name       VARCHAR(255) NOT NULL,
      type       VARCHAR(10)  NOT NULL DEFAULT 'file',
      "filePath"  TEXT,
      "storageKey" TEXT,
      "storageProvider" VARCHAR(50),
      "repositoryScope" VARCHAR(20) NOT NULL DEFAULT 'files',
      "fileUrl"   TEXT,
      "mimeType"  VARCHAR(100),
      "sizeBytes" BIGINT,
      "createdBy" INT REFERENCES users(id) ON DELETE SET NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "companyFacilities" (
      id                  SERIAL PRIMARY KEY,
      "companyId"          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      "facilityIdentifier" TEXT NOT NULL,
      "identifierScheme"   VARCHAR(80) NOT NULL,
      "displayName"        VARCHAR(255),
      "metadataJson"       JSONB NOT NULL DEFAULT '{}'::jsonb,
      "isActive"           BOOLEAN NOT NULL DEFAULT true,
      "createdBy"          INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE ("companyId", "identifierScheme", "facilityIdentifier")
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxCompanyFacilitiesCompany"
      ON "companyFacilities"("companyId", "isActive", "updatedAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxRepoCompanyParent"
      ON "companyRepository"("companyId", "parentId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxRepoCompanyScopeParent"
      ON "companyRepository"("companyId", "repositoryScope", "parentId")
  `);

  // Global symbol repository (super-admin managed, visible to all users)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS symbols (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL,
      category   VARCHAR(50)  NOT NULL DEFAULT 'General',
      "storageKey" TEXT,
      "storageProvider" VARCHAR(50),
      "fileUrl"   TEXT         NOT NULL,
      "createdBy" INT REFERENCES users(id) ON DELETE SET NULL,
      "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      "isActive"  BOOLEAN      NOT NULL DEFAULT true
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idxSymbolsCategory" ON symbols(category)`);

  // Security group API keys for restricted-field unlocks on public passport reads.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "apiKeys" (
      id           SERIAL PRIMARY KEY,
      "companyId"   INT          NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name         VARCHAR(100) NOT NULL,
      "keyHash"     VARCHAR(64)  NOT NULL UNIQUE,
      "keyPrefix"   VARCHAR(16)  NOT NULL,
      "keySalt"     VARCHAR(64)  NOT NULL,
      "hashAlgorithm" VARCHAR(32) NOT NULL DEFAULT 'hmacSha256',
      "passportType" VARCHAR(100) NOT NULL REFERENCES "passportTypes"("typeName") ON UPDATE CASCADE ON DELETE CASCADE,
      "scopeType"  VARCHAR(24) NOT NULL DEFAULT 'passportType',
      "fieldKeys"  TEXT[]       NOT NULL DEFAULT ARRAY[]::text[],
      "passportDppIds" TEXT[]   NOT NULL DEFAULT ARRAY[]::text[],
      "expiresAt"   TIMESTAMPTZ,
      "createdBy"   INT REFERENCES users(id) ON DELETE SET NULL,
      "createdAt"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      "updatedAt"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      "lastUsedAt" TIMESTAMPTZ,
      "isActive"    BOOLEAN      NOT NULL DEFAULT true,
      CONSTRAINT "apiKeys_scopeType_check"
        CHECK ("scopeType" IN ('passportType', 'passports')),
      CONSTRAINT "apiKeys_hashAlgorithm_check"
        CHECK ("hashAlgorithm" = 'hmacSha256' AND "keyHash" ~ '^[0-9a-fA-F]{64}$'),
      CONSTRAINT "apiKeys_fieldKeys_check"
        CHECK (cardinality("fieldKeys") > 0),
      CONSTRAINT "apiKeys_passportScope_check"
        CHECK (
          ("scopeType" = 'passportType' AND cardinality("passportDppIds") = 0)
          OR ("scopeType" = 'passports' AND cardinality("passportDppIds") > 0)
        )
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idxApiKeysCompany" ON "apiKeys"("companyId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idxApiKeysHash"    ON "apiKeys"("keyHash")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idxApiKeysPrefix"   ON "apiKeys"("keyPrefix")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idxApiKeysPassportType" ON "apiKeys"("companyId", "passportType", "scopeType")`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "requestRateLimits" (
      "bucketKey" VARCHAR(255) PRIMARY KEY,
      count      INTEGER NOT NULL DEFAULT 0,
      "resetAt"   TIMESTAMPTZ NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxRequestRateLimitsResetAt"
      ON "requestRateLimits"("resetAt")
  `);
  await pool.query(`
    DELETE FROM "requestRateLimits"
    WHERE "resetAt" <= NOW()
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "passportScanEvents" (
      id             SERIAL PRIMARY KEY,
      "passportDppId" TEXT NOT NULL REFERENCES "passportRegistry"("dppId") ON DELETE CASCADE,
      "viewerUserId" INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "userAgent"    TEXT,
      referrer       TEXT,
      "scannedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idxPassportScanEventsPassport"
        ON "passportScanEvents"("passportDppId", "scannedAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxPassportScanEventsViewer"
      ON "passportScanEvents"("viewerUserId")
      WHERE "viewerUserId" IS NOT NULL
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "idxPassportScanEventsUniqueViewer"
      ON "passportScanEvents"("passportDppId", "viewerUserId")
      WHERE "viewerUserId" IS NOT NULL
  `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "passportSecurityEvents" (
      id SERIAL PRIMARY KEY,
      "passportDppId" TEXT NOT NULL,
      "companyId" INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      "eventType" VARCHAR(80) NOT NULL,
      severity VARCHAR(32) NOT NULL DEFAULT 'info',
      source VARCHAR(32) NOT NULL DEFAULT 'system',
      details JSONB,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idxPassportSecurityEventsPassport"
        ON "passportSecurityEvents"("passportDppId", "createdAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxPassportSecurityEventsCompany"
      ON "passportSecurityEvents"("companyId", "createdAt" DESC)
  `);
  // Dynamic field values — time-series: every push appends a new row, nothing is ever overwritten
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "passportDynamicValues" (
      id            SERIAL       PRIMARY KEY,
      "passportDppId" TEXT         NOT NULL,
      "fieldKey"    VARCHAR(100) NOT NULL,
      value         TEXT,
        "updatedAt"   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idxDvPassport" ON "passportDynamicValues"("passportDppId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxDvPassportField"
      ON "passportDynamicValues"("passportDppId", "fieldKey", "updatedAt" DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "assetManagementJobs" (
      id               SERIAL PRIMARY KEY,
      "companyId"       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      "passportType"    VARCHAR(100) NOT NULL,
      name             VARCHAR(255) NOT NULL,
      "sourceKind"      VARCHAR(40) NOT NULL DEFAULT 'manual',
      "sourceConfig"    JSONB NOT NULL DEFAULT '{}'::jsonb,
      "recordsJson"     JSONB NOT NULL DEFAULT '[]'::jsonb,
      "optionsJson"     JSONB NOT NULL DEFAULT '{}'::jsonb,
      "isActive"        BOOLEAN NOT NULL DEFAULT true,
      "startAt"         TIMESTAMPTZ,
      "intervalMinutes" INTEGER,
      "nextRunAt"      TIMESTAMPTZ,
      "lastRunAt"      TIMESTAMPTZ,
      "lastStatus"      VARCHAR(30),
      "lastSummary"     JSONB,
      "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxAssetJobsCompany"
      ON "assetManagementJobs"("companyId", "updatedAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxAssetJobsDue"
      ON "assetManagementJobs"("nextRunAt")
      WHERE "isActive" = true
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "assetManagementRuns" (
      id             SERIAL PRIMARY KEY,
      "jobId"         INTEGER REFERENCES "assetManagementJobs"(id) ON DELETE SET NULL,
      "companyId"     INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      "passportType"  VARCHAR(100),
      "triggerType"   VARCHAR(40) NOT NULL,
      "sourceKind"    VARCHAR(40),
      status         VARCHAR(30) NOT NULL,
      "summaryJson"   JSONB,
      "requestJson"   JSONB,
      "generatedJson" JSONB,
      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxAssetRunsCompany"
      ON "assetManagementRuns"("companyId", "createdAt" DESC)
  `);
  // Digital signatures — one row per released passport version
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "passportSignatures" (
      id             SERIAL       PRIMARY KEY,
      "passportDppId" TEXT         NOT NULL,
      "versionNumber" INTEGER      NOT NULL DEFAULT 1,
      "dataHash"     TEXT         NOT NULL,
      signature      TEXT         NOT NULL,
      algorithm      VARCHAR(50)  NOT NULL DEFAULT 'ES256',
      "signingKeyId" VARCHAR(64)  NOT NULL,
      "releasedAt"   TIMESTAMPTZ  NOT NULL,
      "signedAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      "vcJson"       TEXT,
      UNIQUE ("passportDppId", "versionNumber")
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "dppReleaseRecords" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "dppId" TEXT NOT NULL REFERENCES "passportRegistry"("dppId") ON DELETE CASCADE,
      companyname TEXT NOT NULL,
      "releasedByUserId" INTEGER NOT NULL REFERENCES users(id),
      "releasedByEmail" TEXT NOT NULL,
      "releaseVersion" INTEGER NOT NULL,
      "dppHash" TEXT NOT NULL,
      "signatureId" INTEGER REFERENCES "passportSignatures"(id) ON DELETE SET NULL,
      "releaseNote" TEXT,
      "releasedAt" TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE ("dppId", "releaseVersion")
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxDppReleaseRecordsDpp"
      ON "dppReleaseRecords"("dppId", "releaseVersion" DESC)
  `);
  // Store public keys so verifiers can always look them up by key ID
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "passportSigningKeys" (
      "keyId"     VARCHAR(64) PRIMARY KEY,
      "publicKey" TEXT        NOT NULL,
      algorithm  VARCHAR(50) NOT NULL DEFAULT 'ES256',
      "algorithmVersion" VARCHAR(20) NOT NULL DEFAULT 'ES256',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // One in-progress draft per super-admin user
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "passportTypeDrafts" (
      id          SERIAL      PRIMARY KEY,
      "userId"     INTEGER     NOT NULL UNIQUE,
      "draftJson"  JSONB       NOT NULL,
      "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "passportEditSessions" (
      id               SERIAL PRIMARY KEY,
      "passportDppId" TEXT         NOT NULL,
      "companyId"     INTEGER      NOT NULL,
      "passportType"  VARCHAR(100) NOT NULL,
      "userId"        INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "lastActivityAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      "updatedAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE ("passportDppId", "userId")
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idxPassportEditSessionsPassport"
        ON "passportEditSessions"("passportDppId", "lastActivityAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxPassportEditSessionsUser"
      ON "passportEditSessions"("userId")
  `);

  // Notifications table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
      id               SERIAL      PRIMARY KEY,
      "userId"         INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type             VARCHAR(50) NOT NULL,
      title            VARCHAR(255) NOT NULL,
      message          TEXT,
      "passportDppId"  TEXT,
      "actionUrl"      VARCHAR(500),
      read             BOOLEAN     DEFAULT false,
        "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idxNotificationsUserCreated"
        ON notifications("userId", "createdAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxNotificationsRead"
      ON notifications("userId", read)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "passportWorkflow" (
      id                      SERIAL PRIMARY KEY,
      "passportDppId"         TEXT NOT NULL,
      "passportType"          VARCHAR(100) NOT NULL,
      "companyId"             INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      "submittedBy"           INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "reviewerId"            INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "approverId"            INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "reviewStatus"          VARCHAR(30) NOT NULL DEFAULT 'pending',
      "approvalStatus"        VARCHAR(30) NOT NULL DEFAULT 'pending',
      "overallStatus"         VARCHAR(30) NOT NULL DEFAULT 'inProgress',
      "reviewerComment"       TEXT,
      "approverComment"       TEXT,
      "previousReleaseStatus" VARCHAR(30),
      "reviewedAt"            TIMESTAMPTZ,
      "approvedAt"            TIMESTAMPTZ,
      "rejectedAt"            TIMESTAMPTZ,
      "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxPassportWorkflowCompanyStatus"
      ON "passportWorkflow"("companyId", "overallStatus", "createdAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxPassportWorkflowPassportCreated"
      ON "passportWorkflow"("passportDppId", "createdAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxPassportWorkflowReviewerPending"
      ON "passportWorkflow"("reviewerId", "reviewStatus", "createdAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxPassportWorkflowApproverPending"
      ON "passportWorkflow"("approverId", "approvalStatus", "createdAt" DESC)
  `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "passportRevisionBatches" (
      id                SERIAL PRIMARY KEY,
      "companyId"       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      "passportType"    VARCHAR(100),
      "requestedBy"     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "scopeType"       VARCHAR(50) NOT NULL DEFAULT 'selected',
      "scopeMeta"       JSONB NOT NULL DEFAULT '{}'::jsonb,
      "revisionNote"    TEXT,
      "changesJson"     JSONB NOT NULL DEFAULT '{}'::jsonb,
      "submitToWorkflow" BOOLEAN NOT NULL DEFAULT false,
      "reviewerId"      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "approverId"      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "totalTargeted"   INTEGER NOT NULL DEFAULT 0,
      "revisedCount"    INTEGER NOT NULL DEFAULT 0,
      "skippedCount"    INTEGER NOT NULL DEFAULT 0,
      "failedCount"     INTEGER NOT NULL DEFAULT 0,
      "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idxRevisionBatchesCompanyCreated"
        ON "passportRevisionBatches"("companyId", "createdAt" DESC)
  `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "passportRevisionBatchItems" (
      id                    SERIAL PRIMARY KEY,
      "batchId"             INTEGER NOT NULL REFERENCES "passportRevisionBatches"(id) ON DELETE CASCADE,
      "passportDppId"       TEXT NOT NULL,
      "passportType"        VARCHAR(100) NOT NULL,
      "sourceVersionNumber" INTEGER,
      "newVersionNumber"    INTEGER,
      status                VARCHAR(30) NOT NULL,
      message               TEXT,
        "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idxRevisionBatchItemsBatch"
        ON "passportRevisionBatchItems"("batchId", "createdAt" DESC)
  `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "passportHistoryVisibility" (
      "passportDppId" TEXT NOT NULL,
      "versionNumber" INTEGER NOT NULL,
      "isPublic"      BOOLEAN NOT NULL DEFAULT true,
      "updatedBy"     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY ("passportDppId", "versionNumber")
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idxPassportHistoryVisibilityGuid"
        ON "passportHistoryVisibility"("passportDppId", "versionNumber" DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "passportArchives" (
      id               SERIAL PRIMARY KEY,
      "dppId"         TEXT NOT NULL,
      "lineageId"     TEXT,
      "companyId"     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      "passportType"  VARCHAR(100) NOT NULL,
      "versionNumber" INTEGER NOT NULL DEFAULT 1,
      "modelName"     VARCHAR(255),
      "internalAliasId" VARCHAR(255),
      "productIdentifierDid" TEXT,
      "actorIdentifier" TEXT,
      "snapshotReason" VARCHAR(100),
      "releaseStatus" VARCHAR(50),
      "rowData"       JSONB NOT NULL,
      "archivedBy"    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "archivedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idxPassportArchivesCompany" ON "passportArchives"("companyId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idxPassportArchivesGuid"    ON "passportArchives"("dppId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idxPassportArchivesLineage" ON "passportArchives"("lineageId")`);

  // Ensure shared passport tables exist for all passport types.
  // Idempotent — uses CREATE TABLE IF NOT EXISTS.
  const ptRows = await pool.query('SELECT "typeName" AS "typeName" FROM "passportTypes"');
  for (const { typeName } of ptRows.rows) {
    await createPassportTable(typeName).catch(e =>
      logger.warn({ err: e }, `Could not create table for ${typeName}`)
    );
  }

  // ── Templates tables ─────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "passportTemplates" (
      id            SERIAL PRIMARY KEY,
      "companyId"    INTEGER NOT NULL,
      "passportType" VARCHAR(100) NOT NULL,
      name          VARCHAR(200) NOT NULL,
      description   TEXT,
      "createdBy"    INTEGER,
      "createdAt"    TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt"    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "passportTemplateFields" (
      id           SERIAL PRIMARY KEY,
      "templateId"  INTEGER NOT NULL REFERENCES "passportTemplates"(id) ON DELETE CASCADE,
      "fieldKey"    VARCHAR(200) NOT NULL,
      "fieldValue"  TEXT,
      "isModelData" BOOLEAN DEFAULT FALSE,
      UNIQUE("templateId", "fieldKey")
    );
  `);

  // ── Password reset tokens ─────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "passwordResetTokens" (
      id         SERIAL PRIMARY KEY,
      "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      VARCHAR(128) NOT NULL UNIQUE,
      used       BOOLEAN NOT NULL DEFAULT false,
      "expiresAt" TIMESTAMPTZ NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxPasswordResetTokensUser" ON "passwordResetTokens"("userId")
  `);

  // ── Passport attachments (opaque public IDs for app-mediated file serving) ─
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "passportAttachments" (
      id            SERIAL PRIMARY KEY,
      "publicId"    VARCHAR(20)  NOT NULL UNIQUE,
      "companyId"   INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      "passportDppId" TEXT       NOT NULL,
      "fieldKey"    VARCHAR(100),
      "filePath"    TEXT,
      "storageKey"  TEXT,
      "storageProvider" VARCHAR(50),
      "fileUrl"     TEXT,
      "mimeType"    VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
      "sizeBytes"   BIGINT,
      "isPublic"    BOOLEAN      NOT NULL DEFAULT false,
      "createdAt"   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxPassportAttachmentsGuid"
      ON "passportAttachments"("passportDppId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idxPassportAttachmentsCompany"
      ON "passportAttachments"("companyId")
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE LOWER(conname) = LOWER('dppRegistryRegistrationsRegisteredByFk')
      ) THEN
        ALTER TABLE "dppRegistryRegistrations"
          ADD CONSTRAINT dppRegistryRegistrationsRegisteredByFk
          FOREIGN KEY ("registeredBy") REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE LOWER(conname) = LOWER('backupServiceProvidersCreatedByFk')
      ) THEN
        ALTER TABLE "backupServiceProviders"
          ADD CONSTRAINT backupServiceProvidersCreatedByFk
          FOREIGN KEY ("createdBy") REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  const passportRegistryReferences = [
    ["dppSubjectRegistry", "passportDppId", "dppSubjectRegistryPassportDppIdFk", false],
    ["dppRegistryRegistrations", "passportDppId", "dppRegistryRegistrationsPassportDppIdFk", false],
    ["passportBackupReplications", "passportDppId", "passportBackupReplicationsPassportDppIdFk", false],
    ["backupPublicHandovers", "passportDppId", "backupPublicHandoversPassportDppIdFk", false],
    ["passportScanEvents", "passportDppId", "passportScanEventsPassportDppIdFk", false],
    ["passportSecurityEvents", "passportDppId", "passportSecurityEventsPassportDppIdFk", false],
    ["passportDynamicValues", "passportDppId", "passportDynamicValuesPassportDppIdFk", false],
    ["passportSignatures", "passportDppId", "passportSignaturesPassportDppIdFk", false],
    ["passportEditSessions", "passportDppId", "passportEditSessionsPassportDppIdFk", false],
    ["notifications", "passportDppId", "notificationsPassportDppIdFk", true],
    ["passportRevisionBatchItems", "passportDppId", "passportRevisionBatchItemsPassportDppIdFk", false],
    ["passportHistoryVisibility", "passportDppId", "passportHistoryVisibilityPassportDppIdFk", false],
    ["passportAttachments", "passportDppId", "passportAttachmentsPassportDppIdFk", false],
  ];
  for (const [tableName, columnName, constraintName, nullable] of passportRegistryReferences) {
    await addPassportRegistryForeignKey(pool, {
      tableName,
      columnName,
      constraintName,
      nullable,
    });
  }
  } finally {
    try {
      await pool.query(`SELECT pg_advisory_unlock($1)`, [schemaMigrationLockKey]);
    } catch (error) {
      logger.warn({ err: error }, "Failed to release schema migration advisory lock");
    }
  }
}

module.exports = { initDb };
