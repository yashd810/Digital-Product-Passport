#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dpp}"
ENV_FILE="${DPP_ENV_FILE:-/etc/dpp/dpp.env}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"
LOCK_FILE=""

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

uppercase_ascii() {
  printf '%s' "$1" | LC_ALL=C tr '[:lower:]' '[:upper:]'
}

prepare_deployment_lock() {
  local state_dir
  local expected_owner
  local state_mode
  local lock_mode

  expected_owner="$(id -u)"
  if [ "$expected_owner" -eq 0 ]; then
    state_dir="/var/lock/dpp"
    if [ -L "$state_dir" ]; then
      echo "Refusing symlinked deployment state directory: $state_dir"
      exit 1
    fi
    install -d -o root -g root -m 0700 "$state_dir"
  else
    state_dir="${XDG_RUNTIME_DIR:-${HOME:-$APP_DIR}/.cache}/dpp"
    if [ -L "$state_dir" ]; then
      echo "Refusing symlinked deployment state directory: $state_dir"
      exit 1
    fi
    install -d -m 0700 "$state_dir"
  fi

  if [ ! -d "$state_dir" ] || [ -L "$state_dir" ]; then
    echo "Deployment state directory is not a safe directory: $state_dir"
    exit 1
  fi
  if [ "$(file_owner "$state_dir")" != "$expected_owner" ]; then
    echo "Deployment state directory must be owned by the deploying user: $state_dir"
    exit 1
  fi
  state_mode="$(file_mode "$state_dir")"
  if (( (8#$state_mode & 8#077) != 0 )); then
    echo "Deployment state directory must not be accessible to group or others: $state_dir"
    exit 1
  fi

  LOCK_FILE="$state_dir/deploy.lock"
  if [ -L "$LOCK_FILE" ] || { [ -e "$LOCK_FILE" ] && [ ! -f "$LOCK_FILE" ]; }; then
    echo "Deployment lock must be a regular non-symlinked file: $LOCK_FILE"
    exit 1
  fi

  umask 077
  : >>"$LOCK_FILE"
  if [ "$(file_owner "$LOCK_FILE")" != "$expected_owner" ]; then
    echo "Deployment lock must be owned by the deploying user: $LOCK_FILE"
    exit 1
  fi
  lock_mode="$(file_mode "$LOCK_FILE")"
  if (( (8#$lock_mode & 8#077) != 0 )); then
    echo "Deployment lock must not be accessible to group or others: $LOCK_FILE"
    exit 1
  fi

  exec 9>>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "Another DPP deployment is already running. Lock: $LOCK_FILE"
    exit 1
  fi
}

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

require_env_var() {
  local key="$1"
  local value
  value="$(read_env_var "$key")"
  if [ -z "$value" ]; then
    echo "Missing required production env var: $key"
    exit 1
  fi
}

require_secret_env_var() {
  local key="$1"
  local value
  value="$(read_env_var "$key")"
  if [ "${#value}" -lt 32 ] || [[ "$value" == REPLACE_* ]]; then
    echo "Production secret $key must contain at least 32 characters"
    exit 1
  fi
}

require_non_placeholder_env_var() {
  local key="$1"
  local value
  value="$(read_env_var "$key")"
  if [ -z "$value" ]; then
    echo "Missing required production env var: $key"
    exit 1
  fi
  case "$(uppercase_ascii "$value")" in
    *REPLACE*|*CHANGE*|*YOUR_*)
      echo "Production env var $key must not use a placeholder"
      exit 1
      ;;
  esac
}

require_boolean_env_var() {
  local key="$1"
  local value
  value="$(read_env_var "$key")"
  case "$value" in
    true|false)
      return 0
      ;;
    *)
      echo "Production env var $key must be explicitly set to true or false"
      exit 1
      ;;
  esac
}

require_distinct_secret_env_vars() {
  local first="$1"
  local second="$2"
  local first_value
  local second_value
  first_value="$(read_env_var "$first")"
  second_value="$(read_env_var "$second")"
  if [ "$first_value" = "$second_value" ]; then
    echo "Production secrets $first and $second must use distinct values"
    exit 1
  fi
}

require_distinct_env_vars() {
  local first="$1"
  local second="$2"
  local first_value
  local second_value
  first_value="$(read_env_var "$first")"
  second_value="$(read_env_var "$second")"
  if [ "$first_value" = "$second_value" ]; then
    echo "Production configuration $first and $second must use distinct values"
    exit 1
  fi
}

require_https_url_env() {
  local key="$1"
  local value
  value="$(read_env_var "$key")"
  if [ -z "$value" ]; then
    echo "Missing required production URL env var: $key"
    exit 1
  fi
  case "$value" in
    https://localhost*|https://127.*|https://0.0.0.0*|http://*)
      echo "Production URL env var $key must be a public https:// origin"
      exit 1
      ;;
    https://*)
      ;;
    *)
      echo "Production URL env var $key must start with https://"
      exit 1
      ;;
  esac
}

require_matching_https_origin_env() {
  local first_key="$1"
  local second_key="$2"
  local first_value
  local second_value
  first_value="$(read_env_var "$first_key")"
  second_value="$(read_env_var "$second_key")"
  first_value="${first_value%/}"
  second_value="${second_value%/}"
  if [ "$first_value" != "$second_value" ]; then
    echo "Production URL env vars $first_key and $second_key must be the same origin"
    exit 1
  fi
}

if [ ! -d "$APP_DIR" ]; then
  echo "Missing app directory: $APP_DIR"
  exit 1
fi

if [ -L "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "Missing production env file: $ENV_FILE"
  exit 1
fi

ENV_MODE="$(file_mode "$ENV_FILE")"
if [ "$ENV_MODE" != "600" ]; then
  echo "Production env file must have mode 600: $ENV_FILE"
  exit 1
fi
if [ "$(id -u)" -eq 0 ] && [ "$(file_owner "$ENV_FILE")" != "0" ]; then
  echo "Production env file must be owned by root when deploying as root: $ENV_FILE"
  exit 1
fi

if ! command -v flock >/dev/null 2>&1; then
  echo "flock is required to prevent concurrent deployments."
  exit 1
fi

prepare_deployment_lock

if [ -z "${DPP_DEPLOY_TARGET:-}" ]; then
  DEPLOY_TARGET="$(read_env_var DPP_DEPLOY_TARGET)"
else
  DEPLOY_TARGET="$DPP_DEPLOY_TARGET"
fi

if [ -z "$DEPLOY_TARGET" ]; then
  echo "DPP_DEPLOY_TARGET must be set to one of: all, frontend, backend"
  echo "Set it in the shell or in $ENV_FILE. This prevents accidentally deploying the wrong stack on a split OCI host."
  exit 1
fi

cd "$APP_DIR"
case "$DEPLOY_TARGET" in
  all)
    COMPOSE_FILE="docker/docker-compose.prod.yml"
    DEFAULT_REMOVE_ORPHANS="false"
    ;;
  frontend)
    COMPOSE_FILE="docker/docker-compose.prod.frontend.yml"
    DEFAULT_REMOVE_ORPHANS="true"
    ;;
  backend)
    COMPOSE_FILE="docker/docker-compose.prod.backend.yml"
    DEFAULT_REMOVE_ORPHANS="true"
    ;;
  *)
    echo "Unsupported DPP_DEPLOY_TARGET: $DEPLOY_TARGET"
    echo "Use one of: all, frontend, backend"
    exit 1
    ;;
esac

if [ -z "$COMPOSE_PROJECT_NAME" ]; then
  COMPOSE_PROJECT_NAME="$(read_env_var COMPOSE_PROJECT_NAME)"
fi

if [ -z "$COMPOSE_PROJECT_NAME" ]; then
  case "$DEPLOY_TARGET" in
    backend)
      COMPOSE_PROJECT_NAME="$(
        docker ps \
          --filter "label=com.docker.compose.service=backend-api" \
          --format '{{.Label "com.docker.compose.project"}}' \
          | head -n1
      )"
      if [ -z "$COMPOSE_PROJECT_NAME" ]; then
        COMPOSE_PROJECT_NAME="$(
          docker ps \
            --filter "label=com.docker.compose.service=postgres" \
            --format '{{.Label "com.docker.compose.project"}}' \
            | head -n1
        )"
      fi
      ;;
    frontend)
      COMPOSE_PROJECT_NAME="$(
        docker ps \
          --filter "label=com.docker.compose.service=frontend-app" \
          --format '{{.Label "com.docker.compose.project"}}' \
          | head -n1
      )"
      ;;
    all)
      COMPOSE_PROJECT_NAME="$(
        docker ps \
          --filter "label=com.docker.compose.service=backend-api" \
          --format '{{.Label "com.docker.compose.project"}}' \
          | head -n1
      )"
      ;;
  esac
fi

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-dpp}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not on PATH"
  exit 1
fi

AVAILABLE_KB="$(awk '/MemAvailable/ { print $2; exit }' /proc/meminfo 2>/dev/null || echo 0)"
AVAILABLE_DISK_KB="$(df -Pk "$APP_DIR" | awk 'NR==2 { print $4 }')"
SWAP_TOTAL_KB="$(awk '/SwapTotal/ { print $2; exit }' /proc/meminfo 2>/dev/null || echo 0)"
if [ "${AVAILABLE_KB:-0}" -lt 524288 ]; then
  echo "Warning: less than 512MiB memory appears available; Docker builds may be slow or unstable."
fi
if [ "${SWAP_TOTAL_KB:-0}" -eq 0 ] && [ "${AVAILABLE_KB:-0}" -lt 1048576 ]; then
  echo "Warning: no swap is configured and less than 1GiB memory is available; parallel frontend builds may cause timeouts."
fi
if [ "${AVAILABLE_DISK_KB:-0}" -lt 2097152 ]; then
  echo "Refusing deployment: less than 2GiB free disk available under $APP_DIR."
  df -h "$APP_DIR"
  exit 1
fi

case "$DEPLOY_TARGET" in
  backend|all)
    require_secret_env_var "JWT_SECRET"
    require_secret_env_var "PEPPER_V1"
    require_secret_env_var "OTP_HMAC_SECRET"
    require_secret_env_var "REPOSITORY_FILE_LINK_SECRET"
    require_env_var "SIGNING_PRIVATE_KEY"
    require_env_var "SIGNING_PUBLIC_KEY"
    require_env_var "DB_HOST"
    require_env_var "DB_USER"
    require_secret_env_var "DB_PASSWORD"
    require_env_var "DB_NAME"
    require_env_var "ALLOWED_ORIGINS"
    require_https_url_env "APP_URL"
    require_https_url_env "SERVER_URL"
    require_distinct_secret_env_vars "JWT_SECRET" "PEPPER_V1"
    require_distinct_secret_env_vars "JWT_SECRET" "OTP_HMAC_SECRET"
    require_distinct_secret_env_vars "JWT_SECRET" "REPOSITORY_FILE_LINK_SECRET"
    require_distinct_secret_env_vars "PEPPER_V1" "OTP_HMAC_SECRET"
    require_distinct_secret_env_vars "PEPPER_V1" "REPOSITORY_FILE_LINK_SECRET"
    require_distinct_secret_env_vars "OTP_HMAC_SECRET" "REPOSITORY_FILE_LINK_SECRET"

    require_env_var "STORAGE_PROVIDER"
    if [ "$(read_env_var STORAGE_PROVIDER)" != "s3" ]; then
      echo "STORAGE_PROVIDER must be s3 for a production backend deployment"
      exit 1
    fi
    require_https_url_env "STORAGE_S3_ENDPOINT"
    require_non_placeholder_env_var "STORAGE_S3_ENDPOINT"
    require_non_placeholder_env_var "STORAGE_S3_REGION"
    require_non_placeholder_env_var "STORAGE_S3_BUCKET"
    require_non_placeholder_env_var "STORAGE_S3_ACCESS_KEY_ID"
    require_non_placeholder_env_var "STORAGE_S3_SECRET_ACCESS_KEY"
    require_secret_env_var "STORAGE_S3_SECRET_ACCESS_KEY"

    require_boolean_env_var "DB_BACKUP_ENABLED"
    if [ "$(read_env_var DB_BACKUP_ENABLED)" = "true" ]; then
      require_https_url_env "DB_BACKUP_S3_ENDPOINT"
      require_non_placeholder_env_var "DB_BACKUP_S3_ENDPOINT"
      require_non_placeholder_env_var "DB_BACKUP_S3_REGION"
      require_non_placeholder_env_var "DB_BACKUP_S3_BUCKET"
      require_non_placeholder_env_var "DB_BACKUP_S3_ACCESS_KEY_ID"
      require_non_placeholder_env_var "DB_BACKUP_S3_SECRET_ACCESS_KEY"
      require_secret_env_var "DB_BACKUP_S3_SECRET_ACCESS_KEY"
      require_distinct_env_vars "DB_BACKUP_S3_BUCKET" "STORAGE_S3_BUCKET"
      require_distinct_env_vars "DB_BACKUP_S3_ACCESS_KEY_ID" "STORAGE_S3_ACCESS_KEY_ID"
      require_distinct_env_vars "DB_BACKUP_S3_SECRET_ACCESS_KEY" "STORAGE_S3_SECRET_ACCESS_KEY"
    fi
    ;;
esac

case "$DEPLOY_TARGET" in
  frontend|all)
    require_https_url_env "MARKETING_URL"
    require_https_url_env "APP_URL"
    require_https_url_env "SERVER_URL"
    require_https_url_env "VITE_API_URL"
    require_https_url_env "VITE_PUBLIC_VIEWER_URL"
    require_matching_https_origin_env "VITE_API_URL" "SERVER_URL"
    if [ "$DEPLOY_TARGET" = "frontend" ]; then
      require_https_url_env "BACKEND_API_UPSTREAM"
      require_matching_https_origin_env "BACKEND_API_UPSTREAM" "VITE_API_URL"
    fi
    ;;
esac

if [ "$DEPLOY_TARGET" = "frontend" ] || [ "$DEPLOY_TARGET" = "all" ]; then
  bash "$APP_DIR/infra/oracle/check-marketing-public-content.sh"
fi

REMOVE_ORPHANS="${DPP_REMOVE_ORPHANS:-$DEFAULT_REMOVE_ORPHANS}"
ORPHAN_ARGS=()
if [ "$REMOVE_ORPHANS" = "true" ]; then
  ORPHAN_ARGS=(--remove-orphans)
fi

UP_ARGS=(up --build -d "${ORPHAN_ARGS[@]}")
RECREATE_SERVICES=()

case "$DEPLOY_TARGET" in
  backend)
    RECREATE_SERVICES=(backend-api)
    ;;
  frontend)
    RECREATE_SERVICES=(frontend-app public-passport-viewer marketing-site)
    ;;
  all)
    RECREATE_SERVICES=(backend-api frontend-app public-passport-viewer marketing-site)
    ;;
esac

if [ "${#RECREATE_SERVICES[@]}" -gt 0 ]; then
  UP_ARGS+=(--force-recreate "${RECREATE_SERVICES[@]}")
fi

export COMPOSE_BAKE="${COMPOSE_BAKE:-false}"

wait_for_service_http() {
  local service_name="$1"
  case "$service_name" in
    frontend-app)
      wait_for_http "http://127.0.0.1:${FRONTEND_PORT:-3000}/" "Frontend HTTP" 30 2
      ;;
    public-passport-viewer)
      wait_for_http "http://127.0.0.1:${PUBLIC_VIEWER_PORT:-3004}/" "Viewer HTTP" 30 2
      ;;
    marketing-site)
      wait_for_http "http://127.0.0.1:${MARKETING_PORT:-8080}/" "Marketing HTTP" 30 2
      ;;
  esac
}

deploy_frontend_sequentially() {
  local services=(frontend-app public-passport-viewer marketing-site)
  local service
  for service in "${services[@]}"; do
    echo "Building service sequentially: $service"
    DPP_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build "$service"
    echo "Recreating service sequentially: $service"
    DPP_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps --force-recreate "$service"
    wait_for_container_health "$service" "$service container" 50 2
    wait_for_service_http "$service"
    sleep 2
  done
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-30}"
  local sleep_seconds="${4:-2}"
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    if curl -fsS --connect-timeout 3 --max-time 10 --output /dev/null "$url" 2>/dev/null; then
      echo "✅ $label ready"
      return 0
    fi
    sleep "$sleep_seconds"
  done
  echo "❌ $label did not become ready: $url"
  return 1
}

wait_for_container_health() {
  local service_name="$1"
  local label="$2"
  local attempts="${3:-30}"
  local sleep_seconds="${4:-2}"
  local container_id=""
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    container_id="$(
      docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps -q "$service_name" 2>/dev/null \
        | head -n1
    )"
    if [ -n "$container_id" ]; then
      local health_state
      health_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || echo "missing")"
      if [ "$health_state" = "healthy" ] || [ "$health_state" = "none" ]; then
        echo "✅ $label container ready"
        return 0
      fi
    fi
    sleep "$sleep_seconds"
  done
  echo "❌ $label container did not become healthy"
  return 1
}

caddy_template_for_target() {
  case "$DEPLOY_TARGET" in
    backend)
      echo "$APP_DIR/infra/oracle/Caddyfile.backend.template"
      ;;
    frontend)
      echo "$APP_DIR/infra/oracle/Caddyfile.frontend.template"
      ;;
    all)
      echo "$APP_DIR/infra/oracle/Caddyfile.template"
      ;;
  esac
}

validate_caddy_template() {
  local template_file
  local rendered_file
  template_file="$(caddy_template_for_target)"
  rendered_file="$(mktemp)"

  if [ ! -f "$template_file" ]; then
    echo "Missing Caddyfile template for deploy target: $template_file"
    rm -f "$rendered_file"
    exit 1
  fi

  if ! DPP_ENV_FILE="$ENV_FILE" "$APP_DIR/infra/oracle/render-caddyfile.sh" \
    "$DEPLOY_TARGET" "$template_file" "$rendered_file"; then
    rm -f "$rendered_file"
    exit 1
  fi
  rm -f "$rendered_file"
}

install_or_reload_caddy() {
  if [ "${DPP_SKIP_CADDY_RELOAD:-false}" = "true" ]; then
    echo "Skipping Caddy reload because DPP_SKIP_CADDY_RELOAD=true"
    return 0
  fi

  local template_file
  local destination_file
  local rendered_file
  template_file="$(caddy_template_for_target)"
  destination_file="${DPP_CADDYFILE:-/etc/caddy/Caddyfile}"
  rendered_file="$(mktemp)"

  if [ ! -f "$template_file" ]; then
    echo "Missing Caddyfile template for deploy target: $template_file"
    rm -f "$rendered_file"
    exit 1
  fi

  if ! DPP_ENV_FILE="$ENV_FILE" "$APP_DIR/infra/oracle/render-caddyfile.sh" \
    "$DEPLOY_TARGET" "$template_file" "$rendered_file"; then
    rm -f "$rendered_file"
    exit 1
  fi

  if ! command -v systemctl >/dev/null 2>&1 ||
    ! systemctl list-unit-files caddy.service --no-legend 2>/dev/null | grep -q '^caddy\.service'; then
    echo "Caddy service is not installed on this host; skipping edge reload."
    rm -f "$rendered_file"
    return 0
  fi

  if command -v caddy >/dev/null 2>&1; then
    if ! caddy validate --config "$rendered_file" --adapter caddyfile; then
      rm -f "$rendered_file"
      exit 1
    fi
  else
    echo "Caddy CLI is not on PATH; skipping config validation before reload."
  fi

  install -m 0644 "$rendered_file" "$destination_file"
  rm -f "$rendered_file"
  if systemctl is-active --quiet caddy; then
    systemctl reload caddy || systemctl restart caddy
  else
    systemctl restart caddy
  fi
  echo "Caddy edge config installed from $template_file at $destination_file"
}

append_live_edge_target() {
  local key="$1"
  local value
  value="$(read_env_var "$key")"
  if [ -n "$value" ]; then
    LIVE_EDGE_TARGETS+=("$value")
  fi
}

run_live_edge_check() {
  if [ "${DPP_SKIP_LIVE_EDGE_CHECK:-false}" = "true" ]; then
    echo "Skipping live edge check because DPP_SKIP_LIVE_EDGE_CHECK=true"
    return 0
  fi

  LIVE_EDGE_TARGETS=()
  case "$DEPLOY_TARGET" in
    backend)
      append_live_edge_target "SERVER_URL"
      ;;
    frontend)
      append_live_edge_target "MARKETING_URL"
      append_live_edge_target "APP_URL"
      append_live_edge_target "VITE_PUBLIC_VIEWER_URL"
      ;;
    all)
      append_live_edge_target "MARKETING_URL"
      append_live_edge_target "APP_URL"
      append_live_edge_target "VITE_PUBLIC_VIEWER_URL"
      append_live_edge_target "SERVER_URL"
      ;;
  esac

  if [ "${#LIVE_EDGE_TARGETS[@]}" -eq 0 ]; then
    echo "No public URLs configured for live edge check."
    return 0
  fi

  DPP_MARKETING_URL="$(read_env_var MARKETING_URL)" \
    "$APP_DIR/infra/oracle/check-live-edge.sh" "${LIVE_EDGE_TARGETS[@]}"
}

ensure_docker_volume() {
  local name="$1"
  local label="$2"

  if docker volume inspect "$name" >/dev/null 2>&1; then
    echo "Using existing $label volume: $name"
    return 0
  fi

  docker volume create "$name" >/dev/null
  echo "Created fresh $label volume: $name"
}

prepare_local_storage_volume() {
  local name="$1"
  local mountpoint
  mountpoint="$(docker volume inspect "$name" --format '{{.Mountpoint}}' 2>/dev/null || true)"
  if [ -z "$mountpoint" ] || [ ! -d "$mountpoint" ]; then
    echo "Unable to prepare local storage volume: $name"
    exit 1
  fi

  install -d -o 1000 -g 1000 -m 0755 \
    "$mountpoint/passport-files" \
    "$mountpoint/repository-files" \
    "$mountpoint/uploads" \
    "$mountpoint/uploads/symbols"
  echo "Prepared local storage volume directories for container user: $name"
}

EXPLICIT_POSTGRES_VOLUME_NAME="${POSTGRES_VOLUME_NAME:-}"
if [ -z "$EXPLICIT_POSTGRES_VOLUME_NAME" ]; then
  EXPLICIT_POSTGRES_VOLUME_NAME="$(read_env_var POSTGRES_VOLUME_NAME)"
fi

echo "Deploying target=$DEPLOY_TARGET compose=$COMPOSE_FILE project=$COMPOSE_PROJECT_NAME remove_orphans=$REMOVE_ORPHANS"
validate_caddy_template

if [ "$DEPLOY_TARGET" = "backend" ] || [ "$DEPLOY_TARGET" = "all" ]; then
  CURRENT_POSTGRES_VOLUMES="$(
    docker volume ls --format '{{.Name}}' 2>/dev/null \
      | grep -E '(^|[_-])(postgresData)$' \
      || true
  )"
  if [ -n "$CURRENT_POSTGRES_VOLUMES" ]; then
    echo "Detected postgres volumes:"
    echo "$CURRENT_POSTGRES_VOLUMES" | sed 's/^/  - /'
  fi
  POSTGRES_VOLUME_COUNT="$(printf '%s\n' "$CURRENT_POSTGRES_VOLUMES" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [ "${POSTGRES_VOLUME_COUNT:-0}" -gt 1 ] && [ -z "$EXPLICIT_POSTGRES_VOLUME_NAME" ]; then
    echo "Refusing deployment: multiple postgresData-style volumes were detected, but POSTGRES_VOLUME_NAME is not set."
    echo "Set POSTGRES_VOLUME_NAME in $ENV_FILE to the exact live volume you intend to use before deploying."
    echo "This guard prevents Docker Compose from attaching a fresh database volume by accident."
    exit 1
  fi

  LOCAL_STORAGE_VOLUME_NAME="${LOCAL_STORAGE_VOLUME_NAME:-$(read_env_var LOCAL_STORAGE_VOLUME_NAME)}"
  LOCAL_STORAGE_VOLUME_NAME="${LOCAL_STORAGE_VOLUME_NAME:-dppLocalStorageData}"
  POSTGRES_VOLUME_NAME="${POSTGRES_VOLUME_NAME:-$(read_env_var POSTGRES_VOLUME_NAME)}"
  POSTGRES_VOLUME_NAME="${POSTGRES_VOLUME_NAME:-dppPostgresData}"
  ensure_docker_volume "$LOCAL_STORAGE_VOLUME_NAME" "local storage"
  ensure_docker_volume "$POSTGRES_VOLUME_NAME" "PostgreSQL data"
  prepare_local_storage_volume "$LOCAL_STORAGE_VOLUME_NAME"
fi

DPP_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config --quiet
if [ "$DEPLOY_TARGET" = "frontend" ]; then
  deploy_frontend_sequentially
else
  DPP_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "${UP_ARGS[@]}"
fi
if [ "$DEPLOY_TARGET" = "backend" ] || [ "$DEPLOY_TARGET" = "all" ]; then
  APP_DIR="$APP_DIR" "$APP_DIR/infra/oracle/install-db-backup-jobs.sh"
  echo "Running storage probe health check..."
  wait_for_http "http://127.0.0.1:${BACKEND_PORT:-3001}/health" "Backend health" 40 2
  wait_for_http "http://127.0.0.1:${BACKEND_PORT:-3001}/health/storage" "Backend storage probe" 40 2
fi
if [ "$DEPLOY_TARGET" = "frontend" ] || [ "$DEPLOY_TARGET" = "all" ]; then
  wait_for_container_health "frontend-app" "Frontend app" 50 2
  wait_for_container_health "public-passport-viewer" "Public viewer" 50 2
  wait_for_container_health "marketing-site" "Marketing site" 50 2
  wait_for_service_http "frontend-app"
  wait_for_service_http "public-passport-viewer"
  wait_for_service_http "marketing-site"
fi
install_or_reload_caddy
DPP_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
run_live_edge_check
