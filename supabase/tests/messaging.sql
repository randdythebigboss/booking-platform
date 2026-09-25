-- ===========================================================================
-- The appointment conversation, and who is allowed into it.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/messaging.sql
--
-- Three kinds of person can reach a thread and each proves themselves
-- differently: a member of the business by `auth.uid()`, a customer with an
-- account by `auth.uid()`, and a guest by the booking credential alone. The
-- interesting cases are all the ones where somebody should be refused.
-- ===========================================================================

\set ON_ERROR_STOP on

-- A second professional account with no connection to Estudio Demo, to play
-- the stranger who wants to read somebody else's conversation.
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

-- A customer who *does* have an account.
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
  'cliente@example.test',
  extensions.crypt('cliente-password-123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Cris Cliente"}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

create temporary table thread_fixture (
  appointment_id uuid,
  access_token uuid
) on commit preserve rows;

-- The suite changes role repeatedly to play each part, and a temporary table
-- belongs to whoever made it.
grant all on thread_fixture to public;

---------------------------------------------------------------------------
-- A guest books, and the two of them talk.
---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
  v_slot timestamptz;
  v_id uuid;
  v_token uuid;
  v_messages integer;
begin
  select starts_at into v_slot
  from public.get_available_slots(
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-000000000001',
    (current_date + 5)
  )
  order by 1 limit 1;

  if v_slot is null then
    raise exception 'FAIL: the fixture calendar has no free slot to book';
  end if;

  v_result := public.book_appointment(
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-000000000001',
    v_slot, 'Ana Mensaje', '+1 809 555 0777', null, null, 'es'
  );

  v_id := (v_result ->> 'appointmentId')::uuid;
  v_token := (v_result ->> 'accessToken')::uuid;
  insert into thread_fixture values (v_id, v_token);

  -- The guest writes, holding nothing but their link.
  perform public.send_appointment_message_by_token(v_id, v_token, 'Hola, llego 5 minutos tarde.');

  select count(*) into v_messages
  from public.get_appointment_messages_by_token(v_id, v_token);
  if v_messages <> 1 then
    raise exception 'FAIL: the guest cannot read the message they just sent (got %)', v_messages;
  end if;

  -- The wrong credential is told nothing at all, not even that it is wrong.
  select count(*) into v_messages
  from public.get_appointment_messages_by_token(v_id, '00000000-0000-4000-8000-000000000000');
  if v_messages <> 0 then
    raise exception 'FAIL: a wrong token read % message(s)', v_messages;
  end if;

  -- An empty message is not a message.
  begin
    perform public.send_appointment_message_by_token(v_id, v_token, '   ');
    raise exception 'FAIL: an empty message was accepted';
  exception
    when sqlstate '22023' then null;
  end;

  -- Neither is one with the wrong credential.
  begin
    perform public.send_appointment_message_by_token(
      v_id, '00000000-0000-4000-8000-000000000000', 'let me in'
    );
    raise exception 'FAIL: a wrong token wrote into the thread';
  exception
    when sqlstate 'PT404' then null;
  end;

  raise notice 'OK: the guest can talk, and only with their own credential';
end;
$$;

---------------------------------------------------------------------------
-- `anon` has no way to the table itself.
---------------------------------------------------------------------------
begin;
set local role anon;

do $$
begin
  begin
    perform 1 from public.appointment_messages;
    raise exception 'FAIL: anon can read appointment_messages directly';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.appointment_messages (
      appointment_id, business_id, author, author_name, body
    )
    select appointment_id, '22222222-2222-4222-8222-222222222222', 'professional', 'Impostor', 'hi'
    from thread_fixture;
    raise exception 'FAIL: anon can write into appointment_messages directly';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'OK: anon reaches the thread only through the token functions';
end;
$$;

rollback;

---------------------------------------------------------------------------
-- The professional answers, and sees the customer's message.
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
  v_id uuid;
  v_count integer;
begin
  select appointment_id into v_id from thread_fixture;

  select count(*) into v_count
  from public.appointment_messages where appointment_id = v_id;
  if v_count <> 1 then
    raise exception 'FAIL: the professional sees % of the customer''s messages', v_count;
  end if;

  insert into public.appointment_messages (
    appointment_id, business_id, author, author_user_id, author_name, body
  )
  values (
    v_id, '22222222-2222-4222-8222-222222222222', 'professional',
    '11111111-1111-4111-8111-111111111111', 'Alex Rivera',
    'Sin problema, te esperamos.'
  );

  -- A member may not write in the customer's name.
  begin
    insert into public.appointment_messages (
      appointment_id, business_id, author, author_user_id, author_name, body
    )
    values (
      v_id, '22222222-2222-4222-8222-222222222222', 'customer',
      '11111111-1111-4111-8111-111111111111', 'Ana Mensaje', 'no soy yo'
    );
    raise exception 'FAIL: a member wrote a message as the customer';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'OK: the professional can answer, and cannot impersonate';
end;
$$;

commit;

---------------------------------------------------------------------------
-- A stranger with a perfectly good account sees nothing.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777777', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_id uuid;
  v_count integer;
begin
  select appointment_id into v_id from thread_fixture;

  select count(*) into v_count
  from public.appointment_messages where appointment_id = v_id;
  if v_count <> 0 then
    raise exception 'FAIL: a stranger read % message(s) of somebody else''s thread', v_count;
  end if;

  begin
    insert into public.appointment_messages (
      appointment_id, business_id, author, author_user_id, author_name, body
    )
    values (
      v_id, '22222222-2222-4222-8222-222222222222', 'professional',
      '77777777-7777-4777-8777-777777777777', 'Sam Stranger', 'hello'
    );
    raise exception 'FAIL: a stranger wrote into somebody else''s thread';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'OK: an account from another business is still a stranger here';
end;
$$;

rollback;

---------------------------------------------------------------------------
-- Claiming: the credential is what makes an appointment yours.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_id uuid;
  v_token uuid;
  v_count integer;
begin
  select appointment_id, access_token into v_id, v_token from thread_fixture;

  -- Before claiming, this appointment is not theirs and they cannot see it.
  select count(*) into v_count from public.appointments where id = v_id;
  if v_count <> 0 then
    raise exception 'FAIL: an unclaimed appointment was visible to an account';
  end if;

  -- A wrong credential claims nothing.
  if public.claim_appointment(v_id, '00000000-0000-4000-8000-000000000000') then
    raise exception 'FAIL: an appointment was claimed with the wrong token';
  end if;

  -- The right one does.
  if not public.claim_appointment(v_id, v_token) then
    raise exception 'FAIL: the holder of the credential could not claim it';
  end if;

  select count(*) into v_count from public.appointments where id = v_id;
  if v_count <> 1 then
    raise exception 'FAIL: after claiming, the customer still cannot see it';
  end if;

  -- And what it was for, which needed a policy of its own.
  select count(*) into v_count from public.appointment_items where appointment_id = v_id;
  if v_count < 1 then
    raise exception 'FAIL: the customer cannot see what the appointment is for';
  end if;

  -- The whole thread, both sides of it.
  select count(*) into v_count
  from public.appointment_messages where appointment_id = v_id;
  if v_count <> 2 then
    raise exception 'FAIL: the signed-in customer sees % of 2 messages', v_count;
  end if;

  -- And they can reply, as themselves.
  insert into public.appointment_messages (
    appointment_id, business_id, author, author_user_id, author_name, body
  )
  values (
    v_id, '22222222-2222-4222-8222-222222222222', 'customer',
    '88888888-8888-4888-8888-888888888888', 'Ana Mensaje', 'Gracias.'
  );

  -- But not in the professional's voice.
  begin
    insert into public.appointment_messages (
      appointment_id, business_id, author, author_user_id, author_name, body
    )
    values (
      v_id, '22222222-2222-4222-8222-222222222222', 'professional',
      '88888888-8888-4888-8888-888888888888', 'Alex Rivera', 'no soy yo'
    );
    raise exception 'FAIL: a customer wrote a message as the professional';
  exception
    when insufficient_privilege then null;
  end;

  -- my_appointments finds it, and hands back the credential so the existing
  -- confirmation screen keeps working.
  select count(*) into v_count from public.my_appointments() where appointment_id = v_id;
  if v_count <> 1 then
    raise exception 'FAIL: my_appointments did not return the claimed appointment';
  end if;

  raise notice 'OK: claiming works, and only with the credential';
end;
$$;

rollback;

---------------------------------------------------------------------------
-- A claimed record is never quietly handed to somebody else.
---------------------------------------------------------------------------
begin;

do $$
declare
  v_id uuid;
  v_token uuid;
  v_customer uuid;
begin
  select appointment_id, access_token into v_id, v_token from thread_fixture;
  select customer_id into v_customer from public.appointments where id = v_id;

  update public.customers
     set auth_user_id = '88888888-8888-4888-8888-888888888888'
   where id = v_customer;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', '77777777-7777-4777-8777-777777777777', 'role', 'authenticated')::text,
    true
  );

  if public.claim_appointment(v_id, v_token) then
    raise exception 'FAIL: a stranger took over a customer record that was already claimed';
  end if;

  raise notice 'OK: an already-claimed customer record is not reassigned';
end;
$$;

rollback;

---------------------------------------------------------------------------
-- A day, seen whole, tells nobody anything about anybody.
---------------------------------------------------------------------------
begin;
set local role anon;

do $$
declare
  v_states text;
  v_taken integer;
  v_free integer;
  v_whole integer;
begin
  -- Same free slots as the booking path, plus the rest of the day around them.
  select count(*) into v_free
  from public.get_available_slots(
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-000000000001',
    (current_date + 5)
  );

  select count(*) into v_whole
  from public.get_day_schedule(
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-000000000001',
    (current_date + 5)
  );

  if v_whole <= v_free then
    raise exception 'FAIL: the whole day (%) is not larger than its free slots (%)', v_whole, v_free;
  end if;

  select count(*) into v_taken
  from public.get_day_schedule(
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-000000000001',
    (current_date + 5)
  )
  where state = 'taken';

  if v_taken < 1 then
    raise exception 'FAIL: the appointment booked above does not show as taken';
  end if;

  -- Every state the function can return is one of the four. Nothing that
  -- could carry a name, a service or an id is in the shape at all.
  select string_agg(distinct state::text, ',' order by state::text) into v_states
  from public.get_day_schedule(
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-000000000001',
    (current_date + 5)
  );

  if v_states !~ '^(available|past|taken|unavailable)(,(available|past|taken|unavailable))*$' then
    raise exception 'FAIL: unexpected slot states: %', v_states;
  end if;

  raise notice 'OK: the public sees a full day and nothing about who is in it';
end;
$$;

rollback;

drop table if exists thread_fixture;

\echo 'messaging.sql: all assertions passed'
