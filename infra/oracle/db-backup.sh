#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dpp}"
ENV_FILE="${DPP_ENV_FILE:-/etc/dpp/dpp.env}"
WORK_DIR="${DB_BACKUP_WORK_DIR:-/var/lib/dpp-db-backups}"
MODE="${1:-backup}"

read_env_var() {
  local key="$1"
  awk -F= -v target="$key" '
    $1 ~ "^[[:space:]]*" target "[[:space:]]*$" {
      value=$2
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

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(read_env_var COMPOSE_PROJECT_NAME)}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-dpp}"
DB_BACKUP_ENABLED="${DB_BACKUP_ENABLED:-$(read_env_var DB_BACKUP_ENABLED)}"
DB_BACKUP_ENABLED="${DB_BACKUP_ENABLED:-true}"

if [ "$DB_BACKUP_ENABLED" != "true" ]; then
  echo "DB backup is disabled via DB_BACKUP_ENABLED=$DB_BACKUP_ENABLED"
  exit 0
fi

mkdir -p "$WORK_DIR"

POSTGRES_CONTAINER="$(docker ps --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" --filter "label=com.docker.compose.service=postgres" --format '{{.Names}}' | head -n1)"
BACKEND_CONTAINER="$(docker ps --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" --filter "label=com.docker.compose.service=backend-api" --format '{{.Names}}' | head -n1)"

if [ -z "$POSTGRES_CONTAINER" ] || [ -z "$BACKEND_CONTAINER" ]; then
  echo "Could not find backend/postgres containers for compose project $COMPOSE_PROJECT_NAME"
  exit 1
fi

POSTGRES_USER="${POSTGRES_USER:-$(read_env_var POSTGRES_USER)}"
POSTGRES_USER="${POSTGRES_USER:-$(read_env_var DB_USER)}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-$(read_env_var POSTGRES_DB)}"
POSTGRES_DB="${POSTGRES_DB:-$(read_env_var DB_NAME)}"
POSTGRES_DB="${POSTGRES_DB:-dpp_system}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
HOST_DUMP="$WORK_DIR/${POSTGRES_DB}-${TS}.dump"
HOST_MANIFEST="$WORK_DIR/${POSTGRES_DB}-${TS}.json"

BACKUP_ENV_KEYS=(
  "STORAGE_S3_ENDPOINT"
  "STORAGE_S3_REGION"
  "STORAGE_S3_BUCKET"
  "STORAGE_S3_ACCESS_KEY_ID"
  "STORAGE_S3_SECRET_ACCESS_KEY"
  "STORAGE_S3_FORCE_PATH_STYLE"
  "DB_BACKUP_S3_ENDPOINT"
  "DB_BACKUP_S3_REGION"
  "DB_BACKUP_S3_BUCKET"
  "DB_BACKUP_S3_ACCESS_KEY_ID"
  "DB_BACKUP_S3_SECRET_ACCESS_KEY"
  "DB_BACKUP_S3_FORCE_PATH_STYLE"
  "DB_BACKUP_S3_PREFIX"
  "DB_BACKUP_PREFIX"
  "DB_BACKUP_RETENTION_COUNT"
  "DB_NAME"
  "POSTGRES_DB"
  "COMPOSE_PROJECT_NAME"
)
BACKUP_ENV_ARGS=()
for key in "${BACKUP_ENV_KEYS[@]}"; do
  value="$(read_env_var "$key")"
  if [ -n "$value" ]; then
    BACKUP_ENV_ARGS+=(-e "$key=$value")
  fi
done

cleanup_file() {
  local target="${1:-}"
  if [ -n "$target" ] && [ -f "$target" ]; then
    rm -f "$target"
  fi
}

cleanup_remote_temp() {
  docker exec "$BACKEND_CONTAINER" sh -lc "rm -f /tmp/dpp-db-backup.dump /tmp/dpp-db-backup-manifest.json /tmp/dpp-db-restore.dump /tmp/dpp-db-restore-manifest.json" >/dev/null 2>&1 || true
}

trap cleanup_remote_temp EXIT

run_backup() {
  echo "Creating PostgreSQL backup from $POSTGRES_CONTAINER..."
  docker exec "$POSTGRES_CONTAINER" sh -lc "pg_dump -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -F c" > "$HOST_DUMP"
  docker cp "$HOST_DUMP" "$BACKEND_CONTAINER:/tmp/dpp-db-backup.dump"
  echo "Uploading backup to OCI Object Storage through $BACKEND_CONTAINER..."
  docker exec "${BACKUP_ENV_ARGS[@]}" "$BACKEND_CONTAINER" sh -lc "node scripts/db-backup-object-storage.js upload --file /tmp/dpp-db-backup.dump"
  cleanup_file "$HOST_DUMP"
}

run_verify() {
  echo "Downloading latest backup from OCI Object Storage..."
  docker exec "${BACKUP_ENV_ARGS[@]}" "$BACKEND_CONTAINER" sh -lc "node scripts/db-backup-object-storage.js download-latest --output /tmp/dpp-db-restore.dump --manifest-output /tmp/dpp-db-restore-manifest.json"
  docker cp "$BACKEND_CONTAINER:/tmp/dpp-db-restore.dump" "$HOST_DUMP"
  docker cp "$BACKEND_CONTAINER:/tmp/dpp-db-restore-manifest.json" "$HOST_MANIFEST"
  docker cp "$HOST_DUMP" "$POSTGRES_CONTAINER:/tmp/dpp-db-restore.dump"
  echo "Verifying PostgreSQL custom dump readability..."
  docker exec "$POSTGRES_CONTAINER" sh -lc "pg_restore -l /tmp/dpp-db-restore.dump >/dev/null"
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
  *)
    echo "Usage: $0 [backup|verify]"
    exit 1
    ;;
esac
