#!/usr/bin/env bash
# Explicit, reversible installer for the Docker-to-OCI-IMDS host firewall rule.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dpp}"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"

if [ "$(id -u)" -ne 0 ]; then
  echo "The container IMDS firewall installer must run as root." >&2
  exit 1
fi

install -o root -g root -m 0755 \
  "$APP_DIR/infra/oracle/container-imds-firewall.sh" \
  /usr/local/sbin/dpp-container-imds-firewall
install -o root -g root -m 0644 \
  "$APP_DIR/infra/oracle/systemd/dpp-container-imds-firewall.service" \
  "$UNIT_DIR/dpp-container-imds-firewall.service"

systemctl daemon-reload
# Reenable rather than enable so an upgrade removes an older multi-user.target
# wants-link and installs the current Docker-start wants-link atomically. A
# one-shot unit can remain active after Docker recreates its chains, so restart
# it explicitly to force the IMDS rule back into the new DOCKER-USER chain.
systemctl reenable dpp-container-imds-firewall.service
systemctl restart dpp-container-imds-firewall.service
/usr/local/sbin/dpp-container-imds-firewall check

echo "Docker container access to OCI IMDS is blocked. Host-originated access is unchanged."
