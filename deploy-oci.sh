#!/bin/bash
set -e

# Automated Deployment Script - JWT & Cookie Domain Fix
# Usage: ./deploy-oci.sh [OCI_IP] [SSH_KEY_PATH]
# Example: ./deploy-oci.sh 79.76.53.122 ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key

OCI_IP=${1:-79.76.53.122}
SSH_KEY=${2:-~/Desktop/AMD\ keys/ssh-key-2026-04-27.key}
SSH_USER="ubuntu"
ENV_FILE="/etc/dpp/dpp.env"
DOCKER_COMPOSE="/opt/dpp/docker-compose.prod.yml"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║   DPP Authentication Fix - Automated OCI Deployment            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Target: $SSH_USER@$OCI_IP"
echo "SSH Key: $SSH_KEY"
echo ""

# Function to run SSH command
run_ssh() {
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_USER@$OCI_IP" "$@"
}

# Step 1: Verify connectivity
echo "[1/5] Verifying SSH connectivity..."
if ! run_ssh "echo 'Connected'" > /dev/null 2>&1; then
    echo "✗ Failed to connect to $OCI_IP"
    exit 1
fi
echo "✓ SSH connection established"
echo ""

# Step 2: Backup current environment file
echo "[2/5] Backing up current environment..."
run_ssh "sudo cp $ENV_FILE ${ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)" 
echo "✓ Backup created"
echo ""

# Step 3: Update environment variables
echo "[3/5] Updating environment configuration..."
run_ssh "sudo bash -c 'cat > /tmp/env_updates.txt << 'EOF'
# Add/Update these lines in $ENV_FILE

# Critical cookie domain fix (MUST ADD)
COOKIE_DOMAIN=.claros-dpp.online

# MFA policy (ADD if missing)
REQUIRE_MFA_FOR_CONTROLLED_DATA=true

# Database configuration (ADD if missing)
DB_HOST=postgres
EOF
'"

# Check if COOKIE_DOMAIN already exists
COOKIE_DOMAIN_EXISTS=$(run_ssh "grep -c 'COOKIE_DOMAIN=' $ENV_FILE || echo 0")

if [ "$COOKIE_DOMAIN_EXISTS" = "0" ]; then
    # Add COOKIE_DOMAIN after COOKIE_SAME_SITE
    run_ssh "sudo sed -i '/COOKIE_SAME_SITE=None/a COOKIE_DOMAIN=.claros-dpp.online' $ENV_FILE"
    echo "✓ Added COOKIE_DOMAIN"
else
    # Update existing COOKIE_DOMAIN
    run_ssh "sudo sed -i 's/COOKIE_DOMAIN=.*/COOKIE_DOMAIN=.claros-dpp.online/' $ENV_FILE"
    echo "✓ Updated existing COOKIE_DOMAIN"
fi

# Ensure other required settings
run_ssh "grep -q 'DB_HOST=' $ENV_FILE || sudo sed -i '/^DB_NAME=/a DB_HOST=postgres' $ENV_FILE"
run_ssh "grep -q 'REQUIRE_MFA_FOR_CONTROLLED_DATA=' $ENV_FILE || sudo sed -i '/^ADMIN_EMAIL=/a REQUIRE_MFA_FOR_CONTROLLED_DATA=true' $ENV_FILE"
echo "✓ Configuration updated"
echo ""

# Step 4: Verify configuration
echo "[4/5] Verifying configuration..."
echo "Current cookie settings:"
run_ssh "grep -E 'COOKIE_|SESSION_' $ENV_FILE | grep -v '^#'"
echo ""

# Step 5: Restart services
echo "[5/5] Restarting backend service..."
run_ssh "cd /opt/dpp && docker-compose -f $DOCKER_COMPOSE down backend-api"
sleep 2
run_ssh "cd /opt/dpp && docker-compose -f $DOCKER_COMPOSE up -d backend-api"
sleep 3

# Verify restart
echo ""
echo "Checking backend status..."
BACKEND_STATUS=$(run_ssh "docker ps --filter='name=backend-api' --format='table {{.Names}}\t{{.Status}}'" || echo "offline")
echo "$BACKEND_STATUS"

# Show recent logs
echo ""
echo "Recent backend logs:"
run_ssh "docker logs --tail=10 backend-api" || echo "(No logs available yet)"

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║   ✓ Deployment Complete                                       ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "1. Test API: curl -b cookies.txt https://api.claros-dpp.online/api/users/me/notifications"
echo "2. Check browser DevTools → Network → verify cookies are sent with cross-domain requests"
echo "3. Confirm 200 OK responses (not 403 Forbidden)"
echo ""
echo "If issues occur, rollback with:"
echo "  ssh -i '$SSH_KEY' $SSH_USER@$OCI_IP"
echo "  sudo cp ${ENV_FILE}.backup.* $ENV_FILE"
echo "  cd /opt/dpp && docker-compose -f $DOCKER_COMPOSE restart backend-api"
