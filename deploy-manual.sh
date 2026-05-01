#!/bin/bash
# Manual OCI Deployment Guide
# Run this directly on your OCI instance after SSH

set -e

echo "======================================"
echo "Manual OCI Deployment - 403 Error Fix"
echo "======================================"
echo ""

# Configuration
APP_DIR="${APP_DIR:-/opt/dpp}"
ENV_FILE="${DPP_ENV_FILE:-/etc/dpp/dpp.env}"
REPO_URL="${REPO_URL:-https://github.com/yashd810/Digital-Product-Passport.git}"
BRANCH="${BRANCH:-main}"

echo "Configuration:"
echo "  App Directory: $APP_DIR"
echo "  Environment File: $ENV_FILE"
echo "  Repository: $REPO_URL"
echo "  Branch: $BRANCH"
echo ""

# Step 1: Check Docker
echo "Step 1: Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    exit 1
fi
echo "✅ Docker is installed: $(docker --version)"
echo ""

# Step 2: Clone or update repository
echo "Step 2: Updating code repository..."
if [ ! -d "$APP_DIR/.git" ]; then
    echo "   Creating new clone..."
    sudo mkdir -p "$APP_DIR"
    sudo git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
    sudo chown -R $(whoami):$(whoami) "$APP_DIR" 2>/dev/null || true
else
    echo "   Updating existing clone..."
    cd "$APP_DIR"
    git fetch origin
    git checkout "$BRANCH"
    git pull --ff-only origin "$BRANCH"
    cd -
fi
echo "✅ Repository updated to latest '$BRANCH'"
echo ""

# Step 3: Verify environment file
echo "Step 3: Verifying environment configuration..."
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Environment file not found: $ENV_FILE"
    echo ""
    echo "Please create the environment file at: $ENV_FILE"
    echo "You can copy from .env.prod as a template"
    echo "Required variables:"
    echo "  - DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME"
    echo "  - JWT_SECRET, PEPPER_V1"
    echo "  - STORAGE_PROVIDER (s3 or local)"
    echo "  - ADMIN_EMAIL (will be promoted to super_admin)"
    echo ""
    exit 1
fi
echo "✅ Environment file found"
echo ""

# Step 4: Display current services
echo "Step 4: Current Docker services:"
docker ps --format "table {{.Names}}\t{{.Status}}" || echo "   (No services running)"
echo ""

# Step 5: Run deployment
echo "Step 5: Starting deployment..."
cd "$APP_DIR"

echo "   Building Docker images..."
DPP_ENV_FILE="$ENV_FILE" \
DPP_DEPLOY_TARGET="all" \
  sudo -E bash ./infra/oracle/deploy-prod.sh

echo ""
echo "✅ Deployment scripts completed"
echo ""

# Step 6: Verify services
echo "Step 6: Verifying services..."
echo ""
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
echo ""

# Step 7: Database migration check
echo "Step 7: Checking database migrations..."
echo "   The 2026-05-02.ensure-admin-super-role migration will:"
echo "   1. Check if ADMIN_EMAIL user exists"
echo "   2. Update their role to 'super_admin' if needed"
echo "   3. Log the result"
echo ""
echo "   To verify manually:"
echo "   docker exec postgres psql -U postgres -d dpp_system -c \"SELECT email, role FROM users WHERE email = '$(grep ADMIN_EMAIL $ENV_FILE | cut -d= -f2)'\""
echo ""

# Step 8: Test endpoints
echo "Step 8: Testing endpoints..."
echo "   Frontend: http://$(hostname -I | awk '{print $1}'):3000"
echo "   Backend API: http://$(hostname -I | awk '{print $1}'):3001"
echo "   Viewer: http://$(hostname -I | awk '{print $1}'):3004"
echo ""
echo "   Or via domain:"
echo "   Frontend: https://app.claros-dpp.online"
echo "   API: https://api.claros-dpp.online"
echo ""

# Step 9: Troubleshooting
echo "Step 9: Troubleshooting commands"
echo "   View logs:"
echo "     docker logs backend-api -f"
echo "     docker logs frontend-app -f"
echo ""
echo "   Check database:"
echo "     docker exec postgres psql -U postgres -d dpp_system"
echo ""
echo "   Restart services:"
echo "     docker-compose -f docker-compose.prod.yml restart"
echo ""
echo "   View running services:"
echo "     docker ps"
echo ""

echo "======================================"
echo "✅ Deployment Complete!"
echo "======================================"
echo ""
echo "Summary:"
echo "  - Code updated from GitHub main branch"
echo "  - Docker images rebuilt"
echo "  - Services restarted"
echo "  - Database migration 2026-05-02.ensure-admin-super-role will run on startup"
echo "  - Admin user will be automatically promoted to super_admin role"
echo ""
echo "The /api/admin/analytics endpoint should now be accessible"
echo ""
