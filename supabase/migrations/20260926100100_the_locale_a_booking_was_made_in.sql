-- ===========================================================================
-- The language a booking was made in, remembered on the booking.
--
-- A notification has to pick a language before anybody is there to read it,
-- and it must pick the same one every time: a message already queued in
-- Spanish does not become English because a professional later switched the
-- interface. `profiles.preferred_locale` answers "what language does this
-- signed-in user read", which is the wrong question for a guest who has no
-- account, and a moving target for everybody else.
--
-- So the appointment records the language it was made in, once, and a
-- notification copies it at the moment it is queued.
--
-- Plain text with a shape check rather than an enum or a list of supported
-- languages: adding a language must stay a code change (ADR 0017), and an
-- unsupported tag falls back to Spanish where the message is rendered,
-- exactly as the interface does.
--
-- Both booking functions are reproduced in full below, as
-- 20260924100200_one_customer_per_person.sql did: the only change in each is
-- the new trailing argument and the column it fills.
-- ===========================================================================

alter table public.appointments
  add column customer_locale text not null default 'es'
    constraint appointments_customer_locale_shape
      check (customer_locale ~ '^[a-z]{2}(-[A-Za-z]{2,4})?$');

comment on column public.appointments.customer_locale is
  'The language this booking was made in. Frozen at booking time and copied onto every notification queued for it, so a queued message never changes language.';

-- ---------------------------------------------------------------------------
-- The guest booking path.
--
-- The argument is trailing and defaulted, so an older client -- and PostgREST,
-- which resolves by argument name -- keeps working unchanged and lands on the
-- Spanish default.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.book_appointment(
  p_professional_id uuid,
  p_service_id uuid,
  p_starts_at timestamp with time zone,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_locale text DEFAULT NULL::text
)
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
  -- find_customer_by_phone and ADR 0018.
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
    -- upsert did; an email is only ever added, never cleared. What this
    -- booking said is frozen onto the appointment by the snapshot trigger.
    update public.customers
    set full_name = btrim(p_customer_name),
        email = coalesce(nullif(btrim(coalesce(p_customer_email, '')), ''), email)
    where id = v_customer_id;
  end if;

  begin
    insert into public.appointments (
      business_id, professional_id, customer_id, starts_at, ends_at,
      buffer_before_minutes, buffer_after_minutes, status, source, notes,
      customer_locale
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
      nullif(btrim(coalesce(p_notes, '')), ''),
      coalesce(nullif(btrim(coalesce(p_locale, '')), ''), 'es')
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
    'endsAt', v_appointment.ends_at
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- The professional's own booking path.
--
-- Reproduced from the live definition; the only change is the trailing
-- argument and the column it fills. Here the language is the one the
-- professional is working in: it is the best guess available for somebody who
-- phoned in, because nobody asked them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_manual_appointment(
  p_professional_id uuid,
  p_service_id uuid,
  p_starts_at timestamp with time zone,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_override_schedule boolean DEFAULT false,
  p_locale text DEFAULT NULL::text
)
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
  -- find_customer_by_phone and docs/DECISIONS/0018.
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
      buffer_before_minutes, buffer_after_minutes, status, source, notes,
      customer_locale
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
      nullif(btrim(coalesce(p_notes, '')), ''),
      coalesce(nullif(btrim(coalesce(p_locale, '')), ''), 'es')
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
$function$;

-- The older signatures would otherwise stay behind and keep inserting
-- appointments with no language recorded: PostgREST picks an overload by the
-- arguments it is given, so leaving them would make the Spanish default
-- silent rather than deliberate.
drop function if exists public.book_appointment(uuid, uuid, timestamptz, text, text, text, text);
drop function if exists public.create_manual_appointment(uuid, uuid, timestamptz, text, text, text, text, boolean);

-- Creating a function resets its grants to the Supabase defaults, which
-- include EXECUTE for anon and authenticated. Restate the classification that
-- 20260922110000_classify_function_grants.sql established.
revoke all on function public.book_appointment(uuid, uuid, timestamptz, text, text, text, text, text)
  from public;
grant execute on function public.book_appointment(uuid, uuid, timestamptz, text, text, text, text, text)
  to anon, authenticated;

revoke all on function public.create_manual_appointment(uuid, uuid, timestamptz, text, text, text, text, boolean, text)
  from public, anon;
grant execute on function public.create_manual_appointment(uuid, uuid, timestamptz, text, text, text, text, boolean, text)
  to authenticated;
