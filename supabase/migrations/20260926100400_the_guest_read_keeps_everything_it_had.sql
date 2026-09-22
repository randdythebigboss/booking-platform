-- ===========================================================================
-- Restores what 20260926100300 dropped by accident.
--
-- That migration moved the guest's confirmation read onto the frozen customer
-- name, and reproduced the function from the wrong place: the Phase 4 version
-- in 20260921120000, not the live one. Phase 5 had since added
-- `professionalId`, `serviceId` and `canReschedule` so a guest could choose a
-- new time, and reproducing the older body silently removed all three.
--
-- Nothing in SQL noticed. The database answered 200 with a well-formed object,
-- and the client -- which validates the shape it is given -- refused it, so the
-- confirmation page said "we could not load this booking" about a booking that
-- was perfectly fine. It took a browser to see it.
--
-- Two lessons, both already written down and both worth repeating here: a
-- function is reproduced from the **live definition**, never from whichever
-- migration is easiest to find; and `supabase/tests/public_booking.sql` now
-- asserts the fields this answer must contain, so the next accidental removal
-- fails in CI instead of in front of a customer.
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
    -- Phase 5: the guest needs both of these to ask get_available_slots the
    -- same question the public booking page asks.
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
    -- Phase 8: frozen at booking time, not read through to the reusable
    -- customer record.
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
$function$;

revoke all on function public.get_appointment_by_token(uuid, uuid) from public;
grant execute on function public.get_appointment_by_token(uuid, uuid) to anon, authenticated;
