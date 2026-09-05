#!/bin/bash -p
set -euo pipefail
PATH="/usr/sbin:/usr/bin:/sbin:/bin"
export PATH

TARGETS=("$@")
MARKETING_URL="${DPP_MARKETING_URL:-}"
APP_URL=""
VIEWER_URL=""
SERVER_URL=""
readonly CURL_BIN="/usr/bin/curl"
readonly DOTFILE_PROBE_PATHS=(
  "/.env"
  "/.git/HEAD"
  "/%2eenv"
  "/%2Egit/HEAD"
  "//.env"
  "/assets/%2e%2e/.env"
  "/assets/..%2f.env"
)

read_env_var() {
  local key="$1"
  local env_file="${DPP_ENV_FILE:-}"
  [ -n "$env_file" ] && [ -f "$env_file" ] || return 0
  awk -v target="$key" '
    $0 ~ "^[[:space:]]*" target "[[:space:]]*=" {
      value=substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]"'\''"]+|[[:space:]"'\''"]+$/, "", value)
      print value
      exit
    }
  ' "$env_file"
}

[ -x "$CURL_BIN" ] || {
  echo "Required curl executable is unavailable: $CURL_BIN" >&2
  exit 1
}

if [ -n "${DPP_ENV_FILE:-}" ] && [ -f "$DPP_ENV_FILE" ]; then
  MARKETING_URL="${MARKETING_URL:-$(read_env_var MARKETING_URL)}"
  APP_URL="$(read_env_var APP_URL)"
  VIEWER_URL="$(read_env_var VITE_PUBLIC_VIEWER_URL)"
  SERVER_URL="$(read_env_var SERVER_URL)"
fi

if [ "${#TARGETS[@]}" -eq 0 ]; then
  if [ -z "$MARKETING_URL" ] || [ -z "$APP_URL" ] || [ -z "$VIEWER_URL" ] || [ -z "$SERVER_URL" ]; then
    echo "Pass explicit edge targets or set DPP_ENV_FILE with MARKETING_URL, APP_URL, VITE_PUBLIC_VIEWER_URL, and SERVER_URL."
    exit 64
  fi
  TARGETS=("$MARKETING_URL" "$APP_URL" "$VIEWER_URL" "$SERVER_URL")
fi

require_header() {
  local host="$1"
  local headers="$2"
  local header="$3"

  if ! printf '%s\n' "$headers" | grep -iq "^${header}:"; then
    echo "FAIL: https://${host} is missing ${header}"
    return 1
  fi
}

path_for_host() {
  local host="$1"
  local explicit_path="${2:-}"

  if [ -n "$explicit_path" ]; then
    echo "$explicit_path"
    return
  fi

  if [[ "$host" == api.* ]]; then
    echo "/health"
    return
  fi

  echo "/"
}

host_for_target() {
  local target="$1"
  local authority

  target="${target#https://}"
  target="${target#http://}"
  authority="${target%%/*}"
  if [[ "$authority" == \[* ]]; then
    if [[ "$authority" =~ ^(\[[0-9A-Fa-f:.]+\])(:[0-9]+)?$ ]]; then
      echo "${BASH_REMATCH[1]}"
      return
    fi
    echo ""
    return
  fi
  echo "${authority%%:*}"
}

explicit_path_for_target() {
  local target="$1"

  target="${target#https://}"
  target="${target#http://}"
  if [[ "$target" == */* ]]; then
    echo "/${target#*/}"
    return
  fi
  echo ""
}

requires_dotfile_probe() {
  local target="$1"
  local host="$2"
  local normalized_target="${target%/}"
  local normalized_server_url="${SERVER_URL%/}"

  # The API edge has a separate health endpoint and is not a SPA. The static
  # marketing, dashboard, and public-viewer edges must never turn a dotfile
  # request into a successful SPA shell, including after Caddy or image drift.
  if [ -n "$normalized_server_url" ] && [ "$normalized_target" = "$normalized_server_url" ]; then
    return 1
  fi
  [[ "$host" == api.* ]] && return 1
  return 0
}

check_dotfile_probes() {
  local host="$1"
  local probe_path
  local status
  local failed=0

  for probe_path in "${DOTFILE_PROBE_PATHS[@]}"; do
    # --path-as-is prevents curl from normalizing doubled slashes, dot segments,
    # or their encoded forms before the public edge sees the adversarial path.
    status="$(
      "$CURL_BIN" --path-as-is --silent --show-error --output /dev/null --write-out '%{http_code}' \
        --connect-timeout 5 --max-time 20 --proto '=https' --proto-redir '=https' \
        "https://${host}${probe_path}" 2>/dev/null || true
    )"
    if [[ ! "$status" =~ ^[1-5][0-9]{2}$ ]]; then
      echo "FAIL: https://${host} did not return an HTTP status for a protected dotfile path"
      failed=1
    elif [[ "$status" =~ ^[23][0-9]{2}$ ]]; then
      echo "FAIL: https://${host} returned HTTP ${status} for a protected dotfile path"
      failed=1
    fi
  done

  return "$failed"
}

check_host() {
  local target="$1"
  local host
  local path
  local failed=0
  local headers
  local mismatched_host_status

  host="$(host_for_target "$target")"
  path="$(path_for_host "$host" "$(explicit_path_for_target "$target")")"
  echo "== Checking https://${host}${path} =="
  if ! headers="$("$CURL_BIN" --fail --silent --show-error --head --include --location --http2 \
    --connect-timeout 5 --max-time 20 --proto '=https' --proto-redir '=https' \
    "https://${host}${path}")"; then
    echo "FAIL: could not fetch https://${host}${path}"
    return 1
  fi
  printf '%s\n' "$headers" | sed -n '1,20p'

  require_header "$host" "$headers" "strict-transport-security" || failed=1
  require_header "$host" "$headers" "x-content-type-options" || failed=1
  require_header "$host" "$headers" "referrer-policy" || failed=1

  mismatched_host_status="$(
    "$CURL_BIN" --silent --show-error --output /dev/null --http2 --connect-timeout 5 --max-time 20 \
      --proto '=https' --proto-redir '=https' \
      -H 'Host: invalid.invalid' \
      -w '%{http_code}' "https://${host}${path}" 2>/dev/null || true
  )"
  if [ "$mismatched_host_status" != "421" ]; then
    echo "FAIL: https://${host}${path} returned ${mismatched_host_status:-no response} for a Host/SNI mismatch; expected 421"
    failed=1
  fi

  local marketing_host=""
  if [ -n "$MARKETING_URL" ]; then
    marketing_host="$(host_for_target "$MARKETING_URL")"
  fi
  if [ -n "$marketing_host" ] && [ "$host" = "$marketing_host" ]; then
    if printf '%s\n' "$headers" | grep -iq '^cache-control:.*immutable'; then
      echo "FAIL: https://${host} serves HTML with immutable cache headers"
      failed=1
    fi
  fi

  if requires_dotfile_probe "$target" "$host"; then
    check_dotfile_probes "$host" || failed=1
  fi

  if [ "$failed" -ne 0 ]; then
    echo
    return 1
  fi

  echo "PASS: https://${host}${path} has baseline edge headers"
  echo
}

failed=0
for target in "${TARGETS[@]}"; do
  check_host "$target" || failed=1
done

exit "$failed"
