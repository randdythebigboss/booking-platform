-- ===========================================================================
-- The guest booking path, exercised as an anonymous caller.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/public_booking.sql
--
-- Builds its own published and unpublished businesses so discovery can be
-- asserted by name rather than by counting whatever the other suites left.
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
  'dddddddd-0000-4000-8000-00000000000d',
  'authenticated', 'authenticated', 'shop@bookingplatform.test',
  extensions.crypt('shop-password-123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Shop Owner"}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

-- One published storefront, one that was never published.
insert into public.businesses (
  id, owner_user_id, name, slug, timezone, currency,
  slot_interval_minutes, minimum_notice_minutes, booking_horizon_days,
  auto_confirm_bookings, is_active, is_published
)
values
  ('eeeeeeee-0000-4000-8000-00000000000e', 'dddddddd-0000-4000-8000-00000000000d',
   'Open Studio', 'open-studio', 'America/Santo_Domingo', 'DOP', 15, 60, 60, true, true, true),
  ('ffffffff-0000-4000-8000-00000000000f', 'dddddddd-0000-4000-8000-00000000000d',
   'Secret Studio', 'secret-studio', 'America/Santo_Domingo', 'DOP', 15, 60, 60, true, true, false);

insert into public.business_members (business_id, user_id, role)
values
  ('eeeeeeee-0000-4000-8000-00000000000e', 'dddddddd-0000-4000-8000-00000000000d', 'owner'),
  ('ffffffff-0000-4000-8000-00000000000f', 'dddddddd-0000-4000-8000-00000000000d', 'owner');

insert into public.professional_profiles (id, business_id, user_id, display_name)
values
  ('11110000-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-00000000000e',
   'dddddddd-0000-4000-8000-00000000000d', 'Open Pro'),
  ('11110000-0000-4000-8000-000000000002', 'ffffffff-0000-4000-8000-00000000000f',
   null, 'Secret Pro');

insert into public.services (
  id, business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes,
  price, currency, is_active
)
values
  ('22220000-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-00000000000e',
   'Open Service', 30, 0, 0, 500, 'DOP', true),
  ('22220000-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-00000000000e',
   'Retired Service', 30, 0, 0, 500, 'DOP', false),
  ('22220000-0000-4000-8000-000000000003', 'ffffffff-0000-4000-8000-00000000000f',
   'Secret Service', 30, 0, 0, 500, 'DOP', true);

insert into public.professional_services (professional_id, service_id)
values
  ('11110000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000001'),
  ('11110000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000002'),
  ('11110000-0000-4000-8000-000000000002', '22220000-0000-4000-8000-000000000003');

insert into public.availability_rules (professional_id, weekday, start_time, end_time)
select p.id, d::smallint, time '09:00', time '17:00'
from public.professional_profiles p
cross join generate_series(0, 6) as d
where p.id in ('11110000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- Everything a customer does, done as a customer: no session, no account.
-- ---------------------------------------------------------------------------
begin;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
declare
  c_open_pro constant uuid := '11110000-0000-4000-8000-000000000001';
  c_secret_pro constant uuid := '11110000-0000-4000-8000-000000000002';
  c_open_service constant uuid := '22220000-0000-4000-8000-000000000001';
  c_retired constant uuid := '22220000-0000-4000-8000-000000000002';
  c_secret_service constant uuid := '22220000-0000-4000-8000-000000000003';
  c_tz constant text := 'America/Santo_Domingo';

  v_date date := (current_date + 5);
  v_slot timestamptz;
  v_result jsonb;
  v_second jsonb;
  v_token uuid;
  v_appointment uuid;
  v_message text;
begin
  ---------------------------------------------------------------------------
  raise notice '1. a published business and its professional are discoverable';
  ---------------------------------------------------------------------------
  if not exists (select 1 from public.businesses where slug = 'open-studio') then
    raise exception 'FAIL: a published business is not discoverable anonymously';
  end if;
  if not exists (select 1 from public.professional_profiles where display_name = 'Open Pro') then
    raise exception 'FAIL: a bookable professional of a published business is hidden';
  end if;

  ---------------------------------------------------------------------------
  raise notice '2. an unpublished business and its professional are not';
  ---------------------------------------------------------------------------
  if exists (select 1 from public.businesses where slug = 'secret-studio') then
    raise exception 'FAIL: an unpublished business is discoverable anonymously';
  end if;
  if exists (select 1 from public.professional_profiles where display_name = 'Secret Pro') then
    raise exception 'FAIL: a professional inside an unpublished business is visible';
  end if;

  ---------------------------------------------------------------------------
  raise notice '3. only active services are offered';
  ---------------------------------------------------------------------------
  if not exists (select 1 from public.services where id = c_open_service) then
    raise exception 'FAIL: an active service of a published business is hidden';
  end if;
  if exists (select 1 from public.services where id = c_retired) then
    raise exception 'FAIL: a retired service is still visible';
  end if;
  if exists (select 1 from public.services where id = c_secret_service) then
    raise exception 'FAIL: a service of an unpublished business is visible';
  end if;

  ---------------------------------------------------------------------------
  raise notice '4. availability can be read anonymously';
  ---------------------------------------------------------------------------
  select min(starts_at) into v_slot
  from public.get_available_slots(c_open_pro, c_open_service, v_date);

  if v_slot is null then
    raise exception 'FAIL: no availability offered to an anonymous caller';
  end if;

  ---------------------------------------------------------------------------
  raise notice '5. a guest booking succeeds without any account';
  ---------------------------------------------------------------------------
  v_result := public.book_appointment(
    c_open_pro, c_open_service, v_slot, 'Guest One', '+1 809 555 6001', 'guest1@example.test'
  );
  v_appointment := (v_result ->> 'appointmentId')::uuid;
  v_token := (v_result ->> 'accessToken')::uuid;

  if v_appointment is null or v_token is null then
    raise exception 'FAIL: booking returned no appointment or no token';
  end if;

  ---------------------------------------------------------------------------
  raise notice '6. a service that professional does not offer is refused';
  ---------------------------------------------------------------------------
  begin
    perform public.book_appointment(
      c_open_pro, c_secret_service, v_slot + interval '1 hour',
      'Guest Two', '+1 809 555 6002'
    );
    raise exception 'FAIL: booked a service belonging to another business';
  exception
    when sqlstate 'PT404' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'SERVICE_NOT_AVAILABLE' then
        raise exception 'FAIL: expected SERVICE_NOT_AVAILABLE, got %', v_message;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '7. booking against an unpublished business is refused';
  ---------------------------------------------------------------------------
  begin
    perform public.book_appointment(
      c_secret_pro, c_secret_service, v_slot + interval '1 hour',
      'Guest Three', '+1 809 555 6003'
    );
    raise exception 'FAIL: booked against an unpublished business';
  exception
    when sqlstate 'PT404' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'BUSINESS_NOT_PUBLIC' then
        raise exception 'FAIL: expected BUSINESS_NOT_PUBLIC, got %', v_message;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '8. two guests racing for one time produce one winner';
  ---------------------------------------------------------------------------
  begin
    perform public.book_appointment(
      c_open_pro, c_open_service, v_slot, 'Guest Four', '+1 809 555 6004'
    );
    raise exception 'FAIL: the same time was booked twice';
  exception
    when sqlstate '23P01' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'SLOT_TAKEN' then
        raise exception 'FAIL: expected SLOT_TAKEN, got %', v_message;
      end if;
  end;

  if exists (
    select 1 from public.get_available_slots(c_open_pro, c_open_service, v_date)
    where starts_at = v_slot
  ) then
    raise exception 'FAIL: a booked time is still being offered';
  end if;

  ---------------------------------------------------------------------------
  raise notice '9. cancelling releases the time again';
  ---------------------------------------------------------------------------
  perform public.cancel_appointment_by_token(v_appointment, v_token, 'Changed my mind');

  if not exists (
    select 1 from public.get_available_slots(c_open_pro, c_open_service, v_date)
    where starts_at = v_slot
  ) then
    raise exception 'FAIL: cancelling did not release the time';
  end if;

  raise notice '1-9 hold';
end;
$$;

commit;

-- ---------------------------------------------------------------------------
-- Two guests, two tokens, and no way to reach across.
-- ---------------------------------------------------------------------------
begin;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
declare
  c_open_pro constant uuid := '11110000-0000-4000-8000-000000000001';
  c_open_service constant uuid := '22220000-0000-4000-8000-000000000001';

  v_date date := (current_date + 6);
  v_slots timestamptz[];
  v_first jsonb;
  v_second jsonb;
  v_first_id uuid;
  v_second_id uuid;
  v_first_token uuid;
  v_second_token uuid;
  v_result jsonb;
begin
  select array_agg(starts_at order by starts_at) into v_slots
  from public.get_available_slots(c_open_pro, c_open_service, v_date);

  if coalesce(array_length(v_slots, 1), 0) < 3 then
    raise exception 'FAIL: not enough availability to run the two-guest checks';
  end if;

  v_first := public.book_appointment(
    c_open_pro, c_open_service, v_slots[1], 'Guest Five', '+1 809 555 6005'
  );
  -- A 30-minute service on a 15-minute grid means consecutive slots overlap,
  -- so the second guest takes the one after next.
  v_second := public.book_appointment(
    c_open_pro, c_open_service, v_slots[3], 'Guest Six', '+1 809 555 6006'
  );

  v_first_id := (v_first ->> 'appointmentId')::uuid;
  v_second_id := (v_second ->> 'appointmentId')::uuid;
  v_first_token := (v_first ->> 'accessToken')::uuid;
  v_second_token := (v_second ->> 'accessToken')::uuid;

  ---------------------------------------------------------------------------
  raise notice '10. a token retrieves exactly its own appointment';
  ---------------------------------------------------------------------------
  v_result := public.get_appointment_by_token(v_first_id, v_first_token);
  if (v_result ->> 'appointmentId')::uuid <> v_first_id then
    raise exception 'FAIL: the token returned a different appointment';
  end if;
  if (v_result ->> 'customerName') <> 'Guest Five' then
    raise exception 'FAIL: the token returned another customer';
  end if;

  ---------------------------------------------------------------------------
  raise notice '11. an invalid token retrieves nothing';
  ---------------------------------------------------------------------------
  begin
    perform public.get_appointment_by_token(v_first_id, gen_random_uuid());
    raise exception 'FAIL: a random token opened an appointment';
  exception
    when sqlstate 'PT404' then null;
  end;

  ---------------------------------------------------------------------------
  raise notice '12. one guest cannot reach another guest''s appointment';
  ---------------------------------------------------------------------------
  begin
    perform public.get_appointment_by_token(v_second_id, v_first_token);
    raise exception 'FAIL: one guest read another guest''s appointment';
  exception
    when sqlstate 'PT404' then null;
  end;

  begin
    perform public.cancel_appointment_by_token(v_second_id, v_first_token, 'Not mine');
    raise exception 'FAIL: one guest cancelled another guest''s appointment';
  exception
    when sqlstate 'PT404' then null;
  end;

  ---------------------------------------------------------------------------
  raise notice '13-14. the customer and appointment tables stay private';
  ---------------------------------------------------------------------------
  if (select count(*) from public.customers) <> 0 then
    raise exception 'FAIL: anon can read customer records';
  end if;
  if (select count(*) from public.appointments) <> 0 then
    raise exception 'FAIL: anon can read appointments';
  end if;
  if (select count(*) from public.appointment_items) <> 0 then
    raise exception 'FAIL: anon can read appointment items';
  end if;

  raise notice '10-14 hold';
end;
$$;

commit;

-- ---------------------------------------------------------------------------
-- The professional sees the booking; nobody else does.
-- ---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'dddddddd-0000-4000-8000-00000000000d', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_row record;
begin
  select a.id, a.status, c.full_name, c.phone, i.service_name_snapshot, i.duration_minutes_snapshot
  into v_row
  from public.appointments a
  join public.customers c on c.id = a.customer_id
  left join public.appointment_items i on i.appointment_id = a.id
  where c.phone = '+1 809 555 6005';

  if not found then
    raise exception 'FAIL: the professional cannot see the booking a guest just made';
  end if;
  if v_row.full_name <> 'Guest Five' then
    raise exception 'FAIL: the appointment carries the wrong customer';
  end if;
  if v_row.service_name_snapshot <> 'Open Service' or v_row.duration_minutes_snapshot <> 30 then
    raise exception 'FAIL: the service snapshot is wrong';
  end if;

  raise notice '15. the professional sees the guest booking, with the right customer and snapshot';
end;
$$;

commit;

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
begin
  if exists (
    select 1 from public.customers where phone = '+1 809 555 6005'
  ) then
    raise exception 'FAIL: another tenant can see the customer';
  end if;

  if exists (
    select 1 from public.businesses where slug = 'open-studio' and not is_published
  ) then
    raise exception 'FAIL: unexpected visibility of another business';
  end if;

  raise notice '16. another tenant sees neither the booking nor its customer';
end;
$$;

commit;


-- ---------------------------------------------------------------------------
-- 17. An anonymous caller cannot even reach the professional write RPCs.
-- ---------------------------------------------------------------------------
begin;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
begin
  begin
    perform public.create_business('Drive By', 'drive-by', 'UTC', 'Nobody');
    raise exception 'FAIL: anon can call create_business';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.save_service('eeeeeeee-0000-4000-8000-00000000000e', 'Injected', 30, 0);
    raise exception 'FAIL: anon can call save_service';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.set_weekly_schedule(
      '11110000-0000-4000-8000-000000000001',
      '[{"weekday":1,"startTime":"00:00","endTime":"23:00"}]'::jsonb
    );
    raise exception 'FAIL: anon can call set_weekly_schedule';
  exception
    when insufficient_privilege then null;
  end;

  -- ...while the public catalogue still works, which is what the read helpers
  -- keep their grant for.
  if not exists (select 1 from public.businesses where slug = 'open-studio') then
    raise exception 'FAIL: locking the write RPCs broke anonymous browsing';
  end if;
  if not exists (select 1 from public.services where id = '22220000-0000-4000-8000-000000000001') then
    raise exception 'FAIL: locking the write RPCs broke the public service list';
  end if;

  raise notice '17. professional write RPCs are unreachable anonymously';
end;
$$;

commit;

\echo 'Public booking holds.'
