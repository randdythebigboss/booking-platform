-- ===========================================================================
-- Phase 9 - what a service asks for before it is booked.
--
-- Three answers, and no more: nothing, a deposit, or the whole price. A
-- percentage deposit, a tax, a tip, a discount and a coupon are all things
-- somebody will eventually ask for and none of them are here, because each is
-- a decision about money that nobody has made yet.
--
-- Money, decided once and written down:
--
--   **The database is the authority, and it is exact `numeric`.** Not a float
--   anywhere, ever. All arithmetic about money -- what a deposit may be, what
--   remains after one is paid -- happens in SQL, on `numeric`, where it is
--   exact. TypeScript never adds, subtracts or compares an amount: it receives
--   a decimal, and formats it with `Intl.NumberFormat` and the currency, which
--   is also the only thing that knows how many fractional digits a currency
--   has. Nothing in this product hardcodes two.
--
-- The currency is not configurable per service: it is the business's, which
-- the service already carries. Two currencies inside one price list is a
-- decision, not a default.
-- ===========================================================================

create type public.payment_requirement as enum (
  'none',
  'deposit',
  'full'
);

alter table public.services
  add column payment_requirement public.payment_requirement not null default 'none',
  add column deposit_amount numeric(12, 2);

comment on column public.services.payment_requirement is
  'What a customer has to pay before this service is booked: nothing, a deposit, or the full price.';
comment on column public.services.deposit_amount is
  'The deposit, in the service currency. Set when and only when payment_requirement is deposit.';

-- A deposit exists exactly when it is asked for, is more than nothing, and is
-- not more than the thing being deposited against.
alter table public.services
  add constraint services_deposit_matches_requirement check (
    case payment_requirement
      when 'deposit' then deposit_amount is not null
                          and deposit_amount > 0
                          and deposit_amount <= price
      else deposit_amount is null
    end
  );

/**
 * What this service asks for right now, as an amount.
 *
 * One place, because "how much is due" is the question every screen, every
 * payment row and every message asks, and three answers to it would drift.
 */
create or replace function public.service_amount_due(p_service public.services)
returns numeric
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fn$
  select case p_service.payment_requirement
    when 'none' then 0::numeric
    when 'deposit' then p_service.deposit_amount
    when 'full' then p_service.price
  end;
$fn$;

revoke all on function public.service_amount_due(public.services)
  from public, anon, authenticated;
