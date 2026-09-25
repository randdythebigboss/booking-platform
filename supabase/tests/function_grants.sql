-- ===========================================================================
-- The grant classification, asserted.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/function_grants.sql
--
-- Supabase grants EXECUTE on every new function to anon, authenticated and
-- service_role by default, so a function added without thought is public by
-- accident. This suite is deliberately strict: adding a function to `public`
-- fails it until the function is placed in one of the three groups below.
-- That friction is the point -- it has caught a real leak twice.
-- ===========================================================================

\set ON_ERROR_STOP on

do $$
declare
  -- A stranger holding only the anon key may call exactly these.
  c_anon_safe constant text[] := array[
    'book_appointment',
    'cancel_appointment_by_token',
    'get_appointment_by_token',
    'get_availability_context',
    'get_payment_by_token',
    'get_available_slots',
    -- The whole shape of a day, with a state per slot and nothing about the
    -- appointment behind a busy one.
    'get_day_schedule',
    -- The same day view, aggregated per day across a week: a date, a state and
    -- a count of what is FREE. Strictly less than get_day_schedule returns.
    'get_week_availability',
    -- The guest's own conversation. The booking credential is the guest's
    -- only identity, and each of these checks it before doing anything.
    'get_appointment_messages_by_token',
    'send_appointment_message_by_token',
    'mark_messages_read_by_token',
    'is_business_public',
    'payment_capabilities',
    'payments_are_available',
    'professional_business_id',
    'reschedule_appointment_by_token',
    'retry_payment_by_token',
    -- Development-only in effect: it refuses everything unless
    -- platform_settings.payment_simulation_enabled is on, which production
    -- must leave off. See ADR 0022.
    'simulate_payment_by_token'
  ];

  -- ...and a signed-in professional, these as well.
  c_professional constant text[] := array[
    'can_manage_professional',
    -- Both answer questions about auth.uid(), which anon does not have.
    'claim_appointment',
    'my_appointments',
    'create_business',
    'create_manual_appointment',
    'is_business_manager',
    'is_business_member',
    'reschedule_appointment',
    'save_service',
    'set_appointment_status',
    'refund_payment',
    'set_weekly_schedule'
  ];

  -- Tables that deliberately have row level security and no policy at all.
  -- "No policy" means no client role can reach a row through PostgREST under
  -- any circumstances, which for these is the entire point: they are read by
  -- SECURITY DEFINER functions and by nobody else.
  c_no_policy_on_purpose constant text[] := array[
    'platform_settings'
  ];

  v_unexpected text;
  v_missing text;
  v_row record;
begin
  ---------------------------------------------------------------------------
  raise notice '1. anon may execute exactly the public surface';
  ---------------------------------------------------------------------------
  select string_agg(p.proname, ', ' order by p.proname) into v_unexpected
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname not like 'gbt%' and p.proname not like '%!_dist' escape '!'
    and p.proname not like 'gbtree%'
    and has_function_privilege('anon', p.oid, 'EXECUTE')
    and not (p.proname = any (c_anon_safe));

  if v_unexpected is not null then
    raise exception
      'FAIL: anon can execute %. Classify it in 20260922110000_classify_function_grants.sql and revoke it, or add it to c_anon_safe if it is genuinely public.',
      v_unexpected;
  end if;

  select string_agg(name, ', ') into v_missing
  from unnest(c_anon_safe) as name
  where not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = name
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  );

  if v_missing is not null then
    raise exception 'FAIL: anon has lost access to %, which the public flow needs', v_missing;
  end if;

  ---------------------------------------------------------------------------
  raise notice '2. authenticated may execute the public surface plus its own';
  ---------------------------------------------------------------------------
  select string_agg(p.proname, ', ' order by p.proname) into v_unexpected
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname not like 'gbt%' and p.proname not like '%!_dist' escape '!'
    and p.proname not like 'gbtree%'
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and not (p.proname = any (c_anon_safe))
    and not (p.proname = any (c_professional));

  if v_unexpected is not null then
    raise exception
      'FAIL: authenticated can execute %, which is classified INTERNAL ONLY', v_unexpected;
  end if;

  ---------------------------------------------------------------------------
  raise notice '3. every SECURITY DEFINER function pins its search_path';
  ---------------------------------------------------------------------------
  select string_agg(p.proname, ', ' order by p.proname) into v_unexpected
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.proconfig is null;

  if v_unexpected is not null then
    raise exception 'FAIL: SECURITY DEFINER without a pinned search_path: %', v_unexpected;
  end if;

  ---------------------------------------------------------------------------
  raise notice '4. every table in public has row level security, with policies';
  ---------------------------------------------------------------------------
  for v_row in
    select c.relname, c.relrowsecurity,
           (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    if not v_row.relrowsecurity then
      raise exception 'FAIL: % has no row level security', v_row.relname;
    end if;
    if v_row.policies = 0 and not (v_row.relname = any (c_no_policy_on_purpose)) then
      raise exception 'FAIL: % has row level security but no policies, so it is unreadable', v_row.relname;
    end if;

    -- ...and the exceptions have to stay unreadable, or they are not
    -- exceptions, they are mistakes.
    if v_row.policies > 0 and (v_row.relname = any (c_no_policy_on_purpose)) then
      raise exception 'FAIL: % was meant to be unreachable and now has a policy', v_row.relname;
    end if;
  end loop;

  raise notice 'the grant classification holds';
end;
$$;

\echo 'Function grants hold.'
