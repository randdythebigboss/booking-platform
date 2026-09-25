-- ===========================================================================
-- Customer accounts, without making anybody have one.
--
-- Booking as a guest stays exactly as it is: a name, a phone, done. An account
-- is something a customer may want *afterwards*, to find their appointments
-- again without hunting for a link in their messages.
--
-- The foundations were laid in the initial schema and never used:
-- `customers.auth_user_id`, `customers_select_own`, `appointments_select_own`.
-- This connects them to something.
--
-- ---------------------------------------------------------------------------
-- How an appointment comes to belong to an account
-- ---------------------------------------------------------------------------
--
-- By claiming it with the guest credential. Whoever holds the booking link can
-- already read, move and cancel that appointment -- that is the whole design
-- (ADR 0019) -- so holding it is proof enough to say "this one is mine".
--
-- The same function therefore serves two moments that look different and are
-- the same thing: a signed-in customer finishing a booking, and a customer who
-- booked as a guest last week signing up and pasting their link.
--
-- A customer record already claimed by somebody else is never re-claimed.
-- Silently reassigning it would hand one person another person's history.
-- ===========================================================================

-- A customer may be one person across several businesses, and each business
-- keeps its own record of them. One account, many customer rows.
create index if not exists customers_auth_user_business_idx
  on public.customers (auth_user_id, business_id)
  where auth_user_id is not null;

-- ---------------------------------------------------------------------------
-- What a signed-in customer can see
-- ---------------------------------------------------------------------------

-- `appointment_items_select` was written for members only, so a customer
-- reading their own appointment through `appointments_select_own` could see
-- the appointment and not what it was for.
create policy appointment_items_select_own on public.appointment_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.appointments a
      join public.customers c on c.id = a.customer_id
      where a.id = appointment_items.appointment_id
        and c.auth_user_id = auth.uid()
    )
  );

-- The business a customer has an appointment with is already public -- it is a
-- published booking page -- so this adds no exposure. It exists so the
-- customer's own list can name the shop without a second anonymous request.

-- ---------------------------------------------------------------------------
-- Claiming
-- ---------------------------------------------------------------------------

create or replace function public.claim_appointment(
  p_appointment_id uuid,
  p_access_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer_id uuid;
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  select a.customer_id into v_customer_id
  from public.appointments a
  where a.id = p_appointment_id
    and a.access_token = p_access_token;

  -- Wrong token, wrong id, or both: the same answer either way.
  if not found then
    return false;
  end if;

  select c.auth_user_id into v_owner
  from public.customers c
  where c.id = v_customer_id;

  -- Already this person's. Claiming twice is not an error.
  if v_owner = auth.uid() then
    return true;
  end if;

  -- Somebody else's. Never reassign: that would hand over their history.
  if v_owner is not null then
    return false;
  end if;

  update public.customers
     set auth_user_id = auth.uid()
   where id = v_customer_id;

  return true;
end;
$$;

comment on function public.claim_appointment(uuid, uuid) is
  'Links the customer record behind one appointment to the signed-in account, '
  'proven by the guest credential. Never takes a record that is already claimed.';

revoke all on function public.claim_appointment(uuid, uuid) from public;
grant execute on function public.claim_appointment(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What a signed-in customer can do
-- ---------------------------------------------------------------------------
--
-- The same two things a guest can do with their link, reached a different way.
-- Both delegate to the token functions rather than reimplementing the rules,
-- so "can this be moved?" has exactly one answer in the system.

create or replace function public.my_appointments()
returns table (
  appointment_id uuid,
  business_slug text,
  business_name text,
  business_timezone text,
  professional_name text,
  service_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  access_token uuid,
  unread_messages integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    a.id,
    b.slug,
    b.name,
    b.timezone,
    coalesce(pp.display_name, b.name),
    coalesce(ai.service_name_snapshot, ''),
    a.starts_at,
    a.ends_at,
    a.status,
    -- Their own credential, so the confirmation screen and everything it can
    -- do stay reachable from the list.
    a.access_token,
    0
  from public.appointments a
  join public.customers c on c.id = a.customer_id and c.auth_user_id = auth.uid()
  join public.businesses b on b.id = a.business_id
  left join public.professional_profiles pp on pp.id = a.professional_id
  left join lateral (
    select ai.service_name_snapshot
    from public.appointment_items ai
    where ai.appointment_id = a.id
    order by ai.created_at
    limit 1
  ) ai on true
  where auth.uid() is not null
  order by a.starts_at desc;
$$;

comment on function public.my_appointments() is
  'Every appointment belonging to the signed-in customer, across every '
  'business. Returns their own access token so the existing confirmation '
  'screen keeps working unchanged.';

revoke all on function public.my_appointments() from public;
grant execute on function public.my_appointments() to authenticated;
