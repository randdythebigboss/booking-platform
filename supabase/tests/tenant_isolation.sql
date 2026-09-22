-- ===========================================================================
-- Proves point 15 of the Definition of Done: the security rules prevent
-- access to another business's data.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/tenant_isolation.sql
--
-- Runs against the seeded Estudio Demo, and creates a second, unrelated user
-- to play the stranger.
-- ===========================================================================

\set ON_ERROR_STOP on

-- A second account, with no connection to Estudio Demo.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  '77777777-7777-4777-8777-777777777777',
  'authenticated', 'authenticated',
  'stranger@bookingplatform.test',
  extensions.crypt('stranger-password-123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Sam Stranger"}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

---------------------------------------------------------------------------
-- The owner sees their own calendar.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
begin
  if (select count(*) from public.businesses where slug = 'demo-studio') <> 1 then
    raise exception 'FAIL: the owner cannot see their own business';
  end if;
  if (select count(*) from public.appointments) = 0 then
    raise exception 'FAIL: the owner cannot see their own appointments';
  end if;
  if (select count(*) from public.customers) = 0 then
    raise exception 'FAIL: the owner cannot see their own customers';
  end if;
  if (select count(*) from public.availability_rules) = 0 then
    raise exception 'FAIL: the owner cannot see their own working hours';
  end if;
  raise notice 'owner sees their own data';
end;
$$;

commit;

---------------------------------------------------------------------------
-- The stranger sees the public page and nothing else.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777777', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
begin
  -- Estudio Demo is published, so its catalogue is meant to be readable.
  if (select count(*) from public.businesses where slug = 'demo-studio') <> 1 then
    raise exception 'FAIL: a published business should be publicly readable';
  end if;
  if (select count(*) from public.services) = 0 then
    raise exception 'FAIL: active services of a published business should be readable';
  end if;

  -- Everything private must be invisible.
  if (select count(*) from public.appointments) <> 0 then
    raise exception 'FAIL: a stranger can read appointments';
  end if;
  if (select count(*) from public.customers) <> 0 then
    raise exception 'FAIL: a stranger can read customer records';
  end if;
  if (select count(*) from public.availability_rules) <> 0 then
    raise exception 'FAIL: a stranger can read a private calendar';
  end if;
  if (select count(*) from public.availability_exceptions) <> 0 then
    raise exception 'FAIL: a stranger can read calendar exceptions';
  end if;
  if (select count(*) from public.blocked_times) <> 0 then
    raise exception 'FAIL: a stranger can read blocked time';
  end if;
  if (select count(*) from public.business_members) <> 0 then
    raise exception 'FAIL: a stranger can read the team of another business';
  end if;

  raise notice 'stranger sees the public catalogue and none of the private data';
end;
$$;

commit;

---------------------------------------------------------------------------
-- The stranger cannot write into someone else's business.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777777', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
begin
  begin
    perform public.save_service(
      '22222222-2222-4222-8222-222222222222', 'Injected service', 30, 0
    );
    raise exception 'FAIL: a stranger added a service to another business';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.set_weekly_schedule(
      '33333333-3333-4333-8333-333333333333',
      '[{"weekday":1,"startTime":"00:00","endTime":"23:00"}]'::jsonb
    );
    raise exception 'FAIL: a stranger rewrote another professional''s hours';
  exception
    when others then
      if sqlerrm not in ('NOT_ALLOWED') and sqlstate <> '42501' then
        raise exception 'FAIL: unexpected error rewriting hours: % (%)', sqlerrm, sqlstate;
      end if;
  end;

  -- ...but they can create a business of their own.
  perform public.create_business(
    'Stranger Studio', 'stranger-studio', 'America/New_York', 'Sam Stranger'
  );

  if (select count(*) from public.business_members) <> 1 then
    raise exception 'FAIL: expected exactly one membership after onboarding';
  end if;

  raise notice 'stranger cannot write into another business, but can create their own';
end;
$$;

commit;


---------------------------------------------------------------------------
-- The stranger cannot mutate another business's rows directly either.
--
-- RLS filters UPDATE and DELETE through the USING clause, so they match no
-- rows rather than raising; INSERT is refused by WITH CHECK. Both shapes are
-- checked, because "affected zero rows" and "was rejected" are different
-- failures and only one of them is loud.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777777', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  c_business constant uuid := '22222222-2222-4222-8222-222222222222';
  c_professional constant uuid := '33333333-3333-4333-8333-333333333333';
  v_rows integer;
begin
  update public.services set price = 0 where business_id = c_business;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a stranger updated % service rows in another business', v_rows;
  end if;

  delete from public.availability_rules where professional_id = c_professional;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a stranger deleted % working-hour rows', v_rows;
  end if;

  delete from public.appointments where business_id = c_business;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a stranger deleted % appointments', v_rows;
  end if;

  update public.businesses set is_published = false where id = c_business;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a stranger unpublished another business';
  end if;

  begin
    insert into public.services (business_id, name, duration_minutes, price, currency)
    values (c_business, 'Injected', 30, 0, 'DOP');
    raise exception 'FAIL: a stranger inserted a service into another business';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.availability_rules (professional_id, weekday, start_time, end_time)
    values (c_professional, 1, time '00:00', time '23:00');
    raise exception 'FAIL: a stranger inserted working hours for another professional';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'stranger cannot mutate another business directly';
end;
$$;

commit;

---------------------------------------------------------------------------
-- What an anonymous visitor may see: the published catalogue, and no more.
---------------------------------------------------------------------------
begin;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
declare
  v_count integer;
begin
  -- The property is not "how many" but "which": everything an anonymous
  -- visitor can reach is published, and the published catalogue is reachable.
  -- Counting rows instead would pass only on a database nobody has used, and
  -- this suite is also run against a real development project.
  select count(*) into v_count from public.businesses where not is_published;
  if v_count <> 0 then
    raise exception 'FAIL: anon sees % unpublished business(es)', v_count;
  end if;

  if not exists (select 1 from public.businesses where slug = 'demo-studio') then
    raise exception 'FAIL: anon cannot see a published business';
  end if;

  select count(*) into v_count from public.businesses where slug = 'stranger-studio';
  if v_count <> 0 then
    raise exception 'FAIL: anon can see an unpublished business';
  end if;

  if not exists (
    select 1 from public.professional_profiles where display_name = 'Alex Rivera'
  ) then
    raise exception 'FAIL: anon cannot see a bookable professional of a published business';
  end if;

  select count(*) into v_count
  from public.professional_profiles
  where display_name = 'Sam Stranger';
  if v_count <> 0 then
    raise exception 'FAIL: anon can see a professional inside an unpublished business';
  end if;

  if (select count(*) from public.services) = 0 then
    raise exception 'FAIL: anon cannot see the services of a published business';
  end if;

  if (select count(*) from public.appointments) <> 0 then
    raise exception 'FAIL: anon can read appointments';
  end if;
  if (select count(*) from public.customers) <> 0 then
    raise exception 'FAIL: anon can read customer records';
  end if;
  if (select count(*) from public.availability_rules) <> 0 then
    raise exception 'FAIL: anon can read a private calendar';
  end if;
  if (select count(*) from public.blocked_times) <> 0 then
    raise exception 'FAIL: anon can read blocked time';
  end if;
  if (select count(*) from public.business_members) <> 0 then
    raise exception 'FAIL: anon can read business membership';
  end if;
  if (select count(*) from public.payments) <> 0 then
    raise exception 'FAIL: anon can read payments';
  end if;

  raise notice 'anon sees the published catalogue and nothing else';
end;
$$;

commit;


---------------------------------------------------------------------------
-- Phase 2: scheduling writes are tenant-scoped too.
--
-- Blocked time and date exceptions are as private as the calendar they shape,
-- so a stranger must not be able to create or delete either for someone
-- else's professional.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777777', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  c_professional constant uuid := '33333333-3333-4333-8333-333333333333';
  v_rows integer;
begin
  begin
    insert into public.blocked_times (professional_id, starts_at, ends_at, reason)
    values (
      c_professional,
      now() + interval '30 days',
      now() + interval '30 days 1 hour',
      'Injected block'
    );
    raise exception 'FAIL: a stranger blocked another professional''s calendar';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.availability_exceptions (
      professional_id, exception_date, exception_type, reason
    )
    values (c_professional, (current_date + 30)::date, 'unavailable', 'Injected exception');
    raise exception 'FAIL: a stranger closed another professional''s day';
  exception
    when insufficient_privilege then null;
  end;

  -- Deletes are filtered by the USING clause, so they match nothing instead
  -- of raising. Silent is still wrong, so it is asserted explicitly.
  delete from public.blocked_times where professional_id = c_professional;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a stranger deleted % blocked-time rows', v_rows;
  end if;

  delete from public.availability_exceptions where professional_id = c_professional;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a stranger deleted % availability exceptions', v_rows;
  end if;

  raise notice 'stranger cannot create or delete another tenant blocks and exceptions';
end;
$$;

commit;

\echo 'Tenant isolation holds.'
