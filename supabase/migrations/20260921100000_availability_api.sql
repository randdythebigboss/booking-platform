-- ===========================================================================
-- Phase 2 - the authoritative availability API.
--
-- book_appointment already decides what may be ACCEPTED. This decides what is
-- OFFERED, from the same rules and the same helpers, so the two cannot drift.
--
-- It is written for an anonymous caller from the start: a hidden resource
-- produces an empty result, never an error that would confirm the resource
-- exists. See docs/DECISIONS/0012.
-- ===========================================================================

create or replace function public.get_available_slots(
  p_professional_id uuid,
  p_service_id uuid,
  p_date date
)
returns table (starts_at timestamptz, ends_at timestamptz)
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
  -- Every visibility check below returns rather than raising. A stranger
  -- learns "nothing is available", not "that id exists but is hidden".
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

  -- The horizon and the past are business-local questions.
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
    -- Timed "unavailable" exceptions carve holes in the day without moving
    -- the grid: the shift start still anchors it.
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
  )
  select distinct c.s, c.s + v_duration
  from candidates c
  where c.s + v_duration <= upper(c.win)
    and c.s >= now() + make_interval(mins => v_business.minimum_notice_minutes)
    and not exists (
      select 1 from closures cl
      where cl.r && tstzrange(c.s, c.s + v_duration, '[)')
    )
    and not exists (
      select 1 from busy bu
      where bu.r && tstzrange(c.s - v_before, c.s + v_duration + v_after, '[)')
    )
  order by 1;
end;
$$;

revoke all on function public.get_available_slots(uuid, uuid, date) from public;
grant execute on function public.get_available_slots(uuid, uuid, date) to anon, authenticated;

-- ===========================================================================
-- Blocking time must never quietly invalidate a customer's appointment.
--
-- A professional who blocks over an existing booking is almost always making
-- a mistake; the safe answer is to refuse and let them cancel the appointment
-- deliberately if that is what they meant. Enforced by a trigger so it holds
-- for the API, the UI and a direct INSERT alike.
-- ===========================================================================

create or replace function public.blocked_times_reject_appointment_conflict()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
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
$$;

create trigger blocked_times_no_appointment_conflict
  before insert or update of professional_id, starts_at, ends_at
  on public.blocked_times
  for each row execute function public.blocked_times_reject_appointment_conflict();

-- ===========================================================================
-- A full-day block is expressed as an availability exception, not as a
-- blocked_times row spanning midnight to midnight: "I am closed that day" is
-- a schedule statement, while blocked_times is for a period within a day.
-- Keeping them distinct is what lets the calendar explain itself later.
-- ===========================================================================

comment on table public.blocked_times is
  'Ad-hoc unavailable periods inside a day. For a whole day off, use an untimed availability_exceptions row instead.';

comment on table public.availability_exceptions is
  'Date-specific changes to the weekly schedule: an untimed unavailable row closes the day, a timed unavailable row carves a hole, and available rows replace that date''s hours entirely.';

comment on table public.availability_rules is
  'The recurring weekly schedule. Date-specific changes belong in availability_exceptions.';
