#!/usr/bin/env bash
set -euo pipefail

TARGETS=("$@")
if [ "${#TARGETS[@]}" -eq 0 ]; then
  TARGETS=(
    "claros-dpp.online"
    "app.claros-dpp.online"
    "viewer.claros-dpp.online"
    "api.claros-dpp.online"
  )
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

  target="${target#https://}"
  target="${target#http://}"
  target="${target%%/*}"
  target="${target%%:*}"
  echo "$target"
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

  if [ "$host" = "claros-dpp.online" ]; then
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
