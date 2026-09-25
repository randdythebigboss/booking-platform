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
  'Estudio Demo',
  'demo-studio',
  'Un negocio de demostración para recorrer la reserva de principio a fin.',
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
  'Diez años detrás de la silla. Degradados, barbas y algún rescate de vez en cuando.',
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
   'Corte de cabello', 'Lavado, corte y peinado.', 30, 0, 5, 800.00, 'DOP', 0),
  ('44444444-4444-4444-8444-000000000002', '22222222-2222-4222-8222-222222222222',
   'Corte + barba', 'El arreglo completo.', 45, 0, 5, 1200.00, 'DOP', 1),
  ('44444444-4444-4444-8444-000000000003', '22222222-2222-4222-8222-222222222222',
   'Corte, barba y toalla caliente', 'El servicio completo, sin prisa.', 60, 5, 10, 1800.00, 'DOP', 2)
on conflict (id) do nothing;

insert into public.professional_services (professional_id, service_id)
select '33333333-3333-4333-8333-333333333333'::uuid, s.id
from public.services s
where s.business_id = '22222222-2222-4222-8222-222222222222'
on conflict do nothing;

-- Weekly availability ---------------------------------------------------------
-- Monday to Friday 09:00-18:00, Saturday 09:00-14:00, Sunday closed.

insert into public.availability_rules (professional_id, weekday, start_time, end_time)
select '33333333-3333-4333-8333-333333333333'::uuid, weekday::smallint, time '09:00', time '18:00'
from generate_series(1, 5) as weekday
union all
select '33333333-3333-4333-8333-333333333333'::uuid, 6::smallint, time '09:00', time '14:00';

-- Exceptions: a long lunch in three days, a day off in twelve.

insert into public.availability_exceptions (
  professional_id, exception_date, exception_type, start_time, end_time, reason
)
values (
  '33333333-3333-4333-8333-333333333333',
  (current_date + 3),
  'unavailable', time '12:00', time '14:00', 'Reunión con proveedor'
);

insert into public.availability_exceptions (
  professional_id, exception_date, exception_type, reason
)
values (
  '33333333-3333-4333-8333-333333333333',
  (current_date + 12),
  'unavailable',
  'Día personal'
);

-- A block created by hand, tomorrow at midday.

insert into public.blocked_times (professional_id, starts_at, ends_at, reason)
values (
  '33333333-3333-4333-8333-333333333333',
  ((current_date + 1)::timestamp + time '13:00') at time zone 'America/Santo_Domingo',
  ((current_date + 1)::timestamp + time '14:00') at time zone 'America/Santo_Domingo',
  'Entrega de material'
);

-- One existing customer and booking, so the dashboard is not empty ------------

insert into public.customers (id, business_id, full_name, email, phone)
values (
  '55555555-5555-4555-8555-555555555555',
  '22222222-2222-4222-8222-222222222222',
  'María Peralta',
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
    0, 5, 'confirmed', 'public_page', 'Prefiere la máquina en el 2.'
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
  'Corte + barba',
  45,
  1200.00,
  'DOP'
from created;

-- A few more bookings, so every screen has something to show ------------------
--
-- One today, one waiting to be confirmed, one already done. A dashboard whose
-- only content is a single appointment in two days' time cannot demonstrate a
-- day view, a pending badge or a past list, and a demo that cannot demonstrate
-- itself is worse than no demo.
--
-- Inserted directly, for the same reason as the one above: the seed must not
-- depend on which weekday it happens to run on.

insert into public.customers (id, business_id, full_name, email, phone)
values
  ('55555555-5555-4555-8555-000000000002', '22222222-2222-4222-8222-222222222222',
   'Yerlin Mateo', null, '+1 809 555 0210'),
  ('55555555-5555-4555-8555-000000000003', '22222222-2222-4222-8222-222222222222',
   'Joel Guzmán', null, '+1 809 555 0211'),
  ('55555555-5555-4555-8555-000000000004', '22222222-2222-4222-8222-222222222222',
   'Carolina Objío', 'carolina@example.test', '+1 809 555 0212')
on conflict (business_id, phone) do nothing;

with rows as (
  select * from (values
    ('55555555-5555-4555-8555-000000000002'::uuid, 0, time '15:00', 30,
     '44444444-4444-4444-8444-000000000001'::uuid, 'Corte de cabello', 800.00, 'confirmed'),
    ('55555555-5555-4555-8555-000000000003'::uuid, 1, time '11:00', 45,
     '44444444-4444-4444-8444-000000000002'::uuid, 'Corte + barba', 1200.00, 'pending'),
    ('55555555-5555-4555-8555-000000000004'::uuid, -3, time '09:00', 30,
     '44444444-4444-4444-8444-000000000001'::uuid, 'Corte de cabello', 800.00, 'completed')
  ) as t(customer_id, day_offset, at, minutes, service_id, service_name, price, status)
), created as (
  insert into public.appointments (
    business_id, professional_id, customer_id, starts_at, ends_at,
    buffer_before_minutes, buffer_after_minutes, status, source
  )
  select
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    rows.customer_id,
    ((current_date + rows.day_offset)::timestamp + rows.at) at time zone 'America/Santo_Domingo',
    ((current_date + rows.day_offset)::timestamp + rows.at + make_interval(mins => rows.minutes))
      at time zone 'America/Santo_Domingo',
    0, 5, rows.status::appointment_status, 'public_page'
  from rows
  returning id, customer_id
)
insert into public.appointment_items (
  appointment_id, service_id, service_name_snapshot,
  duration_minutes_snapshot, price_snapshot, currency_snapshot
)
select created.id, rows.service_id, rows.service_name, rows.minutes, rows.price, 'DOP'
from created
join rows on rows.customer_id = created.customer_id;

-- Payments, in development ----------------------------------------------------
--
-- The simulated checkout is what makes every payment path exercisable before a
-- real provider exists, and it is off by default in the schema precisely so
-- that it cannot be on where real money is possible. This is the development
-- seed; it is the one place that turns it on.
--
-- **A production deployment must not load this file.**

update public.platform_settings set payment_simulation_enabled = true;

-- Two services that ask to be paid, added rather than imposed on the three
-- that were already here: the SQL suites book those, and a suite should not
-- have to know what the demo data decided about money this week.

insert into public.services (
  id, business_id, name, description, duration_minutes,
  buffer_before_minutes, buffer_after_minutes, price, currency, sort_order,
  payment_requirement, deposit_amount
)
values
  ('44444444-4444-4444-8444-000000000004', '22222222-2222-4222-8222-222222222222',
   'Color y tratamiento', 'Coloración completa. Se reserva con depósito.', 90,
   0, 10, 2500.00, 'DOP', 3, 'deposit', 1000.00),
  ('44444444-4444-4444-8444-000000000005', '22222222-2222-4222-8222-222222222222',
   'Taller privado', 'Sesión privada de dos horas. Se paga al reservar.', 120,
   0, 10, 3500.00, 'DOP', 4, 'full', null)
on conflict (id) do nothing;

insert into public.professional_services (professional_id, service_id)
values
  ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000004'),
  ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-000000000005')
on conflict do nothing;
