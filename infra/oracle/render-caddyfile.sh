#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${DPP_ENV_FILE:-/etc/dpp/dpp.env}"

usage() {
  echo "Usage: DPP_ENV_FILE=/path/to/dpp.env $0 <all|frontend|backend> <template> <output>" >&2
  exit 64
}

[ "$#" -eq 3 ] || usage
DEPLOY_TARGET="$1"
TEMPLATE_FILE="$2"
OUTPUT_FILE="$3"

if [ -L "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "Missing regular environment file: $ENV_FILE" >&2
  exit 1
fi
if [ ! -f "$TEMPLATE_FILE" ]; then
  echo "Missing Caddy template: $TEMPLATE_FILE" >&2
  exit 1
fi

read_env_var() {
  local key="$1"
  awk -v target="$key" '
    $0 ~ "^[[:space:]]*" target "[[:space:]]*=" {
      value=substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]"'\''"]+|[[:space:]"'\''"]+$/, "", value)
      print value
      exit
    }
  ' "$ENV_FILE"
}

lowercase_ascii() {
  printf '%s' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]'
}

is_valid_ipv4() {
  local value="$1"
  local IFS='.'
  local -a octets=()
  local octet

  read -r -a octets <<< "$value"
  [ "${#octets[@]}" -eq 4 ] || return 1
  for octet in "${octets[@]}"; do
    [[ "$octet" =~ ^[0-9]{1,3}$ ]] || return 1
    if [ "${#octet}" -gt 1 ] && [ "${octet:0:1}" = "0" ]; then
      return 1
    fi
    (( 10#$octet <= 255 )) || return 1
  done
}

is_ipv4_literal_candidate() {
  local value="$1"
  local IFS='.'
  local -a parts=()
  local part

  read -r -a parts <<< "$value"
  [ "${#parts[@]}" -gt 0 ] || return 1
  for part in "${parts[@]}"; do
    [[ "$part" =~ ^([0-9]+|0[xX][0-9A-Fa-f]+)$ ]] || return 1
  done
}

ipv4_to_integer() {
  local value="$1"
  local IFS='.'
  local -a octets=()

  is_valid_ipv4 "$value" || return 1
  read -r -a octets <<< "$value"
  printf '%u\n' "$((
    (10#${octets[0]} * 16777216)
    + (10#${octets[1]} * 65536)
    + (10#${octets[2]} * 256)
    + 10#${octets[3]}
  ))"
}

# Return success when an IPv4 address is non-public. These ranges match the
# runtime origin validator, so a deployment cannot bypass its public-origin
# boundary merely by rendering the edge configuration separately.
is_ipv4_private_or_reserved() {
  local address
  local range
  local start
  local end
  local start_address
  local end_address
  local -a ranges=(
    "0.0.0.0 0.255.255.255"
    "10.0.0.0 10.255.255.255"
    "100.64.0.0 100.127.255.255"
    "127.0.0.0 127.255.255.255"
    "169.254.0.0 169.254.255.255"
    "172.16.0.0 172.31.255.255"
    "192.0.0.0 192.0.0.255"
    "192.0.2.0 192.0.2.255"
    "192.88.99.0 192.88.99.255"
    "192.168.0.0 192.168.255.255"
    "198.18.0.0 198.19.255.255"
    "198.51.100.0 198.51.100.255"
    "203.0.113.0 203.0.113.255"
    "224.0.0.0 255.255.255.255"
  )

  address="$(ipv4_to_integer "$1")" || return 0
  for range in "${ranges[@]}"; do
    read -r start end <<< "$range"
    start_address="$(ipv4_to_integer "$start")"
    end_address="$(ipv4_to_integer "$end")"
    if (( address >= start_address && address <= end_address )); then
      return 0
    fi
  done
  return 1
}

# Parsed IPv6 groups are kept in this array to avoid relying on external
# address-parsing tools on a fresh OCI host.
IPV6_HEXTETS=()

append_ipv6_hextets() {
  local side="$1"
  local IFS=':'
  local -a groups=()
  local group

  [ -n "$side" ] || return 0
  [[ "$side" != :* && "$side" != *: ]] || return 1
  read -r -a groups <<< "$side"
  for group in "${groups[@]}"; do
    [[ "$group" =~ ^[0-9A-Fa-f]{1,4}$ ]] || return 1
    IPV6_HEXTETS+=("$((16#$group))")
  done
}

parse_ipv6_hextets() {
  local address="$1"
  local ipv4_tail
  local ipv4_prefix
  local IFS='.'
  local -a ipv4_octets=()
  local left
  local right
  local missing
  local index
  local left_count
  local -a left_hextets=()
  local -a right_hextets=()

  IPV6_HEXTETS=()
  [[ "$address" =~ ^[0-9A-Fa-f:.]+$ ]] || return 1

  if [[ "$address" == *.* ]]; then
    [[ "$address" == *:* ]] || return 1
    ipv4_tail="${address##*:}"
    is_valid_ipv4 "$ipv4_tail" || return 1
    ipv4_prefix="${address%$ipv4_tail}"
    [ -n "$ipv4_prefix" ] && [ "${ipv4_prefix: -1}" = ":" ] || return 1
    read -r -a ipv4_octets <<< "$ipv4_tail"
    address="${ipv4_prefix}$(printf '%x:%x' \
      "$((10#${ipv4_octets[0]} * 256 + 10#${ipv4_octets[1]}))" \
      "$((10#${ipv4_octets[2]} * 256 + 10#${ipv4_octets[3]}))")"
  fi

  if [[ "$address" == *"::"* ]]; then
    left="${address%%::*}"
    right="${address#*::}"
    [[ "$right" != *"::"* ]] || return 1
    append_ipv6_hextets "$left" || return 1
    left_count="${#IPV6_HEXTETS[@]}"
    for ((index = 0; index < left_count; index += 1)); do
      left_hextets+=("${IPV6_HEXTETS[index]}")
    done
    append_ipv6_hextets "$right" || return 1
    # Bash 3 collapses a quoted sliced array expansion into one element.
    # Copy the halves explicitly so the validator behaves the same on macOS
    # and the OCI host's newer Bash.
    right_hextets=()
    for ((index = left_count; index < ${#IPV6_HEXTETS[@]}; index += 1)); do
      right_hextets+=("${IPV6_HEXTETS[index]}")
    done
    missing=$((8 - left_count - ${#right_hextets[@]}))
    (( missing > 0 )) || return 1
    IPV6_HEXTETS=()
    for ((index = 0; index < ${#left_hextets[@]}; index += 1)); do
      IPV6_HEXTETS+=("${left_hextets[index]}")
    done
    for ((index = 0; index < missing; index += 1)); do
      IPV6_HEXTETS+=(0)
    done
    IPV6_HEXTETS+=("${right_hextets[@]}")
  else
    append_ipv6_hextets "$address" || return 1
  fi

  [ "${#IPV6_HEXTETS[@]}" -eq 8 ]
}

is_ipv6_private_or_reserved() {
  local first
  local second
  local third
  local first_six_zero=1
  local ipv4_mapped=1
  local nat64_well_known=1
  local index
  local embedded_ipv4

  parse_ipv6_hextets "$1" || return 0
  first="${IPV6_HEXTETS[0]}"
  second="${IPV6_HEXTETS[1]}"
  third="${IPV6_HEXTETS[2]}"

  for ((index = 0; index < 6; index += 1)); do
    (( IPV6_HEXTETS[index] == 0 )) || first_six_zero=0
  done
  for ((index = 0; index < 5; index += 1)); do
    (( IPV6_HEXTETS[index] == 0 )) || ipv4_mapped=0
  done
  (( IPV6_HEXTETS[5] == 0xffff )) || ipv4_mapped=0
  (( first == 0x0064 && second == 0xff9b )) || nat64_well_known=0
  for ((index = 2; index < 6; index += 1)); do
    (( IPV6_HEXTETS[index] == 0 )) || nat64_well_known=0
  done

  if (( first_six_zero || ipv4_mapped || nat64_well_known )); then
    embedded_ipv4="$(
      printf '%d.%d.%d.%d' \
        "$(( (IPV6_HEXTETS[6] >> 8) & 0xff ))" \
        "$(( IPV6_HEXTETS[6] & 0xff ))" \
        "$(( (IPV6_HEXTETS[7] >> 8) & 0xff ))" \
        "$(( IPV6_HEXTETS[7] & 0xff ))"
    )"
    is_ipv4_private_or_reserved "$embedded_ipv4"
    return $?
  fi

  # Reject unique-local, link/site-local, multicast, Teredo, benchmark,
  # documentation, 6to4, and deprecated 6bone ranges.
  if (( (first & 0xfe00) == 0xfc00
    || (first & 0xffc0) == 0xfe80
    || (first & 0xffc0) == 0xfec0
    || (first & 0xff00) == 0xff00
    || (first == 0x2001 && second == 0x0000)
    || (first == 0x2001 && second == 0x0002 && third == 0x0000)
    || (first == 0x2001 && second == 0x0db8)
    || first == 0x2002
    || first == 0x3ffe )); then
    return 0
  fi
  return 1
}

is_valid_dns_hostname() {
  local hostname="$1"
  local IFS='.'
  local -a labels=()
  local label

  [ "${#hostname}" -le 253 ] || return 1
  read -r -a labels <<< "$hostname"
  [ "${#labels[@]}" -gt 0 ] || return 1
  for label in "${labels[@]}"; do
    [ "${#label}" -le 63 ] || return 1
    [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
  done
}

is_local_hostname() {
  local hostname="$1"
  case "$hostname" in
    localhost|localhost.localdomain|ip6-localhost|*.localhost|*.local) return 0 ;;
  esac
  return 1
}

origin_host() {
  local key="$1"
  local value
  local authority
  local host
  value="$(read_env_var "$key")"
  value="${value%/}"
  if [[ "$value" != https://* ]]; then
    echo "$key must be a public HTTPS origin without a port, path, query, fragment, or credentials" >&2
    exit 1
  fi
  authority="${value#https://}"
  if [[ "$authority" == \[*\] ]]; then
    host="${authority:1:${#authority}-2}"
    if [ -z "$host" ] || is_ipv6_private_or_reserved "$host"; then
      echo "$key must target a public DNS hostname or IP address" >&2
      exit 1
    fi
    printf '[%s]\n' "$(lowercase_ascii "$host")"
    return
  fi

  host="$(lowercase_ascii "$authority")"
  if [[ "$host" == *'['* || "$host" == *']'* || "$host" == .* || "$host" == *. || "$host" == *..* ]]; then
    echo "$key contains an invalid hostname" >&2
    exit 1
  fi

  if is_valid_ipv4 "$host"; then
    if is_ipv4_private_or_reserved "$host"; then
      echo "$key must target a public DNS hostname or IP address" >&2
      exit 1
    fi
  elif is_ipv4_literal_candidate "$host" || ! is_valid_dns_hostname "$host" || is_local_hostname "$host"; then
    echo "$key must target a public DNS hostname or IP address" >&2
    exit 1
  fi
  printf '%s\n' "$host"
}

require_marker() {
  local marker="$1"
  if ! grep -Fq "$marker" "$TEMPLATE_FILE"; then
    echo "Caddy template is missing required marker: $marker" >&2
    exit 1
  fi
}

api_host="$(origin_host SERVER_URL)"
case "$DEPLOY_TARGET" in
  backend)
    require_marker "__API_HOST__"
    sed "s/__API_HOST__/${api_host}/g" "$TEMPLATE_FILE" > "$OUTPUT_FILE"
    ;;
  frontend|all)
    marketing_host="$(origin_host MARKETING_URL)"
    app_host="$(origin_host APP_URL)"
    viewer_host="$(origin_host VITE_PUBLIC_VIEWER_URL)"
    require_marker "__MARKETING_HOST__"
    require_marker "__APP_HOST__"
    require_marker "__API_HOST__"
    require_marker "__VIEWER_HOST__"
    sed \
      -e "s/__MARKETING_HOST__/${marketing_host}/g" \
      -e "s/__APP_HOST__/${app_host}/g" \
      -e "s/__API_HOST__/${api_host}/g" \
      -e "s/__VIEWER_HOST__/${viewer_host}/g" \
      "$TEMPLATE_FILE" > "$OUTPUT_FILE"
    ;;
  *)
    echo "Unsupported deployment target: $DEPLOY_TARGET" >&2
    exit 64
    ;;
esac

if grep -Eq '__[A-Z0-9_]+__' "$OUTPUT_FILE"; then
  echo "Caddy template rendering left unresolved placeholders" >&2
  exit 1
fi
