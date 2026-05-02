#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

check_caddyfile() {
  file="$1"

  if ! grep -Eq 'protocols[[:space:]]+h2[[:space:]]+h3' "$file"; then
    echo "FAIL: $file does not restrict the public :443 listener to h2/h3"
    exit 1
  fi

  if grep -Eq 'protocols[[:space:]].*\bh1\b' "$file"; then
    echo "FAIL: $file allows HTTP/1.1 on the public :443 listener"
    exit 1
  fi

  if ! grep -Eq 'protocols[[:space:]]+tls1\.2[[:space:]]+tls1\.3' "$file"; then
    echo "FAIL: $file does not pin TLS to tls1.2/tls1.3"
    exit 1
  fi
}

check_caddyfile "$ROOT_DIR/infra/oracle/Caddyfile"
check_caddyfile "$ROOT_DIR/infra/oracle/Caddyfile.frontend"
check_caddyfile "$ROOT_DIR/infra/oracle/Caddyfile.backend"

echo "PASS: Oracle edge Caddyfiles restrict public transport to TLS 1.2/1.3 and HTTP/2+"
