#!/bin/bash
# CRITICAL FIX: Cross-Domain Authentication Issue
# 
# Problem: Backend and frontend on different subdomains (api.claros-dpp.online vs app.claros-dpp.online)
# Symptom: All API requests return 403 Forbidden
# Root Cause: Cookies not being sent across subdomains due to missing COOKIE_DOMAIN setting

# The Fix: Add this to your .env.prod (or /etc/dpp/dpp.env)

echo "======================================"
echo "CRITICAL: Cross-Domain Cookie Fix"
echo "======================================"
echo ""
echo "Your .env.prod MUST contain:"
echo ""
echo "COOKIE_DOMAIN=.claros-dpp.online"
echo "COOKIE_SECURE=true"
echo "COOKIE_SAME_SITE=None"
echo ""
echo "These settings allow authentication cookies to be:"
echo "✓ Sent across all subdomains (.claros-dpp.online)"
echo "✓ Secure (HTTPS only)"
echo "✓ Shareable across different origins (SameSite=None)"
echo ""
echo "Without COOKIE_DOMAIN, the browser will NOT send cookies from:"
echo "  app.claros-dpp.online → api.claros-dpp.online"
echo ""
echo "This is why you were getting 403 on ALL authenticated endpoints:"
echo "  - GET /api/users/me/notifications 403"
echo "  - GET /api/messaging/unread 403"
echo "  - GET /api/companies/2/passport-types 403"
echo "  - GET /api/companies/2/activity 403"
echo "  - GET /api/companies/2/analytics 403"
echo ""
echo "======================================"
echo "DEPLOYMENT INSTRUCTIONS"
echo "======================================"
echo ""
echo "1. SSH into your OCI instance:"
echo "   ssh -i ~/.ssh/key ubuntu@79.76.53.122"
echo ""
echo "2. Edit the environment file:"
echo "   sudo nano /etc/dpp/dpp.env"
echo ""
echo "3. Find the line with COOKIE_SAME_SITE=None and ADD after it:"
echo "   COOKIE_DOMAIN=.claros-dpp.online"
echo ""
echo "4. Save and exit (Ctrl+X, Y, Enter)"
echo ""
echo "5. Restart the backend:"
echo "   docker-compose -f /opt/dpp/docker-compose.prod.yml down"
echo "   docker-compose -f /opt/dpp/docker-compose.prod.yml up -d backend-api"
echo ""
echo "6. Verify it's working:"
echo "   docker logs -f backend-api"
echo ""
echo "   You should see no 403 errors now."
echo ""

# Optional: Show current .env.prod if it exists
if [ -f /etc/dpp/dpp.env ]; then
  echo "======================================"
  echo "Current Cookie Settings:"
  echo "======================================"
  grep -E "COOKIE_|SESSION_" /etc/dpp/dpp.env || echo "No cookie settings found!"
  echo ""
fi
