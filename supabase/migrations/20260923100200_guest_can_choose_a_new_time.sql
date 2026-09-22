-- ===========================================================================
-- A guest cannot choose a new time without being told what to choose from.
--
-- get_appointment_by_token already returns everything a confirmation page
-- shows. Rescheduling needs two more things: which professional and which
-- service, so the page can ask get_available_slots the same question the
-- public booking page asks. Neither is a disclosure -- the public page hands
-- out both to anyone who opens it.
--
-- canReschedule is returned alongside canCancel rather than derived in the
-- client, so the rule lives in one place: the same place that enforces it.
--
-- Regenerated from the live definition; the body is otherwise unchanged.
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
    'customerName', c.full_name,
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
  join public.customers c on c.id = a.customer_id
  where a.id = p_appointment_id
    and a.access_token = p_access_token;

  if v_result is null then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  return v_result;
end;
$function$
;
