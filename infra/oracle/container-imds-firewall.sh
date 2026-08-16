#!/usr/bin/env bash
# Block Docker-forwarded traffic to the OCI instance metadata endpoint without
# changing host-originated access. Install through install-container-imds-firewall.sh
# only after the host-network change has been approved.

set -euo pipefail

MODE="${1:-check}"
IMDS_ADDRESS="169.254.169.254/32"
RULE_COMMENT="dpp-block-container-imds"
TEST_MODE="${DPP_FIREWALL_TEST_MODE:-false}"
IPTABLES_CMD="${DPP_IPTABLES_CMD:-iptables}"

fail() {
  echo "Container IMDS firewall: $*" >&2
  exit 1
}

case "$MODE" in
  apply|check|remove) ;;
  *) fail "usage: $0 [apply|check|remove]" ;;
esac

case "$TEST_MODE" in
  true|false) ;;
  *) fail "DPP_FIREWALL_TEST_MODE must be true or false" ;;
esac

if [ "$TEST_MODE" != "true" ] && [ "$(id -u)" -ne 0 ]; then
  fail "must run as root"
fi
if [ "$TEST_MODE" != "true" ] && [ -n "${DPP_IPTABLES_CMD:-}" ]; then
  fail "DPP_IPTABLES_CMD is accepted only in test mode"
fi
command -v "$IPTABLES_CMD" >/dev/null 2>&1 || fail "iptables command is unavailable"

RULE=(
  -d "$IMDS_ADDRESS"
  -m comment --comment "$RULE_COMMENT"
  -j REJECT --reject-with icmp-port-unreachable
)

iptables_run() {
  "$IPTABLES_CMD" -w 5 "$@"
}

require_docker_user_chain() {
  if ! iptables_run -S DOCKER-USER >/dev/null 2>&1; then
    fail "Docker DOCKER-USER chain is unavailable; start Docker before applying the control"
  fi
}

rule_exists() {
  iptables_run -C DOCKER-USER "${RULE[@]}" >/dev/null 2>&1
}

case "$MODE" in
  apply)
    require_docker_user_chain
    if ! rule_exists; then
      # DOCKER-USER is traversed only for forwarded container traffic. Host
      # OUTPUT traffic, including approved host IMDS diagnostics, is unchanged.
      iptables_run -I DOCKER-USER 1 "${RULE[@]}"
    fi
    rule_exists || fail "rule was not present after apply"
    echo "Container IMDS firewall rule is active."
    ;;
  check)
    require_docker_user_chain
    rule_exists || fail "required DOCKER-USER IMDS rejection rule is missing"
    echo "Container IMDS firewall rule is active."
    ;;
  remove)
    require_docker_user_chain
    while rule_exists; do
      iptables_run -D DOCKER-USER "${RULE[@]}"
    done
    echo "Container IMDS firewall rule removed; host access was unchanged."
    ;;
esac
