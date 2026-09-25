-- ===========================================================================
-- The Phase 12 functions, placed in the three groups.
--
-- Supabase's default privileges grant EXECUTE on every new function to anon,
-- authenticated and service_role, so `revoke all ... from public` in the
-- migration that creates a function is not enough -- anon holds a grant of its
-- own, not one inherited through PUBLIC. supabase/tests/function_grants.sql
-- catches it every time, which is the whole reason it exists.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- INTERNAL ONLY: a trigger body. The system invokes it; nobody calls it.
-- ---------------------------------------------------------------------------

revoke all on function public.appointment_messages_business_matches()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- AUTHENTICATED: these are questions about `auth.uid()`, and an anonymous
-- caller has no answer to give. `claim_appointment` raises for anon anyway,
-- and `my_appointments` would return nothing -- but a function that cannot do
-- anything useful for a role should not be callable by it.
-- ---------------------------------------------------------------------------

revoke all on function public.claim_appointment(uuid, uuid) from public, anon;
grant execute on function public.claim_appointment(uuid, uuid) to authenticated;

revoke all on function public.my_appointments() from public, anon;
grant execute on function public.my_appointments() to authenticated;

-- ---------------------------------------------------------------------------
-- ANON-SAFE: the public booking page and the guest's own thread.
--
-- The three message functions take the booking credential and check it before
-- doing anything. That credential is the guest's only identity, so requiring
-- an account here would mean a guest could never read a message their
-- professional sent them -- which is the one thing this feature is for.
--
-- `get_day_schedule` returns times and one of four states. It is careful not
-- to return anything about the appointment behind a busy slot; see the
-- migration that creates it.
-- ---------------------------------------------------------------------------

revoke all on function public.get_day_schedule(uuid, uuid, date) from public;
grant execute on function public.get_day_schedule(uuid, uuid, date) to anon, authenticated;

revoke all on function public.get_appointment_messages_by_token(uuid, uuid) from public;
grant execute on function public.get_appointment_messages_by_token(uuid, uuid)
  to anon, authenticated;

revoke all on function public.send_appointment_message_by_token(uuid, uuid, text) from public;
grant execute on function public.send_appointment_message_by_token(uuid, uuid, text)
  to anon, authenticated;

revoke all on function public.mark_messages_read_by_token(uuid, uuid) from public;
grant execute on function public.mark_messages_read_by_token(uuid, uuid)
  to anon, authenticated;
