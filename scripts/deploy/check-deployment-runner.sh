#!/usr/bin/env bash
# Verifies the local prerequisites for the dedicated, non-production GitHub
# Actions runner that is allowed to deploy DPP production releases.

set -euo pipefail
umask 077

CONFIG_FILE="${DPP_DEPLOY_CONFIG_FILE:-/etc/dpp-deployer/oci-deploy.env}"
EXPECTED_USER="${DPP_DEPLOY_RUNNER_USER:-dpp-deploy}"

fail() {
  echo "Deployment runner preflight failed: $*" >&2
  exit 1
}

file_mode() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    stat -f '%Lp' "$1"
  fi
}

require_private_regular_file() {
  local path="$1"
  local label="$2"
  local mode

  [ -n "$path" ] || fail "$label is empty"
  case "$path" in
    /*) ;;
    *) fail "$label must be an absolute path" ;;
  esac
  [ ! -L "$path" ] || fail "$label must not be a symlink"
  [ -f "$path" ] || fail "$label must be a regular file"
  [ -r "$path" ] || fail "$label is not readable by the deployment runner"
  mode="$(file_mode "$path")"
  (( (8#$mode & 8#077) == 0 )) || fail "$label must not be readable by group or others"
}

require_known_hosts_file() {
  local path="$1"
  local mode

  [ -n "$path" ] || fail "SSH_KNOWN_HOSTS is empty"
  case "$path" in
    /*) ;;
    *) fail "SSH_KNOWN_HOSTS must be an absolute path" ;;
  esac
  [ ! -L "$path" ] || fail "SSH_KNOWN_HOSTS must not be a symlink"
  [ -f "$path" ] || fail "SSH_KNOWN_HOSTS must be a regular file"
  [ -r "$path" ] || fail "SSH_KNOWN_HOSTS is not readable by the deployment runner"
  mode="$(file_mode "$path")"
  (( (8#$mode & 8#022) == 0 )) || fail "SSH_KNOWN_HOSTS must not be writable by group or others"
}

if ! [[ "$EXPECTED_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  fail "DPP_DEPLOY_RUNNER_USER must be a valid Linux account name"
fi
if [ "$(id -un)" != "$EXPECTED_USER" ]; then
  fail "must run as $EXPECTED_USER, not $(id -un)"
fi

for command in bash git scp ssh; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is unavailable: $command"
done

[ ! -L "$CONFIG_FILE" ] || fail "DPP_DEPLOY_CONFIG_FILE must not be a symlink"
[ -f "$CONFIG_FILE" ] || fail "DPP_DEPLOY_CONFIG_FILE must be a regular file"
[ -r "$CONFIG_FILE" ] || fail "DPP_DEPLOY_CONFIG_FILE is not readable by the deployment runner"
config_mode="$(file_mode "$CONFIG_FILE")"
(( (8#$config_mode & 8#077) == 0 )) || fail "DPP_DEPLOY_CONFIG_FILE must not be readable by group or others"

oci_backend_ip=""
oci_frontend_ip=""
oci_user=""
ssh_key=""
ssh_known_hosts=""
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
    *) fail "invalid deployment configuration at line $line_number" ;;
  esac

  key="${line%%=*}"
  value="${line#*=}"
  case "$key" in
    OCI_BACKEND_IP|OCI_FRONTEND_IP|OCI_USER|SSH_KEY|SSH_KNOWN_HOSTS) ;;
    *) fail "unsupported deployment configuration key at line $line_number" ;;
  esac
  case "$seen_keys" in
    *"|$key|"*) fail "duplicate deployment configuration key: $key" ;;
    *) seen_keys="${seen_keys}${key}|" ;;
  esac
  [ -n "$value" ] || fail "deployment configuration value is empty: $key"

  case "$key" in
    OCI_BACKEND_IP) oci_backend_ip="$value" ;;
    OCI_FRONTEND_IP) oci_frontend_ip="$value" ;;
    OCI_USER) oci_user="$value" ;;
    SSH_KEY) ssh_key="$value" ;;
    SSH_KNOWN_HOSTS) ssh_known_hosts="$value" ;;
  esac
done < "$CONFIG_FILE"

for host in "$oci_backend_ip" "$oci_frontend_ip"; do
  [[ "$host" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ ]] || fail "configured OCI host is invalid"
done
[[ "$oci_user" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "configured OCI user is invalid"
require_private_regular_file "$ssh_key" "SSH_KEY"
require_known_hosts_file "$ssh_known_hosts"

git rev-parse --show-toplevel >/dev/null 2>&1 || fail "must run from a Git checkout"

echo "Deployment runner preflight passed."
