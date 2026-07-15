#!/usr/bin/env bash
set -euo pipefail

TARGETS=("$@")
MARKETING_URL="${DPP_MARKETING_URL:-}"

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

if [ "${#TARGETS[@]}" -eq 0 ]; then
  MARKETING_URL="${MARKETING_URL:-$(read_env_var MARKETING_URL)}"
  APP_URL="$(read_env_var APP_URL)"
  VIEWER_URL="$(read_env_var VITE_PUBLIC_VIEWER_URL)"
  SERVER_URL="$(read_env_var SERVER_URL)"
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

check_host() {
  local target="$1"
  local host
  local path
  local failed=0
  local headers

  host="$(host_for_target "$target")"
  path="$(path_for_host "$host" "$(explicit_path_for_target "$target")")"
  echo "== Checking https://${host}${path} =="
  if ! headers="$(curl -fsSIL --http2 --max-time 20 "https://${host}${path}")"; then
    echo "FAIL: could not fetch https://${host}${path}"
    return 1
  fi
  printf '%s\n' "$headers" | sed -n '1,20p'

  require_header "$host" "$headers" "strict-transport-security" || failed=1
  require_header "$host" "$headers" "x-content-type-options" || failed=1
  require_header "$host" "$headers" "referrer-policy" || failed=1

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
