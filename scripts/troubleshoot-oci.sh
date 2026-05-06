#!/bin/bash
# OCI Instance Troubleshooting Script
# Usage: OCI_IP="79.72.16.68" bash scripts/troubleshoot-oci.sh

set -e

OCI_IP="${OCI_IP:-79.72.16.68}"
SSH_KEY="${SSH_KEY:-$HOME/Desktop/AMD keys/ssh-key-2026-04-27.key}"
OCI_USER="ubuntu"

echo "=================================="
echo "🔍 OCI Instance Troubleshooting"
echo "=================================="
echo ""
echo "Target: $OCI_IP"
echo "User: $OCI_USER"
echo ""

# Test 1: Network connectivity
echo "1️⃣  Testing network connectivity..."
echo "   Running: ping -c 3 $OCI_IP"
if ping -c 3 $OCI_IP > /dev/null 2>&1; then
    echo "   ✅ Instance responds to ping"
else
    echo "   ❌ Instance does NOT respond to ping"
    echo "      → Instance may be stopped or network is down"
    echo ""
    echo "   Recommended actions:"
    echo "   - Check OCI Console if instance is running"
    echo "   - Check security list allows ICMP"
    echo "   - Try rebooting from OCI Console"
    echo ""
fi

# Test 2: SSH port connectivity
echo ""
echo "2️⃣  Testing SSH port (22) connectivity..."
echo "   Running: nc -zv -w 5 $OCI_IP 22"
if nc -zv -w 5 $OCI_IP 22 > /dev/null 2>&1; then
    echo "   ✅ SSH port 22 is open"
else
    echo "   ❌ SSH port 22 is NOT open"
    echo "      → Port might be blocked or SSH service is down"
    echo ""
    echo "   Recommended actions:"
    echo "   - Check security list allows port 22"
    echo "   - SSH into instance via OCI Console"
    echo "   - Run: sudo systemctl status ssh"
    echo "   - Run: sudo systemctl restart ssh"
    echo ""
fi

# Test 3: SSH connection with verbose output
echo ""
echo "3️⃣  Testing SSH connection with verbose output..."
echo "   Running: ssh -vvv -i '$SSH_KEY' -o ConnectTimeout=5 ${OCI_USER}@${OCI_IP} 'echo OK'"
echo ""
/usr/bin/ssh -vvv -i "$SSH_KEY" -o ConnectTimeout=5 "${OCI_USER}@${OCI_IP}" "echo OK" 2>&1 | head -30 || true

echo ""
echo "=================================="
echo "📋 Manual Recovery Steps"
echo "=================================="
echo ""
echo "If SSH is not working:"
echo ""
echo "1. Access OCI Console:"
echo "   https://www.oracle.com/cloud/sign-in/"
echo ""
echo "2. Navigate to instance (79.72.16.68)"
echo ""
echo "3. Click 'Console Connection' button"
echo ""
echo "4. Use OCI Cloud Shell to check:"
echo "   sudo systemctl status docker"
echo "   sudo docker ps"
echo "   sudo docker logs backend-api 2>&1 | tail -50"
echo ""
echo "5. If containers are still running:"
echo "   - Deployment is likely still in progress"
echo "   - Wait 10-15 minutes and try SSH again"
echo ""
echo "6. If containers crashed:"
echo "   - Check logs: sudo docker logs backend-api"
echo "   - Restart: sudo docker compose -f docker-compose.prod.yml restart"
echo ""
echo "7. If SSH service is down:"
echo "   - Use OCI Console to reboot instance"
echo "   - Or run: sudo systemctl restart ssh"
echo ""

echo "=================================="
echo "🔄 Retry Connection"
echo "=================================="
echo ""
echo "Once instance is accessible, retry deployment:"
echo "  export OCI_IP='79.72.16.68'"
echo "  bash scripts/deploy/deploy-to-oci.sh"
echo ""
