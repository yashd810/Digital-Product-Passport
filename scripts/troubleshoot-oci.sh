#!/usr/bin/env bash
# OCI Instance Troubleshooting Script
# Usage: OCI_IP="<host-ip>" bash scripts/troubleshoot-oci.sh

set -euo pipefail

OCI_IP="${OCI_IP:-}"
SSH_KEY="${SSH_KEY:-}"
SSH_KNOWN_HOSTS="${SSH_KNOWN_HOSTS:-${HOME:-}/.ssh/known_hosts}"
OCI_USER="${OCI_USER:-ubuntu}"

file_mode() {
    local file="$1"
    if stat -c '%a' "$file" >/dev/null 2>&1; then
        stat -c '%a' "$file"
    else
        stat -f '%Lp' "$file"
    fi
}

if [ -z "$OCI_IP" ]; then
    echo "OCI_IP is required. Example: OCI_IP='<host-ip>' bash scripts/troubleshoot-oci.sh"
    exit 1
fi

if ! [[ "$OCI_IP" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ ]]; then
    echo "OCI_IP must be a hostname, IPv4 address, or IPv6 address without shell metacharacters."
    exit 1
fi

if ! [[ "$OCI_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
    echo "OCI_USER must be a valid Linux account name."
    exit 1
fi

if [ -z "$SSH_KEY" ]; then
    echo "SSH_KEY is required and must point to the OCI deployment private key."
    exit 1
fi

if [ -L "$SSH_KEY" ] || [ ! -f "$SSH_KEY" ]; then
    echo "SSH key not found or is a symlink: $SSH_KEY"
    exit 1
fi

SSH_KEY_MODE="$(file_mode "$SSH_KEY")"
if (( (8#$SSH_KEY_MODE & 8#077) != 0 )); then
    echo "SSH key must not be readable by group or others: $SSH_KEY (mode $SSH_KEY_MODE)"
    exit 1
fi

if [ -L "$SSH_KNOWN_HOSTS" ] || [ ! -f "$SSH_KNOWN_HOSTS" ]; then
    echo "SSH_KNOWN_HOSTS must point to an existing non-symlinked trusted known_hosts file: $SSH_KNOWN_HOSTS"
    echo "Verify the OCI host key fingerprint in the OCI Console before adding it."
    exit 1
fi

SSH_OPTS=(-i "$SSH_KEY" -o UserKnownHostsFile="$SSH_KNOWN_HOSTS" -o StrictHostKeyChecking=yes -o ConnectTimeout=5 -o BatchMode=yes)

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
if ping -c 3 -- "$OCI_IP" > /dev/null 2>&1; then
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
if nc -zv -w 5 -- "$OCI_IP" 22 > /dev/null 2>&1; then
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
echo "   Running: ssh -vvv -i '$SSH_KEY' -o UserKnownHostsFile='$SSH_KNOWN_HOSTS' -o StrictHostKeyChecking=yes ${OCI_USER}@${OCI_IP} 'echo OK'"
echo ""
/usr/bin/ssh -vvv "${SSH_OPTS[@]}" "${OCI_USER}@${OCI_IP}" "echo OK" 2>&1 | head -30 || true

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
echo "2. Navigate to instance ($OCI_IP)"
echo ""
echo "3. Click 'Console Connection' button"
echo ""
echo "4. Use OCI Cloud Shell to check:"
echo "   sudo systemctl status docker"
echo "   sudo docker ps"
echo "   sudo docker ps --filter 'label=com.docker.compose.service=backend-api' --format '{{.Names}}'"
echo "   sudo docker logs <backend-container-name> 2>&1 | tail -50"
echo ""
echo "5. If containers are still running:"
echo "   - Deployment is likely still in progress"
echo "   - Wait 10-15 minutes and try SSH again"
echo ""
echo "6. If containers crashed:"
echo "   - On a backend host, find the service container with:"
echo "     sudo docker ps --filter 'label=com.docker.compose.service=backend-api' --format '{{.Names}}'"
echo "   - Then check logs: sudo docker logs <backend-container-name>"
echo "   - Redeploy with the guarded deployment command rather than running Docker Compose manually:"
echo "     sudo env DPP_ENV_FILE=/etc/dpp/dpp.env DPP_DEPLOY_TARGET=<frontend|backend|all> /opt/dpp/infra/oracle/deploy-prod.sh"
echo "   - The deployment script validates the target configuration and reloads Caddy when required."
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
echo "  export OCI_IP='<host-ip>'"
echo "  export SSH_KNOWN_HOSTS='<verified-known-hosts-file>'"
echo "  bash scripts/deploy/deploy-to-oci.sh"
echo ""
