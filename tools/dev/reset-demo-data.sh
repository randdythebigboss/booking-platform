#!/usr/bin/env bash
# ===========================================================================
# Returns a DEVELOPMENT database to the known Spanish demo data.
#
#   PSQL=/path/to/psql RESET_DB_URL=postgresql://... ./tools/dev/reset-demo-data.sh
#
# What it does: removes everything the SQL suites and a day of clicking around
# leave behind -- fixture businesses, fixture users, appointments, payments,
# notifications -- and loads `supabase/seed.sql` again.
#
# ---------------------------------------------------------------------------
# Why it asks twice before doing anything
# ---------------------------------------------------------------------------
#
# This deletes data, and the only thing standing between "the development
# project" and "whatever project that connection string happens to name" is
# the string itself. A tool like that, aimed at the wrong URL by a stale
# shell variable, is how somebody loses a day -- or worse.
#
# So there are two gates, and neither is a flag on this script:
#
#   1. The database must say it is development. `platform_settings.environment`
#      is a column somebody sets deliberately; a beta or production deployment
#      says so and this refuses to touch it.
#
#   2. `ALLOW_DEV_RESET=yes` must be in the environment. Typing it is the
#      moment to read the URL again.
#
# It never runs migrations and never drops the schema. Structure comes from
# the migrations; this is only about data.
# ===========================================================================
set -euo pipefail

PSQL="${PSQL:-psql}"
URL="${RESET_DB_URL:-}"

if [ -z "$URL" ]; then
  echo "Set RESET_DB_URL to the development database." >&2
  exit 2
fi

if [ "${ALLOW_DEV_RESET:-}" != "yes" ]; then
  echo "Refusing: set ALLOW_DEV_RESET=yes once you have read the URL you are aiming at." >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

environment="$("$PSQL" "$URL" -tAc \
  "select coalesce((select environment from public.platform_settings), 'unknown')")"

if [ "$environment" != "development" ]; then
  echo "Refusing: this database says it is '$environment', not 'development'." >&2
  echo "If that is wrong, fix platform_settings.environment deliberately." >&2
  exit 3
fi

echo "Resetting demo data in a database that says it is: $environment"

"$PSQL" "$URL" -v ON_ERROR_STOP=1 --quiet <<'SQL'
begin;

-- Everything that references a business goes with it, so businesses first.
-- The seed's own ids are recreated below; anything else was made by a suite,
-- by a browser session, or by somebody testing.
delete from public.businesses;

-- Fixture and test accounts. A real development login -- somebody's own
-- signed-up account -- is left alone, because losing it means signing up
-- again for no reason.
delete from auth.users
 where email like '%@bookingplatform.test'
    or email like '%@example.test';

-- Anything orphaned by the above.
delete from public.notifications where business_id not in (select id from public.businesses);
delete from public.payments where business_id not in (select id from public.businesses);

commit;
SQL

"$PSQL" "$URL" -v ON_ERROR_STOP=1 --quiet -f "$REPO_ROOT/supabase/seed.sql"

"$PSQL" "$URL" -tAc "select
  (select count(*) from public.businesses) || ' businesses, ' ||
  (select count(*) from public.services) || ' services, ' ||
  (select count(*) from public.appointments) || ' appointments'"

echo "Demo data restored."
