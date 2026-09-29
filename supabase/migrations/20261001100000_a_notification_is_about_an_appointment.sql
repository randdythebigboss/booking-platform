-- ===========================================================================
-- A notification is about an appointment, not about an email.
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
--
-- The notifications screen listed the outbox: which reminder was queued, which
-- one failed, how many attempts. That is a delivery monitor, and a useful one
-- when the dispatcher is running -- but it is not what a professional opens the
-- application to find out. They want to know that somebody booked Thursday at
-- three, that the Tuesday appointment moved, that a customer wrote something.
--
-- Those facts already exist and are already written down. `appointment_events`
-- has recorded every creation, status change and reschedule since Phase 8, by a
-- trigger, so it cannot be bypassed. `appointment_messages` has the
-- conversation. Nothing new needs to be captured; what was missing is a way to
-- read the two together, scoped to the person reading, with a read state.
--
-- ---------------------------------------------------------------------------
-- Why events are not copied into a notifications table
-- ---------------------------------------------------------------------------
--
-- A per-recipient copy of every event is a second source of truth that drifts
-- from the first one, silently, the moment a trigger changes. It also means an
-- event that happened before this migration would never be notified, which is
-- exactly the sort of gap somebody discovers by missing a booking.
--
-- So this reads the existing tables and stores only what they do not have: who
-- has read what. `notification_reads` is a marker table and nothing else.
--
-- ---------------------------------------------------------------------------
-- Why messages use their own read_at and not this table
-- ---------------------------------------------------------------------------
--
-- `appointment_messages.read_at` already exists and already means "the business
-- has read this". The customer's side of the thread depends on it. Adding a
-- second marker for the same fact would let the notification centre say "read"
-- while the conversation still says "unread", which is worse than either.
--
-- So marking a message notification read sets that column, and the two views
-- agree because there is only one fact.
--
-- ---------------------------------------------------------------------------
-- What a professional is NOT notified about
-- ---------------------------------------------------------------------------
--
-- Their own actions. Cancelling an appointment and then being told that an
-- appointment was cancelled is noise, and noise is what makes people stop
-- reading a list. `changed_by_user_id = auth.uid()` is dropped.
--
-- And no customer contact detail. The name is here because it is the only way
-- to know which booking is meant; the telephone number and the address are on
-- the appointment, for whoever opens it, and a list is not a second place to
-- copy them to.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The marker table
-- ---------------------------------------------------------------------------

create table if not exists public.notification_reads (
  user_id uuid not null references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,

  -- Only 'event' today. A text column rather than an enum because the next
  -- source to arrive should not need a type change and a deployment window.
  item_kind text not null check (item_kind in ('event')),
  item_id uuid not null,

  read_at timestamptz not null default now(),

  primary key (user_id, item_kind, item_id)
);

create index if not exists notification_reads_user_business_idx
  on public.notification_reads (user_id, business_id);

comment on table public.notification_reads is
  'Which professional has read which appointment event. Read state only -- the events themselves live in appointment_events and are never copied here.';

alter table public.notification_reads enable row level security;

-- A row is the reader''s own or it does not exist to them. The membership check
-- is what stops somebody marking rows against a business they left.
drop policy if exists notification_reads_select_own on public.notification_reads;
create policy notification_reads_select_own on public.notification_reads
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists notification_reads_insert_own on public.notification_reads;
create policy notification_reads_insert_own on public.notification_reads
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_business_member(business_id)
  );

drop policy if exists notification_reads_delete_own on public.notification_reads;
create policy notification_reads_delete_own on public.notification_reads
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- No update policy. A read marker is created or removed; there is nothing in
-- it to edit, and leaving the verb unavailable is cheaper than policing it.

-- ---------------------------------------------------------------------------
-- The list
-- ---------------------------------------------------------------------------

create or replace function public.list_professional_notifications(
  p_business_id uuid,
  p_limit integer default 50,
  p_since_days integer default 60
)
returns table (
  kind text,
  id uuid,
  appointment_id uuid,
  occurred_at timestamptz,
  event_type text,
  previous_status public.appointment_status,
  new_status public.appointment_status,
  previous_starts_at timestamptz,
  new_starts_at timestamptz,
  appointment_starts_at timestamptz,
  customer_name text,
  service_name text,
  preview text,
  is_read boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_since timestamptz;
begin
  -- Silence rather than refusal, as everywhere else on this schema: a stranger
  -- learns "nothing here", never "that exists but is not yours".
  if v_user is null or not public.is_business_member(p_business_id) then
    return;
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'INVALID_RANGE' using errcode = '22023';
  end if;
  if p_since_days is null or p_since_days < 1 or p_since_days > 365 then
    raise exception 'INVALID_RANGE' using errcode = '22023';
  end if;

  v_since := now() - make_interval(days => p_since_days);

  return query
  with events as (
    select
      'event'::text as kind,
      e.id,
      e.appointment_id,
      e.occurred_at,
      e.event_type::text as event_type,
      e.previous_status,
      e.new_status,
      e.previous_starts_at,
      e.new_starts_at,
      a.starts_at as appointment_starts_at,
      a.customer_name_snapshot as customer_name,
      (
        select i.service_name_snapshot
        from public.appointment_items i
        where i.appointment_id = a.id
        order by i.created_at
        limit 1
      ) as service_name,
      null::text as preview,
      (r.item_id is not null) as is_read
    from public.appointment_events e
    join public.appointments a on a.id = e.appointment_id
    left join public.notification_reads r
      on r.user_id = v_user and r.item_kind = 'event' and r.item_id = e.id
    where e.business_id = p_business_id
      and e.occurred_at >= v_since
      -- Not their own doing. See the header.
      and (e.changed_by_user_id is null or e.changed_by_user_id <> v_user)
  ),
  messages as (
    select
      'message'::text as kind,
      m.id,
      m.appointment_id,
      m.created_at as occurred_at,
      'message'::text as event_type,
      null::public.appointment_status as previous_status,
      null::public.appointment_status as new_status,
      null::timestamptz as previous_starts_at,
      null::timestamptz as new_starts_at,
      a.starts_at as appointment_starts_at,
      a.customer_name_snapshot as customer_name,
      (
        select i.service_name_snapshot
        from public.appointment_items i
        where i.appointment_id = a.id
        order by i.created_at
        limit 1
      ) as service_name,
      left(btrim(m.body), 140) as preview,
      (m.read_at is not null) as is_read
    from public.appointment_messages m
    join public.appointments a on a.id = m.appointment_id
    where m.business_id = p_business_id
      and m.created_at >= v_since
      -- The professional's own side of the conversation is not news to them.
      and m.author = 'customer'
  )
  select * from (
    select * from events
    union all
    select * from messages
  ) all_items
  order by all_items.occurred_at desc
  limit p_limit;
end;
$$;

comment on function public.list_professional_notifications(uuid, integer, integer) is
  'Appointment activity for one business, newest first: creations, status changes, reschedules and customer messages, with the caller''s own actions removed and a per-reader read flag. Carries no customer telephone number or address.';

-- ---------------------------------------------------------------------------
-- The badge
-- ---------------------------------------------------------------------------

create or replace function public.count_unread_notifications(p_business_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => 60);
  v_events integer;
  v_messages integer;
begin
  if v_user is null or not public.is_business_member(p_business_id) then
    return 0;
  end if;

  select count(*) into v_events
  from public.appointment_events e
  where e.business_id = p_business_id
    and e.occurred_at >= v_since
    and (e.changed_by_user_id is null or e.changed_by_user_id <> v_user)
    and not exists (
      select 1 from public.notification_reads r
      where r.user_id = v_user and r.item_kind = 'event' and r.item_id = e.id
    );

  select count(*) into v_messages
  from public.appointment_messages m
  where m.business_id = p_business_id
    and m.created_at >= v_since
    and m.author = 'customer'
    and m.read_at is null;

  return coalesce(v_events, 0) + coalesce(v_messages, 0);
end;
$$;

comment on function public.count_unread_notifications(uuid) is
  'How many notifications this professional has not read, for the badge. Same window and same exclusions as list_professional_notifications.';

-- ---------------------------------------------------------------------------
-- Marking one read
-- ---------------------------------------------------------------------------

create or replace function public.mark_notification_read(
  p_business_id uuid,
  p_kind text,
  p_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not public.is_business_member(p_business_id) then
    return false;
  end if;

  if p_kind = 'event' then
    -- The event must belong to the business the caller named, or a member of
    -- one business could mark rows against another by guessing an id.
    if not exists (
      select 1 from public.appointment_events e
      where e.id = p_id and e.business_id = p_business_id
    ) then
      return false;
    end if;

    insert into public.notification_reads (user_id, business_id, item_kind, item_id)
    values (v_user, p_business_id, 'event', p_id)
    on conflict (user_id, item_kind, item_id) do nothing;
    return true;
  end if;

  if p_kind = 'message' then
    -- One fact, one column: this is the same read state the conversation uses.
    update public.appointment_messages m
       set read_at = now()
     where m.id = p_id
       and m.business_id = p_business_id
       and m.author = 'customer'
       and m.read_at is null;
    return found;
  end if;

  raise exception 'UNKNOWN_KIND' using errcode = '22023';
end;
$$;

-- ---------------------------------------------------------------------------
-- Marking the lot read
-- ---------------------------------------------------------------------------

create or replace function public.mark_all_notifications_read(p_business_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => 60);
  v_events integer := 0;
  v_messages integer := 0;
begin
  if v_user is null or not public.is_business_member(p_business_id) then
    return 0;
  end if;

  insert into public.notification_reads (user_id, business_id, item_kind, item_id)
  select v_user, p_business_id, 'event', e.id
  from public.appointment_events e
  where e.business_id = p_business_id
    and e.occurred_at >= v_since
    and (e.changed_by_user_id is null or e.changed_by_user_id <> v_user)
  on conflict (user_id, item_kind, item_id) do nothing;
  get diagnostics v_events = row_count;

  update public.appointment_messages m
     set read_at = now()
   where m.business_id = p_business_id
     and m.created_at >= v_since
     and m.author = 'customer'
     and m.read_at is null;
  get diagnostics v_messages = row_count;

  return v_events + v_messages;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
--
-- Professional-only, every one of them. `anon` has no business here: a stranger
-- booking an appointment never reads a notification list, and Supabase's
-- default privileges would have handed it EXECUTE if this did not say
-- otherwise. See supabase/tests/function_grants.sql.
-- ---------------------------------------------------------------------------

revoke all on function public.list_professional_notifications(uuid, integer, integer) from public, anon;
revoke all on function public.count_unread_notifications(uuid) from public, anon;
revoke all on function public.mark_notification_read(uuid, text, uuid) from public, anon;
revoke all on function public.mark_all_notifications_read(uuid) from public, anon;

grant execute on function public.list_professional_notifications(uuid, integer, integer) to authenticated;
grant execute on function public.count_unread_notifications(uuid) to authenticated;
grant execute on function public.mark_notification_read(uuid, text, uuid) to authenticated;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;

-- ===========================================================================
-- One more field, for the calendar file.
--
-- An .ics event is identified by its UID and superseded by its SEQUENCE. The
-- UID has always been the appointment id, so re-importing never duplicates.
-- SEQUENCE was always zero, which means a calendar that already holds the
-- event is entitled to ignore the new one -- so a guest who rescheduled and
-- downloaded again could be left looking at the old time.
--
-- `updated_at` is the monotone number that already exists. The professional's
-- read has always carried it; the guest's read had no reason to until now.
-- Additive: every existing caller ignores a key it does not know about.
-- ===========================================================================

create or replace function public.get_appointment_by_token(
  p_appointment_id uuid,
  p_access_token uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'appointmentId', a.id,
    'professionalId', a.professional_id,
    'serviceId', (
      select i.service_id from public.appointment_items i
      where i.appointment_id = a.id
      order by i.created_at
      limit 1
    ),
    'status', a.status,
    'startsAt', a.starts_at,
    'endsAt', a.ends_at,
    'notes', a.notes,
    'timezone', b.timezone,
    'businessName', b.name,
    'businessSlug', b.slug,
    'businessPhone', b.phone,
    'businessAddress', b.address,
    'professionalName', p.display_name,
    'customerName', a.customer_name_snapshot,
    -- New. See above.
    'updatedAt', a.updated_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.service_name_snapshot,
        'durationMinutes', i.duration_minutes_snapshot,
        'price', i.price_snapshot,
        'currency', i.currency_snapshot
      ))
      from public.appointment_items i
      where i.appointment_id = a.id
    ), '[]'::jsonb),
    'canCancel', a.status in ('pending', 'confirmed') and a.starts_at > now(),
    'canReschedule', a.status in ('pending', 'confirmed') and a.starts_at > now()
  )
  into v_result
  from public.appointments a
  join public.businesses b on b.id = a.business_id
  join public.professional_profiles p on p.id = a.professional_id
  where a.id = p_appointment_id
    and a.access_token = p_access_token;

  if v_result is null then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  return v_result;
end;
$fn$;

revoke all on function public.get_appointment_by_token(uuid, uuid) from public;
grant execute on function public.get_appointment_by_token(uuid, uuid) to anon, authenticated;
