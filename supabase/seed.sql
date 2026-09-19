-- ===========================================================================
-- Demo data. Loaded automatically by `npm run db:reset` on a local stack.
-- Never run this against a real project: it inserts a known password.
--
--   Professional login : demo@bookingplatform.test / demo-password-123
--   Public page        : /p/demo-studio
--
-- Plain SQL only -- no psql meta-commands -- because the Supabase CLI executes
-- this file over a normal connection.
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
  '11111111-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'demo@bookingplatform.test',
  extensions.crypt('demo-password-123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Alex Rivera"}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
values (
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  jsonb_build_object(
    'sub', '11111111-1111-4111-8111-111111111111',
    'email', 'demo@bookingplatform.test',
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
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Demo Studio',
  'demo-studio',
  'A demo business used to exercise the booking flow end to end.',
  'America/Santo_Domingo',
  '+1 809 555 0100',
  'hola@demostudio.test',
  'Av. Winston Churchill 1, Santo Domingo',
  'DOP', 15, 60, 60, true, true, true
)
on conflict (id) do nothing;

insert into public.business_members (business_id, user_id, role)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'owner'
)
on conflict (business_id, user_id) do nothing;

insert into public.professional_profiles (
  id, business_id, user_id, display_name, bio, is_bookable, sort_order
)
values (
  '33333333-3333-4333-8333-333333333333',
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Alex Rivera',
  'Ten years behind the chair. Fades, beards and the occasional rescue job.',
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
  ('44444444-4444-4444-8444-000000000001', '22222222-2222-4222-8222-222222222222',
   'Haircut', 'Wash, cut and finish.', 30, 0, 5, 800.00, 'DOP', 0),
  ('44444444-4444-4444-8444-000000000002', '22222222-2222-4222-8222-222222222222',
   'Haircut + Beard', 'The full tidy-up.', 45, 0, 5, 1200.00, 'DOP', 1),
  ('44444444-4444-4444-8444-000000000003', '22222222-2222-4222-8222-222222222222',
   'Premium Service', 'Cut, beard, hot towel and styling.', 60, 5, 10, 1800.00, 'DOP', 2)
on conflict (id) do nothing;

insert into public.professional_services (professional_id, service_id)
select '33333333-3333-4333-8333-333333333333', s.id
from public.services s
where s.business_id = '22222222-2222-4222-8222-222222222222'
on conflict do nothing;

-- Weekly availability ---------------------------------------------------------
-- Monday to Friday 09:00-18:00, Saturday 09:00-14:00, Sunday closed.

insert into public.availability_rules (professional_id, weekday, start_time, end_time)
select '33333333-3333-4333-8333-333333333333', weekday, time '09:00', time '18:00'
from generate_series(1, 5) as weekday
union all
select '33333333-3333-4333-8333-333333333333', 6, time '09:00', time '14:00';

-- Exceptions: a long lunch in three days, a day off in twelve.

insert into public.availability_exceptions (
  professional_id, exception_date, exception_type, start_time, end_time, reason
)
values (
  '33333333-3333-4333-8333-333333333333',
  (current_date + 3),
  'unavailable', time '12:00', time '14:00', 'Supplier meeting'
);

insert into public.availability_exceptions (
  professional_id, exception_date, exception_type, reason
)
values (
  '33333333-3333-4333-8333-333333333333',
  (current_date + 12),
  'unavailable',
  'Personal day'
);

-- A block created by hand, tomorrow at midday.

insert into public.blocked_times (professional_id, starts_at, ends_at, reason)
values (
  '33333333-3333-4333-8333-333333333333',
  ((current_date + 1)::timestamp + time '13:00') at time zone 'America/Santo_Domingo',
  ((current_date + 1)::timestamp + time '14:00') at time zone 'America/Santo_Domingo',
  'Equipment delivery'
);

-- One existing customer and booking, so the dashboard is not empty ------------

insert into public.customers (id, business_id, full_name, email, phone)
values (
  '55555555-5555-4555-8555-555555555555',
  '22222222-2222-4222-8222-222222222222',
  'Maria Peralta',
  'maria@example.test',
  '+1 809 555 0199'
)
on conflict (business_id, phone) do nothing;

-- Inserted directly rather than through book_appointment, so the seed does not
-- depend on which weekday it happens to run on.
with created as (
  insert into public.appointments (
    business_id, professional_id, customer_id, starts_at, ends_at,
    buffer_before_minutes, buffer_after_minutes, status, source, notes
  )
  values (
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '55555555-5555-4555-8555-555555555555',
    ((current_date + 2)::timestamp + time '10:00') at time zone 'America/Santo_Domingo',
    ((current_date + 2)::timestamp + time '10:45') at time zone 'America/Santo_Domingo',
    0, 5, 'confirmed', 'public_page', 'Prefers the clippers on 2.'
  )
  returning id
)
insert into public.appointment_items (
  appointment_id, service_id, service_name_snapshot,
  duration_minutes_snapshot, price_snapshot, currency_snapshot
)
select
  created.id,
  '44444444-4444-4444-8444-000000000002',
  'Haircut + Beard',
  45,
  1200.00,
  'DOP'
from created;
