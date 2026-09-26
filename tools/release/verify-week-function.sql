-- ===========================================================================
-- Is `get_week_availability` correctly installed?
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f tools/release/verify-week-function.sql
--
-- Read-only. Run it against any database the function has been applied to --
-- a local stack, or the shared cloud project through the SQL Editor -- and it
-- refuses rather than reports if anything about the installation is wrong.
--
-- It checks the five things that matter and that a "CREATE FUNCTION" notice
-- does not tell you:
--
--   1. the signature PostgREST will look for
--   2. the enum its `state` column depends on
--   3. SECURITY DEFINER with a pinned search_path
--   4. the grant classification -- anon and authenticated, and nothing wider
--   5. the returned shape, which is the public privacy contract
-- ===========================================================================

\set ON_ERROR_STOP on

do $$
declare
  v_oid oid;
  v_args text;
  v_secdef boolean;
  v_config text[];
  v_cols text;
  v_public boolean;
  v_anon boolean;
  v_authenticated boolean;
  v_enum text;
begin
  ---------------------------------------------------------------------------
  raise notice '1. the function exists with the signature PostgREST calls';

  select p.oid, pg_get_function_arguments(p.oid), p.prosecdef, p.proconfig
    into v_oid, v_args, v_secdef, v_config
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'get_week_availability';

  if v_oid is null then
    raise exception 'get_week_availability does not exist in this database';
  end if;

  if v_args is distinct from
     'p_professional_id uuid, p_service_id uuid, p_from date, p_days integer DEFAULT 7' then
    raise exception 'unexpected signature: %', v_args;
  end if;

  ---------------------------------------------------------------------------
  raise notice '2. the day_availability enum has exactly the five states';

  select string_agg(e.enumlabel, ',' order by e.enumsortorder) into v_enum
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  where t.typnamespace = 'public'::regnamespace and t.typname = 'day_availability';

  if v_enum is distinct from 'open,full,closed,past,beyond' then
    raise exception 'day_availability is %, not the reviewed set', coalesce(v_enum, '<missing>');
  end if;

  ---------------------------------------------------------------------------
  raise notice '3. SECURITY DEFINER, with search_path pinned';

  if not v_secdef then
    raise exception 'the function is not SECURITY DEFINER';
  end if;

  -- An unpinned search_path on a definer function is the classic escalation:
  -- the caller chooses which schema `public.appointments` means.
  if v_config is null or not (v_config @> array['search_path=public, pg_temp']) then
    raise exception 'search_path is not pinned: %', coalesce(v_config::text, '<null>');
  end if;

  ---------------------------------------------------------------------------
  raise notice '4. EXECUTE is granted to anon and authenticated, and nobody else';

  v_public := has_function_privilege('public', v_oid, 'EXECUTE');
  v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
  v_authenticated := has_function_privilege('authenticated', v_oid, 'EXECUTE');

  if v_public then
    raise exception 'PUBLIC still holds EXECUTE -- the revoke did not take';
  end if;
  if not v_anon or not v_authenticated then
    raise exception 'anon=% authenticated=% -- the public booking page needs both',
      v_anon, v_authenticated;
  end if;

  ---------------------------------------------------------------------------
  raise notice '5. the answer carries nothing about any booking';

  select string_agg(u.name, ',' order by u.ord) into v_cols
  from pg_proc p
  cross join lateral unnest(p.proargnames, p.proargmodes)
    with ordinality as u(name, mode, ord)
  where p.oid = v_oid and u.mode = 't';

  if v_cols is distinct from 'day,state,free_count' then
    raise exception 'returns %, which is not the reviewed shape', v_cols;
  end if;

  raise notice 'get_week_availability: installed correctly';
end;
$$;
