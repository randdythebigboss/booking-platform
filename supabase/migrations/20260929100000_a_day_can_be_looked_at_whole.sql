-- ===========================================================================
-- Seeing the shape of a day, not just the gaps in it.
--
-- `get_available_slots` answers "what can I book?" and returns only the free
-- times. That is the right answer for booking and the wrong one for
-- understanding: a customer looking at four times in an eight-hour day cannot
-- tell whether the shop is quiet, nearly full, or closed after lunch.
--
-- This returns every slot the grid produces, each with a reason:
--
--   available     bookable right now
--   taken         somebody has it, or the professional blocked it out
--   unavailable   a timed exception -- a long lunch, a meeting
--   past          too soon, or already gone
--
-- ---------------------------------------------------------------------------
-- What it deliberately does not return
-- ---------------------------------------------------------------------------
--
-- Nothing about the appointment occupying a slot. Not the customer's name, not
-- their initials, not the service, not the appointment id, not a count. A
-- stranger learns that 10:30 is spoken for and nothing whatsoever about who
-- spoke for it -- which is the only privacy-safe way to show a busy calendar
-- to the public.
--
-- `taken` and `unavailable` are also deliberately distinct in the data and
-- deliberately *not* distinguished in the public UI: knowing which of the two
-- it is tells a persistent observer whether a booking exists. The distinction
-- exists for the professional's own preview screen.
-- ===========================================================================

create type public.slot_state as enum ('available', 'taken', 'unavailable', 'past');

create or replace function public.get_day_schedule(
  p_professional_id uuid,
  p_service_id uuid,
  p_date date
)
returns table (starts_at timestamptz, ends_at timestamptz, state public.slot_state)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_professional public.professional_profiles;
  v_business public.businesses;
  v_service public.services;
  v_today date;
  v_duration interval;
  v_before interval;
  v_after interval;
begin
  -- Every visibility check returns rather than raises, exactly as
  -- get_available_slots does: a stranger learns "nothing here", never "that
  -- exists but is hidden".
  select p.* into v_professional
  from public.professional_profiles p
  where p.id = p_professional_id and p.is_bookable;
  if not found then
    return;
  end if;

  select b.* into v_business
  from public.businesses b
  where b.id = v_professional.business_id and b.is_published and b.is_active;
  if not found then
    return;
  end if;

  select s.* into v_service
  from public.services s
  join public.professional_services ps
    on ps.service_id = s.id
   and ps.professional_id = p_professional_id
   and ps.is_active
  where s.id = p_service_id
    and s.is_active
    and s.business_id = v_business.id;
  if not found then
    return;
  end if;

  v_today := (now() at time zone v_business.timezone)::date;
  if p_date < v_today or p_date > v_today + v_business.booking_horizon_days then
    return;
  end if;

  v_duration := make_interval(mins => v_service.duration_minutes);
  v_before := make_interval(mins => v_service.buffer_before_minutes);
  v_after := make_interval(mins => v_service.buffer_after_minutes);

  return query
  with windows as (
    select w as win
    from public.working_windows(p_professional_id, v_business.timezone, p_date) as w
  ),
  closures as (
    select tstzrange(
             (p_date + e.start_time) at time zone v_business.timezone,
             (p_date + e.end_time) at time zone v_business.timezone,
             '[)'
           ) as r
    from public.availability_exceptions e
    where e.professional_id = p_professional_id
      and e.exception_date = p_date
      and e.exception_type = 'unavailable'
      and e.start_time is not null
  ),
  busy as (
    select a.blocked_range as r
    from public.appointments a
    where a.professional_id = p_professional_id
      and a.status in ('pending', 'confirmed')
      and (a.hold_expires_at is null or a.hold_expires_at > now())
    union all
    select b.blocked_range
    from public.blocked_times b
    where b.professional_id = p_professional_id
  ),
  candidates as (
    select
      w.win,
      lower(w.win) + make_interval(mins => (g * v_business.slot_interval_minutes)) as s
    from windows w
    cross join lateral generate_series(
      0,
      greatest(
        0,
        (extract(epoch from (upper(w.win) - lower(w.win)))::bigint
          / greatest(1, v_business.slot_interval_minutes * 60))::int
      )
    ) as g
  ),
  graded as (
    select distinct
      c.s,
      c.s + v_duration as e,
      case
        -- Order matters. A slot that has gone is past, whatever else is true
        -- of it -- saying "taken" about yesterday would be noise.
        when c.s < now() + make_interval(mins => v_business.minimum_notice_minutes)
          then 'past'::public.slot_state
        when exists (
          select 1 from busy bu
          where bu.r && tstzrange(c.s - v_before, c.s + v_duration + v_after, '[)')
        ) then 'taken'::public.slot_state
        when exists (
          select 1 from closures cl
          where cl.r && tstzrange(c.s, c.s + v_duration, '[)')
        ) then 'unavailable'::public.slot_state
        else 'available'::public.slot_state
      end as st
    from candidates c
    where c.s + v_duration <= upper(c.win)
  )
  select g.s, g.e, g.st from graded g order by 1;
end;
$$;

comment on function public.get_day_schedule(uuid, uuid, date) is
  'Every slot in a day with why it can or cannot be booked. Never reveals '
  'anything about the appointment occupying a taken slot.';

revoke all on function public.get_day_schedule(uuid, uuid, date) from public;
grant execute on function public.get_day_schedule(uuid, uuid, date) to anon, authenticated;
