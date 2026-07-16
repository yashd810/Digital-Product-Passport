#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/docker-compose.yml"
PROJECT_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"
ENV_DIR="${DPP_ENV_DIR:-$PROJECT_ROOT/env}"
ENV_FILE="${DPP_ENV_FILE:-$ENV_DIR/local-compose.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing local environment file: $ENV_FILE" >&2
  echo "Create the private external environment directory and local-compose.env first." >&2
  exit 1
fi

if [ -L "$ENV_FILE" ]; then
  echo "Refusing a symlinked local environment file: $ENV_FILE" >&2
  exit 1
fi

if stat -c '%a' "$ENV_FILE" >/dev/null 2>&1; then
  ENV_MODE="$(stat -c '%a' "$ENV_FILE")"
else
  ENV_MODE="$(stat -f '%Lp' "$ENV_FILE")"
fi

if [ "$ENV_MODE" != "600" ]; then
  echo "Local environment file must have mode 600: $ENV_FILE" >&2
  exit 1
fi

DPP_ENV_FILE="$ENV_FILE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
# Do not force-recreate PostgreSQL during an ordinary local restart. The named
# volume is durable either way, but retaining the existing container removes a
# needless initialization path and makes the persistence boundary explicit.
DPP_ENV_FILE="$ENV_FILE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build --remove-orphans --wait --wait-timeout "${LOCAL_STACK_WAIT_TIMEOUT:-180}"
DPP_ENV_FILE="$ENV_FILE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
