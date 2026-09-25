#!/usr/bin/env bash
# ===========================================================================
# Looks for a secret in output that is about to be served publicly.
#
#   ./tools/release/scan-bundle.sh dist
#
# ---------------------------------------------------------------------------
# What it looks for, and why not the obvious thing
# ---------------------------------------------------------------------------
#
# The obvious pattern -- grep for `sb_secret_` -- fails immediately, and did:
# supabase-js contains `startsWith("sb_secret_")` because classifying key
# formats is part of its job. Matching the bare prefix flags the library that
# protects you from the mistake.
#
# So each pattern here matches a *value*, not a word:
#
#   sb_secret_<something long>     a real secret key, not a prefix check
#   JvbGUiOiJzZXJ2aWNl (x3)        `"role":"service_role"`, base64url-encoded:
#                                  what a service-role JWT actually carries, and
#                                  something no library ever contains. Three
#                                  spellings because base64 encodes in groups of
#                                  three bytes, so the same text encodes
#                                  differently depending on what precedes it --
#                                  one spelling caught nothing.
#   SUPABASE_SERVICE_ROLE...=      a service-role key assigned to a name
#   -----BEGIN ... PRIVATE KEY     a private key, in any of its spellings
#   postgres[ql]://user:pass@      a database URL with a password in it
#
# A publishable key is deliberately not here. It is compiled into the bundle
# on purpose, it is public by design, and Row Level Security is what makes
# that safe. See docs/SECURITY.md.
# ===========================================================================
set -euo pipefail

DIST="${1:-dist}"

if [ ! -d "$DIST" ]; then
  echo "No such directory: $DIST" >&2
  exit 2
fi

PATTERNS=(
  'sb_secret_[A-Za-z0-9_-]{8,}'
  'JvbGUiOiJzZXJ2aWNl|b2xlIjoic2VydmljZV|m9sZSI6InNlcnZpY2V'
  'SUPABASE_SERVICE_ROLE[A-Z_]*["'"'"']?\s*[:=]'
  '-----BEGIN [A-Z ]*PRIVATE KEY'
  'postgres(ql)?://[^:/@[:space:]]+:[^@[:space:]]+@'
)

found=0

for pattern in "${PATTERNS[@]}"; do
  if matches="$(grep -rIlE "$pattern" "$DIST" 2>/dev/null)"; then
    echo "MATCH: /$pattern/" >&2
    echo "$matches" | sed 's/^/  /' >&2
    found=1
  fi
done

if [ "$found" -ne 0 ]; then
  echo >&2
  echo "Refusing: $DIST contains something shaped like a secret." >&2
  exit 1
fi

echo "No secret-shaped values in $DIST."
