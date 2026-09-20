-- ===========================================================================
-- Executable proof of the promises in docs/DATABASE.md.
--
-- Run against a freshly reset local stack:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/booking_guarantees.sql
--
-- Any failure raises, which stops psql with a non-zero exit code.
-- ===========================================================================

\set ON_ERROR_STOP on

do $$
declare
  c_professional constant uuid := '33333333-3333-4333-8333-333333333333';
  c_service constant uuid := '44444444-4444-4444-8444-000000000002'; -- 45 min, 5 min after
  c_timezone constant text := 'America/Santo_Domingo';

  v_days_ahead int;
  v_monday date;
  v_slot timestamptz;
  v_result jsonb;
  v_appointment_id uuid;
  v_token uuid;
  v_message text;
  v_busy_count int;
begin
  -- The next Monday, between one and seven days out: always inside the
  -- booking horizon, always a day the seeded schedule is open.
  v_days_ahead := ((1 - extract(dow from current_date)::int + 7) % 7);
  if v_days_ahead = 0 then
    v_days_ahead := 7;
  end if;
  v_monday := current_date + v_days_ahead;
  v_slot := (v_monday::timestamp + time '15:00') at time zone c_timezone;

  -- A block we control, so this test does not depend on the seeded one.
  insert into public.blocked_times (professional_id, starts_at, ends_at, reason)
  values (
    c_professional,
    (v_monday::timestamp + time '17:00') at time zone c_timezone,
    (v_monday::timestamp + time '17:30') at time zone c_timezone,
    'Reserved by booking_guarantees.sql'
  );

  ---------------------------------------------------------------------------
  raise notice '1. a valid slot can be booked';
  ---------------------------------------------------------------------------
  v_result := public.book_appointment(
    c_professional, c_service, v_slot, 'Race Contestant One', '+1 809 555 1001'
  );
  v_appointment_id := (v_result ->> 'appointmentId')::uuid;
  v_token := (v_result ->> 'accessToken')::uuid;

  if v_result ->> 'status' <> 'confirmed' then
    raise exception 'FAIL: expected auto-confirmed booking, got %', v_result ->> 'status';
  end if;

  ---------------------------------------------------------------------------
  raise notice '2. the same slot cannot be booked twice';
  ---------------------------------------------------------------------------
  begin
    perform public.book_appointment(
      c_professional, c_service, v_slot, 'Race Contestant Two', '+1 809 555 1002'
    );
    raise exception 'FAIL: the second booking succeeded; double booking is possible';
  exception
    when sqlstate '23P01' then
      if sqlerrm <> 'SLOT_TAKEN' then
        raise exception 'FAIL: expected SLOT_TAKEN, got %', sqlerrm;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '3. an overlapping slot is refused even at a different start';
  ---------------------------------------------------------------------------
  begin
    -- 15:30 runs into the 15:00-15:50 range the first booking occupies.
    perform public.book_appointment(
      c_professional, c_service,
      (v_monday::timestamp + time '15:30') at time zone c_timezone,
      'Overlapper', '+1 809 555 1003'
    );
    raise exception 'FAIL: an overlapping booking succeeded';
  exception
    when sqlstate '23P01' then null;
  end;

  ---------------------------------------------------------------------------
  raise notice '4. a manual block is respected';
  ---------------------------------------------------------------------------
  begin
    perform public.book_appointment(
      c_professional, c_service,
      (v_monday::timestamp + time '17:00') at time zone c_timezone,
      'Blocked Out', '+1 809 555 1004'
    );
    raise exception 'FAIL: booked over a blocked time';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'SLOT_BLOCKED' then
        raise exception 'FAIL: expected SLOT_BLOCKED, got %', v_message;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '5. working hours are enforced server-side';
  ---------------------------------------------------------------------------
  begin
    perform public.book_appointment(
      c_professional, c_service,
      (v_monday::timestamp + time '03:00') at time zone c_timezone,
      'Night Owl', '+1 809 555 1005'
    );
    raise exception 'FAIL: booked outside working hours';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'OUTSIDE_AVAILABILITY' then
        raise exception 'FAIL: expected OUTSIDE_AVAILABILITY, got %', v_message;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '5b. a service that would overrun closing time is refused';
  ---------------------------------------------------------------------------
  begin
    -- 17:30 is inside 09:00-18:00, but a 45-minute service ends at 18:15.
    perform public.book_appointment(
      c_professional, c_service,
      (v_monday::timestamp + time '17:30') at time zone c_timezone,
      'Overrunner', '+1 809 555 1009'
    );
    raise exception 'FAIL: booked a service that does not fit before closing';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'OUTSIDE_AVAILABILITY' then
        raise exception 'FAIL: expected OUTSIDE_AVAILABILITY, got %', v_message;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '6. the booking horizon is enforced';
  ---------------------------------------------------------------------------
  begin
    perform public.book_appointment(
      c_professional, c_service,
      ((current_date + 120)::timestamp + time '10:00') at time zone c_timezone,
      'Far Future', '+1 809 555 1006'
    );
    raise exception 'FAIL: booked beyond the horizon';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'BEYOND_HORIZON' then
        raise exception 'FAIL: expected BEYOND_HORIZON, got %', v_message;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '7. minimum notice is enforced';
  ---------------------------------------------------------------------------
  begin
    perform public.book_appointment(
      c_professional, c_service, now() + interval '10 minutes',
      'Right Now', '+1 809 555 1007'
    );
    raise exception 'FAIL: booked inside the minimum notice window';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'TOO_SOON' then
        raise exception 'FAIL: expected TOO_SOON, got %', v_message;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '8. the availability context reports the booking as busy';
  ---------------------------------------------------------------------------
  v_result := public.get_availability_context(
    c_professional, c_service, v_monday, v_monday
  );

  if v_result ->> 'timezone' <> c_timezone then
    raise exception 'FAIL: expected timezone %, got %', c_timezone, v_result ->> 'timezone';
  end if;

  select count(*) into v_busy_count
  from jsonb_array_elements(v_result -> 'busy') as busy
  where (busy ->> 'startsAt')::timestamptz = v_slot;

  if v_busy_count <> 1 then
    raise exception 'FAIL: the booked slot is missing from the busy list';
  end if;

  if jsonb_array_length(v_result -> 'rules') = 0 then
    raise exception 'FAIL: no weekly rules returned';
  end if;

  ---------------------------------------------------------------------------
  raise notice '9. a guest can read their own appointment by token';
  ---------------------------------------------------------------------------
  v_result := public.get_appointment_by_token(v_appointment_id, v_token);
  if (v_result ->> 'canCancel')::boolean is not true then
    raise exception 'FAIL: a future appointment should be cancellable';
  end if;

  begin
    perform public.get_appointment_by_token(v_appointment_id, gen_random_uuid());
    raise exception 'FAIL: a wrong token returned an appointment';
  exception
    when sqlstate 'P0002' then null;
  end;

  ---------------------------------------------------------------------------
  raise notice '10. cancelling releases the slot';
  ---------------------------------------------------------------------------
  perform public.cancel_appointment_by_token(v_appointment_id, v_token, 'Testing');

  v_result := public.book_appointment(
    c_professional, c_service, v_slot, 'Second Chance', '+1 809 555 1008'
  );
  if (v_result ->> 'appointmentId') is null then
    raise exception 'FAIL: the released slot could not be rebooked';
  end if;

  ---------------------------------------------------------------------------
  raise notice '11. the same clock time is fine for a different professional';
  ---------------------------------------------------------------------------
  -- The exclusion constraint is scoped per professional. Two people in the
  -- same business must be able to work at the same time.
  insert into public.professional_profiles (id, business_id, user_id, display_name)
  values (
    '33333333-3333-4333-8333-999999999999',
    '22222222-2222-4222-8222-222222222222',
    null,
    'Second Chair'
  )
  on conflict (id) do nothing;

  insert into public.appointments (
    business_id, professional_id, customer_id, starts_at, ends_at, status
  )
  values (
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-999999999999',
    '55555555-5555-4555-8555-555555555555',
    v_slot,
    v_slot + interval '45 minutes',
    'confirmed'
  );

  -- ...while the same slot for the ORIGINAL professional is still refused.
  begin
    insert into public.appointments (
      business_id, professional_id, customer_id, starts_at, ends_at, status
    )
    values (
      '22222222-2222-4222-8222-222222222222',
      c_professional,
      '55555555-5555-4555-8555-555555555555',
      v_slot,
      v_slot + interval '45 minutes',
      'confirmed'
    );
    raise exception 'FAIL: the exclusion constraint did not stop a same-professional overlap';
  exception
    when exclusion_violation then null;
  end;

  raise notice 'core booking guarantees hold';
end;
$$;

-- ===========================================================================
-- 11. An anonymous caller may book only through the RPC.
--
-- The public booking page holds the anon key. It must be able to read
-- availability and create a booking through book_appointment, and must not be
-- able to write to any table directly.
-- ===========================================================================

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('role', 'anon')::text,
  true
);
set local role anon;

do $$
declare
  c_professional constant uuid := '33333333-3333-4333-8333-333333333333';
  c_service constant uuid := '44444444-4444-4444-8444-000000000002';
  c_business constant uuid := '22222222-2222-4222-8222-222222222222';
  v_context jsonb;
begin
  -- Allowed: read availability through the function.
  v_context := public.get_availability_context(
    c_professional, c_service, current_date, current_date + 7
  );
  if v_context is null then
    raise exception 'FAIL: anon cannot read availability through the RPC';
  end if;

  -- Refused: writing to any table directly.
  begin
    insert into public.appointments (
      business_id, professional_id, customer_id, starts_at, ends_at
    )
    values (
      c_business, c_professional, '55555555-5555-4555-8555-555555555555',
      now() + interval '10 days', now() + interval '10 days 45 minutes'
    );
    raise exception 'FAIL: anon inserted an appointment directly';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.customers (business_id, full_name, phone)
    values (c_business, 'Injected', '+1 809 555 9999');
    raise exception 'FAIL: anon inserted a customer directly';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.blocked_times (professional_id, starts_at, ends_at)
    values (c_professional, now() + interval '20 days', now() + interval '21 days');
    raise exception 'FAIL: anon blocked time directly';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.services set price = 0 where business_id = c_business;
    if found then
      raise exception 'FAIL: anon updated a service directly';
    end if;
  exception
    when insufficient_privilege then null;
  end;

  raise notice '12. anon reads availability through the RPC and cannot write directly';
end;
$$;

commit;


-- ===========================================================================
-- 13. A guest cannot reach hidden resources by supplying their identifiers.
--
-- book_appointment takes ids from an untrusted caller. It must derive the
-- business from the professional, refuse an unpublished one, and refuse a
-- service that the named professional does not actually offer.
-- ===========================================================================

do $$
declare
  c_demo_professional constant uuid := '33333333-3333-4333-8333-333333333333';
  c_demo_service constant uuid := '44444444-4444-4444-8444-000000000002';
  v_hidden_business uuid;
  v_hidden_professional uuid;
  v_hidden_service uuid;
  v_slot timestamptz := date_trunc('hour', now()) + interval '8 days 4 hours';
  v_message text;
begin
  -- A business that exists but was never published.
  insert into public.businesses (owner_user_id, name, slug, timezone, is_published)
  values (
    '11111111-1111-4111-8111-111111111111',
    'Hidden Studio', 'hidden-studio', 'America/Santo_Domingo', false
  )
  returning id into v_hidden_business;

  insert into public.professional_profiles (business_id, display_name)
  values (v_hidden_business, 'Hidden Pro')
  returning id into v_hidden_professional;

  insert into public.services (business_id, name, duration_minutes, price, currency)
  values (v_hidden_business, 'Hidden Service', 30, 500, 'DOP')
  returning id into v_hidden_service;

  insert into public.professional_services (professional_id, service_id)
  values (v_hidden_professional, v_hidden_service);

  insert into public.availability_rules (professional_id, weekday, start_time, end_time)
  select v_hidden_professional, d::smallint, time '00:00', time '23:59'
  from generate_series(0, 6) as d;

  -- The professional exists and is bookable, but the business is not public.
  begin
    perform public.book_appointment(
      v_hidden_professional, v_hidden_service, v_slot, 'Prober', '+1 809 555 2001'
    );
    raise exception 'FAIL: booked against an unpublished business';
  exception
    when sqlstate 'P0002' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'BUSINESS_NOT_PUBLIC' then
        raise exception 'FAIL: expected BUSINESS_NOT_PUBLIC, got %', v_message;
      end if;
  end;

  -- A published professional cannot be paired with another business's service.
  begin
    perform public.book_appointment(
      c_demo_professional, v_hidden_service, v_slot, 'Prober', '+1 809 555 2002'
    );
    raise exception 'FAIL: booked a service belonging to another business';
  exception
    when sqlstate 'P0002' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'SERVICE_NOT_AVAILABLE' then
        raise exception 'FAIL: expected SERVICE_NOT_AVAILABLE, got %', v_message;
      end if;
  end;

  -- ...and the hidden professional cannot borrow a published service either.
  begin
    perform public.book_appointment(
      v_hidden_professional, c_demo_service, v_slot, 'Prober', '+1 809 555 2003'
    );
    raise exception 'FAIL: booked a published service through a hidden professional';
  exception
    when sqlstate 'P0002' then null;
  end;

  -- A professional who has stopped accepting bookings is refused.
  update public.professional_profiles set is_bookable = false where id = c_demo_professional;
  begin
    perform public.book_appointment(
      c_demo_professional, c_demo_service, v_slot, 'Prober', '+1 809 555 2004'
    );
    raise exception 'FAIL: booked with a professional who is not accepting bookings';
  exception
    when sqlstate 'P0002' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'PROFESSIONAL_NOT_BOOKABLE' then
        raise exception 'FAIL: expected PROFESSIONAL_NOT_BOOKABLE, got %', v_message;
      end if;
  end;
  update public.professional_profiles set is_bookable = true where id = c_demo_professional;

  raise notice '13. supplied identifiers cannot reach hidden or mismatched resources';
end;
$$;

\echo 'All booking guarantees hold.'
