-- ===========================================================================
-- What the guest is shown is what the guest booked.
--
-- 20260926100000 froze the customer's name onto the appointment. This is the
-- other half of that change: the read that a guest's confirmation page uses
-- still joined `customers` and showed whatever that reusable row had become,
-- so the snapshot existed and nobody looked at it.
--
-- The join to `customers` goes entirely. Nothing in this answer needs the
-- reusable record any more, and not joining it is also one fewer table that a
-- SECURITY DEFINER function touches on behalf of an anonymous caller.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.get_appointment_by_token(p_appointment_id uuid, p_access_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'appointmentId', a.id,
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
    -- Frozen at booking time, not read through to the reusable record.
    'customerName', a.customer_name_snapshot,
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
    'canCancel', a.status in ('pending', 'confirmed') and a.starts_at > now()
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
$function$;

-- Recreating a function resets its grants to the Supabase defaults. Restate
-- the classification: this one is genuinely public, because a guest holding a
-- booking link has no account to be authenticated as.
revoke all on function public.get_appointment_by_token(uuid, uuid) from public;
grant execute on function public.get_appointment_by_token(uuid, uuid) to anon, authenticated;
