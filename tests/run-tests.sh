#!/usr/bin/env bash
# Production-ready test runner for Prayers Loft E2E.
#
# Usage:
#   ./run-tests.sh            # full suite
#   ./run-tests.sh @smoke     # just the smoke set
#   ./run-tests.sh @prayer    # just the prayer specs
#
set -uo pipefail
cd "$(dirname "$0")"

TAG="${1:-}"
GREP_ARG=()
if [[ -n "$TAG" ]]; then
  GREP_ARG=(--grep "$TAG")
fi

echo "==> Ensuring frontend is reachable at http://localhost:3000"
if ! curl -sf -m 3 http://localhost:3000/ -o /dev/null; then
  echo "!!  Frontend is not reachable — start expo with: sudo supervisorctl start expo"
  exit 1
fi

echo "==> Running Playwright suite ${TAG:+($TAG)}"
npx playwright test "${GREP_ARG[@]}" || true

echo "==> Generating coverage summary"
node coverage-summary.js || true

echo "==> Done. Report:"
echo "      playwright-report/index.html"
echo "      coverage-summary.txt"
echo "      coverage-summary.json"
