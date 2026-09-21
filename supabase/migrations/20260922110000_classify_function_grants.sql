-- ===========================================================================
-- Every function in `public` classified, and its grants made to match.
--
-- Supabase's default privileges grant EXECUTE on new functions to anon,
-- authenticated and service_role, so the safe default is the opposite of what
-- you get. This has now bitten twice (Phase 2 and Phase 3), so rather than
-- fixing one function at a time, every function is placed in exactly one of
-- three groups and the grants are asserted in
-- supabase/tests/function_grants.sql.
--
--   PUBLIC / ANON-SAFE          a stranger may call it
--   AUTHENTICATED PROFESSIONAL  a signed-in member may call it
--   INTERNAL ONLY               only other functions and triggers call it
--
-- A trigger function does not need the firing user to hold EXECUTE -- the
-- system invokes it -- but a function it calls does, which is why
-- appointments_enforce_transition is SECURITY DEFINER.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- INTERNAL ONLY: trigger bodies and helpers with no caller outside the schema.
-- ---------------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.assert_valid_timezone() from public, anon, authenticated;
revoke all on function public.appointments_set_blocked_range() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.time_to_clock(time) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- AUTHENTICATED PROFESSIONAL: these answer questions about the caller and are
-- read by policies that only `authenticated` is subject to. An anonymous
-- caller always got `false` from them, so nothing leaked -- but nothing needed
-- them either.
--
-- is_business_public and professional_business_id deliberately keep their anon
-- grant: the public catalogue policies call them, and a policy expression runs
-- with the querying role's privileges.
-- ---------------------------------------------------------------------------

revoke all on function public.is_business_member(uuid) from public, anon;
revoke all on function public.is_business_manager(uuid) from public, anon;
revoke all on function public.can_manage_professional(uuid) from public, anon;

grant execute on function public.is_business_member(uuid) to authenticated;
grant execute on function public.is_business_manager(uuid) to authenticated;
grant execute on function public.can_manage_professional(uuid) to authenticated;
