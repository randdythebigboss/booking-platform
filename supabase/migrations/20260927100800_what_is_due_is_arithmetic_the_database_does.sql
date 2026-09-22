-- ===========================================================================
-- What is due now, and what is left, computed where money is exact.
--
-- The public booking page has to show a customer three numbers before they
-- commit: the price, what they pay now, and what is still to pay at the
-- counter. The third is a subtraction, and a subtraction in JavaScript is a
-- subtraction in binary floating point.
--
-- It is not that `2500 - 1000` would go wrong. It is that once one amount is
-- added up in a browser, the next one will be, and the one after that will be
-- a total. So the rule is absolute -- money arithmetic happens in SQL, on
-- `numeric` -- and these two columns are how the page gets its numbers without
-- doing any.
--
-- Generated and stored, so they cannot drift from the price and the deposit
-- they are derived from: change either and PostgreSQL recomputes both.
-- ===========================================================================

alter table public.services
  add column amount_due_now numeric(12, 2)
    generated always as (
      case payment_requirement
        when 'none' then 0
        when 'deposit' then deposit_amount
        when 'full' then price
      end
    ) stored,
  add column amount_due_later numeric(12, 2)
    generated always as (
      price - case payment_requirement
        when 'none' then 0
        when 'deposit' then coalesce(deposit_amount, 0)
        when 'full' then price
      end
    ) stored;

comment on column public.services.amount_due_now is
  'What a customer pays to book this service. Generated from the price and the deposit; never written directly.';
comment on column public.services.amount_due_later is
  'What is still to pay afterwards. Generated, so it cannot disagree with the two numbers it comes from.';
