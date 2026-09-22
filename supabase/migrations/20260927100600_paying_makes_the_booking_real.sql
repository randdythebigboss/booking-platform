-- ===========================================================================
-- What paying actually does to the booking, and what declining leaves behind.
--
-- Two halves of the same rule: the payment is the authority on money, and the
-- appointment is the authority on the calendar, and exactly one place joins
-- them -- here, when an outcome arrives.
--
--   paid      the hold is over. The slot is the customer's, and the booking
--             becomes what the business's own setting says a booking is:
--             confirmed, or waiting to be accepted.
--
--   declined  the hold stands until it lapses, because the customer is still
--             standing there and may try another card. A retry is a new
--             payment row, so the history counts the attempts.
--
-- What deliberately does not happen: a failed payment does not cancel the
-- appointment on the spot. Somebody mistyping a card number should not lose
-- their slot to the next person while they reach for another one.
-- ===========================================================================

create or replace function public.apply_payment_outcome(
  p_payment_id uuid,
  p_status public.payment_status,
  p_provider_reference text default null,
  p_failure_code text default null,
  p_idempotency_key text default null
)
returns public.payments
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_payment public.payments;
  v_appointment public.appointments;
  v_business public.businesses;
  v_actor text;
  v_reason text;
begin
  -- Serialise concurrent callbacks for one payment: two arriving at the same
  -- instant must not both read `pending` and both decide to act on it.
  select * into v_payment from public.payments where id = p_payment_id for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  -- Seen this exact message before. Nothing to do, and saying so is not an
  -- error: a provider retries because it did not hear us the first time.
  if p_idempotency_key is not null and v_payment.idempotency_key = p_idempotency_key then
    return v_payment;
  end if;

  if v_payment.status = p_status then
    return v_payment;
  end if;

  if not public.payment_transition_is_allowed(v_payment.status, p_status) then
    raise exception 'PAYMENT_TRANSITION_NOT_ALLOWED' using errcode = '22023';
  end if;

  update public.payments
     set status = p_status,
         provider_reference = coalesce(p_provider_reference, provider_reference),
         failure_code = case when p_status = 'failed' then p_failure_code else null end,
         failure_reason = case when p_status = 'failed' then p_failure_code else null end,
         idempotency_key = coalesce(p_idempotency_key, idempotency_key),
         paid_at = case when p_status = 'paid' then now() else paid_at end,
         refunded_at = case when p_status = 'refunded' then now() else refunded_at end,
         refunded_amount = case when p_status = 'refunded' then amount else refunded_amount end
   where id = p_payment_id
  returning * into v_payment;

  if p_status = 'paid' then
    select a.* into v_appointment
    from public.appointments a
    where a.id = v_payment.appointment_id
    for update;

    if found and v_appointment.status = 'pending' then
      select b.* into v_business
      from public.businesses b where b.id = v_appointment.business_id;

      -- The system did this, not the customer and not the shop: money arrived
      -- and the rule ran. Saved and restored, because this runs inside
      -- somebody else's transaction and the setting is transaction-scoped.
      v_actor := current_setting('app.actor_type', true);
      v_reason := current_setting('app.event_reason', true);
      perform public.declare_appointment_actor('system', 'Pago recibido');

      update public.appointments
         set hold_expires_at = null,
             status = (case
                         when coalesce(v_business.auto_confirm_bookings, true) then 'confirmed'
                         else 'pending'
                       end)::public.appointment_status
       where id = v_appointment.id;

      perform set_config('app.actor_type', coalesce(v_actor, ''), true);
      perform set_config('app.event_reason', coalesce(v_reason, ''), true);
    end if;
  end if;

  return v_payment;
end;
$fn$;

/**
 * Another go at paying, after a card was declined.
 *
 * A failed payment is final -- that is what makes the history countable -- so
 * trying again means a new row, with the same amount, frozen the same way.
 * The amount comes from the appointment's own snapshot and the failed
 * payment's requirement, never from the service as it stands today and never
 * from the caller.
 *
 * Refused once the hold has lapsed: by then the slot may be somebody else's,
 * and taking money for it is the failure this whole design exists to prevent.
 */
create or replace function public.retry_payment_by_token(
  p_appointment_id uuid,
  p_access_token uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_appointment public.appointments;
  v_previous public.payments;
  v_payment public.payments;
begin
  select a.* into v_appointment
  from public.appointments a
  where a.id = p_appointment_id and a.access_token = p_access_token;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'APPOINTMENT_NOT_PAYABLE' using errcode = '22023';
  end if;

  if v_appointment.hold_expires_at is not null and v_appointment.hold_expires_at <= now() then
    raise exception 'PAYMENT_HOLD_EXPIRED' using errcode = '22023';
  end if;

  -- Already something open? Then this is a refresh, not a retry.
  select p.* into v_payment
  from public.payments p
  where p.appointment_id = v_appointment.id
    and p.status in ('pending', 'requires_action')
  order by p.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'paymentId', v_payment.id,
      'status', v_payment.status,
      'amount', v_payment.amount,
      'currency', v_payment.currency
    );
  end if;

  select p.* into v_previous
  from public.payments p
  where p.appointment_id = v_appointment.id
  order by p.created_at desc
  limit 1;

  if not found then
    raise exception 'NO_PAYMENT_DUE' using errcode = '22023';
  end if;

  if v_previous.status <> 'failed' then
    raise exception 'PAYMENT_NOT_RETRYABLE' using errcode = '22023';
  end if;

  insert into public.payments (
    appointment_id, business_id, provider, amount, currency, status, requirement
  )
  values (
    v_previous.appointment_id, v_previous.business_id, v_previous.provider,
    v_previous.amount, v_previous.currency, 'pending', v_previous.requirement
  )
  returning * into v_payment;

  return jsonb_build_object(
    'paymentId', v_payment.id,
    'status', v_payment.status,
    'amount', v_payment.amount,
    'currency', v_payment.currency
  );
end;
$fn$;

revoke all on function public.apply_payment_outcome(uuid, public.payment_status, text, text, text)
  from public, anon, authenticated;
revoke all on function public.retry_payment_by_token(uuid, uuid) from public;
grant execute on function public.retry_payment_by_token(uuid, uuid) to anon, authenticated;
