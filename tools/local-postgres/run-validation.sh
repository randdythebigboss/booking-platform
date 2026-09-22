#!/usr/bin/env bash
# ===========================================================================
# Runs the whole database validation against a stock PostgreSQL instance,
# starting from an empty database:
#
#   bootstrap -> every migration in order -> seed -> both SQL suites
#
# CI uses the Supabase CLI, which is the faithful environment. This exists so
# the same SQL can be executed anywhere PostgreSQL runs, including a machine
# with no Docker. See tools/local-postgres/bootstrap.sql.
#
# Usage:
#   PGBIN=/path/to/pgsql/bin ./tools/local-postgres/run-validation.sh
# ===========================================================================
set -euo pipefail

PGBIN="${PGBIN:-}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-55432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-booking}"

PSQL="psql"
if [ -n "$PGBIN" ]; then PSQL="$PGBIN/psql"; fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

run() {
  local label="$1"; shift
  printf '\n----- %s -----\n' "$label"
  "$PSQL" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    -v ON_ERROR_STOP=1 --quiet "$@"
}

admin() {
  "$PSQL" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -tAc "$1"
}

echo "Recreating $PGDATABASE from nothing"
admin "drop database if exists $PGDATABASE with (force);" >/dev/null
admin "create database $PGDATABASE;" >/dev/null

run "bootstrap (Supabase-alike prerequisites)" -f "$REPO_ROOT/tools/local-postgres/bootstrap.sql"

for migration in "$REPO_ROOT"/supabase/migrations/*.sql; do
  run "migration $(basename "$migration")" -f "$migration"
done

run "seed" -f "$REPO_ROOT/supabase/seed.sql"
run "booking_guarantees.sql" -f "$REPO_ROOT/supabase/tests/booking_guarantees.sql"
run "tenant_isolation.sql" -f "$REPO_ROOT/supabase/tests/tenant_isolation.sql"
run "availability_api.sql" -f "$REPO_ROOT/supabase/tests/availability_api.sql"
run "public_booking.sql" -f "$REPO_ROOT/supabase/tests/public_booking.sql"
run "professional_operations.sql" -f "$REPO_ROOT/supabase/tests/professional_operations.sql"
run "appointment_lifecycle.sql" -f "$REPO_ROOT/supabase/tests/appointment_lifecycle.sql"
run "customer_identity.sql" -f "$REPO_ROOT/supabase/tests/customer_identity.sql"
run "function_grants.sql" -f "$REPO_ROOT/supabase/tests/function_grants.sql"

printf '\nAll database validation passed.\n'
