#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${DPP_APP_DIR:-${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}}"
MARKETING_DIR="$ROOT_DIR/apps/marketing-site"

if [ ! -d "$MARKETING_DIR" ]; then
  echo "Missing marketing-site directory: $MARKETING_DIR" >&2
  exit 1
fi

shopt -s nullglob
MARKETING_FILES=("$MARKETING_DIR"/*.html "$MARKETING_DIR/shared.js")
shopt -u nullglob

if [ "${#MARKETING_FILES[@]}" -eq 0 ]; then
  echo "No public marketing files found under: $MARKETING_DIR" >&2
  exit 1
fi

# These are publication-blocking placeholders in the currently shipped public
# pages. Keep this list deliberately narrow: this guard must not invent or
# validate business/legal facts, only prevent known placeholder content from
# being deployed.
PLACEHOLDERS=(
  "contact@example.com"
  "+xx xxxx xxxx"
  "[Insert date]"
  "[Insert legal company name]"
  "[Insert registered address]"
  "[Insert if different]"
  "EUR [insert amount]"
  "[Insert governing law, for example Sweden]"
  "[Insert court location, for example Sweden]"
)

FAILURES=()
for placeholder in "${PLACEHOLDERS[@]}"; do
  while IFS= read -r match; do
    file_path="${match%%:*}"
    remainder="${match#*:}"
    line_number="${remainder%%:*}"
    FAILURES+=("${file_path#"$ROOT_DIR"/}:$line_number")
  done < <(grep -n -H -F -- "$placeholder" "${MARKETING_FILES[@]}" || true)
done

if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo "Refusing production deployment: public marketing content still contains placeholder legal or contact data." >&2
  printf '  %s\n' "${FAILURES[@]}" | LC_ALL=C sort -u >&2
  echo "Set the real contact details and legal terms in apps/marketing-site before deploying the frontend edge." >&2
  exit 1
fi

echo "PASS: public marketing content has no known legal or contact placeholders"
