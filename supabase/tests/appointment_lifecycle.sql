-- ===========================================================================
-- Phase 5 - rescheduling, manual booking, and the history that records both.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/appointment_lifecycle.sql
--
-- The invariant this suite exists for: an appointment that fails to move
-- still holds the time it had. Everything else is a way of approaching that
-- from a different direction.
-- ===========================================================================

\set ON_ERROR_STOP on

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('00000000-0000-0000-0000-000000000000', 'a9990000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'move@bookingplatform.test',
   extensions.crypt('move-password-123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Move Owner"}'::jsonb, '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'b9990000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'rivalmove@bookingplatform.test',
   extensions.crypt('rival-password-123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Rival Owner"}'::jsonb, '', '', '', '')
on conflict (id) do nothing;

-- Santo Domingo never changes its clocks, which is why it is the default
-- everywhere else in this project. New York does, which is why it is here.
insert into public.businesses (
  id, owner_user_id, name, slug, timezone, currency,
  slot_interval_minutes, minimum_notice_minutes, booking_horizon_days,
  auto_confirm_bookings, is_active, is_published
)
values
  ('a9990000-0000-4000-8000-000000000001', 'a9990000-0000-4000-8000-0000000000a1',
   'Move Studio', 'move-studio', 'America/Santo_Domingo', 'DOP', 15, 60, 60,
   true, true, true),
  ('b9990000-0000-4000-8000-000000000001', 'b9990000-0000-4000-8000-0000000000a1',
   'Rival Move Studio', 'rival-move-studio', 'America/Santo_Domingo', 'DOP', 15, 60, 60,
   true, true, true),
  ('c9990000-0000-4000-8000-000000000001', 'a9990000-0000-4000-8000-0000000000a1',
   'Clock Change Studio', 'clock-change-studio', 'America/New_York', 'USD', 15, 60, 365,
   true, true, true);

insert into public.business_members (business_id, user_id, role)
values
  ('a9990000-0000-4000-8000-000000000001', 'a9990000-0000-4000-8000-0000000000a1', 'owner'),
  ('b9990000-0000-4000-8000-000000000001', 'b9990000-0000-4000-8000-0000000000a1', 'owner'),
  ('c9990000-0000-4000-8000-000000000001', 'a9990000-0000-4000-8000-0000000000a1', 'owner');

insert into public.professional_profiles (id, business_id, user_id, display_name)
values
  ('a9990000-0000-4000-8000-0000000000b1', 'a9990000-0000-4000-8000-000000000001',
   'a9990000-0000-4000-8000-0000000000a1', 'Move Pro'),
  ('b9990000-0000-4000-8000-0000000000b1', 'b9990000-0000-4000-8000-000000000001',
   'b9990000-0000-4000-8000-0000000000a1', 'Rival Pro'),
  ('c9990000-0000-4000-8000-0000000000b1', 'c9990000-0000-4000-8000-000000000001',
   'a9990000-0000-4000-8000-0000000000a1', 'Clock Pro');

insert into public.services (
  id, business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes,
  price, currency, is_active
)
values
  ('a9990000-0000-4000-8000-0000000000c1', 'a9990000-0000-4000-8000-000000000001',
   'Move Service', 45, 0, 0, 1200, 'DOP', true),
  ('b9990000-0000-4000-8000-0000000000c1', 'b9990000-0000-4000-8000-000000000001',
   'Rival Service', 30, 0, 0, 800, 'DOP', true),
  ('c9990000-0000-4000-8000-0000000000c1', 'c9990000-0000-4000-8000-000000000001',
   'Clock Service', 60, 0, 0, 90, 'USD', true);

insert into public.professional_services (professional_id, service_id)
values
  ('a9990000-0000-4000-8000-0000000000b1', 'a9990000-0000-4000-8000-0000000000c1'),
  ('b9990000-0000-4000-8000-0000000000b1', 'b9990000-0000-4000-8000-0000000000c1'),
  ('c9990000-0000-4000-8000-0000000000b1', 'c9990000-0000-4000-8000-0000000000c1');

insert into public.availability_rules (professional_id, weekday, start_time, end_time)
select p, d::smallint, time '09:00', time '17:00'
from generate_series(0, 6) as d
cross join (values
  ('a9990000-0000-4000-8000-0000000000b1'::uuid),
  ('b9990000-0000-4000-8000-0000000000b1'::uuid),
  ('c9990000-0000-4000-8000-0000000000b1'::uuid)
) as pros(p);

-- ===========================================================================
-- A guest books, moves and cancels, using only the link they were given.
--
-- The guest's assertions are made through get_appointment_by_token, because
-- that is genuinely all a guest can see: the appointments table is invisible
-- to anon, so reading it here would assert nothing at all. History is checked
-- afterwards, by the business, for the same reason.
-- ===========================================================================
begin;

create temp table t5_guest (
  appointment_id uuid,
  access_token uuid,
  other_id uuid,
  first_at timestamptz,
  second_at timestamptz,
  third_at timestamptz,
  on_date date
);

-- The temp schema has a generated name, so it has to be looked up to be granted.
do $grants$
begin
  execute format(
    'grant usage on schema %I to anon, authenticated',
    (select nspname from pg_namespace where oid = pg_my_temp_schema())
  );
end;
$grants$;

grant insert, select on t5_guest to anon, authenticated;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
declare
  c_pro constant uuid := 'a9990000-0000-4000-8000-0000000000b1';
  c_service constant uuid := 'a9990000-0000-4000-8000-0000000000c1';
  c_tz constant text := 'America/Santo_Domingo';
  v_date date := ((now() at time zone c_tz)::date + 4);
  v_first timestamptz;
  v_second timestamptz;
  v_third timestamptz;
  v_booking jsonb;
  v_other jsonb;
  v_seen jsonb;
  v_id uuid;
  v_token uuid;
  v_message text;
  v_count integer;
  v_result jsonb;
begin
  v_first := (v_date::timestamp + time '10:00') at time zone c_tz;
  v_second := (v_date::timestamp + time '13:00') at time zone c_tz;
  v_third := (v_date::timestamp + time '15:00') at time zone c_tz;

  v_booking := public.book_appointment(
    c_pro, c_service, v_first, 'Move Guest', '+1 809 555 9101', 'moveguest@example.test'
  );
  v_id := (v_booking ->> 'appointmentId')::uuid;
  v_token := (v_booking ->> 'accessToken')::uuid;

  ---------------------------------------------------------------------------
  raise notice '1. the booked time stops being offered';
  ---------------------------------------------------------------------------
  if exists (
    select 1 from public.get_available_slots(c_pro, c_service, v_date)
    where starts_at = v_first
  ) then
    raise exception 'FAIL: a booked time is still being offered';
  end if;

  ---------------------------------------------------------------------------
  raise notice '2. a guest holding the link moves their own appointment';
  ---------------------------------------------------------------------------
  v_result := public.reschedule_appointment_by_token(v_id, v_token, v_second);

  if (v_result ->> 'moved')::boolean is not true then
    raise exception 'FAIL: the move reported nothing moved';
  end if;

  v_seen := public.get_appointment_by_token(v_id, v_token);
  if (v_seen ->> 'startsAt')::timestamptz <> v_second then
    raise exception 'FAIL: the guest is still shown %, not the new time',
      v_seen ->> 'startsAt';
  end if;

  ---------------------------------------------------------------------------
  raise notice '3. moving it does not change what it is';
  ---------------------------------------------------------------------------
  if (v_seen ->> 'status') <> 'confirmed' then
    raise exception 'FAIL: moving an appointment changed its status to %',
      v_seen ->> 'status';
  end if;

  ---------------------------------------------------------------------------
  raise notice '4. the old time is offered again, and the new one is not';
  ---------------------------------------------------------------------------
  if not exists (
    select 1 from public.get_available_slots(c_pro, c_service, v_date)
    where starts_at = v_first
  ) then
    raise exception 'FAIL: the time the appointment left is still being withheld';
  end if;

  if exists (
    select 1 from public.get_available_slots(c_pro, c_service, v_date)
    where starts_at = v_second
  ) then
    raise exception 'FAIL: the time the appointment moved to is still being offered';
  end if;

  ---------------------------------------------------------------------------
  raise notice '5. a failed move leaves the appointment exactly where it was';
  ---------------------------------------------------------------------------
  -- Somebody else takes the time this guest was about to choose.
  v_other := public.book_appointment(
    c_pro, c_service, v_third, 'Faster Guest', '+1 809 555 9102'
  );

  begin
    perform public.reschedule_appointment_by_token(v_id, v_token, v_third);
    raise exception 'FAIL: two appointments were allowed to hold one time';
  exception
    when sqlstate '23P01' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'SLOT_TAKEN' then
        raise exception 'FAIL: expected SLOT_TAKEN, got %', v_message;
      end if;
  end;

  if (public.get_appointment_by_token(v_id, v_token) ->> 'startsAt')::timestamptz <> v_second then
    raise exception 'FAIL: a lost race moved the appointment anyway';
  end if;

  if exists (
    select 1 from public.get_available_slots(c_pro, c_service, v_date)
    where starts_at = v_second
  ) then
    raise exception 'FAIL: the original time was released even though the move failed';
  end if;

  ---------------------------------------------------------------------------
  raise notice '6. the wrong token moves nothing, and says nothing';
  ---------------------------------------------------------------------------
  begin
    perform public.reschedule_appointment_by_token(v_id, gen_random_uuid(), v_first);
    raise exception 'FAIL: an appointment moved without its token';
  exception
    when sqlstate 'PT404' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'APPOINTMENT_NOT_FOUND' then
        raise exception 'FAIL: expected APPOINTMENT_NOT_FOUND, got %', v_message;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '7. one guest cannot move another guest''s appointment';
  ---------------------------------------------------------------------------
  begin
    perform public.reschedule_appointment_by_token(
      (v_other ->> 'appointmentId')::uuid, v_token, v_first
    );
    raise exception 'FAIL: a token opened somebody else''s appointment';
  exception
    when sqlstate 'PT404' then null;
  end;

  if (public.get_appointment_by_token(
        (v_other ->> 'appointmentId')::uuid, (v_other ->> 'accessToken')::uuid
      ) ->> 'startsAt')::timestamptz <> v_third then
    raise exception 'FAIL: the other guest''s appointment was moved by a stranger';
  end if;

  ---------------------------------------------------------------------------
  raise notice '8. the guest is held to the published grid, notice and horizon';
  ---------------------------------------------------------------------------
  begin
    perform public.reschedule_appointment_by_token(
      v_id, v_token, (v_date::timestamp + time '10:07') at time zone c_tz
    );
    raise exception 'FAIL: a guest moved an appointment off the published grid';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'SLOT_NOT_ALIGNED' then
        raise exception 'FAIL: expected SLOT_NOT_ALIGNED, got %', v_message;
      end if;
  end;

  begin
    perform public.reschedule_appointment_by_token(
      v_id, v_token, (v_date::timestamp + time '19:00') at time zone c_tz
    );
    raise exception 'FAIL: a guest moved an appointment outside working hours';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'OUTSIDE_AVAILABILITY' then
        raise exception 'FAIL: expected OUTSIDE_AVAILABILITY, got %', v_message;
      end if;
  end;

  begin
    perform public.reschedule_appointment_by_token(v_id, v_token, now() + interval '5 minutes');
    raise exception 'FAIL: a guest moved an appointment inside the notice period';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message not in ('TOO_SOON', 'OUTSIDE_AVAILABILITY', 'SLOT_NOT_ALIGNED') then
        raise exception 'FAIL: expected the notice period to be enforced, got %', v_message;
      end if;
  end;

  begin
    perform public.reschedule_appointment_by_token(
      v_id, v_token, ((v_date + 200)::timestamp + time '10:00') at time zone c_tz
    );
    raise exception 'FAIL: a guest moved an appointment beyond the booking horizon';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'BEYOND_HORIZON' then
        raise exception 'FAIL: expected BEYOND_HORIZON, got %', v_message;
      end if;
  end;

  -- Every refusal above must have left the appointment untouched.
  if (public.get_appointment_by_token(v_id, v_token) ->> 'startsAt')::timestamptz <> v_second then
    raise exception 'FAIL: a refused move moved the appointment anyway';
  end if;

  ---------------------------------------------------------------------------
  raise notice '9. cancelling frees the time';
  ---------------------------------------------------------------------------
  perform public.cancel_appointment_by_token(v_id, v_token, 'Something came up');

  if (public.get_appointment_by_token(v_id, v_token) ->> 'status') <> 'cancelled' then
    raise exception 'FAIL: the appointment was not cancelled';
  end if;

  if not exists (
    select 1 from public.get_available_slots(c_pro, c_service, v_date)
    where starts_at = v_second
  ) then
    raise exception 'FAIL: a cancelled appointment is still holding its time';
  end if;

  ---------------------------------------------------------------------------
  raise notice '10. a cancelled appointment cannot be moved back into existence';
  ---------------------------------------------------------------------------
  begin
    perform public.reschedule_appointment_by_token(v_id, v_token, v_first);
    raise exception 'FAIL: a cancelled appointment was rescheduled';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'APPOINTMENT_NOT_RESCHEDULABLE' then
        raise exception 'FAIL: expected APPOINTMENT_NOT_RESCHEDULABLE, got %', v_message;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '11. a stranger reads no history and calls no professional operation';
  ---------------------------------------------------------------------------
  -- Several events certainly exist by now; a guest sees none of them.
  select count(*) into v_count from public.appointment_events;
  if v_count <> 0 then
    raise exception 'FAIL: anon can read % appointment history rows', v_count;
  end if;

  begin
    perform public.reschedule_appointment(v_id, v_first);
    raise exception 'FAIL: anon called the professional reschedule';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.create_manual_appointment(
      c_pro, c_service, v_first, 'Walk In', '+1 809 555 9199'
    );
    raise exception 'FAIL: anon called the professional manual booking';
  exception
    when insufficient_privilege then null;
  end;

  insert into t5_guest (
    appointment_id, access_token, other_id, first_at, second_at, third_at, on_date
  )
  values (v_id, v_token, (v_other ->> 'appointmentId')::uuid, v_first, v_second, v_third, v_date);

  raise notice '1-11 hold';
end;
$$;

-- ---------------------------------------------------------------------------
-- The same story, now read from the business's side of the counter.
-- ---------------------------------------------------------------------------
reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a9990000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_ctx t5_guest;
  v_count integer;
begin
  select * into v_ctx from t5_guest;

  ---------------------------------------------------------------------------
  raise notice '12. the booking was recorded, and attributed to the guest';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.appointment_events e
  where e.appointment_id = v_ctx.appointment_id
    and e.event_type = 'created'
    and e.actor_type = 'guest'
    and e.changed_by_user_id is null
    and e.new_starts_at = v_ctx.first_at;

  if v_count <> 1 then
    raise exception 'FAIL: expected exactly one guest "created" event, found %', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '13. the move was recorded, once, with where it came from';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.appointment_events e
  where e.appointment_id = v_ctx.appointment_id
    and e.event_type = 'rescheduled';

  if v_count <> 1 then
    raise exception 'FAIL: expected one reschedule event, found % -- a refused move was written to history', v_count;
  end if;

  select count(*) into v_count
  from public.appointment_events e
  where e.appointment_id = v_ctx.appointment_id
    and e.event_type = 'rescheduled'
    and e.actor_type = 'guest'
    and e.changed_by_user_id is null
    and e.previous_starts_at = v_ctx.first_at
    and e.new_starts_at = v_ctx.second_at;

  if v_count <> 1 then
    raise exception 'FAIL: the reschedule event does not describe the move that happened';
  end if;

  ---------------------------------------------------------------------------
  raise notice '14. the cancellation carries its reason and its actor';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.appointment_events e
  where e.appointment_id = v_ctx.appointment_id
    and e.event_type = 'status_changed'
    and e.actor_type = 'guest'
    and e.previous_status = 'confirmed'
    and e.new_status = 'cancelled'
    and e.reason = 'Something came up';

  if v_count <> 1 then
    raise exception 'FAIL: the guest cancellation was not recorded as one guest event';
  end if;

  ---------------------------------------------------------------------------
  raise notice '15. the whole story is three events, in the order it happened';
  ---------------------------------------------------------------------------
  if (
    select string_agg(e.event_type::text, ' -> ' order by e.occurred_at)
    from public.appointment_events e
    where e.appointment_id = v_ctx.appointment_id
  ) <> 'created -> rescheduled -> status_changed' then
    raise exception 'FAIL: the history does not read as created -> rescheduled -> cancelled: %',
      (select string_agg(e.event_type::text, ' -> ' order by e.occurred_at)
       from public.appointment_events e
       where e.appointment_id = v_ctx.appointment_id);
  end if;

  raise notice '12-15 hold';
end;
$$;

rollback;

-- ===========================================================================
-- The professional, moving their own book around.
-- ===========================================================================
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a9990000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  c_pro constant uuid := 'a9990000-0000-4000-8000-0000000000b1';
  c_service constant uuid := 'a9990000-0000-4000-8000-0000000000c1';
  c_tz constant text := 'America/Santo_Domingo';
  v_date date := ((now() at time zone c_tz)::date + 5);
  v_ten timestamptz;
  v_eleven timestamptz;
  v_two timestamptz;
  v_created jsonb;
  v_id uuid;
  v_rival_id uuid;
  v_message text;
  v_count integer;
  v_customer uuid;
  v_second_customer uuid;
begin
  v_ten := (v_date::timestamp + time '10:00') at time zone c_tz;
  v_eleven := (v_date::timestamp + time '11:00') at time zone c_tz;
  v_two := (v_date::timestamp + time '14:00') at time zone c_tz;

  ---------------------------------------------------------------------------
  raise notice '16. a manual booking is confirmed on arrival and marked as manual';
  ---------------------------------------------------------------------------
  v_created := public.create_manual_appointment(
    c_pro, c_service, v_ten, 'Phone Customer', '+1 809 555 9201',
    'phone@example.test', 'Called in'
  );
  v_id := (v_created ->> 'appointmentId')::uuid;

  if (v_created ->> 'status') <> 'confirmed' then
    raise exception 'FAIL: a manual booking arrived as %, not confirmed', v_created ->> 'status';
  end if;

  if (select source from public.appointments where id = v_id) <> 'manual' then
    raise exception 'FAIL: a manual booking was not recorded as manual';
  end if;

  select count(*) into v_count
  from public.appointment_events e
  where e.appointment_id = v_id
    and e.event_type = 'created'
    and e.actor_type = 'professional'
    and e.changed_by_user_id = 'a9990000-0000-4000-8000-0000000000a1';

  if v_count <> 1 then
    raise exception 'FAIL: the manual booking was not attributed to the professional';
  end if;

  ---------------------------------------------------------------------------
  raise notice '17. a manual booking may sit off the published grid';
  ---------------------------------------------------------------------------
  perform public.create_manual_appointment(
    c_pro, c_service, (v_date::timestamp + time '13:07') at time zone c_tz,
    'Squeeze In', '+1 809 555 9202'
  );

  -- ...and the public engine still only ever offers the grid.
  if exists (
    select 1 from public.get_available_slots(c_pro, c_service, v_date)
    where (starts_at at time zone c_tz)::time = time '13:07'
  ) then
    raise exception 'FAIL: an off-grid appointment leaked an off-grid slot to customers';
  end if;

  if exists (
    select 1 from public.get_available_slots(c_pro, c_service, v_date)
    where starts_at < (v_date::timestamp + time '13:52') at time zone c_tz
      and starts_at + interval '45 minutes' > (v_date::timestamp + time '13:07') at time zone c_tz
  ) then
    raise exception 'FAIL: customers are still being offered time an off-grid appointment occupies';
  end if;

  ---------------------------------------------------------------------------
  raise notice '18. a manual booking still refuses an overlap and a blocked period';
  ---------------------------------------------------------------------------
  begin
    perform public.create_manual_appointment(
      c_pro, c_service, (v_date::timestamp + time '10:15') at time zone c_tz,
      'Double Booked', '+1 809 555 9203'
    );
    raise exception 'FAIL: a manual booking was allowed to overlap another appointment';
  exception
    when sqlstate '23P01' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'SLOT_TAKEN' then
        raise exception 'FAIL: expected SLOT_TAKEN, got %', v_message;
      end if;
  end;

  insert into public.blocked_times (professional_id, starts_at, ends_at, reason)
  values (
    c_pro,
    (v_date::timestamp + time '15:00') at time zone c_tz,
    (v_date::timestamp + time '16:00') at time zone c_tz,
    'Deep clean'
  );

  begin
    perform public.create_manual_appointment(
      c_pro, c_service, (v_date::timestamp + time '15:15') at time zone c_tz,
      'Over A Block', '+1 809 555 9204'
    );
    raise exception 'FAIL: a manual booking was allowed over blocked time';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'SLOT_BLOCKED' then
        raise exception 'FAIL: expected SLOT_BLOCKED, got %', v_message;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '19. working hours hold unless the professional says otherwise';
  ---------------------------------------------------------------------------
  begin
    perform public.create_manual_appointment(
      c_pro, c_service, (v_date::timestamp + time '20:00') at time zone c_tz,
      'After Hours', '+1 809 555 9205'
    );
    raise exception 'FAIL: a manual booking fell outside working hours by accident';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'OUTSIDE_AVAILABILITY' then
        raise exception 'FAIL: expected OUTSIDE_AVAILABILITY, got %', v_message;
      end if;
  end;

  perform public.create_manual_appointment(
    c_pro, c_service, (v_date::timestamp + time '20:00') at time zone c_tz,
    'After Hours', '+1 809 555 9205', null, null, true
  );

  -- Deliberately working late does not advertise late hours to customers.
  if exists (
    select 1 from public.get_available_slots(c_pro, c_service, v_date)
    where (starts_at at time zone c_tz)::time >= time '18:00'
  ) then
    raise exception 'FAIL: an out-of-hours appointment opened out-of-hours slots to customers';
  end if;

  ---------------------------------------------------------------------------
  raise notice '20. customers are matched on phone within the business, never on name';
  ---------------------------------------------------------------------------
  select customer_id into v_customer from public.appointments where id = v_id;

  perform public.create_manual_appointment(
    c_pro, c_service, v_two, 'Phone Customer', '+1 809 555 9201'
  );

  select count(distinct customer_id) into v_count
  from public.appointments
  where professional_id = c_pro
    and customer_id in (
      select id from public.customers where phone = '+1 809 555 9201'
    );

  if v_count <> 1 then
    raise exception 'FAIL: the same phone number produced % customers', v_count;
  end if;

  perform public.create_manual_appointment(
    c_pro, c_service, (v_date::timestamp + time '16:15') at time zone c_tz,
    'Phone Customer', '+1 809 555 9299'
  );

  select id into v_second_customer
  from public.customers
  where business_id = 'a9990000-0000-4000-8000-000000000001' and phone = '+1 809 555 9299';

  if v_second_customer is null or v_second_customer = v_customer then
    raise exception 'FAIL: two people sharing a name were treated as one person';
  end if;

  ---------------------------------------------------------------------------
  raise notice '21. the professional moves an appointment, and history follows it';
  ---------------------------------------------------------------------------
  perform public.reschedule_appointment(v_id, v_eleven, 'Customer asked for later');

  if (select starts_at from public.appointments where id = v_id) <> v_eleven then
    raise exception 'FAIL: the professional move did not take effect';
  end if;

  if (select status from public.appointments where id = v_id) <> 'confirmed' then
    raise exception 'FAIL: moving an appointment changed its status';
  end if;

  select count(*) into v_count
  from public.appointment_events e
  where e.appointment_id = v_id
    and e.event_type = 'rescheduled'
    and e.actor_type = 'professional'
    and e.changed_by_user_id = 'a9990000-0000-4000-8000-0000000000a1'
    and e.previous_starts_at = v_ten
    and e.new_starts_at = v_eleven
    and e.reason = 'Customer asked for later';

  if v_count <> 1 then
    raise exception 'FAIL: the professional move was not recorded with its reason';
  end if;

  ---------------------------------------------------------------------------
  raise notice '22. an appointment may be nudged onto time it already occupies';
  ---------------------------------------------------------------------------
  -- 11:00-11:45 moving to 11:15-12:00 overlaps itself. If the exclusion
  -- constraint counted a row against its own older version, this would fail,
  -- and a fifteen-minute nudge would be impossible.
  perform public.reschedule_appointment(
    v_id, (v_date::timestamp + time '11:15') at time zone c_tz
  );

  if (select starts_at from public.appointments where id = v_id)
     <> (v_date::timestamp + time '11:15') at time zone c_tz then
    raise exception 'FAIL: an appointment could not be nudged within its own span';
  end if;

  perform public.reschedule_appointment(v_id, v_eleven);

  ---------------------------------------------------------------------------
  raise notice '23. a professional move refuses a block, and hours unless overridden';
  ---------------------------------------------------------------------------
  begin
    perform public.reschedule_appointment(
      v_id, (v_date::timestamp + time '15:15') at time zone c_tz
    );
    raise exception 'FAIL: an appointment was moved onto blocked time';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'SLOT_BLOCKED' then
        raise exception 'FAIL: expected SLOT_BLOCKED, got %', v_message;
      end if;
  end;

  begin
    perform public.reschedule_appointment(
      v_id, (v_date::timestamp + time '21:00') at time zone c_tz
    );
    raise exception 'FAIL: an appointment drifted outside working hours';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'OUTSIDE_AVAILABILITY' then
        raise exception 'FAIL: expected OUTSIDE_AVAILABILITY, got %', v_message;
      end if;
  end;

  perform public.reschedule_appointment(
    v_id, (v_date::timestamp + time '21:00') at time zone c_tz, null, true
  );

  if (select starts_at from public.appointments where id = v_id)
     <> (v_date::timestamp + time '21:00') at time zone c_tz then
    raise exception 'FAIL: an explicit out-of-hours move was refused';
  end if;

  perform public.reschedule_appointment(v_id, v_eleven, null, true);

  ---------------------------------------------------------------------------
  raise notice '24. a terminal appointment is not moved, in either direction';
  ---------------------------------------------------------------------------
  insert into public.appointments (
    id, business_id, professional_id, customer_id, starts_at, ends_at, status, source
  )
  values (
    'a9990000-0000-4000-8000-0000000000d1', 'a9990000-0000-4000-8000-000000000001',
    c_pro, v_customer,
    now() - interval '3 hours', now() - interval '2 hours', 'completed', 'manual'
  );

  begin
    perform public.reschedule_appointment('a9990000-0000-4000-8000-0000000000d1', v_two);
    raise exception 'FAIL: a completed appointment was rescheduled';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'APPOINTMENT_NOT_RESCHEDULABLE' then
        raise exception 'FAIL: expected APPOINTMENT_NOT_RESCHEDULABLE, got %', v_message;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '25. history is append-only, even to the owner of the business';
  ---------------------------------------------------------------------------
  begin
    insert into public.appointment_events (
      appointment_id, business_id, event_type, actor_type, new_status
    )
    values (v_id, 'a9990000-0000-4000-8000-000000000001', 'status_changed', 'system', 'cancelled');
    raise exception 'FAIL: history can be forged';
  exception
    when insufficient_privilege then null;
  end;

  update public.appointment_events set reason = 'rewritten' where appointment_id = v_id;
  if exists (select 1 from public.appointment_events where reason = 'rewritten') then
    raise exception 'FAIL: history can be rewritten';
  end if;

  delete from public.appointment_events where appointment_id = v_id;
  if not exists (select 1 from public.appointment_events where appointment_id = v_id) then
    raise exception 'FAIL: history can be erased';
  end if;

  ---------------------------------------------------------------------------
  raise notice '26. a direct write that skips the RPC is still recorded';
  ---------------------------------------------------------------------------
  -- Attribution is not something a caller may choose: if it were, a
  -- professional could sign their own actions as the guest.
  begin
    perform public.declare_appointment_actor('guest');
    raise exception 'FAIL: a professional can forge who acted';
  exception
    when insufficient_privilege then null;
  end;

  update public.appointments
  set status = 'cancelled'
  where id = v_id;

  if not exists (
    select 1 from public.appointment_events
    where appointment_id = v_id and event_type = 'status_changed'
      and previous_status = 'confirmed' and new_status = 'cancelled'
      and actor_type = 'professional'
      and changed_by_user_id = 'a9990000-0000-4000-8000-0000000000a1'
  ) then
    raise exception 'FAIL: a direct status change left no trace';
  end if;

  ---------------------------------------------------------------------------
  raise notice '27. the invalid transition guard still holds alongside history';
  ---------------------------------------------------------------------------
  begin
    update public.appointments set status = 'confirmed' where id = v_id;
    raise exception 'FAIL: a cancelled appointment was re-confirmed';
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'INVALID_STATUS_TRANSITION' then
        raise exception 'FAIL: expected INVALID_STATUS_TRANSITION, got %', v_message;
      end if;
  end;

  raise notice '16-27 hold';
end;
$$;

rollback;

-- ===========================================================================
-- A different tenant, reaching for what is not theirs.
-- ===========================================================================
begin;

-- The neighbour needs something to reach for, so business A puts a customer
-- of its own in the book first.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a9990000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

insert into public.customers (id, business_id, full_name, phone)
values ('a9990000-0000-4000-8000-0000000000f1', 'a9990000-0000-4000-8000-000000000001',
        'Private Customer', '+1 809 555 9301');

insert into public.appointments (
  id, business_id, professional_id, customer_id, starts_at, ends_at, status, source
)
values (
  'a9990000-0000-4000-8000-0000000000e1', 'a9990000-0000-4000-8000-000000000001',
  'a9990000-0000-4000-8000-0000000000b1', 'a9990000-0000-4000-8000-0000000000f1',
  (((now() at time zone 'America/Santo_Domingo')::date + 6)::timestamp + time '10:00')
    at time zone 'America/Santo_Domingo',
  (((now() at time zone 'America/Santo_Domingo')::date + 6)::timestamp + time '10:45')
    at time zone 'America/Santo_Domingo',
  'confirmed', 'manual'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b9990000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  c_theirs constant uuid := 'a9990000-0000-4000-8000-0000000000e1';
  v_message text;
  v_count integer;
begin
  ---------------------------------------------------------------------------
  raise notice '28. a neighbour reads none of another business''s history';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.appointment_events
  where business_id = 'a9990000-0000-4000-8000-000000000001';

  if v_count <> 0 then
    raise exception 'FAIL: a neighbour can read % history rows of another business', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '29. a neighbour cannot move another business''s appointment';
  ---------------------------------------------------------------------------
  begin
    perform public.reschedule_appointment(c_theirs, now() + interval '3 days');
    raise exception 'FAIL: a neighbour rescheduled somebody else''s appointment';
  exception
    when sqlstate 'PT404' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'APPOINTMENT_NOT_FOUND' then
        raise exception 'FAIL: expected APPOINTMENT_NOT_FOUND, got %', v_message;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '30. a neighbour cannot book into another business''s calendar';
  ---------------------------------------------------------------------------
  begin
    perform public.create_manual_appointment(
      'a9990000-0000-4000-8000-0000000000b1',
      'a9990000-0000-4000-8000-0000000000c1',
      now() + interval '3 days',
      'Intruder', '+1 809 555 9999'
    );
    raise exception 'FAIL: a neighbour created an appointment in another business';
  exception
    when sqlstate 'PT404' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'PROFESSIONAL_NOT_FOUND' then
        raise exception 'FAIL: expected PROFESSIONAL_NOT_FOUND, got %', v_message;
      end if;
  end;

  ---------------------------------------------------------------------------
  raise notice '31. and the appointment is exactly where its owner left it';
  ---------------------------------------------------------------------------
  reset role;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', 'a9990000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text,
    true
  );

  if not exists (
    select 1 from public.appointments
    where id = c_theirs
      and starts_at = (((now() at time zone 'America/Santo_Domingo')::date + 6)::timestamp
                        + time '10:00') at time zone 'America/Santo_Domingo'
      and status = 'confirmed'
  ) then
    raise exception 'FAIL: the appointment did not survive the attempt unchanged';
  end if;

  if exists (
    select 1 from public.appointment_events
    where appointment_id = c_theirs and event_type = 'rescheduled'
  ) then
    raise exception 'FAIL: a refused cross-tenant move still wrote history';
  end if;

  raise notice '28-31 hold';
end;
$$;

rollback;

-- ===========================================================================
-- A business whose clocks change.
-- ===========================================================================
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a9990000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  c_pro constant uuid := 'c9990000-0000-4000-8000-0000000000b1';
  c_service constant uuid := 'c9990000-0000-4000-8000-0000000000c1';
  c_tz constant text := 'America/New_York';
  v_near date := ((now() at time zone c_tz)::date + 3);
  v_across date;
  v_created jsonb;
  v_id uuid;
  v_starts timestamptz;
  v_ends timestamptz;
begin
  ---------------------------------------------------------------------------
  raise notice '32. a move across a daylight saving change keeps the wall clock';
  ---------------------------------------------------------------------------
  -- The first date whose 10:00 local maps to a different UTC instant-of-day
  -- than today's does: that is a clock change, whichever direction it goes.
  select d::date into v_across
  from generate_series((v_near + 1)::timestamp, (v_near + 300)::timestamp, interval '1 day') d
  where ((d::date + time '10:00') at time zone c_tz at time zone 'UTC')::time
     <> ((v_near + time '10:00') at time zone c_tz at time zone 'UTC')::time
  order by d
  limit 1;

  if v_across is null then
    raise exception 'FAIL: % never changes its clocks, so this test proves nothing', c_tz;
  end if;

  v_created := public.create_manual_appointment(
    c_pro, c_service, (v_near + time '10:00') at time zone c_tz,
    'Clock Customer', '+1 212 555 0100'
  );
  v_id := (v_created ->> 'appointmentId')::uuid;

  perform public.reschedule_appointment(
    v_id, (v_across + time '10:00') at time zone c_tz
  );

  select starts_at, ends_at into v_starts, v_ends
  from public.appointments where id = v_id;

  if (v_starts at time zone c_tz)::time <> time '10:00' then
    raise exception 'FAIL: the appointment landed at % local, not 10:00',
      (v_starts at time zone c_tz)::time;
  end if;

  if (v_ends at time zone c_tz)::time <> time '11:00' then
    raise exception 'FAIL: the appointment ends at % local, not 11:00',
      (v_ends at time zone c_tz)::time;
  end if;

  if v_ends - v_starts <> interval '60 minutes' then
    raise exception 'FAIL: the appointment changed length crossing a clock change: %',
      v_ends - v_starts;
  end if;

  ---------------------------------------------------------------------------
  raise notice '33. and the offered grid on that date still starts at 09:00 local';
  ---------------------------------------------------------------------------
  if not exists (
    select 1 from public.get_available_slots(c_pro, c_service, v_across)
    where (starts_at at time zone c_tz)::time = time '09:00'
  ) then
    raise exception 'FAIL: the first slot of a clock-change day is not 09:00 local';
  end if;

  if exists (
    select 1 from public.get_available_slots(c_pro, c_service, v_across)
    where (starts_at at time zone c_tz)::time = time '10:00'
  ) then
    raise exception 'FAIL: the time the appointment now occupies is still being offered';
  end if;

  raise notice '32-33 hold';
end;
$$;

rollback;

\echo 'Appointment lifecycle holds.'
