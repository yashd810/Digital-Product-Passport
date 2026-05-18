#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dpp}"
ENV_FILE="${DPP_ENV_FILE:-/etc/dpp/dpp.env}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"
LOCK_FILE="${DPP_DEPLOY_LOCK_FILE:-/tmp/dpp-deploy.lock}"

read_env_var() {
  local key="$1"
  awk -F= -v target="$key" '
    $1 ~ "^[[:space:]]*" target "[[:space:]]*$" {
      value=$2
      gsub(/^[[:space:]"'\''"]+|[[:space:]"'\''"]+$/, "", value)
      print value
      exit
    }
  ' "$ENV_FILE"
}

if [ ! -d "$APP_DIR" ]; then
  echo "Missing app directory: $APP_DIR"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing production env file: $ENV_FILE"
  exit 1
fi

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
if [ "${AVAILABLE_KB:-0}" -lt 524288 ]; then
  echo "Warning: less than 512MiB memory appears available; Docker builds may be slow or unstable."
fi
if [ "${AVAILABLE_DISK_KB:-0}" -lt 2097152 ]; then
  echo "Refusing deployment: less than 2GiB free disk available under $APP_DIR."
  df -h "$APP_DIR"
  exit 1
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
    RECREATE_SERVICES=(frontend-app public-passport-viewer asset-management marketing-site)
    ;;
  all)
    RECREATE_SERVICES=(backend-api frontend-app public-passport-viewer asset-management marketing-site)
    ;;
esac

if [ "${#RECREATE_SERVICES[@]}" -gt 0 ]; then
  UP_ARGS+=(--force-recreate "${RECREATE_SERVICES[@]}")
fi

EXPLICIT_POSTGRES_VOLUME_NAME="${POSTGRES_VOLUME_NAME:-}"
if [ -z "$EXPLICIT_POSTGRES_VOLUME_NAME" ]; then
  EXPLICIT_POSTGRES_VOLUME_NAME="$(read_env_var POSTGRES_VOLUME_NAME)"
fi

echo "Deploying target=$DEPLOY_TARGET compose=$COMPOSE_FILE project=$COMPOSE_PROJECT_NAME remove_orphans=$REMOVE_ORPHANS"

if [ "$DEPLOY_TARGET" = "backend" ] || [ "$DEPLOY_TARGET" = "all" ]; then
  CURRENT_POSTGRES_VOLUMES="$(
    docker volume ls --format '{{.Name}}' 2>/dev/null \
      | grep -E '(^|_)(postgres_data)$' \
      || true
  )"
  if [ -n "$CURRENT_POSTGRES_VOLUMES" ]; then
    echo "Detected postgres volumes:"
    echo "$CURRENT_POSTGRES_VOLUMES" | sed 's/^/  - /'
  fi
  POSTGRES_VOLUME_COUNT="$(printf '%s\n' "$CURRENT_POSTGRES_VOLUMES" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [ "${POSTGRES_VOLUME_COUNT:-0}" -gt 1 ] && [ -z "$EXPLICIT_POSTGRES_VOLUME_NAME" ]; then
    echo "Refusing deployment: multiple postgres_data-style volumes were detected, but POSTGRES_VOLUME_NAME is not set."
    echo "Set POSTGRES_VOLUME_NAME in $ENV_FILE to the exact live volume you intend to use before deploying."
    echo "This guard prevents Docker Compose from attaching a fresh database volume by accident."
    exit 1
  fi
fi

(
  flock -n 9 || {
    echo "Another DPP deployment is already running. Lock: $LOCK_FILE"
    exit 1
  }
  DPP_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config --quiet
  DPP_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "${UP_ARGS[@]}"
  if [ "$DEPLOY_TARGET" = "backend" ] || [ "$DEPLOY_TARGET" = "all" ]; then
    APP_DIR="$APP_DIR" "$APP_DIR/infra/oracle/install-db-backup-jobs.sh"
    echo "Running storage probe health check..."
    if ! curl -fsS "http://127.0.0.1:${BACKEND_PORT:-3001}/health/storage" >/tmp/dpp-storage-health.json; then
      echo "Storage probe health check failed."
      cat /tmp/dpp-storage-health.json 2>/dev/null || true
      exit 1
    fi
    cat /tmp/dpp-storage-health.json
  fi
  DPP_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
) 9>"$LOCK_FILE"
