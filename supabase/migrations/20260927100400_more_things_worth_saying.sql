-- ===========================================================================
-- Four more things the product has to be able to say.
--
-- `booking_created` is for the professional: a customer has booked, which is
-- news to the shop even when the booking is not confirmed yet. The customer's
-- own confirmation is a different message and already exists.
--
-- The three payment ones are for the customer. They are separate kinds rather
-- than a status on the booking messages, because "your payment was declined"
-- and "your booking moved" have nothing to do with each other.
--
-- Alone in a migration because PostgreSQL will not let a new enum value be
-- used in the transaction that adds it.
-- ===========================================================================

alter type public.notification_kind add value if not exists 'booking_created';
alter type public.notification_kind add value if not exists 'payment_received';
alter type public.notification_kind add value if not exists 'payment_failed';
alter type public.notification_kind add value if not exists 'payment_refunded';
