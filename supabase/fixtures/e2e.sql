-- ===========================================================================
-- A second tenant, for tests that can only be written with two of them.
--
-- Loaded AFTER supabase/seed.sql. Everything here is fictional: the domain is
-- a reserved test domain, the telephone numbers are in the 555 range that
-- exists so fiction can use it, and the people are invented.
--
--   Professional login : owner@salon-brisa.test / brisa-password-123
--   Public page        : /p/salon-brisa
--
-- The ids are fixed rather than generated, because a test that has to first
-- discover what it is talking about is a test that fails for reasons nobody
-- can read. `bbbb...` is tenant B throughout.
--
-- Plain SQL only -- no psql meta-commands -- so the Supabase CLI can run it.
-- ===========================================================================

-- Owner -----------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  'bbbbbbbb-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'owner@salon-brisa.test',
  extensions.crypt('brisa-password-123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Paula Moreno"}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
values (
  gen_random_uuid(),
  'bbbbbbbb-1111-4111-8111-111111111111',
  'bbbbbbbb-1111-4111-8111-111111111111',
  jsonb_build_object(
    'sub', 'bbbbbbbb-1111-4111-8111-111111111111',
    'email', 'owner@salon-brisa.test',
    'email_verified', true
  ),
  'email',
  now(), now(), now()
)
on conflict do nothing;

-- Business --------------------------------------------------------------------

insert into public.businesses (
  id, owner_user_id, name, slug, description, timezone, phone, email, address,
  currency, slot_interval_minutes, minimum_notice_minutes, booking_horizon_days,
  auto_confirm_bookings, is_active, is_published
)
values (
  'bbbbbbbb-2222-4222-8222-222222222222',
  'bbbbbbbb-1111-4111-8111-111111111111',
  'Salón Brisa',
  'salon-brisa',
  'El segundo negocio de prueba. Existe para demostrar que no ve al primero.',
  'America/Santo_Domingo',
  '+1 809 555 0200',
  'hola@salon-brisa.test',
  'Calle Segunda 2, Santiago',
  'DOP', 15, 60, 60, true, true, true
)
on conflict (id) do nothing;

insert into public.business_members (business_id, user_id, role)
values (
  'bbbbbbbb-2222-4222-8222-222222222222',
  'bbbbbbbb-1111-4111-8111-111111111111',
  'owner'
)
on conflict (business_id, user_id) do nothing;

insert into public.professional_profiles (
  id, business_id, user_id, display_name, bio, is_bookable, sort_order
)
values (
  'bbbbbbbb-3333-4333-8333-333333333333',
  'bbbbbbbb-2222-4222-8222-222222222222',
  'bbbbbbbb-1111-4111-8111-111111111111',
  'Paula Moreno',
  'Colorista. Trabaja con cita y con calma.',
  true,
  0
)
on conflict (id) do nothing;

-- Services --------------------------------------------------------------------

insert into public.services (
  id, business_id, name, description, duration_minutes,
  buffer_before_minutes, buffer_after_minutes, price, currency, sort_order
)
values
  ('bbbbbbbb-4444-4444-8444-000000000001', 'bbbbbbbb-2222-4222-8222-222222222222',
   'Corte sencillo', 'Lavado, corte y secado.', 30, 0, 5, 700.00, 'DOP', 0),
  ('bbbbbbbb-4444-4444-8444-000000000002', 'bbbbbbbb-2222-4222-8222-222222222222',
   'Peinado de evento', 'Para una noche concreta.', 60, 0, 10, 1500.00, 'DOP', 1)
on conflict (id) do nothing;

insert into public.professional_services (professional_id, service_id)
select 'bbbbbbbb-3333-4333-8333-333333333333'::uuid, s.id
from public.services s
where s.business_id = 'bbbbbbbb-2222-4222-8222-222222222222'
on conflict do nothing;

-- Weekly availability ---------------------------------------------------------
-- Monday to Saturday 09:00-18:00. No exceptions and no blocks: tenant B exists
-- to be *reached*, not to make availability interesting.

insert into public.availability_rules (professional_id, weekday, start_time, end_time)
select 'bbbbbbbb-3333-4333-8333-333333333333'::uuid, weekday::smallint, time '09:00', time '18:00'
from generate_series(1, 6) as weekday;

-- One private appointment -----------------------------------------------------
--
-- Fixed id and fixed token, so a test can try to open tenant B's appointment
-- while signed in as tenant A and assert that it learns nothing. Both values
-- are therefore public knowledge, which is the point: the protection has to be
-- the authorization, never the obscurity of the identifier.

insert into public.customers (id, business_id, full_name, email, phone)
values (
  'bbbbbbbb-5555-4555-8555-000000000001',
  'bbbbbbbb-2222-4222-8222-222222222222',
  'Marta Duarte',
  'marta@example.test',
  '+1 809 555 0201'
)
on conflict (id) do nothing;

insert into public.appointments (
  id, business_id, professional_id, customer_id,
  starts_at, ends_at, status, source, access_token, customer_locale,
  customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot
)
values (
  'bbbbbbbb-6666-4666-8666-000000000001',
  'bbbbbbbb-2222-4222-8222-222222222222',
  'bbbbbbbb-3333-4333-8333-333333333333',
  'bbbbbbbb-5555-4555-8555-000000000001',
  (current_date + 2) + time '10:00' at time zone 'America/Santo_Domingo',
  (current_date + 2) + time '10:30' at time zone 'America/Santo_Domingo',
  'confirmed',
  'manual',
  'bbbbbbbb-7777-4777-8777-000000000001',
  'es',
  'Marta Duarte',
  '+1 809 555 0201',
  'marta@example.test'
)
on conflict (id) do nothing;

-- The service is an item, snapshotted, exactly as the booking path records it.
insert into public.appointment_items (
  appointment_id, service_id, service_name_snapshot,
  duration_minutes_snapshot, price_snapshot, currency_snapshot
)
values (
  'bbbbbbbb-6666-4666-8666-000000000001',
  'bbbbbbbb-4444-4444-8444-000000000001',
  'Corte sencillo',
  30,
  700.00,
  'DOP'
)
on conflict do nothing;
