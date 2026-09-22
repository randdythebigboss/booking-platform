-- ===========================================================================
-- Phase 6 - the same person, typed two ways, is one customer.
--
-- Customers are matched on phone within a business, which is right, but the
-- comparison was on the raw string. "+1 809 555 0199" and "+1809555-0199" are
-- the same number and were two rows, each accumulating half of somebody's
-- history.
--
-- The normalisation is deliberately timid: strip everything that is not a
-- digit, and keep a leading "+" if there was one. That merges values which
-- differ only by punctuation, and nothing else.
--
-- It does NOT strip or infer a country code. "8095550199" and "+18095550199"
-- stay different people here, because deciding they are the same means
-- guessing a country from a phone number, and guessing wrong merges two
-- strangers' appointments. Under-merging leaves a duplicate row; over-merging
-- shows one customer another customer's bookings. Only one of those is
-- recoverable.
--
-- Nothing is rewritten and no constraint is replaced. The existing unique on
-- (business_id, phone) stays exactly as it is, so this migration cannot
-- collide with data that is already there. The generated column is an
-- additional way to FIND a customer, not a new rule about which may exist.
--
-- See docs/DECISIONS/0017.
-- ===========================================================================

alter table public.customers
  add column phone_normalized text
    generated always as (
      case
        when btrim(phone) like '+%' then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
        else regexp_replace(phone, '[^0-9]', '', 'g')
      end
    ) stored;

comment on column public.customers.phone_normalized is
  'The phone with punctuation removed, for matching a returning customer who typed it differently. Never used to merge across businesses, and never infers a country code.';

-- Deliberately not unique: two rows may legitimately normalise the same if
-- they were created before this existed, and a unique index would refuse to
-- be created at all rather than letting the product keep working.
create index customers_phone_normalized_idx
  on public.customers (business_id, phone_normalized);

-- ---------------------------------------------------------------------------
-- Finding the customer a booking belongs to.
--
-- Exact match first, so behaviour is unchanged for anyone already in the book.
-- Only then the punctuation-insensitive match, oldest first so that repeated
-- bookings keep landing on the same row rather than alternating between two.
-- ---------------------------------------------------------------------------

create or replace function public.find_customer_by_phone(
  p_business_id uuid,
  p_phone text
)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select c.id
  from public.customers c
  where c.business_id = p_business_id
    and (
      c.phone = btrim(p_phone)
      or c.phone_normalized = case
           when btrim(p_phone) like '+%' then '+' || regexp_replace(p_phone, '[^0-9]', '', 'g')
           else regexp_replace(p_phone, '[^0-9]', '', 'g')
         end
    )
  order by (c.phone = btrim(p_phone)) desc, c.created_at
  limit 1;
$fn$;

revoke all on function public.find_customer_by_phone(uuid, text) from public, anon, authenticated;
