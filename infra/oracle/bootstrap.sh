#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dpp}"
REPO_URL="${REPO_URL:-https://github.com/yashd810/Digital-Product-Passport.git}"
BRANCH="${BRANCH:-main}"
ENV_FILE="${DPP_ENV_FILE:-/etc/dpp/dpp.env}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but not installed."
  exit 1
fi

if [ ! -d "$APP_DIR/.git" ]; then
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing production env file: $ENV_FILE"
  echo "Store your production env outside the repo, e.g. /etc/dpp/dpp.env"
  exit 1
fi

cd "$APP_DIR"
DPP_ENV_FILE="$ENV_FILE" docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" up --build -d
DPP_ENV_FILE="$ENV_FILE" docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" ps
