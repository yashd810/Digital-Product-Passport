#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dpp}"
REPO_URL="${REPO_URL:-https://github.com/yashd810/Digital-Product-Passport.git}"
BRANCH="${BRANCH:-main}"
ENV_FILE="${DPP_ENV_FILE:-/etc/dpp/dpp.env}"
DEPLOY_TARGET="${DPP_DEPLOY_TARGET:-}"
# bootstrap.sh is only for an intentionally new host. The flag is passed on the
# command line, never stored in the production environment file, so routine
# restarts cannot create a replacement database volume.
INITIALIZE_POSTGRES_VOLUME="${DPP_INITIALIZE_POSTGRES_VOLUME:-false}"

if [ -z "$DEPLOY_TARGET" ]; then
  echo "DPP_DEPLOY_TARGET is required. Use frontend, backend, or explicitly all for a single-host deployment."
  exit 1
fi

case "$DEPLOY_TARGET" in
  frontend|backend|all)
    ;;
  *)
    echo "Unsupported DPP_DEPLOY_TARGET: $DEPLOY_TARGET"
    echo "Use frontend, backend, or explicitly all for a single-host deployment."
    exit 1
    ;;
esac

case "$INITIALIZE_POSTGRES_VOLUME" in
  true|false)
    ;;
  *)
    echo "DPP_INITIALIZE_POSTGRES_VOLUME must be true or false when set."
    exit 1
    ;;
esac

if [ -L "$APP_DIR" ]; then
  echo "Refusing a symlinked application directory: $APP_DIR"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but not installed."
  exit 1
fi

if [ ! -d "$APP_DIR/.git" ]; then
  if [ -e "$APP_DIR" ] && [ -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    echo "Refusing to replace a non-empty directory without a Git checkout: $APP_DIR"
    echo "Move or remove it deliberately, then run bootstrap again."
    exit 1
  fi
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
DPP_ENV_FILE="$ENV_FILE" DPP_DEPLOY_TARGET="$DEPLOY_TARGET" \
  DPP_INITIALIZE_POSTGRES_VOLUME="$INITIALIZE_POSTGRES_VOLUME" \
  ./infra/oracle/deploy-prod.sh
