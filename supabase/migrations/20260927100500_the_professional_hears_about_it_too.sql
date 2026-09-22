-- ===========================================================================
-- Phase 8 completion, and Phase 9's half of it.
--
-- Two things arrive together because they are the same mechanism:
--
--   1. The **professional** is told when a customer books, moves or cancels.
--      Until now the outbox only ever spoke to customers, and the shop found
--      out by looking.
--
--   2. The **customer** is told what happened to their money.
--
-- Both go through the outbox that already exists (ADR 0020). Nothing new is
-- invented: same table, same idempotency, same dispatcher, same mock delivery.
--
-- Who a professional message is addressed to: the business's own contact
-- email if it has one, and the owner's account email otherwise. A shop that
-- has filled in neither gets no message, exactly as a customer without an
-- email does -- silence, never an error.
-- ===========================================================================

/**
 * Where to write to a business.
 *
 * `auth.users` is readable here because this function is SECURITY DEFINER and
 * callable by nobody; the address never leaves the outbox row it addresses.
 */
create or replace function public.business_contact_email(p_business public.businesses)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_email text;
begin
  v_email := nullif(btrim(coalesce(p_business.email, '')), '');
  if v_email is not null then
    return v_email;
  end if;

  select u.email into v_email
  from auth.users u
  where u.id = p_business.owner_user_id;

  return nullif(btrim(coalesce(v_email, '')), '');
end;
$fn$;

/**
 * Queues a message for the business rather than for the customer.
 *
 * A near-twin of `enqueue_notification`, and deliberately not folded into it:
 * the recipient, the language and the template all differ, and a single
 * function with a `p_recipient_kind` argument would be three branches wearing
 * one name.
 *
 * The language is the professional's, not the customer's: `profiles
 * .preferred_locale` for the owner, Spanish when they have not chosen.
 */
create or replace function public.enqueue_professional_notification(
  p_appointment public.appointments,
  p_business public.businesses,
  p_event_id uuid,
  p_kind public.notification_kind,
  p_template_key text,
  p_dedupe_key text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_recipient text;
  v_locale text;
  v_id uuid;
begin
  v_recipient := public.business_contact_email(p_business);
  if v_recipient is null then
    return null;
  end if;

  select coalesce(pr.preferred_locale, 'es') into v_locale
  from public.profiles pr
  where pr.id = p_business.owner_user_id;

  insert into public.notifications (
    business_id, appointment_id, event_id, kind, channel, recipient_kind,
    recipient, template_key, locale, payload, scheduled_for, dedupe_key
  )
  values (
    p_business.id,
    p_appointment.id,
    p_event_id,
    p_kind,
    'email',
    'professional',
    v_recipient,
    p_template_key,
    coalesce(v_locale, 'es'),
    public.notification_payload_for(p_appointment, p_business),
    now(),
    p_dedupe_key
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- The appointment-event bridge, extended.
--
-- Reproduced from the live definition, with the professional's messages added
-- alongside the customer's. The customer half is unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.notifications_from_appointment_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_appointment public.appointments;
  v_business public.businesses;
  v_by_customer boolean;
begin
  select a.* into v_appointment
  from public.appointments a
  where a.id = new.appointment_id;

  if not found then
    return null;
  end if;

  select b.* into v_business
  from public.businesses b
  where b.id = v_appointment.business_id;

  if not found then
    return null;
  end if;

  -- The shop does not need telling about what it just did itself.
  v_by_customer := new.actor_type = 'guest';

  if new.event_type = 'created' then
    if new.new_status = 'confirmed' then
      perform public.enqueue_notification(
        v_appointment, v_business, new.id,
        'booking_confirmed', 'booking.confirmed', 'email',
        now(),
        'evt:' || new.id::text || ':booking_confirmed:email'
      );
    end if;

    if v_by_customer then
      perform public.enqueue_professional_notification(
        v_appointment, v_business, new.id,
        'booking_created', 'professional.booking_created',
        'evt:' || new.id::text || ':booking_created:professional'
      );
    end if;

    perform public.schedule_appointment_reminder(v_appointment, v_business);
    return null;
  end if;

  if new.event_type = 'status_changed' then
    if new.new_status = 'confirmed' then
      perform public.enqueue_notification(
        v_appointment, v_business, new.id,
        'booking_confirmed', 'booking.confirmed', 'email',
        now(),
        'evt:' || new.id::text || ':booking_confirmed:email'
      );
      perform public.schedule_appointment_reminder(v_appointment, v_business);

    elsif new.new_status = 'cancelled' then
      perform public.enqueue_notification(
        v_appointment, v_business, new.id,
        'booking_cancelled', 'booking.cancelled', 'email',
        now(),
        'evt:' || new.id::text || ':booking_cancelled:email'
      );

      if v_by_customer then
        perform public.enqueue_professional_notification(
          v_appointment, v_business, new.id,
          'booking_cancelled', 'professional.booking_cancelled',
          'evt:' || new.id::text || ':booking_cancelled:professional'
        );
      end if;

      perform public.cancel_pending_reminders(v_appointment.id);

    else
      -- completed and no_show: nothing to say to the customer that they were
      -- not there for, and certainly nothing to remind them of.
      perform public.cancel_pending_reminders(v_appointment.id);
    end if;

    return null;
  end if;

  if new.event_type = 'rescheduled' then
    perform public.enqueue_notification(
      v_appointment, v_business, new.id,
      'booking_rescheduled', 'booking.rescheduled', 'email',
      now(),
      'evt:' || new.id::text || ':booking_rescheduled:email'
    );

    if v_by_customer then
      perform public.enqueue_professional_notification(
        v_appointment, v_business, new.id,
        'booking_rescheduled', 'professional.booking_rescheduled',
        'evt:' || new.id::text || ':booking_rescheduled:professional'
      );
    end if;

    perform public.schedule_appointment_reminder(v_appointment, v_business);
    return null;
  end if;

  return null;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Money, told to the customer.
--
-- Driven from `payment_events` for the same reason booking messages are driven
-- from `appointment_events`: the log is written by a trigger, so a payment
-- that changed through any door still produces the message it should.
-- ---------------------------------------------------------------------------

create or replace function public.notifications_from_payment_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_payment public.payments;
  v_appointment public.appointments;
  v_business public.businesses;
  v_kind public.notification_kind;
  v_template text;
begin
  if new.event_type <> 'status_changed' then
    return null;
  end if;

  if new.new_status = 'paid' then
    v_kind := 'payment_received';
    v_template := 'payment.received';
  elsif new.new_status = 'failed' then
    v_kind := 'payment_failed';
    v_template := 'payment.failed';
  elsif new.new_status = 'refunded' then
    v_kind := 'payment_refunded';
    v_template := 'payment.refunded';
  else
    -- requires_action, authorized, cancelled: nothing a customer needs an
    -- email about. They are looking at the page that caused them.
    return null;
  end if;

  select p.* into v_payment from public.payments p where p.id = new.payment_id;
  if not found then
    return null;
  end if;

  select a.* into v_appointment from public.appointments a where a.id = v_payment.appointment_id;
  if not found then
    return null;
  end if;

  select b.* into v_business from public.businesses b where b.id = v_payment.business_id;
  if not found then
    return null;
  end if;

  perform public.enqueue_notification(
    v_appointment, v_business, null,
    v_kind, v_template, 'email',
    now(),
    'pay:' || new.id::text || ':' || v_template
  );

  return null;
end;
$fn$;

create constraint trigger payment_events_queue_notifications
  after insert on public.payment_events
  deferrable initially deferred
  for each row execute function public.notifications_from_payment_event();

-- ---------------------------------------------------------------------------
-- The amount belongs in the message, so the payload carries it.
--
-- `notification_payload_for` is reproduced with two fields added. Everything
-- else about it is unchanged: still minimal, still no token, still nothing a
-- queue row has no business holding.
-- ---------------------------------------------------------------------------

create or replace function public.notification_payload_for(
  p_appointment public.appointments,
  p_business public.businesses
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $fn$
declare
  v_professional text;
  v_service text;
  v_payment public.payments;
begin
  select p.display_name into v_professional
  from public.professional_profiles p
  where p.id = p_appointment.professional_id;

  select i.service_name_snapshot into v_service
  from public.appointment_items i
  where i.appointment_id = p_appointment.id
  order by i.created_at
  limit 1;

  select p.* into v_payment
  from public.payments p
  where p.appointment_id = p_appointment.id
  order by p.created_at desc
  limit 1;

  return jsonb_build_object(
    'appointmentId', p_appointment.id,
    'businessName', p_business.name,
    'professionalName', v_professional,
    'serviceName', v_service,
    'customerName', p_appointment.customer_name_snapshot,
    'startsAt', to_char(p_appointment.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'endsAt', to_char(p_appointment.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'timezone', p_business.timezone,
    -- Null for a booking that asked for no money, which most do.
    'amount', v_payment.amount,
    'currency', v_payment.currency
  );
end;
$fn$;

revoke all on function public.business_contact_email(public.businesses)
  from public, anon, authenticated;
revoke all on function public.enqueue_professional_notification(
  public.appointments, public.businesses, uuid, public.notification_kind, text, text
) from public, anon, authenticated;
revoke all on function public.notifications_from_appointment_event()
  from public, anon, authenticated;
revoke all on function public.notifications_from_payment_event()
  from public, anon, authenticated;
revoke all on function public.notification_payload_for(public.appointments, public.businesses)
  from public, anon, authenticated;
