-- ===========================================================================
-- `requires_action`: the provider has the payment and the customer is not
-- finished with it -- a 3-D Secure challenge, a bank app, a redirect that has
-- not come back. It is not `pending` (nobody has tried) and it is not
-- `authorized` (the money is reserved).
--
-- Alone in its own migration because PostgreSQL will not let a new enum value
-- be *used* in the transaction that adds it, and everything that uses it
-- arrives in the next one.
-- ===========================================================================

alter type public.payment_status add value if not exists 'requires_action' after 'pending';
