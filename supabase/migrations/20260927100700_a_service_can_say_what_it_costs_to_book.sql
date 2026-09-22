-- ===========================================================================
-- A service can be told what it costs to book.
--
-- Reproduced from the live definition, with two arguments added at the end so
-- an older caller keeps working and lands on "asks for nothing", which is what
-- every service asked for until today.
--
-- The deposit is normalised here -- kept only when a deposit is what was
-- asked for -- so that the check constraint on the table is a backstop rather
-- than the thing a professional meets when they change their mind about a
-- service.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.save_service(p_business_id uuid, p_name text, p_duration_minutes integer, p_price numeric, p_service_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_buffer_before_minutes integer DEFAULT 0, p_buffer_after_minutes integer DEFAULT 0, p_is_active boolean DEFAULT true, p_payment_requirement public.payment_requirement DEFAULT 'none'::public.payment_requirement, p_deposit_amount numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_service_id uuid := p_service_id;
  v_currency char(3);
  v_deposit numeric(12, 2);
begin
  -- A deposit exists exactly when one is asked for. Normalising here rather
  -- than trusting the caller keeps the check constraint from being the first
  -- thing that notices, and keeps the error a product error.
  v_deposit := case when p_payment_requirement = 'deposit' then p_deposit_amount end;

  if p_payment_requirement = 'deposit'
     and (v_deposit is null or v_deposit <= 0 or v_deposit > p_price) then
    raise exception 'INVALID_DEPOSIT' using errcode = '22023';
  end if;
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
      buffer_before_minutes, buffer_after_minutes, price, currency, is_active,
      payment_requirement, deposit_amount
    )
    values (
      p_business_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
      p_duration_minutes, p_buffer_before_minutes, p_buffer_after_minutes,
      p_price, v_currency, p_is_active,
      p_payment_requirement, v_deposit
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
        is_active = p_is_active,
        payment_requirement = p_payment_requirement,
        deposit_amount = v_deposit
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
$function$;

drop function if exists public.save_service(uuid, text, integer, numeric, uuid, text, integer, integer, boolean);

revoke all on function public.save_service(
  uuid, text, integer, numeric, uuid, text, integer, integer, boolean,
  public.payment_requirement, numeric
) from public, anon;
grant execute on function public.save_service(
  uuid, text, integer, numeric, uuid, text, integer, integer, boolean,
  public.payment_requirement, numeric
) to authenticated;
