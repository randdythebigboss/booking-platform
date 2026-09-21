-- ===========================================================================
-- "Not found" must not be a server error.
--
-- These functions raised P0002 (no_data_found) for every hidden or missing
-- resource. PostgREST maps that to HTTP 500, so a guest opening a
-- confirmation link with a stale token got a server error, and probing an id
-- produced one too. The client coped, but only because it matched on the
-- message -- and a 500 in the logs hides the real ones.
--
-- PostgREST reads a SQLSTATE of the form PTnnn as "respond with HTTP nnn",
-- so these now answer 404. The sentinel messages are unchanged, so nothing
-- that maps them has to change with them.
--
-- Regenerated from the live definitions: the bodies are identical apart from
-- the error code.
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

CREATE OR REPLACE FUNCTION public.get_appointment_by_token(p_appointment_id uuid, p_access_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'appointmentId', a.id,
    'status', a.status,
    'startsAt', a.starts_at,
    'endsAt', a.ends_at,
    'notes', a.notes,
    'timezone', b.timezone,
    'businessName', b.name,
    'businessSlug', b.slug,
    'businessPhone', b.phone,
    'businessAddress', b.address,
    'professionalName', p.display_name,
    'customerName', c.full_name,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.service_name_snapshot,
        'durationMinutes', i.duration_minutes_snapshot,
        'price', i.price_snapshot,
        'currency', i.currency_snapshot
      ))
      from public.appointment_items i
      where i.appointment_id = a.id
    ), '[]'::jsonb),
    'canCancel', a.status in ('pending', 'confirmed') and a.starts_at > now()
  )
  into v_result
  from public.appointments a
  join public.businesses b on b.id = a.business_id
  join public.professional_profiles p on p.id = a.professional_id
  join public.customers c on c.id = a.customer_id
  where a.id = p_appointment_id
    and a.access_token = p_access_token;

  if v_result is null then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_availability_context(p_professional_id uuid, p_service_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_professional public.professional_profiles;
  v_business public.businesses;
  v_service public.services;
  v_window tstzrange;
begin
  if p_to < p_from then
    raise exception 'INVALID_RANGE' using errcode = '22023';
  end if;

  if p_to - p_from > 62 then
    raise exception 'RANGE_TOO_WIDE' using errcode = '22023';
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

  -- One spare day on each side so buffers straddling midnight are included.
  v_window := tstzrange(
    ((p_from - 1)::timestamp) at time zone v_business.timezone,
    ((p_to + 2)::timestamp) at time zone v_business.timezone,
    '[)'
  );

  return jsonb_build_object(
    'timezone', v_business.timezone,
    'policy', jsonb_build_object(
      'slotIntervalMinutes', v_business.slot_interval_minutes,
      'minimumNoticeMinutes', v_business.minimum_notice_minutes,
      'bookingHorizonDays', v_business.booking_horizon_days
    ),
    'service', jsonb_build_object(
      'id', v_service.id,
      'name', v_service.name,
      'durationMinutes', v_service.duration_minutes,
      'bufferBeforeMinutes', v_service.buffer_before_minutes,
      'bufferAfterMinutes', v_service.buffer_after_minutes,
      'price', v_service.price,
      'currency', v_service.currency
    ),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', r.weekday,
        'startTime', public.time_to_clock(r.start_time),
        'endTime', public.time_to_clock(r.end_time),
        'effectiveFrom', r.effective_from,
        'effectiveUntil', r.effective_until
      ) order by r.weekday, r.start_time)
      from public.availability_rules r
      where r.professional_id = p_professional_id and r.is_active
    ), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', e.exception_date,
        'type', e.exception_type,
        'startTime', case when e.start_time is null then null else public.time_to_clock(e.start_time) end,
        'endTime', case when e.end_time is null then null else public.time_to_clock(e.end_time) end
      ) order by e.exception_date)
      from public.availability_exceptions e
      where e.professional_id = p_professional_id
        and e.exception_date between p_from - 1 and p_to + 1
    ), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(jsonb_build_object('startsAt', lower(t.r), 'endsAt', upper(t.r)) order by lower(t.r))
      from (
        select a.blocked_range as r
        from public.appointments a
        where a.professional_id = p_professional_id
          and a.status in ('pending', 'confirmed')
          and a.blocked_range && v_window
        union all
        select b.blocked_range
        from public.blocked_times b
        where b.professional_id = p_professional_id
          and b.blocked_range && v_window
      ) t
    ), '[]'::jsonb)
  );
end;
$function$
;
