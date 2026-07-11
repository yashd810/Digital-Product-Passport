#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

check_caddyfile() {
  file="$1"

  if ! grep -Eq 'protocols[[:space:]]+h1[[:space:]]+h2[[:space:]]+h3' "$file"; then
    echo "FAIL: $file does not enable h1/h2/h3 on the public :443 listener"
    exit 1
  fi

  if ! grep -Eq 'protocols[[:space:]]+tls1\.2[[:space:]]+tls1\.3' "$file"; then
    echo "FAIL: $file does not pin TLS to tls1.2/tls1.3"
    exit 1
  fi

  if ! grep -q 'Strict-Transport-Security' "$file"; then
    echo "FAIL: $file does not set Strict-Transport-Security at the edge"
    exit 1
  fi

  if ! grep -q 'X-Content-Type-Options' "$file"; then
    echo "FAIL: $file does not set X-Content-Type-Options at the edge"
    exit 1
  fi
}

check_caddyfile "$ROOT_DIR/infra/oracle/Caddyfile"
check_caddyfile "$ROOT_DIR/infra/oracle/Caddyfile.frontend"
check_caddyfile "$ROOT_DIR/infra/oracle/Caddyfile.backend"

echo "PASS: Oracle edge Caddyfiles enable h1/h2/h3, restrict TLS to 1.2/1.3, and set baseline security headers"
