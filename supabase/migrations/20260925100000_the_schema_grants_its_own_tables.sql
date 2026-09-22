-- ===========================================================================
-- The repository grants its own tables, instead of inheriting them.
--
-- Found on the first deployment to real Supabase. Every table read in this
-- product is `GRANT`ed to `anon` and `authenticated` and then filtered by Row
-- Level Security -- that is Supabase's model and the one every policy here is
-- written for. But the grant itself was never in the repository. It came from
-- the default privileges Supabase configures on the `public` schema when a
-- project is created, which means the schema was only half described by its
-- own migrations.
--
-- Two ways that bites, and the second is the one that matters:
--
--   * Recreating the schema drops the default privileges with it. Every table
--     then exists, with correct RLS and correct policies, and the application
--     answers `42501 permission denied` for all of them.
--
--   * Supabase's own project-creation screen offers "Automatically expose new
--     tables" and says, in as many words, "We recommend disabling this to
--     control access manually." A future staging or production project
--     created on that recommendation would deploy this schema and be entirely
--     broken, in a way whose error message points at the wrong thing.
--
-- So the grants are stated here. This is idempotent and changes nothing where
-- the defaults are already in place -- local, CI, and this project as it was
-- first created all had them.
--
-- **Tables and sequences only. Never functions.** Supabase's default
-- privileges also grant EXECUTE on new functions to anon and authenticated,
-- which is the trap this project has been bitten by twice and which
-- 20260922110000_classify_function_grants.sql exists to close. Re-granting
-- functions here would silently undo it -- this migration runs after that one.
-- supabase/tests/function_grants.sql asserts the classification still holds.
-- ===========================================================================

grant usage on schema public to anon, authenticated, service_role;

-- RLS is what decides who sees which row. The grant only decides who may ask.
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
