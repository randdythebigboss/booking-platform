-- ===========================================================================
-- Phase 9 - the payment domain.
--
-- A booking and a payment are related and separate. An appointment can exist
-- without money, money can be owed and not paid, and -- this one matters -- an
-- appointment can be cancelled while its payment is still `paid`, because
-- cancelling is not refunding. Conflating the two is how a product quietly
-- gives money away.
--
-- What is authoritative:
--
--   * **The database.** A browser never says how much something costs, and
--     never says that it was paid. The amount is computed here from the
--     service; the outcome arrives through one function that only an operator
--     -- or, in development, the simulator -- may call.
--   * **The provider, eventually.** A real gateway's callback is the final
--     word on whether money moved. `apply_payment_outcome` is that entry
--     point, and it is idempotent, because a callback that arrives twice is
--     normal and being charged twice is not.
--
-- What this deliberately does not do: hold money for anybody. Each business
-- owns its own relationship with its own provider. There is no platform
-- balance, no payout, no wallet, and nothing here assumes there ever will be.
--
-- No card number, no CVV, no token that could stand in for one, ever touches
-- this schema. What a provider sends back is a reference and a status.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Whether this deployment may simulate payments.
--
-- The mock provider is how every payment path is exercised before a real
-- provider exists, and a simulated success has to be refused in production or
-- it is a way to book without paying. So it is a switch, off unless somebody
-- turned it on, and the development seed is what turns it on.
--
-- One row, no policies: nothing with an anon or authenticated key can read it,
-- let alone set it.
-- ---------------------------------------------------------------------------
create table public.platform_settings (
  id boolean primary key default true constraint platform_settings_is_one_row check (id),
  payment_simulation_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id) values (true);

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;

comment on table public.platform_settings is
  'One row of deployment-wide switches. No client role may read or write it. payment_simulation_enabled must be false wherever real money is possible.';

create or replace function public.payment_simulation_enabled()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce((select payment_simulation_enabled from public.platform_settings), false);
$fn$;

-- ---------------------------------------------------------------------------
-- The payment itself.
--
-- `payments` existed from the first schema with the right shape; this widens
-- it rather than starting a parallel concept.
--
-- What it freezes: the amount, the currency, what was being asked for, and
-- which provider was asked. What it does **not** copy, because the rows it
-- points at are already immutable snapshots: the service (appointment_items),
-- the customer (appointments.customer_*_snapshot, ADR 0021) and the
-- professional. Duplicating those would create two versions of the truth.
-- ---------------------------------------------------------------------------

alter table public.payments
  alter column amount type numeric(12, 2),
  add column business_id uuid references public.businesses (id) on delete cascade,
  add column requirement public.payment_requirement not null default 'full',
  add column idempotency_key text,
  add column failure_code text,
  add column paid_at timestamptz,
  add column refunded_at timestamptz,
  add column refunded_amount numeric(12, 2)
    constraint payments_refund_is_positive check (refunded_amount is null or refunded_amount > 0);

update public.payments p
   set business_id = a.business_id
  from public.appointments a
 where a.id = p.appointment_id and p.business_id is null;

alter table public.payments
  alter column business_id set not null;

-- At most one payment may be open for an appointment at a time. A failed
-- payment is final -- a retry is a new attempt, with its own row and its own
-- place in the history -- so this constrains only the states that are live.
create unique index payments_one_open_per_appointment
  on public.payments (appointment_id)
  where status in ('pending', 'requires_action', 'authorized');

create index payments_business_idx on public.payments (business_id, created_at desc);

-- The same provider callback arriving twice must not produce two of anything.
create unique index payments_idempotency_key_idx
  on public.payments (idempotency_key)
  where idempotency_key is not null;

comment on column public.payments.amount is
  'Exact numeric, in the currency below. Frozen when the payment is created: a later price change does not rewrite what was owed.';
comment on column public.payments.requirement is
  'What was being asked for when this payment was created: a deposit, or the full price.';

-- ---------------------------------------------------------------------------
-- The history of a payment, which nobody may edit.
--
-- Separate from appointment_events on purpose. An appointment event answers
-- "what happened to this booking"; a payment event answers "what did the
-- provider say, and when". They have different readers -- support, disputes,
-- reconciliation -- different retention questions, and mixing them would make
-- both harder to read.
-- ---------------------------------------------------------------------------

create type public.payment_event_type as enum (
  'created',
  'status_changed',
  'refund_requested'
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,

  -- Denormalised so the read policy never joins back, exactly as
  -- appointment_events does.
  business_id uuid not null references public.businesses (id) on delete cascade,

  event_type public.payment_event_type not null,
  previous_status public.payment_status,
  new_status public.payment_status,

  provider text,
  provider_reference text,
  failure_code text,
  amount numeric(12, 2),

  -- What made this happen, when the caller knows: a provider callback id, a
  -- simulated scenario. Never a gateway payload: those echo the request.
  idempotency_key text,
  detail text,

  -- clock_timestamp, not now(): two events written by one statement must not
  -- share an instant, or the log loses its order.
  occurred_at timestamptz not null default clock_timestamp()
);

create index payment_events_payment_idx on public.payment_events (payment_id, occurred_at);
create index payment_events_business_idx on public.payment_events (business_id, occurred_at desc);

comment on table public.payment_events is
  'Append-only history of a payment. Written by a trigger, readable by the business, editable by nobody.';

-- ---------------------------------------------------------------------------
-- The state machine, enforced where it cannot be argued with.
--
--   pending ─────────> requires_action ──> paid
--      │                     │              │
--      ├──> authorized ──────┼──> paid      └──> refunded
--      ├──> paid             ├──> failed
--      ├──> failed           └──> cancelled
--      └──> cancelled
--
-- `failed` and `cancelled` are terminal: a retry is a new payment, so the
-- history says how many times somebody tried. `refunded` is terminal too --
-- partial refunds would need a second row and a decision nobody has made.
-- ---------------------------------------------------------------------------

create or replace function public.payment_transition_is_allowed(
  p_from public.payment_status,
  p_to public.payment_status
)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fn$
  select case p_from
    when 'pending' then p_to in ('requires_action', 'authorized', 'paid', 'failed', 'cancelled')
    when 'requires_action' then p_to in ('authorized', 'paid', 'failed', 'cancelled')
    when 'authorized' then p_to in ('paid', 'failed', 'cancelled')
    when 'paid' then p_to = 'refunded'
    else false
  end;
$fn$;

create or replace function public.payments_guard_and_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.payment_events (
      payment_id, business_id, event_type, new_status, provider, provider_reference,
      amount, idempotency_key
    )
    values (
      new.id, new.business_id, 'created', new.status, new.provider, new.provider_reference,
      new.amount, new.idempotency_key
    );
    return null;
  end if;

  -- The guard below runs BEFORE this and has already refused anything that
  -- should not have happened. This only writes down what did.
  if new.status is distinct from old.status then
    insert into public.payment_events (
      payment_id, business_id, event_type, previous_status, new_status,
      provider, provider_reference, failure_code, amount, idempotency_key
    )
    values (
      new.id, new.business_id, 'status_changed', old.status, new.status,
      new.provider, new.provider_reference, new.failure_code,
      case when new.status = 'refunded' then new.refunded_amount else new.amount end,
      new.idempotency_key
    );
  end if;

  return null;
end;
$fn$;

create trigger payments_guard_and_record
  after insert or update on public.payments
  for each row execute function public.payments_guard_and_record();

/**
 * The guard. Refuses an edit before it happens, rather than reporting it after.
 *
 * Two rules: what the money was for never changes, and a status only moves
 * where the state machine says it may. Both are here rather than in the
 * functions above, because a direct UPDATE that Row Level Security allowed
 * would otherwise invent financial history.
 */
create or replace function public.payments_reject_edits()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.appointment_id is distinct from old.appointment_id
     or new.business_id is distinct from old.business_id
     or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.requirement is distinct from old.requirement then
    raise exception 'PAYMENT_IS_IMMUTABLE' using errcode = '22023';
  end if;

  if new.status is distinct from old.status
     and not public.payment_transition_is_allowed(old.status, new.status) then
    raise exception 'PAYMENT_TRANSITION_NOT_ALLOWED' using errcode = '22023';
  end if;

  return new;
end;
$fn$;

create trigger payments_reject_edits
  before update on public.payments
  for each row execute function public.payments_reject_edits();

-- ---------------------------------------------------------------------------
-- Row level security.
--
-- A business reads its own payments and its own payment history. Nobody
-- writes: every row here is written by SECURITY DEFINER functions that no
-- client role may execute. An anonymous caller has no privilege at all -- a
-- guest sees their own payment through a token function, never through a
-- table.
-- ---------------------------------------------------------------------------

alter table public.payment_events enable row level security;

create policy payment_events_select_member on public.payment_events
  for select to authenticated
  using (public.is_business_member(business_id));

revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;

revoke all on public.payment_events from anon, authenticated;
grant select on public.payment_events to authenticated;

-- The payments SELECT policy from the first schema joins appointments; the
-- business id is on the row now, so it can be answered without the join.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (public.is_business_member(business_id));

-- ---------------------------------------------------------------------------
-- Creating a payment.
--
-- Called from inside the booking transaction. It makes a local row and
-- nothing else: no socket is opened, so no provider can fail a booking.
-- ---------------------------------------------------------------------------

create or replace function public.create_payment_for_appointment(
  p_appointment public.appointments,
  p_service public.services,
  p_provider text default 'mock'
)
returns public.payments
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_amount numeric(12, 2);
  v_payment public.payments;
begin
  v_amount := public.service_amount_due(p_service);

  if p_service.payment_requirement = 'none' or coalesce(v_amount, 0) <= 0 then
    return null;
  end if;

  insert into public.payments (
    appointment_id, business_id, provider, amount, currency, status, requirement
  )
  values (
    p_appointment.id,
    p_appointment.business_id,
    p_provider,
    v_amount,
    p_service.currency,
    'pending',
    p_service.payment_requirement
  )
  returning * into v_payment;

  return v_payment;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- The outcome.
--
-- This is where a provider's word becomes the product's state, and it is the
-- only place that does it. It is idempotent on `p_idempotency_key`: a callback
-- delivered twice, a browser retried, a worker that woke up again -- all leave
-- one result.
-- ---------------------------------------------------------------------------

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

  return v_payment;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Grant classification. All of this is INTERNAL ONLY: the public and
-- professional entry points arrive in the next migrations, and they are the
-- only doors.
-- ---------------------------------------------------------------------------

revoke all on function public.payment_simulation_enabled() from public, anon, authenticated;
revoke all on function public.payment_transition_is_allowed(public.payment_status, public.payment_status)
  from public, anon, authenticated;
revoke all on function public.payments_guard_and_record() from public, anon, authenticated;
revoke all on function public.payments_reject_edits() from public, anon, authenticated;
revoke all on function public.create_payment_for_appointment(public.appointments, public.services, text)
  from public, anon, authenticated;
revoke all on function public.apply_payment_outcome(uuid, public.payment_status, text, text, text)
  from public, anon, authenticated;
