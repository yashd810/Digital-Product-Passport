#!/bin/bash
# OCI Deployment Script - Robust version with proper SSH handling
# Usage: SSH_KEY="/path/to/key" OCI_IP="your-ip" DPP_DEPLOY_TARGET=backend bash scripts/deploy/deploy-to-oci.sh

set -euo pipefail
umask 077

# Configuration
OCI_USER="${OCI_USER:-ubuntu}"
OCI_IP="${OCI_IP:-}"
SSH_KEY="${SSH_KEY:-}"
SSH_KNOWN_HOSTS="${SSH_KNOWN_HOSTS:-${HOME:-}/.ssh/known_hosts}"
DEPLOY_TARGET="${DPP_DEPLOY_TARGET:-}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"
REMOVE_ORPHANS="${DPP_REMOVE_ORPHANS:-}"
SKIP_LIVE_EDGE_CHECK="${DPP_SKIP_LIVE_EDGE_CHECK:-}"
SKIP_CADDY_RELOAD="${DPP_SKIP_CADDY_RELOAD:-}"
CADDYFILE="${DPP_CADDYFILE:-}"
APP_DIR="/opt/dpp"
ENV_FILE="/etc/dpp/dpp.env"
REPO="https://github.com/yashd810/Digital-Product-Passport.git"
BRANCH="main"
SSH_CMD="/usr/bin/ssh"
TIMEOUT_SECONDS="${DPP_DEPLOY_TIMEOUT_SECONDS:-1800}"
TIMEOUT_CMD=""
REMOTE_DEPLOY_DIR=""
REMOTE_DEPLOY_SCRIPT=""

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

if ! [[ "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
    echo "❌ DPP_DEPLOY_TIMEOUT_SECONDS must be a positive integer."
    exit 1
fi

if command -v timeout >/dev/null 2>&1; then
    TIMEOUT_CMD="timeout"
fi

if [ -z "$DEPLOY_TARGET" ]; then
    echo "❌ DPP_DEPLOY_TARGET is required. Use one of: frontend, backend, all"
    echo "Examples:"
    echo "  DPP_DEPLOY_TARGET=frontend OCI_IP=<frontend-host-ip> bash scripts/deploy/deploy-to-oci.sh"
    echo "  DPP_DEPLOY_TARGET=backend OCI_IP=<backend-host-ip> bash scripts/deploy/deploy-to-oci.sh"
    exit 1
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

if [ -z "$SSH_KEY" ]; then
    echo "❌ SSH_KEY is required and must point to the OCI deployment private key."
    echo "Example: SSH_KEY=/secure/path/oci.key DPP_DEPLOY_TARGET=backend OCI_IP=<backend-host-ip> bash scripts/deploy/deploy-to-oci.sh"
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

echo "=================================="
echo "🚀 DPP OCI Deployment Script"
echo "=================================="
echo ""
echo "Configuration:"
echo "  OCI IP: $OCI_IP"
echo "  User: $OCI_USER"
echo "  Deploy Target: $DEPLOY_TARGET"
echo "  Compose Project: ${COMPOSE_PROJECT_NAME:-auto-detect}"
echo "  App Dir: $APP_DIR"
echo "  Env File: $ENV_FILE"
echo "  Timeout: ${TIMEOUT_SECONDS}s"
echo "  Live Edge Check: ${SKIP_LIVE_EDGE_CHECK:-enabled}"
echo "  Caddy Reload: ${SKIP_CADDY_RELOAD:-enabled}"
echo ""

require_private_key_file

if [ -L "$SSH_KNOWN_HOSTS" ] || [ ! -f "$SSH_KNOWN_HOSTS" ]; then
    echo "❌ SSH_KNOWN_HOSTS must point to an existing non-symlinked trusted known_hosts file: $SSH_KNOWN_HOSTS"
    echo "   Verify the OCI host key fingerprint in the OCI Console before adding it."
    exit 1
fi

echo "✅ SSH key and trusted host key file found"
echo ""

# Test SSH connection
echo "🔌 Testing SSH connection..."
SSH_OPTS=(-i "$SSH_KEY" -o UserKnownHostsFile="$SSH_KNOWN_HOSTS" -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -o BatchMode=yes -o ServerAliveInterval=60)

if $SSH_CMD "${SSH_OPTS[@]}" "${OCI_USER}@${OCI_IP}" "echo 'SSH OK'" > /dev/null 2>&1; then
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
        "$SSH_CMD" "${SSH_OPTS[@]}" "${OCI_USER}@${OCI_IP}" \
            "rm -f -- $(quote_for_remote "$REMOTE_DEPLOY_SCRIPT"); rmdir -- $(quote_for_remote "$REMOTE_DEPLOY_DIR")" \
            >/dev/null 2>&1 || true
    fi
    rm -f -- "$DEPLOY_SCRIPT"
    exit "$exit_code"
}
trap cleanup_deploy_artifacts EXIT

if ! REMOTE_DEPLOY_DIR="$(
    "$SSH_CMD" "${SSH_OPTS[@]}" "${OCI_USER}@${OCI_IP}" \
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
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"
REMOVE_ORPHANS="${DPP_REMOVE_ORPHANS:-}"
SKIP_LIVE_EDGE_CHECK="${DPP_SKIP_LIVE_EDGE_CHECK:-}"
SKIP_CADDY_RELOAD="${DPP_SKIP_CADDY_RELOAD:-}"
CADDYFILE="${DPP_CADDYFILE:-}"
DEPLOY_TIMEOUT_SECONDS="${DPP_DEPLOY_TIMEOUT_SECONDS:-1800}"

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
    git checkout "$BRANCH"
else
    echo "📥 Pulling latest changes..."
    cd "$APP_DIR"
    sudo git sparse-checkout init --no-cone
    sudo git sparse-checkout set '/*' '!/local-tools/'
    sudo git fetch origin
    sudo git checkout "$BRANCH"
    sudo git pull --ff-only origin "$BRANCH"
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
if ! scp -q "${SSH_OPTS[@]}" "$DEPLOY_SCRIPT" "${OCI_USER}@${OCI_IP}:$REMOTE_DEPLOY_SCRIPT"; then
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
REMOTE_ENV="$REMOTE_ENV DPP_DEPLOY_TIMEOUT_SECONDS=$(quote_for_remote "$TIMEOUT_SECONDS")"
set +e
if [ -n "$TIMEOUT_CMD" ]; then
    ($TIMEOUT_CMD $((TIMEOUT_SECONDS + 30)) $SSH_CMD "${SSH_OPTS[@]}" "${OCI_USER}@${OCI_IP}" "$REMOTE_ENV bash $(quote_for_remote "$REMOTE_DEPLOY_SCRIPT")" 2>&1) | tee "$DEPLOY_LOG"
else
    echo "⚠️  Local timeout command not found; running SSH deployment without local timeout wrapper."
    ($SSH_CMD "${SSH_OPTS[@]}" "${OCI_USER}@${OCI_IP}" "$REMOTE_ENV bash $(quote_for_remote "$REMOTE_DEPLOY_SCRIPT")" 2>&1) | tee "$DEPLOY_LOG"
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
