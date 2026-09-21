-- ===========================================================================
-- Phase 4 - the appointment lifecycle, enforced where it cannot be bypassed.
--
-- The status column could always hold any of its five values, and nothing
-- stopped a cancelled appointment being quietly re-confirmed or a future one
-- being marked "completed". A row being technically updatable is not the same
-- as a transition making sense.
--
--   pending   -> confirmed | cancelled
--   confirmed -> completed | no_show | cancelled
--   completed, cancelled, no_show are terminal
--
-- Two rules beyond the graph:
--
--   * completed and no_show require the appointment to have started. You
--     cannot have finished something that has not begun, and allowing it would
--     release a future slot from the exclusion constraint -- which only covers
--     pending and confirmed -- while the customer still believes they are
--     booked.
--
--   * cancelled is terminal precisely because cancelling frees the time. If
--     un-cancelling were allowed, the slot may already belong to someone else,
--     and the appointment would have to lose a race it never entered.
--
-- Undoing a mis-tapped completed or no_show is a real need and deliberately
-- not solved here; see docs/DECISIONS/0014.
-- ===========================================================================

create or replace function public.appointment_transition_allowed(
  p_from public.appointment_status,
  p_to public.appointment_status
)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case p_from
    when 'pending' then p_to in ('confirmed', 'cancelled')
    when 'confirmed' then p_to in ('completed', 'no_show', 'cancelled')
    else false
  end;
$$;

create or replace function public.appointments_enforce_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not public.appointment_transition_allowed(old.status, new.status) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22023';
  end if;

  if new.status in ('completed', 'no_show') and new.starts_at > now() then
    raise exception 'APPOINTMENT_HAS_NOT_STARTED' using errcode = '22023';
  end if;

  if new.status = 'cancelled' and new.cancelled_at is null then
    new.cancelled_at := now();
  end if;

  return new;
end;
$$;

create trigger appointments_valid_transition
  before update of status on public.appointments
  for each row execute function public.appointments_enforce_transition();

-- ---------------------------------------------------------------------------
-- The professional's way to move an appointment through its lifecycle.
--
-- SECURITY INVOKER: Row Level Security still decides whose appointments these
-- are. The function exists so that a status change cannot become a way to
-- rewrite times, customers or prices -- it touches nothing else.
-- ---------------------------------------------------------------------------

create or replace function public.set_appointment_status(
  p_appointment_id uuid,
  p_status public.appointment_status,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments;
begin
  select a.* into v_appointment
  from public.appointments a
  where a.id = p_appointment_id
  for update;

  -- Invisible under RLS and genuinely absent look the same on purpose.
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  update public.appointments
  set status = p_status,
      cancellation_reason = case
        when p_status = 'cancelled' then nullif(btrim(coalesce(p_reason, '')), '')
        else cancellation_reason
      end
  where id = p_appointment_id
  returning * into v_appointment;

  return jsonb_build_object(
    'appointmentId', v_appointment.id,
    'status', v_appointment.status,
    'cancelledAt', v_appointment.cancelled_at
  );
end;
$$;

revoke all on function public.appointment_transition_allowed(public.appointment_status, public.appointment_status)
  from public, anon, authenticated;
revoke all on function public.appointments_enforce_transition() from public, anon, authenticated;
revoke all on function public.set_appointment_status(uuid, public.appointment_status, text)
  from public, anon;

grant execute on function public.set_appointment_status(uuid, public.appointment_status, text)
  to authenticated;
