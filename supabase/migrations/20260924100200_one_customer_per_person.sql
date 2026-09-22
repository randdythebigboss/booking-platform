-- ===========================================================================
-- Both booking paths find a returning customer the same way.
--
-- Regenerated from the live definitions; the only change in each is the
-- customer lookup, which now goes through find_customer_by_phone instead of
-- relying on the raw-string upsert. The upsert is still there as the insert's
-- conflict target, so a genuine race on the exact same string still resolves
-- the way it always did.
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

  -- Punctuation-insensitive within this business, and nothing looser: see
  -- find_customer_by_phone and docs/DECISIONS/0017.
  v_customer_id := public.find_customer_by_phone(v_business.id, p_customer_phone);

  if v_customer_id is null then
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
  else
    -- A returning customer. The name they gave this time wins, exactly as the
    -- upsert did; an email is only ever added, never cleared.
    update public.customers
    set full_name = btrim(p_customer_name),
        email = coalesce(nullif(btrim(coalesce(p_customer_email, '')), ''), email)
    where id = v_customer_id;
  end if;

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

CREATE OR REPLACE FUNCTION public.create_manual_appointment(p_professional_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_customer_name text, p_customer_phone text, p_customer_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_override_schedule boolean DEFAULT false)
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

  -- Punctuation-insensitive within this business, and nothing looser: see
  -- find_customer_by_phone and docs/DECISIONS/0017.
  v_customer_id := public.find_customer_by_phone(v_business.id, p_customer_phone);

  if v_customer_id is null then
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
  else
    -- A returning customer. The name they gave this time wins, exactly as the
    -- upsert did; an email is only ever added, never cleared.
    update public.customers
    set full_name = btrim(p_customer_name),
        email = coalesce(nullif(btrim(coalesce(p_customer_email, '')), ''), email)
    where id = v_customer_id;
  end if;

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
$function$
;

