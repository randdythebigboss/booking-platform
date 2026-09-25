#!/usr/bin/env bash
# ===========================================================================
# Returns a DEVELOPMENT or TEST database to the deterministic E2E fixtures.
#
#   E2E_DB_URL=postgresql://... ./tools/e2e/reset.sh
#
# Loads: supabase/seed.sql (tenant A) + supabase/fixtures/e2e.sql (tenant B).
#
# ---------------------------------------------------------------------------
# Why it refuses more often than it runs
# ---------------------------------------------------------------------------
#
# This deletes every business, and the only thing between "the test database"
# and "whatever that connection string happens to name" is the string. The
# gate is the database's own opinion of itself: `platform_settings.environment`
# is a column somebody sets deliberately, and anything that is not
# `development` or `test` is refused. There is no flag to override that.
#
# Unlike tools/dev/reset-demo-data.sh this needs no second confirmation,
# because it is meant to run unattended before a test suite -- which is also
# why the environment gate is the only thing it trusts.
#
# It never runs migrations and never drops the schema. Structure comes from
# the migrations; this is only about data.
# ===========================================================================
set -euo pipefail

PSQL="${PSQL:-psql}"
URL="${E2E_DB_URL:-}"

if [ -z "$URL" ]; then
  echo "Set E2E_DB_URL to the test database." >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Where the database is, before what it says about itself. A shared project
# answers "development" truthfully, so the environment column alone cannot
# tell it from a disposable stack. See tools/dev/disposable-db.cjs.
node "$REPO_ROOT/tools/dev/disposable-db.cjs" "$URL" || exit 4

environment="$("$PSQL" "$URL" -tAc \
  "select coalesce((select environment from public.platform_settings), 'unknown')" \
  2>/dev/null || true)"
environment="${environment:-unreadable}"

case "$environment" in
  development|test) ;;
  *)
    echo "Refusing: this database says it is '$environment'." >&2
    echo "Only 'development' or 'test' may be reset." >&2
    echo "('unreadable' means platform_settings could not be read at all -- almost" >&2
    echo " certainly the wrong database, which is exactly what this gate is for.)" >&2
    exit 3
    ;;
esac

"$PSQL" "$URL" -v ON_ERROR_STOP=1 --quiet <<'SQL'
begin;

-- Everything that references a business goes with it.
delete from public.businesses;

-- Fixture accounts only. A real development login -- somebody's own signed-up
-- account -- is left alone, because losing it means signing up again for
-- nothing.
delete from auth.users
 where email like '%@bookingplatform.test'
    or email like '%@salon-brisa.test'
    or email like '%@example.test';

delete from public.notifications where business_id not in (select id from public.businesses);
delete from public.payments where business_id not in (select id from public.businesses);

commit;
SQL

"$PSQL" "$URL" -v ON_ERROR_STOP=1 --quiet -f "$REPO_ROOT/supabase/seed.sql"
"$PSQL" "$URL" -v ON_ERROR_STOP=1 --quiet -f "$REPO_ROOT/supabase/fixtures/e2e.sql"

# Last, and deliberately after the seed, which turns simulation on for a
# developer clicking around. The E2E baseline is the shipping default: off. A
# suite that needs it on turns it on itself and this puts it back.
"$PSQL" "$URL" -v ON_ERROR_STOP=1 --quiet -c \
  "update public.platform_settings set payment_simulation_enabled = false"

"$PSQL" "$URL" -tAc "select
  (select count(*) from public.businesses) || ' businesses, ' ||
  (select count(*) from public.services) || ' services, ' ||
  (select count(*) from public.appointments) || ' appointments, simulation ' ||
  (select case when payment_simulation_enabled then 'ON' else 'off' end from public.platform_settings)"
