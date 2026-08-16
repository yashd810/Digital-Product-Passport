#!/usr/bin/env bash
# Gitleaks can return success after an internal Git traversal error and report
# zero commits scanned. Capture its complete output, preserve genuine finding
# exit codes, and reject an incomplete history scan that otherwise looks green.

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <gitleaks command...>" >&2
  exit 64
fi

set +e
scanner_output="$("$@" 2>&1)"
scanner_status=$?
set -e

printf '%s\n' "$scanner_output"

# Preserve Gitleaks' own finding/error status exactly. The additional checks
# below close only the false-success case.
if [ "$scanner_status" -ne 0 ]; then
  exit "$scanner_status"
fi

if printf '%s\n' "$scanner_output" | grep -Eq '(^|[[:space:]])(ERR|FTL)([[:space:]]|$)|fatal:'; then
  echo "Secret scan failed closed because Gitleaks or Git reported an internal error." >&2
  exit 2
fi

if ! printf '%s\n' "$scanner_output" | grep -Eq '(^|[^0-9])[1-9][0-9]* commits scanned([^0-9]|$)'; then
  echo "Secret scan failed closed because no positive committed-history count was reported." >&2
  exit 2
fi
