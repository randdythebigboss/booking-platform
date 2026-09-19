-- ===========================================================================
-- Proves point 15 of the Definition of Done: the security rules prevent
-- access to another business's data.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/tenant_isolation.sql
--
-- Runs against the seeded Demo Studio, and creates a second, unrelated user
-- to play the stranger.
-- ===========================================================================

\set ON_ERROR_STOP on

-- A second account, with no connection to Demo Studio.
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
  -- Demo Studio is published, so its catalogue is meant to be readable.
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

\echo 'Tenant isolation holds.'
