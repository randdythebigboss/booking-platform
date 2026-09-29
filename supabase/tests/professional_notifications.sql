-- ===========================================================================
-- The professional notification centre: who is told what, and who is not.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/professional_notifications.sql
--
-- Run against a freshly reset stack. Like the other suites it leaves its
-- fixtures behind on purpose, so what it asserts is visible afterwards.
--
-- The questions worth asking of a notification list are not "does it render".
-- They are: does it reach the right person, does it stay away from the wrong
-- one, does it stop telling somebody what they themselves just did, and does
-- "read" mean the same thing in the two places that show it.
-- ===========================================================================

\set ON_ERROR_STOP on

-- A second professional, with a business of their own. They exist to be the
-- person who must never see Estudio Demo's notifications.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  '99999999-9999-4999-8999-999999999999',
  'authenticated', 'authenticated',
  'otra@bookingplatform.test',
  extensions.crypt('otra-password-123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Otra Profesional"}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

insert into public.businesses (id, owner_user_id, name, slug)
values (
  '99999999-0000-4999-8999-999999999999',
  '99999999-9999-4999-8999-999999999999',
  'Peluqueria Otra',
  'peluqueria-otra'
)
on conflict (id) do nothing;

insert into public.business_members (business_id, user_id, role)
values (
  '99999999-0000-4999-8999-999999999999',
  '99999999-9999-4999-8999-999999999999',
  'owner'
)
on conflict do nothing;

create temporary table notif_fixture (
  appointment_id uuid,
  access_token uuid,
  created_event_id uuid,
  message_id uuid,
  second_appointment_id uuid
) on commit preserve rows;

grant all on notif_fixture to public;

---------------------------------------------------------------------------
-- A guest books. That is news.
---------------------------------------------------------------------------
begin;

set local role anon;

do $$
declare
  v_result jsonb;
  v_slot timestamptz;
  v_offset integer;
begin
  -- The first working day from three days out, not the third day. A fixed
  -- offset lands on the seed's closed day one weekday in seven, and a suite
  -- that fails on Tuesdays is worse than no suite.
  for v_offset in 3 .. 16 loop
    select s.starts_at into v_slot
    from public.get_day_schedule(
      (select id from public.professional_profiles
        where business_id = '22222222-2222-4222-8222-222222222222' limit 1),
      (select id from public.services
        where business_id = '22222222-2222-4222-8222-222222222222' order by created_at limit 1),
      (now() at time zone 'America/Santo_Domingo')::date + v_offset
    ) s
    where s.state = 'available'
    order by s.starts_at
    limit 1;
    exit when v_slot is not null;
  end loop;

  if v_slot is null then
    raise exception 'FAIL: the seed offers no free slot in the fortnight from three days out';
  end if;

  v_result := public.book_appointment(
    p_professional_id := (select id from public.professional_profiles
      where business_id = '22222222-2222-4222-8222-222222222222' limit 1),
    p_service_id := (select id from public.services
      where business_id = '22222222-2222-4222-8222-222222222222' order by created_at limit 1),
    p_starts_at := v_slot,
    p_customer_name := 'Noti Prueba',
    p_customer_phone := '809-555-0177',
    p_customer_email := 'noti@example.test'
  );

  insert into notif_fixture (appointment_id, access_token)
  values ((v_result->>'appointmentId')::uuid, (v_result->>'accessToken')::uuid);
end;
$$;

commit;

---------------------------------------------------------------------------
-- The professional is told about it, and it is unread.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_appointment uuid;
  v_row record;
  v_unread integer;
begin
  select appointment_id into v_appointment from notif_fixture;

  select * into v_row
  from public.list_professional_notifications('22222222-2222-4222-8222-222222222222')
  where appointment_id = v_appointment and event_type = 'created';

  if v_row is null then
    raise exception 'FAIL: the booking produced no notification';
  end if;
  if v_row.is_read then
    raise exception 'FAIL: a notification nobody has opened is already read';
  end if;
  if v_row.customer_name <> 'Noti Prueba' then
    raise exception 'FAIL: the notification names % rather than the customer', v_row.customer_name;
  end if;
  if v_row.service_name is null then
    raise exception 'FAIL: the notification does not say which service';
  end if;
  if v_row.appointment_starts_at is null then
    raise exception 'FAIL: the notification does not say when the appointment is';
  end if;

  select public.count_unread_notifications('22222222-2222-4222-8222-222222222222')
    into v_unread;
  if v_unread < 1 then
    raise exception 'FAIL: the badge says % with an unread booking', v_unread;
  end if;
end;
$$;

commit;

---------------------------------------------------------------------------
-- What the list carries, and what it must never carry.
--
-- The telephone number and the address are on the appointment for whoever
-- opens it. A list is not a second place to copy them to.
---------------------------------------------------------------------------
do $$
declare
  v_cols text;
begin
  select string_agg(p.name, ',' order by p.ord) into v_cols
  from pg_proc f
  cross join lateral unnest(f.proargnames, f.proargmodes) with ordinality as p(name, mode, ord)
  where f.oid = 'public.list_professional_notifications(uuid,integer,integer)'::regprocedure
    and p.mode = 't';

  if v_cols <> 'kind,id,appointment_id,occurred_at,event_type,previous_status,new_status,'
             || 'previous_starts_at,new_starts_at,appointment_starts_at,customer_name,'
             || 'service_name,preview,is_read' then
    raise exception 'FAIL: the notification shape changed to %', v_cols;
  end if;

  if v_cols ~* '(phone|email|token|address)' then
    raise exception 'FAIL: the list carries a contact detail: %', v_cols;
  end if;
end;
$$;

---------------------------------------------------------------------------
-- A professional is not told what they themselves just did.
--
-- It books a second appointment rather than touching the fixture one: a future
-- booking cannot be completed, and cancelling the fixture would take the
-- conversation below with it.
---------------------------------------------------------------------------
begin;

set local role anon;

do $$
declare
  v_result jsonb;
  v_slot timestamptz;
  v_offset integer;
begin
  -- The first working day from 4 days out, not the 4th day.
  -- A fixed offset lands on the seed's closed day one weekday in seven, and a
  -- suite that fails on Tuesdays is worse than no suite.
  for v_offset in 4 .. 17 loop
    select s.starts_at into v_slot
    from public.get_day_schedule(
      (select id from public.professional_profiles
        where business_id = '22222222-2222-4222-8222-222222222222' limit 1),
      (select id from public.services
        where business_id = '22222222-2222-4222-8222-222222222222' order by created_at limit 1),
      (now() at time zone 'America/Santo_Domingo')::date + v_offset
    ) s
    where s.state = 'available'
    order by s.starts_at
    limit 1;
    exit when v_slot is not null;
  end loop;

  if v_slot is null then
    raise exception 'FAIL: the fixture calendar has no free slot in the fortnight from four days out';
  end if;

  v_result := public.book_appointment(
    p_professional_id := (select id from public.professional_profiles
      where business_id = '22222222-2222-4222-8222-222222222222' limit 1),
    p_service_id := (select id from public.services
      where business_id = '22222222-2222-4222-8222-222222222222' order by created_at limit 1),
    p_starts_at := v_slot,
    p_customer_name := 'Segunda Prueba',
    p_customer_phone := '809-555-0188'
  );

  update notif_fixture set second_appointment_id = (v_result->>'appointmentId')::uuid;
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
declare
  v_second uuid;
  v_mine integer;
begin
  select second_appointment_id into v_second from notif_fixture;

  update public.appointments
     set status = 'cancelled', cancellation_reason = 'Cierro esa tarde'
   where id = v_second;

  -- The event exists...
  if not exists (
    select 1 from public.appointment_events
    where appointment_id = v_second
      and event_type = 'status_changed'
      and changed_by_user_id = '11111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'FAIL: cancelling the appointment recorded no event';
  end if;

  -- ...and it is not news to the person who caused it.
  select count(*) into v_mine
  from public.list_professional_notifications('22222222-2222-4222-8222-222222222222')
  where appointment_id = v_second and event_type = 'status_changed';

  if v_mine <> 0 then
    raise exception 'FAIL: the professional is told about their own % action(s)', v_mine;
  end if;

  -- The guest's booking of it, however, still is.
  if not exists (
    select 1 from public.list_professional_notifications('22222222-2222-4222-8222-222222222222')
    where appointment_id = v_second and event_type = 'created'
  ) then
    raise exception 'FAIL: the guest booking of the second appointment went unreported';
  end if;
end;
$$;

commit;

---------------------------------------------------------------------------
-- A customer writes. That is news. The professional's own reply is not.
---------------------------------------------------------------------------
begin;

set local role anon;

do $$
declare
  v_appointment uuid;
  v_token uuid;
begin
  select appointment_id, access_token into v_appointment, v_token from notif_fixture;

  perform public.send_appointment_message_by_token(
    v_appointment, v_token, 'Voy a llegar diez minutos tarde.'
  );
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
declare
  v_appointment uuid;
  v_message uuid;
  v_row record;
  v_own integer;
begin
  select appointment_id into v_appointment from notif_fixture;

  select m.id into v_message
  from public.appointment_messages m
  where m.appointment_id = v_appointment and m.author = 'customer'
  order by m.created_at desc
  limit 1;

  if v_message is null then
    raise exception 'FAIL: the guest''s message was never written';
  end if;
  update notif_fixture set message_id = v_message;

  select * into v_row
  from public.list_professional_notifications('22222222-2222-4222-8222-222222222222')
  where kind = 'message' and id = v_message;

  if v_row is null then
    raise exception 'FAIL: the customer''s message produced no notification';
  end if;
  if v_row.is_read then
    raise exception 'FAIL: an unopened message is already read';
  end if;
  if v_row.preview is null or v_row.preview not like 'Voy a llegar%' then
    raise exception 'FAIL: the message notification has no readable preview';
  end if;

  -- The professional answers, and is not notified of their own answer.
  insert into public.appointment_messages (
    appointment_id, business_id, author, author_user_id, author_name, body
  )
  values (
    v_appointment, '22222222-2222-4222-8222-222222222222', 'professional',
    '11111111-1111-4111-8111-111111111111', 'Alex Rivera', 'Sin problema.'
  );

  select count(*) into v_own
  from public.list_professional_notifications('22222222-2222-4222-8222-222222222222')
  where kind = 'message' and preview like 'Sin problema%';

  if v_own <> 0 then
    raise exception 'FAIL: the professional is notified of their own reply';
  end if;
end;
$$;

commit;

---------------------------------------------------------------------------
-- Reading one, and "read" meaning the same thing in both places.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_appointment uuid;
  v_message uuid;
  v_event uuid;
  v_before integer;
  v_after integer;
  v_read boolean;
begin
  select appointment_id, message_id into v_appointment, v_message from notif_fixture;

  select id into v_event
  from public.list_professional_notifications('22222222-2222-4222-8222-222222222222')
  where appointment_id = v_appointment and event_type = 'created';

  select public.count_unread_notifications('22222222-2222-4222-8222-222222222222') into v_before;

  if not public.mark_notification_read('22222222-2222-4222-8222-222222222222', 'event', v_event) then
    raise exception 'FAIL: marking an event read was refused';
  end if;

  select is_read into v_read
  from public.list_professional_notifications('22222222-2222-4222-8222-222222222222')
  where kind = 'event' and id = v_event;
  if not v_read then
    raise exception 'FAIL: the event is still unread after being marked read';
  end if;

  select public.count_unread_notifications('22222222-2222-4222-8222-222222222222') into v_after;
  if v_after <> v_before - 1 then
    raise exception 'FAIL: the badge went from % to %, not down by one', v_before, v_after;
  end if;

  -- Marking it twice is not an error and does not double-count.
  if not public.mark_notification_read('22222222-2222-4222-8222-222222222222', 'event', v_event) then
    raise exception 'FAIL: marking the same event twice was refused';
  end if;

  -- A message read from the notification centre is read in the conversation
  -- too, because there is only one column that says so.
  if not public.mark_notification_read('22222222-2222-4222-8222-222222222222', 'message', v_message) then
    raise exception 'FAIL: marking a message read was refused';
  end if;

  if (select read_at from public.appointment_messages where id = v_message) is null then
    raise exception 'FAIL: the conversation still shows the message as unread';
  end if;
end;
$$;

commit;

---------------------------------------------------------------------------
-- A professional from another business sees nothing and can mark nothing.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '99999999-9999-4999-8999-999999999999', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_event uuid;
  v_count integer;
begin
  select id into v_event
  from public.appointment_events
  where business_id = '22222222-2222-4222-8222-222222222222'
  order by occurred_at desc limit 1;

  -- Silence, not refusal.
  select count(*) into v_count
  from public.list_professional_notifications('22222222-2222-4222-8222-222222222222');
  if v_count <> 0 then
    raise exception 'FAIL: a stranger reads % of another business''s notifications', v_count;
  end if;

  if public.count_unread_notifications('22222222-2222-4222-8222-222222222222') <> 0 then
    raise exception 'FAIL: a stranger gets a badge for another business';
  end if;

  -- Naming their own business does not let them mark somebody else's event.
  if public.mark_notification_read('99999999-0000-4999-8999-999999999999', 'event', v_event) then
    raise exception 'FAIL: an event was marked read across a tenant boundary';
  end if;

  if exists (
    select 1 from public.notification_reads where item_id = v_event
      and user_id = '99999999-9999-4999-8999-999999999999'
  ) then
    raise exception 'FAIL: a cross-tenant read marker was written anyway';
  end if;

  if public.mark_all_notifications_read('22222222-2222-4222-8222-222222222222') <> 0 then
    raise exception 'FAIL: a stranger marked another business''s notifications read';
  end if;
end;
$$;

commit;

---------------------------------------------------------------------------
-- Marking the lot read, and a range that would walk the whole history.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_left integer;
begin
  perform public.mark_all_notifications_read('22222222-2222-4222-8222-222222222222');

  select public.count_unread_notifications('22222222-2222-4222-8222-222222222222') into v_left;
  if v_left <> 0 then
    raise exception 'FAIL: % notifications are still unread after marking all read', v_left;
  end if;

  if exists (
    select 1 from public.list_professional_notifications('22222222-2222-4222-8222-222222222222')
    where not is_read
  ) then
    raise exception 'FAIL: the list still shows an unread row';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.list_professional_notifications(
      '22222222-2222-4222-8222-222222222222', 500);
    raise exception 'FAIL: a 500-row request was allowed';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.list_professional_notifications(
      '22222222-2222-4222-8222-222222222222', 50, 4000);
    raise exception 'FAIL: an eleven-year window was allowed';
  exception
    when sqlstate '22023' then null;
  end;
end;
$$;

commit;

---------------------------------------------------------------------------
-- None of this belongs to anon.
---------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  foreach v_name in array array[
    'public.list_professional_notifications(uuid,integer,integer)',
    'public.count_unread_notifications(uuid)',
    'public.mark_notification_read(uuid,text,uuid)',
    'public.mark_all_notifications_read(uuid)'
  ] loop
    if has_function_privilege('anon', v_name::regprocedure, 'EXECUTE') then
      raise exception 'FAIL: anon may execute %', v_name;
    end if;
    if has_function_privilege('public', v_name::regprocedure, 'EXECUTE') then
      raise exception 'FAIL: PUBLIC may execute %', v_name;
    end if;
    if not has_function_privilege('authenticated', v_name::regprocedure, 'EXECUTE') then
      raise exception 'FAIL: a signed-in professional may not execute %', v_name;
    end if;
  end loop;
end;
$$;

---------------------------------------------------------------------------
-- The marker table refuses to be read by anybody but its owner.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '99999999-9999-4999-8999-999999999999', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_seen integer;
begin
  select count(*) into v_seen from public.notification_reads;
  if v_seen <> 0 then
    raise exception 'FAIL: a professional reads % of somebody else''s read markers', v_seen;
  end if;

  -- And cannot plant one against a business they do not belong to.
  begin
    insert into public.notification_reads (user_id, business_id, item_kind, item_id)
    values (
      '99999999-9999-4999-8999-999999999999',
      '22222222-2222-4222-8222-222222222222',
      'event', gen_random_uuid()
    );
    raise exception 'FAIL: a read marker was planted against another business';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

commit;

\echo 'professional_notifications: every assertion held'
