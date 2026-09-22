-- ===========================================================================
-- Phase 10 - money needs somewhere to go, and a hold needs an owner.
--
-- Two invariants, both about not lying to a customer.
--
-- **A service may only ask to be paid if something can take the payment.**
-- Today the only thing that can is the demo, which is a deployment switch
-- (ADR 0022's neighbour: `platform_settings.payment_simulation_enabled`).
-- Turn the demo off with no real provider configured, and a service that asks
-- for a deposit becomes unbookable rather than becoming a "Pay now" button
-- with nothing behind it. The public page marks those services unavailable;
-- `book_appointment` refuses them; and the two agree because they read the
-- same function.
--
-- When a real provider is eventually configured, `payments_are_available`
-- gains a second reason to be true and nothing else changes.
--
-- **One unpaid hold per customer per business.** A hold occupies a slot for
-- fifteen minutes without anybody paying for it (ADR 0022), so the obvious
-- abuse is to start checkouts and walk away. This is the smallest control
-- that closes it: booking a second unpaid slot releases the first. It
-- identifies a customer the way the rest of the product does -- by the phone
-- number they gave, within one business -- and nothing here records an
-- address, a device or an IP. Provider-level fraud controls are a real
-- provider's problem and are out of scope.
-- ===========================================================================

-- Which environment this is, stated rather than inferred.
--
-- The development reset tool refuses to run anywhere this does not say
-- `development`, which is the difference between a convenience and a loaded
-- gun pointed at whatever project the connection string happens to name.
alter table public.platform_settings
  add column environment text not null default 'development'
    constraint platform_settings_environment_is_known
      check (environment in ('development', 'beta', 'production'));

comment on column public.platform_settings.environment is
  'What this deployment is. The development reset tool refuses to run unless it says development.';

/**
 * Whether a payment can actually be taken here.
 *
 * Public: it says nothing about anybody, only whether this deployment can
 * process money at all, and the public booking page has to know before it
 * offers a service that costs something.
 */
create or replace function public.payments_are_available()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  -- The demo is the only executable provider today. A real adapter would add
  -- its own condition here, and nothing else in the product would change.
  select public.payment_simulation_enabled();
$fn$;

/**
 * What the booking page needs to know about money before it shows a price.
 *
 * Two booleans and no detail: whether anything can take a payment, and
 * whether what would take it is the demo. The second is what puts
 * "demonstration payment" on the screen, and it comes from the server for the
 * same reason the simulator itself does -- a client-side flag is a thing
 * somebody forgets to set.
 */
create or replace function public.payment_capabilities()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'available', public.payments_are_available(),
    'demo', public.payment_simulation_enabled()
  );
$fn$;

/**
 * Releases this customer's unpaid holds at this business.
 *
 * Only holds: an appointment with no expiry is a real booking and is never
 * touched, and one whose payment reached the provider is not a hold any more.
 */
create or replace function public.release_customer_unpaid_holds(
  p_business_id uuid,
  p_customer_id uuid
)
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
  -- Saved and restored: this runs inside the caller's transaction, and the
  -- actor setting is transaction-scoped.
  v_actor := current_setting('app.actor_type', true);
  v_reason := current_setting('app.event_reason', true);
  perform public.declare_appointment_actor('system', 'Reserva reemplazada por otra sin pagar');

  with lapsed as (
    select a.id
    from public.appointments a
    where a.business_id = p_business_id
      and a.customer_id = p_customer_id
      and a.hold_expires_at is not null
      and a.status in ('pending', 'confirmed')
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

CREATE OR REPLACE FUNCTION public.book_appointment(p_professional_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_customer_name text, p_customer_phone text, p_customer_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_locale text DEFAULT NULL::text)
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

  -- Nothing can take a payment: no provider is configured and the demo is off.
  -- Refusing here is the whole point -- the alternative is a customer looking
  -- at a "Pay now" button that nothing behind it can honour.
  if v_amount_due > 0 and not public.payments_are_available() then
    raise exception 'PAYMENT_NOT_AVAILABLE' using errcode = '22023';
  end if;

  -- One unpaid hold per customer per business. Booking a second slot without
  -- paying for the first releases the first: a visitor cannot sit on a
  -- professional's calendar by starting checkouts and walking away, and a
  -- customer who simply changed their mind gets the obvious behaviour.
  if v_amount_due > 0 then
    perform public.release_customer_unpaid_holds(v_business.id, v_customer_id);
  end if;

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
-- Grants.
-- ---------------------------------------------------------------------------

revoke all on function public.release_customer_unpaid_holds(uuid, uuid)
  from public, anon, authenticated;

-- Both of these say only what this deployment can do, never anything about
-- anybody, and the public booking page needs them before it shows a price.
revoke all on function public.payments_are_available() from public;
grant execute on function public.payments_are_available() to anon, authenticated;
revoke all on function public.payment_capabilities() from public;
grant execute on function public.payment_capabilities() to anon, authenticated;

revoke all on function public.book_appointment(uuid, uuid, timestamptz, text, text, text, text, text)
  from public;
grant execute on function public.book_appointment(uuid, uuid, timestamptz, text, text, text, text, text)
  to anon, authenticated;
