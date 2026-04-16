"use strict";

/**
 * Database initialization — creates or alters all tables and indexes.
 * Extracted from server.js to keep startup logic separate from route handling.
 *
 * Usage:
 *   const { initDb } = require("./db/init");
 *   await initDb(pool, { getTable, createPassportTable, IN_REVISION_STATUS, LEGACY_IN_REVISION_STATUS });
 */

async function initDb(pool, { getTable, createPassportTable, IN_REVISION_STATUS, LEGACY_IN_REVISION_STATUS }) {
  // Core user and company management tables
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
    CREATE TABLE IF NOT EXISTS passport_types (
      id               SERIAL PRIMARY KEY,
      type_name        VARCHAR(100) NOT NULL UNIQUE,
      display_name     VARCHAR(255) NOT NULL,
      umbrella_category VARCHAR(100),
      umbrella_icon    VARCHAR(10) DEFAULT '📋',
      fields_json      JSONB NOT NULL DEFAULT '{"sections":[]}',
      is_active        BOOLEAN NOT NULL DEFAULT true,
      created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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
      guid           UUID        PRIMARY KEY,
      lineage_id     UUID        NOT NULL DEFAULT gen_random_uuid(),
      company_id     INTEGER     NOT NULL,
      passport_type  VARCHAR(50) NOT NULL,
      access_key     VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
      device_api_key VARCHAR(64) NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      file_url   TEXT,
      mime_type  VARCHAR(100),
      size_bytes BIGINT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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
      file_url   TEXT         NOT NULL,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      is_active  BOOLEAN      NOT NULL DEFAULT true
    )
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
      created_by   INT REFERENCES users(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      is_active    BOOLEAN      NOT NULL DEFAULT true
    )
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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
      await pool.query(
        `UPDATE ${tableName}
         SET release_status = $1
         WHERE release_status = $2`,
        [IN_REVISION_STATUS, LEGACY_IN_REVISION_STATUS]
      );
    } catch (e) {
      console.warn(`[initDb] Could not normalize revision status for ${type_name}:`, e.message);
    }
  }

  try {
    const legacyDinSpecCol = await pool.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'din_spec_99100_passports'
        AND column_name = 'carbon_footprint_performance_class'
      LIMIT 1
    `);

    if (legacyDinSpecCol.rows.length) {
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
    }
  } catch (e) {
    console.warn("[initDb] Could not finalize DIN SPEC carbon footprint label/performance-class migration:", e.message);
  }

  await pool.query(
    `UPDATE passport_workflow
     SET previous_release_status = $1
     WHERE previous_release_status = $2`,
    [IN_REVISION_STATUS, LEGACY_IN_REVISION_STATUS]
  ).catch((e) => {
    console.warn("[initDb] Could not normalize workflow revision status:", e.message);
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
}

module.exports = { initDb };
