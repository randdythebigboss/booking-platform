-- ===========================================================================
-- Phase 6 - a professional's language follows them, not their device.
--
-- Anonymous guests keep their choice in device storage, which is the right
-- place for it: there is nobody to attach it to. A signed-in professional has
-- an identity, so their choice belongs on it -- otherwise signing in on a
-- second device silently reverts them to Spanish.
--
-- This needs no new policy. `profiles` already has select and update policies
-- scoped to `id = auth.uid()`, so a user can read and write exactly their own
-- row and nobody else's, and adding a column inherits that.
--
-- The check is a shape, not a list of the two languages that exist today. A
-- column constrained to ('es','en') would make adding Portuguese a migration;
-- constrained to "looks like a language tag" it is a client-only change, and
-- an unrecognised value is harmless because the client falls back to Spanish
-- rather than trusting what it reads.
-- ===========================================================================

alter table public.profiles
  add column preferred_locale text
    check (preferred_locale is null or preferred_locale ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})?$');

comment on column public.profiles.preferred_locale is
  'BCP 47 language tag the user chose for the interface. Null means "not chosen": resolve from the device instead. Never used to translate business content.';
