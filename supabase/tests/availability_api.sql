-- ===========================================================================
-- public.get_available_slots - the authoritative availability API.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/availability_api.sql
--
-- Self-contained: it builds its own business so the expected slot lists are
-- exact and do not depend on what the other suites did first.
-- ===========================================================================

\set ON_ERROR_STOP on

-- A tiny, fully controlled tenant: Monday 09:00-12:00, 15-minute grid.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  '88888888-8888-4888-8888-888888888888',
  'authenticated', 'authenticated',
  'lab@bookingplatform.test',
  extensions.crypt('lab-password-123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Lab Owner"}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

insert into public.businesses (
  id, owner_user_id, name, slug, timezone, currency,
  slot_interval_minutes, minimum_notice_minutes, booking_horizon_days,
  auto_confirm_bookings, is_active, is_published
)
values (
  '99999999-9999-4999-8999-999999999999',
  '88888888-8888-4888-8888-888888888888',
  'Slot Lab', 'slot-lab', 'America/Santo_Domingo', 'DOP',
  15, 60, 60, true, true, true
);

insert into public.business_members (business_id, user_id, role)
values (
  '99999999-9999-4999-8999-999999999999',
  '88888888-8888-4888-8888-888888888888',
  'owner'
);

-- Two professionals, so "same time, different person" can be proved.
insert into public.professional_profiles (id, business_id, user_id, display_name)
values
  ('aaaaaaaa-0000-4000-8000-00000000000a',
   '99999999-9999-4999-8999-999999999999',
   '88888888-8888-4888-8888-888888888888', 'Lab Pro A'),
  ('aaaaaaaa-0000-4000-8000-00000000000b',
   '99999999-9999-4999-8999-999999999999', null, 'Lab Pro B');

insert into public.services (
  id, business_id, name, duration_minutes,
  buffer_before_minutes, buffer_after_minutes, price, currency, is_active
)
values
  ('bbbbbbbb-0000-4000-8000-000000000030',
   '99999999-9999-4999-8999-999999999999', 'Lab 30', 30, 0, 0, 100, 'DOP', true),
  ('bbbbbbbb-0000-4000-8000-000000000045',
   '99999999-9999-4999-8999-999999999999', 'Lab 45 buffered', 45, 0, 15, 100, 'DOP', true),
  ('bbbbbbbb-0000-4000-8000-0000000000ff',
   '99999999-9999-4999-8999-999999999999', 'Lab inactive', 30, 0, 0, 100, 'DOP', false),
  ('bbbbbbbb-0000-4000-8000-0000000000aa',
   '99999999-9999-4999-8999-999999999999', 'Lab unassigned', 30, 0, 0, 100, 'DOP', true);

-- Everything except "Lab unassigned" is offered by both professionals.
insert into public.professional_services (professional_id, service_id)
select p.id, s.id
from public.professional_profiles p
cross join public.services s
where p.business_id = '99999999-9999-4999-8999-999999999999'
  and s.business_id = '99999999-9999-4999-8999-999999999999'
  and s.id <> 'bbbbbbbb-0000-4000-8000-0000000000aa';

insert into public.availability_rules (professional_id, weekday, start_time, end_time)
select p.id, 1, time '09:00', time '12:00'
from public.professional_profiles p
where p.business_id = '99999999-9999-4999-8999-999999999999';

insert into public.customers (id, business_id, full_name, phone)
values (
  'cccccccc-0000-4000-8000-00000000000c',
  '99999999-9999-4999-8999-999999999999',
  'Lab Customer', '+1 809 555 7000'
);

do $$
declare
  c_business constant uuid := '99999999-9999-4999-8999-999999999999';
  c_pro_a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  c_pro_b constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000b';
  c_s30 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000030';
  c_s45 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000045';
  c_inactive constant uuid := 'bbbbbbbb-0000-4000-8000-0000000000ff';
  c_unassigned constant uuid := 'bbbbbbbb-0000-4000-8000-0000000000aa';
  c_customer constant uuid := 'cccccccc-0000-4000-8000-00000000000c';
  c_tz constant text := 'America/Santo_Domingo';

  v_days int;
  v_monday date;
  v_count int;
  v_first text;
  v_last text;
  v_appointment uuid;
begin
  -- A Monday three weeks out: inside the horizon, clear of "today".
  v_days := ((1 - extract(dow from current_date)::int + 7) % 7);
  if v_days = 0 then v_days := 7; end if;
  v_monday := current_date + v_days + 21;

  ---------------------------------------------------------------------------
  raise notice '1. standard slots are returned correctly';
  ---------------------------------------------------------------------------
  select count(*),
         min(to_char(starts_at at time zone c_tz, 'HH24:MI')),
         max(to_char(starts_at at time zone c_tz, 'HH24:MI'))
  into v_count, v_first, v_last
  from public.get_available_slots(c_pro_a, c_s30, v_monday);

  -- 09:00 to 11:30 on a 15-minute grid, last start that still finishes by 12:00.
  if v_count <> 11 or v_first <> '09:00' or v_last <> '11:30' then
    raise exception 'FAIL: expected 11 slots 09:00..11:30, got % (% .. %)', v_count, v_first, v_last;
  end if;

  ---------------------------------------------------------------------------
  raise notice '2. an existing appointment removes the slots it touches';
  ---------------------------------------------------------------------------
  insert into public.appointments (
    business_id, professional_id, customer_id, starts_at, ends_at, status
  )
  values (
    c_business, c_pro_a, c_customer,
    (v_monday::timestamp + time '10:00') at time zone c_tz,
    (v_monday::timestamp + time '10:30') at time zone c_tz,
    'confirmed'
  )
  returning id into v_appointment;

  select count(*) into v_count from public.get_available_slots(c_pro_a, c_s30, v_monday);
  if v_count <> 8 then
    raise exception 'FAIL: expected 8 slots around a 10:00-10:30 booking, got %', v_count;
  end if;

  if exists (
    select 1 from public.get_available_slots(c_pro_a, c_s30, v_monday)
    where to_char(starts_at at time zone c_tz, 'HH24:MI') in ('09:45', '10:00', '10:15')
  ) then
    raise exception 'FAIL: a slot overlapping the booking was still offered';
  end if;

  if not exists (
    select 1 from public.get_available_slots(c_pro_a, c_s30, v_monday)
    where to_char(starts_at at time zone c_tz, 'HH24:MI') = '10:30'
  ) then
    raise exception 'FAIL: the slot starting as the booking ends should be free';
  end if;

  ---------------------------------------------------------------------------
  raise notice '3. a cancelled appointment releases its slots';
  ---------------------------------------------------------------------------
  update public.appointments set status = 'cancelled', cancelled_at = now()
  where id = v_appointment;

  select count(*) into v_count from public.get_available_slots(c_pro_a, c_s30, v_monday);
  if v_count <> 11 then
    raise exception 'FAIL: cancelling did not release the slots, got %', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '4. a blocked period removes the slots it touches';
  ---------------------------------------------------------------------------
  insert into public.blocked_times (professional_id, starts_at, ends_at, reason)
  values (
    c_pro_a,
    (v_monday::timestamp + time '10:00') at time zone c_tz,
    (v_monday::timestamp + time '10:30') at time zone c_tz,
    'Lab block'
  );

  select count(*) into v_count from public.get_available_slots(c_pro_a, c_s30, v_monday);
  if v_count <> 8 then
    raise exception 'FAIL: expected 8 slots around a block, got %', v_count;
  end if;

  delete from public.blocked_times where professional_id = c_pro_a;

  raise notice '1-4 hold';
end;
$$;

do $$
declare
  c_business constant uuid := '99999999-9999-4999-8999-999999999999';
  c_pro_a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  c_pro_b constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000b';
  c_s30 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000030';
  c_s45 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000045';
  c_inactive constant uuid := 'bbbbbbbb-0000-4000-8000-0000000000ff';
  c_unassigned constant uuid := 'bbbbbbbb-0000-4000-8000-0000000000aa';
  c_foreign constant uuid := '44444444-4444-4444-8444-000000000002';
  c_customer constant uuid := 'cccccccc-0000-4000-8000-00000000000c';
  c_tz constant text := 'America/Santo_Domingo';

  v_days int;
  v_monday date;
  v_count int;
  v_appointment uuid;
begin
  v_days := ((1 - extract(dow from current_date)::int + 7) % 7);
  if v_days = 0 then v_days := 7; end if;
  v_monday := current_date + v_days + 21;

  ---------------------------------------------------------------------------
  raise notice '5. a full-day exception returns no slots at all';
  ---------------------------------------------------------------------------
  insert into public.availability_exceptions (professional_id, exception_date, exception_type, reason)
  values (c_pro_a, v_monday, 'unavailable', 'Closed');

  select count(*) into v_count from public.get_available_slots(c_pro_a, c_s30, v_monday);
  if v_count <> 0 then
    raise exception 'FAIL: a closed day still offered % slots', v_count;
  end if;
  delete from public.availability_exceptions where professional_id = c_pro_a;

  ---------------------------------------------------------------------------
  raise notice '6. custom hours replace the weekly schedule for that date';
  ---------------------------------------------------------------------------
  insert into public.availability_exceptions (
    professional_id, exception_date, exception_type, start_time, end_time, reason
  )
  values (c_pro_a, v_monday, 'available', time '14:00', time '16:00', 'Late shift');

  select count(*) into v_count from public.get_available_slots(c_pro_a, c_s30, v_monday);
  if v_count <> 7 then
    raise exception 'FAIL: expected 7 slots for 14:00-16:00, got %', v_count;
  end if;
  if exists (
    select 1 from public.get_available_slots(c_pro_a, c_s30, v_monday)
    where to_char(starts_at at time zone c_tz, 'HH24:MI') = '09:00'
  ) then
    raise exception 'FAIL: the normal morning hours survived a custom-hours exception';
  end if;
  delete from public.availability_exceptions where professional_id = c_pro_a;

  ---------------------------------------------------------------------------
  raise notice '7. service duration is respected';
  ---------------------------------------------------------------------------
  select count(*) into v_count from public.get_available_slots(c_pro_a, c_s45, v_monday);
  -- 45 minutes has to finish by 12:00, so the last start is 11:15.
  if v_count <> 10 then
    raise exception 'FAIL: expected 10 slots for a 45-minute service, got %', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '8. buffers are respected';
  ---------------------------------------------------------------------------
  insert into public.appointments (
    business_id, professional_id, customer_id, starts_at, ends_at, status
  )
  values (
    c_business, c_pro_a, c_customer,
    (v_monday::timestamp + time '10:00') at time zone c_tz,
    (v_monday::timestamp + time '10:30') at time zone c_tz,
    'confirmed'
  )
  returning id into v_appointment;

  -- Lab 45 carries a 15-minute trailing buffer, so 09:15 would run its buffer
  -- into the 10:00 booking while 09:00 stops exactly at it.
  if not exists (
    select 1 from public.get_available_slots(c_pro_a, c_s45, v_monday)
    where to_char(starts_at at time zone c_tz, 'HH24:MI') = '09:00'
  ) then
    raise exception 'FAIL: a slot whose buffer merely touches a booking was dropped';
  end if;
  if exists (
    select 1 from public.get_available_slots(c_pro_a, c_s45, v_monday)
    where to_char(starts_at at time zone c_tz, 'HH24:MI') = '09:15'
  ) then
    raise exception 'FAIL: a slot whose buffer overlaps a booking was offered';
  end if;

  ---------------------------------------------------------------------------
  raise notice '16. the same clock time stays free for another professional';
  ---------------------------------------------------------------------------
  if not exists (
    select 1 from public.get_available_slots(c_pro_b, c_s30, v_monday)
    where to_char(starts_at at time zone c_tz, 'HH24:MI') = '10:00'
  ) then
    raise exception 'FAIL: one professional being busy removed the time for another';
  end if;

  delete from public.appointments where id = v_appointment;

  raise notice '5-8 and 16 hold';
end;
$$;

do $$
declare
  c_business constant uuid := '99999999-9999-4999-8999-999999999999';
  c_pro_a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  c_s30 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000030';
  v_days int;
  v_monday date;
  v_count int;
begin
  v_days := ((1 - extract(dow from current_date)::int + 7) % 7);
  if v_days = 0 then v_days := 7; end if;
  v_monday := current_date + v_days + 21;

  ---------------------------------------------------------------------------
  raise notice '9. the slot interval is respected';
  ---------------------------------------------------------------------------
  update public.businesses set slot_interval_minutes = 30 where id = c_business;
  select count(*) into v_count from public.get_available_slots(c_pro_a, c_s30, v_monday);
  if v_count <> 6 then
    raise exception 'FAIL: expected 6 slots on a 30-minute grid, got %', v_count;
  end if;
  update public.businesses set slot_interval_minutes = 15 where id = c_business;

  ---------------------------------------------------------------------------
  raise notice '10. the booking horizon is respected';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.get_available_slots(c_pro_a, c_s30, (current_date + 400)::date);
  if v_count <> 0 then
    raise exception 'FAIL: a date beyond the horizon offered % slots', v_count;
  end if;

  select count(*) into v_count
  from public.get_available_slots(c_pro_a, c_s30, (current_date - 7)::date);
  if v_count <> 0 then
    raise exception 'FAIL: a date in the past offered % slots', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '11. minimum notice is respected';
  ---------------------------------------------------------------------------
  -- Ninety days of notice swallows a date three weeks out entirely.
  update public.businesses set minimum_notice_minutes = 60 * 24 * 90 where id = c_business;
  select count(*) into v_count from public.get_available_slots(c_pro_a, c_s30, v_monday);
  if v_count <> 0 then
    raise exception 'FAIL: minimum notice did not suppress the day, got % slots', v_count;
  end if;
  update public.businesses set minimum_notice_minutes = 60 where id = c_business;

  raise notice '9-11 hold';
end;
$$;

-- ---------------------------------------------------------------------------
-- The public boundary, exercised as a genuinely anonymous caller.
-- ---------------------------------------------------------------------------
begin;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
declare
  c_pro_a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  c_s30 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000030';
  c_inactive constant uuid := 'bbbbbbbb-0000-4000-8000-0000000000ff';
  c_unassigned constant uuid := 'bbbbbbbb-0000-4000-8000-0000000000aa';
  c_foreign constant uuid := '44444444-4444-4444-8444-000000000002';
  v_days int;
  v_monday date;
  v_count int;
begin
  v_days := ((1 - extract(dow from current_date)::int + 7) % 7);
  if v_days = 0 then v_days := 7; end if;
  v_monday := current_date + v_days + 21;

  -- An anonymous caller gets the ordinary answer for a published resource.
  select count(*) into v_count from public.get_available_slots(c_pro_a, c_s30, v_monday);
  if v_count <> 11 then
    raise exception 'FAIL: anon saw % slots, expected the usual 11', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '12. an inactive service exposes nothing';
  ---------------------------------------------------------------------------
  if (select count(*) from public.get_available_slots(c_pro_a, c_inactive, v_monday)) <> 0 then
    raise exception 'FAIL: an inactive service exposed availability';
  end if;

  ---------------------------------------------------------------------------
  raise notice '13. a service from another business exposes nothing';
  ---------------------------------------------------------------------------
  if (select count(*) from public.get_available_slots(c_pro_a, c_foreign, v_monday)) <> 0 then
    raise exception 'FAIL: a service from another business exposed availability';
  end if;

  ---------------------------------------------------------------------------
  raise notice '14. a service the professional does not offer exposes nothing';
  ---------------------------------------------------------------------------
  if (select count(*) from public.get_available_slots(c_pro_a, c_unassigned, v_monday)) <> 0 then
    raise exception 'FAIL: an unassigned service exposed availability';
  end if;

  -- The private tables behind all of this stay invisible.
  if (select count(*) from public.availability_rules) <> 0
     or (select count(*) from public.blocked_times) <> 0
     or (select count(*) from public.appointments) <> 0 then
    raise exception 'FAIL: anon can read the private schedule tables directly';
  end if;

  raise notice '12-14 hold, and the private tables stay invisible';
end;
$$;

commit;

-- ---------------------------------------------------------------------------
-- 15. A business that is not published exposes nothing, and neither does a
--     professional who has stopped accepting bookings.
-- ---------------------------------------------------------------------------
update public.businesses set is_published = false
where id = '99999999-9999-4999-8999-999999999999';

begin;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
declare
  v_days int;
  v_monday date;
begin
  v_days := ((1 - extract(dow from current_date)::int + 7) % 7);
  if v_days = 0 then v_days := 7; end if;
  v_monday := current_date + v_days + 21;

  if (select count(*) from public.get_available_slots(
        'aaaaaaaa-0000-4000-8000-00000000000a',
        'bbbbbbbb-0000-4000-8000-000000000030',
        v_monday)) <> 0 then
    raise exception 'FAIL: an unpublished business exposed availability anonymously';
  end if;

  raise notice '15. an unpublished business exposes nothing';
end;
$$;
commit;

update public.businesses set is_published = true
where id = '99999999-9999-4999-8999-999999999999';

do $$
declare
  c_pro_a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  c_s30 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000030';
  c_business constant uuid := '99999999-9999-4999-8999-999999999999';
  c_customer constant uuid := 'cccccccc-0000-4000-8000-00000000000c';
  c_tz constant text := 'America/Santo_Domingo';
  v_days int;
  v_monday date;
  v_appointment uuid;
  v_message text;
begin
  v_days := ((1 - extract(dow from current_date)::int + 7) % 7);
  if v_days = 0 then v_days := 7; end if;
  v_monday := current_date + v_days + 21;

  update public.professional_profiles set is_bookable = false where id = c_pro_a;
  if (select count(*) from public.get_available_slots(c_pro_a, c_s30, v_monday)) <> 0 then
    raise exception 'FAIL: a professional not accepting bookings exposed availability';
  end if;
  update public.professional_profiles set is_bookable = true where id = c_pro_a;

  ---------------------------------------------------------------------------
  raise notice '17. a block may not be dropped on top of a live appointment';
  ---------------------------------------------------------------------------
  insert into public.appointments (
    business_id, professional_id, customer_id, starts_at, ends_at, status
  )
  values (
    c_business, c_pro_a, c_customer,
    (v_monday::timestamp + time '10:00') at time zone c_tz,
    (v_monday::timestamp + time '10:30') at time zone c_tz,
    'confirmed'
  )
  returning id into v_appointment;

  begin
    insert into public.blocked_times (professional_id, starts_at, ends_at, reason)
    values (
      c_pro_a,
      (v_monday::timestamp + time '09:45') at time zone c_tz,
      (v_monday::timestamp + time '10:15') at time zone c_tz,
      'Should be refused'
    );
    raise exception 'FAIL: a block was created over a live appointment';
  exception
    when sqlstate '23P01' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'BLOCK_CONFLICTS_WITH_APPOINTMENT' then
        raise exception 'FAIL: expected BLOCK_CONFLICTS_WITH_APPOINTMENT, got %', v_message;
      end if;
  end;

  -- The appointment is untouched: nothing was cancelled on the customer.
  if (select status from public.appointments where id = v_appointment) <> 'confirmed' then
    raise exception 'FAIL: the appointment was altered by a rejected block';
  end if;

  -- A block that clears the appointment is still allowed.
  insert into public.blocked_times (professional_id, starts_at, ends_at, reason)
  values (
    c_pro_a,
    (v_monday::timestamp + time '11:00') at time zone c_tz,
    (v_monday::timestamp + time '11:30') at time zone c_tz,
    'Allowed'
  );

  raise notice '17. blocks never silently invalidate a booking';
end;
$$;

\echo 'Availability API holds.'
