-- ===========================================================================
-- Booking platform - initial schema
--
-- Principles enforced here (see docs/ARCHITECTURE.md):
--   * The database is the source of truth.
--   * Appointments are stored as absolute instants (timestamptz), never as
--     local wall-clock text. Each business carries its own IANA timezone.
--   * Double booking is impossible by construction, not by convention.
-- ===========================================================================

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.business_member_role as enum ('owner', 'admin', 'professional');

create type public.appointment_status as enum (
  'pending',
  'confirmed',
  'cancelled',
  'completed',
  'no_show'
);

create type public.appointment_source as enum ('public_page', 'manual', 'import');

create type public.availability_exception_type as enum ('available', 'unavailable');

create type public.payment_status as enum (
  'pending',
  'authorized',
  'paid',
  'failed',
  'refunded',
  'cancelled'
);

-- ---------------------------------------------------------------------------
-- Shared triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Rejects anything PostgreSQL cannot resolve as an IANA timezone. A CHECK
-- constraint cannot do this because the lookup is not immutable.
create or replace function public.assert_valid_timezone()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  perform now() at time zone new.timezone;
  return new;
exception
  when others then
    raise exception 'Invalid IANA timezone: %', new.timezone using errcode = '22023';
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles - extended identity for an authenticated user
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- businesses - the tenant boundary
-- ---------------------------------------------------------------------------

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete restrict,
  name text not null check (length(btrim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  description text,
  timezone text not null default 'America/Santo_Domingo',
  phone text,
  email text,
  address text,
  logo_url text,
  currency char(3) not null default 'DOP',

  -- Booking policy. The availability engine reads these; see
  -- src/features/availability/types.ts (BookingPolicy).
  slot_interval_minutes integer not null default 15 check (slot_interval_minutes between 1 and 240),
  minimum_notice_minutes integer not null default 60 check (minimum_notice_minutes >= 0),
  booking_horizon_days integer not null default 60 check (booking_horizon_days between 0 and 365),
  auto_confirm_bookings boolean not null default true,

  is_active boolean not null default true,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger businesses_valid_timezone
  before insert or update of timezone on public.businesses
  for each row execute function public.assert_valid_timezone();

create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

create index businesses_owner_idx on public.businesses (owner_user_id);
create index businesses_published_idx on public.businesses (is_published, is_active);

-- ---------------------------------------------------------------------------
-- business_members - who may act on behalf of a business
-- ---------------------------------------------------------------------------

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.business_member_role not null default 'professional',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create index business_members_user_idx on public.business_members (user_id) where is_active;

-- ---------------------------------------------------------------------------
-- professional_profiles - a bookable calendar inside a business
-- ---------------------------------------------------------------------------

create table public.professional_profiles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- Nullable on purpose: a chair, room or staff member can exist on the
  -- calendar before (or without) having their own login.
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null check (length(btrim(display_name)) > 0),
  bio text,
  avatar_url text,
  is_bookable boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index professional_profiles_business_user_idx
  on public.professional_profiles (business_id, user_id)
  where user_id is not null;

create index professional_profiles_business_idx on public.professional_profiles (business_id);

create trigger professional_profiles_set_updated_at
  before update on public.professional_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- services and their assignment to professionals
-- ---------------------------------------------------------------------------

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  description text,
  duration_minutes integer not null check (duration_minutes between 1 and 1440),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 1440),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 1440),
  price numeric(10, 2) not null default 0 check (price >= 0),
  currency char(3) not null default 'DOP',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index services_business_idx on public.services (business_id) where is_active;

create trigger services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

create table public.professional_services (
  professional_id uuid not null references public.professional_profiles (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (professional_id, service_id)
);

create index professional_services_service_idx on public.professional_services (service_id);

-- ---------------------------------------------------------------------------
-- availability - recurring rules, one-off exceptions, ad-hoc blocks
-- ---------------------------------------------------------------------------

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  effective_from date,
  effective_until date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Overnight shifts are out of scope for the MVP; see docs/DECISIONS.
  constraint availability_rules_forward_window check (end_time > start_time),
  constraint availability_rules_effective_range
    check (effective_from is null or effective_until is null or effective_until >= effective_from)
);

create index availability_rules_professional_idx
  on public.availability_rules (professional_id, weekday)
  where is_active;

create trigger availability_rules_set_updated_at
  before update on public.availability_rules
  for each row execute function public.set_updated_at();

create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles (id) on delete cascade,
  exception_date date not null,
  exception_type public.availability_exception_type not null,
  start_time time,
  end_time time,
  reason text,
  created_at timestamptz not null default now(),
  -- Times come as a pair or not at all.
  constraint availability_exceptions_time_pair
    check ((start_time is null) = (end_time is null)),
  constraint availability_exceptions_forward_window
    check (start_time is null or end_time > start_time),
  -- An untimed exception can only mean "closed all day".
  constraint availability_exceptions_available_needs_times
    check (exception_type = 'unavailable' or start_time is not null)
);

create index availability_exceptions_professional_idx
  on public.availability_exceptions (professional_id, exception_date);

create table public.blocked_times (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint blocked_times_forward_window check (ends_at > starts_at),
  blocked_range tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored
);

create index blocked_times_professional_range_idx
  on public.blocked_times using gist (professional_id, blocked_range);

-- ---------------------------------------------------------------------------
-- customers - scoped to a business, may or may not have an account
-- ---------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  auth_user_id uuid references auth.users (id) on delete set null,
  full_name text not null check (length(btrim(full_name)) > 0),
  email text,
  phone text not null check (length(btrim(phone)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Phone is the identity of a guest customer within one business.
  unique (business_id, phone)
);

create index customers_auth_user_idx on public.customers (auth_user_id) where auth_user_id is not null;

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- appointments - the heart of the system
-- ---------------------------------------------------------------------------

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  professional_id uuid not null references public.professional_profiles (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,

  -- Absolute instants. Never store wall-clock text here.
  starts_at timestamptz not null,
  ends_at timestamptz not null,

  -- Snapshotted from the service so that editing a service later never
  -- silently changes how much room a past appointment occupied.
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes >= 0),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes >= 0),

  -- starts_at/ends_at widened by the buffers. Maintained by a trigger rather
  -- than a generated column: timestamptz +/- interval is STABLE, not
  -- IMMUTABLE, so PostgreSQL will not accept it in a generated expression.
  blocked_range tstzrange not null,

  status public.appointment_status not null default 'pending',
  source public.appointment_source not null default 'public_page',
  notes text,

  -- Lets a guest open and cancel their own booking without an account.
  access_token uuid not null default gen_random_uuid(),

  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint appointments_forward_window check (ends_at > starts_at)
);

create or replace function public.appointments_set_blocked_range()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.blocked_range := tstzrange(
    new.starts_at - make_interval(mins => new.buffer_before_minutes),
    new.ends_at + make_interval(mins => new.buffer_after_minutes),
    '[)'
  );
  return new;
end;
$$;

create trigger appointments_blocked_range
  before insert or update of starts_at, ends_at, buffer_before_minutes, buffer_after_minutes
  on public.appointments
  for each row execute function public.appointments_set_blocked_range();

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- THE rule of this product: one professional cannot be in two places at once.
-- Enforced by PostgreSQL, so no amount of concurrent requests, retries or
-- buggy client code can produce a double booking. Cancelled, completed and
-- no-show appointments release their slot.
alter table public.appointments
  add constraint appointments_no_double_booking
  exclude using gist (
    professional_id with =,
    blocked_range with &&
  ) where (status in ('pending', 'confirmed'));

create index appointments_professional_starts_idx
  on public.appointments (professional_id, starts_at desc);
create index appointments_business_starts_idx
  on public.appointments (business_id, starts_at desc);
create index appointments_customer_idx on public.appointments (customer_id);

-- ---------------------------------------------------------------------------
-- appointment_items - what was actually booked, frozen in time
-- ---------------------------------------------------------------------------

create table public.appointment_items (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  service_id uuid references public.services (id) on delete set null,
  service_name_snapshot text not null,
  duration_minutes_snapshot integer not null check (duration_minutes_snapshot > 0),
  price_snapshot numeric(10, 2) not null default 0 check (price_snapshot >= 0),
  currency_snapshot char(3) not null,
  created_at timestamptz not null default now()
);

create index appointment_items_appointment_idx on public.appointment_items (appointment_id);

-- ---------------------------------------------------------------------------
-- payments - provider-agnostic by design (see src/services/payments)
-- ---------------------------------------------------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  provider text not null default 'mock',
  provider_reference text,
  amount numeric(10, 2) not null check (amount >= 0),
  currency char(3) not null,
  status public.payment_status not null default 'pending',
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index payments_provider_reference_idx
  on public.payments (provider, provider_reference)
  where provider_reference is not null;

create index payments_appointment_idx on public.payments (appointment_id);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();
