#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dpp}"
ENV_FILE="${DPP_ENV_FILE:-/etc/dpp/dpp.env}"

if [ ! -d "$APP_DIR" ]; then
  echo "Missing app directory: $APP_DIR"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing production env file: $ENV_FILE"
  exit 1
fi

cd "$APP_DIR"
DPP_ENV_FILE="$ENV_FILE" docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" up --build -d
DPP_ENV_FILE="$ENV_FILE" docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" ps
