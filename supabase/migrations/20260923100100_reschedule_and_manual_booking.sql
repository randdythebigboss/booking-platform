-- ===========================================================================
-- Phase 5 - rescheduling, and the professional's own way into the book.
--
-- Three new operations and two regenerated ones:
--
--   reschedule_appointment           a professional moves an appointment
--   reschedule_appointment_by_token  a guest moves their own
--   create_manual_appointment        a professional enters one themselves
--
--   book_appointment                 regenerated: declares the guest actor
--   cancel_appointment_by_token      regenerated: declares the guest actor
--
-- The two regenerated functions are byte-identical to their previous
-- definitions apart from one added line each, so that the history written by
-- the trigger in 20260923100000 attributes a guest's action to the guest
-- rather than to "system".
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.book_appointment(p_professional_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_customer_name text, p_customer_phone text, p_customer_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_professional public.professional_profiles;
  v_business public.businesses;
  v_service public.services;
  v_customer_id uuid;
  v_ends_at timestamptz;
  v_occupied tstzrange;
  v_appointment public.appointments;
begin
  -- Phase 5: a guest acting through their own booking link.
  perform public.declare_appointment_actor('guest');

  if coalesce(btrim(p_customer_name), '') = '' then
    raise exception 'CUSTOMER_NAME_REQUIRED' using errcode = '22023';
  end if;

  if coalesce(btrim(p_customer_phone), '') = '' then
    raise exception 'CUSTOMER_PHONE_REQUIRED' using errcode = '22023';
  end if;

  select p.* into v_professional
  from public.professional_profiles p
  where p.id = p_professional_id and p.is_bookable;

  if not found then
    raise exception 'PROFESSIONAL_NOT_BOOKABLE' using errcode = 'PT404';
  end if;

  select b.* into v_business
  from public.businesses b
  where b.id = v_professional.business_id and b.is_published and b.is_active;

  if not found then
    raise exception 'BUSINESS_NOT_PUBLIC' using errcode = 'PT404';
  end if;

  select s.* into v_service
  from public.services s
  join public.professional_services ps
    on ps.service_id = s.id
   and ps.professional_id = p_professional_id
   and ps.is_active
  where s.id = p_service_id
    and s.is_active
    and s.business_id = v_business.id;

  if not found then
    raise exception 'SERVICE_NOT_AVAILABLE' using errcode = 'PT404';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_minutes);
  v_occupied := tstzrange(
    p_starts_at - make_interval(mins => v_service.buffer_before_minutes),
    v_ends_at + make_interval(mins => v_service.buffer_after_minutes),
    '[)'
  );

  if p_starts_at < now() + make_interval(mins => v_business.minimum_notice_minutes) then
    raise exception 'TOO_SOON' using errcode = '22023';
  end if;

  if (p_starts_at at time zone v_business.timezone)::date
       > ((now() at time zone v_business.timezone)::date + v_business.booking_horizon_days) then
    raise exception 'BEYOND_HORIZON' using errcode = '22023';
  end if;

  -- Serialise concurrent attempts on the same calendar. The exclusion
  -- constraint below is still the guarantee; this only turns a lost race into
  -- a clean wait instead of a rollback.
  perform pg_advisory_xact_lock(hashtextextended(p_professional_id::text, 0));

  if not public.is_slot_within_availability(
       p_professional_id, v_business.timezone, p_starts_at, v_ends_at) then
    raise exception 'OUTSIDE_AVAILABILITY' using errcode = '22023';
  end if;

  -- The appointment fits inside working hours; it must also sit on the grid
  -- the business publishes.
  if not public.is_slot_aligned(
       p_professional_id, v_business.timezone, p_starts_at, v_ends_at,
       v_business.slot_interval_minutes) then
    raise exception 'SLOT_NOT_ALIGNED' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.blocked_times b
    where b.professional_id = p_professional_id
      and b.blocked_range && v_occupied
  ) then
    raise exception 'SLOT_BLOCKED' using errcode = '22023';
  end if;

  insert into public.customers (business_id, full_name, email, phone)
  values (
    v_business.id,
    btrim(p_customer_name),
    nullif(btrim(coalesce(p_customer_email, '')), ''),
    btrim(p_customer_phone)
  )
  on conflict (business_id, phone) do update
    set full_name = excluded.full_name,
        email = coalesce(excluded.email, customers.email)
  returning id into v_customer_id;

  begin
    insert into public.appointments (
      business_id, professional_id, customer_id, starts_at, ends_at,
      buffer_before_minutes, buffer_after_minutes, status, source, notes
    )
    values (
      v_business.id,
      p_professional_id,
      v_customer_id,
      p_starts_at,
      v_ends_at,
      v_service.buffer_before_minutes,
      v_service.buffer_after_minutes,
      (case when v_business.auto_confirm_bookings then 'confirmed' else 'pending' end)::public.appointment_status,
      'public_page',
      nullif(btrim(coalesce(p_notes, '')), '')
    )
    returning * into v_appointment;
  exception
    when exclusion_violation then
      -- Someone else won the race. This is the promise of the product.
      raise exception 'SLOT_TAKEN' using errcode = '23P01';
  end;

  insert into public.appointment_items (
    appointment_id, service_id, service_name_snapshot,
    duration_minutes_snapshot, price_snapshot, currency_snapshot
  )
  values (
    v_appointment.id,
    v_service.id,
    v_service.name,
    v_service.duration_minutes,
    v_service.price,
    v_service.currency
  );

  return jsonb_build_object(
    'appointmentId', v_appointment.id,
    'accessToken', v_appointment.access_token,
    'status', v_appointment.status,
    'startsAt', v_appointment.starts_at,
    'endsAt', v_appointment.ends_at,
    'timezone', v_business.timezone,
    'businessName', v_business.name,
    'professionalName', v_professional.display_name,
    'serviceName', v_service.name,
    'price', v_service.price,
    'currency', v_service.currency
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_appointment_by_token(p_appointment_id uuid, p_access_token uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_appointment public.appointments;
begin
  -- Phase 5: a guest acting through their own booking link.
  perform public.declare_appointment_actor('guest');

  select a.* into v_appointment
  from public.appointments a
  where a.id = p_appointment_id
    and a.access_token = p_access_token
  for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  if v_appointment.status in ('cancelled', 'completed', 'no_show') then
    raise exception 'APPOINTMENT_NOT_CANCELLABLE' using errcode = '22023';
  end if;

  if v_appointment.starts_at <= now() then
    raise exception 'APPOINTMENT_ALREADY_STARTED' using errcode = '22023';
  end if;

  update public.appointments
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_appointment_id
  returning * into v_appointment;

  return jsonb_build_object(
    'appointmentId', v_appointment.id,
    'status', v_appointment.status,
    'cancelledAt', v_appointment.cancelled_at
  );
end;
$function$
;

-- ---------------------------------------------------------------------------
-- The professional's calendar is theirs; the public grid is a promise to
-- customers, not a constraint on the owner.
--
-- Both professional operations below share one rule set, described in full in
-- docs/DECISIONS/0015. In short:
--
--   always enforced   tenant authorization, the business being active, the
--                     appointment's own duration and buffers, blocked time,
--                     and overlap with another appointment
--   never enforced    slot interval alignment, minimum notice, booking
--                     horizon -- all three are customer-facing courtesies
--   enforced unless
--   overridden        working hours and exceptions
--
-- The public availability engine is untouched by this, and it cannot leak an
-- off-grid appointment: get_available_slots generates candidates from the grid
-- and then subtracts busy time, so a 10:07 squeeze-in removes the grid slots
-- it overlaps and adds nothing.
-- ---------------------------------------------------------------------------

create or replace function public.assert_professional_slot_is_free(
  p_professional_id uuid,
  p_timezone text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_occupied tstzrange,
  p_override_schedule boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not p_override_schedule then
    if not public.is_slot_within_availability(
         p_professional_id, p_timezone, p_starts_at, p_ends_at) then
      raise exception 'OUTSIDE_AVAILABILITY' using errcode = '22023';
    end if;
  end if;

  -- Blocked time is never overridden. A professional who blocked a period said
  -- something deliberate about it; the safe answer is to make them unblock it
  -- rather than to quietly book over their own statement.
  if exists (
    select 1 from public.blocked_times b
    where b.professional_id = p_professional_id
      and b.blocked_range && p_occupied
  ) then
    raise exception 'SLOT_BLOCKED' using errcode = '22023';
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Moving an appointment, without it ever ceasing to exist.
--
-- One UPDATE. The exclusion constraint is checked as part of that statement,
-- so either the appointment holds the new time or the transaction rolls back
-- and it still holds the old one. There is no window in which the original
-- slot has been released and the new one not yet acquired -- which is the
-- invariant that makes this safe to offer to a guest.
--
-- Rescheduling is orthogonal to status: a pending appointment that moves is
-- still pending, a confirmed one still confirmed. Moving something is not a
-- lifecycle transition, it is the same commitment at a different time.
-- ---------------------------------------------------------------------------

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_reason text default null,
  p_override_schedule boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_appointment public.appointments;
  v_business public.businesses;
  v_duration interval;
  v_ends_at timestamptz;
  v_occupied tstzrange;
begin
  select a.* into v_appointment
  from public.appointments a
  where a.id = p_appointment_id
  for update;

  -- Invisible and absent look the same, so an id cannot be probed.
  if not found or not public.can_manage_professional(v_appointment.professional_id) then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'APPOINTMENT_NOT_RESCHEDULABLE' using errcode = '22023';
  end if;

  select b.* into v_business
  from public.businesses b
  where b.id = v_appointment.business_id and b.is_active;

  if not found then
    raise exception 'BUSINESS_NOT_ACTIVE' using errcode = '22023';
  end if;

  if p_starts_at = v_appointment.starts_at then
    return jsonb_build_object(
      'appointmentId', v_appointment.id,
      'startsAt', v_appointment.starts_at,
      'endsAt', v_appointment.ends_at,
      'moved', false
    );
  end if;

  -- The appointment carries its own duration and buffers, snapshotted when it
  -- was booked. Re-reading the service would silently resize a customer's
  -- appointment because a price list changed.
  v_duration := v_appointment.ends_at - v_appointment.starts_at;
  v_ends_at := p_starts_at + v_duration;
  v_occupied := tstzrange(
    p_starts_at - make_interval(mins => v_appointment.buffer_before_minutes),
    v_ends_at + make_interval(mins => v_appointment.buffer_after_minutes),
    '[)'
  );

  perform pg_advisory_xact_lock(hashtextextended(v_appointment.professional_id::text, 0));

  perform public.assert_professional_slot_is_free(
    v_appointment.professional_id, v_business.timezone,
    p_starts_at, v_ends_at, v_occupied, p_override_schedule
  );

  perform public.declare_appointment_actor('professional', p_reason);

  begin
    update public.appointments
    set starts_at = p_starts_at,
        ends_at = v_ends_at
    where id = p_appointment_id
    returning * into v_appointment;
  exception
    when exclusion_violation then
      -- Somebody else holds the new time. Nothing has been given up: the
      -- statement is rolled back and the appointment keeps the time it had.
      raise exception 'SLOT_TAKEN' using errcode = '23P01';
  end;

  return jsonb_build_object(
    'appointmentId', v_appointment.id,
    'startsAt', v_appointment.starts_at,
    'endsAt', v_appointment.ends_at,
    'moved', true
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- The same move, offered to the guest who holds the booking link.
--
-- The guest is a customer, so this obeys the customer rules exactly: the
-- published grid, minimum notice and the booking horizon all apply, because
-- the guest is choosing from what the public page offered them. It reuses the
-- same helpers book_appointment uses, so the two cannot drift.
-- ---------------------------------------------------------------------------

create or replace function public.reschedule_appointment_by_token(
  p_appointment_id uuid,
  p_access_token uuid,
  p_starts_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_appointment public.appointments;
  v_business public.businesses;
  v_duration interval;
  v_ends_at timestamptz;
  v_occupied tstzrange;
begin
  select a.* into v_appointment
  from public.appointments a
  where a.id = p_appointment_id
    and a.access_token = p_access_token
  for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'APPOINTMENT_NOT_RESCHEDULABLE' using errcode = '22023';
  end if;

  -- You cannot move something that has already begun; that is a conversation
  -- with the professional, not a self-service action.
  if v_appointment.starts_at <= now() then
    raise exception 'APPOINTMENT_ALREADY_STARTED' using errcode = '22023';
  end if;

  select b.* into v_business
  from public.businesses b
  where b.id = v_appointment.business_id and b.is_published and b.is_active;

  if not found then
    raise exception 'BUSINESS_NOT_PUBLIC' using errcode = '22023';
  end if;

  if p_starts_at = v_appointment.starts_at then
    return jsonb_build_object(
      'appointmentId', v_appointment.id,
      'startsAt', v_appointment.starts_at,
      'endsAt', v_appointment.ends_at,
      'moved', false
    );
  end if;

  v_duration := v_appointment.ends_at - v_appointment.starts_at;
  v_ends_at := p_starts_at + v_duration;
  v_occupied := tstzrange(
    p_starts_at - make_interval(mins => v_appointment.buffer_before_minutes),
    v_ends_at + make_interval(mins => v_appointment.buffer_after_minutes),
    '[)'
  );

  if p_starts_at < now() + make_interval(mins => v_business.minimum_notice_minutes) then
    raise exception 'TOO_SOON' using errcode = '22023';
  end if;

  if (p_starts_at at time zone v_business.timezone)::date
       > ((now() at time zone v_business.timezone)::date + v_business.booking_horizon_days) then
    raise exception 'BEYOND_HORIZON' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_appointment.professional_id::text, 0));

  if not public.is_slot_within_availability(
       v_appointment.professional_id, v_business.timezone, p_starts_at, v_ends_at) then
    raise exception 'OUTSIDE_AVAILABILITY' using errcode = '22023';
  end if;

  if not public.is_slot_aligned(
       v_appointment.professional_id, v_business.timezone, p_starts_at, v_ends_at,
       v_business.slot_interval_minutes) then
    raise exception 'SLOT_NOT_ALIGNED' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.blocked_times b
    where b.professional_id = v_appointment.professional_id
      and b.blocked_range && v_occupied
  ) then
    raise exception 'SLOT_BLOCKED' using errcode = '22023';
  end if;

  perform public.declare_appointment_actor('guest');

  begin
    update public.appointments
    set starts_at = p_starts_at,
        ends_at = v_ends_at
    where id = p_appointment_id
    returning * into v_appointment;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = '23P01';
  end;

  return jsonb_build_object(
    'appointmentId', v_appointment.id,
    'startsAt', v_appointment.starts_at,
    'endsAt', v_appointment.ends_at,
    'moved', true
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- The professional entering an appointment themselves: a phone call, a
-- walk-in, a regular who always comes on Thursdays.
--
-- Always 'confirmed'. auto_confirm_bookings exists so a shop can screen
-- strangers from the internet; a professional does not need to approve their
-- own entry.
--
-- The customer is matched on phone within the business, which is the identity
-- the schema has always used (customers is unique on business_id, phone) and
-- the same rule book_appointment follows. Names are never matched on: two
-- people called Maria are two people.
-- ---------------------------------------------------------------------------

create or replace function public.create_manual_appointment(
  p_professional_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text default null,
  p_notes text default null,
  p_override_schedule boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_professional public.professional_profiles;
  v_business public.businesses;
  v_service public.services;
  v_customer_id uuid;
  v_ends_at timestamptz;
  v_occupied tstzrange;
  v_appointment public.appointments;
begin
  if coalesce(btrim(p_customer_name), '') = '' then
    raise exception 'CUSTOMER_NAME_REQUIRED' using errcode = '22023';
  end if;

  if coalesce(btrim(p_customer_phone), '') = '' then
    raise exception 'CUSTOMER_PHONE_REQUIRED' using errcode = '22023';
  end if;

  -- Authorization first, and it is the only thing that distinguishes this
  -- from the public path. SECURITY DEFINER means RLS is not going to do it.
  if not public.can_manage_professional(p_professional_id) then
    raise exception 'PROFESSIONAL_NOT_FOUND' using errcode = 'PT404';
  end if;

  select p.* into v_professional
  from public.professional_profiles p
  where p.id = p_professional_id;

  -- Unlike the public path, is_published is not required: a shop should be
  -- able to run its book before it goes live.
  select b.* into v_business
  from public.businesses b
  where b.id = v_professional.business_id and b.is_active;

  if not found then
    raise exception 'BUSINESS_NOT_ACTIVE' using errcode = '22023';
  end if;

  select s.* into v_service
  from public.services s
  join public.professional_services ps
    on ps.service_id = s.id
   and ps.professional_id = p_professional_id
   and ps.is_active
  where s.id = p_service_id
    and s.is_active
    and s.business_id = v_business.id;

  if not found then
    raise exception 'SERVICE_NOT_AVAILABLE' using errcode = 'PT404';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_minutes);
  v_occupied := tstzrange(
    p_starts_at - make_interval(mins => v_service.buffer_before_minutes),
    v_ends_at + make_interval(mins => v_service.buffer_after_minutes),
    '[)'
  );

  perform pg_advisory_xact_lock(hashtextextended(p_professional_id::text, 0));

  perform public.assert_professional_slot_is_free(
    p_professional_id, v_business.timezone,
    p_starts_at, v_ends_at, v_occupied, p_override_schedule
  );

  insert into public.customers (business_id, full_name, email, phone)
  values (
    v_business.id,
    btrim(p_customer_name),
    nullif(btrim(coalesce(p_customer_email, '')), ''),
    btrim(p_customer_phone)
  )
  on conflict (business_id, phone) do update
    set full_name = excluded.full_name,
        email = coalesce(excluded.email, customers.email)
  returning id into v_customer_id;

  perform public.declare_appointment_actor('professional');

  begin
    insert into public.appointments (
      business_id, professional_id, customer_id, starts_at, ends_at,
      buffer_before_minutes, buffer_after_minutes, status, source, notes
    )
    values (
      v_business.id,
      p_professional_id,
      v_customer_id,
      p_starts_at,
      v_ends_at,
      v_service.buffer_before_minutes,
      v_service.buffer_after_minutes,
      'confirmed',
      'manual',
      nullif(btrim(coalesce(p_notes, '')), '')
    )
    returning * into v_appointment;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = '23P01';
  end;

  insert into public.appointment_items (
    appointment_id, service_id, service_name_snapshot,
    duration_minutes_snapshot, price_snapshot, currency_snapshot
  )
  values (
    v_appointment.id,
    v_service.id,
    v_service.name,
    v_service.duration_minutes,
    v_service.price,
    v_service.currency
  );

  return jsonb_build_object(
    'appointmentId', v_appointment.id,
    'status', v_appointment.status,
    'startsAt', v_appointment.starts_at,
    'endsAt', v_appointment.ends_at
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants, classified. See supabase/tests/function_grants.sql, which fails the
-- build if any of this drifts.
-- ---------------------------------------------------------------------------

-- INTERNAL ONLY: called by the two professional operations, and by nothing
-- else. Exposing it would let a caller probe a private calendar.
revoke all on function public.assert_professional_slot_is_free(uuid, text, timestamptz, timestamptz, tstzrange, boolean)
  from public, anon, authenticated;

-- AUTHENTICATED PROFESSIONAL.
revoke all on function public.reschedule_appointment(uuid, timestamptz, text, boolean)
  from public, anon;
revoke all on function public.create_manual_appointment(uuid, uuid, timestamptz, text, text, text, text, boolean)
  from public, anon;

grant execute on function public.reschedule_appointment(uuid, timestamptz, text, boolean)
  to authenticated;
grant execute on function public.create_manual_appointment(uuid, uuid, timestamptz, text, text, text, text, boolean)
  to authenticated;

-- PUBLIC / ANON-SAFE: the credential is the booking link, exactly as it is for
-- reading and cancelling.
revoke all on function public.reschedule_appointment_by_token(uuid, uuid, timestamptz) from public;
grant execute on function public.reschedule_appointment_by_token(uuid, uuid, timestamptz)
  to anon, authenticated;
