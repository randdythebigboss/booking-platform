-- ===========================================================================
-- public.get_week_availability - the customer's week strip.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/week_availability.sql
--
-- Self-contained: it builds its own tenant so the expected counts are exact
-- and do not depend on what another suite left behind.
--
-- What is being proved, in order: the five states are told apart correctly,
-- the count is of what is FREE, availability follows the service, the range
-- is bounded, a hidden resource says nothing, and the shape of the answer
-- carries no fact about any booking.
-- ===========================================================================

\set ON_ERROR_STOP on

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
  'weeklab@bookingplatform.test',
  extensions.crypt('week-lab-password-123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Week Lab"}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

-- Open Monday and Tuesday 09:00-11:00 only. Two hours, a 30-minute grid:
-- four slots a day, which makes every count below checkable by hand.
insert into public.businesses (
  id, owner_user_id, name, slug, timezone, currency,
  slot_interval_minutes, minimum_notice_minutes, booking_horizon_days,
  auto_confirm_bookings, is_active, is_published
)
values (
  '77777777-0000-4000-8000-000000000001',
  '77777777-7777-4777-8777-777777777777',
  'Week Lab', 'week-lab', 'America/Santo_Domingo', 'DOP',
  30, 0, 60, true, true, true
);

insert into public.business_members (business_id, user_id, role)
values (
  '77777777-0000-4000-8000-000000000001',
  '77777777-7777-4777-8777-777777777777',
  'owner'
);

insert into public.professional_profiles (id, business_id, user_id, display_name, is_bookable)
values
  ('77777777-0000-4000-8000-0000000000a1',
   '77777777-0000-4000-8000-000000000001',
   '77777777-7777-4777-8777-777777777777', 'Week Pro', true),
  -- Not bookable: a stranger must learn nothing at all about this one.
  ('77777777-0000-4000-8000-0000000000a2',
   '77777777-0000-4000-8000-000000000001', null, 'Hidden Pro', false);

insert into public.services (
  id, business_id, name, duration_minutes,
  buffer_before_minutes, buffer_after_minutes, price, currency, is_active
)
values
  ('77777777-0000-4000-8000-000000000030'::uuid,
   '77777777-0000-4000-8000-000000000001', 'Week 30', 30, 0, 0, 100, 'DOP', true),
  -- Two hours: it fits a two-hour day exactly once, and never beside a
  -- booking. This is the service-dependence the UI must never flatten.
  ('77777777-0000-4000-8000-000000000120'::uuid,
   '77777777-0000-4000-8000-000000000001', 'Week 120', 120, 0, 0, 400, 'DOP', true);

insert into public.professional_services (professional_id, service_id)
select p.id, s.id
from public.professional_profiles p
cross join public.services s
where p.business_id = '77777777-0000-4000-8000-000000000001'
  and s.business_id = '77777777-0000-4000-8000-000000000001';

insert into public.availability_rules (professional_id, weekday, start_time, end_time)
select '77777777-0000-4000-8000-0000000000a1'::uuid, weekday, time '09:00', time '11:00'
from generate_series(1, 2) as weekday;

insert into public.customers (id, business_id, full_name, phone)
values (
  '77777777-0000-4000-8000-0000000000c1',
  '77777777-0000-4000-8000-000000000001',
  'Week Customer', '+1 809 555 7700'
);

do $$
declare
  c_pro constant uuid := '77777777-0000-4000-8000-0000000000a1';
  c_hidden constant uuid := '77777777-0000-4000-8000-0000000000a2';
  c_s30 constant uuid := '77777777-0000-4000-8000-000000000030';
  c_s120 constant uuid := '77777777-0000-4000-8000-000000000120';
  c_customer constant uuid := '77777777-0000-4000-8000-0000000000c1';
  c_tz constant text := 'America/Santo_Domingo';

  v_days int;
  v_monday date;
  v_tuesday date;
  v_state text;
  v_free int;
  v_count int;
  v_cols text;
begin
  -- A Monday three weeks out: inside the horizon, clear of "today".
  v_days := ((1 - extract(dow from current_date)::int + 7) % 7);
  if v_days = 0 then v_days := 7; end if;
  v_monday := current_date + v_days + 21;
  v_tuesday := v_monday + 1;

  ---------------------------------------------------------------------------
  raise notice '1. a worked day is open, and the count is what is free';

  select state::text, free_count into v_state, v_free
  from public.get_week_availability(c_pro, c_s30, v_monday, 7)
  where day = v_monday;

  if v_state is distinct from 'open' or v_free <> 4 then
    raise exception 'Monday should be open with 4 free, got % / %', v_state, v_free;
  end if;

  ---------------------------------------------------------------------------
  raise notice '2. a day the shop does not work is closed, not empty';

  select state::text, free_count into v_state, v_free
  from public.get_week_availability(c_pro, c_s30, v_monday, 7)
  where day = v_monday + 2;   -- Wednesday: no rule at all

  if v_state is distinct from 'closed' or v_free <> 0 then
    raise exception 'Wednesday should be closed with 0, got % / %', v_state, v_free;
  end if;

  ---------------------------------------------------------------------------
  raise notice '3. the count follows the service, not the day';

  -- Two hours fits the two-hour day exactly once.
  select state::text, free_count into v_state, v_free
  from public.get_week_availability(c_pro, c_s120, v_monday, 7)
  where day = v_monday;

  if v_state is distinct from 'open' or v_free <> 1 then
    raise exception 'the 120-minute service should see 1 free, got % / %', v_state, v_free;
  end if;

  ---------------------------------------------------------------------------
  raise notice '4. a booking reduces what is free, and can fill a day';

  -- One booking at 09:00 leaves 09:30, 10:00 and 10:30 for the short service
  -- and nothing at all for the long one.
  perform public.book_appointment(
    c_pro, c_s30,
    (v_monday + time '09:00') at time zone c_tz,
    'Week Customer', '+1 809 555 7700', null, null, 'es'
  );

  select free_count into v_free
  from public.get_week_availability(c_pro, c_s30, v_monday, 7)
  where day = v_monday;
  if v_free <> 3 then
    raise exception 'one booking should leave 3 free, got %', v_free;
  end if;

  select state::text, free_count into v_state, v_free
  from public.get_week_availability(c_pro, c_s120, v_monday, 7)
  where day = v_monday;
  if v_state is distinct from 'full' or v_free <> 0 then
    raise exception 'the long service should see a full day, got % / %', v_state, v_free;
  end if;

  ---------------------------------------------------------------------------
  raise notice '5. a closed day and a full day are different answers';

  -- Tuesday is worked and untouched; Wednesday is not worked. The customer
  -- does different things about each, which is the whole reason they differ.
  select state::text into v_state
  from public.get_week_availability(c_pro, c_s120, v_monday, 7)
  where day = v_tuesday;
  if v_state is distinct from 'open' then
    raise exception 'Tuesday should still be open, got %', v_state;
  end if;

  ---------------------------------------------------------------------------
  raise notice '6. yesterday is past, and beyond the horizon is beyond';

  select state::text into v_state
  from public.get_week_availability(c_pro, c_s30, current_date - 1, 7)
  where day = current_date - 1;
  if v_state is distinct from 'past' then
    raise exception 'yesterday should be past, got %', v_state;
  end if;

  select state::text into v_state
  from public.get_week_availability(c_pro, c_s30, current_date + 100, 7)
  where day = current_date + 100;
  if v_state is distinct from 'beyond' then
    raise exception 'past the horizon should be beyond, got %', v_state;
  end if;

  ---------------------------------------------------------------------------
  raise notice '7. an exception closes the day the customer is shown';

  insert into public.availability_exceptions
    (professional_id, exception_date, exception_type, reason)
  values (c_pro, v_tuesday, 'unavailable', 'Feriado');

  select state::text into v_state
  from public.get_week_availability(c_pro, c_s30, v_monday, 7)
  where day = v_tuesday;
  if v_state is distinct from 'closed' then
    raise exception 'an excepted Tuesday should be closed, got %', v_state;
  end if;

  ---------------------------------------------------------------------------
  raise notice '8. a hidden professional returns nothing, not an error';

  select count(*) into v_count
  from public.get_week_availability(c_hidden, c_s30, v_monday, 7);
  if v_count <> 0 then
    raise exception 'a professional who is not bookable leaked % rows', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '9. the range is bounded';

  begin
    perform public.get_week_availability(c_pro, c_s30, v_monday, 400);
    raise exception 'a 400-day range should have been refused';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.get_week_availability(c_pro, c_s30, v_monday, 0);
    raise exception 'a zero-day range should have been refused';
  exception
    when sqlstate '22023' then null;
  end;

  ---------------------------------------------------------------------------
  raise notice '10. the answer carries nothing about any booking';

  -- The privacy contract, stated as a shape: three columns, and none of them
  -- can hold a name, a service, a time or an identifier. A future change that
  -- adds one has to change this test on purpose.
  -- A RETURNS TABLE function keeps its output columns in proargnames, with
  -- mode 't'; there is no composite type to read them from.
  select string_agg(u.name, ',' order by u.ord) into v_cols
  from pg_proc p
  cross join lateral unnest(p.proargnames, p.proargmodes)
    with ordinality as u(name, mode, ord)
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'get_week_availability'
    and u.mode = 't';

  if v_cols is distinct from 'day,state,free_count' then
    raise exception 'get_week_availability returns %, which is not the reviewed shape', v_cols;
  end if;

  raise notice 'week_availability: all assertions passed';
end;
$$;
