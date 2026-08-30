#!/bin/bash -p
# Copies a verified OCI deployment identity onto the dedicated runner without
# retaining workstation paths or source files.

set -euo pipefail
umask 077
PATH="/usr/sbin:/usr/bin:/sbin:/bin"
export PATH

RUNNER_USER="${DPP_DEPLOY_RUNNER_USER:-dpp-deploy}"
RUNNER_CONFIG_DIR="${DPP_DEPLOY_RUNNER_CONFIG_DIR:-/etc/dpp-deployer}"
SOURCE_CONFIG="${DPP_DEPLOY_CONFIG_SOURCE:-}"
SOURCE_KEY="${DPP_DEPLOY_KEY_SOURCE:-}"
SOURCE_KNOWN_HOSTS="${DPP_DEPLOY_KNOWN_HOSTS_SOURCE:-}"
REPLACE_EXISTING="${DPP_REPLACE_RUNNER_DEPLOY_CONFIG:-}"
readonly REQUIRED_OCI_USER="dpp-release"

fail() {
  echo "Deployment-runner configuration install failed: $*" >&2
  exit 1
}

file_mode() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    stat -f '%Lp' "$1"
  fi
}

require_private_source_file() {
  local path="$1"
  local label="$2"
  local mode

  [ -n "$path" ] || fail "$label is required"
  [ ! -L "$path" ] || fail "$label must not be a symlink"
  [ -f "$path" ] || fail "$label must be a regular file"
  mode="$(file_mode "$path")"
  (( (8#$mode & 8#077) == 0 )) || fail "$label must not be readable by group or others"
}

require_known_hosts_source_file() {
  local path="$1"
  local mode

  [ -n "$path" ] || fail "DPP_DEPLOY_KNOWN_HOSTS_SOURCE is required"
  [ ! -L "$path" ] || fail "DPP_DEPLOY_KNOWN_HOSTS_SOURCE must not be a symlink"
  [ -f "$path" ] || fail "DPP_DEPLOY_KNOWN_HOSTS_SOURCE must be a regular file"
  mode="$(file_mode "$path")"
  (( (8#$mode & 8#022) == 0 )) || fail "DPP_DEPLOY_KNOWN_HOSTS_SOURCE must not be writable by group or others"
}

[ "$(id -u)" -eq 0 ] || fail "must run as root on the dedicated deployment runner"
[[ "$RUNNER_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "DPP_DEPLOY_RUNNER_USER is invalid"
id "$RUNNER_USER" >/dev/null 2>&1 || fail "deployment runner user does not exist: $RUNNER_USER"
case "$RUNNER_CONFIG_DIR" in
  /etc/*) ;;
  *) fail "DPP_DEPLOY_RUNNER_CONFIG_DIR must be under /etc" ;;
esac
case "$RUNNER_CONFIG_DIR" in
  *'/../'*|*/..|*'/./'*|*/.) fail "DPP_DEPLOY_RUNNER_CONFIG_DIR must not contain path traversal" ;;
esac
[ ! -L "$RUNNER_CONFIG_DIR" ] || fail "DPP_DEPLOY_RUNNER_CONFIG_DIR must not be a symlink"
if [ -n "$REPLACE_EXISTING" ] && [ "$REPLACE_EXISTING" != "true" ]; then
  fail "DPP_REPLACE_RUNNER_DEPLOY_CONFIG must be true when set"
fi

require_private_source_file "$SOURCE_CONFIG" "DPP_DEPLOY_CONFIG_SOURCE"
require_private_source_file "$SOURCE_KEY" "DPP_DEPLOY_KEY_SOURCE"
require_known_hosts_source_file "$SOURCE_KNOWN_HOSTS"

oci_backend_ip=""
oci_frontend_ip=""
oci_user=""
seen_keys="|"
line_number=0
while IFS= read -r line || [ -n "$line" ]; do
  line_number=$((line_number + 1))
  line="${line%$'\r'}"
  case "$line" in
    ''|'#'*) continue ;;
  esac
  case "$line" in
    *=*) ;;
    *) fail "invalid source configuration at line $line_number" ;;
  esac
  key="${line%%=*}"
  value="${line#*=}"
  case "$key" in
    OCI_BACKEND_IP|OCI_FRONTEND_IP|OCI_USER|SSH_KEY|SSH_KNOWN_HOSTS) ;;
    *) fail "unsupported source configuration key at line $line_number" ;;
  esac
  case "$seen_keys" in
    *"|$key|"*) fail "duplicate source configuration key: $key" ;;
    *) seen_keys="${seen_keys}${key}|" ;;
  esac
  [ -n "$value" ] || fail "source configuration value is empty: $key"
  case "$key" in
    OCI_BACKEND_IP) oci_backend_ip="$value" ;;
    OCI_FRONTEND_IP) oci_frontend_ip="$value" ;;
    OCI_USER) oci_user="$value" ;;
  esac
done < "$SOURCE_CONFIG"

for host in "$oci_backend_ip" "$oci_frontend_ip"; do
  [[ "$host" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ ]] || fail "configured OCI host is invalid"
done
[[ "$oci_user" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "configured OCI user is invalid"
[ "$oci_user" = "$REQUIRED_OCI_USER" ] || fail "configured OCI user must be the dedicated restricted account: $REQUIRED_OCI_USER"

dest_config="$RUNNER_CONFIG_DIR/oci-deploy.env"
dest_key="$RUNNER_CONFIG_DIR/oci-deploy.key"
dest_known_hosts="$RUNNER_CONFIG_DIR/known_hosts"
for destination in "$dest_config" "$dest_key" "$dest_known_hosts"; do
  [ ! -L "$destination" ] || fail "destination must not be a symlink"
  if [ -e "$destination" ] && [ "$REPLACE_EXISTING" != "true" ]; then
    fail "destination already exists; set DPP_REPLACE_RUNNER_DEPLOY_CONFIG=true after verifying the intended replacement"
  fi
done

install -d -o root -g "$RUNNER_USER" -m 0750 "$RUNNER_CONFIG_DIR"
install -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0600 "$SOURCE_KEY" "$dest_key"
install -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0600 "$SOURCE_KNOWN_HOSTS" "$dest_known_hosts"
{
  printf 'OCI_BACKEND_IP=%s\n' "$oci_backend_ip"
  printf 'OCI_FRONTEND_IP=%s\n' "$oci_frontend_ip"
  printf 'OCI_USER=%s\n' "$oci_user"
  printf 'SSH_KEY=%s\n' "$dest_key"
  printf 'SSH_KNOWN_HOSTS=%s\n' "$dest_known_hosts"
} | install -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0600 /dev/stdin "$dest_config"

echo "Deployment-runner OCI configuration installed."
echo "Verify it as $RUNNER_USER with:"
echo "  sudo -u $RUNNER_USER DPP_DEPLOY_CONFIG_FILE=$dest_config DPP_DEPLOY_RUNNER_USER=$RUNNER_USER bash scripts/deploy/check-deployment-runner.sh"
