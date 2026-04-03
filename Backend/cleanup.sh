#!/usr/bin/env bash
# ONE-TIME DATABASE CLEANUP
# Deletes all passports, passport types, companies, non-super_admin users, and audit logs.
# Super admin accounts are preserved.
# Run from the Backend directory: bash cleanup.sh

set -euo pipefail

# Load env vars from .env in the same directory
ENV_FILE="$(dirname "$0")/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env file not found at $ENV_FILE"
  exit 1
fi
# Parse .env manually to handle values with spaces (e.g. EMAIL_PASS=isuq qlxx ...)
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" == *=* ]] || continue
  key="${line%%=*}"
  value="${line#*=}"
  export "$key=$value"
done < "$ENV_FILE"

echo "============================================"
echo "  DPP DATABASE CLEANUP"
echo "============================================"
echo "  Host : ${DB_HOST}:${DB_PORT:-5432}"
echo "  DB   : ${DB_NAME}"
echo ""
echo "  This will PERMANENTLY delete:"
echo "    - All passports (all type tables)"
echo "    - All passport types & umbrella categories"
echo "    - All companies (and their data)"
echo "    - All users EXCEPT super_admin accounts"
echo "    - All audit logs"
echo ""
read -rp "Type YES to continue: " confirm
[[ "$confirm" == "YES" ]] || { echo "Aborted."; exit 1; }

echo ""
echo "Starting cleanup..."

PGPASSWORD="$DB_PASSWORD" psql \
  -U "$DB_USER" \
  -h "$DB_HOST" \
  -p "${DB_PORT:-5432}" \
  -d "$DB_NAME" \
  -v ON_ERROR_STOP=0 \
  <<'SQL'

-- ── 1. Drop all dynamic passport tables ({type_name}_passports) ──────────────
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE '%\_passports' ESCAPE '\'
      AND table_name NOT LIKE 'company\_%' ESCAPE '\'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', tbl);
    RAISE NOTICE 'Dropped passport table: %', tbl;
  END LOOP;
END;
$$;

-- ── 2. Clear passport supporting data ───────────────────────────────────────
DELETE FROM passport_edit_sessions;
DELETE FROM passport_dynamic_values;
DELETE FROM passport_signatures;
DELETE FROM passport_registry;
DELETE FROM passport_type_drafts;

-- passport_workflow may not exist on all installs
DO $$ BEGIN
  DELETE FROM passport_workflow;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'passport_workflow not found, skipping.';
END $$;

-- ── 3. Clear passport types ──────────────────────────────────────────────────
DELETE FROM company_passport_access;
DELETE FROM umbrella_categories;
DELETE FROM passport_types;

-- ── 4. Clear audit logs ──────────────────────────────────────────────────────
DELETE FROM audit_logs;

-- ── 5. Preserve super_admin users, delete everyone else ─────────────────────
-- Null out company_id on super_admins first so deleting companies
-- does not cascade and wipe them out.
UPDATE users SET company_id = NULL WHERE role = 'super_admin';
DELETE FROM users WHERE role != 'super_admin';

-- ── 6. Delete all companies ──────────────────────────────────────────────────
-- Cascades to: api_keys, company_repository, company_passport_access (already empty)
DELETE FROM companies;

SQL

echo ""
echo "============================================"
echo "  Cleanup complete."
echo "  Super admin accounts have been preserved."
echo "============================================"
