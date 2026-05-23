#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/docker-compose.yml"
DATA_ROOT="$ROOT_DIR/.docker-data"

mkdir -p \
  "$DATA_ROOT/postgres" \
  "$DATA_ROOT/local-storage/passport-files" \
  "$DATA_ROOT/local-storage/repository-files" \
  "$DATA_ROOT/local-storage/uploads"

docker compose -f "$COMPOSE_FILE" up -d --build
docker compose -f "$COMPOSE_FILE" ps
