"use strict";

const logger = require("../services/logger");
const BATTERY_DICTIONARY_MODEL_KEY = "claros_battery_dictionary_v1";

function isSafeSqlIdentifier(value) {
  return /^[a-z][a-z0-9_]*$/i.test(String(value || ""));
}

function quoteDbIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!isSafeSqlIdentifier(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function toDidSlug(value, fallback = "company") {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return normalized || fallback;
}

const SCHEMA_MIGRATION_LOCK_KEY = 18224027;

async function ensureSchemaMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         VARCHAR(200) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function runMigration(pool, migrationId, handler) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT 1
       FROM schema_migrations
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [migrationId]
    );
    if (existing.rows.length) {
      await client.query("COMMIT");
      return false;
    }

    await handler(client);
    await client.query(
      `INSERT INTO schema_migrations (id)
       VALUES ($1)
       ON CONFLICT (id) DO NOTHING`,
      [migrationId]
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function addPassportRegistryForeignKey(pool, {
  tableName,
  columnName = "passportDppId",
  constraintName,
  nullable = false,
  onDelete = "CASCADE",
}) {
  const quotedTableName = quoteDbIdentifier(tableName);
  const quotedColumnName = quoteDbIdentifier(columnName);
  await pool.query(`
    DO $$
    DECLARE orphan_count INTEGER;
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${constraintName}'
      ) THEN
        SELECT COUNT(*) INTO orphan_count
        FROM ${quotedTableName} child
        LEFT JOIN passport_registry parent ON parent."dppId" = child.${quotedColumnName}
        WHERE child.${quotedColumnName} IS NOT NULL
          AND parent."dppId" IS NULL;

        IF orphan_count > 0 THEN
          RAISE EXCEPTION 'Cannot add ${constraintName}: % orphan row(s) in ${tableName}.${columnName}', orphan_count;
        END IF;

        ALTER TABLE ${quotedTableName}
          ADD CONSTRAINT ${constraintName}
          FOREIGN KEY (${quotedColumnName}) REFERENCES passport_registry("dppId") ON DELETE ${onDelete};
      END IF;
    END $$;
  `);

  if (!nullable) {
    await pool.query(`
      ALTER TABLE ${quotedTableName}
      ALTER COLUMN ${quotedColumnName} SET NOT NULL
    `).catch(() => {});
  }
}

/**
 * Database initialization — creates or alters all tables and indexes.
 * Extracted from server.js to keep startup logic separate from route handling.
 *
 * Usage:
 *   const { initDb } = require("./db/init");
 *   await initDb(pool, { getTable, createPassportTable, IN_REVISION_STATUS });
 */

async function initDb(pool, {
  getTable,
  createPassportTable,
  IN_REVISION_STATUS,
  productIdentifierService,
}) {
  await pool.query(`SELECT pg_advisory_lock($1)`, [SCHEMA_MIGRATION_LOCK_KEY]);
  try {
    await ensureSchemaMigrationsTable(pool);
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  // Core user and company management tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id               SERIAL PRIMARY KEY,
      company_name     VARCHAR(255) NOT NULL UNIQUE,
      legal_name       TEXT,
      country          TEXT,
      company_registration_number TEXT,
      vat_number       TEXT,
      website_domain   TEXT,
      customer_trust_level TEXT DEFAULT 'BASIC',
      verification_status TEXT DEFAULT 'unverified',
      authorized_contact_name TEXT,
      authorized_contact_email TEXT,
      is_active        BOOLEAN NOT NULL DEFAULT true,
      asset_management_enabled BOOLEAN NOT NULL DEFAULT false,
      asset_management_revoked_at TIMESTAMPTZ,
      did_slug         VARCHAR(160),
      economic_operator_identifier TEXT,
      economic_operator_identifier_scheme VARCHAR(80),
      branding_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS asset_management_enabled BOOLEAN NOT NULL DEFAULT false
  `);
  await pool.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS asset_management_revoked_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS did_slug VARCHAR(160)
  `);
  await pool.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS economic_operator_identifier TEXT
  `);
  await pool.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS economic_operator_identifier_scheme VARCHAR(80)
  `);
  await pool.query(`
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS legal_name TEXT;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS country TEXT;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_registration_number TEXT;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_number TEXT;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS website_domain TEXT;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS customer_trust_level TEXT DEFAULT 'BASIC';
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified';
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS authorized_contact_name TEXT;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS authorized_contact_email TEXT;
  `);
  await runMigration(pool, "2026-04-27.backfill-company-did-slugs", async (db) => {
      const companyRows = await db.query(`
        SELECT id, company_name, did_slug
        FROM companies
        ORDER BY id ASC
      `);
      if (!companyRows.rows.length) return;
      const usedSlugs = new Set(
        companyRows.rows
          .map((row) => String(row.did_slug || "").trim())
          .filter(Boolean)
      );
      for (const row of companyRows.rows) {
        if (row.did_slug) continue;
        const baseSlug = toDidSlug(row.company_name, `company-${row.id}`);
        let nextSlug = baseSlug;
        let suffix = 2;
        while (usedSlugs.has(nextSlug)) {
          nextSlug = `${baseSlug}-${suffix++}`;
        }
        usedSlugs.add(nextSlug);
        await db.query(
          `UPDATE companies
           SET did_slug = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [nextSlug, row.id]
        );
      }
    });
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_did_slug_unique
      ON companies(did_slug)
      WHERE did_slug IS NOT NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_dpp_policies (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
      default_granularity VARCHAR(10) NOT NULL DEFAULT 'item' CHECK (default_granularity IN ('model', 'batch', 'item')),
      allow_granularity_override BOOLEAN NOT NULL DEFAULT false,
      mint_model_dids BOOLEAN NOT NULL DEFAULT true,
      mint_item_dids BOOLEAN NOT NULL DEFAULT true,
      mint_facility_dids BOOLEAN NOT NULL DEFAULT false,
      vc_issuance_enabled BOOLEAN NOT NULL DEFAULT true,
      jsonld_export_enabled BOOLEAN NOT NULL DEFAULT true,
      claros_battery_dictionary_enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE company_dpp_policies
    DROP COLUMN IF EXISTS legacy_semantic_compatibility
  `);
  await pool.query(`
    ALTER TABLE companies
    DROP COLUMN IF EXISTS dpp_granularity,
    DROP COLUMN IF EXISTS granularity_locked
  `);
  await pool.query(`
    INSERT INTO company_dpp_policies (
      company_id,
      default_granularity,
      allow_granularity_override
    )
    SELECT
      c.id,
      'item',
      false
    FROM companies c
    ON CONFLICT (company_id) DO NOTHING
  `);

  // DPP subject registry — tracks issued product/DPP DIDs per passport
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dpp_subject_registry (
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
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'dpp_subject_registry' AND column_name = 'product_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'dpp_subject_registry' AND column_name = 'internal_alias_id'
      ) THEN
        ALTER TABLE dpp_subject_registry RENAME COLUMN product_id TO internal_alias_id;
      END IF;
    END $$;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dpp_subject_registry_guid
      ON dpp_subject_registry("passportDppId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dpp_subject_registry_product
      ON dpp_subject_registry("companyId", "internalAliasId")
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dpp_registry_registrations (
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
    CREATE INDEX IF NOT EXISTS idx_dpp_registry_registrations_guid
      ON dpp_registry_registrations("passportDppId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dpp_registry_registrations_company
      ON dpp_registry_registrations("companyId", "registryName")
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backup_service_providers (
      id                        SERIAL PRIMARY KEY,
      company_id                INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      provider_key              VARCHAR(120) NOT NULL UNIQUE,
      provider_type             VARCHAR(60) NOT NULL DEFAULT 'oci_object_storage',
      display_name              VARCHAR(255) NOT NULL,
      object_prefix             TEXT NOT NULL DEFAULT 'backup-provider',
      public_base_url           TEXT,
      supports_public_handover  BOOLEAN NOT NULL DEFAULT true,
      config_json               JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active                 BOOLEAN NOT NULL DEFAULT true,
      is_backup_provider        BOOLEAN NOT NULL DEFAULT true,
      created_by                INTEGER,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_backup_service_providers_company
      ON backup_service_providers(company_id, is_active, provider_key)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_backup_replications (
      id                  SERIAL PRIMARY KEY,
      "backupProviderId"  INTEGER REFERENCES backup_service_providers(id) ON DELETE SET NULL,
      "backupProviderKey" VARCHAR(120) NOT NULL,
      "passportDppId"     TEXT NOT NULL,
      "lineageId"         TEXT,
      "companyId"         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      "passportType"      VARCHAR(100),
      "versionNumber"     INTEGER NOT NULL DEFAULT 1,
      "dppId"             TEXT,
      "snapshotScope"     VARCHAR(60) NOT NULL DEFAULT 'released_current',
      "replicationStatus" VARCHAR(40) NOT NULL DEFAULT 'pending',
      "storageProvider"   VARCHAR(60),
      "storageKey"        TEXT,
      "publicUrl"         TEXT,
      "payloadHash"       VARCHAR(64),
      "payloadJson"       JSONB NOT NULL DEFAULT '{}'::jsonb,
      "errorMessage"      TEXT,
      "verificationStatus" VARCHAR(40) NOT NULL DEFAULT 'pending',
      "verificationErrorMessage" TEXT,
      "verifiedPayloadHash" VARCHAR(64),
      "lastVerifiedAt"    TIMESTAMPTZ,
      "replicatedAt"      TIMESTAMPTZ,
      "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE ("backupProviderKey", "passportDppId", "versionNumber", "snapshotScope")
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_backup_replications_passport
      ON passport_backup_replications("companyId", "passportDppId", "versionNumber" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_backup_replications_status
      ON passport_backup_replications("replicationStatus", "updatedAt" DESC)
  `);
  await pool.query(`
    ALTER TABLE passport_backup_replications
    ADD COLUMN IF NOT EXISTS "verificationStatus" VARCHAR(40) NOT NULL DEFAULT 'pending'
  `);
  await pool.query(`
    ALTER TABLE passport_backup_replications
    ADD COLUMN IF NOT EXISTS "verificationErrorMessage" TEXT
  `);
  await pool.query(`
    ALTER TABLE passport_backup_replications
    ADD COLUMN IF NOT EXISTS "verifiedPayloadHash" VARCHAR(64)
  `);
  await pool.query(`
    ALTER TABLE passport_backup_replications
    ADD COLUMN IF NOT EXISTS "lastVerifiedAt" TIMESTAMPTZ
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_registry (
      "dppId"                     TEXT        PRIMARY KEY,
      "lineageId"                 TEXT        NOT NULL,
      "companyId"                 INTEGER     NOT NULL,
      "passportType"              VARCHAR(50) NOT NULL,
      "accessKey"                 VARCHAR(255),
      "accessKeyHash"             VARCHAR(64),
      "accessKeyPrefix"           VARCHAR(24),
      "accessKeyLastRotatedAt"    TIMESTAMPTZ,
      "deviceApiKey"              VARCHAR(255),
      "deviceApiKeyHash"          VARCHAR(64),
      "deviceApiKeyPrefix"        VARCHAR(24),
      "deviceKeyLastRotatedAt"    TIMESTAMPTZ,
      "createdAt"                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_registry_company
      ON passport_registry("companyId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_registry_lineage
      ON passport_registry("lineageId")
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
    CREATE TABLE IF NOT EXISTS backup_public_handovers (
      id                    SERIAL PRIMARY KEY,
      "companyId"            INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      "passportDppId"        TEXT NOT NULL REFERENCES passport_registry("dppId") ON DELETE CASCADE,
      "lineageId"            TEXT,
      "passportType"         VARCHAR(100) NOT NULL,
      "internalAliasId"      TEXT NOT NULL,
      "versionNumber"        INTEGER NOT NULL DEFAULT 1,
      "backupProviderId"     INTEGER REFERENCES backup_service_providers(id) ON DELETE SET NULL,
      "backupProviderKey"    VARCHAR(100) NOT NULL,
      "sourceReplicationId"  INTEGER REFERENCES passport_backup_replications(id) ON DELETE SET NULL,
      "storageKey"           TEXT,
      "publicUrl"            TEXT,
      "publicCompanyName"    TEXT,
      "publicRowData"        JSONB NOT NULL DEFAULT '{}'::jsonb,
      "handoverStatus"       VARCHAR(32) NOT NULL DEFAULT 'active',
      "verificationStatus"   VARCHAR(32) NOT NULL DEFAULT 'verified',
      notes                 TEXT,
      "activatedBy"         INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "deactivatedBy"       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "activatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "deactivatedAt"       TIMESTAMPTZ,
      "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'backup_public_handovers' AND column_name = 'product_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'backup_public_handovers' AND column_name = 'internal_alias_id'
      ) THEN
        ALTER TABLE backup_public_handovers RENAME COLUMN product_id TO internal_alias_id;
      END IF;
    END $$;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_backup_public_handovers_company
      ON backup_public_handovers("companyId", "activatedAt" DESC, id DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_backup_public_handovers_product
      ON backup_public_handovers("internalAliasId", "handoverStatus", "activatedAt" DESC, id DESC)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_public_handovers_active_passport
      ON backup_public_handovers("passportDppId")
      WHERE "handoverStatus" = 'active'
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "otpCodeHash" TEXT
  `);
  await runMigration(pool, "2026-04-27.backfill-otp-code-hash", async (db) => {
    const otpRows = await db.query(`
      SELECT id, "otpCode"
      FROM users
      WHERE "otpCode" IS NOT NULL
        AND COALESCE(TRIM("otpCodeHash"), '') = ''
    `);
    for (const row of otpRows.rows) {
      const rawOtp = String(row.otpCode || "").trim();
      if (!rawOtp) continue;
      const otpHash = /^[a-f0-9]{64}$/i.test(rawOtp)
        ? rawOtp.toLowerCase()
        : require("crypto").createHash("sha256").update(rawOtp).digest("hex");
      await db.query(
        `UPDATE users
         SET "otpCodeHash" = $1,
             "updatedAt" = NOW()
         WHERE id = $2`,
        [otpHash, row.id]
      );
    }
  });

  /* Add missing columns to existing users table (for migrations) */
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 1
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "pepperVersion" INTEGER NOT NULL DEFAULT 1
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone VARCHAR(50)
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "jobTitle" VARCHAR(120)
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS bio TEXT
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "preferredLanguage" VARCHAR(12) DEFAULT 'en'
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "defaultReviewerId" INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "defaultApproverId" INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "authSource" VARCHAR(100) NOT NULL DEFAULT 'local'
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "ssoOnly" BOOLEAN NOT NULL DEFAULT false
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_identities (
      id               SERIAL PRIMARY KEY,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider_key     VARCHAR(100) NOT NULL,
      provider_subject VARCHAR(255) NOT NULL,
      email            VARCHAR(255),
      raw_profile      JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at    TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identities_provider_subject
      ON user_identities(provider_key, provider_subject)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_identities_user
      ON user_identities(user_id)
  `);

  await runMigration(pool, "2026-05-08.rename-umbrella-to-product", async (db) => {
    // Rename columns in passport_types if they exist
    await db.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='passport_types' AND column_name='umbrella_category') THEN
          ALTER TABLE passport_types RENAME COLUMN umbrella_category TO product_category;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='passport_types' AND column_name='umbrella_icon') THEN
          ALTER TABLE passport_types RENAME COLUMN umbrella_icon TO product_icon;
        END IF;
      END $$;
    `);

    // Rename table umbrella_categories to product_categories if it exists
    await db.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='umbrella_categories') THEN
          ALTER TABLE umbrella_categories RENAME TO product_categories;
        END IF;
      END $$;
    `);

    // Rename index if it exists
    await db.query(`
      ALTER INDEX IF EXISTS idx_passport_types_umbrella RENAME TO idx_passport_types_product_category;
    `);
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_types (
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
    UPDATE passport_types
    SET "fieldsJson" = jsonb_set(
      CASE
        WHEN jsonb_typeof("fieldsJson") = 'object' THEN "fieldsJson"
        ELSE '{"sections":[]}'::jsonb
      END,
      '{schemaVersion}',
      COALESCE("fieldsJson"->'schemaVersion', '1'::jsonb),
      true
    )
    WHERE "fieldsJson"->'schemaVersion' IS NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_type_schema_events (
      id                SERIAL PRIMARY KEY,
      "passportTypeId"  INTEGER REFERENCES passport_types(id) ON DELETE SET NULL,
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
    CREATE INDEX IF NOT EXISTS idx_passport_type_schema_events_type
      ON passport_type_schema_events("typeName", "createdAt" DESC)
  `);
  await pool.query(
    `UPDATE passport_types
       SET "semanticModelKey" = $1
     WHERE COALESCE("productCategory", '') ~* 'battery'
       AND "semanticModelKey" IS DISTINCT FROM $1`,
    [BATTERY_DICTIONARY_MODEL_KEY]
  );
  await pool.query(`
    ALTER TABLE passport_types
    DROP CONSTRAINT IF EXISTS passport_types_battery_semantic_model_key_ck
  `);
  await pool.query(`
    ALTER TABLE passport_types
    ADD CONSTRAINT passport_types_battery_semantic_model_key_ck
    CHECK (
      "productCategory" IS NULL
      OR lower("productCategory") NOT LIKE '%battery%'
      OR "semanticModelKey" = '${BATTERY_DICTIONARY_MODEL_KEY}'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action           VARCHAR(100) NOT NULL,
      table_name       VARCHAR(100),
      record_id        VARCHAR(100),
      actor_identifier TEXT,
      audience         VARCHAR(80),
      old_values       JSONB,
      new_values       JSONB,
      previous_event_hash VARCHAR(64),
      event_hash       VARCHAR(64),
      hash_version     SMALLINT NOT NULL DEFAULT 2,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS actor_identifier TEXT
  `);
  await pool.query(`
    ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS audience VARCHAR(80)
  `);
  await pool.query(`
    ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS previous_event_hash VARCHAR(64)
  `);
  await pool.query(`
    ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS event_hash VARCHAR(64)
  `);
  await pool.query(`
    ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS hash_version SMALLINT NOT NULL DEFAULT 2
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created
      ON audit_logs(company_id, created_at DESC, id DESC)
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'audit_logs_company_id_fkey'
      ) THEN
        ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_company_id_fkey;
      END IF;
      ALTER TABLE audit_logs
        ADD CONSTRAINT audit_logs_company_id_fkey
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
    END $$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log_anchors (
      id                   SERIAL PRIMARY KEY,
      company_id           INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      log_count            INTEGER NOT NULL DEFAULT 0,
      first_log_id         INTEGER,
      latest_log_id        INTEGER,
      root_event_hash      VARCHAR(64),
      previous_anchor_hash VARCHAR(64),
      anchor_hash          VARCHAR(64) NOT NULL,
      anchor_type          VARCHAR(80) NOT NULL DEFAULT 'internal_record',
      anchor_reference     TEXT,
      notes                TEXT,
      metadata_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
      anchored_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
      anchored_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_anchors_hash
      ON audit_log_anchors(anchor_hash)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_anchors_company_anchored
      ON audit_log_anchors(company_id, anchored_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE OR REPLACE FUNCTION reject_append_only_mutation()
    RETURNS trigger
    AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only; % operations are not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '55000';
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    DROP TRIGGER IF EXISTS trg_audit_logs_reject_mutation ON audit_logs
  `);
  await pool.query(`
    CREATE TRIGGER trg_audit_logs_reject_mutation
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION reject_append_only_mutation()
  `);
  await pool.query(`
    DROP TRIGGER IF EXISTS trg_audit_log_anchors_reject_mutation ON audit_log_anchors
  `);
  await pool.query(`
    CREATE TRIGGER trg_audit_log_anchors_reject_mutation
    BEFORE UPDATE OR DELETE ON audit_log_anchors
    FOR EACH ROW
    EXECUTE FUNCTION reject_append_only_mutation()
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invite_tokens (
      id               SERIAL PRIMARY KEY,
      token            VARCHAR(36) NOT NULL UNIQUE,
      email            VARCHAR(255) NOT NULL,
      company_id       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      invited_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      role_to_assign   VARCHAR(50) NOT NULL DEFAULT 'editor',
      used             BOOLEAN NOT NULL DEFAULT false,
      expires_at       TIMESTAMPTZ NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE passport_registry
    ADD COLUMN IF NOT EXISTS "lineageId" TEXT
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET "lineageId" = "dppId"
    WHERE "lineageId" IS NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_registry_company
      ON passport_registry("companyId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_registry_lineage
      ON passport_registry("lineageId")
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_identifier_lineage (
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
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_identifier_lineage' AND column_name = 'previous_local_product_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_identifier_lineage' AND column_name = 'previous_internal_alias_id'
      ) THEN
        ALTER TABLE product_identifier_lineage RENAME COLUMN previous_local_product_id TO previous_internal_alias_id;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_identifier_lineage' AND column_name = 'replacement_local_product_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_identifier_lineage' AND column_name = 'replacement_internal_alias_id'
      ) THEN
        ALTER TABLE product_identifier_lineage RENAME COLUMN replacement_local_product_id TO replacement_internal_alias_id;
      END IF;
    END $$;
  `);
  await pool.query(`

    CREATE INDEX IF NOT EXISTS idx_product_identifier_lineage_company
      ON product_identifier_lineage("companyId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_product_identifier_lineage_lineage
      ON product_identifier_lineage("lineageId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_product_identifier_lineage_previous_identifier
      ON product_identifier_lineage("previousIdentifier")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_product_identifier_lineage_replacement_identifier
      ON product_identifier_lineage("replacementIdentifier")
  `);
  await pool.query(`
    ALTER TABLE passport_registry
    ADD COLUMN IF NOT EXISTS "accessKeyHash" VARCHAR(64)
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE passport_registry
    ADD COLUMN IF NOT EXISTS "accessKeyPrefix" VARCHAR(24)
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE passport_registry
    ADD COLUMN IF NOT EXISTS "accessKeyLastRotatedAt" TIMESTAMPTZ
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE passport_registry
    ADD COLUMN IF NOT EXISTS "deviceApiKeyHash" VARCHAR(64)
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE passport_registry
    ADD COLUMN IF NOT EXISTS "deviceApiKeyPrefix" VARCHAR(24)
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE passport_registry
    ADD COLUMN IF NOT EXISTS "deviceKeyLastRotatedAt" TIMESTAMPTZ
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE passport_registry
    ALTER COLUMN access_key DROP NOT NULL
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE passport_registry
    ALTER COLUMN device_api_key DROP NOT NULL
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE passport_registry
    ALTER COLUMN access_key DROP DEFAULT
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE passport_registry
    ALTER COLUMN device_api_key DROP DEFAULT
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_passport_types_product_category ON passport_types("productCategory")');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_passport_types_active ON passport_types("isActive")');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_passport_access (
      id               SERIAL PRIMARY KEY,
      company_id       INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      passport_type_id INT NOT NULL REFERENCES passport_types(id) ON DELETE CASCADE,
      access_revoked   BOOLEAN NOT NULL DEFAULT FALSE,
      granted_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, passport_type_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cpa_company ON company_passport_access(company_id)`);

  // Product categories — standalone managed table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_categories (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL UNIQUE,
      icon       VARCHAR(10)  NOT NULL DEFAULT '📋',
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  // Seed from existing passport_types so nothing is orphaned
  await pool.query(`
    INSERT INTO product_categories (name, icon)
    SELECT DISTINCT "productCategory", COALESCE("productIcon", '📋')
    FROM passport_types
    WHERE "productCategory" IS NOT NULL
    ON CONFLICT (name) DO NOTHING
  `);

  // Company file repository
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_repository (
      id         SERIAL PRIMARY KEY,
      company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      parent_id  INT REFERENCES company_repository(id) ON DELETE CASCADE,
      name       VARCHAR(255) NOT NULL,
      type       VARCHAR(10)  NOT NULL DEFAULT 'file',
      file_path  TEXT,
      storage_key TEXT,
      storage_provider VARCHAR(50),
      file_url   TEXT,
      mime_type  VARCHAR(100),
      size_bytes BIGINT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_facilities (
      id                  SERIAL PRIMARY KEY,
      company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      facility_identifier TEXT NOT NULL,
      identifier_scheme   VARCHAR(80) NOT NULL,
      display_name        VARCHAR(255),
      metadata_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active           BOOLEAN NOT NULL DEFAULT true,
      created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, identifier_scheme, facility_identifier)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_company_facilities_company
      ON company_facilities(company_id, is_active, updated_at DESC)
  `);
  await pool.query(`
    ALTER TABLE company_repository
    ADD COLUMN IF NOT EXISTS storage_key TEXT
  `);
  await pool.query(`
    ALTER TABLE company_repository
    ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(50)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_repo_company_parent
      ON company_repository(company_id, parent_id)
  `);
  await pool.query(`
    ALTER TABLE company_repository
    ADD COLUMN IF NOT EXISTS repository_scope VARCHAR(20) NOT NULL DEFAULT 'files'
  `);
  await pool.query(`
    UPDATE company_repository
    SET repository_scope = CASE
      WHEN mime_type LIKE 'image/%' THEN 'symbols'
      ELSE 'files'
    END
    WHERE repository_scope IS NULL OR repository_scope = ''
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_repo_company_scope_parent
      ON company_repository(company_id, repository_scope, parent_id)
  `);

  // Global symbol repository (super-admin managed, visible to all users)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS symbols (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL,
      category   VARCHAR(50)  NOT NULL DEFAULT 'General',
      storage_key TEXT,
      storage_provider VARCHAR(50),
      file_url   TEXT         NOT NULL,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      is_active  BOOLEAN      NOT NULL DEFAULT true
    )
  `);
  await pool.query(`
    ALTER TABLE symbols
    ADD COLUMN IF NOT EXISTS storage_key TEXT
  `);
  await pool.query(`
    ALTER TABLE symbols
    ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(50)
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_symbols_category ON symbols(category)`);

  // Private API keys (company-scoped, for programmatic read access via /api/v1/)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id           SERIAL PRIMARY KEY,
      company_id   INT          NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name         VARCHAR(100) NOT NULL,
      key_hash     VARCHAR(64)  NOT NULL UNIQUE,
      key_prefix   VARCHAR(16)  NOT NULL,
      key_salt     VARCHAR(64),
      hash_algorithm VARCHAR(32) NOT NULL DEFAULT 'hmac_sha256',
      scopes       TEXT[]       NOT NULL DEFAULT ARRAY['dpp:read']::text[],
      operator_type VARCHAR(80) NOT NULL DEFAULT 'economic_operator',
      access_mode  VARCHAR(16) NOT NULL DEFAULT 'read',
      max_confidentiality VARCHAR(32) NOT NULL DEFAULT 'regulated',
      expires_at   TIMESTAMPTZ,
      created_by   INT REFERENCES users(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      is_active    BOOLEAN      NOT NULL DEFAULT true
    )
  `);
  await pool.query(`
    ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS key_prefix VARCHAR(16)
  `);
  await pool.query(`
    ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT ARRAY['dpp:read']::text[]
  `);
  await pool.query(`
    ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS key_salt VARCHAR(64)
  `);
  await pool.query(`
    ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS hash_algorithm VARCHAR(32) NOT NULL DEFAULT 'hmac_sha256'
  `);
  await pool.query(`
    ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS operator_type VARCHAR(80) NOT NULL DEFAULT 'economic_operator'
  `);
  await pool.query(`
    ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS access_mode VARCHAR(16) NOT NULL DEFAULT 'read'
  `);
  await pool.query(`
    ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS max_confidentiality VARCHAR(32) NOT NULL DEFAULT 'regulated'
  `);
  
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_company ON api_keys(company_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash    ON api_keys(key_hash)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_prefix   ON api_keys(key_prefix)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_access_audiences (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      audience    VARCHAR(80) NOT NULL,
      granted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reason      TEXT,
      expires_at  TIMESTAMPTZ,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, company_id, audience)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_access_audiences_user
      ON user_access_audiences(user_id, company_id, audience)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_access_grants (
      id               SERIAL PRIMARY KEY,
      "passportDppId"  TEXT NOT NULL REFERENCES passport_registry("dppId") ON DELETE CASCADE,
      "companyId"      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      audience         VARCHAR(80) NOT NULL,
      "elementIdPath"  TEXT,
      "granteeUserId"  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "grantedBy"      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reason           TEXT,
      "expiresAt"      TIMESTAMPTZ,
      "isActive"       BOOLEAN NOT NULL DEFAULT true,
      "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE ("passportDppId", audience, "granteeUserId", "elementIdPath")
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_access_grants_passport
      ON passport_access_grants("passportDppId", audience, "granteeUserId")
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS request_rate_limits (
      bucket_key VARCHAR(255) PRIMARY KEY,
      count      INTEGER NOT NULL DEFAULT 0,
      reset_at   TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_request_rate_limits_reset_at
      ON request_rate_limits(reset_at)
  `);
  await pool.query(`
    DELETE FROM request_rate_limits
    WHERE reset_at <= NOW()
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_scan_events (
      id             SERIAL PRIMARY KEY,
      "passportDppId" TEXT NOT NULL REFERENCES passport_registry("dppId") ON DELETE CASCADE,
      "viewerUserId" INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "userAgent"    TEXT,
      referrer       TEXT,
      "scannedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE passport_scan_events
    ADD COLUMN IF NOT EXISTS "viewerUserId" INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_scan_events_passport
      ON passport_scan_events("passportDppId", "scannedAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_scan_events_viewer
      ON passport_scan_events("viewerUserId")
      WHERE "viewerUserId" IS NOT NULL
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_passport_scan_events_unique_viewer
      ON passport_scan_events("passportDppId", "viewerUserId")
      WHERE "viewerUserId" IS NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_security_events (
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
    CREATE INDEX IF NOT EXISTS idx_passport_security_events_passport
      ON passport_security_events("passportDppId", "createdAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_security_events_company
      ON passport_security_events("companyId", "createdAt" DESC)
  `);

  // Company-managed branding for public passport viewer and consumer pages
  await pool.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS company_logo TEXT
  `);
  await pool.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS introduction_text TEXT
  `);
  await pool.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS branding_json JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  // Dynamic field values — time-series: every push appends a new row, nothing is ever overwritten
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_dynamic_values (
      id            SERIAL       PRIMARY KEY,
      "passportDppId" TEXT         NOT NULL,
      "fieldKey"    VARCHAR(100) NOT NULL,
      value         TEXT,
      "updatedAt"   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dv_passport ON passport_dynamic_values("passportDppId")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dv_passport_field
      ON passport_dynamic_values("passportDppId", "fieldKey", "updatedAt" DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_management_jobs (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      passport_type    VARCHAR(100) NOT NULL,
      name             VARCHAR(255) NOT NULL,
      source_kind      VARCHAR(40) NOT NULL DEFAULT 'manual',
      source_config    JSONB NOT NULL DEFAULT '{}'::jsonb,
      records_json     JSONB NOT NULL DEFAULT '[]'::jsonb,
      options_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active        BOOLEAN NOT NULL DEFAULT true,
      start_at         TIMESTAMPTZ,
      interval_minutes INTEGER,
      next_run_at      TIMESTAMPTZ,
      last_run_at      TIMESTAMPTZ,
      last_status      VARCHAR(30),
      last_summary     JSONB,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_asset_jobs_company
      ON asset_management_jobs(company_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_asset_jobs_due
      ON asset_management_jobs(next_run_at)
      WHERE is_active = true
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_management_runs (
      id             SERIAL PRIMARY KEY,
      job_id         INTEGER REFERENCES asset_management_jobs(id) ON DELETE SET NULL,
      company_id     INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      passport_type  VARCHAR(100),
      trigger_type   VARCHAR(40) NOT NULL,
      source_kind    VARCHAR(40),
      status         VARCHAR(30) NOT NULL,
      summary_json   JSONB,
      request_json   JSONB,
      generated_json JSONB,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_asset_runs_company
      ON asset_management_runs(company_id, created_at DESC)
  `);
  // Digital signatures — one row per released passport version
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_signatures (
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
    CREATE TABLE IF NOT EXISTS dpp_release_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "dppId" TEXT NOT NULL REFERENCES passport_registry("dppId") ON DELETE CASCADE,
      companyname TEXT NOT NULL,
      "releasedByUserId" INTEGER NOT NULL REFERENCES users(id),
      "releasedByEmail" TEXT NOT NULL,
      "releaseVersion" INTEGER NOT NULL,
      "dppHash" TEXT NOT NULL,
      "signatureId" INTEGER REFERENCES passport_signatures(id) ON DELETE SET NULL,
      "releaseNote" TEXT,
      "releasedAt" TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE ("dppId", "releaseVersion")
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dpp_release_records_dpp
      ON dpp_release_records("dppId", "releaseVersion" DESC)
  `);
  // Store public keys so verifiers can always look them up by key ID
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_signing_keys (
      key_id     VARCHAR(64) PRIMARY KEY,
      public_key TEXT        NOT NULL,
      algorithm  VARCHAR(50) NOT NULL DEFAULT 'ES256',
      algorithm_version VARCHAR(20) NOT NULL DEFAULT 'ES256',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE passport_signing_keys
    ADD COLUMN IF NOT EXISTS algorithm_version VARCHAR(20) NOT NULL DEFAULT 'ES256'
  `);

  // One in-progress draft per super-admin user
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_type_drafts (
      id          SERIAL      PRIMARY KEY,
      user_id     INTEGER     NOT NULL UNIQUE,
      draft_json  JSONB       NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_edit_sessions (
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
    CREATE INDEX IF NOT EXISTS idx_passport_edit_sessions_passport
      ON passport_edit_sessions("passportDppId", "lastActivityAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_edit_sessions_user
      ON passport_edit_sessions("userId")
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
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created
      ON notifications("userId", "createdAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notifications_read
      ON notifications("userId", read)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_workflow (
      id                      SERIAL PRIMARY KEY,
      "passportDppId"         TEXT NOT NULL,
      "passportType"          VARCHAR(100) NOT NULL,
      "companyId"             INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      "submittedBy"           INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "reviewerId"            INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "approverId"            INTEGER REFERENCES users(id) ON DELETE SET NULL,
      "reviewStatus"          VARCHAR(30) NOT NULL DEFAULT 'pending',
      "approvalStatus"        VARCHAR(30) NOT NULL DEFAULT 'pending',
      "overallStatus"         VARCHAR(30) NOT NULL DEFAULT 'in_progress',
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
    CREATE INDEX IF NOT EXISTS idx_passport_workflow_company_status
      ON passport_workflow("companyId", "overallStatus", "createdAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_workflow_passport_created
      ON passport_workflow("passportDppId", "createdAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_workflow_reviewer_pending
      ON passport_workflow("reviewerId", "reviewStatus", "createdAt" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_workflow_approver_pending
      ON passport_workflow("approverId", "approvalStatus", "createdAt" DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_revision_batches (
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
    CREATE INDEX IF NOT EXISTS idx_revision_batches_company_created
      ON passport_revision_batches("companyId", "createdAt" DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_revision_batch_items (
      id                    SERIAL PRIMARY KEY,
      "batchId"             INTEGER NOT NULL REFERENCES passport_revision_batches(id) ON DELETE CASCADE,
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
    CREATE INDEX IF NOT EXISTS idx_revision_batch_items_batch
      ON passport_revision_batch_items("batchId", "createdAt" DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_history_visibility (
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
    CREATE INDEX IF NOT EXISTS idx_passport_history_visibility_guid
      ON passport_history_visibility("passportDppId", "versionNumber" DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_archives (
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
  await pool.query(`
    ALTER TABLE passport_archives
    ADD COLUMN IF NOT EXISTS "lineageId" TEXT
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'passport_archives' AND column_name = 'product_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'passport_archives' AND column_name = 'internal_alias_id'
      ) THEN
        ALTER TABLE passport_archives RENAME COLUMN product_id TO internal_alias_id;
      END IF;
    END $$;
  `);
  await pool.query(`
    ALTER TABLE passport_archives
    ADD COLUMN IF NOT EXISTS "productIdentifierDid" TEXT
  `);
  await pool.query(`
    ALTER TABLE passport_archives
    ADD COLUMN IF NOT EXISTS actor_identifier TEXT
  `);
  await pool.query(`
    ALTER TABLE passport_archives
    ADD COLUMN IF NOT EXISTS snapshot_reason VARCHAR(100)
  `);
  await pool.query(`
    UPDATE passport_archives
    SET "lineageId" = "dppId"
    WHERE "lineageId" IS NULL
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_archives_company ON passport_archives("companyId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_archives_guid    ON passport_archives("dppId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_archives_lineage ON passport_archives("lineageId")`);

  // Ensure shared passport tables exist for all passport types.
  // Idempotent — uses CREATE TABLE IF NOT EXISTS.
  const ptRows = await pool.query('SELECT "typeName" AS "typeName" FROM passport_types');
  for (const { typeName } of ptRows.rows) {
    await createPassportTable(typeName).catch(e =>
      logger.warn({ err: e }, `Could not create table for ${typeName}`)
    );
  }

  for (const { typeName } of ptRows.rows) {
    const tableName = getTable(typeName);
    try {
      const legacyAliasColumn = await pool.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_name = $1
           AND column_name = 'product_id'`,
        [tableName]
      );
      const currentAliasColumn = await pool.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_name = $1
           AND column_name = 'internal_alias_id'`,
        [tableName]
      );
      if (legacyAliasColumn.rows.length && !currentAliasColumn.rows.length) {
        await pool.query(`ALTER TABLE ${tableName} RENAME COLUMN product_id TO internal_alias_id`);
      }
      await pool.query(`
        ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS "lineageId" TEXT
      `);
      await pool.query(`
        UPDATE ${tableName}
        SET "lineageId" = "dppId"
        WHERE "lineageId" IS NULL
      `);
      await pool.query(`
        ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS granularity VARCHAR(20) NOT NULL DEFAULT 'model'
      `);
      await pool.query(`
        ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS "uniqueProductIdentifier" TEXT
      `);
      await pool.query(`
        ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS compliance_profile_key VARCHAR(120) NOT NULL DEFAULT 'generic_dpp_v1'
      `);
      await pool.query(`
        ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS content_specification_ids TEXT
      `);
      await pool.query(`
        ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS carrier_policy_key VARCHAR(120)
      `);
      await pool.query(`
        ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS carrier_authenticity JSONB
      `);
      await pool.query(`
        ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS economic_operator_id TEXT
      `);
      await pool.query(`
        ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS economic_operator_identifier_scheme VARCHAR(80)
      `);
      await pool.query(`
        ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS facility_id TEXT
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${tableName}_product_identifier_did
          ON ${tableName}("companyId", "uniqueProductIdentifier")
          WHERE "deletedAt" IS NULL
      `);

      if (productIdentifierService) {
        await runMigration(pool, `2026-04-27.backfill-product-identifier-did.${typeName}`, async (db) => {
          const liveRows = await db.query(
            `SELECT id, "companyId", "internalAliasId", granularity
             FROM ${tableName}
             WHERE "deletedAt" IS NULL
               AND COALESCE(TRIM("internalAliasId"), '') <> ''
               AND COALESCE(TRIM("uniqueProductIdentifier"), '') = ''`
          );
          for (const row of liveRows.rows) {
            const canonicalDid = productIdentifierService.buildCanonicalProductDid({
              companyId: row.companyId,
              passportType: typeName,
              rawProductId: row.internalAliasId,
              granularity: row.granularity || "item",
            });
            if (!canonicalDid) continue;
            await db.query(
              `UPDATE ${tableName}
               SET "uniqueProductIdentifier" = $1
               WHERE id = $2`,
              [canonicalDid, row.id]
            );
          }

          const archiveRows = await db.query(
            `SELECT id, "companyId", "internalAliasId", "rowData"
             FROM passport_archives
             WHERE "passportType" = $1
               AND COALESCE(TRIM("internalAliasId"), '') <> ''
               AND COALESCE(TRIM("productIdentifierDid"), '') = ''`,
            [typeName]
          );
          for (const row of archiveRows.rows) {
            const rowData = typeof row.rowData === "string" ? JSON.parse(row.rowData) : row.rowData;
            const canonicalDid = productIdentifierService.buildCanonicalProductDid({
              companyId: row.companyId,
              passportType: typeName,
              rawProductId: row.internalAliasId,
              granularity: rowData?.granularity || "item",
            });
            if (!canonicalDid) continue;
            await db.query(
              `UPDATE passport_archives
               SET "productIdentifierDid" = $1
               WHERE id = $2`,
              [canonicalDid, row.id]
            );
          }
        });
      }
    } catch (e) {
      logger.warn({ err: e }, `Could not normalize revision status for ${typeName}`);
    }
  }

  await runMigration(pool, "2026-04-28.textual-dpp-record-ids", async (db) => {
    const constrainedTables = [
      ["passport_access_grants", "passport_access_grants_passport_dpp_id_fkey"],
      ["passport_scan_events", "passport_scan_events_passport_dpp_id_fkey"],
      ["passport_security_events", "passport_security_events_passport_dpp_id_fkey"],
      ["passport_backup_replications", "passport_backup_replications_passport_dpp_id_fkey"],
      ["backup_public_handovers", "backup_public_handovers_passport_dpp_id_fkey"],
      ["passport_dynamic_values", "passport_dynamic_values_passport_dpp_id_fkey"],
      ["passport_attachments", "passport_attachments_passport_dpp_id_fkey"],
    ];
    for (const [tableName, constraintName] of constrainedTables) {
      // Check if table exists before trying to alter it
      const tableExists = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
        [tableName]
      ).catch(() => ({ rows: [] }));
      
      if (tableExists.rows.length > 0) {
        await db.query(
          `ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${constraintName}`
        ).catch(() => {});
      }
    }

    const sharedTables = [
      ["dpp_registry_registrations", ["passport_dpp_id"]],
      ["passport_backup_replications", ["passport_dpp_id", "lineage_id"]],
      ["backup_public_handovers", ["passport_dpp_id", "lineage_id"]],
      ["passport_registry", ["dpp_id", "lineage_id"]],
      ["passport_access_grants", ["passport_dpp_id"]],
      ["passport_scan_events", ["passport_dpp_id"]],
      ["passport_security_events", ["passport_dpp_id"]],
      ["passport_dynamic_values", ["passport_dpp_id"]],
      ["passport_signatures", ["passport_dpp_id"]],
      ["passport_edit_sessions", ["passport_dpp_id"]],
      ["notifications", ["passport_dpp_id"]],
      ["passport_revision_batch_items", ["passport_dpp_id"]],
      ["passport_history_visibility", ["passport_dpp_id"]],
      ["passport_archives", ["dpp_id", "lineage_id"]],
      ["passport_attachments", ["passport_dpp_id"]],
    ];

    for (const [tableName, columns] of sharedTables) {
      // Check if table exists before trying to alter it
      const tableExists = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
        [tableName]
      ).catch(() => ({ rows: [] }));
      
      if (tableExists.rows.length > 0) {
        for (const columnName of columns) {
          await db.query(
            `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} DROP DEFAULT`
          ).catch(() => {});
          await db.query(
            `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} TYPE TEXT USING ${columnName}::text`
          ).catch(() => {});
        }
      }
    }

    const typedPassportRows = await db.query('SELECT "typeName" AS "typeName" FROM passport_types').catch(() => ({ rows: [] }));
    for (const { typeName } of typedPassportRows.rows) {
      const tableName = getTable(typeName);
      // Check if table exists before altering it
      const tableExists = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
        [tableName]
      ).catch(() => ({ rows: [] }));
      
      if (tableExists.rows.length > 0) {
        for (const columnName of ["dpp_id", "lineage_id"]) {
          await db.query(
            `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} DROP DEFAULT`
          ).catch(() => {});
          await db.query(
            `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} TYPE TEXT USING ${columnName}::text`
          ).catch(() => {});
        }
      }
    }

    await db.query(`
      UPDATE passport_registry
      SET lineage_id = dpp_id
      WHERE lineage_id IS NULL OR TRIM(lineage_id) = ''
    `);
    await db.query(`
      UPDATE passport_archives
      SET lineage_id = dpp_id
      WHERE lineage_id IS NULL OR TRIM(lineage_id) = ''
    `);
  });

  // ── Templates tables ─────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_templates (
      id            SERIAL PRIMARY KEY,
      company_id    INTEGER NOT NULL,
      passport_type VARCHAR(100) NOT NULL,
      name          VARCHAR(200) NOT NULL,
      description   TEXT,
      created_by    INTEGER,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS passport_template_fields (
      id           SERIAL PRIMARY KEY,
      template_id  INTEGER NOT NULL REFERENCES passport_templates(id) ON DELETE CASCADE,
      field_key    VARCHAR(200) NOT NULL,
      field_value  TEXT,
      is_model_data BOOLEAN DEFAULT FALSE,
      UNIQUE(template_id, field_key)
    );
  `).catch(e => logger.error("Template table init error:", e.message));

  // ── Messaging tables ─────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL,
      last_read_at    TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (conversation_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id              SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id       INTEGER NOT NULL,
      body            TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(e => logger.error("Messaging table init error:", e.message));

  // ── Password reset tokens ─────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      VARCHAR(128) NOT NULL UNIQUE,
      used       BOOLEAN NOT NULL DEFAULT false,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(e => logger.error("password_reset_tokens init error:", e.message));
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id)
  `).catch(() => {});

  // ── Passport secret hardening ──────────────────────────────────────────────
  await pool.query(`
    UPDATE passport_registry
    SET "accessKeyHash" = encode(digest("accessKey", 'sha256'), 'hex')
    WHERE "accessKeyHash" IS NULL AND "accessKey" IS NOT NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET "accessKeyPrefix" = LEFT("accessKey", 12)
    WHERE "accessKeyPrefix" IS NULL AND "accessKey" IS NOT NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET "accessKeyLastRotatedAt" = COALESCE("accessKeyLastRotatedAt", "createdAt", NOW())
    WHERE "accessKeyHash" IS NOT NULL AND "accessKeyLastRotatedAt" IS NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET "deviceApiKeyHash" = encode(digest("deviceApiKey", 'sha256'), 'hex')
    WHERE "deviceApiKeyHash" IS NULL AND "deviceApiKey" IS NOT NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET "deviceApiKeyPrefix" = LEFT("deviceApiKey", 12)
    WHERE "deviceApiKeyPrefix" IS NULL AND "deviceApiKey" IS NOT NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET "deviceKeyLastRotatedAt" = COALESCE("deviceKeyLastRotatedAt", "createdAt", NOW())
    WHERE "deviceApiKeyHash" IS NOT NULL AND "deviceKeyLastRotatedAt" IS NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET "accessKey" = NULL
    WHERE "accessKey" IS NOT NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET "deviceApiKey" = NULL
    WHERE "deviceApiKey" IS NOT NULL
  `).catch(() => {});

  // ── Fix admin role access ────────────────────────────────────────────────
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "yashd810@gmail.com";
  await runMigration(pool, "2026-05-02.ensure-admin-super-role", async (db) => {
    const adminUser = await db.query(
      "SELECT id, email, role FROM users WHERE email = $1",
      [ADMIN_EMAIL]
    );
    
    if (adminUser.rows.length > 0) {
      const user = adminUser.rows[0];
      if (user.role !== "super_admin") {
        await db.query(
          "UPDATE users SET role = $1, updated_at = NOW() WHERE email = $2",
          ["super_admin", ADMIN_EMAIL]
        );
        logger.info(`[initDb] Promoted admin user (${ADMIN_EMAIL}) to super_admin role`);
      }
    } else {
      logger.info(`[initDb] Admin email user not found: ${ADMIN_EMAIL}. User must be created via registration first.`);
    }
  });

  // ── Passport attachments (opaque public IDs for app-mediated file serving) ─
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_attachments (
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
  `).catch(e => logger.error("passport_attachments init error:", e.message));
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_attachments_guid
      ON passport_attachments("passportDppId")
  `).catch(() => {});
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_attachments_company
      ON passport_attachments("companyId")
  `).catch(() => {});

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'passport_registry_company_id_fkey'
      ) THEN
        ALTER TABLE passport_registry
          ADD CONSTRAINT passport_registry_company_id_fkey
          FOREIGN KEY ("companyId") REFERENCES companies(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `).catch(() => {});
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'dpp_registry_registrations_registered_by_fkey'
      ) THEN
        ALTER TABLE dpp_registry_registrations
          ADD CONSTRAINT dpp_registry_registrations_registered_by_fkey
          FOREIGN KEY ("registeredBy") REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `).catch(() => {});
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'backup_service_providers_created_by_fkey'
      ) THEN
        ALTER TABLE backup_service_providers
          ADD CONSTRAINT backup_service_providers_created_by_fkey
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `).catch(() => {});

  const passportRegistryReferences = [
    ["dpp_subject_registry", "passportDppId", "dpp_subject_registry_passport_dpp_id_fkey", false],
    ["dpp_registry_registrations", "passportDppId", "dpp_registry_registrations_passport_dpp_id_fkey", false],
    ["passport_backup_replications", "passportDppId", "passport_backup_replications_passport_dpp_id_fkey", false],
    ["backup_public_handovers", "passportDppId", "backup_public_handovers_passport_dpp_id_fkey", false],
    ["passport_access_grants", "passportDppId", "passport_access_grants_passport_dpp_id_fkey", false],
    ["passport_scan_events", "passportDppId", "passport_scan_events_passport_dpp_id_fkey", false],
    ["passport_security_events", "passportDppId", "passport_security_events_passport_dpp_id_fkey", false],
    ["passport_dynamic_values", "passportDppId", "passport_dynamic_values_passport_dpp_id_fkey", false],
    ["passport_signatures", "passportDppId", "passport_signatures_passport_dpp_id_fkey", false],
    ["passport_edit_sessions", "passportDppId", "passport_edit_sessions_passport_dpp_id_fkey", false],
    ["notifications", "passportDppId", "notifications_passport_dpp_id_fkey", true],
    ["passport_revision_batch_items", "passportDppId", "passport_revision_batch_items_passport_dpp_id_fkey", false],
    ["passport_history_visibility", "passportDppId", "passport_history_visibility_passport_dpp_id_fkey", false],
    ["passport_attachments", "passportDppId", "passport_attachments_passport_dpp_id_fkey", false],
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
    await pool.query(`SELECT pg_advisory_unlock($1)`, [SCHEMA_MIGRATION_LOCK_KEY]).catch(() => {});
  }
}

module.exports = { initDb };
