-- ===========================================================================
-- Enforce slot_interval_minutes server-side.
--
-- Working hours, exceptions, blocks, notice, horizon and overlap were already
-- re-checked by book_appointment. The slot interval was not: a request that
-- skipped the UI could book 09:07 on a calendar that only ever offers 09:00,
-- 09:15, 09:30 and 09:45.
--
-- The rule matches the engine exactly (src/features/availability/slots.ts):
-- candidate starts are aligned to the START OF THE WORKING WINDOW, not to
-- midnight and not to the clock hour. A shift opening at 09:10 offers 09:10
-- and 09:25, which is what the professional asked for.
--
-- Alignment is measured in real elapsed time from a window start that is
-- itself derived from business-local wall clock, so it stays correct across
-- daylight saving transitions.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The working windows of one professional on one business-local date.
--
-- Extracted so containment and alignment cannot drift apart: both now read
-- the same definition of "when is this person open".
-- ---------------------------------------------------------------------------

create or replace function public.working_windows(
  p_professional_id uuid,
  p_timezone text,
  p_date date
)
returns setof tstzrange
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_weekday smallint := extract(dow from p_date)::smallint;
  v_has_override boolean;
begin
  -- An untimed "unavailable" exception closes the whole day.
  if exists (
    select 1 from public.availability_exceptions e
    where e.professional_id = p_professional_id
      and e.exception_date = p_date
      and e.exception_type = 'unavailable'
      and e.start_time is null
  ) then
    return;
  end if;

  select exists (
    select 1 from public.availability_exceptions e
    where e.professional_id = p_professional_id
      and e.exception_date = p_date
      and e.exception_type = 'available'
  ) into v_has_override;

  if v_has_override then
    -- An "available" exception replaces the weekly rules for that date.
    return query
      select tstzrange(
        (p_date + e.start_time) at time zone p_timezone,
        (p_date + e.end_time) at time zone p_timezone,
        '[)'
      )
      from public.availability_exceptions e
      where e.professional_id = p_professional_id
        and e.exception_date = p_date
        and e.exception_type = 'available';
  else
    return query
      select tstzrange(
        (p_date + r.start_time) at time zone p_timezone,
        (p_date + r.end_time) at time zone p_timezone,
        '[)'
      )
      from public.availability_rules r
      where r.professional_id = p_professional_id
        and r.is_active
        and r.weekday = v_weekday
        and (r.effective_from is null or p_date >= r.effective_from)
        and (r.effective_until is null or p_date <= r.effective_until);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Containment, now reading the shared window definition.
-- ---------------------------------------------------------------------------

create or replace function public.is_slot_within_availability(
  p_professional_id uuid,
  p_timezone text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_date date := (p_starts_at at time zone p_timezone)::date;
  v_requested tstzrange := tstzrange(p_starts_at, p_ends_at, '[)');
  v_contained boolean;
begin
  select bool_or(w @> v_requested)
  into v_contained
  from public.working_windows(p_professional_id, p_timezone, v_date) w;

  if coalesce(v_contained, false) = false then
    return false;
  end if;

  -- Timed closures are subtracted from whatever the base schedule allowed.
  if exists (
    select 1 from public.availability_exceptions e
    where e.professional_id = p_professional_id
      and e.exception_date = v_date
      and e.exception_type = 'unavailable'
      and e.start_time is not null
      and tstzrange(
            (v_date + e.start_time) at time zone p_timezone,
            (v_date + e.end_time) at time zone p_timezone,
            '[)'
          ) && v_requested
  ) then
    return false;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Alignment to the configured slot interval.
-- ---------------------------------------------------------------------------

create or replace function public.is_slot_aligned(
  p_professional_id uuid,
  p_timezone text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_slot_interval_minutes integer
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_date date := (p_starts_at at time zone p_timezone)::date;
  v_requested tstzrange := tstzrange(p_starts_at, p_ends_at, '[)');
  v_aligned boolean;
begin
  if p_slot_interval_minutes is null or p_slot_interval_minutes <= 0 then
    return false;
  end if;

  -- Only the window that actually contains the appointment can define the
  -- grid it sits on.
  select bool_or(
    mod(
      extract(epoch from (p_starts_at - lower(w)))::bigint,
      (p_slot_interval_minutes * 60)::bigint
    ) = 0
  )
  into v_aligned
  from public.working_windows(p_professional_id, p_timezone, v_date) w
  where w @> v_requested;

  return coalesce(v_aligned, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- book_appointment, with the alignment gate added after the availability
-- check and before anything is written.
-- ---------------------------------------------------------------------------

create or replace function public.book_appointment(
  p_professional_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
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

  select p.* into v_professional
  from public.professional_profiles p
  where p.id = p_professional_id and p.is_bookable;

  if not found then
    raise exception 'PROFESSIONAL_NOT_BOOKABLE' using errcode = 'P0002';
  end if;

  select b.* into v_business
  from public.businesses b
  where b.id = v_professional.business_id and b.is_published and b.is_active;

  if not found then
    raise exception 'BUSINESS_NOT_PUBLIC' using errcode = 'P0002';
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
    raise exception 'SERVICE_NOT_AVAILABLE' using errcode = 'P0002';
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
$$;

-- ---------------------------------------------------------------------------
-- Grants. The two helpers stay internal: exposing them would let a stranger
-- map a private calendar one timestamp at a time.
-- ---------------------------------------------------------------------------

revoke all on function public.working_windows(uuid, text, date) from public;
revoke all on function public.is_slot_aligned(uuid, text, timestamptz, timestamptz, integer) from public;
revoke all on function public.is_slot_within_availability(uuid, text, timestamptz, timestamptz) from public;

grant execute on function public.book_appointment(uuid, uuid, timestamptz, text, text, text, text)
  to anon, authenticated;
