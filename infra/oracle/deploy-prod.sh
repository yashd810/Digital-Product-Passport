#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dpp}"
ENV_FILE="${DPP_ENV_FILE:-/etc/dpp/dpp.env}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-dpp}"
LOCK_FILE="${DPP_DEPLOY_LOCK_FILE:-/tmp/dpp-deploy.lock}"

if [ ! -d "$APP_DIR" ]; then
  echo "Missing app directory: $APP_DIR"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing production env file: $ENV_FILE"
  exit 1
fi

if [ -z "${DPP_DEPLOY_TARGET:-}" ]; then
  DEPLOY_TARGET="$(
    awk -F= '
      /^[[:space:]]*DPP_DEPLOY_TARGET[[:space:]]*=/ {
        value=$2
        gsub(/^[[:space:]"'\'']+|[[:space:]"'\'']+$/, "", value)
        print value
        exit
      }
    ' "$ENV_FILE"
  )"
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

echo "Deploying target=$DEPLOY_TARGET compose=$COMPOSE_FILE project=$COMPOSE_PROJECT_NAME remove_orphans=$REMOVE_ORPHANS"

(
  flock -n 9 || {
    echo "Another DPP deployment is already running. Lock: $LOCK_FILE"
    exit 1
  }
  DPP_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config --quiet
  DPP_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up --build -d "${ORPHAN_ARGS[@]}"
  DPP_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
) 9>"$LOCK_FILE"
