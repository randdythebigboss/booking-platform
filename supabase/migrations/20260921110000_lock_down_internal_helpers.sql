-- ===========================================================================
-- Close a real leak: the internal scheduling helpers were callable by anon.
--
-- Earlier migrations wrote `revoke all on function ... from public`, which is
-- what you do on stock PostgreSQL. It is not enough on Supabase: the platform
-- sets default privileges that GRANT execute on new functions directly to
-- anon, authenticated and service_role. Revoking from PUBLIC leaves those
-- explicit role grants untouched.
--
-- The consequence was that a stranger could call working_windows() and read
-- the exact shifts of any professional -- including one inside a business that
-- was never published -- and use is_slot_within_availability() as a yes/no
-- oracle to map a private calendar one timestamp at a time. That is precisely
-- what get_available_slots exists to prevent.
--
-- These three are only ever called from inside SECURITY DEFINER functions,
-- which execute as the owner, so removing the role grants costs nothing.
-- ===========================================================================

revoke all on function public.working_windows(uuid, text, date)
  from public, anon, authenticated;

revoke all on function public.is_slot_within_availability(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated;

revoke all on function public.is_slot_aligned(uuid, text, timestamptz, timestamptz, integer)
  from public, anon, authenticated;

-- A trigger function cannot be invoked directly, but there is no reason for it
-- to carry an execute grant either.
revoke all on function public.blocked_times_reject_appointment_conflict()
  from public, anon, authenticated;

-- The membership helpers stay executable on purpose: RLS policies call them,
-- and a policy expression is evaluated with the querying role's privileges, so
-- revoking would break the very isolation they enforce. They only ever answer
-- questions about the caller, never about someone else's calendar.
