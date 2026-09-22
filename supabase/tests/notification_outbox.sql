-- ===========================================================================
-- Phase 8 - what the outbox promises.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/notification_outbox.sql
--
-- The promises, in the order they are asserted:
--
--   * booking queues what it should, and nothing it should not;
--   * the message is frozen -- language, name, time -- at the moment it is
--     queued, and cannot be rewritten afterwards by editing a customer;
--   * a reminder follows its appointment: it moves with it, and it stops when
--     the appointment does;
--   * nothing is ever queued twice;
--   * a dispatcher claims safely, retries a bounded number of times, and
--     stops for good when it is told the failure is permanent;
--   * a business reads its own notifications and nobody else's, and no client
--     role may claim, send or mark anything at all.
--
-- Structure worth knowing: the trigger that queues notifications is a
-- DEFERRABLE INITIALLY DEFERRED constraint trigger, so it runs at COMMIT. An
-- assertion therefore never lives in the same transaction as the act it is
-- about. That is why this file is a sequence of act/assert pairs.
-- ===========================================================================

\set ON_ERROR_STOP on

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('00000000-0000-0000-0000-000000000000', 'e1110000-0000-4000-8000-0000000000e1',
   'authenticated', 'authenticated', 'avisos@bookingplatform.test',
   extensions.crypt('avisos-password-123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Avisos Owner"}'::jsonb, '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'e2220000-0000-4000-8000-0000000000e2',
   'authenticated', 'authenticated', 'avisos-vecino@bookingplatform.test',
   extensions.crypt('vecino-password-123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Vecino Avisos"}'::jsonb, '', '', '', '')
on conflict (id) do nothing;

insert into public.businesses (
  id, owner_user_id, name, slug, timezone, currency,
  slot_interval_minutes, minimum_notice_minutes, booking_horizon_days,
  auto_confirm_bookings, is_active, is_published, reminder_lead_minutes
)
values
  ('e1110000-0000-4000-8000-000000000001', 'e1110000-0000-4000-8000-0000000000e1',
   'Estudio Avisos', 'estudio-avisos', 'America/Santo_Domingo', 'DOP', 15, 60, 120,
   true, true, true, 1440),
  ('e2220000-0000-4000-8000-000000000001', 'e2220000-0000-4000-8000-0000000000e2',
   'Estudio Vecino Avisos', 'estudio-vecino-avisos', 'America/Santo_Domingo', 'DOP', 15, 60, 120,
   true, true, true, 1440);

insert into public.business_members (business_id, user_id, role)
values
  ('e1110000-0000-4000-8000-000000000001', 'e1110000-0000-4000-8000-0000000000e1', 'owner'),
  ('e2220000-0000-4000-8000-000000000001', 'e2220000-0000-4000-8000-0000000000e2', 'owner');

insert into public.professional_profiles (id, business_id, user_id, display_name)
values
  ('e1110000-0000-4000-8000-0000000000b1', 'e1110000-0000-4000-8000-000000000001',
   'e1110000-0000-4000-8000-0000000000e1', 'Profesional Avisos'),
  ('e2220000-0000-4000-8000-0000000000b1', 'e2220000-0000-4000-8000-000000000001',
   'e2220000-0000-4000-8000-0000000000e2', 'Profesional Vecino');

insert into public.services (
  id, business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes,
  price, currency, is_active
)
values
  ('e1110000-0000-4000-8000-0000000000c1', 'e1110000-0000-4000-8000-000000000001',
   'Corte con aviso', 30, 0, 0, 500, 'DOP', true),
  ('e2220000-0000-4000-8000-0000000000c1', 'e2220000-0000-4000-8000-000000000001',
   'Corte vecino', 30, 0, 0, 500, 'DOP', true);

insert into public.professional_services (professional_id, service_id)
values
  ('e1110000-0000-4000-8000-0000000000b1', 'e1110000-0000-4000-8000-0000000000c1'),
  ('e2220000-0000-4000-8000-0000000000b1', 'e2220000-0000-4000-8000-0000000000c1');

insert into public.availability_rules (professional_id, weekday, start_time, end_time)
select p, d::smallint, time '09:00', time '18:00'
from generate_series(0, 6) as d
cross join (values
  ('e1110000-0000-4000-8000-0000000000b1'::uuid),
  ('e2220000-0000-4000-8000-0000000000b1'::uuid)
) as pros(p);

---------------------------------------------------------------------------
-- 1. Booking, as guests do it.
---------------------------------------------------------------------------
begin;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
declare
  c_pro constant uuid := 'e1110000-0000-4000-8000-0000000000b1';
  c_service constant uuid := 'e1110000-0000-4000-8000-0000000000c1';
  c_tz constant text := 'America/Santo_Domingo';
  v_date date := ((now() at time zone c_tz)::date + 10);
begin
  -- In Spanish, with an email: the whole set.
  perform public.book_appointment(
    c_pro, c_service, (v_date::timestamp + time '09:00') at time zone c_tz,
    'Lucía Fernández', '+1 809 555 2001', 'lucia@example.test', null, 'es'
  );

  -- In English: the language must survive on the row.
  perform public.book_appointment(
    c_pro, c_service, (v_date::timestamp + time '10:00') at time zone c_tz,
    'John Fields', '+1 809 555 2002', 'john@example.test', null, 'en'
  );

  -- No email at all. The booking is as valid as any other; there is simply
  -- nothing to queue, and that must not be an error.
  perform public.book_appointment(
    c_pro, c_service, (v_date::timestamp + time '11:00') at time zone c_tz,
    'Sin Correo', '+1 809 555 2003'
  );

  -- To be moved later.
  perform public.book_appointment(
    c_pro, c_service, (v_date::timestamp + time '12:00') at time zone c_tz,
    'Mover Cliente', '+1 809 555 2004', 'mover@example.test', null, 'es'
  );

  -- To be cancelled later.
  perform public.book_appointment(
    c_pro, c_service, (v_date::timestamp + time '13:00') at time zone c_tz,
    'Cancelar Cliente', '+1 809 555 2005', 'cancelar@example.test', null, 'es'
  );
end;
$$;

commit;

---------------------------------------------------------------------------
-- 2. What those bookings queued.
---------------------------------------------------------------------------
begin;

do $$
declare
  c_business constant uuid := 'e1110000-0000-4000-8000-000000000001';
  c_tz constant text := 'America/Santo_Domingo';
  v_count integer;
  v_row public.notifications;
  v_appointment public.appointments;
begin
  ---------------------------------------------------------------------------
  raise notice '1. a confirmed booking queues a confirmation and a reminder';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.notifications
  where business_id = c_business and kind = 'booking_confirmed'
    and recipient_kind = 'customer';

  if v_count <> 4 then
    raise exception 'FAIL: expected 4 confirmations (one per booking with an email), got %', v_count;
  end if;

  select count(*) into v_count
  from public.notifications
  where business_id = c_business and kind = 'booking_reminder' and status = 'pending';

  if v_count <> 4 then
    raise exception 'FAIL: expected 4 reminders, got %', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '2. a booking with no address queues nothing, and is still a booking';
  ---------------------------------------------------------------------------
  select a.* into v_appointment
  from public.appointments a
  where a.business_id = c_business and a.customer_name_snapshot = 'Sin Correo';

  if not found then
    raise exception 'FAIL: the booking without an email did not happen';
  end if;

  select count(*) into v_count
  from public.notifications
  where appointment_id = v_appointment.id and recipient_kind = 'customer';

  if v_count <> 0 then
    raise exception 'FAIL: queued % notification(s) for a customer with no address', v_count;
  end if;

  -- The shop still hears about it: the customer having no email says nothing
  -- about whether the business has one.
  select count(*) into v_count
  from public.notifications
  where appointment_id = v_appointment.id
    and recipient_kind = 'professional' and kind = 'booking_created';

  if v_count <> 1 then
    raise exception 'FAIL: the professional was not told about a booking (% rows)', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '3. the message is addressed, worded and timed from the booking';
  ---------------------------------------------------------------------------
  select n.* into v_row
  from public.notifications n
  join public.appointments a on a.id = n.appointment_id
  where a.customer_name_snapshot = 'Lucía Fernández' and n.kind = 'booking_confirmed';

  if v_row.locale <> 'es' then
    raise exception 'FAIL: a Spanish booking queued a % message', v_row.locale;
  end if;
  if v_row.recipient <> 'lucia@example.test' then
    raise exception 'FAIL: wrong recipient %', v_row.recipient;
  end if;
  if v_row.template_key <> 'booking.confirmed' then
    raise exception 'FAIL: wrong template %', v_row.template_key;
  end if;
  if v_row.payload ->> 'customerName' <> 'Lucía Fernández' then
    raise exception 'FAIL: payload name is %', v_row.payload ->> 'customerName';
  end if;
  if v_row.payload ->> 'serviceName' <> 'Corte con aviso' then
    raise exception 'FAIL: payload lost the service: %', v_row.payload ->> 'serviceName';
  end if;
  if v_row.payload ->> 'timezone' <> c_tz then
    raise exception 'FAIL: payload lost the timezone';
  end if;

  select n.* into v_row
  from public.notifications n
  join public.appointments a on a.id = n.appointment_id
  where a.customer_name_snapshot = 'John Fields' and n.kind = 'booking_confirmed';

  if v_row.locale <> 'en' then
    raise exception 'FAIL: an English booking queued a % message', v_row.locale;
  end if;

  ---------------------------------------------------------------------------
  raise notice '4. the reminder is one lead time before the appointment';
  ---------------------------------------------------------------------------
  select a.* into v_appointment
  from public.appointments a
  where a.customer_name_snapshot = 'Lucía Fernández';

  select n.* into v_row
  from public.notifications n
  where n.appointment_id = v_appointment.id and n.kind = 'booking_reminder';

  if v_row.scheduled_for <> v_appointment.starts_at - interval '1440 minutes' then
    raise exception 'FAIL: reminder is at %, appointment at %',
      v_row.scheduled_for, v_appointment.starts_at;
  end if;

  raise notice '1-4 hold';
end;
$$;

commit;

---------------------------------------------------------------------------
-- 3. Moving an appointment, as the professional.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1110000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  c_tz constant text := 'America/Santo_Domingo';
  v_id uuid;
  v_date date := ((now() at time zone c_tz)::date + 10);
begin
  select a.id into v_id
  from public.appointments a
  where a.customer_name_snapshot = 'Mover Cliente';

  perform public.reschedule_appointment(
    v_id, (v_date::timestamp + time '15:00') at time zone c_tz, 'El cliente pidió otra hora'
  );
end;
$$;

commit;

begin;

do $$
declare
  v_appointment public.appointments;
  v_count integer;
  v_reminder public.notifications;
begin
  select a.* into v_appointment
  from public.appointments a where a.customer_name_snapshot = 'Mover Cliente';

  ---------------------------------------------------------------------------
  raise notice '5. a move tells the customer';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.notifications
  where appointment_id = v_appointment.id and kind = 'booking_rescheduled';

  if v_count <> 1 then
    raise exception 'FAIL: expected 1 reschedule notice, got %', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '6. the reminder moves with it, and the old one is cancelled';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.notifications
  where appointment_id = v_appointment.id
    and kind = 'booking_reminder' and status = 'cancelled';

  if v_count <> 1 then
    raise exception 'FAIL: the reminder for the old time was not cancelled (% cancelled)', v_count;
  end if;

  select * into v_reminder
  from public.notifications
  where appointment_id = v_appointment.id
    and kind = 'booking_reminder' and status = 'pending';

  if not found then
    raise exception 'FAIL: no reminder for the new time';
  end if;

  if v_reminder.scheduled_for <> v_appointment.starts_at - interval '1440 minutes' then
    raise exception 'FAIL: the reminder did not follow the appointment';
  end if;

  if (v_reminder.payload ->> 'startsAt')::timestamptz <> v_appointment.starts_at then
    raise exception 'FAIL: the reminder still says the old time';
  end if;

  raise notice '5-6 hold';
end;
$$;

commit;

---------------------------------------------------------------------------
-- 4. Cancelling.
---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1110000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_id uuid;
begin
  select a.id into v_id
  from public.appointments a where a.customer_name_snapshot = 'Cancelar Cliente';

  perform public.set_appointment_status(v_id, 'cancelled', 'No puede venir');
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
  from public.appointments a where a.customer_name_snapshot = 'Cancelar Cliente';

  ---------------------------------------------------------------------------
  raise notice '7. a cancellation tells the customer';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.notifications
  where appointment_id = v_appointment.id and kind = 'booking_cancelled';

  if v_count <> 1 then
    raise exception 'FAIL: expected 1 cancellation notice, got %', v_count;
  end if;

  ---------------------------------------------------------------------------
  raise notice '8. and stops the reminder';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.notifications
  where appointment_id = v_appointment.id
    and kind = 'booking_reminder' and status = 'pending';

  if v_count <> 0 then
    raise exception 'FAIL: a cancelled appointment still has % reminder(s) waiting', v_count;
  end if;

  raise notice '7-8 hold';
end;
$$;

commit;

---------------------------------------------------------------------------
-- 5. The cases where a reminder would be noise.
---------------------------------------------------------------------------
begin;

-- A business that has turned reminders off, and one booking too soon to
-- remind anybody about.
update public.businesses
   set reminder_lead_minutes = 0
 where id = 'e2220000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
declare
  c_tz constant text := 'America/Santo_Domingo';
  v_date date := ((now() at time zone c_tz)::date + 10);
begin
  perform public.book_appointment(
    'e2220000-0000-4000-8000-0000000000b1', 'e2220000-0000-4000-8000-0000000000c1',
    (v_date::timestamp + time '09:00') at time zone c_tz,
    'Sin Recordatorio', '+1 809 555 3001', 'sinrec@example.test', null, 'es'
  );
end;
$$;

commit;

begin;

do $$
declare
  v_count integer;
begin
  ---------------------------------------------------------------------------
  raise notice '9. a business with reminders off queues none';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.notifications n
  join public.appointments a on a.id = n.appointment_id
  where a.customer_name_snapshot = 'Sin Recordatorio' and n.kind = 'booking_reminder';

  if v_count <> 0 then
    raise exception 'FAIL: queued % reminder(s) for a business that wants none', v_count;
  end if;

  -- ...but it is still told its booking was confirmed.
  select count(*) into v_count
  from public.notifications n
  join public.appointments a on a.id = n.appointment_id
  where a.customer_name_snapshot = 'Sin Recordatorio' and n.kind = 'booking_confirmed';

  if v_count <> 1 then
    raise exception 'FAIL: reminders off also silenced the confirmation';
  end if;

  raise notice '9 holds';
end;
$$;

commit;

---------------------------------------------------------------------------
-- 6. An appointment sooner than the lead time.
---------------------------------------------------------------------------
begin;

do $$
declare
  c_tz constant text := 'America/Santo_Domingo';
  v_business public.businesses;
  v_appointment public.appointments;
  v_count integer;
  v_customer uuid;
begin
  select * into v_business from public.businesses
  where id = 'e1110000-0000-4000-8000-000000000001';

  insert into public.customers (business_id, full_name, email, phone)
  values (v_business.id, 'Muy Pronto', 'pronto@example.test', '+1 809 555 4001')
  returning id into v_customer;

  -- Two hours from now, with a lead time of a day: a "reminder" would fire
  -- the instant the booking was made, which is noise rather than a service.
  insert into public.appointments (
    business_id, professional_id, customer_id, starts_at, ends_at, status, source
  )
  values (
    v_business.id, 'e1110000-0000-4000-8000-0000000000b1', v_customer,
    now() + interval '2 hours', now() + interval '2 hours 30 minutes',
    'confirmed', 'manual'
  )
  returning * into v_appointment;
end;
$$;

commit;

begin;

do $$
declare
  v_count integer;
begin
  ---------------------------------------------------------------------------
  raise notice '10. an appointment inside the reminder window gets no reminder';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.notifications n
  join public.appointments a on a.id = n.appointment_id
  where a.customer_name_snapshot = 'Muy Pronto' and n.kind = 'booking_reminder';

  if v_count <> 0 then
    raise exception 'FAIL: queued a reminder that would fire immediately';
  end if;

  -- The confirmation still goes, because that one is timely by definition.
  select count(*) into v_count
  from public.notifications n
  join public.appointments a on a.id = n.appointment_id
  where a.customer_name_snapshot = 'Muy Pronto' and n.kind = 'booking_confirmed';

  if v_count <> 1 then
    raise exception 'FAIL: expected a confirmation, got %', v_count;
  end if;

  raise notice '10 holds';
end;
$$;

commit;

---------------------------------------------------------------------------
-- 7. A booking that has to be accepted first.
---------------------------------------------------------------------------
begin;

update public.businesses
   set auto_confirm_bookings = false
 where id = 'e1110000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
declare
  c_tz constant text := 'America/Santo_Domingo';
  v_date date := ((now() at time zone c_tz)::date + 11);
begin
  perform public.book_appointment(
    'e1110000-0000-4000-8000-0000000000b1', 'e1110000-0000-4000-8000-0000000000c1',
    (v_date::timestamp + time '09:00') at time zone c_tz,
    'Por Confirmar', '+1 809 555 5001', 'porconfirmar@example.test', null, 'es'
  );
end;
$$;

commit;

begin;

do $$
declare
  v_count integer;
begin
  ---------------------------------------------------------------------------
  raise notice '11. a booking awaiting acceptance is not confirmed to anybody';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.notifications n
  join public.appointments a on a.id = n.appointment_id
  where a.customer_name_snapshot = 'Por Confirmar' and n.kind = 'booking_confirmed';

  if v_count <> 0 then
    raise exception 'FAIL: told a customer their pending booking was confirmed';
  end if;

  -- The reminder is queued anyway: it is about a time, not about a status,
  -- and it is cancelled if the booking never becomes real.
  select count(*) into v_count
  from public.notifications n
  join public.appointments a on a.id = n.appointment_id
  where a.customer_name_snapshot = 'Por Confirmar' and n.kind = 'booking_reminder';

  if v_count <> 1 then
    raise exception 'FAIL: expected 1 reminder for a pending booking, got %', v_count;
  end if;

  raise notice '11 holds';
end;
$$;

commit;

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1110000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_id uuid;
begin
  select a.id into v_id from public.appointments a
  where a.customer_name_snapshot = 'Por Confirmar';

  perform public.set_appointment_status(v_id, 'confirmed', null);
end;
$$;

commit;

begin;

do $$
declare
  v_count integer;
begin
  ---------------------------------------------------------------------------
  raise notice '12. accepting it is what confirms it to the customer';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.notifications n
  join public.appointments a on a.id = n.appointment_id
  where a.customer_name_snapshot = 'Por Confirmar' and n.kind = 'booking_confirmed';

  if v_count <> 1 then
    raise exception 'FAIL: expected exactly 1 confirmation after accepting, got %', v_count;
  end if;

  -- And still exactly one reminder: confirming re-runs the scheduler, which
  -- must not leave a second one behind.
  select count(*) into v_count
  from public.notifications n
  join public.appointments a on a.id = n.appointment_id
  where a.customer_name_snapshot = 'Por Confirmar'
    and n.kind = 'booking_reminder' and n.status = 'pending';

  if v_count <> 1 then
    raise exception 'FAIL: % reminders waiting after confirmation', v_count;
  end if;

  raise notice '12 holds';
end;
$$;

commit;

---------------------------------------------------------------------------
-- 8. Idempotency, stated directly.
---------------------------------------------------------------------------
begin;

do $$
declare
  v_appointment public.appointments;
  v_business public.businesses;
  v_before integer;
  v_after integer;
  v_id uuid;
begin
  ---------------------------------------------------------------------------
  raise notice '13. queueing the same thing twice queues it once';
  ---------------------------------------------------------------------------
  select a.* into v_appointment from public.appointments a
  where a.customer_name_snapshot = 'Lucía Fernández';
  select b.* into v_business from public.businesses b where b.id = v_appointment.business_id;

  select count(*) into v_before from public.notifications;

  -- The same key the trigger would build, replayed. This is what a retried
  -- worker, a replayed event or a double submit all come down to.
  v_id := public.enqueue_notification(
    v_appointment, v_business, null, 'booking_confirmed', 'booking.confirmed', 'email',
    now(), 'test:idempotency'
  );
  if v_id is null then
    raise exception 'FAIL: the first enqueue did nothing';
  end if;

  v_id := public.enqueue_notification(
    v_appointment, v_business, null, 'booking_confirmed', 'booking.confirmed', 'email',
    now(), 'test:idempotency'
  );
  if v_id is not null then
    raise exception 'FAIL: the second enqueue created a row';
  end if;

  select count(*) into v_after from public.notifications;
  if v_after <> v_before + 1 then
    raise exception 'FAIL: expected exactly one new row, got %', v_after - v_before;
  end if;

  ---------------------------------------------------------------------------
  raise notice '14. rescheduling the reminder twice leaves one reminder';
  ---------------------------------------------------------------------------
  perform public.schedule_appointment_reminder(v_appointment, v_business);
  perform public.schedule_appointment_reminder(v_appointment, v_business);

  select count(*) into v_after
  from public.notifications
  where appointment_id = v_appointment.id
    and kind = 'booking_reminder' and status = 'pending';

  if v_after <> 1 then
    raise exception 'FAIL: % reminders waiting after scheduling twice', v_after;
  end if;

  raise notice '13-14 hold';
end;
$$;

rollback;

---------------------------------------------------------------------------
-- 9. The dispatcher's side.
---------------------------------------------------------------------------
begin;

do $$
declare
  v_first uuid;
  v_second uuid;
  v_row public.notifications;
  v_claimed integer;
  v_attempts integer;
begin
  ---------------------------------------------------------------------------
  raise notice '15. claiming takes what is due, once, and counts the attempt';
  ---------------------------------------------------------------------------
  select count(*) into v_claimed from public.claim_due_notifications(100);

  if v_claimed = 0 then
    raise exception 'FAIL: nothing was due, so the claim proves nothing';
  end if;

  -- Everything due is now in flight; a second claim has nothing left to take.
  if (select count(*) from public.claim_due_notifications(100)) <> 0 then
    raise exception 'FAIL: the same notifications were claimed twice';
  end if;

  select id into v_first from public.notifications where status = 'processing' limit 1;

  select attempt_count into v_attempts from public.notifications where id = v_first;
  if v_attempts <> 1 then
    raise exception 'FAIL: claiming did not count an attempt (count is %)', v_attempts;
  end if;

  ---------------------------------------------------------------------------
  raise notice '16. a send that worked is recorded, and cannot be claimed again';
  ---------------------------------------------------------------------------
  if not public.mark_notification_sent(v_first, 'mock', 'mock-1') then
    raise exception 'FAIL: marking a claimed notification as sent did nothing';
  end if;

  select * into v_row from public.notifications where id = v_first;
  if v_row.status <> 'sent' or v_row.sent_at is null or v_row.provider <> 'mock' then
    raise exception 'FAIL: a sent notification is %, sent_at %', v_row.status, v_row.sent_at;
  end if;

  -- Marking it again is a no-op rather than a second send.
  if public.mark_notification_sent(v_first, 'mock', 'mock-2') then
    raise exception 'FAIL: a notification was marked sent twice';
  end if;

  ---------------------------------------------------------------------------
  raise notice '17. a transient failure goes back in the queue, later';
  ---------------------------------------------------------------------------
  select id into v_second from public.notifications where status = 'processing' limit 1;

  if not public.mark_notification_failed(v_second, 'provider timed out') then
    raise exception 'FAIL: marking a failure did nothing';
  end if;

  select * into v_row from public.notifications where id = v_second;
  if v_row.status <> 'pending' then
    raise exception 'FAIL: a transient failure left the row %', v_row.status;
  end if;
  if v_row.scheduled_for <= now() then
    raise exception 'FAIL: a failed notification is due again immediately';
  end if;
  if v_row.last_error is null then
    raise exception 'FAIL: the reason was not recorded';
  end if;

  ---------------------------------------------------------------------------
  raise notice '18. a permanent failure is not tried again';
  ---------------------------------------------------------------------------
  update public.notifications set status = 'processing' where id = v_second;

  perform public.mark_notification_failed(v_second, 'not an address', null, true);

  select * into v_row from public.notifications where id = v_second;
  if v_row.status <> 'failed' or v_row.failed_at is null then
    raise exception 'FAIL: a permanent failure left the row %', v_row.status;
  end if;
  if v_row.attempt_count >= v_row.max_attempts then
    raise exception 'FAIL: this row exhausted its attempts, so it proves nothing about permanence';
  end if;

  ---------------------------------------------------------------------------
  raise notice '19. attempts are bounded';
  ---------------------------------------------------------------------------
  update public.notifications
     set status = 'processing', attempt_count = max_attempts
   where id = v_second;

  perform public.mark_notification_failed(v_second, 'still down');

  select * into v_row from public.notifications where id = v_second;
  if v_row.status <> 'failed' then
    raise exception 'FAIL: a notification out of attempts is %', v_row.status;
  end if;

  ---------------------------------------------------------------------------
  raise notice '20. a dispatcher that died does not park its rows forever';
  ---------------------------------------------------------------------------
  update public.notifications
     set status = 'processing', attempt_count = 1,
         claimed_at = now() - interval '1 hour'
   where id = v_first;

  if public.requeue_stalled_notifications(interval '15 minutes') < 1 then
    raise exception 'FAIL: a stalled claim was not put back';
  end if;

  select * into v_row from public.notifications where id = v_first;
  if v_row.status <> 'pending' then
    raise exception 'FAIL: a stalled claim is still %', v_row.status;
  end if;
  if v_row.attempt_count <> 1 then
    raise exception 'FAIL: requeueing gave back the attempt it burned';
  end if;

  -- A claim that is merely recent is left alone: it belongs to a dispatcher
  -- that is working right now.
  update public.notifications
     set status = 'processing', claimed_at = now()
   where id = v_first;

  if public.requeue_stalled_notifications(interval '15 minutes') <> 0 then
    raise exception 'FAIL: a live claim was taken from its dispatcher';
  end if;

  raise notice '15-20 hold';
end;
$$;

rollback;

---------------------------------------------------------------------------
-- 10. Who may see, and who may act.
---------------------------------------------------------------------------
begin;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

do $$
declare
  v_count integer;
begin
  ---------------------------------------------------------------------------
  raise notice '20. an anonymous visitor reads no notifications at all';
  ---------------------------------------------------------------------------
  -- Not "sees zero rows": anon has no privilege on this table whatsoever, so
  -- the question is refused rather than answered emptily. A guest holding a
  -- booking link has an appointment to look at, never an outbox.
  begin
    select count(*) into v_count from public.notifications;
    raise exception 'FAIL: anon can read the outbox (% rows)', v_count;
  exception
    when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------------------
  raise notice '21. and cannot drive the dispatcher';
  ---------------------------------------------------------------------------
  begin
    perform public.claim_due_notifications(1);
    raise exception 'FAIL: anon claimed notifications';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.mark_notification_sent(gen_random_uuid(), 'mock');
    raise exception 'FAIL: anon marked a notification as sent';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.cancel_pending_reminders(gen_random_uuid());
    raise exception 'FAIL: anon cancelled reminders';
  exception
    when insufficient_privilege then null;
  end;

  raise notice '20-21 hold';
end;
$$;

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e2220000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_count integer;
  v_other constant uuid := 'e1110000-0000-4000-8000-000000000001';
begin
  ---------------------------------------------------------------------------
  raise notice '22. one business never sees another business''s notifications';
  ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.notifications where business_id = v_other;

  if v_count <> 0 then
    raise exception 'FAIL: a neighbour can read % of this business''s notifications', v_count;
  end if;

  -- Its own, it can read: that is what the operational screen runs on.
  select count(*) into v_count
  from public.notifications
  where business_id = 'e2220000-0000-4000-8000-000000000001';

  if v_count = 0 then
    raise exception 'FAIL: a business cannot read its own notifications';
  end if;

  ---------------------------------------------------------------------------
  raise notice '23. and cannot write to the outbox, not even its own';
  ---------------------------------------------------------------------------
  begin
    insert into public.notifications (
      business_id, kind, channel, recipient_kind, recipient, template_key,
      locale, dedupe_key
    )
    values (
      'e2220000-0000-4000-8000-000000000001', 'booking_confirmed', 'email', 'customer',
      'somebody@example.test', 'booking.confirmed', 'es', 'test:forged'
    );
    raise exception 'FAIL: a professional inserted a notification';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.notifications set status = 'cancelled'
    where business_id = 'e2220000-0000-4000-8000-000000000001';
    raise exception 'FAIL: a professional rewrote the outbox';
  exception
    when insufficient_privilege then null;
  end;

  begin
    delete from public.notifications
    where business_id = 'e2220000-0000-4000-8000-000000000001';
    raise exception 'FAIL: a professional deleted from the outbox';
  exception
    when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------------------
  raise notice '24. a professional cannot queue a message for a stranger';
  ---------------------------------------------------------------------------
  begin
    perform public.claim_due_notifications(1);
    raise exception 'FAIL: a professional claimed notifications';
  exception
    when insufficient_privilege then null;
  end;

  raise notice '22-24 hold';
end;
$$;

rollback;

---------------------------------------------------------------------------
-- 11. The identity a message is addressed with does not change afterwards.
---------------------------------------------------------------------------
begin;

do $$
declare
  v_appointment public.appointments;
  v_customer uuid;
  v_name text;
  v_refused boolean;
begin
  ---------------------------------------------------------------------------
  raise notice '25. editing the customer record does not rewrite the past';
  ---------------------------------------------------------------------------
  select a.* into v_appointment
  from public.appointments a where a.customer_name_snapshot = 'Lucía Fernández';

  update public.customers
     set full_name = 'Lucia F.', email = 'otra@example.test'
   where id = v_appointment.customer_id;

  select customer_name_snapshot into v_name
  from public.appointments where id = v_appointment.id;

  if v_name <> 'Lucía Fernández' then
    raise exception 'FAIL: the appointment now says the customer was %', v_name;
  end if;

  ---------------------------------------------------------------------------
  raise notice '26. and the appointment refuses to be edited into a lie';
  ---------------------------------------------------------------------------
  v_refused := false;
  begin
    update public.appointments
       set customer_name_snapshot = 'Otra Persona'
     where id = v_appointment.id;
  exception
    when invalid_parameter_value then
      v_refused := (sqlerrm = 'APPOINTMENT_IDENTITY_IS_IMMUTABLE');
  end;

  if not v_refused then
    raise exception 'FAIL: an appointment rewrote who booked it';
  end if;

  raise notice '25-26 hold';
end;
$$;

rollback;

\echo 'Notification outbox holds.'
