#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/dpp}"
ENV_FILE="${DPP_ENV_FILE:-/etc/dpp/dpp.env}"
WORK_DIR="${DB_BACKUP_WORK_DIR:-/var/lib/dpp-db-backups}"
MODE="${1:-backup}"

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

read_env_var() {
  local key="$1"
  awk -v target="$key" '
    $0 ~ "^[[:space:]]*" target "[[:space:]]*=" {
      pos = index($0, "=")
      value = substr($0, pos + 1)
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      if (value ~ /^".*"$/) {
        sub(/^"/, "", value)
        sub(/"$/, "", value)
      }
      print value
      exit
    }
  ' "$ENV_FILE"
}

uppercase_ascii() {
  printf '%s' "$1" | LC_ALL=C tr '[:lower:]' '[:upper:]'
}

require_db_backup_env_var() {
  local key="$1"
  local value
  value="$(read_env_var "$key")"
  if [ -z "$value" ]; then
    echo "Missing required DB backup environment variable: $key"
    exit 1
  fi
  case "$(uppercase_ascii "$value")" in
    *REPLACE*|*CHANGE*|*YOUR_*)
      echo "DB backup environment variable must not use a placeholder: $key"
      exit 1
      ;;
  esac
  printf '%s' "$value"
}

validate_db_backup_configuration() {
  local endpoint
  local region
  local bucket
  local access_key_id
  local secret_access_key

  endpoint="$(require_db_backup_env_var "DB_BACKUP_S3_ENDPOINT")"
  region="$(require_db_backup_env_var "DB_BACKUP_S3_REGION")"
  bucket="$(require_db_backup_env_var "DB_BACKUP_S3_BUCKET")"
  access_key_id="$(require_db_backup_env_var "DB_BACKUP_S3_ACCESS_KEY_ID")"
  secret_access_key="$(require_db_backup_env_var "DB_BACKUP_S3_SECRET_ACCESS_KEY")"

  case "$endpoint" in
    https://*)
      ;;
    *)
      echo "DB_BACKUP_S3_ENDPOINT must use https://"
      exit 1
      ;;
  esac
  if ! [[ "$region" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]]; then
    echo "DB_BACKUP_S3_REGION must be a lowercase region identifier"
    exit 1
  fi
  if ! [[ "$bucket" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$ ]]; then
    echo "DB_BACKUP_S3_BUCKET must be an object-storage bucket name without paths"
    exit 1
  fi
  if [[ "$access_key_id" =~ [[:space:]] ]] || [[ "$secret_access_key" =~ [[:space:]] ]]; then
    echo "DB backup S3 credentials must not contain whitespace"
    exit 1
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

if [ -L "$ENV_FILE" ]; then
  echo "Refusing a symlinked env file: $ENV_FILE"
  exit 1
fi

ENV_MODE="$(file_mode "$ENV_FILE")"
if [ "$ENV_MODE" != "600" ]; then
  echo "Backup env file must have mode 600: $ENV_FILE"
  exit 1
fi
if [ "$(id -u)" -eq 0 ] && [ "$(file_owner "$ENV_FILE")" != "0" ]; then
  echo "Backup env file must be owned by root when running as root: $ENV_FILE"
  exit 1
fi

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(read_env_var COMPOSE_PROJECT_NAME)}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-dpp}"
DB_BACKUP_ENABLED="$(read_env_var DB_BACKUP_ENABLED)"

case "$DB_BACKUP_ENABLED" in
  true)
    validate_db_backup_configuration
    ;;
  false)
    echo "DB backup is disabled via DB_BACKUP_ENABLED=false"
    exit 0
    ;;
  *)
    echo "DB_BACKUP_ENABLED must be explicitly set to true or false in $ENV_FILE"
    exit 1
    ;;
esac

install -d -o root -g root -m 0700 "$WORK_DIR"

if ! command -v flock >/dev/null 2>&1; then
  echo "flock is required to prevent concurrent backup operations."
  exit 1
fi

LOCK_FILE="${DB_BACKUP_LOCK_FILE:-$WORK_DIR/.lock}"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another DPP database backup, verification, or restore drill is already running."
  exit 1
fi

POSTGRES_CONTAINER="$(docker ps --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" --filter "label=com.docker.compose.service=postgres" --format '{{.Names}}' | head -n1)"
BACKEND_CONTAINER="$(docker ps --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" --filter "label=com.docker.compose.service=backend-api" --format '{{.Names}}' | head -n1)"

if [ -z "$POSTGRES_CONTAINER" ] || [ -z "$BACKEND_CONTAINER" ]; then
  echo "Could not find backend/postgres containers for compose project $COMPOSE_PROJECT_NAME"
  exit 1
fi

DB_USER="${DB_USER:-$(read_env_var DB_USER)}"
DB_NAME="${DB_NAME:-$(read_env_var DB_NAME)}"
if [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
  echo "DB_USER and DB_NAME must be set in $ENV_FILE"
  exit 1
fi
if ! [[ "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_-]{0,62}$ ]]; then
  echo "DB_NAME must be a simple PostgreSQL identifier when running host backups."
  exit 1
fi
TS="$(date -u +%Y%m%dT%H%M%SZ)"
HOST_DUMP="$(mktemp "$WORK_DIR/${DB_NAME}-${TS}.XXXXXX.dump")"
HOST_MANIFEST="$(mktemp "$WORK_DIR/${DB_NAME}-${TS}.XXXXXX.json")"
HOST_DRILL_EVIDENCE="$(mktemp "$WORK_DIR/${DB_NAME}-${TS}.XXXXXX.restore-drill.json")"

cleanup_file() {
  local target="${1:-}"
  if [ -n "$target" ] && [ -f "$target" ]; then
    rm -f "$target"
  fi
}

copy_file_to_backend_for_node() {
  local source="$1"
  local destination="$2"

  docker cp "$source" "$BACKEND_CONTAINER:$destination"
  docker exec -u 0 "$BACKEND_CONTAINER" chown node:node "$destination"
  docker exec -u 0 "$BACKEND_CONTAINER" chmod 0600 "$destination"
}

secure_backend_file_for_node() {
  local destination="$1"

  docker exec -u 0 "$BACKEND_CONTAINER" chown node:node "$destination"
  docker exec -u 0 "$BACKEND_CONTAINER" chmod 0600 "$destination"
}

cleanup_remote_temp() {
  docker exec -u 0 "$BACKEND_CONTAINER" rm -f -- \
    /tmp/dpp-db-backup.dump \
    /tmp/dpp-db-backup-manifest.json \
    /tmp/dpp-db-restore.dump \
    /tmp/dpp-db-restore-manifest.json \
    /tmp/dpp-db-restore-drill.json >/dev/null 2>&1 || true
}

cleanup_postgres_temp() {
  docker exec -u 0 "$POSTGRES_CONTAINER" rm -f -- /tmp/dpp-db-restore.dump >/dev/null 2>&1 || true
}

cleanup() {
  cleanup_file "$HOST_DUMP"
  cleanup_file "$HOST_MANIFEST"
  cleanup_file "$HOST_DRILL_EVIDENCE"
  cleanup_remote_temp
  cleanup_postgres_temp
}

trap cleanup EXIT

run_backup() {
  echo "Creating PostgreSQL backup from $POSTGRES_CONTAINER..."
  docker exec "$POSTGRES_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -F c > "$HOST_DUMP"
  copy_file_to_backend_for_node "$HOST_DUMP" /tmp/dpp-db-backup.dump
  echo "Uploading backup to OCI Object Storage through $BACKEND_CONTAINER..."
  docker exec -w /app "$BACKEND_CONTAINER" node scripts/db-backup-object-storage.js upload --file /tmp/dpp-db-backup.dump
  cleanup_file "$HOST_DUMP"
}

run_verify() {
  echo "Downloading latest backup from OCI Object Storage..."
  docker exec -w /app "$BACKEND_CONTAINER" node scripts/db-backup-object-storage.js download-latest --output /tmp/dpp-db-restore.dump --manifest-output /tmp/dpp-db-restore-manifest.json
  secure_backend_file_for_node /tmp/dpp-db-restore.dump
  secure_backend_file_for_node /tmp/dpp-db-restore-manifest.json
  docker cp "$BACKEND_CONTAINER:/tmp/dpp-db-restore.dump" "$HOST_DUMP"
  docker cp "$BACKEND_CONTAINER:/tmp/dpp-db-restore-manifest.json" "$HOST_MANIFEST"
  docker cp "$HOST_DUMP" "$POSTGRES_CONTAINER:/tmp/dpp-db-restore.dump"
  echo "Verifying PostgreSQL custom dump readability..."
  docker exec "$POSTGRES_CONTAINER" pg_restore -l /tmp/dpp-db-restore.dump >/dev/null
  cleanup_file "$HOST_DUMP"
  cleanup_file "$HOST_MANIFEST"
}

run_drill() {
  echo "Running restore drill from latest OCI Object Storage backup..."
  docker exec -w /app "$BACKEND_CONTAINER" node scripts/db-backup-object-storage.js download-latest --output /tmp/dpp-db-restore.dump --manifest-output /tmp/dpp-db-restore-manifest.json
  secure_backend_file_for_node /tmp/dpp-db-restore.dump
  secure_backend_file_for_node /tmp/dpp-db-restore-manifest.json
  docker cp "$BACKEND_CONTAINER:/tmp/dpp-db-restore.dump" "$HOST_DUMP"
  docker cp "$BACKEND_CONTAINER:/tmp/dpp-db-restore-manifest.json" "$HOST_MANIFEST"
  docker cp "$HOST_DUMP" "$POSTGRES_CONTAINER:/tmp/dpp-db-restore.dump"
  echo "Verifying PostgreSQL custom dump readability..."
  docker exec "$POSTGRES_CONTAINER" pg_restore -l /tmp/dpp-db-restore.dump >/dev/null

  MANIFEST_SHA="$(python3 - "$HOST_MANIFEST" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)
print(data.get("sha256",""))
PY
)"
  DUMP_KEY="$(python3 - "$HOST_MANIFEST" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)
print(data.get("dumpKey",""))
PY
)"
  MANIFEST_KEY="$(python3 - "$HOST_MANIFEST" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)
print(data.get("manifestKey",""))
PY
)"
  VERIFY_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  python3 - "$HOST_DRILL_EVIDENCE" "$VERIFY_AT" "$COMPOSE_PROJECT_NAME" "$DB_NAME" "$(hostname)" "$DUMP_KEY" "$MANIFEST_KEY" "$MANIFEST_SHA" <<'PY'
import json, sys

path, verified_at, compose_project_name, database_name, host, dump_key, manifest_key, manifest_sha = sys.argv[1:]
with open(path, "w", encoding="utf-8") as fh:
    json.dump({
        "schemaVersion": 1,
        "type": "restore_drill_evidence",
        "verifiedAt": verified_at,
        "composeProjectName": compose_project_name,
        "databaseName": database_name,
        "host": host,
        "dumpKey": dump_key,
        "manifestKey": manifest_key,
        "backupSha256": manifest_sha,
        "verificationMethod": "pg_restore -l readability check",
        "result": "passed",
    }, fh)
    fh.write("\n")
PY

  DB_BACKUP_EVIDENCE_S3_PREFIX="${DB_BACKUP_EVIDENCE_S3_PREFIX:-$(read_env_var DB_BACKUP_EVIDENCE_S3_PREFIX)}"
  EVIDENCE_PREFIX="${DB_BACKUP_EVIDENCE_S3_PREFIX:-db-backups/evidence/restore-drills}"
  EVIDENCE_KEY="${EVIDENCE_PREFIX%/}/${DB_NAME}-${TS}-restore-drill.json"
  EVIDENCE_BUCKET="$(read_env_var DB_BACKUP_S3_BUCKET)"
  copy_file_to_backend_for_node "$HOST_DRILL_EVIDENCE" /tmp/dpp-db-restore-drill.json
  echo "Uploading restore drill evidence..."
  docker exec -w /app "$BACKEND_CONTAINER" node scripts/db-backup-object-storage.js put-object --file /tmp/dpp-db-restore-drill.json --key "$EVIDENCE_KEY" --content-type application/json

  echo "Restore drill complete."
  echo "Set BACKUP_LAST_RESTORE_DRILL_AT=$VERIFY_AT"
  echo "Set BACKUP_RESTORE_DRILL_EVIDENCE_URI=oci://$EVIDENCE_BUCKET/$EVIDENCE_KEY"

  cleanup_file "$HOST_DUMP"
  cleanup_file "$HOST_MANIFEST"
}

case "$MODE" in
  backup)
    run_backup
    ;;
  verify)
    run_verify
    ;;
  drill)
    run_drill
    ;;
  *)
    echo "Usage: $0 [backup|verify|drill]"
    exit 1
    ;;
esac
