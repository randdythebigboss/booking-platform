-- ===========================================================================
-- The professional-only write RPCs must not be callable anonymously.
--
-- create_business, save_service and set_weekly_schedule were granted to
-- `authenticated` by name, and Supabase's default privileges quietly granted
-- them to `anon` as well -- the same trap as
-- 20260921110000_lock_down_internal_helpers.sql.
--
-- Nothing was exploitable: create_business raises NOT_AUTHENTICATED when
-- auth.uid() is null, save_service is stopped by RLS on the insert, and
-- set_weekly_schedule checks can_manage_professional first. This is defence in
-- depth -- an anonymous caller has no business reaching a professional write
-- path at all, and "it fails anyway" is a weaker guarantee than "it cannot be
-- called".
--
-- The read helpers keep their anon grant on purpose: is_business_public and
-- professional_business_id are evaluated inside the public catalogue policies,
-- and a policy expression runs with the querying role's privileges, so
-- revoking them would break anonymous browsing entirely.
-- ===========================================================================

revoke all on function public.create_business(text, text, text, text)
  from public, anon;

revoke all on function public.save_service(uuid, text, integer, numeric, uuid, text, integer, integer, boolean)
  from public, anon;

revoke all on function public.set_weekly_schedule(uuid, jsonb)
  from public, anon;

-- Re-assert the grant these three actually need, since the revoke above also
-- strips PUBLIC.
grant execute on function public.create_business(text, text, text, text) to authenticated;
grant execute on function public.save_service(uuid, text, integer, numeric, uuid, text, integer, integer, boolean) to authenticated;
grant execute on function public.set_weekly_schedule(uuid, jsonb) to authenticated;
