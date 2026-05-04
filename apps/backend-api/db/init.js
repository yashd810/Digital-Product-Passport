"use strict";

const logger = require("../services/logger");
const BATTERY_DICTIONARY_MODEL_KEY = "claros_battery_dictionary_v1";

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
  columnName = "passport_dpp_id",
  constraintName,
  nullable = false,
  onDelete = "CASCADE",
}) {
  await pool.query(`
    DO $$
    DECLARE orphan_count INTEGER;
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${constraintName}'
      ) THEN
        SELECT COUNT(*) INTO orphan_count
        FROM ${tableName} child
        LEFT JOIN passport_registry parent ON parent.dpp_id = child.${columnName}
        WHERE child.${columnName} IS NOT NULL
          AND parent.dpp_id IS NULL;

        IF orphan_count > 0 THEN
          RAISE EXCEPTION 'Cannot add ${constraintName}: % orphan row(s) in ${tableName}.${columnName}', orphan_count;
        END IF;

        ALTER TABLE ${tableName}
          ADD CONSTRAINT ${constraintName}
          FOREIGN KEY (${columnName}) REFERENCES passport_registry(dpp_id) ON DELETE ${onDelete};
      END IF;
    END $$;
  `);

  if (!nullable) {
    await pool.query(`
      ALTER TABLE ${tableName}
      ALTER COLUMN ${columnName} SET NOT NULL
    `).catch(() => {});
  }
}

async function truncateTableIfExists(pool, tableName) {
  await pool.query(`TRUNCATE TABLE ${tableName} RESTART IDENTITY CASCADE`).catch(() => {});
}

/**
 * Database initialization — creates or alters all tables and indexes.
 * Extracted from server.js to keep startup logic separate from route handling.
 *
 * Usage:
 *   const { initDb } = require("./db/init");
 *   await initDb(pool, { getTable, createPassportTable, IN_REVISION_STATUS, LEGACY_IN_REVISION_STATUS });
 */

async function initDb(pool, {
  getTable,
  createPassportTable,
  IN_REVISION_STATUS,
  LEGACY_IN_REVISION_STATUS,
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
      is_active        BOOLEAN NOT NULL DEFAULT true,
      asset_management_enabled BOOLEAN NOT NULL DEFAULT false,
      asset_management_revoked_at TIMESTAMPTZ,
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
    ADD COLUMN IF NOT EXISTS dpp_granularity VARCHAR(20) NOT NULL DEFAULT 'model'
  `);
  await pool.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS granularity_locked BOOLEAN NOT NULL DEFAULT false
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
    INSERT INTO company_dpp_policies (
      company_id,
      default_granularity,
      allow_granularity_override
    )
    SELECT
      c.id,
      CASE
        WHEN c.dpp_granularity IN ('model', 'batch', 'item') THEN c.dpp_granularity
        ELSE 'item'
      END,
      COALESCE(c.granularity_locked, false) = false
    FROM companies c
    ON CONFLICT (company_id) DO NOTHING
  `);

  // DPP subject registry — tracks issued product/DPP DIDs per passport
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dpp_subject_registry (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      passport_dpp_id   TEXT NOT NULL,
      product_id      TEXT NOT NULL,
      product_identifier_did TEXT,
      granularity     VARCHAR(20) NOT NULL DEFAULT 'model',
      product_did     TEXT NOT NULL,
      dpp_did         TEXT NOT NULL,
      company_did     TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, product_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dpp_subject_registry_guid
      ON dpp_subject_registry(passport_dpp_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dpp_subject_registry_product
      ON dpp_subject_registry(company_id, product_id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dpp_registry_registrations (
      id SERIAL PRIMARY KEY,
      passport_dpp_id TEXT NOT NULL,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      product_identifier TEXT NOT NULL,
      dpp_id TEXT NOT NULL,
      registry_name VARCHAR(120) NOT NULL DEFAULT 'local',
      status VARCHAR(40) NOT NULL DEFAULT 'registered',
      registration_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      registered_by INTEGER,
      registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (registry_name, dpp_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dpp_registry_registrations_guid
      ON dpp_registry_registrations(passport_dpp_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dpp_registry_registrations_company
      ON dpp_registry_registrations(company_id, registry_name)
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
      backup_provider_id  INTEGER REFERENCES backup_service_providers(id) ON DELETE SET NULL,
      backup_provider_key VARCHAR(120) NOT NULL,
      passport_dpp_id       TEXT NOT NULL,
      lineage_id          TEXT,
      company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      passport_type       VARCHAR(100),
      version_number      INTEGER NOT NULL DEFAULT 1,
      dpp_id              TEXT,
      snapshot_scope      VARCHAR(60) NOT NULL DEFAULT 'released_current',
      replication_status  VARCHAR(40) NOT NULL DEFAULT 'pending',
      storage_provider    VARCHAR(60),
      storage_key         TEXT,
      public_url          TEXT,
      payload_hash        VARCHAR(64),
      payload_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_message       TEXT,
      replicated_at       TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (backup_provider_key, passport_dpp_id, version_number, snapshot_scope)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_backup_replications_passport
      ON passport_backup_replications(company_id, passport_dpp_id, version_number DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_backup_replications_status
      ON passport_backup_replications(replication_status, updated_at DESC)
  `);
  await pool.query(`
    ALTER TABLE passport_backup_replications
    ADD COLUMN IF NOT EXISTS verification_status VARCHAR(40) NOT NULL DEFAULT 'pending'
  `);
  await pool.query(`
    ALTER TABLE passport_backup_replications
    ADD COLUMN IF NOT EXISTS verification_error_message TEXT
  `);
  await pool.query(`
    ALTER TABLE passport_backup_replications
    ADD COLUMN IF NOT EXISTS verified_payload_hash VARCHAR(64)
  `);
  await pool.query(`
    ALTER TABLE passport_backup_replications
    ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_registry (
      dpp_id                     TEXT        PRIMARY KEY,
      lineage_id                 TEXT        NOT NULL,
      company_id                 INTEGER     NOT NULL,
      passport_type              VARCHAR(50) NOT NULL,
      access_key                 VARCHAR(255),
      access_key_hash            VARCHAR(64),
      access_key_prefix          VARCHAR(24),
      access_key_last_rotated_at TIMESTAMPTZ,
      device_api_key             VARCHAR(255),
      device_api_key_hash        VARCHAR(64),
      device_api_key_prefix      VARCHAR(24),
      device_key_last_rotated_at TIMESTAMPTZ,
      created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_registry_company
      ON passport_registry(company_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_registry_lineage
      ON passport_registry(lineage_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id               SERIAL PRIMARY KEY,
      email            VARCHAR(255) NOT NULL UNIQUE,
      password_hash    VARCHAR(255) NOT NULL,
      first_name       VARCHAR(100),
      last_name        VARCHAR(100),
      company_id       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      role             VARCHAR(50) NOT NULL DEFAULT 'viewer',
      is_active        BOOLEAN NOT NULL DEFAULT true,
      otp_code         VARCHAR(6),
      otp_expires_at   TIMESTAMPTZ,
      two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
      last_login_at    TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS backup_public_handovers (
      id                    SERIAL PRIMARY KEY,
      company_id            INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      passport_dpp_id       TEXT NOT NULL REFERENCES passport_registry(dpp_id) ON DELETE CASCADE,
      lineage_id            TEXT,
      passport_type         VARCHAR(100) NOT NULL,
      product_id            TEXT NOT NULL,
      version_number        INTEGER NOT NULL DEFAULT 1,
      backup_provider_id    INTEGER REFERENCES backup_service_providers(id) ON DELETE SET NULL,
      backup_provider_key   VARCHAR(100) NOT NULL,
      source_replication_id INTEGER REFERENCES passport_backup_replications(id) ON DELETE SET NULL,
      storage_key           TEXT,
      public_url            TEXT,
      public_company_name   TEXT,
      public_row_data       JSONB NOT NULL DEFAULT '{}'::jsonb,
      handover_status       VARCHAR(32) NOT NULL DEFAULT 'active',
      verification_status   VARCHAR(32) NOT NULL DEFAULT 'verified',
      notes                 TEXT,
      activated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
      deactivated_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      activated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deactivated_at        TIMESTAMPTZ,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_backup_public_handovers_company
      ON backup_public_handovers(company_id, activated_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_backup_public_handovers_product
      ON backup_public_handovers(product_id, handover_status, activated_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_public_handovers_active_passport
      ON backup_public_handovers(passport_dpp_id)
      WHERE handover_status = 'active'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id               SERIAL PRIMARY KEY,
      email            VARCHAR(255) NOT NULL UNIQUE,
      password_hash    VARCHAR(255) NOT NULL,
      first_name       VARCHAR(100),
      last_name        VARCHAR(100),
      company_id       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      role             VARCHAR(50) NOT NULL DEFAULT 'viewer',
      is_active        BOOLEAN NOT NULL DEFAULT true,
      otp_code         VARCHAR(6),
      otp_expires_at   TIMESTAMPTZ,
      two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
      last_login_at    TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS otp_code_hash TEXT
  `);
  await runMigration(pool, "2026-04-27.backfill-otp-code-hash", async (db) => {
    const otpRows = await db.query(`
      SELECT id, otp_code
      FROM users
      WHERE otp_code IS NOT NULL
        AND COALESCE(TRIM(otp_code_hash), '') = ''
    `);
    for (const row of otpRows.rows) {
      const rawOtp = String(row.otp_code || "").trim();
      if (!rawOtp) continue;
      const otpHash = /^[a-f0-9]{64}$/i.test(rawOtp)
        ? rawOtp.toLowerCase()
        : require("crypto").createHash("sha256").update(rawOtp).digest("hex");
      await db.query(
        `UPDATE users
         SET otp_code_hash = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [otpHash, row.id]
      );
    }
  });

  /* Add missing columns to existing users table (for migrations) */
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_url TEXT
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone VARCHAR(50)
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS job_title VARCHAR(120)
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS bio TEXT
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(12) DEFAULT 'en'
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS default_reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS default_approver_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS auth_source VARCHAR(100) NOT NULL DEFAULT 'local'
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS sso_only BOOLEAN NOT NULL DEFAULT false
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_types (
      id               SERIAL PRIMARY KEY,
      type_name        VARCHAR(100) NOT NULL UNIQUE,
      display_name     VARCHAR(255) NOT NULL,
      umbrella_category VARCHAR(100),
      umbrella_icon    VARCHAR(10) DEFAULT '📋',
      semantic_model_key VARCHAR(100),
      fields_json      JSONB NOT NULL DEFAULT '{"sections":[]}',
      is_active        BOOLEAN NOT NULL DEFAULT true,
      created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    UPDATE passport_types
    SET fields_json = jsonb_set(
      CASE
        WHEN jsonb_typeof(fields_json) = 'object' THEN fields_json
        ELSE '{"sections":[]}'::jsonb
      END,
      '{schemaVersion}',
      COALESCE(fields_json->'schemaVersion', '1'::jsonb),
      true
    )
    WHERE fields_json->'schemaVersion' IS NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_type_schema_events (
      id                SERIAL PRIMARY KEY,
      passport_type_id  INTEGER REFERENCES passport_types(id) ON DELETE SET NULL,
      type_name         VARCHAR(100) NOT NULL,
      table_name        VARCHAR(140) NOT NULL,
      schema_version    INTEGER NOT NULL DEFAULT 1,
      event_type        VARCHAR(60) NOT NULL,
      change_summary    JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_type_schema_events_type
      ON passport_type_schema_events(type_name, created_at DESC)
  `);
  await pool.query(`
    ALTER TABLE passport_types
    ADD COLUMN IF NOT EXISTS semantic_model_key VARCHAR(100)
  `);
  await pool.query(
    `UPDATE passport_types
       SET semantic_model_key = $1
     WHERE COALESCE(umbrella_category, '') ~* 'battery'
       AND semantic_model_key IS DISTINCT FROM $1`,
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
      umbrella_category IS NULL
      OR lower(umbrella_category) NOT LIKE '%battery%'
      OR semantic_model_key = '${BATTERY_DICTIONARY_MODEL_KEY}'
    )
  `);
  await runMigration(pool, "2026-04-29.reset-passport-domain-data", async (db) => {
    const typedPassportTables = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE '%\\_passports' ESCAPE '\\'
        AND table_name <> 'passport_types'
      ORDER BY table_name ASC
    `).catch(() => ({ rows: [] }));

    for (const { table_name } of typedPassportTables.rows) {
      await db.query(`DROP TABLE IF EXISTS ${table_name} CASCADE`).catch(() => {});
    }

    for (const tableName of [
      "passport_access_grants",
      "passport_archives",
      "passport_attachments",
      "passport_backup_replications",
      "passport_dynamic_values",
      "passport_edit_sessions",
      "passport_history_visibility",
      "passport_registry",
      "passport_revision_batch_items",
      "passport_scan_events",
      "passport_security_events",
      "passport_signatures",
      "passport_workflow",
      "company_passport_access",
      "dpp_registry_registrations",
      "dpp_subject_registry",
      "passport_type_drafts",
    ]) {
      await truncateTableIfExists(db, tableName);
    }

    await truncateTableIfExists(db, "passport_types");
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action           VARCHAR(100) NOT NULL,
      table_name       VARCHAR(100),
      record_id        VARCHAR(100),
      old_values       JSONB,
      new_values       JSONB,
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
    CREATE TABLE IF NOT EXISTS passport_registry (
      dpp_id                     TEXT        PRIMARY KEY,
      lineage_id               TEXT        NOT NULL,
      company_id               INTEGER     NOT NULL,
      passport_type            VARCHAR(50) NOT NULL,
      access_key               VARCHAR(255),
      access_key_hash          VARCHAR(64),
      access_key_prefix        VARCHAR(24),
      access_key_last_rotated_at TIMESTAMPTZ,
      device_api_key           VARCHAR(255),
      device_api_key_hash      VARCHAR(64),
      device_api_key_prefix    VARCHAR(24),
      device_key_last_rotated_at TIMESTAMPTZ,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE passport_registry
    ADD COLUMN IF NOT EXISTS lineage_id TEXT
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET lineage_id = dpp_id
    WHERE lineage_id IS NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_registry_company
      ON passport_registry(company_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_registry_lineage
      ON passport_registry(lineage_id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_identifier_lineage (
      id                           SERIAL PRIMARY KEY,
      company_id                   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      lineage_id                   TEXT    NOT NULL,
      previous_passport_dpp_id     TEXT    NOT NULL,
      replacement_passport_dpp_id  TEXT    NOT NULL,
      previous_identifier          TEXT    NOT NULL,
      replacement_identifier       TEXT    NOT NULL,
      previous_local_product_id    TEXT,
      replacement_local_product_id TEXT,
      previous_granularity         VARCHAR(20) NOT NULL CHECK (previous_granularity IN ('model', 'batch', 'item')),
      replacement_granularity      VARCHAR(20) NOT NULL CHECK (replacement_granularity IN ('model', 'batch', 'item')),
      transition_reason            TEXT,
      created_by                   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (previous_passport_dpp_id, replacement_passport_dpp_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_product_identifier_lineage_company
      ON product_identifier_lineage(company_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_product_identifier_lineage_lineage
      ON product_identifier_lineage(lineage_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_product_identifier_lineage_previous_identifier
      ON product_identifier_lineage(previous_identifier)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_product_identifier_lineage_replacement_identifier
      ON product_identifier_lineage(replacement_identifier)
  `);
  await pool.query(`
    ALTER TABLE passport_registry
    ADD COLUMN IF NOT EXISTS access_key_hash VARCHAR(64)
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE passport_registry
    ADD COLUMN IF NOT EXISTS access_key_prefix VARCHAR(24)
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE passport_registry
    ADD COLUMN IF NOT EXISTS access_key_last_rotated_at TIMESTAMPTZ
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE passport_registry
    ADD COLUMN IF NOT EXISTS device_api_key_hash VARCHAR(64)
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE passport_registry
    ADD COLUMN IF NOT EXISTS device_api_key_prefix VARCHAR(24)
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE passport_registry
    ADD COLUMN IF NOT EXISTS device_key_last_rotated_at TIMESTAMPTZ
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_types_umbrella ON passport_types(umbrella_category)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_types_active   ON passport_types(is_active)`);

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

  // Umbrella categories — standalone managed table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS umbrella_categories (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL UNIQUE,
      icon       VARCHAR(10)  NOT NULL DEFAULT '📋',
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  // Seed from existing passport_types so nothing is orphaned
  await pool.query(`
    INSERT INTO umbrella_categories (name, icon)
    SELECT DISTINCT umbrella_category, COALESCE(umbrella_icon, '📋')
    FROM passport_types
    WHERE umbrella_category IS NOT NULL
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
      scopes       TEXT[]       NOT NULL DEFAULT ARRAY['dpp:read']::text[],
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
      passport_dpp_id    TEXT NOT NULL REFERENCES passport_registry(dpp_id) ON DELETE CASCADE,
      company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      audience         VARCHAR(80) NOT NULL,
      element_id_path  TEXT,
      grantee_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      granted_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reason           TEXT,
      expires_at       TIMESTAMPTZ,
      is_active        BOOLEAN NOT NULL DEFAULT true,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (passport_dpp_id, audience, grantee_user_id, element_id_path)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_access_grants_passport
      ON passport_access_grants(passport_dpp_id, audience, grantee_user_id)
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
      passport_dpp_id  TEXT NOT NULL REFERENCES passport_registry(dpp_id) ON DELETE CASCADE,
      viewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_agent     TEXT,
      referrer       TEXT,
      scanned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE passport_scan_events
    ADD COLUMN IF NOT EXISTS viewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_scan_events_passport
      ON passport_scan_events(passport_dpp_id, scanned_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_scan_events_viewer
      ON passport_scan_events(viewer_user_id)
      WHERE viewer_user_id IS NOT NULL
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_passport_scan_events_unique_viewer
      ON passport_scan_events(passport_dpp_id, viewer_user_id)
      WHERE viewer_user_id IS NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_security_events (
      id SERIAL PRIMARY KEY,
      passport_dpp_id TEXT NOT NULL,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      event_type VARCHAR(80) NOT NULL,
      severity VARCHAR(32) NOT NULL DEFAULT 'info',
      source VARCHAR(32) NOT NULL DEFAULT 'system',
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_security_events_passport
      ON passport_security_events(passport_dpp_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_security_events_company
      ON passport_security_events(company_id, created_at DESC)
  `);

  // Company-managed branding for public passport viewer and consumer pages
  await pool.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS branding_json JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  // Dynamic field values — time-series: every push appends a new row, nothing is ever overwritten
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_dynamic_values (
      id            SERIAL       PRIMARY KEY,
      passport_dpp_id TEXT         NOT NULL,
      field_key     VARCHAR(100) NOT NULL,
      value         TEXT,
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dv_passport ON passport_dynamic_values(passport_dpp_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dv_passport_field
      ON passport_dynamic_values(passport_dpp_id, field_key, updated_at DESC)
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
      passport_dpp_id  TEXT         NOT NULL,
      version_number INTEGER      NOT NULL DEFAULT 1,
      data_hash      TEXT         NOT NULL,
      signature      TEXT         NOT NULL,
      algorithm      VARCHAR(50)  NOT NULL DEFAULT 'RSA-SHA256',
      signing_key_id VARCHAR(64)  NOT NULL,
      released_at    TIMESTAMPTZ  NOT NULL,
      signed_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      vc_json        TEXT,
      UNIQUE (passport_dpp_id, version_number)
    )
  `);
  // Store public keys so verifiers can always look them up by key ID
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_signing_keys (
      key_id     VARCHAR(64) PRIMARY KEY,
      public_key TEXT        NOT NULL,
      algorithm  VARCHAR(50) NOT NULL DEFAULT 'RSA-SHA256',
      algorithm_version VARCHAR(20) NOT NULL DEFAULT 'RS256',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE passport_signing_keys
    ADD COLUMN IF NOT EXISTS algorithm_version VARCHAR(20) NOT NULL DEFAULT 'RS256'
  `);
  await pool.query(`
    UPDATE passport_signing_keys
    SET algorithm_version = CASE
      WHEN algorithm = 'ECDSA-SHA256' THEN 'ES256'
      ELSE 'RS256'
    END
    WHERE algorithm_version IS NULL
       OR algorithm_version NOT IN ('RS256', 'ES256')
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
      passport_dpp_id    TEXT         NOT NULL,
      company_id       INTEGER      NOT NULL,
      passport_type    VARCHAR(100) NOT NULL,
      user_id          INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_activity_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      UNIQUE (passport_dpp_id, user_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_edit_sessions_passport
      ON passport_edit_sessions(passport_dpp_id, last_activity_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_edit_sessions_user
      ON passport_edit_sessions(user_id)
  `);

  // Notifications table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id               SERIAL      PRIMARY KEY,
      user_id          INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type             VARCHAR(50) NOT NULL,
      title            VARCHAR(255) NOT NULL,
      message          TEXT,
      passport_dpp_id    TEXT,
      action_url       VARCHAR(500),
      read             BOOLEAN     DEFAULT false,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created
      ON notifications(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notifications_read
      ON notifications(user_id, read)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_revision_batches (
      id                SERIAL PRIMARY KEY,
      company_id        INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      passport_type     VARCHAR(100),
      requested_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      scope_type        VARCHAR(50) NOT NULL DEFAULT 'selected',
      scope_meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
      revision_note     TEXT,
      changes_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
      submit_to_workflow BOOLEAN NOT NULL DEFAULT false,
      reviewer_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approver_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      total_targeted    INTEGER NOT NULL DEFAULT 0,
      revised_count     INTEGER NOT NULL DEFAULT 0,
      skipped_count     INTEGER NOT NULL DEFAULT 0,
      failed_count      INTEGER NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_revision_batches_company_created
      ON passport_revision_batches(company_id, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_revision_batch_items (
      id                    SERIAL PRIMARY KEY,
      batch_id              INTEGER NOT NULL REFERENCES passport_revision_batches(id) ON DELETE CASCADE,
      passport_dpp_id         TEXT NOT NULL,
      passport_type         VARCHAR(100) NOT NULL,
      source_version_number INTEGER,
      new_version_number    INTEGER,
      status                VARCHAR(30) NOT NULL,
      message               TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_revision_batch_items_batch
      ON passport_revision_batch_items(batch_id, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_history_visibility (
      passport_dpp_id   TEXT NOT NULL,
      version_number  INTEGER NOT NULL,
      is_public       BOOLEAN NOT NULL DEFAULT true,
      updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (passport_dpp_id, version_number)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_history_visibility_guid
      ON passport_history_visibility(passport_dpp_id, version_number DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_archives (
      id               SERIAL PRIMARY KEY,
      dpp_id             TEXT NOT NULL,
      lineage_id       TEXT,
      company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      passport_type    VARCHAR(100) NOT NULL,
      version_number   INTEGER NOT NULL DEFAULT 1,
      model_name       VARCHAR(255),
      product_id       VARCHAR(255),
      product_identifier_did TEXT,
      release_status   VARCHAR(50),
      row_data         JSONB NOT NULL,
      archived_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      archived_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE passport_archives
    ADD COLUMN IF NOT EXISTS lineage_id TEXT
  `);
  await pool.query(`
    ALTER TABLE passport_archives
    ADD COLUMN IF NOT EXISTS product_identifier_did TEXT
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
    SET lineage_id = dpp_id
    WHERE lineage_id IS NULL
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_archives_company ON passport_archives(company_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_archives_guid    ON passport_archives(dpp_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_archives_lineage ON passport_archives(lineage_id)`);

  // Ensure shared passport tables exist for all passport types.
  // Idempotent — uses CREATE TABLE IF NOT EXISTS.
  const ptRows = await pool.query("SELECT type_name FROM passport_types");
  for (const { type_name } of ptRows.rows) {
    await createPassportTable(type_name).catch(e =>
      logger.warn({ err: e }, `Could not create table for ${type_name}`)
    );
  }

  for (const { type_name } of ptRows.rows) {
    const tableName = getTable(type_name);
    try {
      await pool.query(`
        ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS lineage_id TEXT
      `);
      await pool.query(`
        UPDATE ${tableName}
        SET lineage_id = dpp_id
        WHERE lineage_id IS NULL
      `);
      await pool.query(`
        ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS granularity VARCHAR(20) NOT NULL DEFAULT 'model'
      `);
      await pool.query(`
        ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS product_identifier_did TEXT
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
        ADD COLUMN IF NOT EXISTS facility_id TEXT
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${tableName}_product_identifier_did
          ON ${tableName}(company_id, product_identifier_did)
          WHERE deleted_at IS NULL
      `);

      if (productIdentifierService) {
        await runMigration(pool, `2026-04-27.backfill-product-identifier-did.${type_name}`, async (db) => {
          const liveRows = await db.query(
            `SELECT id, company_id, product_id, granularity
             FROM ${tableName}
             WHERE deleted_at IS NULL
               AND COALESCE(TRIM(product_id), '') <> ''
               AND COALESCE(TRIM(product_identifier_did), '') = ''`
          );
          for (const row of liveRows.rows) {
            const canonicalDid = productIdentifierService.buildCanonicalProductDid({
              companyId: row.company_id,
              passportType: type_name,
              rawProductId: row.product_id,
              granularity: row.granularity || "item",
            });
            if (!canonicalDid) continue;
            await db.query(
              `UPDATE ${tableName}
               SET product_identifier_did = $1
               WHERE id = $2`,
              [canonicalDid, row.id]
            );
          }

          const archiveRows = await db.query(
            `SELECT id, company_id, product_id, row_data
             FROM passport_archives
             WHERE passport_type = $1
               AND COALESCE(TRIM(product_id), '') <> ''
               AND COALESCE(TRIM(product_identifier_did), '') = ''`,
            [type_name]
          );
          for (const row of archiveRows.rows) {
            const rowData = typeof row.row_data === "string" ? JSON.parse(row.row_data) : row.row_data;
            const canonicalDid = productIdentifierService.buildCanonicalProductDid({
              companyId: row.company_id,
              passportType: type_name,
              rawProductId: row.product_id,
              granularity: rowData?.granularity || "item",
            });
            if (!canonicalDid) continue;
            await db.query(
              `UPDATE passport_archives
               SET product_identifier_did = $1
               WHERE id = $2`,
              [canonicalDid, row.id]
            );
          }
        });
      }
    } catch (e) {
      logger.warn({ err: e }, `Could not normalize revision status for ${type_name}`);
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
      await db.query(
        `ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${constraintName}`
      );
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
      for (const columnName of columns) {
        await db.query(
          `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} DROP DEFAULT`
        );
        await db.query(
          `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} TYPE TEXT USING ${columnName}::text`
        );
      }
    }

    const typedPassportRows = await db.query("SELECT type_name FROM passport_types");
    for (const { type_name } of typedPassportRows.rows) {
      const tableName = getTable(type_name);
      for (const columnName of ["dpp_id", "lineage_id"]) {
        await db.query(
          `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} DROP DEFAULT`
        );
        await db.query(
          `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} TYPE TEXT USING ${columnName}::text`
        );
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

  try {
    await runMigration(pool, "2026-04-27.finalize-din-spec-carbon-footprint-column", async (db) => {
      const legacyDinSpecCol = await db.query(`
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'din_spec_99100_passports'
          AND column_name = 'carbon_footprint_performance_class'
        LIMIT 1
      `);

      if (!legacyDinSpecCol.rows.length) return;

      await db.query(`
        UPDATE din_spec_99100_passports
        SET carbon_footprint_label_and_performance_class =
          COALESCE(NULLIF(TRIM(carbon_footprint_label_and_performance_class), ''), NULLIF(TRIM(carbon_footprint_performance_class), ''))
        WHERE carbon_footprint_performance_class IS NOT NULL
      `);

      await db.query(`
        ALTER TABLE din_spec_99100_passports
        DROP COLUMN IF EXISTS carbon_footprint_performance_class
      `);
    });
  } catch (e) {
    logger.warn({ err: e }, "Could not finalize DIN SPEC carbon footprint label/performance-class migration");
  }

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
    SET access_key_hash = encode(digest(access_key, 'sha256'), 'hex')
    WHERE access_key_hash IS NULL AND access_key IS NOT NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET access_key_prefix = LEFT(access_key, 12)
    WHERE access_key_prefix IS NULL AND access_key IS NOT NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET access_key_last_rotated_at = COALESCE(access_key_last_rotated_at, created_at, NOW())
    WHERE access_key_hash IS NOT NULL AND access_key_last_rotated_at IS NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET device_api_key_hash = encode(digest(device_api_key, 'sha256'), 'hex')
    WHERE device_api_key_hash IS NULL AND device_api_key IS NOT NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET device_api_key_prefix = LEFT(device_api_key, 12)
    WHERE device_api_key_prefix IS NULL AND device_api_key IS NOT NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET device_key_last_rotated_at = COALESCE(device_key_last_rotated_at, created_at, NOW())
    WHERE device_api_key_hash IS NOT NULL AND device_key_last_rotated_at IS NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET access_key = NULL
    WHERE access_key IS NOT NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET device_api_key = NULL
    WHERE device_api_key IS NOT NULL
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
      public_id     VARCHAR(20)  NOT NULL UNIQUE,
      company_id    INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      passport_dpp_id TEXT         NOT NULL,
      field_key     VARCHAR(100),
      file_path     TEXT,
      storage_key   TEXT,
      storage_provider VARCHAR(50),
      file_url      TEXT,
      mime_type     VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
      size_bytes    BIGINT,
      is_public     BOOLEAN      NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `).catch(e => logger.error("passport_attachments init error:", e.message));
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_attachments_guid
      ON passport_attachments(passport_dpp_id)
  `).catch(() => {});
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_attachments_company
      ON passport_attachments(company_id)
  `).catch(() => {});

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'passport_registry_company_id_fkey'
      ) THEN
        ALTER TABLE passport_registry
          ADD CONSTRAINT passport_registry_company_id_fkey
          FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
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
          FOREIGN KEY (registered_by) REFERENCES users(id) ON DELETE SET NULL;
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
    ["dpp_subject_registry", "passport_dpp_id", "dpp_subject_registry_passport_dpp_id_fkey", false],
    ["dpp_registry_registrations", "passport_dpp_id", "dpp_registry_registrations_passport_dpp_id_fkey", false],
    ["passport_backup_replications", "passport_dpp_id", "passport_backup_replications_passport_dpp_id_fkey", false],
    ["backup_public_handovers", "passport_dpp_id", "backup_public_handovers_passport_dpp_id_fkey", false],
    ["passport_access_grants", "passport_dpp_id", "passport_access_grants_passport_dpp_id_fkey", false],
    ["passport_scan_events", "passport_dpp_id", "passport_scan_events_passport_dpp_id_fkey", false],
    ["passport_security_events", "passport_dpp_id", "passport_security_events_passport_dpp_id_fkey", false],
    ["passport_dynamic_values", "passport_dpp_id", "passport_dynamic_values_passport_dpp_id_fkey", false],
    ["passport_signatures", "passport_dpp_id", "passport_signatures_passport_dpp_id_fkey", false],
    ["passport_edit_sessions", "passport_dpp_id", "passport_edit_sessions_passport_dpp_id_fkey", false],
    ["notifications", "passport_dpp_id", "notifications_passport_dpp_id_fkey", true],
    ["passport_revision_batch_items", "passport_dpp_id", "passport_revision_batch_items_passport_dpp_id_fkey", false],
    ["passport_history_visibility", "passport_dpp_id", "passport_history_visibility_passport_dpp_id_fkey", false],
    ["passport_attachments", "passport_dpp_id", "passport_attachments_passport_dpp_id_fkey", false],
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
