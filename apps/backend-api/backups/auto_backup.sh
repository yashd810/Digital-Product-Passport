#!/bin/bash
# Auto backup dpp_system database every 6 hours
# Keeps last 20 backups, deletes older ones
# Works on Linux (production) and macOS (local dev)
#
# Setup: run ./setup_cron.sh to install the cron job
# Manual: ./auto_backup.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}"

# Use env vars if available (production), fallback to defaults (local dev)
DB_NAME="${DB_NAME:-dpp_system}"
DB_USER="${DB_USER:-yashdesai}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
MAX_BACKUPS="${MAX_BACKUPS:-20}"

# Find pg_dump — check PATH first, then common locations
PG_DUMP=$(command -v pg_dump 2>/dev/null)
if [ -z "$PG_DUMP" ]; then
  for candidate in \
    /usr/bin/pg_dump \
    /usr/local/bin/pg_dump \
    /opt/homebrew/bin/pg_dump \
    /opt/homebrew/Cellar/postgresql@18/18.3/bin/pg_dump \
    /usr/lib/postgresql/*/bin/pg_dump; do
    if [ -x "$candidate" ]; then
      PG_DUMP="$candidate"
      break
    fi
  done
fi

if [ -z "$PG_DUMP" ]; then
  echo "[$(date +%Y%m%d_%H%M%S)] ERROR: pg_dump not found" >> "${BACKUP_DIR}/backup.log"
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/dpp_system_backup_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

# Create backup (use PGPASSWORD env var if set, otherwise rely on .pgpass or peer auth)
$PG_DUMP -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -F c -f "$BACKUP_FILE" 2>> "${BACKUP_DIR}/backup.log"

if [ $? -eq 0 ]; then
  echo "[${TIMESTAMP}] Backup successful: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1))" >> "${BACKUP_DIR}/backup.log"
else
  echo "[${TIMESTAMP}] Backup FAILED" >> "${BACKUP_DIR}/backup.log"
  rm -f "$BACKUP_FILE"
  exit 1
fi

# Delete old backups, keep only the latest MAX_BACKUPS
cd "$BACKUP_DIR"
ls -t dpp_system_backup_*.dump 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs rm -f 2>/dev/null

echo "[${TIMESTAMP}] Cleanup done. $(ls -1 dpp_system_backup_*.dump 2>/dev/null | wc -l | tr -d ' ') backups retained." >> "${BACKUP_DIR}/backup.log"
