#!/usr/bin/env bash
set -euo pipefail

mode="bootstrap"

usage() {
  cat <<'USAGE'
Usage: bash infra/oracle/generate-env-secrets.sh [--bootstrap|--rotate-application-secrets]

  --bootstrap (default)             Generate DB_PASSWORD plus all application secrets
                                    for a new database/environment.
  --rotate-application-secrets      Generate only application secrets and a new
                                    signing pair. DB_PASSWORD is intentionally
                                    omitted so an existing database role is not
                                    accidentally desynchronised.
USAGE
}

case "${1:---bootstrap}" in
  --bootstrap)
    mode="bootstrap"
    ;;
  --rotate-application-secrets)
    mode="rotate-application-secrets"
    ;;
  --help|-h)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [ "$#" -gt 1 ]; then
  usage >&2
  exit 2
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate deployment secrets." >&2
  exit 1
fi

random_256_bit_hex() {
  openssl rand -hex 32
}

escape_dotenv_pem() {
  awk '{ printf "%s\\n", $0 }' | sed 's/\\n$//'
}

private_key="$(openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256)"
public_key="$(printf '%s\n' "$private_key" | openssl pkey -pubout)"

if [ "$mode" = "bootstrap" ]; then
  printf '%s\n' '# Paste these distinct values into the mode-600 production env file.'
  printf '%s=%s\n' 'DB_PASSWORD' "$(random_256_bit_hex)"
else
  printf '%s\n' '# Application-secret rotation output. DB_PASSWORD is intentionally omitted.'
  printf '%s\n' '# Rotating PEPPER_V1 invalidates existing password verification; reset accounts or clear fresh data first.'
fi

printf '%s=%s\n' 'JWT_SECRET' "$(random_256_bit_hex)"
printf '%s=%s\n' 'PEPPER_V1' "$(random_256_bit_hex)"
printf '%s=%s\n' 'OTP_HMAC_SECRET' "$(random_256_bit_hex)"
printf '%s=%s\n' 'REPOSITORY_FILE_LINK_SECRET' "$(random_256_bit_hex)"
printf '%s=%s\n' 'SIGNING_PRIVATE_KEY' "$(printf '%s\n' "$private_key" | escape_dotenv_pem)"
printf '%s=%s\n' 'SIGNING_PUBLIC_KEY' "$(printf '%s\n' "$public_key" | escape_dotenv_pem)"
