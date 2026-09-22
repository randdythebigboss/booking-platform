-- ===========================================================================
-- A block and a move must not decide about each other at the same time.
--
-- Found in the Phase 5 hardening pass, by reasoning about what the advisory
-- lock actually covers.
--
-- Every write that places an appointment -- book_appointment,
-- create_manual_appointment, reschedule_appointment and its guest twin --
-- takes pg_advisory_xact_lock on the professional before it checks for a
-- conflicting block. Creating a block did not. So two concurrent
-- transactions could each look at a world where the other had not happened:
--
--   T1  reschedule to 15:00   sees no block covering 15:00   -> moves
--   T2  block 15:00-16:00     sees no appointment at 15:00   -> blocks
--
-- Both commit, and the professional ends up blocked over a live appointment
-- -- the exact state the trigger exists to prevent. Neither of them is wrong
-- on its own; they are wrong together.
--
-- The fix is one line: the block trigger takes the same lock, so the two
-- serialise and the loser sees the winner's work. There is no deadlock risk,
-- because there is only ever this one lock and it is always taken first.
--
-- The exclusion constraint was never at risk here -- two appointments still
-- cannot overlap. This is only about blocks.
-- ===========================================================================

create or replace function public.blocked_times_reject_appointment_conflict()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  -- The same lock every appointment write takes, on the same key.
  perform pg_advisory_xact_lock(hashtextextended(new.professional_id::text, 0));

  if exists (
    select 1
    from public.appointments a
    where a.professional_id = new.professional_id
      and a.status in ('pending', 'confirmed')
      and a.blocked_range && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'BLOCK_CONFLICTS_WITH_APPOINTMENT' using errcode = '23P01';
  end if;

  return new;
end;
$fn$;

revoke all on function public.blocked_times_reject_appointment_conflict()
  from public, anon, authenticated;
