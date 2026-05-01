#!/bin/bash
# QUICK FIX: One-liner to apply cross-domain cookie fix on OCI

set -e

SSH_KEY="${SSH_KEY:-$HOME/Desktop/AMD keys/ssh-key-2026-04-27.key}"
OCI_IP="79.76.53.122"
OCI_USER="ubuntu"

echo "🔧 Applying critical cookie domain fix..."
echo ""

# SSH and apply the fix
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${OCI_USER}@${OCI_IP}" << 'EOF'
#!/bin/bash
set -e

echo "📝 Updating /etc/dpp/dpp.env..."

# Check if file exists
if [ ! -f /etc/dpp/dpp.env ]; then
  echo "❌ /etc/dpp/dpp.env not found!"
  echo "Please create this file with your production environment variables."
  exit 1
fi

# Backup original
sudo cp /etc/dpp/dpp.env /etc/dpp/dpp.env.bak
echo "✓ Backup created at /etc/dpp/dpp.env.bak"

# Check if COOKIE_DOMAIN already exists
if grep -q "COOKIE_DOMAIN" /etc/dpp/dpp.env; then
  echo "✓ COOKIE_DOMAIN already set"
  grep "COOKIE_DOMAIN" /etc/dpp/dpp.env
else
  # Add COOKIE_DOMAIN after COOKIE_SAME_SITE line
  echo "✓ Adding COOKIE_DOMAIN to environment..."
  sudo sed -i '/COOKIE_SAME_SITE=.*/a COOKIE_DOMAIN=.claros-dpp.online' /etc/dpp/dpp.env
  echo "✓ Added: COOKIE_DOMAIN=.claros-dpp.online"
fi

echo ""
echo "🐳 Restarting backend container..."
cd /opt/dpp
sudo docker-compose -f docker-compose.prod.yml restart backend-api

echo ""
echo "⏳ Waiting for backend to start..."
sleep 5

echo ""
echo "📊 Backend status:"
sudo docker ps --filter "name=backend-api" --format "table {{.Names}}\t{{.Status}}"

echo ""
echo "✅ Fix applied successfully!"
echo ""
echo "Verify the fix:"
echo "  docker exec backend-api env | grep COOKIE_DOMAIN"
echo "  docker logs backend-api -f"

EOF

echo ""
echo "======================================"
echo "✅ FIX COMPLETE"
echo "======================================"
echo ""
echo "The critical cookie domain fix has been applied!"
echo ""
echo "Next Steps:"
echo "1. Test a few API requests from the frontend"
echo "2. You should no longer see 403 Forbidden errors"
echo ""
echo "If still seeing errors:"
echo "  1. Check backend logs: ssh ... docker logs backend-api -f"
echo "  2. Verify environment: ssh ... sudo cat /etc/dpp/dpp.env | grep COOKIE"
echo "  3. Check browser cookies: DevTools → Application → Cookies"
echo ""
