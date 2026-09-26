-- ===========================================================================
-- A week can be looked at whole.
--
-- ---------------------------------------------------------------------------
-- The problem this exists to solve
-- ---------------------------------------------------------------------------
--
-- The public booking page showed seven identical day chips. A customer tapped
-- one, was told "no hay horas disponibles ese día", and then had to guess
-- which of the other six might work -- one tap and one round trip at a time.
-- On a shop that is closed on Sunday and full on Monday that is three failures
-- before the first success, and the page never once said which day to try.
--
-- So the strip needs to know something about each day before it is tapped.
--
-- ---------------------------------------------------------------------------
-- Why this calls get_day_schedule instead of reimplementing it
-- ---------------------------------------------------------------------------
--
-- There is one availability engine and there will go on being one. Working
-- windows, exceptions, blocked periods, existing appointments, buffers,
-- minimum notice, the booking horizon and the business timezone are decided in
-- exactly one place, and a second implementation would drift from it on the
-- first change -- silently, and in the direction of offering a time that is
-- not free. This aggregates the answer the engine already gives.
--
-- It costs one call per day. Seven of those on one page is cheaper than the
-- seven separate round trips the customer was making by hand.
--
-- ---------------------------------------------------------------------------
-- What a stranger learns, exactly
-- ---------------------------------------------------------------------------
--
-- Per day: a date, one of five states, and how many slots are free.
--
-- Nothing else. No name, no service, no time of any booking, no count of
-- customers -- `free_count` counts what is OPEN, not what is taken.
--
-- Does a free count leak occupancy? Only what the day view already publishes:
-- `get_day_schedule` returns every slot with its state to the same anonymous
-- caller, so anybody who wanted this number could already add it up. This
-- returns strictly less than one day view, for seven days. It is the
-- aggregate-availability shape rather than the per-slot one, and that is the
-- deliberate choice: the strip needs "is it worth tapping Tuesday", not
-- "which hours on Tuesday are spoken for".
--
-- `full` and `closed` are told apart because a customer needs them told apart
-- -- "come back another day" and "we are shut on Sundays" lead to different
-- decisions -- and because the shop's opening days are not a secret. What is
-- never distinguished at slot level, for the public, remains
-- undistinguished: see get_day_schedule.
-- ===========================================================================

-- Wrapped so the whole file can be run twice without failing.
--
-- `create or replace function` is already idempotent; `create type` is not,
-- and this migration may reach a project through the SQL Editor rather than
-- through `supabase db push`. When it does, the ledger has no row for it and
-- a later push will replay it -- at which point a bare `create type` stops
-- the whole push on `42710 type already exists`. Catching that here means a
-- replay is a no-op instead of an incident.
do $$
begin
  create type public.day_availability as enum (
    'open',    -- at least one slot this service can actually take
    'full',    -- the day is worked, and nothing is left
    'closed',  -- not a working day at all, or wholly excepted
    'past',    -- before today where the business is
    'beyond'   -- past the booking horizon the business set
  );
exception
  when duplicate_object then null;
end;
$$;

create or replace function public.get_week_availability(
  p_professional_id uuid,
  p_service_id uuid,
  p_from date,
  p_days integer default 7
)
returns table (day date, state public.day_availability, free_count integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_professional public.professional_profiles;
  v_business public.businesses;
  v_today date;
  v_horizon date;
  v_day date;
  v_total integer;
  v_free integer;
begin
  -- A cap, so this cannot be turned into a cheap way to walk somebody's
  -- calendar a year at a time. Five weeks covers every strip the product draws.
  if p_days is null or p_days < 1 or p_days > 35 then
    raise exception 'INVALID_RANGE' using errcode = '22023';
  end if;

  -- The same silence as everywhere else on the public surface: a stranger
  -- learns "nothing here", never "that exists but is hidden".
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

  v_today := (now() at time zone v_business.timezone)::date;
  v_horizon := v_today + v_business.booking_horizon_days;

  for i in 0 .. (p_days - 1) loop
    v_day := p_from + i;

    if v_day < v_today then
      day := v_day; state := 'past'; free_count := 0;
      return next;
      continue;
    end if;

    if v_day > v_horizon then
      day := v_day; state := 'beyond'; free_count := 0;
      return next;
      continue;
    end if;

    select count(*), count(*) filter (where s.state = 'available')
      into v_total, v_free
    from public.get_day_schedule(p_professional_id, p_service_id, v_day) as s;

    day := v_day;
    free_count := coalesce(v_free, 0);
    -- No slots at all is a day the shop does not work. Slots but none free is
    -- a day that filled up. The customer does different things about each.
    state := case
               when coalesce(v_total, 0) = 0 then 'closed'
               when coalesce(v_free, 0) = 0 then 'full'
               else 'open'
             end;
    return next;
  end loop;
end;
$$;

comment on function public.get_week_availability(uuid, uuid, date, integer) is
  'Per-day availability for one service, for the public booking strip. Returns '
  'a date, a state and a count of FREE slots -- never anything about a booking.';

-- ---------------------------------------------------------------------------
-- Grants. Anon-safe, for the same reason get_day_schedule is: it answers a
-- question the public booking page has to ask before anybody has an account.
--
-- Supabase's default privileges hand EXECUTE to anon, authenticated and
-- service_role on every new function, so revoking from PUBLIC alone leaves
-- anon holding a grant of its own. supabase/tests/function_grants.sql is what
-- notices when that is forgotten.
-- ---------------------------------------------------------------------------

revoke all on function public.get_week_availability(uuid, uuid, date, integer) from public;
grant execute on function public.get_week_availability(uuid, uuid, date, integer)
  to anon, authenticated;
