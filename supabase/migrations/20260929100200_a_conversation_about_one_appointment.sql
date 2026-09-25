-- ===========================================================================
-- Messages, attached to one appointment.
--
-- The problem this solves is small and real: a professional needs to tell a
-- customer "I have to move Thursday", and today the product's answer is to
-- queue an email that nothing sends. A thread on the appointment is the
-- smallest thing that makes that conversation possible without a provider,
-- an account, or a phone number that works.
--
-- It is deliberately not a chat platform. No presence, no typing indicators,
-- no attachments, no threading, no reactions, no direct messages between
-- people who do not share an appointment. One appointment, one conversation,
-- two sides.
--
-- ---------------------------------------------------------------------------
-- Who may read and write one
-- ---------------------------------------------------------------------------
--
-- Three kinds of person, and the product already knows how to recognise all
-- three:
--
--   a member of the business                 -> auth.uid() and is_business_member
--   a customer with an account               -> auth.uid() and customers.auth_user_id
--   a guest holding their booking link       -> the access token, via RPC
--
-- The first two are expressed as Row Level Security, because they are
-- questions about `auth.uid()` and RLS is what answers those. The third
-- cannot be: a guest is `anon` and has no identity to check, so it goes
-- through SECURITY DEFINER functions that take the token and check it -- the
-- same shape as `get_appointment_by_token`, for the same reason.
--
-- `anon` gets no table privilege at all. A guest never touches the table
-- directly; the RPC does it for them, after proving they hold the credential.
-- ===========================================================================

create type public.message_author as enum ('professional', 'customer');

create table public.appointment_messages (
  id uuid primary key default gen_random_uuid(),

  -- Both, denormalised on purpose. `appointment_id` is what the thread is
  -- about; `business_id` is what every tenant check keys on, and reaching it
  -- through a join in an RLS policy on every row read is how policies get
  -- slow and, worse, how they get subtly wrong.
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,

  author public.message_author not null,

  -- Null for a guest, who by definition has no account. Present for a member
  -- and for a signed-in customer, so "who typed this" survives.
  author_user_id uuid references auth.users (id) on delete set null,

  -- What the customer was called when this was written. An appointment already
  -- freezes its customer's identity (ADR 0021) for the same reason: editing a
  -- customer record later must not rewrite what a conversation looked like.
  author_name text not null,

  body text not null,

  -- Read by the *other* side. One timestamp is enough for two participants
  -- and stays correct if one of them is a guest with no identity to key on.
  read_at timestamptz,

  created_at timestamptz not null default now(),

  constraint appointment_messages_body_not_empty
    check (length(btrim(body)) between 1 and 2000),
  constraint appointment_messages_author_name_not_empty
    check (length(btrim(author_name)) between 1 and 200)
);

-- The only query this table serves: one thread, oldest first.
create index appointment_messages_thread_idx
  on public.appointment_messages (appointment_id, created_at);

-- And the badge: how many unread, for one business.
create index appointment_messages_unread_idx
  on public.appointment_messages (business_id, author)
  where read_at is null;

-- The denormalised business_id must agree with the appointment it claims to
-- belong to, or every tenant check above it is worthless.
create or replace function public.appointment_messages_business_matches()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
begin
  select a.business_id into v_business_id
  from public.appointments a
  where a.id = new.appointment_id;

  if v_business_id is null then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = '23503';
  end if;

  if new.business_id is distinct from v_business_id then
    raise exception 'MESSAGE_BUSINESS_MISMATCH' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger appointment_messages_business_matches
  before insert or update on public.appointment_messages
  for each row execute function public.appointment_messages_business_matches();

alter table public.appointment_messages enable row level security;

-- ---------------------------------------------------------------------------
-- Row Level Security: the two people who have an identity
-- ---------------------------------------------------------------------------

create policy appointment_messages_select_member on public.appointment_messages
  for select to authenticated
  using (public.is_business_member(business_id));

create policy appointment_messages_insert_member on public.appointment_messages
  for insert to authenticated
  with check (public.is_business_member(business_id) and author = 'professional');

-- Marking read is the only update anyone makes. The body is not editable by
-- anybody: a conversation somebody can rewrite is not a record of anything.
create policy appointment_messages_update_member on public.appointment_messages
  for update to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

create policy appointment_messages_select_own on public.appointment_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.appointments a
      join public.customers c on c.id = a.customer_id
      where a.id = appointment_messages.appointment_id
        and c.auth_user_id = auth.uid()
    )
  );

create policy appointment_messages_insert_own on public.appointment_messages
  for insert to authenticated
  with check (
    author = 'customer'
    and exists (
      select 1
      from public.appointments a
      join public.customers c on c.id = a.customer_id
      where a.id = appointment_messages.appointment_id
        and c.auth_user_id = auth.uid()
    )
  );

create policy appointment_messages_update_own on public.appointment_messages
  for update to authenticated
  using (
    exists (
      select 1
      from public.appointments a
      join public.customers c on c.id = a.customer_id
      where a.id = appointment_messages.appointment_id
        and c.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.appointments a
      join public.customers c on c.id = a.customer_id
      where a.id = appointment_messages.appointment_id
        and c.auth_user_id = auth.uid()
    )
  );

-- A guest is `anon` and reaches this only through the functions below.
revoke all on public.appointment_messages from anon, authenticated;
grant select, insert, update on public.appointment_messages to authenticated;

-- ---------------------------------------------------------------------------
-- The guest's door: the token, and nothing else
-- ---------------------------------------------------------------------------

create or replace function public.get_appointment_messages_by_token(
  p_appointment_id uuid,
  p_access_token uuid
)
returns table (
  id uuid,
  author public.message_author,
  author_name text,
  body text,
  created_at timestamptz,
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.appointments a
    where a.id = p_appointment_id and a.access_token = p_access_token
  ) then
    -- Wrong token: an empty thread, not an error that confirms the id exists.
    return;
  end if;

  return query
  select m.id, m.author, m.author_name, m.body, m.created_at, m.read_at
  from public.appointment_messages m
  where m.appointment_id = p_appointment_id
  order by m.created_at;
end;
$$;

revoke all on function public.get_appointment_messages_by_token(uuid, uuid) from public;
grant execute on function public.get_appointment_messages_by_token(uuid, uuid) to anon, authenticated;

create or replace function public.send_appointment_message_by_token(
  p_appointment_id uuid,
  p_access_token uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments;
  v_id uuid;
begin
  select a.* into v_appointment
  from public.appointments a
  where a.id = p_appointment_id and a.access_token = p_access_token;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'MESSAGE_EMPTY' using errcode = '22023';
  end if;

  insert into public.appointment_messages (
    appointment_id, business_id, author, author_user_id, author_name, body
  )
  values (
    v_appointment.id,
    v_appointment.business_id,
    'customer',
    auth.uid(),
    -- The name frozen with the appointment, so a later edit to the customer
    -- record does not rewrite who said what.
    v_appointment.customer_name_snapshot,
    btrim(p_body)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.send_appointment_message_by_token(uuid, uuid, text) from public;
grant execute on function public.send_appointment_message_by_token(uuid, uuid, text) to anon, authenticated;

-- Reading the professional's messages marks them read, and nothing else.
create or replace function public.mark_messages_read_by_token(
  p_appointment_id uuid,
  p_access_token uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1 from public.appointments a
    where a.id = p_appointment_id and a.access_token = p_access_token
  ) then
    return 0;
  end if;

  update public.appointment_messages m
     set read_at = now()
   where m.appointment_id = p_appointment_id
     and m.author = 'professional'
     and m.read_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_messages_read_by_token(uuid, uuid) from public;
grant execute on function public.mark_messages_read_by_token(uuid, uuid) to anon, authenticated;
