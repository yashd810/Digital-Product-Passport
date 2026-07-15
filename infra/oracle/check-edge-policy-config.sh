#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM

check_caddyfile_template() {
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

check_api_security_headers() {
  file="$1"

  if ! awk '
    /^__API_HOST__[[:space:]]*\{/ { in_api = 1; next }
    in_api && /^[[:space:]]*}/ { in_api = 0 }
    in_api && /import[[:space:]]+security_headers/ { found = 1 }
    END { exit(found ? 0 : 1) }
  ' "$file"; then
    echo "FAIL: $file does not apply security_headers to the API edge"
    exit 1
  fi
}

printf '%s\n' \
  'SERVER_URL=https://api.example.test' \
  'APP_URL=https://app.example.test' \
  'MARKETING_URL=https://www.example.test' \
  'VITE_PUBLIC_VIEWER_URL=https://viewer.example.test' \
  > "$TMP_DIR/dpp.env"

check_caddyfile_template "$ROOT_DIR/infra/oracle/Caddyfile.template"
check_caddyfile_template "$ROOT_DIR/infra/oracle/Caddyfile.frontend.template"
check_caddyfile_template "$ROOT_DIR/infra/oracle/Caddyfile.backend.template"
check_api_security_headers "$ROOT_DIR/infra/oracle/Caddyfile.template"
check_api_security_headers "$ROOT_DIR/infra/oracle/Caddyfile.backend.template"

for target in all frontend backend; do
  case "$target" in
    all) template="$ROOT_DIR/infra/oracle/Caddyfile.template" ;;
    frontend) template="$ROOT_DIR/infra/oracle/Caddyfile.frontend.template" ;;
    backend) template="$ROOT_DIR/infra/oracle/Caddyfile.backend.template" ;;
  esac
  DPP_ENV_FILE="$TMP_DIR/dpp.env" bash "$ROOT_DIR/infra/oracle/render-caddyfile.sh" \
    "$target" "$template" "$TMP_DIR/$target.Caddyfile"
  if grep -Eq '__[A-Z0-9_]+__' "$TMP_DIR/$target.Caddyfile"; then
    echo "FAIL: rendered $target Caddyfile contains unresolved placeholders"
    exit 1
  fi
done

if ! grep -q '^api\.example\.test {' "$TMP_DIR/all.Caddyfile"; then
  echo "FAIL: renderer did not derive the API Caddy host from SERVER_URL"
  exit 1
fi

assert_renderer_rejects_server_url() {
  origin="$1"
  label="$2"
  reject_index=$((reject_index + 1))
  env_file="$TMP_DIR/reject-$reject_index.env"
  printf '%s\n' \
    "SERVER_URL=$origin" \
    'APP_URL=https://app.example.test' \
    'MARKETING_URL=https://www.example.test' \
    'VITE_PUBLIC_VIEWER_URL=https://viewer.example.test' \
    > "$env_file"
  if DPP_ENV_FILE="$env_file" bash "$ROOT_DIR/infra/oracle/render-caddyfile.sh" \
    backend "$ROOT_DIR/infra/oracle/Caddyfile.backend.template" "$TMP_DIR/reject-$reject_index.Caddyfile" \
    > "$TMP_DIR/reject-$reject_index.log" 2>&1; then
    echo "FAIL: renderer accepted $label production edge host: $origin"
    exit 1
  fi
}

assert_renderer_accepts_server_url() {
  origin="$1"
  expected_host="$2"
  accept_index=$((accept_index + 1))
  env_file="$TMP_DIR/accept-$accept_index.env"
  output_file="$TMP_DIR/accept-$accept_index.Caddyfile"
  printf '%s\n' \
    "SERVER_URL=$origin" \
    'APP_URL=https://app.example.test' \
    'MARKETING_URL=https://www.example.test' \
    'VITE_PUBLIC_VIEWER_URL=https://viewer.example.test' \
    > "$env_file"
  if ! DPP_ENV_FILE="$env_file" bash "$ROOT_DIR/infra/oracle/render-caddyfile.sh" \
    backend "$ROOT_DIR/infra/oracle/Caddyfile.backend.template" "$output_file"; then
    echo "FAIL: renderer rejected public production edge host: $origin"
    exit 1
  fi
  if ! grep -Fq "$expected_host {" "$output_file"; then
    echo "FAIL: renderer did not preserve public production edge host: $origin"
    exit 1
  fi
}

reject_index=0
for rejected_origin in \
  'https://0.0.0.0' \
  'https://10.0.0.1' \
  'https://100.64.0.1' \
  'https://127.0.0.1' \
  'https://169.254.169.254' \
  'https://172.16.0.1' \
  'https://192.0.0.1' \
  'https://192.0.2.1' \
  'https://192.88.99.1' \
  'https://192.168.0.1' \
  'https://198.18.0.1' \
  'https://198.51.100.1' \
  'https://203.0.113.1' \
  'https://224.0.0.1' \
  'https://0x7f000001' \
  'https://0x7f.0x0.0x0.0x1' \
  'https://127.1' \
  'https://[::]' \
  'https://[::1]' \
  'https://[::10.0.0.1]' \
  'https://[::ffff:127.0.0.1]' \
  'https://[::ffff:7f00:1]' \
  'https://[64:ff9b::a00:1]' \
  'https://[fc00::1]' \
  'https://[fe80::1]' \
  'https://[fec0::1]' \
  'https://[ff02::1]' \
  'https://[2001::1]' \
  'https://[2001:2::1]' \
  'https://[2001:db8::1]' \
  'https://[2002::1]' \
  'https://[3ffe::1]'; do
  assert_renderer_rejects_server_url "$rejected_origin" 'private, reserved, or documentation'
done

accept_index=0
assert_renderer_accepts_server_url 'https://8.8.8.8' '8.8.8.8'
assert_renderer_accepts_server_url 'https://[2606:4700:4700::1111]' '[2606:4700:4700::1111]'
assert_renderer_accepts_server_url 'https://[64:ff9b::808:808]' '[64:ff9b::808:808]'

echo "PASS: Oracle edge Caddy templates are rendered from validated public origins and retain the required TLS and security-header policy"
