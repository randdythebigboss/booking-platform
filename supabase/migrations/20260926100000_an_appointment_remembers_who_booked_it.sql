-- ===========================================================================
-- An appointment remembers the person who booked it.
--
-- `customers` is a reusable record, on purpose: one person, one row per
-- business, found again by phone number (ADR 0018). That reuse has a cost
-- nobody had paid yet. The row is rewritten on every later booking -- the name
-- given most recently wins -- and every past appointment reads through to it.
-- So correcting a spelling, or one person booking under a nickname, silently
-- rewrote the customer's name on appointments that happened months earlier.
--
-- Observed in the real development project: a guest booked as
-- "Lucía Fernández", booked again as "Lucia Fernandez", and the first
-- appointment changed its mind about who had been there.
--
-- The service on an appointment was already snapshotted, for exactly this
-- reason -- editing a price does not rewrite what a past appointment cost.
-- The customer is now treated the same way. `customer_id` still points at the
-- reusable record, which is what makes "the same person" work; the three
-- facts a human reads -- and that a notification is addressed with -- are
-- frozen at the moment of booking.
--
-- Filled by a trigger rather than by the booking functions, so no path can
-- forget: both booking RPCs write the customer row first and insert the
-- appointment after, so the row already holds exactly what this booking said.
--
-- This is not a CRM. Nothing here tracks history of a customer, merges
-- records or reconciles duplicates. It only stops the past from changing.
-- ===========================================================================

alter table public.appointments
  add column customer_name_snapshot text,
  add column customer_phone_snapshot text,
  add column customer_email_snapshot text;

-- Existing rows: the current customer record is the best truth available, and
-- it is what those appointments already displayed a moment ago.
update public.appointments a
   set customer_name_snapshot = c.full_name,
       customer_phone_snapshot = c.phone,
       customer_email_snapshot = c.email
  from public.customers c
 where c.id = a.customer_id;

alter table public.appointments
  alter column customer_name_snapshot set not null,
  alter column customer_phone_snapshot set not null;

comment on column public.appointments.customer_name_snapshot is
  'The customer name as given when this appointment was booked. Frozen: later edits to the reusable customers row do not rewrite it.';
comment on column public.appointments.customer_phone_snapshot is
  'The phone as given when this appointment was booked. Frozen.';
comment on column public.appointments.customer_email_snapshot is
  'The email as given when this appointment was booked, if any. Frozen.';

create or replace function public.appointments_snapshot_customer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_customer public.customers;
begin
  if tg_op = 'INSERT' then
    -- A caller may supply the snapshot explicitly; otherwise it comes from the
    -- customer record as it stands at this instant, which both booking paths
    -- have just written with what this booking said.
    if new.customer_name_snapshot is null
       or new.customer_phone_snapshot is null then
      select c.* into v_customer from public.customers c where c.id = new.customer_id;

      new.customer_name_snapshot :=
        coalesce(new.customer_name_snapshot, v_customer.full_name);
      new.customer_phone_snapshot :=
        coalesce(new.customer_phone_snapshot, v_customer.phone);
      new.customer_email_snapshot :=
        coalesce(new.customer_email_snapshot, v_customer.email);
    end if;

    return new;
  end if;

  -- An update may not rewrite the past. Raising rather than silently restoring
  -- the old value: a write that tried to change this is a bug, and a bug that
  -- says nothing is the kind this column exists to prevent.
  if new.customer_name_snapshot is distinct from old.customer_name_snapshot
     or new.customer_phone_snapshot is distinct from old.customer_phone_snapshot
     or new.customer_email_snapshot is distinct from old.customer_email_snapshot then
    raise exception 'APPOINTMENT_IDENTITY_IS_IMMUTABLE' using errcode = '22023';
  end if;

  return new;
end;
$fn$;

-- Before the row is written, and before the event trigger reads it.
create trigger appointments_snapshot_customer
  before insert or update on public.appointments
  for each row execute function public.appointments_snapshot_customer();

revoke all on function public.appointments_snapshot_customer()
  from public, anon, authenticated;
