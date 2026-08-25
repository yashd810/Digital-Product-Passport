#!/bin/bash -p
#
# Root-owned OCI release entry point.  This file is intentionally installed as
# /usr/local/sbin/dpp-release-deployer by install-root-release-deployer.sh and
# is never executed directly from an application checkout.  It is the small,
# stable trust anchor that turns a reviewed Git revision into the immutable
# /opt/dpp release used by infra/oracle/deploy-prod.sh.

set -euo pipefail
PATH="/usr/sbin:/usr/bin:/sbin:/bin"
export PATH
umask 077

readonly INSTALL_PATH="/usr/local/sbin/dpp-release-deployer"
readonly APP_DIR="/opt/dpp"
readonly RELEASES_DIR="/opt/dpp-releases"
readonly RELEASE_LOCK_DIR="/var/lock/dpp"
readonly RELEASE_LOCK_FILE="/var/lock/dpp/release-stage.lock"
readonly ENV_FILE="/etc/dpp/dpp.env"
readonly REPOSITORY_URL="git@github.com:yashd810/Digital-Product-Passport.git"
readonly BRANCH="main"
readonly GIT_DEPLOY_KEY="/etc/dpp/release-readonly.key"
readonly GIT_KNOWN_HOSTS="/etc/dpp/release-known_hosts"

fail() {
  echo "DPP root release deployer: $*" >&2
  exit 1
}

file_mode() {
  /usr/bin/stat -c '%a' -- "$1"
}

file_owner() {
  /usr/bin/stat -c '%u:%g' -- "$1"
}

require_root_owned_safe_directory() {
  local path="$1"
  local mode

  [ -n "$path" ] || fail "directory path is empty"
  [ ! -L "$path" ] || fail "directory must not be a symlink: $path"
  [ -d "$path" ] || fail "directory is missing: $path"
  [ "$(file_owner "$path")" = "0:0" ] || fail "directory must be owned by root:root: $path"
  mode="$(file_mode "$path")"
  (( (8#$mode & 8#022) == 0 )) || fail "directory must not be writable by group or others: $path"
}

require_root_owned_private_directory() {
  local path="$1"
  local mode

  require_root_owned_safe_directory "$path"
  mode="$(file_mode "$path")"
  (( (8#$mode & 8#077) == 0 )) || fail "directory must not be accessible to group or others: $path"
}

require_root_owned_regular_file() {
  local path="$1"
  local label="$2"
  local mode

  [ ! -L "$path" ] || fail "$label must not be a symlink: $path"
  [ -f "$path" ] || fail "$label must be a regular file: $path"
  [ "$(file_owner "$path")" = "0:0" ] || fail "$label must be owned by root:root: $path"
  mode="$(file_mode "$path")"
  (( (8#$mode & 8#022) == 0 )) || fail "$label must not be writable by group or others: $path"
}

require_root_owned_private_file() {
  local path="$1"
  local label="$2"
  local mode

  require_root_owned_regular_file "$path" "$label"
  mode="$(file_mode "$path")"
  (( (8#$mode & 8#077) == 0 )) || fail "$label must not be readable by group or others: $path"
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

sha256_file() {
  /usr/bin/sha256sum -- "$1" | /usr/bin/awk '{ print $1 }'
}

require_installed_entrypoint() {
  [ "${BASH_SOURCE[0]}" = "$INSTALL_PATH" ] || fail "must run from $INSTALL_PATH"
  require_safe_parent_chain "/usr/local/sbin"
  require_root_owned_private_file "$INSTALL_PATH" "installed release entry point"
}

require_git_identity() {
  require_safe_parent_chain "/etc/dpp"
  require_root_owned_private_file "$GIT_DEPLOY_KEY" "release Git deploy key"
  require_root_owned_regular_file "$GIT_KNOWN_HOSTS" "release Git known_hosts file"
}

require_command() {
  local command="$1"
  [ -x "$command" ] || fail "required command is unavailable: $command"
}

require_expected_entrypoint_digest() {
  local expected="$1"
  local actual

  [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || fail "expected entry point digest must be a lowercase SHA-256 value"
  actual="$(sha256_file "$INSTALL_PATH")"
  [ "$actual" = "$expected" ] || fail "installed release entry point digest does not match the approved runner release"
}

assert_no_unsafe_tree_entries() {
  local tree="$1"
  local label="$2"
  local match

  [ ! -L "$tree" ] || fail "$label must not be a symlink: $tree"
  [ -d "$tree" ] || fail "$label is missing: $tree"
  if /usr/bin/mountpoint -q -- "$tree"; then
    fail "$label must not be a separate mount point: $tree"
  fi
  # A compromised former checkout must not smuggle a nested bind mount into
  # the root-only archive.  /proc/self/mountinfo is available on the OCI Linux
  # hosts; paths used here are fixed, ASCII paths with no mountinfo escaping.
  [ -r /proc/self/mountinfo ] || fail "cannot inspect mount table for $label"
  if /usr/bin/awk -v tree="$tree" '$5 == tree || index($5, tree "/") == 1 { found=1; exit } END { exit(found ? 0 : 1) }' /proc/self/mountinfo; then
    fail "$label contains a nested mount point"
  fi

  match="$(/usr/bin/find "$tree" -xdev -type l -print -quit)"
  [ -z "$match" ] || fail "$label contains a symbolic link: $match"
  match="$(/usr/bin/find "$tree" -xdev \( -type b -o -type c -o -type p -o -type s \) -print -quit)"
  [ -z "$match" ] || fail "$label contains an unsafe special file: $match"
}

assert_root_immutable_tree() {
  local tree="$1"
  local label="$2"
  local match

  assert_no_unsafe_tree_entries "$tree" "$label"
  match="$(/usr/bin/find "$tree" -xdev \( ! -user root -o ! -group root \) -print -quit)"
  [ -z "$match" ] || fail "$label is not owned by root:root: $match"
  match="$(/usr/bin/find "$tree" -xdev -perm /022 -print -quit)"
  [ -z "$match" ] || fail "$label is writable by group or others: $match"
}

git_run() {
  local git_ssh_command

  # Do not inherit system, global, user, or existing checkout configuration.
  # The fixed SSH invocation also ignores SSH config and accepts only the
  # root-managed GitHub host key and read-only deploy key.
  git_ssh_command="/usr/bin/ssh -F /dev/null -i $GIT_DEPLOY_KEY -o IdentitiesOnly=yes -o UserKnownHostsFile=$GIT_KNOWN_HOSTS -o GlobalKnownHostsFile=/dev/null -o StrictHostKeyChecking=yes -o BatchMode=yes -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o Hostname=github.com -o HostKeyAlias=github.com -o User=git"
  /usr/bin/env -i \
    PATH=/usr/bin:/bin \
    HOME=/root \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_TERMINAL_PROMPT=0 \
    GIT_ASKPASS=/bin/false \
    GIT_ALLOW_PROTOCOL=ssh \
    GIT_SSH_COMMAND="$git_ssh_command" \
    /usr/bin/git \
      -c core.hooksPath=/dev/null \
      -c core.fsmonitor=false \
      -c protocol.file.allow=never \
      -c protocol.ext.allow=never \
      -c protocol.git.allow=never \
      -c protocol.http.allow=never \
      -c protocol.https.allow=never \
      "$@"
}

prepare_release_directory() {
  local opt_device
  local releases_device

  require_safe_parent_chain "/opt"
  [ ! -L "$RELEASES_DIR" ] || fail "release staging directory must not be a symlink: $RELEASES_DIR"
  if [ -e "$RELEASES_DIR" ]; then
    require_root_owned_private_directory "$RELEASES_DIR"
  else
    /usr/bin/install -d -o root -g root -m 0700 -- "$RELEASES_DIR"
  fi
  require_root_owned_private_directory "$RELEASES_DIR"
  opt_device="$(/usr/bin/stat -c '%d' -- /opt)"
  releases_device="$(/usr/bin/stat -c '%d' -- "$RELEASES_DIR")"
  [ "$opt_device" = "$releases_device" ] || fail "release staging directory must share /opt's filesystem for an atomic release swap"
}

validate_requested_release() {
  local revision="$1"
  local target="$2"
  local compose_project="$3"
  local remove_orphans="$4"
  local initialize_postgres_volume="$5"
  local initialize_local_storage_volume="$6"
  local timeout_seconds="$7"

  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || fail "release revision must be a full lowercase Git SHA"
  case "$target" in
    backend|frontend|all) ;;
    *) fail "deployment target must be backend, frontend, or all" ;;
  esac
  if [ -n "$compose_project" ] && ! [[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
    fail "compose project name is invalid"
  fi
  for value in "$remove_orphans" "$initialize_postgres_volume" "$initialize_local_storage_volume"; do
    case "$value" in
      ''|true|false) ;;
      *) fail "boolean deployment options must be true or false when set" ;;
    esac
  done
  [[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || fail "deployment timeout must be a positive integer"
  [ "$timeout_seconds" -le 7200 ] || fail "deployment timeout must not exceed 7200 seconds"
}

stage_requested_release() {
  local revision="$1"
  local stage_dir
  local status
  local clean_preview

  stage_dir="$(/usr/bin/mktemp -d "$RELEASES_DIR/.stage.XXXXXXXXXX")"
  [ ! -L "$stage_dir" ] || fail "new release staging directory must not be a symlink"
  [ "$(file_owner "$stage_dir")" = "0:0" ] || fail "new release staging directory must be root-owned"
  [ "$(file_mode "$stage_dir")" = "700" ] || fail "new release staging directory must have mode 700"
  RELEASE_STAGE_DIR="$stage_dir"

  git_run -C "$stage_dir" init --initial-branch="$BRANCH"
  git_run -C "$stage_dir" config --local core.hooksPath /dev/null
  git_run -C "$stage_dir" config --local core.fsmonitor false
  git_run -C "$stage_dir" config --local protocol.file.allow never
  git_run -C "$stage_dir" remote add origin "$REPOSITORY_URL"
  git_run -C "$stage_dir" sparse-checkout init --no-cone
  git_run -C "$stage_dir" sparse-checkout set '/*' '!/local-tools/'
  git_run -C "$stage_dir" fetch --no-tags --no-recurse-submodules origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  git_run -C "$stage_dir" cat-file -e "$revision^{commit}"
  if ! git_run -C "$stage_dir" merge-base --is-ancestor "$revision" "refs/remotes/origin/$BRANCH"; then
    fail "requested deployment revision is not reachable from origin/$BRANCH"
  fi
  git_run -C "$stage_dir" checkout --detach --no-recurse-submodules "$revision"
  git_run -C "$stage_dir" sparse-checkout reapply

  [ "$(git_run -C "$stage_dir" rev-parse HEAD)" = "$revision" ] || fail "checked-out revision does not match the requested release"
  [ "$(git_run -C "$stage_dir" config --local --get core.hooksPath)" = "/dev/null" ] || fail "Git hooks must remain disabled in the release staging tree"
  if git_run -C "$stage_dir" ls-files --stage | /usr/bin/awk '$1 == "160000" { found=1 } END { exit(found ? 0 : 1) }'; then
    fail "Git submodules are not permitted in a root deployment release"
  fi
  [ ! -e "$stage_dir/.gitmodules" ] || fail "Git submodules are not permitted in a root deployment release"

  status="$(git_run -C "$stage_dir" status --porcelain=v1 --untracked-files=all)"
  [ -z "$status" ] || fail "fresh release staging tree has modified or untracked source"
  clean_preview="$(git_run -C "$stage_dir" clean -ndx)"
  [ -z "$clean_preview" ] || fail "fresh release staging tree has ignored or untracked source"

  assert_root_immutable_tree "$stage_dir" "fresh release staging tree"
}

archive_existing_release() {
  local stage_device
  local app_device
  local archive_dir

  PREVIOUS_RELEASE_DIR=""
  [ ! -L "$APP_DIR" ] || fail "existing application directory must not be a symlink"
  [ ! -e "$APP_DIR" ] && return 0
  [ -d "$APP_DIR" ] || fail "existing application path must be a directory"
  assert_no_unsafe_tree_entries "$APP_DIR" "existing application directory"
  stage_device="$(/usr/bin/stat -c '%d' -- "$RELEASES_DIR")"
  app_device="$(/usr/bin/stat -c '%d' -- "$APP_DIR")"
  [ "$stage_device" = "$app_device" ] || fail "existing application directory must share /opt's filesystem for an atomic release swap"

  archive_dir="$(/usr/bin/mktemp -d "$RELEASES_DIR/.previous.XXXXXXXXXX")"
  /usr/bin/rmdir -- "$archive_dir"
  /usr/bin/mv -- "$APP_DIR" "$archive_dir"
  # Do not recursively chown/chmod a checkout that was writable by the former
  # deployment user: a retained descriptor could race a recursive traversal.
  # Sealing the archive root immediately removes path access for that user;
  # this archive is forensic-only and must never be executed.  A rollback is
  # always a fresh trusted Git staging operation for the recorded SHA.
  /usr/bin/chown -h root:root -- "$archive_dir"
  /usr/bin/chmod 0700 -- "$archive_dir"
  require_root_owned_private_directory "$archive_dir"
  PREVIOUS_RELEASE_DIR="$archive_dir"
}

activate_staged_release() {
  local revision="$1"

  archive_existing_release
  if ! /usr/bin/mv -- "$RELEASE_STAGE_DIR" "$APP_DIR"; then
    if [ -n "$PREVIOUS_RELEASE_DIR" ]; then
      /usr/bin/mv -- "$PREVIOUS_RELEASE_DIR" "$APP_DIR" || fail "failed to restore the previous release after an activation failure"
    fi
    fail "failed to activate the root-owned staged release"
  fi
  RELEASE_STAGE_DIR=""
  assert_root_immutable_tree "$APP_DIR" "active release"
  [ "$(git_run -C "$APP_DIR" rev-parse HEAD)" = "$revision" ] || fail "active release revision does not match the requested release"

  if [ -n "$PREVIOUS_RELEASE_DIR" ]; then
    echo "Quarantined the prior checkout at $PREVIOUS_RELEASE_DIR (root-owned archive; roll back only by redeploying its known Git SHA)."
  fi
}

run_deployment() {
  local target="$1"
  local compose_project="$2"
  local remove_orphans="$3"
  local initialize_postgres_volume="$4"
  local initialize_local_storage_volume="$5"
  local timeout_seconds="$6"
  local deploy_env=(
    /usr/bin/env -i
    PATH=/usr/sbin:/usr/bin:/sbin:/bin
    HOME=/root
    APP_DIR="$APP_DIR"
    DPP_ENV_FILE="$ENV_FILE"
    DPP_DEPLOY_TARGET="$target"
  )

  [ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || fail "production environment file is missing or symlinked: $ENV_FILE"
  require_root_owned_private_file "$ENV_FILE" "production environment file"
  require_root_owned_regular_file "$APP_DIR/infra/oracle/deploy-prod.sh" "production deployment script"

  [ -z "$compose_project" ] || deploy_env+=(COMPOSE_PROJECT_NAME="$compose_project")
  [ -z "$remove_orphans" ] || deploy_env+=(DPP_REMOVE_ORPHANS="$remove_orphans")
  [ -z "$initialize_postgres_volume" ] || deploy_env+=(DPP_INITIALIZE_POSTGRES_VOLUME="$initialize_postgres_volume")
  [ -z "$initialize_local_storage_volume" ] || deploy_env+=(DPP_INITIALIZE_LOCAL_STORAGE_VOLUME="$initialize_local_storage_volume")

  /usr/bin/timeout --foreground "$timeout_seconds" "${deploy_env[@]}" /bin/bash "$APP_DIR/infra/oracle/deploy-prod.sh"
}

RELEASE_STAGE_DIR=""
PREVIOUS_RELEASE_DIR=""
cleanup_staging_release() {
  local status=$?

  if [ -n "$RELEASE_STAGE_DIR" ] && [ -d "$RELEASE_STAGE_DIR" ] && [ ! -L "$RELEASE_STAGE_DIR" ]; then
    /usr/bin/rm -rf -- "$RELEASE_STAGE_DIR"
  fi
  exit "$status"
}
trap cleanup_staging_release EXIT

[ "$(/usr/bin/id -u)" -eq 0 ] || fail "must run as root through the dedicated sudo rule"
require_installed_entrypoint
require_command /usr/bin/git
require_command /usr/bin/ssh
require_command /usr/bin/sha256sum
require_command /usr/bin/mktemp
require_command /usr/bin/mountpoint
require_command /usr/bin/flock
require_command /usr/bin/timeout
require_git_identity
prepare_release_directory

if [ "$#" -eq 3 ] && [ "$1" = "--preflight" ] && [ "$2" = "--expected-helper-sha" ]; then
  require_expected_entrypoint_digest "$3"
  echo "DPP root release deployer preflight passed."
  exit 0
fi

revision=""
target=""
compose_project=""
remove_orphans=""
initialize_postgres_volume=""
initialize_local_storage_volume=""
timeout_seconds="1800"
expected_helper_sha=""
seen_revision=false
seen_target=false
seen_compose_project=false
seen_remove_orphans=false
seen_initialize_postgres_volume=false
seen_initialize_local_storage_volume=false
seen_timeout=false
seen_expected_helper_sha=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --revision)
      [ "$seen_revision" = false ] || fail "--revision may be supplied only once"
      [ "$#" -ge 2 ] || fail "--revision requires a value"
      revision="$2"
      seen_revision=true
      shift 2
      ;;
    --target)
      [ "$seen_target" = false ] || fail "--target may be supplied only once"
      [ "$#" -ge 2 ] || fail "--target requires a value"
      target="$2"
      seen_target=true
      shift 2
      ;;
    --compose-project)
      [ "$seen_compose_project" = false ] || fail "--compose-project may be supplied only once"
      [ "$#" -ge 2 ] || fail "--compose-project requires a value"
      compose_project="$2"
      seen_compose_project=true
      shift 2
      ;;
    --remove-orphans)
      [ "$seen_remove_orphans" = false ] || fail "--remove-orphans may be supplied only once"
      [ "$#" -ge 2 ] || fail "--remove-orphans requires a value"
      remove_orphans="$2"
      seen_remove_orphans=true
      shift 2
      ;;
    --initialize-postgres-volume)
      [ "$seen_initialize_postgres_volume" = false ] || fail "--initialize-postgres-volume may be supplied only once"
      [ "$#" -ge 2 ] || fail "--initialize-postgres-volume requires a value"
      initialize_postgres_volume="$2"
      seen_initialize_postgres_volume=true
      shift 2
      ;;
    --initialize-local-storage-volume)
      [ "$seen_initialize_local_storage_volume" = false ] || fail "--initialize-local-storage-volume may be supplied only once"
      [ "$#" -ge 2 ] || fail "--initialize-local-storage-volume requires a value"
      initialize_local_storage_volume="$2"
      seen_initialize_local_storage_volume=true
      shift 2
      ;;
    --timeout-seconds)
      [ "$seen_timeout" = false ] || fail "--timeout-seconds may be supplied only once"
      [ "$#" -ge 2 ] || fail "--timeout-seconds requires a value"
      timeout_seconds="$2"
      seen_timeout=true
      shift 2
      ;;
    --expected-helper-sha)
      [ "$seen_expected_helper_sha" = false ] || fail "--expected-helper-sha may be supplied only once"
      [ "$#" -ge 2 ] || fail "--expected-helper-sha requires a value"
      expected_helper_sha="$2"
      seen_expected_helper_sha=true
      shift 2
      ;;
    *)
      fail "unsupported argument: $1"
      ;;
  esac
done

[ "$seen_revision" = true ] || fail "--revision is required"
[ "$seen_target" = true ] || fail "--target is required"
[ "$seen_expected_helper_sha" = true ] || fail "--expected-helper-sha is required"
require_expected_entrypoint_digest "$expected_helper_sha"
validate_requested_release \
  "$revision" \
  "$target" \
  "$compose_project" \
  "$remove_orphans" \
  "$initialize_postgres_volume" \
  "$initialize_local_storage_volume" \
  "$timeout_seconds"

/usr/bin/install -d -o root -g root -m 0700 -- "$RELEASE_LOCK_DIR"
require_root_owned_private_directory "$RELEASE_LOCK_DIR"
[ ! -L "$RELEASE_LOCK_FILE" ] || fail "release staging lock must not be a symlink"
if [ -e "$RELEASE_LOCK_FILE" ] && [ ! -f "$RELEASE_LOCK_FILE" ]; then
  fail "release staging lock must be a regular file"
fi
exec 9>"$RELEASE_LOCK_FILE"
/usr/bin/flock -n 9 || fail "another root release deployment is already staging or deploying"

stage_requested_release "$revision"
activate_staged_release "$revision"
run_deployment \
  "$target" \
  "$compose_project" \
  "$remove_orphans" \
  "$initialize_postgres_volume" \
  "$initialize_local_storage_volume" \
  "$timeout_seconds"
