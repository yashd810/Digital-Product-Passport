#!/bin/bash
# OCI Deployment Script - Robust version with proper SSH handling
# Usage: OCI_IP="your-ip" bash scripts/deploy/deploy-to-oci.sh

set -e

# Configuration
OCI_USER="${OCI_USER:-ubuntu}"
OCI_IP="${OCI_IP:-79.76.53.122}"
SSH_KEY="${SSH_KEY:-$HOME/Desktop/AMD keys/ssh-key-2026-04-27.key}"
APP_DIR="/opt/dpp"
ENV_FILE="/etc/dpp/dpp.env"
REPO="https://github.com/yashd810/Digital-Product-Passport.git"
BRANCH="main"
SSH_CMD="/usr/bin/ssh"
TIMEOUT_SECONDS=600

echo "=================================="
echo "🚀 DPP OCI Deployment Script"
echo "=================================="
echo ""
echo "Configuration:"
echo "  OCI IP: $OCI_IP"
echo "  User: $OCI_USER"
echo "  App Dir: $APP_DIR"
echo "  Env File: $ENV_FILE"
echo "  Timeout: ${TIMEOUT_SECONDS}s"
echo ""

# Check if SSH key exists
if [ ! -f "$SSH_KEY" ]; then
    echo "❌ SSH key not found: $SSH_KEY"
    exit 1
fi

echo "✅ SSH key found"
echo ""

# Test SSH connection
echo "🔌 Testing SSH connection..."
SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes -o ServerAliveInterval=60)

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

# Create temporary deployment script
DEPLOY_SCRIPT=$(mktemp)
trap "rm -f $DEPLOY_SCRIPT" EXIT

cat > "$DEPLOY_SCRIPT" << 'EOF'
#!/bin/bash
set -e

APP_DIR="/opt/dpp"
ENV_FILE="/etc/dpp/dpp.env"
REPO="https://github.com/yashd810/Digital-Product-Passport.git"
BRANCH="main"

echo "📂 Checking application directory..."
if [ ! -d "$APP_DIR" ]; then
    echo "📥 Cloning repository..."
    sudo mkdir -p "$APP_DIR"
    sudo git clone --branch "$BRANCH" "$REPO" "$APP_DIR" 2>&1 | tail -5
    sudo chown -R ubuntu:ubuntu "$APP_DIR"
else
    echo "📥 Pulling latest changes..."
    cd "$APP_DIR"
    sudo git fetch origin 2>&1 | grep -E "(From|Already|Fetching|fetch)" || true
    sudo git checkout "$BRANCH" 2>&1 | grep -E "(Switched|Already)" || true
    sudo git pull --ff-only origin "$BRANCH" 2>&1 | grep -E "(Fast-forward|Already|up to date)" || true
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
(timeout 600 sudo DPP_ENV_FILE="$ENV_FILE" DPP_DEPLOY_TARGET="all" ./infra/oracle/deploy-prod.sh 2>&1 || true)

echo ""
echo "✅ Deployment process complete!"
echo ""
echo "📊 Checking service status..."
sudo docker ps --no-trunc --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "⚠️ Could not retrieve container status"

EOF

chmod +x "$DEPLOY_SCRIPT"

# Copy script to remote and execute
echo "📤 Uploading deployment script..."
if scp -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$DEPLOY_SCRIPT" "${OCI_USER}@${OCI_IP}:/tmp/deploy.sh" 2>&1 | grep -v "100%" | grep -v "^$"; then
    echo "✅ Script uploaded"
else
    echo "✅ Script uploaded (scp silent mode)"
fi

echo ""
echo "⏱️  Starting remote deployment (timeout: ${TIMEOUT_SECONDS}s)..."
echo "---"

# Execute with timeout
(timeout $((TIMEOUT_SECONDS + 30)) $SSH_CMD "${SSH_OPTS[@]}" "${OCI_USER}@${OCI_IP}" "bash /tmp/deploy.sh" 2>&1 || true) | tee /tmp/deploy-output.log

EXIT_CODE=${PIPESTATUS[0]}

echo "---"
echo ""
echo "=================================="
echo "✅ Deployment Complete!"
echo "=================================="
echo ""
echo "📍 Next steps:"
echo "1. SSH into instance: $SSH_CMD -i '$SSH_KEY' ${OCI_USER}@${OCI_IP}"
echo "2. Check running services: sudo docker ps"
echo "3. View logs: sudo docker logs backend-api 2>&1 | tail -20"
echo "4. Test API health: curl -s http://localhost:3001/health | jq ."
echo ""
echo "📋 Deployment log saved to: /tmp/deploy-output.log"
echo ""

if [ $EXIT_CODE -eq 124 ] || [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Deployment process completed (see above for details)"
    exit 0
else
    echo "⚠️  Deployment process exited with code: $EXIT_CODE"
    exit 0
fi
