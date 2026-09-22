-- ===========================================================================
-- Phase 9 - a slot can be held while somebody pays.
--
-- Without this, paid booking has a hole you could drive a bus through:
--
--     customer picks 10:00 -> starts paying -> somebody else takes 10:00
--     -> the first customer's money arrives for a slot that is gone
--
-- So the appointment *is* the hold. It is created immediately, occupying the
-- slot through the same exclusion constraint that has prevented double
-- booking since the first schema, and it carries an expiry. Pay, and the
-- expiry is cleared and the appointment becomes real. Walk away, and it is
-- released.
--
-- Deliberately not a separate `holds` table. A parallel concept would need
-- its own overlap rules, its own race, and its own way of being reconciled
-- with appointments -- three chances to disagree with the constraint that is
-- already correct.
--
-- Expiry without a scheduler, which is the part worth reading:
--
--   * **Reads** never show an expired hold as busy. Availability treats
--     `hold_expires_at < now()` as free, so the slot reappears the moment the
--     hold lapses, whether or not anything has cleaned up.
--   * **Writes** cannot collide with one. `expire_payment_holds` runs inside
--     the advisory lock every booking takes, so a lapsed hold is cancelled
--     before the new booking is checked against it.
--   * **Nothing rots.** The public page's own availability read releases what
--     it finds, which means the cleanup happens wherever customers are
--     looking, without a cron job to deploy or forget.
--
-- Fifteen minutes, deliberately short: long enough to finish a card form and
-- a bank app, short enough that an abandoned checkout is not somebody else's
-- lost appointment. It is a function rather than a column because nobody has
-- asked to configure it, and a setting nobody changes is a setting to
-- maintain.
-- ===========================================================================

alter table public.appointments
  add column hold_expires_at timestamptz;

comment on column public.appointments.hold_expires_at is
  'While set and in the future, this appointment is a hold: the slot is occupied but the booking is not final. Cleared when the payment succeeds; the appointment is cancelled when it lapses.';

create index appointments_hold_expiry_idx
  on public.appointments (professional_id, hold_expires_at)
  where hold_expires_at is not null;

create or replace function public.payment_hold_minutes()
returns integer
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fn$
  select 15;
$fn$;

/**
 * Releases holds whose time ran out.
 *
 * Cancels the appointment -- which is what frees the slot, since the exclusion
 * constraint only counts pending and confirmed rows -- and cancels the payment
 * that was waiting for it, so nothing is left `pending` forever.
 *
 * A hold that has been paid is not a hold any more and is never touched here:
 * the paid case clears `hold_expires_at` in the same statement that records
 * the payment, so a callback that arrives late cannot find its appointment
 * cancelled underneath it.
 */
create or replace function public.expire_payment_holds(p_professional_id uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_count integer;
  v_actor text;
  v_reason text;
begin
  -- The actor is the system: nobody decided this, the clock did.
  --
  -- Saved and put back, because this runs *inside* other people's
  -- transactions -- a guest booking calls it before taking their slot -- and
  -- the actor setting is transaction-scoped. Leaving it as 'system' would
  -- make the caller's own appointment look like something nobody did.
  v_actor := current_setting('app.actor_type', true);
  v_reason := current_setting('app.event_reason', true);
  perform public.declare_appointment_actor('system', 'El tiempo para pagar se agotó');

  with lapsed as (
    select a.id
    from public.appointments a
    where a.hold_expires_at is not null
      and a.hold_expires_at <= now()
      and a.status in ('pending', 'confirmed')
      and (p_professional_id is null or a.professional_id = p_professional_id)
      and not exists (
        select 1 from public.payments p
        where p.appointment_id = a.id and p.status in ('paid', 'authorized', 'refunded')
      )
  ),
  released as (
    update public.appointments a
       set status = 'cancelled',
           cancelled_at = now(),
           cancellation_reason = coalesce(a.cancellation_reason, 'PAYMENT_NOT_COMPLETED'),
           hold_expires_at = null
      from lapsed
     where a.id = lapsed.id
    returning a.id
  )
  update public.payments p
     set status = 'cancelled'
   where p.appointment_id in (select id from released)
     and p.status in ('pending', 'requires_action');

  get diagnostics v_count = row_count;

  perform set_config('app.actor_type', coalesce(v_actor, ''), true);
  perform set_config('app.event_reason', coalesce(v_reason, ''), true);

  return v_count;
end;
$fn$;

CREATE OR REPLACE FUNCTION public.get_available_slots(p_professional_id uuid, p_service_id uuid, p_date date)
 RETURNS TABLE(starts_at timestamp with time zone, ends_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_professional public.professional_profiles;
  v_business public.businesses;
  v_service public.services;
  v_today date;
  v_duration interval;
  v_before interval;
  v_after interval;
begin
  -- Every visibility check below returns rather than raising. A stranger
  -- learns "nothing is available", not "that id exists but is hidden".
  select p.* into v_professional
  from public.professional_profiles p
  where p.id = p_professional_id and p.is_bookable;
  if not found then
    return;
  end if;

  select b.* into v_business
  from public.businesses b
  where b.id = v_professional.business_id and b.is_published and b.is_active;
  if not found then
    return;
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
    return;
  end if;

  -- The horizon and the past are business-local questions.
  v_today := (now() at time zone v_business.timezone)::date;
  if p_date < v_today or p_date > v_today + v_business.booking_horizon_days then
    return;
  end if;

  v_duration := make_interval(mins => v_service.duration_minutes);
  v_before := make_interval(mins => v_service.buffer_before_minutes);
  v_after := make_interval(mins => v_service.buffer_after_minutes);

  return query
  with windows as (
    select w as win
    from public.working_windows(p_professional_id, v_business.timezone, p_date) as w
  ),
  closures as (
    -- Timed "unavailable" exceptions carve holes in the day without moving
    -- the grid: the shift start still anchors it.
    select tstzrange(
             (p_date + e.start_time) at time zone v_business.timezone,
             (p_date + e.end_time) at time zone v_business.timezone,
             '[)'
           ) as r
    from public.availability_exceptions e
    where e.professional_id = p_professional_id
      and e.exception_date = p_date
      and e.exception_type = 'unavailable'
      and e.start_time is not null
  ),
  busy as (
    select a.blocked_range as r
    from public.appointments a
    where a.professional_id = p_professional_id
      and a.status in ('pending', 'confirmed')
      -- A slot held while somebody pays is busy. One whose hold ran out is
      -- not, even before the reaper has cancelled the row.
      and (a.hold_expires_at is null or a.hold_expires_at > now())
    union all
    select b.blocked_range
    from public.blocked_times b
    where b.professional_id = p_professional_id
  ),
  candidates as (
    select
      w.win,
      lower(w.win) + make_interval(mins => (g * v_business.slot_interval_minutes)) as s
    from windows w
    cross join lateral generate_series(
      0,
      greatest(
        0,
        (extract(epoch from (upper(w.win) - lower(w.win)))::bigint
          / greatest(1, v_business.slot_interval_minutes * 60))::int
      )
    ) as g
  )
  select distinct c.s, c.s + v_duration
  from candidates c
  where c.s + v_duration <= upper(c.win)
    and c.s >= now() + make_interval(mins => v_business.minimum_notice_minutes)
    and not exists (
      select 1 from closures cl
      where cl.r && tstzrange(c.s, c.s + v_duration, '[)')
    )
    and not exists (
      select 1 from busy bu
      where bu.r && tstzrange(c.s - v_before, c.s + v_duration + v_after, '[)')
    )
  order by 1;
end;
$function$;CREATE OR REPLACE FUNCTION public.get_availability_context(p_professional_id uuid, p_service_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_professional public.professional_profiles;
  v_business public.businesses;
  v_service public.services;
  v_window tstzrange;
begin
  -- Anything held for a payment that never arrived is released here. This is
  -- the one read every public booking page makes before it shows times, so a
  -- stale hold cannot sit on a slot that nobody is trying to book.
  perform public.expire_payment_holds(p_professional_id);

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
          and (a.hold_expires_at is null or a.hold_expires_at > now())
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
$function$;CREATE OR REPLACE FUNCTION public.book_appointment(p_professional_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_customer_name text, p_customer_phone text, p_customer_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_locale text DEFAULT NULL::text)
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
  v_amount_due numeric(12, 2);
  v_payment public.payments;
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

  -- A slot held by somebody who walked away from the payment page is free
  -- again. Released here, inside the lock, so the check below sees the truth.
  perform public.expire_payment_holds(p_professional_id);

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

  v_amount_due := coalesce(public.service_amount_due(v_service), 0);

  begin
    insert into public.appointments (
      business_id, professional_id, customer_id, starts_at, ends_at,
      buffer_before_minutes, buffer_after_minutes, status, source, notes,
      customer_locale, hold_expires_at
    )
    values (
      v_business.id,
      p_professional_id,
      v_customer_id,
      p_starts_at,
      v_ends_at,
      v_service.buffer_before_minutes,
      v_service.buffer_after_minutes,
      -- Money outranks the auto-confirm setting: an appointment that has not
      -- been paid for is not confirmed, whatever the business would otherwise
      -- do with a free booking.
      (case
         when v_amount_due > 0 then 'pending'
         when v_business.auto_confirm_bookings then 'confirmed'
         else 'pending'
       end)::public.appointment_status,
      'public_page',
      nullif(btrim(coalesce(p_notes, '')), ''),
      coalesce(nullif(btrim(coalesce(p_locale, '')), ''), 'es'),
      case when v_amount_due > 0
        then now() + make_interval(mins => public.payment_hold_minutes())
      end
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

  -- A local insert, and nothing else. Talking to a provider here would let
    -- somebody else's outage fail a booking.
  v_payment := public.create_payment_for_appointment(v_appointment, v_service);

  return jsonb_build_object(
    'appointmentId', v_appointment.id,
    'accessToken', v_appointment.access_token,
    'status', v_appointment.status,
    'startsAt', v_appointment.starts_at,
    'endsAt', v_appointment.ends_at,
    'holdExpiresAt', v_appointment.hold_expires_at,
    'payment', case when v_payment.id is null then null else jsonb_build_object(
      'paymentId', v_payment.id,
      'status', v_payment.status,
      'requirement', v_payment.requirement,
      'amount', v_payment.amount,
      'currency', v_payment.currency
    ) end
  );
end;
$function$;
-- ---------------------------------------------------------------------------
-- What a guest may ask about their own payment, and do with it.
--
-- Both are token-scoped: the booking link is the credential (ADR 0019), and
-- neither reveals anything about a payment whose appointment the caller could
-- not already open.
-- ---------------------------------------------------------------------------

create or replace function public.get_payment_by_token(
  p_appointment_id uuid,
  p_access_token uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_appointment public.appointments;
  v_payment public.payments;
  v_price numeric(12, 2);
begin
  select a.* into v_appointment
  from public.appointments a
  where a.id = p_appointment_id and a.access_token = p_access_token;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  select i.price_snapshot into v_price
  from public.appointment_items i
  where i.appointment_id = v_appointment.id
  order by i.created_at
  limit 1;

  -- The newest payment for this appointment: a retry makes a new row, and the
  -- latest one is the one the customer is looking at.
  select p.* into v_payment
  from public.payments p
  where p.appointment_id = v_appointment.id
  order by p.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('required', false);
  end if;

  return jsonb_build_object(
    'required', true,
    'paymentId', v_payment.id,
    'status', v_payment.status,
    'requirement', v_payment.requirement,
    'amount', v_payment.amount,
    'currency', v_payment.currency,
    'servicePrice', v_price,
    -- What is still owed after this one, if anything. Computed here, in exact
    -- numeric, because money arithmetic does not belong in a browser.
    'remaining', greatest(coalesce(v_price, v_payment.amount) - v_payment.amount, 0),
    'failureCode', v_payment.failure_code,
    'holdExpiresAt', v_appointment.hold_expires_at,
    -- The same switch that decides whether a simulated payment is accepted
    -- also decides whether the buttons for one are drawn. One source of
    -- truth, and it is not a build flag somebody can forget to set.
    'simulationEnabled', public.payment_simulation_enabled()
  );
end;
$fn$;

/**
 * The simulated checkout.
 *
 * This stands in for a real provider and its callback, and it is why
 * `platform_settings.payment_simulation_enabled` exists: where real money is
 * possible, a customer being able to say "it worked" is a way to book without
 * paying. Off unless a deployment turned it on, and the development seed is
 * what turns it on.
 *
 * The scenarios are the ones a real gateway produces:
 *
 *   success   the money moved
 *   decline   the bank said no; a retry is a new payment
 *   pending   accepted, outcome later -- a 3-D Secure challenge, a bank app
 *   failure   the provider itself was unreachable; nothing was decided
 *
 * Idempotent on the key the caller supplies, so a double-clicked button and a
 * retried request leave one outcome.
 */
create or replace function public.simulate_payment_by_token(
  p_appointment_id uuid,
  p_access_token uuid,
  p_scenario text default 'success',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_appointment public.appointments;
  v_payment public.payments;
  v_key text;
begin
  if not public.payment_simulation_enabled() then
    raise exception 'PAYMENT_SIMULATION_DISABLED' using errcode = '22023';
  end if;

  select a.* into v_appointment
  from public.appointments a
  where a.id = p_appointment_id and a.access_token = p_access_token;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  select p.* into v_payment
  from public.payments p
  where p.appointment_id = v_appointment.id
    and p.status in ('pending', 'requires_action')
  order by p.created_at desc
  limit 1;

  if not found then
    -- Nothing is open. Either this is the same click arriving twice -- a
    -- double tap, a retried request, a customer who pressed Back and tried
    -- again -- in which case the honest answer is what already happened, or
    -- there is genuinely nothing to pay.
    select p.* into v_payment
    from public.payments p
    where p.appointment_id = v_appointment.id
    order by p.created_at desc
    limit 1;

    if found and v_payment.status in ('paid', 'refunded') then
      return jsonb_build_object(
        'paymentId', v_payment.id,
        'status', v_payment.status,
        'amount', v_payment.amount,
        'currency', v_payment.currency,
        'failureCode', v_payment.failure_code
      );
    end if;

    raise exception 'NO_PAYMENT_DUE' using errcode = '22023';
  end if;

  -- A hold that has already lapsed cannot be paid for: the slot may belong to
  -- somebody else by now, and taking money for it would be the exact failure
  -- this design exists to prevent.
  if v_appointment.hold_expires_at is not null and v_appointment.hold_expires_at <= now() then
    raise exception 'PAYMENT_HOLD_EXPIRED' using errcode = '22023';
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''),
                    'sim:' || v_payment.id::text || ':' || p_scenario);

  if p_scenario = 'failure' then
    -- The provider never answered. Nothing was decided, so nothing changes and
    -- there is nothing to be idempotent about; the customer may try again.
    raise exception 'PAYMENT_PROVIDER_UNAVAILABLE' using errcode = '22023';
  end if;

  if p_scenario = 'pending' then
    v_payment := public.apply_payment_outcome(
      v_payment.id, 'requires_action', 'mockref_' || substr(v_payment.id::text, 1, 8), null, v_key
    );
  elsif p_scenario = 'decline' then
    v_payment := public.apply_payment_outcome(
      v_payment.id, 'failed', 'mockref_' || substr(v_payment.id::text, 1, 8), 'CARD_DECLINED', v_key
    );
  else
    v_payment := public.apply_payment_outcome(
      v_payment.id, 'paid', 'mockref_' || substr(v_payment.id::text, 1, 8), null, v_key
    );
  end if;

  return jsonb_build_object(
    'paymentId', v_payment.id,
    'status', v_payment.status,
    'amount', v_payment.amount,
    'currency', v_payment.currency,
    'failureCode', v_payment.failure_code
  );
end;
$fn$;

/**
 * The refund, which is a decision somebody makes and never a side effect.
 *
 * Cancelling an appointment does not refund it, and refunding does not cancel
 * it. A business may keep a deposit for a late cancellation, refund a booking
 * it had to cancel itself, or do neither. No policy is assumed here because
 * none has been chosen. See ADR 0023.
 */
create or replace function public.refund_payment(
  p_payment_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_payment public.payments;
begin
  select * into v_payment from public.payments where id = p_payment_id;

  if not found or not public.is_business_member(v_payment.business_id) then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  if v_payment.status <> 'paid' then
    raise exception 'PAYMENT_NOT_REFUNDABLE' using errcode = '22023';
  end if;

  insert into public.payment_events (
    payment_id, business_id, event_type, previous_status, provider, amount, detail
  )
  values (
    v_payment.id, v_payment.business_id, 'refund_requested', v_payment.status,
    v_payment.provider, v_payment.amount, nullif(btrim(coalesce(p_reason, '')), '')
  );

  -- With the mock the refund is immediate. A real adapter would record the
  -- request here and let the provider callback move the status.
  if not public.payment_simulation_enabled() then
    raise exception 'PAYMENT_SIMULATION_DISABLED' using errcode = '22023';
  end if;

  v_payment := public.apply_payment_outcome(
    v_payment.id, 'refunded', v_payment.provider_reference, null,
    'refund:' || v_payment.id::text
  );

  return jsonb_build_object(
    'paymentId', v_payment.id,
    'status', v_payment.status,
    'amount', v_payment.refunded_amount,
    'currency', v_payment.currency
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Grant classification.
-- ---------------------------------------------------------------------------

revoke all on function public.payment_hold_minutes() from public, anon, authenticated;
revoke all on function public.expire_payment_holds(uuid) from public, anon, authenticated;

-- A guest holds a booking link and no account. These two are theirs.
revoke all on function public.get_payment_by_token(uuid, uuid) from public;
grant execute on function public.get_payment_by_token(uuid, uuid) to anon, authenticated;
revoke all on function public.simulate_payment_by_token(uuid, uuid, text, text) from public;
grant execute on function public.simulate_payment_by_token(uuid, uuid, text, text) to anon, authenticated;

-- Refunding is a professional's decision, so it needs an account.
revoke all on function public.refund_payment(uuid, text) from public, anon;
grant execute on function public.refund_payment(uuid, text) to authenticated;

-- Recreating a function resets its grants to the Supabase defaults.
revoke all on function public.get_available_slots(uuid, uuid, date) from public;
grant execute on function public.get_available_slots(uuid, uuid, date) to anon, authenticated;
revoke all on function public.get_availability_context(uuid, uuid, date, date) from public;
grant execute on function public.get_availability_context(uuid, uuid, date, date) to anon, authenticated;
revoke all on function public.book_appointment(uuid, uuid, timestamptz, text, text, text, text, text)
  from public;
grant execute on function public.book_appointment(uuid, uuid, timestamptz, text, text, text, text, text)
  to anon, authenticated;
