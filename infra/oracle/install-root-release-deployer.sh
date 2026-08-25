#!/usr/bin/env bash
# Installs the root-owned DPP release entry point.  This is a one-time
# bootstrap operation and must be run only from independently verified source
# by a root operator; the normal deployment account must not be able to run it.

set -euo pipefail
umask 077

readonly INSTALL_PATH="/usr/local/sbin/dpp-release-deployer"
readonly INSTALL_DIRECTORY="/usr/local/sbin"
readonly SOURCE_PATH="${DPP_ROOT_RELEASE_DEPLOYER_SOURCE:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/dpp-root-release-deployer.sh}"
readonly EXPECTED_SHA256="${DPP_ROOT_RELEASE_DEPLOYER_SHA256:-}"

fail() {
  echo "DPP root release deployer install: $*" >&2
  exit 1
}

file_mode() {
  /usr/bin/stat -c '%a' -- "$1"
}

file_owner() {
  /usr/bin/stat -c '%u:%g' -- "$1"
}

sha256_file() {
  /usr/bin/sha256sum -- "$1" | /usr/bin/awk '{ print $1 }'
}

require_root_owned_safe_directory() {
  local path="$1"
  local directory_mode

  [ ! -L "$path" ] || fail "directory must not be a symlink: $path"
  [ -d "$path" ] || fail "directory is missing: $path"
  [ "$(file_owner "$path")" = "0:0" ] || fail "directory must be owned by root:root: $path"
  directory_mode="$(file_mode "$path")"
  (( (8#$directory_mode & 8#022) == 0 )) || fail "directory must not be writable by group or others: $path"
}

require_safe_parent_chain() {
  local path="$1"
  local current="$path"

  while :; do
    require_root_owned_safe_directory "$current"
    [ "$current" = "/" ] && break
    current="${current%/*}"
    [ -n "$current" ] || current="/"
  done
}

[ "$(/usr/bin/id -u)" -eq 0 ] || fail "must run as root"
[[ "$EXPECTED_SHA256" =~ ^[a-f0-9]{64}$ ]] || fail "DPP_ROOT_RELEASE_DEPLOYER_SHA256 must be the independently verified lowercase SHA-256 of the entry point"
[[ "$SOURCE_PATH" = /* ]] || fail "entry point source path must be absolute"
[ ! -L "$SOURCE_PATH" ] || fail "entry point source must not be a symlink: $SOURCE_PATH"
[ -f "$SOURCE_PATH" ] || fail "entry point source must be a regular file: $SOURCE_PATH"
[ "$(file_owner "$SOURCE_PATH")" = "0:0" ] || fail "entry point source must be owned by root:root"
mode="$(file_mode "$SOURCE_PATH")"
(( (8#$mode & 8#022) == 0 )) || fail "entry point source must not be writable by group or others"
require_safe_parent_chain "$(/usr/bin/dirname -- "$SOURCE_PATH")"
require_safe_parent_chain "$INSTALL_DIRECTORY"

temporary_file="$(/usr/bin/mktemp "$INSTALL_DIRECTORY/.dpp-release-deployer.XXXXXXXXXX")"
cleanup() {
  /usr/bin/rm -f -- "$temporary_file"
}
trap cleanup EXIT

# Copy first, then verify the root-owned private copy.  This prevents a source
# checkout from changing between a checksum read and the installed write.
/usr/bin/install -o root -g root -m 0700 -- "$SOURCE_PATH" "$temporary_file"
[ "$(sha256_file "$temporary_file")" = "$EXPECTED_SHA256" ] || fail "entry point source digest did not match DPP_ROOT_RELEASE_DEPLOYER_SHA256"
[ ! -L "$INSTALL_PATH" ] || fail "existing installed entry point must not be a symlink"
if [ -e "$INSTALL_PATH" ] && [ ! -f "$INSTALL_PATH" ]; then
  fail "existing installed entry point must be a regular file"
fi
/usr/bin/install -o root -g root -m 0700 -- "$temporary_file" "$INSTALL_PATH"

[ ! -L "$INSTALL_PATH" ] || fail "installed entry point must not be a symlink"
[ "$(file_owner "$INSTALL_PATH")" = "0:0" ] || fail "installed entry point must be owned by root:root"
mode="$(file_mode "$INSTALL_PATH")"
[ "$mode" = "700" ] || fail "installed entry point must have mode 700"
[ "$(sha256_file "$INSTALL_PATH")" = "$EXPECTED_SHA256" ] || fail "installed entry point digest changed after installation"

echo "Installed root-owned DPP release entry point at $INSTALL_PATH."
