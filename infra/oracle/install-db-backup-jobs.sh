#!/bin/bash -p
set -euo pipefail
PATH="/usr/sbin:/usr/bin:/sbin:/bin"
export PATH

APP_DIR="${APP_DIR:-/opt/dpp}"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"
ENV_FILE="${DPP_ENV_FILE:-/etc/dpp/dpp.env}"
BACKUP_COMPOSE_FILE="/etc/dpp/dpp-backup-compose.yml"

if [ "$(id -u)" -ne 0 ]; then
  echo "The DB backup job installer must run as root." >&2
  exit 1
fi

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

install -o root -g root -m 0755 "$APP_DIR/infra/oracle/db-backup.sh" /usr/local/bin/dpp-db-backup
install -d -o root -g root -m 0750 /etc/dpp
install -o root -g root -m 0644 "$APP_DIR/infra/oracle/dpp-backup-compose.yml" "$BACKUP_COMPOSE_FILE"
install -o root -g root -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup.service" "$UNIT_DIR/dpp-db-backup.service"
install -o root -g root -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup.timer" "$UNIT_DIR/dpp-db-backup.timer"
install -o root -g root -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup-verify.service" "$UNIT_DIR/dpp-db-backup-verify.service"
install -o root -g root -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup-verify.timer" "$UNIT_DIR/dpp-db-backup-verify.timer"
install -o root -g root -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup-drill.service" "$UNIT_DIR/dpp-db-backup-drill.service"
install -o root -g root -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup-drill.timer" "$UNIT_DIR/dpp-db-backup-drill.timer"

install -d -o root -g root -m 0700 /var/lib/dpp-db-backups
# The uploader image runs as the non-root node user (uid/gid 1000). Prepare
# its private bind-mount source explicitly so Docker never creates it root-owned.
install -d -o 1000 -g 1000 -m 0700 /var/lib/dpp-db-backups/container

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
