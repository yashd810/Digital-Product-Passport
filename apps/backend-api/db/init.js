"use strict";

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
  const existing = await pool.query(
    `SELECT 1
     FROM schema_migrations
     WHERE id = $1
     LIMIT 1`,
    [migrationId]
  );
  if (existing.rows.length) return false;

  await handler();
  await pool.query(
    `INSERT INTO schema_migrations (id)
     VALUES ($1)
     ON CONFLICT (id) DO NOTHING`,
    [migrationId]
  );
  return true;
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
    await runMigration(pool, "2026-04-27.backfill-company-did-slugs", async () => {
      const companyRows = await pool.query(`
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
        await pool.query(
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
      passport_guid   TEXT NOT NULL,
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
      ON dpp_subject_registry(passport_guid)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dpp_subject_registry_product
      ON dpp_subject_registry(company_id, product_id)
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
      pepper_version   INTEGER NOT NULL DEFAULT 1,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

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
    ALTER TABLE passport_types
    ADD COLUMN IF NOT EXISTS semantic_model_key VARCHAR(100)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
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
      guid                     UUID        PRIMARY KEY,
      lineage_id               UUID        NOT NULL DEFAULT gen_random_uuid(),
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
    ADD COLUMN IF NOT EXISTS lineage_id UUID
  `);
  await pool.query(`
    ALTER TABLE passport_registry
    ALTER COLUMN lineage_id SET DEFAULT gen_random_uuid()
  `).catch(() => {});
  await pool.query(`
    UPDATE passport_registry
    SET lineage_id = guid
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
      hash_algorithm VARCHAR(32) NOT NULL DEFAULT 'sha256',
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
    ADD COLUMN IF NOT EXISTS hash_algorithm VARCHAR(32) NOT NULL DEFAULT 'sha256'
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_company ON api_keys(company_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash    ON api_keys(key_hash)`);

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
      passport_guid  UUID NOT NULL REFERENCES passport_registry(guid) ON DELETE CASCADE,
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
      ON passport_scan_events(passport_guid, scanned_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_scan_events_viewer
      ON passport_scan_events(viewer_user_id)
      WHERE viewer_user_id IS NOT NULL
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_passport_scan_events_unique_viewer
      ON passport_scan_events(passport_guid, viewer_user_id)
      WHERE viewer_user_id IS NOT NULL
  `);

  // Company-managed branding for public passport viewer and consumer pages
  await pool.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS branding_json JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1
  `);
  await runMigration(pool, "2026-04-27.backfill-user-session-version", async () => {
    await pool.query(`
      UPDATE users
      SET session_version = 1
      WHERE session_version IS NULL OR session_version < 1
    `).catch(() => {});
  });

  // Dynamic field values — time-series: every push appends a new row, nothing is ever overwritten
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_dynamic_values (
      id            SERIAL       PRIMARY KEY,
      passport_guid UUID         NOT NULL,
      field_key     VARCHAR(100) NOT NULL,
      value         TEXT,
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dv_passport ON passport_dynamic_values(passport_guid)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dv_passport_field
      ON passport_dynamic_values(passport_guid, field_key, updated_at DESC)
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
      passport_guid  UUID         NOT NULL,
      version_number INTEGER      NOT NULL DEFAULT 1,
      data_hash      TEXT         NOT NULL,
      signature      TEXT         NOT NULL,
      algorithm      VARCHAR(50)  NOT NULL DEFAULT 'RSA-SHA256',
      signing_key_id VARCHAR(64)  NOT NULL,
      released_at    TIMESTAMPTZ  NOT NULL,
      signed_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      vc_json        TEXT,
      UNIQUE (passport_guid, version_number)
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
      passport_guid    UUID         NOT NULL,
      company_id       INTEGER      NOT NULL,
      passport_type    VARCHAR(100) NOT NULL,
      user_id          INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_activity_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      UNIQUE (passport_guid, user_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_edit_sessions_passport
      ON passport_edit_sessions(passport_guid, last_activity_at DESC)
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
      passport_guid    UUID,
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
      passport_guid         UUID NOT NULL,
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
      passport_guid   UUID NOT NULL,
      version_number  INTEGER NOT NULL,
      is_public       BOOLEAN NOT NULL DEFAULT true,
      updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (passport_guid, version_number)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_history_visibility_guid
      ON passport_history_visibility(passport_guid, version_number DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_archives (
      id               SERIAL PRIMARY KEY,
      guid             UUID NOT NULL,
      lineage_id       UUID,
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
    ADD COLUMN IF NOT EXISTS lineage_id UUID
  `);
  await pool.query(`
    ALTER TABLE passport_archives
    ADD COLUMN IF NOT EXISTS product_identifier_did TEXT
  `);
  await pool.query(`
    UPDATE passport_archives
    SET lineage_id = guid
    WHERE lineage_id IS NULL
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_archives_company ON passport_archives(company_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_archives_guid    ON passport_archives(guid)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_archives_lineage ON passport_archives(lineage_id)`);

  // Ensure shared passport tables exist for all passport types.
  // Idempotent — uses CREATE TABLE IF NOT EXISTS.
  const ptRows = await pool.query("SELECT type_name FROM passport_types");
  for (const { type_name } of ptRows.rows) {
    await createPassportTable(type_name).catch(e =>
      console.warn(`[initDb] Could not create table for ${type_name}:`, e.message)
    );
  }

  for (const { type_name } of ptRows.rows) {
    const tableName = getTable(type_name);
    try {
      await pool.query(`
        ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS lineage_id UUID
      `);
      await pool.query(`
        ALTER TABLE ${tableName}
        ALTER COLUMN lineage_id SET DEFAULT gen_random_uuid()
      `);
      await pool.query(`
        UPDATE ${tableName}
        SET lineage_id = guid
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
        CREATE INDEX IF NOT EXISTS idx_${tableName}_product_identifier_did
          ON ${tableName}(company_id, product_identifier_did)
          WHERE deleted_at IS NULL
      `);
      await pool.query(
        `UPDATE ${tableName}
         SET release_status = $1
         WHERE release_status = $2`,
        [IN_REVISION_STATUS, LEGACY_IN_REVISION_STATUS]
      );

      if (productIdentifierService) {
        await runMigration(pool, `2026-04-27.backfill-product-identifier-did.${type_name}`, async () => {
          const liveRows = await pool.query(
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
            await pool.query(
              `UPDATE ${tableName}
               SET product_identifier_did = $1
               WHERE id = $2`,
              [canonicalDid, row.id]
            );
          }

          const archiveRows = await pool.query(
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
            await pool.query(
              `UPDATE passport_archives
               SET product_identifier_did = $1
               WHERE id = $2`,
              [canonicalDid, row.id]
            );
          }
        });
      }
    } catch (e) {
      console.warn(`[initDb] Could not normalize revision status for ${type_name}:`, e.message);
    }
  }

  try {
    await runMigration(pool, "2026-04-27.finalize-din-spec-carbon-footprint-column", async () => {
      const legacyDinSpecCol = await pool.query(`
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'din_spec_99100_passports'
          AND column_name = 'carbon_footprint_performance_class'
        LIMIT 1
      `);

      if (!legacyDinSpecCol.rows.length) return;

      await pool.query(`
        UPDATE din_spec_99100_passports
        SET carbon_footprint_label_and_performance_class =
          COALESCE(NULLIF(TRIM(carbon_footprint_label_and_performance_class), ''), NULLIF(TRIM(carbon_footprint_performance_class), ''))
        WHERE carbon_footprint_performance_class IS NOT NULL
      `);

      await pool.query(`
        ALTER TABLE din_spec_99100_passports
        DROP COLUMN IF EXISTS carbon_footprint_performance_class
      `);
    });
  } catch (e) {
    console.warn("[initDb] Could not finalize DIN SPEC carbon footprint label/performance-class migration:", e.message);
  }

  await runMigration(pool, "2026-04-27.normalize-workflow-revision-status", async () => {
    await pool.query(
      `UPDATE passport_workflow
       SET previous_release_status = $1
       WHERE previous_release_status = $2`,
      [IN_REVISION_STATUS, LEGACY_IN_REVISION_STATUS]
    ).catch((e) => {
      console.warn("[initDb] Could not normalize workflow revision status:", e.message);
    });
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
  `).catch(e => console.error("Template table init error:", e.message));

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
  `).catch(e => console.error("Messaging table init error:", e.message));

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
  `).catch(e => console.error("password_reset_tokens init error:", e.message));
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

  // ── Passport attachments (opaque public IDs for app-mediated file serving) ─
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passport_attachments (
      id            SERIAL PRIMARY KEY,
      public_id     VARCHAR(20)  NOT NULL UNIQUE,
      company_id    INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      passport_guid UUID         NOT NULL,
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
  `).catch(e => console.error("passport_attachments init error:", e.message));
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_passport_attachments_guid
      ON passport_attachments(passport_guid)
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
        SELECT 1 FROM pg_constraint WHERE conname = 'passport_dynamic_values_passport_guid_fkey'
      ) THEN
        ALTER TABLE passport_dynamic_values
          ADD CONSTRAINT passport_dynamic_values_passport_guid_fkey
          FOREIGN KEY (passport_guid) REFERENCES passport_registry(guid) ON DELETE CASCADE;
      END IF;
    END $$;
  `).catch(() => {});
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'passport_attachments_passport_guid_fkey'
      ) THEN
        ALTER TABLE passport_attachments
          ADD CONSTRAINT passport_attachments_passport_guid_fkey
          FOREIGN KEY (passport_guid) REFERENCES passport_registry(guid) ON DELETE CASCADE;
      END IF;
    END $$;
  `).catch(() => {});
  } finally {
    await pool.query(`SELECT pg_advisory_unlock($1)`, [SCHEMA_MIGRATION_LOCK_KEY]).catch(() => {});
  }
}

module.exports = { initDb };
