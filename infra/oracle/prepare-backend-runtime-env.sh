#!/bin/bash -p
set -euo pipefail
umask 077
PATH="/usr/sbin:/usr/bin:/sbin:/bin"
export PATH

# Derive the least-privilege environment consumed by the long-running API.
# The source file remains root-owned because it is also used by the controlled
# deployment, PostgreSQL bootstrap, and host backup job. Do not point the API
# directly at that broad source file.
ENV_FILE="${DPP_ENV_FILE:-/etc/dpp/dpp.env}"
ENV_DIR="$(CDPATH= cd -- "$(dirname -- "$ENV_FILE")" && pwd -P)"
BACKEND_ENV_FILE="${DPP_BACKEND_ENV_FILE:-$ENV_DIR/dpp-backend.env}"
ENV_DIR_INPUT="$(dirname -- "$ENV_FILE")"
BACKEND_ENV_DIR_INPUT="$(dirname -- "$BACKEND_ENV_FILE")"
BACKEND_ENV_DIR="$(CDPATH= cd -- "$BACKEND_ENV_DIR_INPUT" && pwd -P)"

file_mode() {
  local file="$1"
  if stat -c '%a' "$file" >/dev/null 2>&1; then
    stat -c '%a' "$file"
  else
    stat -f '%Lp' "$file"
  fi
}

file_owner() {
  local file="$1"
  if stat -c '%u' "$file" >/dev/null 2>&1; then
    stat -c '%u' "$file"
  else
    stat -f '%u' "$file"
  fi
}

if [ -L "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "Missing regular source environment file: $ENV_FILE" >&2
  exit 1
fi
if [ -L "$ENV_DIR_INPUT" ] || [ -L "$ENV_DIR" ] || [ ! -d "$ENV_DIR" ]; then
  echo "Environment directory must be a regular directory: $ENV_DIR" >&2
  exit 1
fi
if [ "$(file_mode "$ENV_FILE")" != "600" ]; then
  echo "Source environment file must have mode 600: $ENV_FILE" >&2
  exit 1
fi
if [ "$(id -u)" -eq 0 ] && [ "$(file_owner "$ENV_FILE")" != "0" ]; then
  echo "Source environment file must be root-owned: $ENV_FILE" >&2
  exit 1
fi
if [ "$(id -u)" -eq 0 ]; then
  ENV_DIR_MODE="$(file_mode "$ENV_DIR")"
  if [ "$(file_owner "$ENV_DIR")" != "0" ] || (( (8#$ENV_DIR_MODE & 8#022) != 0 )); then
    echo "Environment directory must be root-owned and not writable by group or others: $ENV_DIR" >&2
    exit 1
  fi
fi
if [ -L "$BACKEND_ENV_DIR_INPUT" ] || [ "$BACKEND_ENV_DIR" != "$ENV_DIR" ] || [ "$(basename -- "$BACKEND_ENV_FILE")" != "dpp-backend.env" ]; then
  echo "Backend environment output must be $ENV_DIR/dpp-backend.env" >&2
  exit 1
fi
if [ -L "$BACKEND_ENV_FILE" ]; then
  echo "Refusing symlinked backend environment output: $BACKEND_ENV_FILE" >&2
  exit 1
fi
if [ -e "$BACKEND_ENV_FILE" ] && [ ! -f "$BACKEND_ENV_FILE" ]; then
  echo "Backend environment output must be a regular file: $BACKEND_ENV_FILE" >&2
  exit 1
fi
if [ -e "$BACKEND_ENV_FILE" ] && [ "$(id -u)" -eq 0 ]; then
  BACKEND_ENV_MODE="$(file_mode "$BACKEND_ENV_FILE")"
  if [ "$(file_owner "$BACKEND_ENV_FILE")" != "0" ] || [ "$BACKEND_ENV_MODE" != "600" ]; then
    echo "Existing backend environment output must be root-owned mode 600: $BACKEND_ENV_FILE" >&2
    exit 1
  fi
fi

# Keep this explicit allowlist in sync with backend runtime configuration. In
# particular, it intentionally excludes DB_ADMIN_*, POSTGRES_*, and every
# DB_BACKUP_* secret/config value. DB_BACKUP_ENABLED is a non-secret policy
# flag retained so the web process can refuse a deployment with DB DR disabled.
BACKEND_ENV_KEYS=(
  NODE_ENV PORT LOG_LEVEL SHUTDOWN_TIMEOUT_MS
  DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD DB_BACKUP_ENABLED
  JWT_SECRET PEPPER_V1 CURRENT_PEPPER_VERSION OTP_HMAC_SECRET PASSWORD_MIN_LENGTH
  PASSWORD_RESET_MIN_RESPONSE_MS REPOSITORY_FILE_LINK_SECRET REPOSITORY_FILE_ACCESS_TTL_SECONDS
  SIGNING_PRIVATE_KEY SIGNING_PUBLIC_KEY REQUIRE_CERTIFICATE_BACKED_SIGNING
  SIGNING_KEY_OWNER SIGNING_ECONOMIC_OPERATOR_ID SIGNING_ECONOMIC_OPERATOR_ID_SCHEME
  SIGNING_IDENTITY_PROOFING SIGNING_CERTIFICATE_PROFILE SIGNING_CERTIFICATE_ID
  SIGNING_ELECTRONIC_SEAL_TYPE SIGNING_CERTIFICATE_URL SIGNING_REVOCATION_CHECK_URL
  SIGNING_TRUSTED_LIST_URL SIGNING_TRUST_FRAMEWORK SIGNING_KEY_RETENTION_POLICY
  APP_URL SERVER_URL VITE_PUBLIC_VIEWER_URL ALLOWED_ORIGINS COOKIE_SECURE COOKIE_SAME_SITE
  TRUSTED_PROXY_IPS ASSET_SOURCE_ALLOWED_HOSTS ASSET_SOURCE_CREDENTIALS_JSON
  STORAGE_PROVIDER STORAGE_S3_REGION STORAGE_S3_BUCKET STORAGE_S3_ACCESS_KEY_ID
  STORAGE_S3_SECRET_ACCESS_KEY STORAGE_S3_ENDPOINT STORAGE_S3_FORCE_PATH_STYLE
  BACKUP_PROVIDER_ENABLED BACKUP_PROVIDER_REQUIRED BACKUP_PROVIDER_KEY BACKUP_PROVIDER_TYPE
  BACKUP_PROVIDER_DISPLAY_NAME BACKUP_PROVIDER_OBJECT_PREFIX BACKUP_PROVIDER_PUBLIC_BASE_URL
  BACKUP_PROVIDER_ENDPOINT BACKUP_PROVIDER_REGION BACKUP_PROVIDER_BUCKET
  BACKUP_PROVIDER_ACCESS_KEY_ID BACKUP_PROVIDER_SECRET_ACCESS_KEY BACKUP_PROVIDER_FORCE_PATH_STYLE
  BACKUP_PROVIDER_SUPPORTS_PUBLIC_HANDOVER BACKUP_POLICY_RPO_MINUTES BACKUP_POLICY_RTO_HOURS
  BACKUP_POLICY_VERIFICATION_FREQUENCY BACKUP_POLICY_VERIFICATION_METHOD
  BACKUP_POLICY_RESTORE_TEST_FREQUENCY BACKUP_POLICY_RESTORE_TEST_METHOD
  BACKUP_LAST_RESTORE_DRILL_AT BACKUP_RESTORE_DRILL_EVIDENCE_URI
  BACKUP_ARCHIVAL_STORAGE_MODE BACKUP_ARCHIVAL_RETENTION_DAYS BACKUP_ARCHIVAL_IMMUTABILITY_EVIDENCE_URI
  EMAIL_HOST EMAIL_PORT EMAIL_SECURE EMAIL_USER EMAIL_PASS EMAIL_FROM ADMIN_EMAIL
  OAUTH_PROVIDERS_JSON OAUTH_ALLOW_INSECURE_HTTP OAUTH_FETCH_TIMEOUT_MS
  rateLimitCleanupIntervalMs rateLimitDbFailureThreshold rateLimitDbFailureCooldownMs
  rateLimitAuthIpMax rateLimitAuthMax rateLimitAuthWindowMs rateLimitOtpIpMax rateLimitOtpMax
  rateLimitOtpWindowMs rateLimitPasswordResetIpMax rateLimitPasswordResetMax rateLimitPasswordResetWindowMs
  rateLimitPublicReadMax rateLimitPublicReadWindowMs rateLimitPublicHeavyMax rateLimitPublicHeavyWindowMs
  rateLimitPublicUnlockMax rateLimitPublicUnlockWindowMs rateLimitPublicScanMax rateLimitPublicScanWindowMs
  rateLimitIntegrationWriteMax rateLimitIntegrationWriteWindowMs rateLimitAssetWriteMax rateLimitAssetWriteWindowMs
  rateLimitAssetSourceFetchMax rateLimitAssetSourceFetchWindowMs rateLimitSensitiveActionIpMax
  rateLimitSensitiveActionMax rateLimitSensitiveActionWindowMs rateLimitContactIpMax rateLimitContactIpWindowMs
  rateLimitContactEmailMax rateLimitContactEmailWindowMs rateLimitContactRecipientMax rateLimitContactRecipientWindowMs
)

read_env_line() {
  local key="$1"
  awk -v target="$key" '
    $0 ~ "^[[:space:]]*" target "[[:space:]]*=" {
      line = $0
      sub(/\r$/, "", line)
      print line
      found = 1
      exit
    }
    END { if (!found) exit 1 }
  ' "$ENV_FILE"
}

TEMP_ENV_FILE="$(mktemp "$ENV_DIR/.dpp-backend.env.XXXXXX")"
cleanup() {
  rm -f -- "$TEMP_ENV_FILE"
}
trap cleanup EXIT

for key in "${BACKEND_ENV_KEYS[@]}"; do
  if line="$(read_env_line "$key")"; then
    printf '%s\n' "$line" >> "$TEMP_ENV_FILE"
  fi
done

if [ ! -s "$TEMP_ENV_FILE" ]; then
  echo "Refusing to create an empty backend runtime environment" >&2
  exit 1
fi
chmod 600 "$TEMP_ENV_FILE"
if [ "$(id -u)" -eq 0 ]; then
  chown root:root "$TEMP_ENV_FILE"
fi
mv -f -- "$TEMP_ENV_FILE" "$BACKEND_ENV_FILE"
trap - EXIT
echo "Prepared least-privilege backend environment: $BACKEND_ENV_FILE"
