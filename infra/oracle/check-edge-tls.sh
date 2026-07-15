#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 <hostname-or-ip> [port]"
}

is_valid_ipv4() {
  local value="$1"
  local octet
  local -a octets

  [[ "$value" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  IFS='.' read -r -a octets <<<"$value"
  for octet in "${octets[@]}"; do
    (( 10#$octet <= 255 )) || return 1
  done
}

is_valid_hostname() {
  local value="$1"
  local label
  local -a labels

  [[ ${#value} -le 253 ]] || return 1
  [[ "$value" != *".."* ]] || return 1
  [[ "$value" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || return 1
  IFS='.' read -r -a labels <<<"$value"
  for label in "${labels[@]}"; do
    [[ ${#label} -le 63 ]] || return 1
    [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
  done
}

is_safe_bracketed_ipv6() {
  local value="$1"

  [[ "$value" =~ ^\[[0-9A-Fa-f:.]+\]$ ]] && [[ "$value" == *:* ]]
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 1
fi

HOST="$1"
PORT="${2:-443}"

if ! is_valid_hostname "$HOST" && ! is_valid_ipv4 "$HOST" && ! is_safe_bracketed_ipv6 "$HOST"; then
  echo "Hostname must be a DNS hostname, IPv4 address, or bracketed IPv6 literal."
  exit 1
fi
if ! [[ "$PORT" =~ ^[0-9]{1,5}$ ]] || (( 10#$PORT < 1 || 10#$PORT > 65535 )); then
  echo "Port must be an integer between 1 and 65535."
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "openssl and curl are required."
  exit 1
fi

SERVER_NAME="${HOST#[}"
SERVER_NAME="${SERVER_NAME%]}"
TMP_DIR="$(mktemp -d /tmp/dpp-edge-tls.XXXXXX)"
TLS10_OUTPUT="$TMP_DIR/tls10.out"
TLS11_OUTPUT="$TMP_DIR/tls11.out"
cleanup() {
  rm -f -- "$TLS10_OUTPUT" "$TLS11_OUTPUT"
  rmdir -- "$TMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

echo "== TLS floor checks for ${HOST}:${PORT} =="
echo

echo "-- Expect TLS 1.0 to fail --"
if openssl s_client -connect "${HOST}:${PORT}" -servername "$SERVER_NAME" -tls1 </dev/null >"$TLS10_OUTPUT" 2>&1; then
  echo "FAIL: TLS 1.0 handshake succeeded"
  cat "$TLS10_OUTPUT"
  exit 1
else
  echo "PASS: TLS 1.0 handshake rejected"
fi
echo

echo "-- Expect TLS 1.1 to fail --"
if openssl s_client -connect "${HOST}:${PORT}" -servername "$SERVER_NAME" -tls1_1 </dev/null >"$TLS11_OUTPUT" 2>&1; then
  echo "FAIL: TLS 1.1 handshake succeeded"
  cat "$TLS11_OUTPUT"
  exit 1
else
  echo "PASS: TLS 1.1 handshake rejected"
fi
echo

echo "-- Expect TLS 1.2 to succeed --"
openssl s_client -connect "${HOST}:${PORT}" -servername "$SERVER_NAME" -tls1_2 </dev/null 2>&1 \
  | sed -n '1,20p'
echo

echo "-- Expect ALPN to negotiate HTTP/2 --"
curl -I --http2 --max-time 15 "https://${HOST}:${PORT}/" 2>&1 | sed -n '1,20p'
echo

echo "-- Optional external-grade scan --"
echo "Run SSL Labs against: https://${HOST}"
echo "Or run testssl.sh locally against: ${HOST}:${PORT}"
