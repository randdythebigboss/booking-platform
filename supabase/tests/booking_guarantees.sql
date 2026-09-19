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

  raise notice 'All booking guarantees hold.';
end;
$$;
