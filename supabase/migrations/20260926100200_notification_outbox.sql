-- ===========================================================================
-- Phase 8 - the notification outbox.
--
-- The rule this table exists to enforce: **booking an appointment must never
-- depend on a messaging provider being up.** A transaction that books a slot
-- does one extra thing, and it is a local insert. Nothing in the booking path
-- opens a socket, waits on an API, or can be made to fail by somebody else's
-- outage. What leaves the building is decided later, by a dispatcher reading
-- this table.
--
--     appointment write
--       -> appointment_events (the existing log, Phase 5)
--         -> notifications (this table)
--           -> dispatcher
--             -> provider adapter
--               -> delivery result, recorded back here
--
-- Queued from `appointment_events` rather than from the RPCs, for the same
-- reason history is: a direct UPDATE that RLS permits still produces an event,
-- so it still produces the notification it should. There is no second
-- lifecycle model -- the log that already exists is the source.
--
-- Idempotency is a column, not a convention. `dedupe_key` is derived from the
-- event (or, for a reminder, from the appointment and the time it is for), and
-- it is unique. A retried worker, a replayed event, a double-submitted form
-- and a re-run of this trigger all collide on the same key and the second one
-- does nothing.
--
-- What is deliberately NOT here:
--
--   * No provider credentials. Nothing in this schema knows how to send.
--   * No booking access token. The guest's credential is a bearer credential
--     (ADR 0019) and a queue row is the wrong place for it; when an email one
--     day needs a link, it gets one built at send time, in the fragment form.
--   * No campaign engine. One reminder, one lead time, per appointment.
-- ===========================================================================

create type public.notification_channel as enum (
  'email',
  'sms',
  'whatsapp',
  'push',
  'in_app'
);

create type public.notification_status as enum (
  'pending',
  'processing',
  'sent',
  'failed',
  'cancelled'
);

-- The four the product promises. A new one is a migration, on purpose: a
-- notification type is a promise to a customer, not a configuration value.
create type public.notification_kind as enum (
  'booking_confirmed',
  'booking_rescheduled',
  'booking_cancelled',
  'booking_reminder'
);

create type public.notification_recipient_kind as enum (
  'customer',
  'professional'
);

-- ---------------------------------------------------------------------------
-- How far ahead a reminder goes out. Per business, because a dentist and a
-- barber do not agree about this. Zero means the business sends none.
-- ---------------------------------------------------------------------------
alter table public.businesses
  add column reminder_lead_minutes integer not null default 1440
    constraint businesses_reminder_lead_is_sane
      check (reminder_lead_minutes >= 0 and reminder_lead_minutes <= 20160);

comment on column public.businesses.reminder_lead_minutes is
  'How long before an appointment its reminder is queued for. 0 disables reminders for this business. Default 24 hours.';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),

  -- Denormalised so the SELECT policy never joins back to appointments, and
  -- so a notification survives being asked about after its appointment is
  -- gone. The cascade still removes it with the business.
  business_id uuid not null references public.businesses (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete cascade,

  -- What happened. Null for a reminder: no single event asks for it.
  event_id uuid references public.appointment_events (id) on delete set null,

  kind public.notification_kind not null,
  channel public.notification_channel not null,
  recipient_kind public.notification_recipient_kind not null,

  -- The address as it was at the time: an email or a phone number, depending
  -- on the channel. Frozen for the same reason the appointment freezes the
  -- customer's name -- a message is addressed to who booked, not to whoever
  -- the reusable customer record has become.
  recipient text not null check (btrim(recipient) <> ''),

  -- Semantic, never a sentence: `booking.confirmed`, not "Your booking is
  -- confirmed". The words live in the template registry, in both languages.
  template_key text not null check (btrim(template_key) <> ''),

  -- Copied from the appointment when the row is queued, so a message that is
  -- already waiting does not change language later.
  locale text not null
    constraint notifications_locale_shape check (locale ~ '^[a-z]{2}(-[A-Za-z]{2,4})?$'),

  -- Everything the message needs, and nothing it does not. Rendering reads
  -- this and not the live rows, so a message says what was true when it was
  -- queued -- and a reminder that is moved has its payload moved with it.
  payload jsonb not null default '{}'::jsonb,

  status public.notification_status not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),

  scheduled_for timestamptz not null default now(),
  -- When a dispatcher took it. "In flight since", as data rather than as
  -- something inferred from updated_at, which every other write also moves.
  claimed_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,

  -- A short reason, never a payload. See mark_notification_failed.
  last_error text,
  provider text,
  provider_message_id text,

  -- The whole of idempotency. Deterministic, and unique.
  dedupe_key text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notifications_dedupe_key_unique unique (dedupe_key),
  constraint notifications_sent_has_a_time check (
    (status <> 'sent') or (sent_at is not null)
  ),
  constraint notifications_failed_has_a_time check (
    (status <> 'failed') or (failed_at is not null)
  )
);

-- The dispatcher's only question: what is due? Partial, so the index stays
-- the size of the backlog rather than the size of the history.
create index notifications_due_idx
  on public.notifications (scheduled_for)
  where status = 'pending';

create index notifications_business_idx
  on public.notifications (business_id, created_at desc);

create index notifications_appointment_idx
  on public.notifications (appointment_id, kind);

comment on table public.notifications is
  'Durable outbox. Appointment events queue rows here; a dispatcher sends them. Nothing in a booking transaction talks to a messaging provider.';

create or replace function public.notifications_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

create trigger notifications_touch_updated_at
  before update on public.notifications
  for each row execute function public.notifications_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security.
--
-- A member of the business may read its own notifications, which is what
-- makes the operational view possible without a service key. Nobody may
-- write: every row is put there by a SECURITY DEFINER trigger, and moved on
-- by SECURITY DEFINER functions that no client role may execute. An anonymous
-- caller has no policy at all, so the table answers with nothing.
-- ---------------------------------------------------------------------------

alter table public.notifications enable row level security;

create policy notifications_select_member on public.notifications
  for select to authenticated
  using (public.is_business_member(business_id));

-- Table privileges, stated rather than inherited.
--
-- 20260925100000 makes this schema grant its own tables, which means a new
-- table arrives with ALL privileges for anon and authenticated and is then
-- held back by policies alone. For every other table that is right: the
-- policies are the model. Here it is not, because there is no legitimate
-- client write at all, and "no policy" fails silently -- an UPDATE with
-- nothing to match simply reports zero rows. Revoking makes the attempt an
-- error instead of a shrug, which is what an audit can see.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Queueing.
-- ---------------------------------------------------------------------------

/**
 * The address a given channel would use for the customer of an appointment.
 *
 * One place, so "which channels does this product actually send on" is one
 * decision rather than a rule repeated at four call sites. Today only email
 * is queued, because email is the only channel that costs nothing to try; the
 * phone channels are in the enum so that adding one is an adapter and a line
 * here, not a schema change.
 */
create or replace function public.notification_recipient_for(
  p_appointment public.appointments,
  p_channel public.notification_channel
)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $fn$
begin
  return case p_channel
    when 'email' then nullif(btrim(coalesce(p_appointment.customer_email_snapshot, '')), '')
    when 'sms' then nullif(btrim(coalesce(p_appointment.customer_phone_snapshot, '')), '')
    when 'whatsapp' then nullif(btrim(coalesce(p_appointment.customer_phone_snapshot, '')), '')
    else null
  end;
end;
$fn$;

/**
 * What a message needs to say, frozen at the moment it is queued.
 *
 * Minimal on purpose: a name, a service, an instant and the timezone it is
 * meant to be read in. No notes, no price, no phone number, no token. A queue
 * row is read by more systems than a booking row is.
 */
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
begin
  select p.display_name into v_professional
  from public.professional_profiles p
  where p.id = p_appointment.professional_id;

  select i.service_name_snapshot into v_service
  from public.appointment_items i
  where i.appointment_id = p_appointment.id
  order by i.created_at
  limit 1;

  return jsonb_build_object(
    'appointmentId', p_appointment.id,
    'businessName', p_business.name,
    'professionalName', v_professional,
    'serviceName', v_service,
    'customerName', p_appointment.customer_name_snapshot,
    'startsAt', to_char(p_appointment.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'endsAt', to_char(p_appointment.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'timezone', p_business.timezone
  );
end;
$fn$;

/**
 * Queues one notification, or does nothing because it is already queued.
 *
 * The `on conflict do nothing` is the idempotency guarantee at its narrowest:
 * two concurrent writers racing on the same key leave exactly one row, and the
 * loser is not an error.
 */
create or replace function public.enqueue_notification(
  p_appointment public.appointments,
  p_business public.businesses,
  p_event_id uuid,
  p_kind public.notification_kind,
  p_template_key text,
  p_channel public.notification_channel,
  p_scheduled_for timestamptz,
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
  v_id uuid;
begin
  v_recipient := public.notification_recipient_for(p_appointment, p_channel);

  -- No address is not a failure. A guest may book without an email, and that
  -- booking is as valid as any other; there is simply nothing to queue.
  if v_recipient is null then
    return null;
  end if;

  insert into public.notifications (
    business_id, appointment_id, event_id, kind, channel, recipient_kind,
    recipient, template_key, locale, payload, scheduled_for, dedupe_key
  )
  values (
    p_business.id,
    p_appointment.id,
    p_event_id,
    p_kind,
    p_channel,
    'customer',
    v_recipient,
    p_template_key,
    p_appointment.customer_locale,
    public.notification_payload_for(p_appointment, p_business),
    p_scheduled_for,
    p_dedupe_key
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$fn$;

/**
 * Stops any reminder that has not gone out yet.
 *
 * `processing` is deliberately left alone: it is in a dispatcher's hands at
 * this instant, and taking it back would be a race for no benefit. The
 * dispatcher's own send is idempotent at the provider boundary.
 */
create or replace function public.cancel_pending_reminders(p_appointment_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_count integer;
begin
  update public.notifications
     set status = 'cancelled'
   where appointment_id = p_appointment_id
     and kind = 'booking_reminder'
     and status = 'pending';

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

/**
 * Puts the appointment's reminder where it belongs, whatever happened to it.
 *
 * Called after creation and after every move, and it is written so that
 * calling it twice changes nothing:
 *
 *   * a terminal appointment gets no reminder, and loses the one it had;
 *   * a business with no lead time gets none;
 *   * an appointment sooner than the lead time gets none -- a "reminder" that
 *     fires the instant you book is noise, not a service;
 *   * a move cancels the reminder for the old time and queues one for the new,
 *     which is also what makes a move *after* the reminder already went out
 *     produce a second, correct one.
 *
 * The time is in the key for that last reason: a reminder is a promise about
 * one instant, so the instant is part of its identity.
 */
create or replace function public.schedule_appointment_reminder(
  p_appointment public.appointments,
  p_business public.businesses
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_due timestamptz;
  v_key text;
  v_id uuid;
begin
  perform public.cancel_pending_reminders(p_appointment.id);

  if p_appointment.status not in ('pending', 'confirmed') then
    return null;
  end if;

  if p_business.reminder_lead_minutes = 0 then
    return null;
  end if;

  v_due := p_appointment.starts_at
           - make_interval(mins => p_business.reminder_lead_minutes);

  if v_due <= now() then
    return null;
  end if;

  v_key := 'apt:' || p_appointment.id::text
           || ':booking.reminder:email:'
           || extract(epoch from p_appointment.starts_at)::bigint::text;

  v_id := public.enqueue_notification(
    p_appointment, p_business, null,
    'booking_reminder', 'booking.reminder', 'email',
    v_due, v_key
  );

  -- The same appointment moved away and back again: the row for this instant
  -- exists and was cancelled on the way out. Bring it back, unless it has
  -- already been sent, in which case there is nothing to remind anybody of.
  if v_id is null then
    update public.notifications
       set status = 'pending',
           attempt_count = 0,
           scheduled_for = v_due,
           last_error = null,
           payload = public.notification_payload_for(p_appointment, p_business)
     where dedupe_key = v_key
       and status = 'cancelled'
    returning id into v_id;
  end if;

  return v_id;
end;
$fn$;

/**
 * The bridge: one appointment event in, the notifications it implies out.
 *
 * Reads only the event and the rows it points at, so it behaves the same
 * whether the event came from an RPC, from a direct UPDATE, or from a future
 * job. It never raises on a missing address or an appointment that has been
 * deleted underneath it -- a notification is a consequence of the booking,
 * never a condition of it.
 */
create or replace function public.notifications_from_appointment_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_appointment public.appointments;
  v_business public.businesses;
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

  if new.event_type = 'created' then
    -- A booking that still has to be accepted has not been confirmed to
    -- anybody yet; the confirmation goes out when it is confirmed.
    if new.new_status = 'confirmed' then
      perform public.enqueue_notification(
        v_appointment, v_business, new.id,
        'booking_confirmed', 'booking.confirmed', 'email',
        now(),
        'evt:' || new.id::text || ':booking_confirmed:email'
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
    perform public.schedule_appointment_reminder(v_appointment, v_business);
    return null;
  end if;

  return null;
end;
$fn$;

-- Deferred to the end of the transaction, and that is not a detail.
--
-- `book_appointment` inserts the appointment and then its items, so an
-- immediate trigger would read the appointment before the service it is for
-- exists and queue a message that could not name it. Deferring also means the
-- payload is built from the state the transaction actually committed, not
-- from a half-written moment inside it.
create constraint trigger appointment_events_queue_notifications
  after insert on public.appointment_events
  deferrable initially deferred
  for each row execute function public.notifications_from_appointment_event();

-- ---------------------------------------------------------------------------
-- The dispatcher's side of the boundary.
--
-- All three are INTERNAL ONLY: no client role may execute them, so a browser
-- holding the anon key -- or a signed-in professional -- cannot claim, send,
-- or mark anything. They are called by an operator connection.
-- ---------------------------------------------------------------------------

/**
 * Takes up to `p_limit` due notifications and marks them in flight.
 *
 * `for update skip locked` is what makes more than one dispatcher safe: two
 * workers running at the same instant take disjoint sets rather than the same
 * row twice, and neither waits for the other. The attempt is counted here, on
 * the claim, so a worker that dies mid-send still consumed an attempt and the
 * row cannot be retried forever.
 */
create or replace function public.claim_due_notifications(p_limit integer default 20)
returns setof public.notifications
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
begin
  return query
  with due as (
    select n.id
    from public.notifications n
    where n.status = 'pending'
      and n.scheduled_for <= now()
    order by n.scheduled_for, n.created_at
    for update skip locked
    limit greatest(coalesce(p_limit, 20), 0)
  )
  update public.notifications n
     set status = 'processing',
         attempt_count = n.attempt_count + 1,
         claimed_at = now()
    from due
   where n.id = due.id
  returning n.*;
end;
$fn$;

/**
 * Puts back what a dispatcher took and never finished.
 *
 * A worker that is killed between claiming and recording leaves its rows in
 * `processing` forever: nothing else will claim them, and nobody is told. The
 * attempt it burned is deliberately not given back -- it may well have sent
 * the message before dying, and the bound on attempts is what stops a crash
 * loop from turning into a hundred copies of the same email.
 *
 */
create or replace function public.requeue_stalled_notifications(
  p_older_than interval default interval '15 minutes'
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_count integer;
begin
  update public.notifications
     set status = 'pending',
         claimed_at = null,
         last_error = coalesce(last_error, 'reclaimed after a dispatcher stopped')
   where status = 'processing'
     and claimed_at is not null
     and claimed_at < now() - p_older_than;

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

create or replace function public.mark_notification_sent(
  p_id uuid,
  p_provider text,
  p_provider_message_id text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_count integer;
begin
  update public.notifications
     set status = 'sent',
         sent_at = now(),
         claimed_at = null,
         failed_at = null,
         last_error = null,
         provider = p_provider,
         provider_message_id = p_provider_message_id
   where id = p_id
     and status = 'processing';

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$fn$;

/**
 * Records a failed send, and decides whether it is worth trying again.
 *
 * Bounded: `max_attempts` attempts, then the row is `failed` and stays there.
 * The backoff doubles and stops at an hour, so a provider that is down does
 * not turn into a retry storm against it.
 *
 * `p_error` is truncated, and the caller is expected to pass a reason -- a
 * status line, a provider code -- never a payload or a response body. This
 * column is read by everyone who can read the business's notifications.
 */
create or replace function public.mark_notification_failed(
  p_id uuid,
  p_error text,
  p_retry_after interval default null,
  p_permanent boolean default false
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row public.notifications;
  v_exhausted boolean;
  v_backoff interval;
begin
  select * into v_row from public.notifications where id = p_id and status = 'processing';
  if not found then
    return false;
  end if;

  -- A provider that says "this address is not an address" is not going to
  -- change its mind in four minutes. Retrying it is a retry storm with extra
  -- steps, so a permanent failure is failed now.
  v_exhausted := p_permanent or v_row.attempt_count >= v_row.max_attempts;
  v_backoff := coalesce(
    p_retry_after,
    make_interval(secs => least(3600, 60 * power(2, greatest(v_row.attempt_count - 1, 0))::int))
  );

  update public.notifications
     set status = (case when v_exhausted then 'failed' else 'pending' end)::public.notification_status,
         claimed_at = null,
         failed_at = case when v_exhausted then now() else null end,
         scheduled_for = case when v_exhausted then scheduled_for else now() + v_backoff end,
         last_error = left(coalesce(btrim(p_error), 'unknown'), 500)
   where id = p_id;

  return true;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Grant classification. Everything here is INTERNAL ONLY: the outbox is
-- filled by triggers and drained by an operator, and no browser is either.
-- ---------------------------------------------------------------------------

revoke all on function public.notification_recipient_for(public.appointments, public.notification_channel)
  from public, anon, authenticated;
revoke all on function public.notification_payload_for(public.appointments, public.businesses)
  from public, anon, authenticated;
revoke all on function public.enqueue_notification(
  public.appointments, public.businesses, uuid, public.notification_kind, text,
  public.notification_channel, timestamptz, text
) from public, anon, authenticated;
revoke all on function public.cancel_pending_reminders(uuid)
  from public, anon, authenticated;
revoke all on function public.schedule_appointment_reminder(public.appointments, public.businesses)
  from public, anon, authenticated;
revoke all on function public.notifications_from_appointment_event()
  from public, anon, authenticated;
revoke all on function public.notifications_touch_updated_at()
  from public, anon, authenticated;
revoke all on function public.claim_due_notifications(integer)
  from public, anon, authenticated;
revoke all on function public.requeue_stalled_notifications(interval)
  from public, anon, authenticated;
revoke all on function public.mark_notification_sent(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.mark_notification_failed(uuid, text, interval, boolean)
  from public, anon, authenticated;
