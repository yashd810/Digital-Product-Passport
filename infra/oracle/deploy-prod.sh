#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dpp}"
ENV_FILE="${DPP_ENV_FILE:-/etc/dpp/dpp.env}"
DEPLOY_TARGET="${DPP_DEPLOY_TARGET:-all}"

if [ ! -d "$APP_DIR" ]; then
  echo "Missing app directory: $APP_DIR"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing production env file: $ENV_FILE"
  exit 1
fi

cd "$APP_DIR"
case "$DEPLOY_TARGET" in
  all)
    COMPOSE_FILE="docker-compose.prod.yml"
    ;;
  frontend)
    COMPOSE_FILE="docker-compose.prod.frontend.yml"
    ;;
  backend)
    COMPOSE_FILE="docker-compose.prod.backend.yml"
    ;;
  *)
    echo "Unsupported DPP_DEPLOY_TARGET: $DEPLOY_TARGET"
    echo "Use one of: all, frontend, backend"
    exit 1
    ;;
esac

DPP_ENV_FILE="$ENV_FILE" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up --build -d
DPP_ENV_FILE="$ENV_FILE" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
