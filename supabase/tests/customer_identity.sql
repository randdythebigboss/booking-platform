-- ===========================================================================
-- Phase 6 - who counts as the same customer.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/customer_identity.sql
--
-- Two directions matter, and they are not symmetric. Failing to merge leaves a
-- duplicate row, which is untidy. Merging wrongly shows one person another
-- person's appointments, which is a privacy incident. Every assertion here is
-- written with that asymmetry in mind.
-- ===========================================================================

\set ON_ERROR_STOP on

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('00000000-0000-0000-0000-000000000000', 'd1110000-0000-4000-8000-0000000000d1',
   'authenticated', 'authenticated', 'ident@bookingplatform.test',
   extensions.crypt('ident-password-123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Ident Owner"}'::jsonb, '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd2220000-0000-4000-8000-0000000000d2',
   'authenticated', 'authenticated', 'vecino@bookingplatform.test',
   extensions.crypt('vecino-password-123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Vecino"}'::jsonb, '', '', '', '')
on conflict (id) do nothing;

insert into public.businesses (
  id, owner_user_id, name, slug, timezone, currency,
  slot_interval_minutes, minimum_notice_minutes, booking_horizon_days,
  auto_confirm_bookings, is_active, is_published
)
values
  ('d1110000-0000-4000-8000-000000000001', 'd1110000-0000-4000-8000-0000000000d1',
   'Estudio Identidad', 'estudio-identidad', 'America/Santo_Domingo', 'DOP', 15, 60, 60,
   true, true, true),
  ('d2220000-0000-4000-8000-000000000001', 'd2220000-0000-4000-8000-0000000000d2',
   'Estudio Vecino', 'estudio-vecino', 'America/Santo_Domingo', 'DOP', 15, 60, 60,
   true, true, true);

insert into public.business_members (business_id, user_id, role)
values
  ('d1110000-0000-4000-8000-000000000001', 'd1110000-0000-4000-8000-0000000000d1', 'owner'),
  ('d2220000-0000-4000-8000-000000000001', 'd2220000-0000-4000-8000-0000000000d2', 'owner');

insert into public.professional_profiles (id, business_id, user_id, display_name)
values
  ('d1110000-0000-4000-8000-0000000000b1', 'd1110000-0000-4000-8000-000000000001',
   'd1110000-0000-4000-8000-0000000000d1', 'Profesional Identidad'),
  ('d2220000-0000-4000-8000-0000000000b1', 'd2220000-0000-4000-8000-000000000001',
   'd2220000-0000-4000-8000-0000000000d2', 'Profesional Vecino');

insert into public.services (
  id, business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes,
  price, currency, is_active
)
values
  ('d1110000-0000-4000-8000-0000000000c1', 'd1110000-0000-4000-8000-000000000001',
   'Corte de prueba', 30, 0, 0, 500, 'DOP', true),
  ('d2220000-0000-4000-8000-0000000000c1', 'd2220000-0000-4000-8000-000000000001',
   'Corte vecino', 30, 0, 0, 500, 'DOP', true);

insert into public.professional_services (professional_id, service_id)
values
  ('d1110000-0000-4000-8000-0000000000b1', 'd1110000-0000-4000-8000-0000000000c1'),
  ('d2220000-0000-4000-8000-0000000000b1', 'd2220000-0000-4000-8000-0000000000c1');

insert into public.availability_rules (professional_id, weekday, start_time, end_time)
select p, d::smallint, time '09:00', time '18:00'
from generate_series(0, 6) as d
cross join (values
  ('d1110000-0000-4000-8000-0000000000b1'::uuid),
  ('d2220000-0000-4000-8000-0000000000b1'::uuid)
) as pros(p);

begin;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

-- Guests book. Nothing here reads a table; every assertion comes later, as
-- the business, because a guest can see none of this.
do $$
declare
  c_pro constant uuid := 'd1110000-0000-4000-8000-0000000000b1';
  c_service constant uuid := 'd1110000-0000-4000-8000-0000000000c1';
  c_tz constant text := 'America/Santo_Domingo';
  v_date date := ((now() at time zone c_tz)::date + 4);
begin
  perform public.book_appointment(
    c_pro, c_service, (v_date::timestamp + time '09:00') at time zone c_tz,
    'Ana Martínez', '+1 809 555 1234', 'ana@example.test'
  );

  -- Same number, different punctuation. Nobody would call these two people.
  perform public.book_appointment(
    c_pro, c_service, (v_date::timestamp + time '10:00') at time zone c_tz,
    'Ana Martinez', '+1(809)555-1234'
  );

  -- A country code is never guessed: this may well be the same person, and
  -- deciding so means inferring a country from a phone number. Getting that
  -- wrong shows a stranger somebody else's bookings.
  perform public.book_appointment(
    c_pro, c_service, (v_date::timestamp + time '11:00') at time zone c_tz,
    'Alguien Más', '8095551234'
  );

  -- Same name, different number: two people.
  perform public.book_appointment(
    c_pro, c_service, (v_date::timestamp + time '13:00') at time zone c_tz,
    'Ana Martínez', '+1 809 555 9999'
  );

  -- The same person at a second business.
  perform public.book_appointment(
    c_pro, c_service, (v_date::timestamp + time '14:00') at time zone c_tz,
    'Carlos Cruz', '+1 809 555 4321'
  );

  perform public.book_appointment(
    'd2220000-0000-4000-8000-0000000000b1', 'd2220000-0000-4000-8000-0000000000c1',
    (v_date::timestamp + time '14:00') at time zone c_tz,
    'Carlos Cruz', '+1 809 555 4321'
  );
end;
$$;

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1110000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  c_business constant uuid := 'd1110000-0000-4000-8000-000000000001';
  v_count integer;
  v_name text;
  v_email text;
begin
  ---------------------------------------------------------------------------
  raise notice '1. the same number typed differently is one customer';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.customers
  where business_id = c_business and phone_normalized = '+18095551234';

  if v_count <> 1 then
    raise exception 'FAIL: one phone number produced % customers', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '2. a returning customer keeps the email they gave once';
  ---------------------------------------------------------------------------
  -- The second booking carried no email. Losing the first one would quietly
  -- throw away the only way the business had to reach her.
  select full_name, email into v_name, v_email
  from public.customers
  where business_id = c_business and phone_normalized = '+18095551234';

  if v_email is distinct from 'ana@example.test' then
    raise exception 'FAIL: the email was lost on the second booking, got %', v_email;
  end if;

  if v_name <> 'Ana Martinez' then
    raise exception 'FAIL: the most recent name should win, got %', v_name;
  end if;

  ---------------------------------------------------------------------------
  raise notice '3. both of her appointments belong to that one customer';
  ---------------------------------------------------------------------------
  select count(distinct a.customer_id) into v_count
  from public.appointments a
  join public.customers c on c.id = a.customer_id
  where c.business_id = c_business and c.phone_normalized = '+18095551234';

  if v_count <> 1 then
    raise exception 'FAIL: her appointments are split across % customers', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '4. a country code is never guessed';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.customers
  where business_id = c_business and phone_normalized in ('8095551234', '+18095551234');

  if v_count <> 2 then
    raise exception 'FAIL: expected two distinct customers, found %', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '5. two different numbers stay two customers';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.customers
  where business_id = c_business and full_name like 'Ana Mart%';

  if v_count <> 2 then
    raise exception 'FAIL: the same name on two numbers produced % customers, not 2', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '6. one business sees only its own row for a shared customer';
  ---------------------------------------------------------------------------
  -- Not a duplicate to be cleaned up: a customer belongs to a business, and
  -- merging across the boundary would let one shop read another shop's book.
  select count(*) into v_count
  from public.customers
  where phone_normalized = '+18095554321';

  if v_count <> 1 then
    raise exception 'FAIL: this business can see % rows for that number, not 1', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '7. the lookup helper is internal, like every other one';
  ---------------------------------------------------------------------------
  -- It answers "which customer is this phone number", which is exactly the
  -- question a stranger would like to ask a business about its book.
  begin
    perform public.find_customer_by_phone(c_business, '+1 809 555 4321');
    raise exception 'FAIL: a signed-in caller can probe the customer book by phone';
  exception
    when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------------------
  raise notice '8. and the shared customer really is one row per business';
  ---------------------------------------------------------------------------
  reset role;
  if (select count(distinct business_id) from public.customers
      where phone_normalized = '+18095554321') <> 2 then
    raise exception 'FAIL: the shared customer is not one row per business';
  end if;

  if (select count(distinct id) from public.customers
      where phone_normalized = '+18095554321') <> 2 then
    raise exception 'FAIL: two businesses are sharing one customer row';
  end if;

  raise notice '1-8 hold';
end;
$$;

rollback;

\echo 'Customer identity holds.'
