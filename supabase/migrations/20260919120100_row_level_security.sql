-- ===========================================================================
-- Row Level Security
--
-- Every table is deny-by-default. Three audiences:
--   anon           - the public booking page. Reads published catalogue data
--                    only; never the calendar, never customer records.
--   authenticated  - a professional. Sees exactly the businesses they belong
--                    to, and nothing from any other tenant.
--   service_role   - server-side only, bypasses RLS entirely.
--
-- Guests create appointments through public.book_appointment (SECURITY
-- DEFINER), never through a direct INSERT. See docs/SECURITY.md.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Membership helpers.
--
-- SECURITY DEFINER so that policies on business_members can call them without
-- recursing into their own policy. search_path is pinned to keep them from
-- resolving objects out of a caller-controlled schema.
-- ---------------------------------------------------------------------------

create or replace function public.is_business_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
      and m.is_active
  );
$$;

create or replace function public.is_business_manager(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
      and m.is_active
      and m.role in ('owner', 'admin')
  );
$$;

-- A professional may manage their own calendar; managers may manage anyone's.
create or replace function public.can_manage_professional(p_professional_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.professional_profiles p
    join public.business_members m on m.business_id = p.business_id
    where p.id = p_professional_id
      and m.user_id = auth.uid()
      and m.is_active
      and (m.role in ('owner', 'admin') or p.user_id = auth.uid())
  );
$$;

create or replace function public.professional_business_id(p_professional_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select business_id from public.professional_profiles where id = p_professional_id;
$$;

-- True when the business is visible on the public internet.
create or replace function public.is_business_public(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.businesses b
    where b.id = p_business_id
      and b.is_published
      and b.is_active
  );
$$;

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.professional_profiles enable row level security;
alter table public.services enable row level security;
alter table public.professional_services enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.blocked_times enable row level security;
alter table public.customers enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_items enable row level security;
alter table public.payments enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- businesses
-- ---------------------------------------------------------------------------

create policy businesses_select_public on public.businesses
  for select to anon, authenticated using (is_published and is_active);

create policy businesses_select_member on public.businesses
  for select to authenticated using (public.is_business_member(id));

-- An owner always sees their own business, published or not, with or without
-- a membership row. Without this, `insert ... returning` in create_business
-- fails: RETURNING applies the SELECT policies, and at that instant the
-- business is unpublished and its membership row does not exist yet.
create policy businesses_select_owner on public.businesses
  for select to authenticated using (owner_user_id = auth.uid());

-- The creator becomes the owner; the matching business_members row is added
-- by the same client transaction (see src/services/businesses.ts).
create policy businesses_insert_own on public.businesses
  for insert to authenticated with check (owner_user_id = auth.uid());

create policy businesses_update_manager on public.businesses
  for update to authenticated
  using (public.is_business_manager(id))
  with check (public.is_business_manager(id));

create policy businesses_delete_owner on public.businesses
  for delete to authenticated using (owner_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- business_members
-- ---------------------------------------------------------------------------

create policy business_members_select on public.business_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_business_member(business_id));

-- Bootstrapping: the owner of a brand new business adds themselves. After
-- that, only managers may add members.
create policy business_members_insert on public.business_members
  for insert to authenticated
  with check (
    public.is_business_manager(business_id)
    or exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_user_id = auth.uid()
    )
  );

create policy business_members_update on public.business_members
  for update to authenticated
  using (public.is_business_manager(business_id))
  with check (public.is_business_manager(business_id));

create policy business_members_delete on public.business_members
  for delete to authenticated using (public.is_business_manager(business_id));

-- ---------------------------------------------------------------------------
-- professional_profiles
-- ---------------------------------------------------------------------------

create policy professional_profiles_select_public on public.professional_profiles
  for select to anon, authenticated
  using (is_bookable and public.is_business_public(business_id));

create policy professional_profiles_select_member on public.professional_profiles
  for select to authenticated using (public.is_business_member(business_id));

create policy professional_profiles_insert on public.professional_profiles
  for insert to authenticated with check (public.is_business_manager(business_id));

create policy professional_profiles_update on public.professional_profiles
  for update to authenticated
  using (public.can_manage_professional(id))
  with check (public.is_business_member(business_id));

create policy professional_profiles_delete on public.professional_profiles
  for delete to authenticated using (public.is_business_manager(business_id));

-- ---------------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------------

create policy services_select_public on public.services
  for select to anon, authenticated
  using (is_active and public.is_business_public(business_id));

create policy services_select_member on public.services
  for select to authenticated using (public.is_business_member(business_id));

create policy services_write on public.services
  for all to authenticated
  using (public.is_business_manager(business_id))
  with check (public.is_business_manager(business_id));

-- ---------------------------------------------------------------------------
-- professional_services
-- ---------------------------------------------------------------------------

create policy professional_services_select_public on public.professional_services
  for select to anon, authenticated
  using (
    is_active
    and public.is_business_public(public.professional_business_id(professional_id))
  );

create policy professional_services_select_member on public.professional_services
  for select to authenticated
  using (public.is_business_member(public.professional_business_id(professional_id)));

create policy professional_services_write on public.professional_services
  for all to authenticated
  using (public.can_manage_professional(professional_id))
  with check (public.can_manage_professional(professional_id));

-- ---------------------------------------------------------------------------
-- availability - PRIVATE.
--
-- The public never reads these tables. A booking page gets availability from
-- public.get_availability_context, which returns opaque busy ranges and no
-- customer or appointment identity at all.
-- ---------------------------------------------------------------------------

create policy availability_rules_select on public.availability_rules
  for select to authenticated
  using (public.is_business_member(public.professional_business_id(professional_id)));

create policy availability_rules_write on public.availability_rules
  for all to authenticated
  using (public.can_manage_professional(professional_id))
  with check (public.can_manage_professional(professional_id));

create policy availability_exceptions_select on public.availability_exceptions
  for select to authenticated
  using (public.is_business_member(public.professional_business_id(professional_id)));

create policy availability_exceptions_write on public.availability_exceptions
  for all to authenticated
  using (public.can_manage_professional(professional_id))
  with check (public.can_manage_professional(professional_id));

create policy blocked_times_select on public.blocked_times
  for select to authenticated
  using (public.is_business_member(public.professional_business_id(professional_id)));

create policy blocked_times_write on public.blocked_times
  for all to authenticated
  using (public.can_manage_professional(professional_id))
  with check (public.can_manage_professional(professional_id));

-- ---------------------------------------------------------------------------
-- customers - never readable by other customers, never by anon
-- ---------------------------------------------------------------------------

create policy customers_select_member on public.customers
  for select to authenticated using (public.is_business_member(business_id));

create policy customers_select_own on public.customers
  for select to authenticated using (auth_user_id = auth.uid());

create policy customers_write_member on public.customers
  for all to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ---------------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------------

create policy appointments_select_member on public.appointments
  for select to authenticated using (public.is_business_member(business_id));

create policy appointments_select_own on public.appointments
  for select to authenticated
  using (
    exists (
      select 1 from public.customers c
      where c.id = customer_id and c.auth_user_id = auth.uid()
    )
  );

create policy appointments_write_member on public.appointments
  for all to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ---------------------------------------------------------------------------
-- appointment_items and payments follow their appointment
-- ---------------------------------------------------------------------------

create policy appointment_items_select on public.appointment_items
  for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id and public.is_business_member(a.business_id)
    )
  );

create policy appointment_items_write on public.appointment_items
  for all to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id and public.is_business_member(a.business_id)
    )
  )
  with check (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id and public.is_business_member(a.business_id)
    )
  );

create policy payments_select on public.payments
  for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id and public.is_business_member(a.business_id)
    )
  );

-- Payment rows are written by the payment layer running server-side, never by
-- the client. Managers may read; nobody with an anon or authenticated key
-- may insert or mutate them.
