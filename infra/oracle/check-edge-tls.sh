#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <hostname> [port]"
  exit 1
fi

HOST="$1"
PORT="${2:-443}"

echo "== TLS floor checks for ${HOST}:${PORT} =="
echo

echo "-- Expect TLS 1.0 to fail --"
if openssl s_client -connect "${HOST}:${PORT}" -servername "${HOST}" -tls1 </dev/null >/tmp/"${HOST}".tls10.out 2>&1; then
  echo "FAIL: TLS 1.0 handshake succeeded"
  cat /tmp/"${HOST}".tls10.out
  exit 1
else
  echo "PASS: TLS 1.0 handshake rejected"
fi
echo

echo "-- Expect TLS 1.1 to fail --"
if openssl s_client -connect "${HOST}:${PORT}" -servername "${HOST}" -tls1_1 </dev/null >/tmp/"${HOST}".tls11.out 2>&1; then
  echo "FAIL: TLS 1.1 handshake succeeded"
  cat /tmp/"${HOST}".tls11.out
  exit 1
else
  echo "PASS: TLS 1.1 handshake rejected"
fi
echo

echo "-- Expect TLS 1.2 to succeed --"
openssl s_client -connect "${HOST}:${PORT}" -servername "${HOST}" -tls1_2 </dev/null 2>&1 \
  | sed -n '1,20p'
echo

echo "-- Expect ALPN to negotiate HTTP/2 --"
curl -I --http2 --max-time 15 "https://${HOST}:${PORT}/" 2>&1 | sed -n '1,20p'
echo

echo "-- Optional external-grade scan --"
echo "Run SSL Labs against: https://${HOST}"
echo "Or run testssl.sh locally against: ${HOST}:${PORT}"
