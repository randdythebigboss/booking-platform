-- ===========================================================================
-- Professional setup (Phase 1)
--
-- Three operations that must not half-happen. Each is one transaction, and
-- each runs as SECURITY INVOKER so Row Level Security still decides who may
-- do what -- these functions buy atomicity, not privilege.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- create_business - the whole onboarding write, in one go
--
-- Order matters: the membership row has to exist before the professional
-- profile, because the policy on professional_profiles asks whether the
-- caller is a manager of the business.
-- ---------------------------------------------------------------------------

create or replace function public.create_business(
  p_name text,
  p_slug text,
  p_timezone text,
  p_display_name text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_business_id uuid;
  v_professional_id uuid;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'BUSINESS_NAME_REQUIRED' using errcode = '22023';
  end if;

  if coalesce(btrim(p_display_name), '') = '' then
    raise exception 'DISPLAY_NAME_REQUIRED' using errcode = '22023';
  end if;

  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_slug) not between 3 and 60 then
    raise exception 'INVALID_SLUG' using errcode = '22023';
  end if;

  begin
    insert into public.businesses (owner_user_id, name, slug, timezone)
    values (v_user, btrim(p_name), p_slug, p_timezone)
    returning id into v_business_id;
  exception
    when unique_violation then
      raise exception 'SLUG_TAKEN' using errcode = '23505';
  end;

  insert into public.business_members (business_id, user_id, role)
  values (v_business_id, v_user, 'owner');

  insert into public.professional_profiles (business_id, user_id, display_name)
  values (v_business_id, v_user, btrim(p_display_name))
  returning id into v_professional_id;

  return jsonb_build_object(
    'businessId', v_business_id,
    'professionalId', v_professional_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- save_service - create or update a service, and keep it bookable
--
-- A service nobody is assigned to is invisible on the booking page, which is
-- a silent trap. Saving one always reconciles professional_services.
-- ---------------------------------------------------------------------------

create or replace function public.save_service(
  p_business_id uuid,
  p_name text,
  p_duration_minutes integer,
  p_price numeric,
  p_service_id uuid default null,
  p_description text default null,
  p_buffer_before_minutes integer default 0,
  p_buffer_after_minutes integer default 0,
  p_is_active boolean default true
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_service_id uuid := p_service_id;
  v_currency char(3);
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'SERVICE_NAME_REQUIRED' using errcode = '22023';
  end if;

  select currency into v_currency from public.businesses where id = p_business_id;
  if v_currency is null then
    raise exception 'BUSINESS_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_service_id is null then
    insert into public.services (
      business_id, name, description, duration_minutes,
      buffer_before_minutes, buffer_after_minutes, price, currency, is_active
    )
    values (
      p_business_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
      p_duration_minutes, p_buffer_before_minutes, p_buffer_after_minutes,
      p_price, v_currency, p_is_active
    )
    returning id into v_service_id;
  else
    update public.services
    set name = btrim(p_name),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        duration_minutes = p_duration_minutes,
        buffer_before_minutes = p_buffer_before_minutes,
        buffer_after_minutes = p_buffer_after_minutes,
        price = p_price,
        is_active = p_is_active
    where id = v_service_id and business_id = p_business_id;

    if not found then
      raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  insert into public.professional_services (professional_id, service_id)
  select p.id, v_service_id
  from public.professional_profiles p
  where p.business_id = p_business_id
  on conflict (professional_id, service_id) do nothing;

  return v_service_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_weekly_schedule - replace a professional's whole week atomically
--
-- Editing hours one row at a time can leave someone with no working hours if
-- a request fails halfway. The editor sends the whole week, and this swaps it
-- in one transaction.
-- ---------------------------------------------------------------------------

create or replace function public.set_weekly_schedule(
  p_professional_id uuid,
  p_rules jsonb
)
returns integer
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_rule jsonb;
begin
  -- Row Level Security would block the INSERT anyway, but the DELETE would
  -- quietly match no rows first. Refusing up front turns a confusing partial
  -- failure into a clear one.
  if not public.can_manage_professional(p_professional_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if jsonb_typeof(p_rules) <> 'array' then
    raise exception 'INVALID_SCHEDULE' using errcode = '22023';
  end if;

  -- Validate before deleting anything, so a bad payload cannot wipe a week.
  for v_rule in select * from jsonb_array_elements(p_rules)
  loop
    if (v_rule ->> 'weekday')::int not between 0 and 6 then
      raise exception 'INVALID_WEEKDAY' using errcode = '22023';
    end if;
    if (v_rule ->> 'endTime')::time <= (v_rule ->> 'startTime')::time then
      raise exception 'INVALID_TIME_RANGE' using errcode = '22023';
    end if;
  end loop;

  delete from public.availability_rules where professional_id = p_professional_id;

  insert into public.availability_rules (professional_id, weekday, start_time, end_time)
  select
    p_professional_id,
    (rule ->> 'weekday')::smallint,
    (rule ->> 'startTime')::time,
    (rule ->> 'endTime')::time
  from jsonb_array_elements(p_rules) as rule;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. These are professional-side operations: no anonymous access.
-- ---------------------------------------------------------------------------

revoke all on function public.create_business(text, text, text, text) from public;
revoke all on function public.save_service(uuid, text, integer, numeric, uuid, text, integer, integer, boolean) from public;
revoke all on function public.set_weekly_schedule(uuid, jsonb) from public;

grant execute on function public.create_business(text, text, text, text) to authenticated;
grant execute on function public.save_service(uuid, text, integer, numeric, uuid, text, integer, integer, boolean) to authenticated;
grant execute on function public.set_weekly_schedule(uuid, jsonb) to authenticated;
