#!/usr/bin/env bash
# Installs one dedicated GitHub Actions deployment runner. Run this only on the
# separate, private OCI runner VM created for DPP production deployments.

set -euo pipefail
umask 077

RUNNER_USER="${DPP_DEPLOY_RUNNER_USER:-dpp-deploy}"
RUNNER_HOME="${DPP_DEPLOY_RUNNER_HOME:-/opt/actions-runner}"
RUNNER_URL="${DPP_GITHUB_RUNNER_URL:-}"
RUNNER_TOKEN="${DPP_GITHUB_RUNNER_TOKEN:-}"
RUNNER_VERSION="${DPP_GITHUB_RUNNER_VERSION:-}"
RUNNER_SHA256="${DPP_GITHUB_RUNNER_SHA256:-}"
RUNNER_NAME="${DPP_GITHUB_RUNNER_NAME:-$(hostname)-dpp-production-deploy}"
RUNNER_LABELS="${DPP_GITHUB_RUNNER_LABELS:-dpp-production-deploy}"
RUNNER_GROUP="${DPP_GITHUB_RUNNER_GROUP:-DPP Production Deployment}"
RUNNER_GROUP_PATTERN='^[A-Za-z0-9][A-Za-z0-9 _.:-]{0,79}$'

fail() {
  echo "Deployment-runner bootstrap failed: $*" >&2
  exit 1
}

file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

[ "$(id -u)" -eq 0 ] || fail "must run as root on the dedicated deployment runner"
[[ "$RUNNER_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "DPP_DEPLOY_RUNNER_USER is invalid"
case "$RUNNER_HOME" in
  /opt/*) ;;
  *) fail "DPP_DEPLOY_RUNNER_HOME must be under /opt" ;;
esac
case "$RUNNER_HOME" in
  *'/../'*|*/..|*'/./'*|*/.) fail "DPP_DEPLOY_RUNNER_HOME must not contain path traversal" ;;
esac
[ ! -L "$RUNNER_HOME" ] || fail "DPP_DEPLOY_RUNNER_HOME must not be a symlink"
[[ "$RUNNER_URL" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?$ ]] || fail "DPP_GITHUB_RUNNER_URL must be an exact GitHub repository URL"
[[ "$RUNNER_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "DPP_GITHUB_RUNNER_VERSION must be a runner release version"
[[ "$RUNNER_SHA256" =~ ^[a-fA-F0-9]{64}$ ]] || fail "DPP_GITHUB_RUNNER_SHA256 must be a SHA-256 digest"
[[ "$RUNNER_TOKEN" =~ ^[A-Za-z0-9._-]{20,}$ ]] || fail "DPP_GITHUB_RUNNER_TOKEN is missing or malformed"
[[ "$RUNNER_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$ ]] || fail "DPP_GITHUB_RUNNER_NAME is invalid"
[[ "$RUNNER_LABELS" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*(,[A-Za-z0-9][A-Za-z0-9_.-]*)*$ ]] || fail "DPP_GITHUB_RUNNER_LABELS is invalid"
[[ "$RUNNER_GROUP" =~ $RUNNER_GROUP_PATTERN ]] || fail "DPP_GITHUB_RUNNER_GROUP is invalid"

for command in curl tar git ssh scp sudo; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is unavailable: $command"
done

if ! id "$RUNNER_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$RUNNER_USER" --shell /bin/bash "$RUNNER_USER"
fi

if [ -e "$RUNNER_HOME/.runner" ] || [ -e "$RUNNER_HOME/.credentials" ]; then
  fail "an Actions runner is already configured at $RUNNER_HOME"
fi
if [ -e "$RUNNER_HOME" ] && [ -n "$(find "$RUNNER_HOME" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  fail "runner directory must be empty: $RUNNER_HOME"
fi

install -d -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0750 "$RUNNER_HOME"
install -d -o root -g "$RUNNER_USER" -m 0750 /etc/dpp-deployer

archive="$(mktemp /tmp/dpp-actions-runner.XXXXXXXX.tar.gz)"
cleanup() {
  rm -f -- "$archive"
}
trap cleanup EXIT

archive_url="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
curl --fail --location --proto '=https' --tlsv1.2 --output "$archive" "$archive_url"
actual_sha256="$(file_sha256 "$archive" | tr '[:upper:]' '[:lower:]')"
expected_sha256="$(printf '%s' "$RUNNER_SHA256" | tr '[:upper:]' '[:lower:]')"
if [ "$actual_sha256" != "$expected_sha256" ]; then
  fail "GitHub Actions runner archive digest did not match DPP_GITHUB_RUNNER_SHA256"
fi

tar -xzf "$archive" -C "$RUNNER_HOME"
chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_HOME"

sudo -u "$RUNNER_USER" "$RUNNER_HOME/config.sh" \
  --unattended \
  --url "$RUNNER_URL" \
  --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --runnergroup "$RUNNER_GROUP" \
  --work _work

"$RUNNER_HOME/svc.sh" install "$RUNNER_USER"
"$RUNNER_HOME/svc.sh" start

echo "Dedicated Actions deployment runner installed."
echo "Install the OCI SSH deployment configuration next with scripts/deploy/install-deployment-runner-config.sh."
