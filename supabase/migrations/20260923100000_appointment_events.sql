-- ===========================================================================
-- Phase 5 - one append-only history for everything that happens to an
-- appointment.
--
-- The brief suggested `appointment_status_history`. Rescheduling arrives in
-- the same phase, and a reschedule is exactly as auditable an act as a
-- cancellation -- so rather than two parallel audit tables that a support
-- question would have to be asked of twice, there is one event log with a
-- discriminator. Support, notifications, payments and disputes all want the
-- same question answered: "what happened to this appointment, when, and who
-- did it".
--
-- Two properties matter more than the shape:
--
--   * It is written by a trigger, not by the RPCs. A direct UPDATE that RLS
--     permits still leaves a trace, so history cannot be bypassed by not
--     using the front door.
--
--   * It is append-only to every client. There is a SELECT policy for members
--     of the business and no INSERT, UPDATE or DELETE policy at all. The
--     trigger is SECURITY DEFINER, so it writes past RLS; nothing else can
--     write, amend or erase a row.
--
-- Not exposed to guests. A customer holding a booking link can see their own
-- appointment; they have no business reading who inside the shop touched it.
-- ===========================================================================

create type public.appointment_event_type as enum (
  'created',
  'status_changed',
  'rescheduled'
);

-- Who acted. `system` covers anything not attributable to a person: a
-- migration, a future scheduled job, a direct operator UPDATE.
create type public.appointment_actor_type as enum (
  'professional',
  'guest',
  'system'
);

create table public.appointment_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,

  -- Denormalised so the SELECT policy never has to join back to appointments.
  business_id uuid not null references public.businesses (id) on delete cascade,

  event_type public.appointment_event_type not null,
  actor_type public.appointment_actor_type not null,

  -- Null for a guest, and for anything the system did on its own.
  changed_by_user_id uuid references auth.users (id) on delete set null,

  previous_status public.appointment_status,
  new_status public.appointment_status,

  previous_starts_at timestamptz,
  previous_ends_at timestamptz,
  new_starts_at timestamptz,
  new_ends_at timestamptz,

  reason text,

  -- clock_timestamp(), not now(): now() is the transaction timestamp, so two
  -- events written by one statement -- a status change and a move together --
  -- would share an instant and the log would lose its order.
  occurred_at timestamptz not null default clock_timestamp(),

  -- A status change that changes no status, or a reschedule that moves
  -- nothing, is a bug rather than history.
  constraint appointment_events_status_change_is_a_change check (
    event_type <> 'status_changed'
      or (new_status is not null and previous_status is distinct from new_status)
  ),
  constraint appointment_events_reschedule_is_a_move check (
    event_type <> 'rescheduled'
      or (new_starts_at is not null and previous_starts_at is distinct from new_starts_at)
  )
);

create index appointment_events_appointment_idx
  on public.appointment_events (appointment_id, occurred_at);

create index appointment_events_business_idx
  on public.appointment_events (business_id, occurred_at desc);

comment on table public.appointment_events is
  'Append-only history of an appointment: creation, status changes and reschedules. Written by a trigger so it cannot be bypassed, and readable only by members of the business.';

-- ---------------------------------------------------------------------------
-- The actor is declared by the caller for the duration of one transaction.
--
-- A setting rather than an RPC argument, because the trigger fires for writes
-- that never went through an RPC. When nothing declared itself, a signed-in
-- caller is a professional and anyone else is the system: an unattributed
-- change is recorded as unattributed rather than mislabelled.
-- ---------------------------------------------------------------------------

create or replace function public.declare_appointment_actor(
  p_actor_type public.appointment_actor_type,
  p_reason text default null
)
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $fn$
begin
  perform set_config('app.actor_type', p_actor_type::text, true);
  perform set_config('app.event_reason', coalesce(p_reason, ''), true);
end;
$fn$;

create or replace function public.appointments_record_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor public.appointment_actor_type;
  v_reason text;
  v_user uuid := auth.uid();
begin
  v_actor := coalesce(
    nullif(current_setting('app.actor_type', true), '')::public.appointment_actor_type,
    (case when v_user is not null then 'professional' else 'system' end)::public.appointment_actor_type
  );
  v_reason := nullif(btrim(coalesce(current_setting('app.event_reason', true), '')), '');

  if tg_op = 'INSERT' then
    insert into public.appointment_events (
      appointment_id, business_id, event_type, actor_type, changed_by_user_id,
      new_status, new_starts_at, new_ends_at, reason
    )
    values (
      new.id, new.business_id, 'created', v_actor, v_user,
      new.status, new.starts_at, new.ends_at, v_reason
    );
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.appointment_events (
      appointment_id, business_id, event_type, actor_type, changed_by_user_id,
      previous_status, new_status, reason
    )
    values (
      new.id, new.business_id, 'status_changed', v_actor, v_user,
      old.status, new.status,
      -- A cancellation already carries its reason on the row; using it keeps
      -- the two from disagreeing.
      case when new.status = 'cancelled'
        then coalesce(new.cancellation_reason, v_reason)
        else v_reason
      end
    );
  end if;

  if new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at then
    insert into public.appointment_events (
      appointment_id, business_id, event_type, actor_type, changed_by_user_id,
      previous_starts_at, previous_ends_at, new_starts_at, new_ends_at, reason
    )
    values (
      new.id, new.business_id, 'rescheduled', v_actor, v_user,
      old.starts_at, old.ends_at, new.starts_at, new.ends_at, v_reason
    );
  end if;

  return null;
end;
$fn$;

create trigger appointments_record_event
  after insert or update on public.appointments
  for each row execute function public.appointments_record_event();

-- ---------------------------------------------------------------------------
-- Row level security: readable by the business, writable by nobody.
-- ---------------------------------------------------------------------------

alter table public.appointment_events enable row level security;

create policy appointment_events_select_member on public.appointment_events
  for select to authenticated
  using (public.is_business_member(business_id));

-- No insert, update or delete policy anywhere, and that is the design: the
-- only writer is a SECURITY DEFINER trigger, so history is append-only from
-- every client, including the owner of the business.

revoke all on function public.appointments_record_event() from public, anon, authenticated;
revoke all on function public.declare_appointment_actor(public.appointment_actor_type, text)
  from public, anon, authenticated;
