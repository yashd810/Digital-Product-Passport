#!/bin/bash -p
# OCI Deployment Script - Robust version with proper SSH handling
# Usage: SSH_KEY="/path/to/key" OCI_IP="your-ip" DPP_DEPLOY_TARGET=backend bash scripts/deploy/deploy-to-oci.sh

set -euo pipefail
umask 077
PATH="/usr/sbin:/usr/bin:/sbin:/bin"
export PATH

# Configuration
OCI_USER="${OCI_USER:-}"
OCI_IP="${OCI_IP:-}"
SSH_KEY="${SSH_KEY:-}"
OCI_BACKEND_SSH_KEY="${OCI_BACKEND_SSH_KEY:-}"
OCI_FRONTEND_SSH_KEY="${OCI_FRONTEND_SSH_KEY:-}"
SSH_KNOWN_HOSTS="${SSH_KNOWN_HOSTS:-}"
DEPLOY_TARGET="${DPP_DEPLOY_TARGET:-}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"
REMOVE_ORPHANS="${DPP_REMOVE_ORPHANS:-}"
INITIALIZE_POSTGRES_VOLUME="${DPP_INITIALIZE_POSTGRES_VOLUME:-}"
INITIALIZE_LOCAL_STORAGE_VOLUME="${DPP_INITIALIZE_LOCAL_STORAGE_VOLUME:-}"
APP_DIR="/opt/dpp"
ENV_FILE="/etc/dpp/dpp.env"
SSH_CMD="/usr/bin/ssh"
TIMEOUT_SECONDS="${DPP_DEPLOY_TIMEOUT_SECONDS:-1800}"
TIMEOUT_CMD=""
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)"
PROJECT_ROOT="$(CDPATH= cd -- "$REPO_ROOT/../.." && pwd -P)"
DEPLOY_CONFIG_FILE="${DPP_DEPLOY_CONFIG_FILE:-$PROJECT_ROOT/env/oci-deploy.env}"
OCI_BACKEND_IP="${OCI_BACKEND_IP:-}"
OCI_FRONTEND_IP="${OCI_FRONTEND_IP:-}"
DEPLOY_REVISION=""
SSH_TARGET=""
ROOT_RELEASE_DEPLOYER_SOURCE="$REPO_ROOT/infra/oracle/dpp-root-release-deployer.sh"
ROOT_RELEASE_DEPLOYER_SHA256=""
# The root-owned release helper is intentionally exposed only through this
# dedicated, non-Docker, single-command sudo identity.  Permitting a legacy
# administrator account here would silently bypass the trust boundary even if
# the helper itself is installed correctly.
readonly REQUIRED_OCI_USER="dpp-release"

quote_for_remote() {
    printf '%q' "$1"
}

file_mode() {
    local file="$1"
    if stat -c '%a' "$file" >/dev/null 2>&1; then
        stat -c '%a' "$file"
    else
        stat -f '%Lp' "$file"
    fi
}

file_sha256() {
    local file="$1"

    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum -- "$file" | awk '{ print $1 }'
    else
        shasum -a 256 -- "$file" | awk '{ print $1 }'
    fi
}

require_optional_boolean() {
    local variable_name="$1"
    local value="$2"

    if [ -n "$value" ] && [ "$value" != "true" ] && [ "$value" != "false" ]; then
        echo "❌ $variable_name must be true or false when set."
        exit 1
    fi
}

require_private_key_file() {
    local mode

    if [ -L "$SSH_KEY" ] || [ ! -f "$SSH_KEY" ]; then
        echo "❌ SSH key is missing, not a regular file, or is a symlink."
        exit 1
    fi

    mode="$(file_mode "$SSH_KEY")"
    if (( (8#$mode & 8#077) != 0 )); then
        echo "❌ SSH key must not be readable by group or others."
        exit 1
    fi
}

require_trusted_known_hosts_file() {
    local mode

    if [ -L "$SSH_KNOWN_HOSTS" ] || [ ! -f "$SSH_KNOWN_HOSTS" ]; then
        echo "❌ SSH_KNOWN_HOSTS must point to an existing non-symlinked trusted known_hosts file."
        echo "   Verify the OCI host key fingerprint in the OCI Console before adding it."
        exit 1
    fi

    mode="$(file_mode "$SSH_KNOWN_HOSTS")"
    if (( (8#$mode & 8#022) != 0 )); then
        echo "❌ SSH_KNOWN_HOSTS must not be writable by group or others."
        exit 1
    fi
}

load_deploy_config() {
    local mode line key value

    if [ -L "$DEPLOY_CONFIG_FILE" ]; then
        echo "❌ Deployment configuration must not be a symlink."
        exit 1
    fi
    if [ ! -e "$DEPLOY_CONFIG_FILE" ]; then
        if [ -n "${DPP_DEPLOY_CONFIG_FILE:-}" ]; then
            echo "❌ DPP_DEPLOY_CONFIG_FILE does not exist."
            exit 1
        fi
        return
    fi
    if [ ! -f "$DEPLOY_CONFIG_FILE" ]; then
        echo "❌ Deployment configuration must be a regular file."
        exit 1
    fi

    mode="$(file_mode "$DEPLOY_CONFIG_FILE")"
    if (( (8#$mode & 8#077) != 0 )); then
        echo "❌ Deployment configuration must have mode 600."
        exit 1
    fi

    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in
            ''|'#'*) continue ;;
        esac
        case "$line" in
            *=*) ;;
            *)
                echo "❌ Invalid deployment configuration line in $DEPLOY_CONFIG_FILE"
                exit 1
                ;;
        esac
        key="${line%%=*}"
        value="${line#*=}"
        case "$key" in
            OCI_BACKEND_IP)
                [ -n "$OCI_BACKEND_IP" ] || OCI_BACKEND_IP="$value"
                ;;
            OCI_FRONTEND_IP)
                [ -n "$OCI_FRONTEND_IP" ] || OCI_FRONTEND_IP="$value"
                ;;
            OCI_USER)
                [ -n "$OCI_USER" ] || OCI_USER="$value"
                ;;
            SSH_KEY)
                [ -n "$SSH_KEY" ] || SSH_KEY="$value"
                ;;
            OCI_BACKEND_SSH_KEY)
                [ -n "$OCI_BACKEND_SSH_KEY" ] || OCI_BACKEND_SSH_KEY="$value"
                ;;
            OCI_FRONTEND_SSH_KEY)
                [ -n "$OCI_FRONTEND_SSH_KEY" ] || OCI_FRONTEND_SSH_KEY="$value"
                ;;
            SSH_KNOWN_HOSTS)
                [ -n "$SSH_KNOWN_HOSTS" ] || SSH_KNOWN_HOSTS="$value"
                ;;
            *)
                echo "❌ Unsupported deployment configuration key: $key"
                exit 1
                ;;
        esac
    done < "$DEPLOY_CONFIG_FILE"
}

ssh_target_for_host() {
    local user="$1"
    local host="$2"

    # SSH accepts brackets around IPv6 literals. The input is validated before
    # this helper is called.
    if [[ "$host" == *:* ]]; then
        printf '%s@[%s]' "$user" "$host"
    else
        printf '%s@%s' "$user" "$host"
    fi
}

if ! [[ "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
    echo "❌ DPP_DEPLOY_TIMEOUT_SECONDS must be a positive integer."
    exit 1
fi

if command -v timeout >/dev/null 2>&1; then
    TIMEOUT_CMD="timeout"
fi

load_deploy_config

OCI_USER="${OCI_USER:-dpp-release}"
SSH_KNOWN_HOSTS="${SSH_KNOWN_HOSTS:-${HOME:-}/.ssh/known_hosts}"

if [ -z "$DEPLOY_TARGET" ]; then
    echo "❌ DPP_DEPLOY_TARGET is required. Use one of: frontend, backend, all"
    echo "Examples:"
    echo "  DPP_DEPLOY_TARGET=frontend OCI_IP=<frontend-host-ip> bash scripts/deploy/deploy-to-oci.sh"
    echo "  DPP_DEPLOY_TARGET=backend OCI_IP=<backend-host-ip> bash scripts/deploy/deploy-to-oci.sh"
    exit 1
fi

case "$DEPLOY_TARGET" in
    frontend|backend|all) ;;
    *)
        echo "❌ Unsupported DPP_DEPLOY_TARGET: $DEPLOY_TARGET"
        echo "Use one of: frontend, backend, all"
        exit 1
        ;;
esac

require_optional_boolean "DPP_REMOVE_ORPHANS" "$REMOVE_ORPHANS"
require_optional_boolean "DPP_INITIALIZE_POSTGRES_VOLUME" "$INITIALIZE_POSTGRES_VOLUME"
require_optional_boolean "DPP_INITIALIZE_LOCAL_STORAGE_VOLUME" "$INITIALIZE_LOCAL_STORAGE_VOLUME"

if [ -n "$COMPOSE_PROJECT_NAME" ] && ! [[ "$COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
    echo "❌ COMPOSE_PROJECT_NAME must be a lowercase Docker Compose project name when set."
    exit 1
fi

if [ -z "$OCI_IP" ]; then
    case "$DEPLOY_TARGET" in
        backend) OCI_IP="$OCI_BACKEND_IP" ;;
        frontend) OCI_IP="$OCI_FRONTEND_IP" ;;
        all)
            if [ -n "$OCI_BACKEND_IP" ] || [ -n "$OCI_FRONTEND_IP" ]; then
                echo "❌ The configured OCI hosts are split. Deploy backend and frontend separately."
                exit 1
            fi
            ;;
    esac
fi

# Split production hosts use separate controller keys. Prefer the target's key
# over a generic key so a compromised controller credential cannot reach both
# hosts. SSH_KEY remains valid for an intentionally single-host deployment.
case "$DEPLOY_TARGET" in
    backend)
        [ -z "$OCI_BACKEND_SSH_KEY" ] || SSH_KEY="$OCI_BACKEND_SSH_KEY"
        ;;
    frontend)
        [ -z "$OCI_FRONTEND_SSH_KEY" ] || SSH_KEY="$OCI_FRONTEND_SSH_KEY"
        ;;
    all)
        if [ -n "$OCI_BACKEND_SSH_KEY" ] || [ -n "$OCI_FRONTEND_SSH_KEY" ]; then
            echo "❌ Target-specific SSH keys require separate backend and frontend deployments."
            exit 1
        fi
        ;;
esac

if [ -z "$OCI_IP" ]; then
    echo "❌ OCI_IP is required."
    echo "Examples:"
    echo "  DPP_DEPLOY_TARGET=frontend OCI_IP=<frontend-host-ip> bash scripts/deploy/deploy-to-oci.sh"
    echo "  DPP_DEPLOY_TARGET=backend OCI_IP=<backend-host-ip> bash scripts/deploy/deploy-to-oci.sh"
    exit 1
fi

if ! [[ "$OCI_IP" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ ]]; then
    echo "❌ OCI_IP must be a hostname, IPv4 address, or IPv6 address without shell metacharacters."
    exit 1
fi

if ! [[ "$OCI_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
    echo "❌ OCI_USER must be a valid Linux account name."
    exit 1
fi
if [ "$OCI_USER" != "$REQUIRED_OCI_USER" ]; then
    echo "❌ OCI_USER must be the dedicated restricted deployment account: $REQUIRED_OCI_USER."
    echo "   Do not use a legacy administrator, Docker-group, or broad-sudo account."
    exit 1
fi

if [ ! -d "$REPO_ROOT/.git" ]; then
    echo "❌ Deployment must be launched from a Git checkout: $REPO_ROOT"
    exit 1
fi
if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
    echo "❌ Refusing to deploy from a dirty checkout. Commit and push the intended revision first."
    exit 1
fi
DEPLOY_REVISION="$(git -C "$REPO_ROOT" rev-parse --verify HEAD)"
if ! [[ "$DEPLOY_REVISION" =~ ^[0-9a-f]{40}$ ]]; then
    echo "❌ Could not determine a full Git commit ID for deployment."
    exit 1
fi
if [ -L "$ROOT_RELEASE_DEPLOYER_SOURCE" ] || [ ! -f "$ROOT_RELEASE_DEPLOYER_SOURCE" ]; then
    echo "❌ Missing non-symlinked root release entry point source: $ROOT_RELEASE_DEPLOYER_SOURCE"
    exit 1
fi
if ! git -C "$REPO_ROOT" ls-files --error-unmatch -- "infra/oracle/dpp-root-release-deployer.sh" >/dev/null 2>&1; then
    echo "❌ The root release entry point must be a tracked release file."
    exit 1
fi
ROOT_RELEASE_DEPLOYER_SHA256="$(file_sha256 "$ROOT_RELEASE_DEPLOYER_SOURCE")"
if ! [[ "$ROOT_RELEASE_DEPLOYER_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
    echo "❌ Could not calculate the root release entry point SHA-256."
    exit 1
fi
SSH_TARGET="$(ssh_target_for_host "$OCI_USER" "$OCI_IP")"

if [ -z "$SSH_KEY" ]; then
    echo "❌ A deployment SSH key is required. Configure the target-specific OCI_*_SSH_KEY or SSH_KEY."
    echo "Example: OCI_BACKEND_SSH_KEY=/secure/path/backend.key DPP_DEPLOY_TARGET=backend OCI_IP=<backend-host-ip> bash scripts/deploy/deploy-to-oci.sh"
    exit 1
fi

echo "=================================="
echo "🚀 DPP OCI Deployment Script"
echo "=================================="
echo ""
echo "Configuration:"
echo "  Deploy Target: $DEPLOY_TARGET"
echo "  Compose Project: ${COMPOSE_PROJECT_NAME:-auto-detect}"
echo "  Timeout: ${TIMEOUT_SECONDS}s"
echo "  Live Edge Check: required"
echo "  Caddy Reload: required"
echo "  Revision: $DEPLOY_REVISION"
echo ""

require_private_key_file

require_trusted_known_hosts_file

echo "✅ SSH key and trusted host key file found"
echo ""

# Test SSH connection
echo "🔌 Testing SSH connection..."
SSH_OPTS=(
    -i "$SSH_KEY"
    -o IdentitiesOnly=yes
    -o UserKnownHostsFile="$SSH_KNOWN_HOSTS"
    -o GlobalKnownHostsFile=/dev/null
    -o StrictHostKeyChecking=yes
    -o PreferredAuthentications=publickey
    -o PasswordAuthentication=no
    -o KbdInteractiveAuthentication=no
    -o ConnectTimeout=10
    -o BatchMode=yes
    -o ServerAliveInterval=60
)

if $SSH_CMD "${SSH_OPTS[@]}" "$SSH_TARGET" "echo 'SSH OK'" > /dev/null 2>&1; then
    echo "✅ SSH connection successful"
else
    echo "❌ SSH connection failed to the configured OCI target."
    echo ""
    echo "Troubleshooting:"
    echo "1. Verify the configured target and approved private SSH route."
    echo "2. Check that SSH port 22 is allowed only from the approved deployment source."
    echo "3. Verify the private SSH key and trusted host key file permissions."
    echo ""
    exit 1
fi

echo ""
echo "📦 Starting remote deployment..."
echo ""

REMOTE_COMMAND="/usr/bin/sudo -n /usr/local/sbin/dpp-release-deployer"
append_remote_argument() {
    REMOTE_COMMAND="$REMOTE_COMMAND $(quote_for_remote "$1")"
}

append_remote_argument "--revision"
append_remote_argument "$DEPLOY_REVISION"
append_remote_argument "--target"
append_remote_argument "$DEPLOY_TARGET"
append_remote_argument "--expected-helper-sha"
append_remote_argument "$ROOT_RELEASE_DEPLOYER_SHA256"
append_remote_argument "--timeout-seconds"
append_remote_argument "$TIMEOUT_SECONDS"
if [ -n "$COMPOSE_PROJECT_NAME" ]; then
    append_remote_argument "--compose-project"
    append_remote_argument "$COMPOSE_PROJECT_NAME"
fi
if [ -n "$REMOVE_ORPHANS" ]; then
    append_remote_argument "--remove-orphans"
    append_remote_argument "$REMOVE_ORPHANS"
fi
if [ -n "$INITIALIZE_POSTGRES_VOLUME" ]; then
    append_remote_argument "--initialize-postgres-volume"
    append_remote_argument "$INITIALIZE_POSTGRES_VOLUME"
fi
if [ -n "$INITIALIZE_LOCAL_STORAGE_VOLUME" ]; then
    append_remote_argument "--initialize-local-storage-volume"
    append_remote_argument "$INITIALIZE_LOCAL_STORAGE_VOLUME"
fi

echo "🔒 Verifying the root-owned remote release entry point..."
if ! "$SSH_CMD" "${SSH_OPTS[@]}" "$SSH_TARGET" \
    "/usr/bin/sudo -n /usr/local/sbin/dpp-release-deployer --preflight --expected-helper-sha $(quote_for_remote "$ROOT_RELEASE_DEPLOYER_SHA256")"; then
    echo "❌ The remote root release entry point is missing, untrusted, or does not match this approved release."
    echo "   Bootstrap it as root using docs/deployment/oci-deployment-runbook.md before retrying."
    exit 1
fi

echo "✅ Root release entry point verified"
echo ""
echo "⏱️  Starting remote deployment (timeout: ${TIMEOUT_SECONDS}s)..."
echo "---"
DEPLOY_LOG="$(mktemp "${TMPDIR:-/tmp}/dpp-deploy-output.XXXXXX")"
chmod 600 "$DEPLOY_LOG"

# The remote command is a fixed root-owned entry point. It receives only
# validated, quoted scalar arguments; no mutable checkout or /tmp script is
# uploaded or executed with root privileges.
set +e
if [ -n "$TIMEOUT_CMD" ]; then
    ($TIMEOUT_CMD $((TIMEOUT_SECONDS + 30)) $SSH_CMD "${SSH_OPTS[@]}" "$SSH_TARGET" "$REMOTE_COMMAND" 2>&1) | tee "$DEPLOY_LOG"
else
    echo "⚠️  Local timeout command not found; running SSH deployment without local timeout wrapper."
    ($SSH_CMD "${SSH_OPTS[@]}" "$SSH_TARGET" "$REMOTE_COMMAND" 2>&1) | tee "$DEPLOY_LOG"
fi
PIPE_CODES=("${PIPESTATUS[@]}")
set -e

EXIT_CODE="${PIPE_CODES[0]}"
if [ "${PIPE_CODES[1]}" -ne 0 ]; then
    echo "❌ Unable to write the deployment log: $DEPLOY_LOG"
    EXIT_CODE="${PIPE_CODES[1]}"
fi

echo "---"
echo "📋 Deployment log saved to: $DEPLOY_LOG"
echo ""

if [ $EXIT_CODE -eq 0 ]; then
    LOG_SERVICE="backend-api"
    if [ "$DEPLOY_TARGET" = "frontend" ]; then
        LOG_SERVICE="frontend-app"
    fi
    echo "=================================="
    echo "✅ Deployment Complete!"
    echo "=================================="
    echo ""
    echo "📍 Next steps:"
    echo "1. Use the approved OCI runbook and administrator/Bastion access for diagnostics."
    echo "2. Check the ${LOG_SERVICE} service through the root-owned release evidence path."
    if [ "$DEPLOY_TARGET" != "frontend" ]; then
        echo "3. Verify backend health through the documented loopback and public edge checks."
    fi
    echo ""
    echo "✅ Deployment process completed (see above for details)"
    exit 0
elif [ $EXIT_CODE -eq 124 ]; then
    echo "❌ Deployment timed out after ${TIMEOUT_SECONDS}s. Check the host before retrying."
    exit 124
else
    echo "❌ Deployment process exited with code: $EXIT_CODE"
    exit "$EXIT_CODE"
fi
