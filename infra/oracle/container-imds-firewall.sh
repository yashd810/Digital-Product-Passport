#!/bin/bash -p
# Block Docker-forwarded traffic to the OCI instance metadata endpoint without
# changing host-originated access. OCI can provide Docker with DNS at the same
# link-local address, so a dedicated chain returns only DNS (TCP/UDP 53) to
# DOCKER-USER and rejects every other connection to that address. Returning
# from the dedicated chain preserves future DOCKER-USER policy after this
# control; a top-level RETURN rule would bypass it.
# Install through install-container-imds-firewall.sh only after the host-network
# change has been approved.

set -euo pipefail
PATH="/usr/sbin:/usr/bin:/sbin:/bin"
export PATH

MODE="${1:-check}"
IMDS_ADDRESS="169.254.169.254/32"
IMDS_CHAIN="DPP-CONTAINER-IMDS-GUARD"
BLOCK_RULE_COMMENT="dpp-block-container-imds"
DNS_RULE_COMMENT="dpp-allow-container-dns"
JUMP_RULE_COMMENT="dpp-container-imds-guard"
TEST_MODE="${DPP_FIREWALL_TEST_MODE:-false}"
IPTABLES_CMD="${DPP_IPTABLES_CMD:-iptables}"

fail() {
  echo "Container IMDS firewall: $*" >&2
  exit 1
}

file_mode() {
  local file="$1"
  if stat -c '%a' "$file" >/dev/null 2>&1; then
    stat -c '%a' "$file"
  else
    stat -f '%Lp' "$file"
  fi
}

file_owner() {
  local file="$1"
  if stat -c '%u' "$file" >/dev/null 2>&1; then
    stat -c '%u' "$file"
  else
    stat -f '%u' "$file"
  fi
}

require_installed_root_owned_script() {
  local script_path="${BASH_SOURCE[0]}"
  local script_mode

  # Test mode intentionally runs the checked-in source against a fake
  # iptables command.  Production invocations must use the root-owned copy
  # installed below /usr/local so a systemd restart never consumes /opt/dpp.
  if [ "$TEST_MODE" = "true" ]; then
    return 0
  fi
  if [ "$script_path" != "/usr/local/sbin/dpp-container-imds-firewall" ]; then
    fail "must run from /usr/local/sbin/dpp-container-imds-firewall, not a checkout path"
  fi
  if [ -L "$script_path" ] || [ ! -f "$script_path" ]; then
    fail "installed firewall script must be a regular non-symlinked file"
  fi
  if [ "$(file_owner "$script_path")" != "0" ]; then
    fail "installed firewall script must be owned by root"
  fi
  script_mode="$(file_mode "$script_path")"
  if (( (8#$script_mode & 8#022) != 0 )); then
    fail "installed firewall script must not be writable by group or others"
  fi
}

case "$MODE" in
  apply|check|remove) ;;
  *) fail "usage: $0 [apply|check|remove]" ;;
esac

case "$TEST_MODE" in
  true|false) ;;
  *) fail "DPP_FIREWALL_TEST_MODE must be true or false" ;;
esac

require_installed_root_owned_script

if [ "$TEST_MODE" != "true" ] && [ "$(id -u)" -ne 0 ]; then
  fail "must run as root"
fi
if [ "$TEST_MODE" != "true" ] && [ -n "${DPP_IPTABLES_CMD:-}" ]; then
  fail "DPP_IPTABLES_CMD is accepted only in test mode"
fi
command -v "$IPTABLES_CMD" >/dev/null 2>&1 || fail "iptables command is unavailable"

# This also matches the broad top-level rule installed by previous releases.
# During an upgrade, it is temporarily kept at the top of DOCKER-USER while
# the owned chain is rebuilt, so no transition permits metadata access.
LEGACY_BLOCK_RULE=(
  -d "$IMDS_ADDRESS"
  -m comment --comment "$BLOCK_RULE_COMMENT"
  -j REJECT --reject-with icmp-port-unreachable
)

JUMP_RULE=(
  -d "$IMDS_ADDRESS"
  -m comment --comment "$JUMP_RULE_COMMENT"
  -j "$IMDS_CHAIN"
)

DNS_UDP_RULE=(
  -p udp --dport 53
  -m comment --comment "$DNS_RULE_COMMENT"
  -j RETURN
)

DNS_TCP_RULE=(
  -p tcp --dport 53
  -m comment --comment "$DNS_RULE_COMMENT"
  -j RETURN
)

BLOCK_RULE=(
  -m comment --comment "$BLOCK_RULE_COMMENT"
  -j REJECT --reject-with icmp-port-unreachable
)

# Retire direct DNS returns from the short-lived implementation. A RETURN in
# DOCKER-USER skips any later user policy; a RETURN in the owned chain does not.
DIRECT_DNS_UDP_RULE=(
  -d "$IMDS_ADDRESS"
  "${DNS_UDP_RULE[@]}"
)

DIRECT_DNS_TCP_RULE=(
  -d "$IMDS_ADDRESS"
  "${DNS_TCP_RULE[@]}"
)

iptables_run() {
  "$IPTABLES_CMD" -w 5 "$@"
}

require_docker_user_chain() {
  if ! iptables_run -S DOCKER-USER >/dev/null 2>&1; then
    fail "Docker DOCKER-USER chain is unavailable; start Docker before applying the control"
  fi
}

chain_exists() {
  iptables_run -S "$IMDS_CHAIN" >/dev/null 2>&1
}

docker_rule_exists() {
  iptables_run -C DOCKER-USER "$@" >/dev/null 2>&1
}

chain_rule_exists() {
  iptables_run -C "$IMDS_CHAIN" "$@" >/dev/null 2>&1
}

remove_docker_rule() {
  while docker_rule_exists "$@"; do
    iptables_run -D DOCKER-USER "$@"
  done
}

chain_rules_are_ordered() {
  local rules
  rules="$(iptables_run -S "$IMDS_CHAIN" | awk -v chain="$IMDS_CHAIN" -v dns="$DNS_RULE_COMMENT" -v block="$BLOCK_RULE_COMMENT" '
    $1 != "-A" || $2 != chain { next }
    index($0, dns) && $0 ~ /-p tcp/ && $0 ~ /--dport 53/ && $0 ~ /-j RETURN/ { print "tcp"; next }
    index($0, dns) && $0 ~ /-p udp/ && $0 ~ /--dport 53/ && $0 ~ /-j RETURN/ { print "udp"; next }
    index($0, block) && $0 ~ /-j REJECT/ { print "block"; next }
    { print "unexpected" }
  ')"
  [ "$rules" = $'tcp\nudp\nblock' ]
}

required_rules_are_active() {
  chain_exists \
    && docker_rule_exists "${JUMP_RULE[@]}" \
    && ! docker_rule_exists "${LEGACY_BLOCK_RULE[@]}" \
    && ! docker_rule_exists "${DIRECT_DNS_UDP_RULE[@]}" \
    && ! docker_rule_exists "${DIRECT_DNS_TCP_RULE[@]}" \
    && chain_rule_exists "${DNS_UDP_RULE[@]}" \
    && chain_rule_exists "${DNS_TCP_RULE[@]}" \
    && chain_rule_exists "${BLOCK_RULE[@]}" \
    && chain_rules_are_ordered
}

ensure_imds_chain() {
  if ! chain_exists; then
    iptables_run -N "$IMDS_CHAIN"
  fi
}

apply_rules() {
  if required_rules_are_active; then
    return 0
  fi

  ensure_imds_chain

  # Keep a broad reject at the top of DOCKER-USER while the owned chain is
  # rebuilt. This temporarily pauses bridge DNS but never opens a path to IMDS.
  # The temporary rule is removed only after the chain and its jump are ready.
  iptables_run -I DOCKER-USER 1 "${LEGACY_BLOCK_RULE[@]}"
  iptables_run -F "$IMDS_CHAIN"
  iptables_run -A "$IMDS_CHAIN" "${BLOCK_RULE[@]}"
  iptables_run -I "$IMDS_CHAIN" 1 "${DNS_UDP_RULE[@]}"
  iptables_run -I "$IMDS_CHAIN" 1 "${DNS_TCP_RULE[@]}"

  remove_docker_rule "${DIRECT_DNS_UDP_RULE[@]}"
  remove_docker_rule "${DIRECT_DNS_TCP_RULE[@]}"
  remove_docker_rule "${JUMP_RULE[@]}"
  iptables_run -I DOCKER-USER 1 "${JUMP_RULE[@]}"
  remove_docker_rule "${LEGACY_BLOCK_RULE[@]}"
}

remove_rules() {
  remove_docker_rule "${DIRECT_DNS_UDP_RULE[@]}"
  remove_docker_rule "${DIRECT_DNS_TCP_RULE[@]}"
  remove_docker_rule "${JUMP_RULE[@]}"
  remove_docker_rule "${LEGACY_BLOCK_RULE[@]}"

  if chain_exists; then
    iptables_run -F "$IMDS_CHAIN"
    iptables_run -X "$IMDS_CHAIN"
  fi
}

case "$MODE" in
  apply)
    require_docker_user_chain
    apply_rules
    required_rules_are_active || fail "dedicated DNS exception and IMDS rejection were not active after apply"
    echo "Container IMDS firewall and DNS exception are active."
    ;;
  check)
    require_docker_user_chain
    required_rules_are_active || fail "required dedicated DNS exception or IMDS rejection rule is missing or out of order"
    echo "Container IMDS firewall and DNS exception are active."
    ;;
  remove)
    require_docker_user_chain
    remove_rules
    echo "Container IMDS firewall and DNS exception removed; host access was unchanged."
    ;;
esac
