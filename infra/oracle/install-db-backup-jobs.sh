#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dpp}"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"

install -m 0755 "$APP_DIR/infra/oracle/db-backup.sh" /usr/local/bin/dpp-db-backup
install -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup.service" "$UNIT_DIR/dpp-db-backup.service"
install -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup.timer" "$UNIT_DIR/dpp-db-backup.timer"
install -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup-verify.service" "$UNIT_DIR/dpp-db-backup-verify.service"
install -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup-verify.timer" "$UNIT_DIR/dpp-db-backup-verify.timer"
install -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup-drill.service" "$UNIT_DIR/dpp-db-backup-drill.service"
install -m 0644 "$APP_DIR/infra/oracle/systemd/dpp-db-backup-drill.timer" "$UNIT_DIR/dpp-db-backup-drill.timer"

install -d -o root -g root -m 0700 /var/lib/dpp-db-backups

systemctl daemon-reload
systemctl enable --now dpp-db-backup.timer
systemctl enable --now dpp-db-backup-verify.timer
systemctl enable --now dpp-db-backup-drill.timer
