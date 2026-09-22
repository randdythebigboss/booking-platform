#!/usr/bin/env bash
# ===========================================================================
# Checks that a built export is the one you meant to build.
#
#   EXPECT_SUPABASE_URL=https://<project>.supabase.co ./tools/release/verify-build.sh [dist]
#
# ---------------------------------------------------------------------------
# Why this exists
# ---------------------------------------------------------------------------
#
# `EXPO_PUBLIC_*` values are compiled into the bundle, and Metro caches the
# result. Build for the end-to-end stack, then build a release without
# `--clear`, and the release quietly carries `http://127.0.0.1:4301` -- an
# application that loads perfectly, installs perfectly, and cannot reach
# anything. It happened here, which is why `npm run expo:export` now passes
# `--clear` and why this exists to check rather than assume.
#
# It also refuses a bundle that names more than one project. A build should
# belong to exactly one environment.
# ===========================================================================
set -euo pipefail

DIST="${1:-dist}"
: "${EXPECT_SUPABASE_URL:?Set EXPECT_SUPABASE_URL to the project this build should talk to}"

if [ ! -d "$DIST/_expo" ]; then
  echo "No export at $DIST. Run: npm run expo:export" >&2
  exit 2
fi

bundle="$(find "$DIST/_expo" -name '*.js' -print)"
[ -n "$bundle" ] || { echo "No JavaScript in $DIST/_expo" >&2; exit 2; }

found="$(grep -hoE 'https://[a-z0-9]+\.supabase\.(co|in)|http://(127\.0\.0\.1|localhost)(:[0-9]+)?' $bundle \
  | sort -u || true)"

echo "API origins compiled into this build:"
echo "$found" | sed 's/^/  /'

if ! echo "$found" | grep -qxF "$EXPECT_SUPABASE_URL"; then
  echo >&2
  echo "REFUSING: this build does not talk to $EXPECT_SUPABASE_URL." >&2
  echo "Rebuild with: npm run expo:export" >&2
  exit 1
fi

others="$(echo "$found" | grep -E '^https://' | grep -vxF "$EXPECT_SUPABASE_URL" || true)"
if [ -n "$others" ]; then
  echo >&2
  echo "REFUSING: this build also names another project:" >&2
  echo "$others" | sed 's/^/  /' >&2
  exit 1
fi

echo
echo "This build talks to $EXPECT_SUPABASE_URL and nothing else."
