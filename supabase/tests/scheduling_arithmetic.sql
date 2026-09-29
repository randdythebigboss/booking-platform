-- ===========================================================================
-- The arithmetic underneath the calendar.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/scheduling_arithmetic.sql
--
-- Run against a freshly reset stack. It builds its own fictional tenant --
-- "Clinica Prueba" -- rather than using the seed, because the seed's fifteen
-- minute increment and thirty/forty-five/sixty minute services cannot express
-- the cases that matter, and because a scheduling test that shares a calendar
-- with every other suite is a scheduling test that fails for the wrong reason.
--
-- ---------------------------------------------------------------------------
-- Why these numbers
-- ---------------------------------------------------------------------------
--
-- The Product Owner reported the case from a real professional: a twenty
-- minute service at half past ten, then a forty minute service. What is the
-- next start the second one may have?
--
-- It is not "10:50". It depends on the increment the business configured, on
-- the buffers each service carries, and on where the working window starts --
-- because the grid is anchored to the window, not to the hour. That is three
-- interacting rules and no amount of reading the code settles it, so the
-- answers are written down here as arithmetic anybody can check by hand.
-- ===========================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- A tenant of its own.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  'aaaa1111-1111-4111-8111-aaaaaaaaaaaa',
  'authenticated', 'authenticated',
  'clinica@bookingplatform.test',
  extensions.crypt('clinica-password-123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Clinica Prueba"}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

insert into public.businesses (
  id, owner_user_id, name, slug, timezone, currency,
  slot_interval_minutes, minimum_notice_minutes, booking_horizon_days,
  auto_confirm_bookings, is_active, is_published
)
values (
  'aaaa2222-2222-4222-8222-aaaaaaaaaaaa',
  'aaaa1111-1111-4111-8111-aaaaaaaaaaaa',
  'Clinica Prueba', 'clinica-prueba', 'America/Santo_Domingo', 'DOP',
  15, 0, 60, true, true, true
)
on conflict (id) do nothing;

insert into public.business_members (business_id, user_id, role)
values ('aaaa2222-2222-4222-8222-aaaaaaaaaaaa', 'aaaa1111-1111-4111-8111-aaaaaaaaaaaa', 'owner')
on conflict do nothing;

insert into public.professional_profiles (id, business_id, user_id, display_name, is_bookable)
values (
  'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
  'aaaa2222-2222-4222-8222-aaaaaaaaaaaa',
  'aaaa1111-1111-4111-8111-aaaaaaaaaaaa',
  'Dra. Prueba', true
)
on conflict (id) do nothing;

-- Twenty and forty minutes, no buffers, so the first cases isolate the
-- increment. Buffers get their own section further down.
insert into public.services (
  id, business_id, name, duration_minutes,
  buffer_before_minutes, buffer_after_minutes, price, currency, sort_order, is_active
)
values
  ('aaaa4444-4444-4444-8444-000000000020', 'aaaa2222-2222-4222-8222-aaaaaaaaaaaa',
   'Consulta corta', 20, 0, 0, 500.00, 'DOP', 0, true),
  ('aaaa4444-4444-4444-8444-000000000040', 'aaaa2222-2222-4222-8222-aaaaaaaaaaaa',
   'Consulta larga', 40, 0, 0, 900.00, 'DOP', 1, true),
  ('aaaa4444-4444-4444-8444-000000000041', 'aaaa2222-2222-4222-8222-aaaaaaaaaaaa',
   'Consulta larga con margen', 40, 10, 0, 900.00, 'DOP', 2, true)
on conflict (id) do nothing;

insert into public.professional_services (professional_id, service_id)
select 'aaaa3333-3333-4333-8333-aaaaaaaaaaaa'::uuid, s.id
from public.services s
where s.business_id = 'aaaa2222-2222-4222-8222-aaaaaaaaaaaa'
on conflict do nothing;

-- Every weekday 09:00-13:00. The window start matters: the grid is anchored
-- to it, so 09:00 is what makes 10:30 land on the grid at all.
insert into public.availability_rules (professional_id, weekday, start_time, end_time)
select 'aaaa3333-3333-4333-8333-aaaaaaaaaaaa'::uuid, weekday::smallint, time '09:00', time '13:00'
from generate_series(0, 6) as weekday
on conflict do nothing;

---------------------------------------------------------------------------
-- A working day far enough ahead that "minimum notice" is never the reason
-- a slot is refused.
---------------------------------------------------------------------------
create temporary table sched_fixture (
  the_day date,
  appointment_id uuid
) on commit preserve rows;

grant all on sched_fixture to public;

insert into sched_fixture (the_day)
select ((now() at time zone 'America/Santo_Domingo')::date + 7);

---------------------------------------------------------------------------
-- The reported case, at the configured fifteen minute increment.
--
--   window 09:00-13:00, grid every 15 minutes from 09:00
--   a 20 minute service occupies 10:30-10:50
--   a 40 minute service needs a free [start, start+40)
--
--   10:45 + 40 = 11:25  overlaps 10:30-10:50   -> taken
--   11:00 + 40 = 11:40  clear                  -> available
--
-- So the answer is 11:00, not 10:50: at a fifteen minute grid there is no
-- 10:50 to offer.
---------------------------------------------------------------------------
do $$
declare
  v_day date;
  v_start timestamptz;
  v_next timestamptz;
  v_expected timestamptz;
begin
  select the_day into v_day from sched_fixture;

  v_start := (v_day + time '10:30') at time zone 'America/Santo_Domingo';

  insert into public.appointments (
    business_id, professional_id, customer_id, starts_at, ends_at,
    buffer_before_minutes, buffer_after_minutes, status, source
  )
  select
    'aaaa2222-2222-4222-8222-aaaaaaaaaaaa',
    'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
    c.id,
    v_start,
    v_start + interval '20 minutes',
    0, 0, 'confirmed', 'manual'
  from public.customers c
  where c.business_id = 'aaaa2222-2222-4222-8222-aaaaaaaaaaaa'
  limit 1;

  if not found then
    insert into public.customers (business_id, full_name, phone)
    values ('aaaa2222-2222-4222-8222-aaaaaaaaaaaa', 'Paciente Prueba', '809-555-0300');

    insert into public.appointments (
      business_id, professional_id, customer_id, starts_at, ends_at,
      buffer_before_minutes, buffer_after_minutes, status, source
    )
    select
      'aaaa2222-2222-4222-8222-aaaaaaaaaaaa',
      'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
      c.id, v_start, v_start + interval '20 minutes',
      0, 0, 'confirmed', 'manual'
    from public.customers c
    where c.business_id = 'aaaa2222-2222-4222-8222-aaaaaaaaaaaa'
    order by c.created_at desc
    limit 1;
  end if;

  update sched_fixture set appointment_id = (
    select a.id from public.appointments a
    where a.professional_id = 'aaaa3333-3333-4333-8333-aaaaaaaaaaaa'
      and a.starts_at = v_start
    limit 1
  );

  -- The twenty minute service itself: 10:30 is now gone, 10:15 is still there
  -- (10:15 + 20 = 10:35 overlaps), and 10:50 does not exist on a 15 grid.
  if exists (
    select 1 from public.get_day_schedule(
      'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
      'aaaa4444-4444-4444-8444-000000000020', v_day) s
    where s.starts_at = v_start and s.state = 'available'
  ) then
    raise exception 'FAIL: the booked slot is still on offer';
  end if;

  -- The reported case.
  select min(s.starts_at) into v_next
  from public.get_day_schedule(
    'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
    'aaaa4444-4444-4444-8444-000000000040', v_day) s
  where s.state = 'available' and s.starts_at > v_start;

  v_expected := (v_day + time '11:00') at time zone 'America/Santo_Domingo';

  if v_next is distinct from v_expected then
    raise exception 'FAIL: next 40-minute start after 10:30 is %, expected 11:00 (got % )',
      v_next at time zone 'America/Santo_Domingo', v_next;
  end if;

  -- And the last one before it is 09:45, because 10:00 + 40 = 10:40 collides.
  select max(s.starts_at) into v_next
  from public.get_day_schedule(
    'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
    'aaaa4444-4444-4444-8444-000000000040', v_day) s
  where s.state = 'available' and s.starts_at < v_start;

  if v_next is distinct from ((v_day + time '09:45') at time zone 'America/Santo_Domingo') then
    raise exception 'FAIL: last 40-minute start before the booking is %, expected 09:45',
      v_next at time zone 'America/Santo_Domingo';
  end if;

  raise notice 'OK: 15-minute grid -> next 40-minute start is 11:00';
end;
$$;

---------------------------------------------------------------------------
-- The same booking, at a ten minute increment.
--
--   10:50 + 40 = 11:30, and [10:50, 11:30) does not overlap [10:30, 10:50)
--   because the ranges are half-open. So 10:50 IS offered here.
--
-- This is the case that proves the answer is a property of the configured
-- increment and not a constant somebody can memorise.
---------------------------------------------------------------------------
do $$
declare
  v_day date;
  v_start timestamptz;
  v_next timestamptz;
begin
  select the_day into v_day from sched_fixture;
  v_start := (v_day + time '10:30') at time zone 'America/Santo_Domingo';

  update public.businesses set slot_interval_minutes = 10
  where id = 'aaaa2222-2222-4222-8222-aaaaaaaaaaaa';

  select min(s.starts_at) into v_next
  from public.get_day_schedule(
    'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
    'aaaa4444-4444-4444-8444-000000000040', v_day) s
  where s.state = 'available' and s.starts_at > v_start;

  if v_next is distinct from ((v_day + time '10:50') at time zone 'America/Santo_Domingo') then
    raise exception 'FAIL: at a 10-minute grid the next 40-minute start is %, expected 10:50',
      v_next at time zone 'America/Santo_Domingo';
  end if;

  raise notice 'OK: 10-minute grid -> next 40-minute start is 10:50';
end;
$$;

---------------------------------------------------------------------------
-- The same booking, same ten minute grid, but the long service carries a ten
-- minute setup buffer.
--
--   candidate 10:50 is tested as [10:40, 11:30) -- the buffer is part of what
--   must be free -- and that DOES overlap the appointment. 11:00 is tested as
--   [10:50, 11:40), which does not.
--
-- A buffer is time the professional needs, so it has to be respected when the
-- slot is offered rather than discovered afterwards.
---------------------------------------------------------------------------
do $$
declare
  v_day date;
  v_start timestamptz;
  v_next timestamptz;
begin
  select the_day into v_day from sched_fixture;
  v_start := (v_day + time '10:30') at time zone 'America/Santo_Domingo';

  select min(s.starts_at) into v_next
  from public.get_day_schedule(
    'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
    'aaaa4444-4444-4444-8444-000000000041', v_day) s
  where s.state = 'available' and s.starts_at > v_start;

  if v_next is distinct from ((v_day + time '11:00') at time zone 'America/Santo_Domingo') then
    raise exception 'FAIL: with a 10-minute setup buffer the next start is %, expected 11:00',
      v_next at time zone 'America/Santo_Domingo';
  end if;

  raise notice 'OK: a setup buffer moves the next start from 10:50 to 11:00';
end;
$$;

---------------------------------------------------------------------------
-- The window is the boundary, not the clock.
--
-- The last 40-minute start in a 09:00-13:00 window is 12:20, because 12:30
-- would end at 13:10. Nothing may be offered that runs past closing.
---------------------------------------------------------------------------
do $$
declare
  v_day date;
  v_last timestamptz;
begin
  select the_day into v_day from sched_fixture;

  update public.businesses set slot_interval_minutes = 15
  where id = 'aaaa2222-2222-4222-8222-aaaaaaaaaaaa';

  select max(s.starts_at) into v_last
  from public.get_day_schedule(
    'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
    'aaaa4444-4444-4444-8444-000000000040', v_day) s;

  if v_last is distinct from ((v_day + time '12:15') at time zone 'America/Santo_Domingo') then
    raise exception 'FAIL: last 40-minute slot of the day is %, expected 12:15',
      v_last at time zone 'America/Santo_Domingo';
  end if;

  raise notice 'OK: nothing is offered that would run past closing';
end;
$$;

---------------------------------------------------------------------------
-- A split shift is two windows, and each anchors its own grid.
--
--   09:00-11:00 and 14:00-16:00, 15 minute grid, 40 minute service.
--   Mornings end at 10:20 (10:30 would run to 11:10).
--   Afternoons start again at 14:00 -- not at 14:05 or some continuation of
--   the morning's counting.
---------------------------------------------------------------------------
do $$
declare
  v_day date;
  v_weekday smallint;
  v_morning_last timestamptz;
  v_afternoon_first timestamptz;
  v_gap integer;
begin
  select the_day into v_day from sched_fixture;
  v_weekday := extract(dow from v_day)::smallint;

  delete from public.availability_rules
  where professional_id = 'aaaa3333-3333-4333-8333-aaaaaaaaaaaa' and weekday = v_weekday;

  insert into public.availability_rules (professional_id, weekday, start_time, end_time)
  values
    ('aaaa3333-3333-4333-8333-aaaaaaaaaaaa', v_weekday, time '09:00', time '11:00'),
    ('aaaa3333-3333-4333-8333-aaaaaaaaaaaa', v_weekday, time '14:00', time '16:00');

  -- The last slot the morning offers at all is 10:15: on a 15 minute grid
  -- anchored at 09:00 the next one is 10:30, and 10:30 + 40 runs to 11:10,
  -- past the window.
  select max(s.starts_at) into v_morning_last
  from public.get_day_schedule(
    'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
    'aaaa4444-4444-4444-8444-000000000040', v_day) s
  where s.starts_at < (v_day + time '12:00') at time zone 'America/Santo_Domingo';

  if v_morning_last is distinct from ((v_day + time '10:15') at time zone 'America/Santo_Domingo') then
    raise exception 'FAIL: last morning slot offered is %, expected 10:15',
      v_morning_last at time zone 'America/Santo_Domingo';
  end if;

  -- And the last one actually BOOKABLE is 09:45, because the 10:30
  -- appointment is still there and 10:00 + 40 reaches into it.
  select max(s.starts_at) into v_morning_last
  from public.get_day_schedule(
    'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
    'aaaa4444-4444-4444-8444-000000000040', v_day) s
  where s.state = 'available'
    and s.starts_at < (v_day + time '12:00') at time zone 'America/Santo_Domingo';

  if v_morning_last is distinct from ((v_day + time '09:45') at time zone 'America/Santo_Domingo') then
    raise exception 'FAIL: last bookable morning slot is %, expected 09:45',
      v_morning_last at time zone 'America/Santo_Domingo';
  end if;

  select min(s.starts_at) into v_afternoon_first
  from public.get_day_schedule(
    'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
    'aaaa4444-4444-4444-8444-000000000040', v_day) s
  where s.starts_at >= (v_day + time '12:00') at time zone 'America/Santo_Domingo';

  if v_afternoon_first is distinct from ((v_day + time '14:00') at time zone 'America/Santo_Domingo') then
    raise exception 'FAIL: first afternoon slot is %, expected 14:00',
      v_afternoon_first at time zone 'America/Santo_Domingo';
  end if;

  -- And nothing at all is offered between the two.
  select count(*) into v_gap
  from public.get_day_schedule(
    'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
    'aaaa4444-4444-4444-8444-000000000040', v_day) s
  where s.starts_at > (v_day + time '11:00') at time zone 'America/Santo_Domingo'
    and s.starts_at < (v_day + time '14:00') at time zone 'America/Santo_Domingo';

  if v_gap <> 0 then
    raise exception 'FAIL: % slot(s) offered during the break', v_gap;
  end if;

  raise notice 'OK: a split shift is two windows, each anchoring its own grid';
end;
$$;

---------------------------------------------------------------------------
-- A blocked period removes exactly what it covers, and a closed day removes
-- the day.
---------------------------------------------------------------------------
do $$
declare
  v_day date;
  v_weekday smallint;
  v_before integer;
  v_after integer;
begin
  select the_day into v_day from sched_fixture;
  v_weekday := extract(dow from v_day)::smallint;

  -- Back to one window so the counting is easy to follow.
  delete from public.availability_rules
  where professional_id = 'aaaa3333-3333-4333-8333-aaaaaaaaaaaa' and weekday = v_weekday;
  insert into public.availability_rules (professional_id, weekday, start_time, end_time)
  values ('aaaa3333-3333-4333-8333-aaaaaaaaaaaa', v_weekday, time '09:00', time '13:00');

  select count(*) into v_before
  from public.get_day_schedule(
    'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
    'aaaa4444-4444-4444-8444-000000000040', v_day) s
  where s.state = 'available';

  insert into public.blocked_times (professional_id, starts_at, ends_at, reason)
  values (
    'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
    (v_day + time '09:00') at time zone 'America/Santo_Domingo',
    (v_day + time '10:00') at time zone 'America/Santo_Domingo',
    'Reunion de equipo'
  );

  select count(*) into v_after
  from public.get_day_schedule(
    'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
    'aaaa4444-4444-4444-8444-000000000040', v_day) s
  where s.state = 'available';

  if v_after >= v_before then
    raise exception 'FAIL: blocking an hour did not remove any slot (% -> %)', v_before, v_after;
  end if;

  -- Nothing starting inside the block survives.
  if exists (
    select 1 from public.get_day_schedule(
      'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
      'aaaa4444-4444-4444-8444-000000000040', v_day) s
    where s.state = 'available'
      and s.starts_at >= (v_day + time '09:00') at time zone 'America/Santo_Domingo'
      and s.starts_at < (v_day + time '10:00') at time zone 'America/Santo_Domingo'
  ) then
    raise exception 'FAIL: a slot inside the blocked hour is still on offer';
  end if;

  raise notice 'OK: a blocked period removes exactly what it covers (% -> % slots)', v_before, v_after;

  -- A whole-day closure leaves nothing at all.
  insert into public.availability_exceptions (professional_id, exception_date, exception_type, reason)
  values ('aaaa3333-3333-4333-8333-aaaaaaaaaaaa', v_day, 'unavailable', 'Feriado')
  on conflict do nothing;

  if exists (
    select 1 from public.get_day_schedule(
      'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
      'aaaa4444-4444-4444-8444-000000000040', v_day) s
    where s.state = 'available'
  ) then
    raise exception 'FAIL: a closed day still offers slots';
  end if;

  raise notice 'OK: a closed day offers nothing';
end;
$$;

---------------------------------------------------------------------------
-- The booking horizon and the past are the two ends of the same rule.
---------------------------------------------------------------------------
do $$
declare
  v_today date;
  v_beyond date;
begin
  v_today := (now() at time zone 'America/Santo_Domingo')::date;
  v_beyond := v_today + 61;  -- horizon is 60

  if exists (
    select 1 from public.get_day_schedule(
      'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
      'aaaa4444-4444-4444-8444-000000000040', v_beyond)
  ) then
    raise exception 'FAIL: a day past the booking horizon returned slots';
  end if;

  if exists (
    select 1 from public.get_day_schedule(
      'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
      'aaaa4444-4444-4444-8444-000000000040', v_today - 1)
  ) then
    raise exception 'FAIL: yesterday returned slots';
  end if;

  raise notice 'OK: nothing before today and nothing past the horizon';
end;
$$;

---------------------------------------------------------------------------
-- The week view and the day view must agree. A day the strip calls "open"
-- with N free times must actually offer N of them.
---------------------------------------------------------------------------
do $$
declare
  v_row record;
  v_actual integer;
begin
  for v_row in
    select w.day, w.state, w.free_count
    from public.get_week_availability(
      'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
      'aaaa4444-4444-4444-8444-000000000040',
      (now() at time zone 'America/Santo_Domingo')::date,
      14) w
  loop
    select count(*) into v_actual
    from public.get_day_schedule(
      'aaaa3333-3333-4333-8333-aaaaaaaaaaaa',
      'aaaa4444-4444-4444-8444-000000000040', v_row.day) s
    where s.state = 'available';

    if v_row.state in ('open', 'full', 'closed') and v_row.free_count <> v_actual then
      raise exception 'FAIL: the week says % free on % and the day says %',
        v_row.free_count, v_row.day, v_actual;
    end if;

    if v_row.state = 'open' and v_actual = 0 then
      raise exception 'FAIL: % is called open and offers nothing', v_row.day;
    end if;
    if v_row.state = 'full' and v_actual <> 0 then
      raise exception 'FAIL: % is called full and offers %', v_row.day, v_actual;
    end if;
  end loop;

  raise notice 'OK: the week strip and the day agree for fourteen days';
end;
$$;

---------------------------------------------------------------------------
-- One day has one set of hours.
--
-- Saving custom hours twice for the same date used to insert a second row,
-- and `working_windows` returned both -- so a Wednesday changed from 11:00 to
-- 13:00 stayed open at 11:00, with nothing on screen saying so.
---------------------------------------------------------------------------
do $$
declare
  v_day date;
  v_windows integer;
begin
  select the_day into v_day from sched_fixture;

  delete from public.availability_exceptions
  where professional_id = 'aaaa3333-3333-4333-8333-aaaaaaaaaaaa';

  insert into public.availability_exceptions
    (professional_id, exception_date, exception_type, start_time, end_time)
  values
    ('aaaa3333-3333-4333-8333-aaaaaaaaaaaa', v_day, 'available', time '11:00', time '15:00');

  -- A second set of custom hours for the same date is refused.
  begin
    insert into public.availability_exceptions
      (professional_id, exception_date, exception_type, start_time, end_time)
    values
      ('aaaa3333-3333-4333-8333-aaaaaaaaaaaa', v_day, 'available', time '13:00', time '15:00');
    raise exception 'FAIL: a second set of custom hours was accepted for one date';
  exception
    when unique_violation then null;
  end;

  select count(*) into v_windows
  from public.working_windows(
    'aaaa3333-3333-4333-8333-aaaaaaaaaaaa', 'America/Santo_Domingo', v_day);

  if v_windows <> 1 then
    raise exception 'FAIL: % working windows for a day with one exception', v_windows;
  end if;

  -- Closed all day, twice, is also refused.
  delete from public.availability_exceptions
  where professional_id = 'aaaa3333-3333-4333-8333-aaaaaaaaaaaa';

  insert into public.availability_exceptions (professional_id, exception_date, exception_type)
  values ('aaaa3333-3333-4333-8333-aaaaaaaaaaaa', v_day, 'unavailable');

  begin
    insert into public.availability_exceptions (professional_id, exception_date, exception_type)
    values ('aaaa3333-3333-4333-8333-aaaaaaaaaaaa', v_day, 'unavailable');
    raise exception 'FAIL: a date was closed all day twice';
  exception
    when unique_violation then null;
  end;

  -- Two TIMED closures on one date stay allowed: they are additive, not
  -- contradictory, and the seed itself uses that shape.
  delete from public.availability_exceptions
  where professional_id = 'aaaa3333-3333-4333-8333-aaaaaaaaaaaa';

  insert into public.availability_exceptions
    (professional_id, exception_date, exception_type, start_time, end_time)
  values
    ('aaaa3333-3333-4333-8333-aaaaaaaaaaaa', v_day, 'unavailable', time '10:00', time '11:00'),
    ('aaaa3333-3333-4333-8333-aaaaaaaaaaaa', v_day, 'unavailable', time '14:00', time '15:00');

  raise notice 'OK: one set of custom hours per day, and timed closures stay additive';
end;
$$;

\echo 'scheduling_arithmetic: every assertion held'
