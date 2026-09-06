#!/bin/bash -p
set -euo pipefail
umask 077
PATH="/usr/sbin:/usr/bin:/sbin:/bin"
export PATH

# Verify the reduced environment used by the long-running API. This is a
# defense-in-depth deployment gate: prepare-backend-runtime-env.sh constructs
# the file from an explicit allowlist, and this verifier rejects a future
# allowlist regression before Compose can inject a privileged capability into
# the web process. It deliberately reports categories only, never values.
ENV_FILE="${DPP_BACKEND_ENV_FILE:-$(dirname -- "${DPP_ENV_FILE:-/etc/dpp/dpp.env}")/dpp-backend.env}"

file_mode() {
  local file="$1"
  if stat -c '%a' "$file" >/dev/null 2>&1; then
    stat -c '%a' "$file"
  else
    stat -f '%Lp' "$file"
  fi
}

file_owner() {
  local file="$1"
  if stat -c '%u' "$file" >/dev/null 2>&1; then
    stat -c '%u' "$file"
  else
    stat -f '%u' "$file"
  fi
}

fail() {
  echo "Backend runtime environment verification failed: $1" >&2
  exit 1
}

if [ -L "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  fail "derived environment must be a regular file"
fi
if [ "$(file_mode "$ENV_FILE")" != "600" ]; then
  fail "derived environment must have mode 600"
fi
if [ "$(id -u)" -eq 0 ] && [ "$(file_owner "$ENV_FILE")" != "0" ]; then
  fail "derived environment must be root-owned"
fi
if [ ! -s "$ENV_FILE" ]; then
  fail "derived environment must not be empty"
fi

# Do not echo keys or values from the file. The only DB-backup signal the API
# may receive is the non-secret DB_BACKUP_ENABLED policy flag. Database-admin,
# PostgreSQL, migration, volume, and deployment-bootstrap names must remain in
# the root-only source environment or narrowly scoped one-shot services.
malformed=false
duplicate=false
db_backup=false
privileged=false
seen_keys=$'\n'

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  if [[ ! "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]]; then
    malformed=true
    continue
  fi
  key="${BASH_REMATCH[1]}"

  case "$seen_keys" in
    *$'\n'"$key"$'\n'*)
      duplicate=true
      ;;
  esac
  seen_keys+="${key}"$'\n'

  case "$key" in
    DB_BACKUP_ENABLED)
      ;;
    DB_BACKUP_*)
      db_backup=true
      ;;
  esac
  case "$key" in
    DB_ADMIN_*|DB_MIGRATION_*|POSTGRES_*|RUN_SCHEMA_MIGRATIONS|COMPOSE_PROJECT_NAME|POSTGRES_VOLUME_NAME|LOCAL_STORAGE_VOLUME_NAME|DPP_INITIALIZE_*)
      privileged=true
      ;;
  esac
done < "$ENV_FILE"

if [ "$malformed" = "true" ]; then
  fail "derived environment must contain only well-formed assignments"
fi
if [ "$duplicate" = "true" ]; then
  fail "derived environment must not contain duplicate assignments"
fi
if [ "$db_backup" = "true" ]; then
  fail "derived environment contains forbidden database-backup capability names"
fi
if [ "$privileged" = "true" ]; then
  fail "derived environment contains forbidden privileged capability names"
fi

echo "Backend runtime environment verification passed."
