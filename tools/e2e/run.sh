#!/usr/bin/env bash
# ===========================================================================
# Runs the end-to-end suite against a built application and a real database.
#
#   E2E_DB_URL=postgresql://...  \
#   E2E_SUPABASE_URL=http://127.0.0.1:54321 \
#   E2E_SUPABASE_ANON_KEY=... \
#   ./tools/e2e/run.sh
#
# What it does, in order:
#
#   1. resets the database to the deterministic fixtures
#   2. builds the web application pointed at that database
#   3. serves the build
#   4. runs Playwright against it
#
# The suite itself resets the database again before every test; step 1 is
# there so a failure in the build is not confused with a dirty database.
#
# ---------------------------------------------------------------------------
# What this deliberately is not
# ---------------------------------------------------------------------------
#
# It does not start the database. There are two reasonable stacks -- the
# Supabase CLI where Docker is available, and the PostgreSQL + PostgREST pair
# in tools/local-postgres where it is not -- and picking one here would make
# the other second-class. Bring up whichever you have, point E2E_DB_URL and
# E2E_SUPABASE_URL at it, and run this.
#
# It never reads a cloud credential, and CI runs it without one.
# ===========================================================================
set -euo pipefail

: "${E2E_DB_URL:?Set E2E_DB_URL to the test database}"
: "${E2E_SUPABASE_URL:?Set E2E_SUPABASE_URL to the API the application should talk to}"
: "${E2E_SUPABASE_ANON_KEY:?Set E2E_SUPABASE_ANON_KEY}"

PORT="${E2E_PORT:-4321}"
BASE_URL="http://127.0.0.1:${PORT}"
OUTPUT="${E2E_OUTPUT_DIR:-dist-e2e}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "==> Resetting the database"
E2E_DB_URL="$E2E_DB_URL" ./tools/e2e/reset.sh

if [ "${E2E_SKIP_BUILD:-}" != "yes" ]; then
  echo "==> Building the application against $E2E_SUPABASE_URL"
  rm -rf "$OUTPUT"
  EXPO_PUBLIC_SUPABASE_URL="$E2E_SUPABASE_URL" \
  EXPO_PUBLIC_SUPABASE_ANON_KEY="$E2E_SUPABASE_ANON_KEY" \
  EXPO_PUBLIC_SITE_URL="$BASE_URL" \
    npx expo export --platform web --output-dir "$OUTPUT"

  # The static-host fallback. Expo Router emits one HTML file per route, with
  # dynamic segments as literal `[slug]` directories that no plain file server
  # will match against `/p/demo-studio`. Serving the application shell for any
  # unmatched path lets the client router take over -- the same arrangement
  # every static host expects, and the one docs/DEPLOYMENT.md describes.
  cp "$OUTPUT/index.html" "$OUTPUT/404.html"
fi

echo "==> Serving $OUTPUT on $BASE_URL"
npx --yes serve "$OUTPUT" -l "$PORT" --no-clipboard >/tmp/e2e-serve.log 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT

# Waiting for the port rather than sleeping for a guess.
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "$BASE_URL/"; then break; fi
  sleep 1
done
curl -fsS -o /dev/null "$BASE_URL/" || { echo "the server never came up:"; cat /tmp/e2e-serve.log; exit 1; }

echo "==> Running Playwright"
E2E_BASE_URL="$BASE_URL" E2E_DB_URL="$E2E_DB_URL" npx playwright test "$@"
