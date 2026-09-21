-- ===========================================================================
-- Phase 4 - what a professional may do with an appointment, and what nobody
-- may do with someone else's.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/professional_operations.sql
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
  '33330000-0000-4000-8000-000000000003',
  'authenticated', 'authenticated', 'ops@bookingplatform.test',
  extensions.crypt('ops-password-123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Ops Owner"}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

insert into public.businesses (
  id, owner_user_id, name, slug, timezone, currency,
  slot_interval_minutes, minimum_notice_minutes, booking_horizon_days,
  auto_confirm_bookings, is_active, is_published
)
values (
  '44440000-0000-4000-8000-000000000004', '33330000-0000-4000-8000-000000000003',
  'Ops Studio', 'ops-studio', 'America/Santo_Domingo', 'DOP', 15, 60, 60,
  false, true, true
);

insert into public.business_members (business_id, user_id, role)
values ('44440000-0000-4000-8000-000000000004', '33330000-0000-4000-8000-000000000003', 'owner');

insert into public.professional_profiles (id, business_id, user_id, display_name)
values (
  '55550000-0000-4000-8000-000000000005',
  '44440000-0000-4000-8000-000000000004',
  '33330000-0000-4000-8000-000000000003',
  'Ops Pro'
);

insert into public.services (
  id, business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes,
  price, currency, is_active
)
values (
  '66660000-0000-4000-8000-000000000006', '44440000-0000-4000-8000-000000000004',
  'Ops Service', 30, 0, 0, 700, 'DOP', true
);

insert into public.professional_services (professional_id, service_id)
values ('55550000-0000-4000-8000-000000000005', '66660000-0000-4000-8000-000000000006');

insert into public.availability_rules (professional_id, weekday, start_time, end_time)
select '55550000-0000-4000-8000-000000000005', d::smallint, time '09:00', time '17:00'
from generate_series(0, 6) as d;

insert into public.customers (id, business_id, full_name, phone, email)
values (
  '77770000-0000-4000-8000-000000000007', '44440000-0000-4000-8000-000000000004',
  'Ops Customer', '+1 809 555 8000', 'ops.customer@example.test'
);

-- One appointment that has already happened, one still to come.
insert into public.appointments (
  id, business_id, professional_id, customer_id, starts_at, ends_at, status, source
)
values
  ('88880000-0000-4000-8000-000000000001', '44440000-0000-4000-8000-000000000004',
   '55550000-0000-4000-8000-000000000005', '77770000-0000-4000-8000-000000000007',
   now() - interval '2 hours', now() - interval '90 minutes', 'confirmed', 'public_page'),
  ('88880000-0000-4000-8000-000000000002', '44440000-0000-4000-8000-000000000004',
   '55550000-0000-4000-8000-000000000005', '77770000-0000-4000-8000-000000000007',
   ((current_date + 4)::timestamp + time '10:00') at time zone 'America/Santo_Domingo',
   ((current_date + 4)::timestamp + time '10:30') at time zone 'America/Santo_Domingo',
   'pending', 'public_page');

insert into public.appointment_items (
  appointment_id, service_id, service_name_snapshot,
  duration_minutes_snapshot, price_snapshot, currency_snapshot
)
values
  ('88880000-0000-4000-8000-000000000001', '66660000-0000-4000-8000-000000000006',
   'Ops Service', 30, 700.00, 'DOP'),
  ('88880000-0000-4000-8000-000000000002', '66660000-0000-4000-8000-000000000006',
   'Ops Service', 30, 700.00, 'DOP');

-- ---------------------------------------------------------------------------
-- The professional, working their own business.
-- ---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33330000-0000-4000-8000-000000000003', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  c_past constant uuid := '88880000-0000-4000-8000-000000000001';
  c_future constant uuid := '88880000-0000-4000-8000-000000000002';
  v_row record;
  v_message text;
begin
  ---------------------------------------------------------------------------
  raise notice '1. the professional sees their own appointments, with customer and snapshot';
  ---------------------------------------------------------------------------
  select a.status, c.full_name, c.phone, i.service_name_snapshot, i.price_snapshot
  into v_row
  from public.appointments a
  join public.customers c on c.id = a.customer_id
  join public.appointment_items i on i.appointment_id = a.id
  where a.id = c_future;

  if not found or v_row.full_name <> 'Ops Customer' or v_row.price_snapshot <> 700.00 then
    raise exception 'FAIL: the professional cannot see their own appointment correctly';
  end if;

  ---------------------------------------------------------------------------
  raise notice '2. a pending appointment can be confirmed';
  ---------------------------------------------------------------------------
  perform public.set_appointment_status(c_future, 'confirmed');
  if (select status from public.appointments where id = c_future) <> 'confirmed' then
    raise exception 'FAIL: confirming did not take effect';
  end if;

  ---------------------------------------------------------------------------
  raise notice '3. a future appointment cannot be completed or marked no-show';
  ---------------------------------------------------------------------------
  begin
    perform public.set_appointment_status(c_future, 'completed');
    raise exception 'FAIL: completed an appointment that has not started';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'APPOINTMENT_HAS_NOT_STARTED' then
        raise exception 'FAIL: expected APPOINTMENT_HAS_NOT_STARTED, got %', v_message;
      end if;
  end;

  begin
    perform public.set_appointment_status(c_future, 'no_show');
    raise exception 'FAIL: marked a future appointment as a no-show';
  exception
    when sqlstate '22023' then null;
  end;

  ---------------------------------------------------------------------------
  raise notice '4. a started appointment can be completed';
  ---------------------------------------------------------------------------
  perform public.set_appointment_status(c_past, 'completed');
  if (select status from public.appointments where id = c_past) <> 'completed' then
    raise exception 'FAIL: completing did not take effect';
  end if;

  ---------------------------------------------------------------------------
  raise notice '5. terminal really is terminal';
  ---------------------------------------------------------------------------
  begin
    perform public.set_appointment_status(c_past, 'confirmed');
    raise exception 'FAIL: reopened a completed appointment';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'INVALID_STATUS_TRANSITION' then
        raise exception 'FAIL: expected INVALID_STATUS_TRANSITION, got %', v_message;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '6. a pending appointment cannot skip straight to completed';
  ---------------------------------------------------------------------------
  insert into public.appointments (
    id, business_id, professional_id, customer_id, starts_at, ends_at, status
  )
  values (
    '88880000-0000-4000-8000-000000000003', '44440000-0000-4000-8000-000000000004',
    '55550000-0000-4000-8000-000000000005', '77770000-0000-4000-8000-000000000007',
    now() - interval '4 hours', now() - interval '3 hours', 'pending'
  );

  begin
    perform public.set_appointment_status('88880000-0000-4000-8000-000000000003', 'completed');
    raise exception 'FAIL: a pending appointment was completed without being confirmed';
  exception
    when sqlstate '22023' then null;
  end;

  raise notice '1-6 hold';
end;
$$;

commit;

-- ---------------------------------------------------------------------------
-- Cancelling, snapshots, and what a cancelled or completed appointment does
-- to availability.
-- ---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33330000-0000-4000-8000-000000000003', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  c_pro constant uuid := '55550000-0000-4000-8000-000000000005';
  c_service constant uuid := '66660000-0000-4000-8000-000000000006';
  c_future constant uuid := '88880000-0000-4000-8000-000000000002';
  c_tz constant text := 'America/Santo_Domingo';
  v_date date := (current_date + 4);
  v_slot timestamptz := (v_date::timestamp + time '10:00') at time zone c_tz;
  v_snapshot record;
begin
  ---------------------------------------------------------------------------
  raise notice '7. a booked time is not offered, and cancelling gives it back';
  ---------------------------------------------------------------------------
  if exists (
    select 1 from public.get_available_slots(c_pro, c_service, v_date) where starts_at = v_slot
  ) then
    raise exception 'FAIL: a confirmed appointment is still being offered';
  end if;

  perform public.set_appointment_status(c_future, 'cancelled', 'Customer called');

  if not exists (
    select 1 from public.get_available_slots(c_pro, c_service, v_date) where starts_at = v_slot
  ) then
    raise exception 'FAIL: cancelling did not release the time';
  end if;

  ---------------------------------------------------------------------------
  raise notice '8. cancelling keeps the record, the customer and the reason';
  ---------------------------------------------------------------------------
  select a.status, a.cancelled_at, a.cancellation_reason, c.full_name,
         i.service_name_snapshot, i.price_snapshot
  into v_snapshot
  from public.appointments a
  join public.customers c on c.id = a.customer_id
  join public.appointment_items i on i.appointment_id = a.id
  where a.id = c_future;

  if not found then
    raise exception 'FAIL: cancelling destroyed the appointment record';
  end if;
  if v_snapshot.cancelled_at is null then
    raise exception 'FAIL: cancelled_at was not stamped';
  end if;
  if v_snapshot.cancellation_reason <> 'Customer called' then
    raise exception 'FAIL: the cancellation reason was not kept';
  end if;
  if v_snapshot.full_name <> 'Ops Customer' then
    raise exception 'FAIL: the customer was lost with the cancellation';
  end if;

  ---------------------------------------------------------------------------
  raise notice '9. a completed appointment does not put its past time back on sale';
  ---------------------------------------------------------------------------
  -- 88880000-...0001 was completed above and started two hours ago.
  if exists (
    select 1
    from public.get_available_slots(c_pro, c_service, (current_date)::date)
    where starts_at < now()
  ) then
    raise exception 'FAIL: a past time is being offered for booking';
  end if;

  ---------------------------------------------------------------------------
  raise notice '10. the snapshot survives a later price change';
  ---------------------------------------------------------------------------
  update public.services set price = 1500 where id = c_service;

  select i.price_snapshot, i.duration_minutes_snapshot into v_snapshot
  from public.appointment_items i
  where i.appointment_id = '88880000-0000-4000-8000-000000000001';

  if v_snapshot.price_snapshot <> 700.00 or v_snapshot.duration_minutes_snapshot <> 30 then
    raise exception 'FAIL: changing the service rewrote a historical appointment';
  end if;

  update public.services set price = 700 where id = c_service;

  raise notice '7-10 hold';
end;
$$;

commit;

-- ---------------------------------------------------------------------------
-- Another tenant, and a stranger.
-- ---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  c_past constant uuid := '88880000-0000-4000-8000-000000000001';
  v_rows integer;
begin
  ---------------------------------------------------------------------------
  raise notice '11. another tenant sees neither the appointment nor its customer';
  ---------------------------------------------------------------------------
  if exists (select 1 from public.appointments where id = c_past) then
    raise exception 'FAIL: another tenant can read the appointment';
  end if;
  if exists (select 1 from public.customers where full_name = 'Ops Customer') then
    raise exception 'FAIL: another tenant can read the customer';
  end if;
  if exists (select 1 from public.appointment_items
             where appointment_id = c_past) then
    raise exception 'FAIL: another tenant can read the appointment items';
  end if;

  ---------------------------------------------------------------------------
  raise notice '12. another tenant cannot change its status';
  ---------------------------------------------------------------------------
  begin
    perform public.set_appointment_status(c_past, 'cancelled', 'Not mine');
    raise exception 'FAIL: another tenant changed an appointment status';
  exception
    when sqlstate 'PT404' then null;
  end;

  -- A direct UPDATE is filtered to nothing rather than raising, which is just
  -- as wrong if it ever touched a row.
  update public.appointments set status = 'cancelled' where id = c_past;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: another tenant updated % appointment rows', v_rows;
  end if;

  raise notice '11-12 hold';
end;
$$;

commit;

begin;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
declare
  c_past constant uuid := '88880000-0000-4000-8000-000000000001';
begin
  ---------------------------------------------------------------------------
  raise notice '13. a stranger cannot reach the status RPC at all';
  ---------------------------------------------------------------------------
  begin
    perform public.set_appointment_status(c_past, 'cancelled');
    raise exception 'FAIL: anon can call set_appointment_status';
  exception
    when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------------------
  raise notice '14. and cannot read any of it';
  ---------------------------------------------------------------------------
  if (select count(*) from public.appointments) <> 0
     or (select count(*) from public.customers) <> 0
     or (select count(*) from public.appointment_items) <> 0 then
    raise exception 'FAIL: anon can read professional data';
  end if;

  raise notice '13-14 hold';
end;
$$;

commit;

\echo 'Professional operations hold.'
