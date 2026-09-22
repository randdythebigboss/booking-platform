-- ===========================================================================
-- Phase 9 - what the payment domain promises.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/payments.sql
--
-- The promises, in the order they are asserted:
--
--   * a service asks for nothing, a deposit, or its price, and the database
--     refuses a deposit that makes no sense;
--   * the amount is the product's, never the caller's, and once written it
--     cannot be edited into something else;
--   * a slot is held while somebody pays, released when they do not, and a
--     payment arriving after the hold lapsed is refused rather than taken;
--   * an outcome applied twice changes one thing once;
--   * a declined card keeps the slot and allows another attempt;
--   * cancelling is not refunding, in either direction;
--   * no client role may claim, apply, or invent a payment, and one business
--     can neither see nor touch another's money.
-- ===========================================================================

\set ON_ERROR_STOP on

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('00000000-0000-0000-0000-000000000000', 'f1110000-0000-4000-8000-0000000000f1',
   'authenticated', 'authenticated', 'pagos@bookingplatform.test',
   extensions.crypt('pagos-password-123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Pagos Owner"}'::jsonb, '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'f2220000-0000-4000-8000-0000000000f2',
   'authenticated', 'authenticated', 'pagos-vecino@bookingplatform.test',
   extensions.crypt('vecino-password-123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Vecino Pagos"}'::jsonb, '', '', '', '')
on conflict (id) do nothing;

insert into public.businesses (
  id, owner_user_id, name, slug, timezone, currency,
  slot_interval_minutes, minimum_notice_minutes, booking_horizon_days,
  auto_confirm_bookings, is_active, is_published, reminder_lead_minutes
)
values
  ('f1110000-0000-4000-8000-000000000001', 'f1110000-0000-4000-8000-0000000000f1',
   'Estudio Pagos', 'estudio-pagos', 'America/Santo_Domingo', 'DOP', 15, 60, 120,
   true, true, true, 1440),
  ('f2220000-0000-4000-8000-000000000001', 'f2220000-0000-4000-8000-0000000000f2',
   'Estudio Vecino Pagos', 'estudio-vecino-pagos', 'America/Santo_Domingo', 'DOP', 15, 60, 120,
   true, true, true, 1440);

insert into public.business_members (business_id, user_id, role)
values
  ('f1110000-0000-4000-8000-000000000001', 'f1110000-0000-4000-8000-0000000000f1', 'owner'),
  ('f2220000-0000-4000-8000-000000000001', 'f2220000-0000-4000-8000-0000000000f2', 'owner');

insert into public.professional_profiles (id, business_id, user_id, display_name)
values
  ('f1110000-0000-4000-8000-0000000000b1', 'f1110000-0000-4000-8000-000000000001',
   'f1110000-0000-4000-8000-0000000000f1', 'Profesional Pagos'),
  ('f2220000-0000-4000-8000-0000000000b1', 'f2220000-0000-4000-8000-000000000001',
   'f2220000-0000-4000-8000-0000000000f2', 'Profesional Vecino');

insert into public.services (
  id, business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes,
  price, currency, is_active, payment_requirement, deposit_amount
)
values
  ('f1110000-0000-4000-8000-0000000000c0', 'f1110000-0000-4000-8000-000000000001',
   'Corte gratis de reservar', 30, 0, 0, 800.00, 'DOP', true, 'none', null),
  ('f1110000-0000-4000-8000-0000000000c1', 'f1110000-0000-4000-8000-000000000001',
   'Color con depósito', 30, 0, 0, 2500.00, 'DOP', true, 'deposit', 1000.00),
  ('f1110000-0000-4000-8000-0000000000c2', 'f1110000-0000-4000-8000-000000000001',
   'Taller pagado por completo', 30, 0, 0, 3500.00, 'DOP', true, 'full', null),
  ('f2220000-0000-4000-8000-0000000000c1', 'f2220000-0000-4000-8000-000000000001',
   'Corte vecino', 30, 0, 0, 900.00, 'DOP', true, 'deposit', 300.00);

insert into public.professional_services (professional_id, service_id)
values
  ('f1110000-0000-4000-8000-0000000000b1', 'f1110000-0000-4000-8000-0000000000c0'),
  ('f1110000-0000-4000-8000-0000000000b1', 'f1110000-0000-4000-8000-0000000000c1'),
  ('f1110000-0000-4000-8000-0000000000b1', 'f1110000-0000-4000-8000-0000000000c2'),
  ('f2220000-0000-4000-8000-0000000000b1', 'f2220000-0000-4000-8000-0000000000c1');

insert into public.availability_rules (professional_id, weekday, start_time, end_time)
select p, d::smallint, time '09:00', time '18:00'
from generate_series(0, 6) as d
cross join (values
  ('f1110000-0000-4000-8000-0000000000b1'::uuid),
  ('f2220000-0000-4000-8000-0000000000b1'::uuid)
) as pros(p);

update public.platform_settings set payment_simulation_enabled = true;

---------------------------------------------------------------------------
-- 1. What a service may ask for.
---------------------------------------------------------------------------
begin;

do $$
declare
  c_business constant uuid := 'f1110000-0000-4000-8000-000000000001';
  v_refused boolean;
begin
  ---------------------------------------------------------------------------
  raise notice '1. a deposit larger than the price is not a deposit';
  ---------------------------------------------------------------------------
  v_refused := false;
  begin
    insert into public.services (business_id, name, duration_minutes, price, currency,
                                 payment_requirement, deposit_amount)
    values (c_business, 'Imposible', 30, 500.00, 'DOP', 'deposit', 900.00);
  exception
    when check_violation then v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL: a deposit above the price was accepted';
  end if;

  v_refused := false;
  begin
    insert into public.services (business_id, name, duration_minutes, price, currency,
                                 payment_requirement, deposit_amount)
    values (c_business, 'Cero', 30, 500.00, 'DOP', 'deposit', 0);
  exception
    when check_violation then v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL: a deposit of nothing was accepted';
  end if;

  v_refused := false;
  begin
    insert into public.services (business_id, name, duration_minutes, price, currency,
                                 payment_requirement, deposit_amount)
    values (c_business, 'Negativa', 30, 500.00, 'DOP', 'deposit', -100.00);
  exception
    when check_violation then v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL: a negative deposit was accepted';
  end if;

  ---------------------------------------------------------------------------
  raise notice '2. a deposit exists only where one is asked for';
  ---------------------------------------------------------------------------
  v_refused := false;
  begin
    insert into public.services (business_id, name, duration_minutes, price, currency,
                                 payment_requirement, deposit_amount)
    values (c_business, 'Sin sentido', 30, 500.00, 'DOP', 'none', 100.00);
  exception
    when check_violation then v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL: a service that asks for nothing kept a deposit amount';
  end if;

  raise notice '1-2 hold';
end;
$$;

rollback;

---------------------------------------------------------------------------
-- 2. Booking, and what each kind of service costs.
---------------------------------------------------------------------------
begin;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
declare
  c_pro constant uuid := 'f1110000-0000-4000-8000-0000000000b1';
  c_tz constant text := 'America/Santo_Domingo';
  v_date date := ((now() at time zone c_tz)::date + 9);
  v_result jsonb;
begin
  -- Free.
  v_result := public.book_appointment(
    c_pro, 'f1110000-0000-4000-8000-0000000000c0',
    (v_date::timestamp + time '09:00') at time zone c_tz,
    'Gratis Cliente', '+1 809 555 7001', 'gratis@example.test', null, 'es'
  );
  if v_result ? 'payment' and v_result -> 'payment' <> 'null'::jsonb then
    raise exception 'FAIL: a free service asked for money';
  end if;
  if v_result ->> 'status' <> 'confirmed' then
    raise exception 'FAIL: a free booking is %, not confirmed', v_result ->> 'status';
  end if;
  if v_result ->> 'holdExpiresAt' is not null then
    raise exception 'FAIL: a free booking was held';
  end if;

  -- Deposit.
  v_result := public.book_appointment(
    c_pro, 'f1110000-0000-4000-8000-0000000000c1',
    (v_date::timestamp + time '10:00') at time zone c_tz,
    'Depósito Cliente', '+1 809 555 7002', 'deposito@example.test', null, 'es'
  );
  if (v_result -> 'payment' ->> 'amount')::numeric <> 1000.00 then
    raise exception 'FAIL: the deposit was %, not 1000', v_result -> 'payment' ->> 'amount';
  end if;
  if v_result -> 'payment' ->> 'requirement' <> 'deposit' then
    raise exception 'FAIL: the payment does not know it is a deposit';
  end if;
  if v_result -> 'payment' ->> 'currency' <> 'DOP' then
    raise exception 'FAIL: the payment lost its currency';
  end if;
  if v_result ->> 'status' <> 'pending' then
    raise exception 'FAIL: an unpaid booking is %, and should be pending', v_result ->> 'status';
  end if;
  if v_result ->> 'holdExpiresAt' is null then
    raise exception 'FAIL: a paid booking was not held';
  end if;

  -- Full.
  v_result := public.book_appointment(
    c_pro, 'f1110000-0000-4000-8000-0000000000c2',
    (v_date::timestamp + time '11:00') at time zone c_tz,
    'Completo Cliente', '+1 809 555 7003', 'completo@example.test', null, 'en'
  );
  if (v_result -> 'payment' ->> 'amount')::numeric <> 3500.00 then
    raise exception 'FAIL: the full amount was %, not 3500', v_result -> 'payment' ->> 'amount';
  end if;

  raise notice '3. free books free, a deposit asks for the deposit, full asks for the price';
end;
$$;

commit;

---------------------------------------------------------------------------
-- 3. The amount is not the caller's to choose.
---------------------------------------------------------------------------
begin;

do $$
declare
  v_payment public.payments;
  v_refused boolean;
begin
  select p.* into v_payment
  from public.payments p
  join public.appointments a on a.id = p.appointment_id
  where a.customer_name_snapshot = 'Depósito Cliente';

  ---------------------------------------------------------------------------
  raise notice '4. what the money was for cannot be edited afterwards';
  ---------------------------------------------------------------------------
  v_refused := false;
  begin
    update public.payments set amount = 1.00 where id = v_payment.id;
  exception
    when invalid_parameter_value then v_refused := (sqlerrm = 'PAYMENT_IS_IMMUTABLE');
  end;
  if not v_refused then
    raise exception 'FAIL: the amount was edited';
  end if;

  v_refused := false;
  begin
    update public.payments set currency = 'USD' where id = v_payment.id;
  exception
    when invalid_parameter_value then v_refused := (sqlerrm = 'PAYMENT_IS_IMMUTABLE');
  end;
  if not v_refused then
    raise exception 'FAIL: the currency was edited';
  end if;

  v_refused := false;
  begin
    update public.payments set appointment_id = gen_random_uuid() where id = v_payment.id;
  exception
    when invalid_parameter_value then v_refused := (sqlerrm = 'PAYMENT_IS_IMMUTABLE');
    when foreign_key_violation then v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL: a payment was moved to another appointment';
  end if;

  ---------------------------------------------------------------------------
  raise notice '5. and a status cannot jump wherever it likes';
  ---------------------------------------------------------------------------
  v_refused := false;
  begin
    update public.payments set status = 'refunded' where id = v_payment.id;
  exception
    when invalid_parameter_value then v_refused := (sqlerrm = 'PAYMENT_TRANSITION_NOT_ALLOWED');
  end;
  if not v_refused then
    raise exception 'FAIL: a pending payment was refunded';
  end if;

  raise notice '4-5 hold';
end;
$$;

rollback;

---------------------------------------------------------------------------
-- 4. Paying.
---------------------------------------------------------------------------
begin;

do $$
declare
  v_appointment public.appointments;
  v_result jsonb;
  v_again jsonb;
begin
  select a.* into v_appointment
  from public.appointments a
  where a.customer_name_snapshot = 'Depósito Cliente';

  ---------------------------------------------------------------------------
  raise notice '6. a successful payment is recorded and the booking becomes real';
  ---------------------------------------------------------------------------
  v_result := public.simulate_payment_by_token(
    v_appointment.id, v_appointment.access_token, 'success', 'test:pay-once'
  );

  if v_result ->> 'status' <> 'paid' then
    raise exception 'FAIL: a successful payment is %', v_result ->> 'status';
  end if;

  ---------------------------------------------------------------------------
  raise notice '7. the same outcome applied twice changes nothing twice';
  ---------------------------------------------------------------------------
  v_again := public.simulate_payment_by_token(
    v_appointment.id, v_appointment.access_token, 'success', 'test:pay-once'
  );

  if v_again ->> 'paymentId' <> v_result ->> 'paymentId' then
    raise exception 'FAIL: a repeated callback made a second payment';
  end if;
end;
$$;

commit;

begin;

do $$
declare
  v_appointment public.appointments;
  v_payment public.payments;
  v_count integer;
begin
  select a.* into v_appointment
  from public.appointments a where a.customer_name_snapshot = 'Depósito Cliente';

  if v_appointment.status <> 'confirmed' then
    raise exception 'FAIL: a paid appointment is %, not confirmed', v_appointment.status;
  end if;
  if v_appointment.hold_expires_at is not null then
    raise exception 'FAIL: a paid appointment is still being held';
  end if;

  select p.* into v_payment
  from public.payments p where p.appointment_id = v_appointment.id;

  if v_payment.paid_at is null then
    raise exception 'FAIL: a paid payment has no time of payment';
  end if;
  if v_payment.provider_reference is null then
    raise exception 'FAIL: a paid payment has no provider reference';
  end if;

  ---------------------------------------------------------------------------
  raise notice '8. and exactly one of each event and message came out of it';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.payment_events
  where payment_id = v_payment.id and event_type = 'status_changed' and new_status = 'paid';

  if v_count <> 1 then
    raise exception 'FAIL: % paid events for one payment', v_count;
  end if;

  select count(*) into v_count
  from public.notifications
  where appointment_id = v_appointment.id and kind = 'payment_received';

  if v_count <> 1 then
    raise exception 'FAIL: % payment messages queued', v_count;
  end if;

  raise notice '6-8 hold';
end;
$$;

commit;

---------------------------------------------------------------------------
-- 5. Being declined, and trying again.
---------------------------------------------------------------------------
begin;

do $$
declare
  c_pro constant uuid := 'f1110000-0000-4000-8000-0000000000b1';
  c_tz constant text := 'America/Santo_Domingo';
  v_date date := ((now() at time zone c_tz)::date + 9);
  v_booking jsonb;
  v_appointment public.appointments;
  v_result jsonb;
  v_retry jsonb;
begin
  v_booking := public.book_appointment(
    c_pro, 'f1110000-0000-4000-8000-0000000000c1',
    (v_date::timestamp + time '13:00') at time zone c_tz,
    'Rechazo Cliente', '+1 809 555 7004', 'rechazo@example.test', null, 'es'
  );

  select a.* into v_appointment
  from public.appointments a where a.id = (v_booking ->> 'appointmentId')::uuid;

  ---------------------------------------------------------------------------
  raise notice '9. a declined card fails the payment and keeps the slot';
  ---------------------------------------------------------------------------
  v_result := public.simulate_payment_by_token(
    v_appointment.id, v_appointment.access_token, 'decline', 'test:decline-1'
  );

  if v_result ->> 'status' <> 'failed' then
    raise exception 'FAIL: a declined payment is %', v_result ->> 'status';
  end if;
  if v_result ->> 'failureCode' is null then
    raise exception 'FAIL: a declined payment did not say why';
  end if;

  select a.* into v_appointment from public.appointments a where a.id = v_appointment.id;
  if v_appointment.status <> 'pending' or v_appointment.hold_expires_at is null then
    raise exception 'FAIL: a declined card cost the customer their slot';
  end if;

  ---------------------------------------------------------------------------
  raise notice '10. and another attempt is a new payment, not a resurrection';
  ---------------------------------------------------------------------------
  v_retry := public.retry_payment_by_token(v_appointment.id, v_appointment.access_token);

  if v_retry ->> 'paymentId' = v_result ->> 'paymentId' then
    raise exception 'FAIL: the failed payment was reused';
  end if;
  if (v_retry ->> 'amount')::numeric <> 1000.00 then
    raise exception 'FAIL: the retry asks for %, not the original amount', v_retry ->> 'amount';
  end if;

  v_result := public.simulate_payment_by_token(
    v_appointment.id, v_appointment.access_token, 'success', 'test:retry-ok'
  );
  if v_result ->> 'status' <> 'paid' then
    raise exception 'FAIL: the second attempt did not go through';
  end if;
end;
$$;

commit;

begin;

do $$
declare
  v_appointment public.appointments;
  v_count integer;
begin
  select a.* into v_appointment
  from public.appointments a where a.customer_name_snapshot = 'Rechazo Cliente';

  select count(*) into v_count
  from public.payments where appointment_id = v_appointment.id;

  if v_count <> 2 then
    raise exception 'FAIL: expected two attempts on the record, found %', v_count;
  end if;

  select count(*) into v_count
  from public.payments where appointment_id = v_appointment.id and status = 'paid';

  if v_count <> 1 then
    raise exception 'FAIL: % of the attempts are paid', v_count;
  end if;

  if v_appointment.status <> 'confirmed' then
    raise exception 'FAIL: the appointment did not become real after the retry';
  end if;

  raise notice '9-10 hold';
end;
$$;

commit;

---------------------------------------------------------------------------
-- 6. Holds: while the money is in flight, and after it is too late.
---------------------------------------------------------------------------
begin;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
declare
  c_pro constant uuid := 'f1110000-0000-4000-8000-0000000000b1';
  c_tz constant text := 'America/Santo_Domingo';
  v_date date := ((now() at time zone c_tz)::date + 9);
  v_slot timestamptz;
  v_booking jsonb;
  v_taken boolean;
begin
  v_slot := (v_date::timestamp + time '15:00') at time zone c_tz;

  v_booking := public.book_appointment(
    c_pro, 'f1110000-0000-4000-8000-0000000000c1', v_slot,
    'Reserva Cliente', '+1 809 555 7005', 'reserva@example.test', null, 'es'
  );

  ---------------------------------------------------------------------------
  raise notice '11. a slot being paid for is not available to anybody else';
  ---------------------------------------------------------------------------
  if exists (
    select 1 from public.get_available_slots(
      c_pro, 'f1110000-0000-4000-8000-0000000000c1', v_date
    ) s where s.starts_at = v_slot
  ) then
    raise exception 'FAIL: a held slot is still on offer';
  end if;

  v_taken := false;
  begin
    perform public.book_appointment(
      c_pro, 'f1110000-0000-4000-8000-0000000000c1', v_slot,
      'Segundo Cliente', '+1 809 555 7006', 'segundo@example.test', null, 'es'
    );
  exception
    when sqlstate '23P01' then v_taken := true;
  end;

  if not v_taken then
    raise exception 'FAIL: two customers hold the same slot';
  end if;
end;
$$;

commit;

begin;

-- The clock moves on. (A test may do this; nothing else may.)
update public.appointments
   set hold_expires_at = now() - interval '1 minute'
 where customer_name_snapshot = 'Reserva Cliente';

do $$
declare
  c_pro constant uuid := 'f1110000-0000-4000-8000-0000000000b1';
  c_tz constant text := 'America/Santo_Domingo';
  v_date date := ((now() at time zone c_tz)::date + 9);
  v_slot timestamptz := (v_date::timestamp + time '15:00') at time zone c_tz;
  v_appointment public.appointments;
  v_payment public.payments;
begin
  ---------------------------------------------------------------------------
  raise notice '12. a lapsed hold is free again, before anybody cleans it up';
  ---------------------------------------------------------------------------
  if not exists (
    select 1 from public.get_available_slots(
      c_pro, 'f1110000-0000-4000-8000-0000000000c1', v_date
    ) s where s.starts_at = v_slot
  ) then
    raise exception 'FAIL: an expired hold is still holding the slot';
  end if;

  ---------------------------------------------------------------------------
  raise notice '13. and cleaning it up cancels both the booking and the payment';
  ---------------------------------------------------------------------------
  perform public.expire_payment_holds(c_pro);

  select a.* into v_appointment
  from public.appointments a where a.customer_name_snapshot = 'Reserva Cliente';

  if v_appointment.status <> 'cancelled' then
    raise exception 'FAIL: a lapsed hold is %, not cancelled', v_appointment.status;
  end if;
  if v_appointment.hold_expires_at is not null then
    raise exception 'FAIL: a released hold still has an expiry';
  end if;

  select p.* into v_payment
  from public.payments p where p.appointment_id = v_appointment.id;

  if v_payment.status <> 'cancelled' then
    raise exception 'FAIL: the payment for a lapsed hold is %', v_payment.status;
  end if;

  ---------------------------------------------------------------------------
  raise notice '14. and money arriving afterwards is refused, not taken';
  ---------------------------------------------------------------------------
  raise notice '11-14 hold';
end;
$$;

commit;

begin;

do $$
declare
  c_pro constant uuid := 'f1110000-0000-4000-8000-0000000000b1';
  c_tz constant text := 'America/Santo_Domingo';
  v_date date := ((now() at time zone c_tz)::date + 8);
  v_booking jsonb;
  v_appointment public.appointments;
  v_refused boolean;
begin
  v_booking := public.book_appointment(
    c_pro, 'f1110000-0000-4000-8000-0000000000c1',
    (v_date::timestamp + time '16:00') at time zone c_tz,
    'Tarde Cliente', '+1 809 555 7007', 'tarde@example.test', null, 'es'
  );

  select a.* into v_appointment
  from public.appointments a where a.id = (v_booking ->> 'appointmentId')::uuid;

  -- The hold lapses while the customer is on the payment page.
  update public.appointments
     set hold_expires_at = now() - interval '1 second'
   where id = v_appointment.id;

  v_refused := false;
  begin
    perform public.simulate_payment_by_token(
      v_appointment.id, v_appointment.access_token, 'success', 'test:too-late'
    );
  exception
    when invalid_parameter_value then v_refused := (sqlerrm = 'PAYMENT_HOLD_EXPIRED');
  end;

  if not v_refused then
    raise exception 'FAIL: money was taken for a slot the customer no longer had';
  end if;
end;
$$;

rollback;

---------------------------------------------------------------------------
-- 7. Cancelling is not refunding, and refunding is not cancelling.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1110000-0000-4000-8000-0000000000f1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_appointment public.appointments;
  v_payment public.payments;
  v_result jsonb;
begin
  select a.* into v_appointment
  from public.appointments a where a.customer_name_snapshot = 'Depósito Cliente';

  ---------------------------------------------------------------------------
  raise notice '15. cancelling a paid appointment does not touch the money';
  ---------------------------------------------------------------------------
  perform public.set_appointment_status(v_appointment.id, 'cancelled', 'No puede venir');

  select p.* into v_payment
  from public.payments p where p.appointment_id = v_appointment.id;

  if v_payment.status <> 'paid' then
    raise exception 'FAIL: cancelling an appointment changed its payment to %', v_payment.status;
  end if;

  ---------------------------------------------------------------------------
  raise notice '16. refunding is a separate decision, and it is recorded';
  ---------------------------------------------------------------------------
  v_result := public.refund_payment(v_payment.id, 'Cancelada por el negocio');

  if v_result ->> 'status' <> 'refunded' then
    raise exception 'FAIL: the refund left the payment %', v_result ->> 'status';
  end if;

  select p.* into v_payment
  from public.payments p where p.id = (v_result ->> 'paymentId')::uuid;

  if v_payment.refunded_amount <> v_payment.amount then
    raise exception 'FAIL: the refund was for %, not the amount paid', v_payment.refunded_amount;
  end if;

  if not exists (
    select 1 from public.payment_events
    where payment_id = v_payment.id and event_type = 'refund_requested'
  ) then
    raise exception 'FAIL: the refund request was not recorded';
  end if;

  ---------------------------------------------------------------------------
  raise notice '17. and a refund cannot be taken twice';
  ---------------------------------------------------------------------------
  begin
    perform public.refund_payment(v_payment.id, 'Otra vez');
    raise exception 'FAIL: a payment was refunded twice';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'PAYMENT_NOT_REFUNDABLE' then raise; end if;
  end;

  raise notice '15-17 hold';
end;
$$;

rollback;

---------------------------------------------------------------------------
-- 8. Who may do what.
---------------------------------------------------------------------------
begin;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
declare
  v_count integer;
begin
  ---------------------------------------------------------------------------
  raise notice '18. an anonymous visitor cannot reach the payment tables';
  ---------------------------------------------------------------------------
  begin
    select count(*) into v_count from public.payments;
    raise exception 'FAIL: anon read % payments', v_count;
  exception
    when insufficient_privilege then null;
  end;

  begin
    select count(*) into v_count from public.payment_events;
    raise exception 'FAIL: anon read the payment history';
  exception
    when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------------------
  raise notice '19. nor say that something was paid';
  ---------------------------------------------------------------------------
  begin
    perform public.apply_payment_outcome(gen_random_uuid(), 'paid');
    raise exception 'FAIL: anon applied a payment outcome';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.expire_payment_holds(null);
    raise exception 'FAIL: anon released every hold in the database';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.payment_simulation_enabled();
    raise exception 'FAIL: anon can read the deployment switches';
  exception
    when insufficient_privilege then null;
  end;

  raise notice '18-19 hold';
end;
$$;

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f2220000-0000-4000-8000-0000000000f2', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_count integer;
  v_payment_id uuid;
begin
  ---------------------------------------------------------------------------
  raise notice '20. one business sees none of another business''s money';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.payments p
  where p.business_id = 'f1110000-0000-4000-8000-000000000001';

  if v_count <> 0 then
    raise exception 'FAIL: a neighbour can read % payments', v_count;
  end if;

  select count(*) into v_count
  from public.payment_events e
  where e.business_id = 'f1110000-0000-4000-8000-000000000001';

  if v_count <> 0 then
    raise exception 'FAIL: a neighbour can read the payment history';
  end if;

  ---------------------------------------------------------------------------
  raise notice '21. and cannot refund it either';
  ---------------------------------------------------------------------------
  reset role;
  select p.id into v_payment_id
  from public.payments p
  where p.business_id = 'f1110000-0000-4000-8000-000000000001' and p.status = 'paid'
  limit 1;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', 'f2220000-0000-4000-8000-0000000000f2', 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  begin
    perform public.refund_payment(v_payment_id, 'Mine now');
    raise exception 'FAIL: a neighbour refunded another business''s payment';
  exception
    when sqlstate 'PT404' then null;
  end;

  ---------------------------------------------------------------------------
  raise notice '22. and cannot write a payment of its own';
  ---------------------------------------------------------------------------
  begin
    insert into public.payments (appointment_id, business_id, provider, amount, currency, status)
    values (gen_random_uuid(), 'f2220000-0000-4000-8000-000000000001', 'mock', 1.00, 'DOP', 'paid');
    raise exception 'FAIL: a professional inserted a payment';
  exception
    when insufficient_privilege then null;
  end;

  raise notice '20-22 hold';
end;
$$;

rollback;

---------------------------------------------------------------------------
-- 9. The simulator is a switch, and it can be off.
---------------------------------------------------------------------------
begin;

update public.platform_settings set payment_simulation_enabled = false;

do $$
declare
  v_appointment public.appointments;
  v_refused boolean := false;
begin
  ---------------------------------------------------------------------------
  raise notice '23. with simulation off, nobody can declare themselves paid';
  ---------------------------------------------------------------------------
  select a.* into v_appointment
  from public.appointments a where a.customer_name_snapshot = 'Rechazo Cliente';

  begin
    perform public.simulate_payment_by_token(
      v_appointment.id, v_appointment.access_token, 'success', 'test:disabled'
    );
  exception
    when invalid_parameter_value then v_refused := (sqlerrm = 'PAYMENT_SIMULATION_DISABLED');
  end;

  if not v_refused then
    raise exception 'FAIL: the simulator worked with simulation disabled';
  end if;

  raise notice '23 holds';
end;
$$;

rollback;

\echo 'Payments hold.'
