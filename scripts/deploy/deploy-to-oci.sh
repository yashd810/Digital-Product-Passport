#!/bin/bash
# OCI Deployment Script - 403 Error Fix
# Usage: bash deploy-to-oci.sh

set -e

# Configuration
OCI_USER="${OCI_USER:-ubuntu}"
OCI_IP="${OCI_IP:-79.76.53.122}"  # Change this to your actual OCI instance IP
SSH_KEY="${SSH_KEY:-$HOME/Desktop/AMD keys/ssh-key-2026-04-27.key}"
APP_DIR="/opt/dpp"
ENV_FILE="/etc/dpp/dpp.env"
REPO="https://github.com/yashd810/Digital-Product-Passport.git"
BRANCH="main"

echo "=================================="
echo "🚀 DPP OCI Deployment Script"
echo "=================================="
echo ""
echo "Configuration:"
echo "  OCI IP: $OCI_IP"
echo "  User: $OCI_USER"
echo "  App Dir: $APP_DIR"
echo "  Env File: $ENV_FILE"
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
if ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "${OCI_USER}@${OCI_IP}" "echo 'SSH OK'" > /dev/null 2>&1; then
    echo "✅ SSH connection successful"
else
    echo "❌ SSH connection failed to ${OCI_USER}@${OCI_IP}"
    echo ""
    echo "Troubleshooting:"
    echo "1. Verify OCI_IP is correct: $OCI_IP"
    echo "2. Check that SSH port 22 is open in OCI security list"
    echo "3. Verify SSH key has correct permissions (600)"
    echo ""
    echo "Manual deployment steps:"
    echo "1. SSH into your instance: ssh -i '$SSH_KEY' ${OCI_USER}@<your-ip>"
    echo "2. Run: sudo DPP_ENV_FILE=$ENV_FILE $APP_DIR/infra/oracle/bootstrap.sh"
    exit 1
fi

echo ""
echo "📦 Deploying application..."
echo ""

# Run deployment
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${OCI_USER}@${OCI_IP}" << 'REMOTE_SCRIPT'
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
    sudo git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
    sudo chown -R ubuntu:ubuntu "$APP_DIR"
else
    echo "📥 Pulling latest changes..."
    cd "$APP_DIR"
    sudo git fetch origin
    sudo git checkout "$BRANCH"
    sudo git pull --ff-only origin "$BRANCH"
    cd -
fi

echo ""
echo "✅ Repository up to date"
echo ""

# Check environment file
if [ ! -f "$ENV_FILE" ]; then
    echo "⚠️  Environment file not found: $ENV_FILE"
    echo "Please create it with: sudo tee $ENV_FILE < /dev/null"
    exit 1
fi

echo "✅ Environment file found"
echo ""

# Run deployment
echo "🐳 Building and starting Docker containers..."
cd "$APP_DIR"
sudo DPP_ENV_FILE="$ENV_FILE" DPP_DEPLOY_TARGET="all" ./infra/oracle/deploy-prod.sh

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Checking service status..."
sudo docker ps --format "table {{.Names}}\t{{.Status}}"

REMOTE_SCRIPT

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "=================================="
    echo "✅ Deployment Successful!"
    echo "=================================="
    echo ""
    echo "Next steps:"
    echo "1. Verify services are running: docker ps"
    echo "2. Check logs: docker logs backend-api"
    echo "3. Test analytics endpoint:"
    echo "   curl -H 'Authorization: Bearer <JWT>' https://api.claros-dpp.online/api/admin/analytics"
    echo ""
else
    echo ""
    echo "❌ Deployment Failed"
    echo "Exit code: $EXIT_CODE"
    echo ""
    echo "Troubleshooting:"
    echo "1. SSH into instance: ssh -i '$SSH_KEY' ${OCI_USER}@${OCI_IP}"
    echo "2. Check logs: docker logs backend-api"
    echo "3. Verify env file: sudo cat /etc/dpp/dpp.env"
fi

exit $EXIT_CODE
