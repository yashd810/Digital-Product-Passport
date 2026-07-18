#!/bin/bash
# OCI Deployment Script - Robust version with proper SSH handling
# Usage: SSH_KEY="/path/to/key" OCI_IP="your-ip" DPP_DEPLOY_TARGET=backend bash scripts/deploy/deploy-to-oci.sh

set -euo pipefail
umask 077

# Configuration
OCI_USER="${OCI_USER:-}"
OCI_IP="${OCI_IP:-}"
SSH_KEY="${SSH_KEY:-}"
SSH_KNOWN_HOSTS="${SSH_KNOWN_HOSTS:-}"
DEPLOY_TARGET="${DPP_DEPLOY_TARGET:-}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"
REMOVE_ORPHANS="${DPP_REMOVE_ORPHANS:-}"
SKIP_LIVE_EDGE_CHECK="${DPP_SKIP_LIVE_EDGE_CHECK:-}"
SKIP_CADDY_RELOAD="${DPP_SKIP_CADDY_RELOAD:-}"
CADDYFILE="${DPP_CADDYFILE:-}"
INITIALIZE_POSTGRES_VOLUME="${DPP_INITIALIZE_POSTGRES_VOLUME:-}"
INITIALIZE_LOCAL_STORAGE_VOLUME="${DPP_INITIALIZE_LOCAL_STORAGE_VOLUME:-}"
ALLOW_UNVERIFIED_MARKETING_CONTENT="${DPP_ALLOW_UNVERIFIED_MARKETING_CONTENT:-}"
APP_DIR="/opt/dpp"
ENV_FILE="/etc/dpp/dpp.env"
REPO="https://github.com/yashd810/Digital-Product-Passport.git"
BRANCH="main"
SSH_CMD="/usr/bin/ssh"
TIMEOUT_SECONDS="${DPP_DEPLOY_TIMEOUT_SECONDS:-1800}"
TIMEOUT_CMD=""
REMOTE_DEPLOY_DIR=""
REMOTE_DEPLOY_SCRIPT=""
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)"
PROJECT_ROOT="$(CDPATH= cd -- "$REPO_ROOT/../.." && pwd -P)"
DEPLOY_CONFIG_FILE="${DPP_DEPLOY_CONFIG_FILE:-$PROJECT_ROOT/env/oci-deploy.env}"
OCI_BACKEND_IP="${OCI_BACKEND_IP:-}"
OCI_FRONTEND_IP="${OCI_FRONTEND_IP:-}"
DEPLOY_REVISION=""
SSH_TARGET=""

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

require_private_key_file() {
    local mode

    if [ -L "$SSH_KEY" ] || [ ! -f "$SSH_KEY" ]; then
        echo "❌ SSH key not found or is a symlink: $SSH_KEY"
        exit 1
    fi

    mode="$(file_mode "$SSH_KEY")"
    if (( (8#$mode & 8#077) != 0 )); then
        echo "❌ SSH key must not be readable by group or others: $SSH_KEY (mode $mode)"
        exit 1
    fi
}

require_trusted_known_hosts_file() {
    local mode

    if [ -L "$SSH_KNOWN_HOSTS" ] || [ ! -f "$SSH_KNOWN_HOSTS" ]; then
        echo "❌ SSH_KNOWN_HOSTS must point to an existing non-symlinked trusted known_hosts file: $SSH_KNOWN_HOSTS"
        echo "   Verify the OCI host key fingerprint in the OCI Console before adding it."
        exit 1
    fi

    mode="$(file_mode "$SSH_KNOWN_HOSTS")"
    if (( (8#$mode & 8#022) != 0 )); then
        echo "❌ SSH_KNOWN_HOSTS must not be writable by group or others: $SSH_KNOWN_HOSTS (mode $mode)"
        exit 1
    fi
}

load_deploy_config() {
    local mode line key value

    if [ -L "$DEPLOY_CONFIG_FILE" ]; then
        echo "❌ Deployment configuration must not be a symlink: $DEPLOY_CONFIG_FILE"
        exit 1
    fi
    if [ ! -e "$DEPLOY_CONFIG_FILE" ]; then
        if [ -n "${DPP_DEPLOY_CONFIG_FILE:-}" ]; then
            echo "❌ DPP_DEPLOY_CONFIG_FILE does not exist: $DEPLOY_CONFIG_FILE"
            exit 1
        fi
        return
    fi
    if [ ! -f "$DEPLOY_CONFIG_FILE" ]; then
        echo "❌ Deployment configuration must be a regular file: $DEPLOY_CONFIG_FILE"
        exit 1
    fi

    mode="$(file_mode "$DEPLOY_CONFIG_FILE")"
    if (( (8#$mode & 8#077) != 0 )); then
        echo "❌ Deployment configuration must have mode 600: $DEPLOY_CONFIG_FILE (mode $mode)"
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

    # scp requires brackets around IPv6 literals; SSH accepts the same target
    # form. The input is validated before this helper is called.
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

OCI_USER="${OCI_USER:-ubuntu}"
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

if [ -n "$INITIALIZE_POSTGRES_VOLUME" ] && [ "$INITIALIZE_POSTGRES_VOLUME" != "true" ] && [ "$INITIALIZE_POSTGRES_VOLUME" != "false" ]; then
    echo "❌ DPP_INITIALIZE_POSTGRES_VOLUME must be true or false when set."
    exit 1
fi

if [ -n "$INITIALIZE_LOCAL_STORAGE_VOLUME" ] && [ "$INITIALIZE_LOCAL_STORAGE_VOLUME" != "true" ] && [ "$INITIALIZE_LOCAL_STORAGE_VOLUME" != "false" ]; then
    echo "❌ DPP_INITIALIZE_LOCAL_STORAGE_VOLUME must be true or false when set."
    exit 1
fi

if [ -n "$ALLOW_UNVERIFIED_MARKETING_CONTENT" ] && [ "$ALLOW_UNVERIFIED_MARKETING_CONTENT" != "true" ]; then
    echo "❌ DPP_ALLOW_UNVERIFIED_MARKETING_CONTENT must be true when explicitly set."
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
SSH_TARGET="$(ssh_target_for_host "$OCI_USER" "$OCI_IP")"

if [ -z "$SSH_KEY" ]; then
    echo "❌ SSH_KEY is required and must point to the OCI deployment private key."
    echo "Example: SSH_KEY=/secure/path/oci.key DPP_DEPLOY_TARGET=backend OCI_IP=<backend-host-ip> bash scripts/deploy/deploy-to-oci.sh"
    exit 1
fi

echo "=================================="
echo "🚀 DPP OCI Deployment Script"
echo "=================================="
echo ""
echo "Configuration:"
echo "  OCI IP: $OCI_IP"
echo "  User: $OCI_USER"
echo "  Deploy Target: $DEPLOY_TARGET"
echo "  Deploy Config: $DEPLOY_CONFIG_FILE"
echo "  Compose Project: ${COMPOSE_PROJECT_NAME:-auto-detect}"
echo "  App Dir: $APP_DIR"
echo "  Env File: $ENV_FILE"
echo "  Timeout: ${TIMEOUT_SECONDS}s"
echo "  Live Edge Check: ${SKIP_LIVE_EDGE_CHECK:-enabled}"
echo "  Caddy Reload: ${SKIP_CADDY_RELOAD:-enabled}"
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
    echo "❌ SSH connection failed to ${OCI_USER}@${OCI_IP}"
    echo ""
    echo "Troubleshooting:"
    echo "1. Verify OCI_IP is correct: $OCI_IP"
    echo "2. Check that SSH port 22 is open in OCI security list"
    echo "3. Verify SSH key has correct permissions (600)"
    echo ""
    exit 1
fi

echo ""
echo "📦 Starting remote deployment..."
echo ""

# Create a private local script and a unique private remote directory. The remote
# path is intentionally generated server-side rather than reusing a fixed remote path.
DEPLOY_SCRIPT="$(mktemp "${TMPDIR:-/tmp}/dpp-deploy-script.XXXXXX")"
cleanup_deploy_artifacts() {
    local exit_code=$?

    trap - EXIT
    if [ -n "${REMOTE_DEPLOY_DIR:-}" ]; then
        "$SSH_CMD" "${SSH_OPTS[@]}" "$SSH_TARGET" \
            "rm -f -- $(quote_for_remote "$REMOTE_DEPLOY_SCRIPT"); rmdir -- $(quote_for_remote "$REMOTE_DEPLOY_DIR")" \
            >/dev/null 2>&1 || true
    fi
    rm -f -- "$DEPLOY_SCRIPT"
    exit "$exit_code"
}
trap cleanup_deploy_artifacts EXIT

if ! REMOTE_DEPLOY_DIR="$(
    "$SSH_CMD" "${SSH_OPTS[@]}" "$SSH_TARGET" \
        "umask 077 && mktemp -d /tmp/dpp-deploy.XXXXXXXXXX"
)"; then
    echo "❌ Failed to create a private remote deployment directory."
    exit 1
fi
if ! [[ "$REMOTE_DEPLOY_DIR" =~ ^/tmp/dpp-deploy\.[A-Za-z0-9]{6,}$ ]]; then
    echo "❌ Remote deployment directory did not match the expected safe path."
    REMOTE_DEPLOY_DIR=""
    exit 1
fi
REMOTE_DEPLOY_SCRIPT="$REMOTE_DEPLOY_DIR/deploy.sh"

cat > "$DEPLOY_SCRIPT" << 'EOF'
#!/bin/bash
set -euo pipefail

REMOTE_SCRIPT_PATH="${BASH_SOURCE[0]}"
REMOTE_DEPLOY_DIR="$(CDPATH= cd -- "$(dirname -- "$REMOTE_SCRIPT_PATH")" && pwd -P)"
if ! [[ "$REMOTE_DEPLOY_DIR" =~ ^/tmp/dpp-deploy\.[A-Za-z0-9]{6,}$ ]]; then
    echo "Refusing to run a deployment script outside a private deployment directory."
    exit 1
fi
cleanup_remote_deploy_artifacts() {
    rm -f -- "$REMOTE_SCRIPT_PATH"
    rmdir -- "$REMOTE_DEPLOY_DIR" 2>/dev/null || true
}
trap cleanup_remote_deploy_artifacts EXIT

APP_DIR="/opt/dpp"
ENV_FILE="/etc/dpp/dpp.env"
REPO="https://github.com/yashd810/Digital-Product-Passport.git"
BRANCH="main"
DEPLOY_TARGET="${DPP_DEPLOY_TARGET:?DPP_DEPLOY_TARGET is required}"
DEPLOY_USER="${DPP_DEPLOY_USER:?DPP_DEPLOY_USER is required}"
DEPLOY_REVISION="${DPP_DEPLOY_REVISION:?DPP_DEPLOY_REVISION is required}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"
REMOVE_ORPHANS="${DPP_REMOVE_ORPHANS:-}"
SKIP_LIVE_EDGE_CHECK="${DPP_SKIP_LIVE_EDGE_CHECK:-}"
SKIP_CADDY_RELOAD="${DPP_SKIP_CADDY_RELOAD:-}"
CADDYFILE="${DPP_CADDYFILE:-}"
INITIALIZE_POSTGRES_VOLUME="${DPP_INITIALIZE_POSTGRES_VOLUME:-}"
INITIALIZE_LOCAL_STORAGE_VOLUME="${DPP_INITIALIZE_LOCAL_STORAGE_VOLUME:-}"
ALLOW_UNVERIFIED_MARKETING_CONTENT="${DPP_ALLOW_UNVERIFIED_MARKETING_CONTENT:-}"
DEPLOY_TIMEOUT_SECONDS="${DPP_DEPLOY_TIMEOUT_SECONDS:-1800}"

if ! [[ "$DEPLOY_REVISION" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Refusing deployment with an invalid Git revision."
    exit 1
fi

echo "📂 Checking application directory..."
if [ -L "$APP_DIR" ]; then
    echo "Refusing to deploy through a symbolic-link application directory: $APP_DIR"
    exit 1
fi
if [ ! -d "$APP_DIR" ]; then
    echo "📥 Cloning repository..."
    sudo mkdir -p "$APP_DIR"
    sudo git clone --branch "$BRANCH" --filter=blob:none --no-checkout "$REPO" "$APP_DIR" 2>&1 | tail -5
    sudo chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
    cd "$APP_DIR"
    git sparse-checkout init --no-cone
    git sparse-checkout set '/*' '!/local-tools/'
    git fetch --no-tags origin "$BRANCH"
    if ! git merge-base --is-ancestor "$DEPLOY_REVISION" "origin/$BRANCH"; then
        echo "Requested deployment revision is not reachable from origin/$BRANCH."
        exit 1
    fi
    git checkout --detach "$DEPLOY_REVISION"
else
    echo "📥 Pulling latest changes..."
    cd "$APP_DIR"
    sudo git sparse-checkout init --no-cone
    sudo git sparse-checkout set '/*' '!/local-tools/'
    sudo git fetch --no-tags origin "$BRANCH"
    if ! sudo git merge-base --is-ancestor "$DEPLOY_REVISION" "origin/$BRANCH"; then
        echo "Requested deployment revision is not reachable from origin/$BRANCH."
        exit 1
    fi
    sudo git checkout --detach "$DEPLOY_REVISION"
    sudo git sparse-checkout reapply
fi

echo "✅ Repository ready"
echo ""

# Check environment file
if [ ! -f "$ENV_FILE" ]; then
    echo "⚠️  Environment file not found: $ENV_FILE"
    exit 1
fi

echo "✅ Environment file found"
echo ""

# Run deployment with timeout
echo "🐳 Building and starting Docker containers (this may take 10-15 minutes)..."
cd "$APP_DIR"
DEPLOY_ENV=(
    DPP_ENV_FILE="$ENV_FILE"
    DPP_DEPLOY_TARGET="$DEPLOY_TARGET"
    DPP_DEPLOY_USER="$DEPLOY_USER"
)
if [ -n "$COMPOSE_PROJECT_NAME" ]; then
    DEPLOY_ENV+=(COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME")
fi
if [ -n "$REMOVE_ORPHANS" ]; then
    DEPLOY_ENV+=(DPP_REMOVE_ORPHANS="$REMOVE_ORPHANS")
fi
if [ -n "$SKIP_LIVE_EDGE_CHECK" ]; then
    DEPLOY_ENV+=(DPP_SKIP_LIVE_EDGE_CHECK="$SKIP_LIVE_EDGE_CHECK")
fi
if [ -n "$SKIP_CADDY_RELOAD" ]; then
    DEPLOY_ENV+=(DPP_SKIP_CADDY_RELOAD="$SKIP_CADDY_RELOAD")
fi
if [ -n "$CADDYFILE" ]; then
    DEPLOY_ENV+=(DPP_CADDYFILE="$CADDYFILE")
fi
if [ -n "$INITIALIZE_POSTGRES_VOLUME" ]; then
    DEPLOY_ENV+=(DPP_INITIALIZE_POSTGRES_VOLUME="$INITIALIZE_POSTGRES_VOLUME")
fi
if [ -n "$INITIALIZE_LOCAL_STORAGE_VOLUME" ]; then
    DEPLOY_ENV+=(DPP_INITIALIZE_LOCAL_STORAGE_VOLUME="$INITIALIZE_LOCAL_STORAGE_VOLUME")
fi
if [ -n "$ALLOW_UNVERIFIED_MARKETING_CONTENT" ]; then
    DEPLOY_ENV+=(DPP_ALLOW_UNVERIFIED_MARKETING_CONTENT="$ALLOW_UNVERIFIED_MARKETING_CONTENT")
fi
timeout "$DEPLOY_TIMEOUT_SECONDS" sudo "${DEPLOY_ENV[@]}" ./infra/oracle/deploy-prod.sh

echo ""
echo "✅ Deployment process complete!"
echo ""
echo "📊 Checking service status..."
sudo docker ps --no-trunc --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "⚠️ Could not retrieve container status"

EOF

chmod +x "$DEPLOY_SCRIPT"

# Copy script to remote and execute
echo "📤 Uploading deployment script..."
if ! scp -q "${SSH_OPTS[@]}" "$DEPLOY_SCRIPT" "$SSH_TARGET:$REMOTE_DEPLOY_SCRIPT"; then
    echo "❌ Failed to upload deployment script."
    exit 1
fi
echo "✅ Script uploaded"

echo ""
echo "⏱️  Starting remote deployment (timeout: ${TIMEOUT_SECONDS}s)..."
echo "---"
DEPLOY_LOG="$(mktemp "${TMPDIR:-/tmp}/dpp-deploy-output.XXXXXX")"
chmod 600 "$DEPLOY_LOG"

# Execute with timeout
REMOTE_ENV="DPP_DEPLOY_TARGET=$(quote_for_remote "$DEPLOY_TARGET")"
REMOTE_ENV="$REMOTE_ENV DPP_DEPLOY_USER=$(quote_for_remote "$OCI_USER")"
REMOTE_ENV="$REMOTE_ENV DPP_DEPLOY_REVISION=$(quote_for_remote "$DEPLOY_REVISION")"
if [ -n "$COMPOSE_PROJECT_NAME" ]; then
    REMOTE_ENV="$REMOTE_ENV COMPOSE_PROJECT_NAME=$(quote_for_remote "$COMPOSE_PROJECT_NAME")"
fi
if [ -n "$REMOVE_ORPHANS" ]; then
    REMOTE_ENV="$REMOTE_ENV DPP_REMOVE_ORPHANS=$(quote_for_remote "$REMOVE_ORPHANS")"
fi
if [ -n "$SKIP_LIVE_EDGE_CHECK" ]; then
    REMOTE_ENV="$REMOTE_ENV DPP_SKIP_LIVE_EDGE_CHECK=$(quote_for_remote "$SKIP_LIVE_EDGE_CHECK")"
fi
if [ -n "$SKIP_CADDY_RELOAD" ]; then
    REMOTE_ENV="$REMOTE_ENV DPP_SKIP_CADDY_RELOAD=$(quote_for_remote "$SKIP_CADDY_RELOAD")"
fi
if [ -n "$CADDYFILE" ]; then
    REMOTE_ENV="$REMOTE_ENV DPP_CADDYFILE=$(quote_for_remote "$CADDYFILE")"
fi
if [ -n "$INITIALIZE_POSTGRES_VOLUME" ]; then
    REMOTE_ENV="$REMOTE_ENV DPP_INITIALIZE_POSTGRES_VOLUME=$(quote_for_remote "$INITIALIZE_POSTGRES_VOLUME")"
fi
if [ -n "$INITIALIZE_LOCAL_STORAGE_VOLUME" ]; then
    REMOTE_ENV="$REMOTE_ENV DPP_INITIALIZE_LOCAL_STORAGE_VOLUME=$(quote_for_remote "$INITIALIZE_LOCAL_STORAGE_VOLUME")"
fi
if [ -n "$ALLOW_UNVERIFIED_MARKETING_CONTENT" ]; then
    REMOTE_ENV="$REMOTE_ENV DPP_ALLOW_UNVERIFIED_MARKETING_CONTENT=$(quote_for_remote "$ALLOW_UNVERIFIED_MARKETING_CONTENT")"
fi
REMOTE_ENV="$REMOTE_ENV DPP_DEPLOY_TIMEOUT_SECONDS=$(quote_for_remote "$TIMEOUT_SECONDS")"
set +e
if [ -n "$TIMEOUT_CMD" ]; then
    ($TIMEOUT_CMD $((TIMEOUT_SECONDS + 30)) $SSH_CMD "${SSH_OPTS[@]}" "$SSH_TARGET" "$REMOTE_ENV bash $(quote_for_remote "$REMOTE_DEPLOY_SCRIPT")" 2>&1) | tee "$DEPLOY_LOG"
else
    echo "⚠️  Local timeout command not found; running SSH deployment without local timeout wrapper."
    ($SSH_CMD "${SSH_OPTS[@]}" "$SSH_TARGET" "$REMOTE_ENV bash $(quote_for_remote "$REMOTE_DEPLOY_SCRIPT")" 2>&1) | tee "$DEPLOY_LOG"
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
    echo "1. SSH into instance: $SSH_CMD -i '$SSH_KEY' -o UserKnownHostsFile='$SSH_KNOWN_HOSTS' -o StrictHostKeyChecking=yes ${OCI_USER}@${OCI_IP}"
    echo "2. Check running services: sudo docker ps"
    echo "3. Find the ${LOG_SERVICE} container: sudo docker ps --filter 'label=com.docker.compose.service=${LOG_SERVICE}' --format '{{.Names}}'"
    echo "4. View its logs: sudo docker logs <container-name-from-step-3> 2>&1 | tail -20"
    if [ "$DEPLOY_TARGET" != "frontend" ]; then
        echo "5. Test API health: curl -s http://127.0.0.1:3001/health | jq ."
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
