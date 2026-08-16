#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dpp}"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"
ENV_FILE="${DPP_ENV_FILE:-/etc/dpp/dpp.env}"

read_env_var() {
  local key="$1"
  awk -F= -v target="$key" '
    $1 == target {
      print substr($0, index($0, "=") + 1)
      exit
    }
  ' "$ENV_FILE"
}

if [ -L "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "Missing regular DB backup environment file: $ENV_FILE" >&2
  exit 1
fi

DB_BACKUP_ENABLED="$(read_env_var DB_BACKUP_ENABLED)"
case "$DB_BACKUP_ENABLED" in
  true|false) ;;
  *)
    echo "DB_BACKUP_ENABLED must be explicitly set to true or false in $ENV_FILE" >&2
    exit 1
    ;;
esac

install -m 0755 "$APP_DIR/infra/oracle/db-backup.sh" /usr/local/bin/dpp-db-backup
install -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup.service" "$UNIT_DIR/dpp-db-backup.service"
install -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup.timer" "$UNIT_DIR/dpp-db-backup.timer"
install -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup-verify.service" "$UNIT_DIR/dpp-db-backup-verify.service"
install -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup-verify.timer" "$UNIT_DIR/dpp-db-backup-verify.timer"
install -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup-drill.service" "$UNIT_DIR/dpp-db-backup-drill.service"
install -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup-drill.timer" "$UNIT_DIR/dpp-db-backup-drill.timer"

install -d -o root -g root -m 0700 /var/lib/dpp-db-backups

systemctl daemon-reload
if [ "$DB_BACKUP_ENABLED" = "true" ]; then
  systemctl enable --now dpp-db-backup.timer
  systemctl enable --now dpp-db-backup-verify.timer
  systemctl enable --now dpp-db-backup-drill.timer
  echo "DPP DB backup, verification, and restore-drill timers enabled."
else
  # Keep installed unit definitions ready for an approved enablement, but do
  # not leave green timers that run no-op jobs and imply recoverability.
  systemctl disable --now dpp-db-backup.timer
  systemctl disable --now dpp-db-backup-verify.timer
  systemctl disable --now dpp-db-backup-drill.timer
  echo "DPP DB backup timers disabled because DB_BACKUP_ENABLED=false."
fi
