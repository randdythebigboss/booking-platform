import { toSchedulePayload, type ScheduleEntry } from '@/features/availability/schedule';
import { toWorkspaceError } from '@/features/workspace';
import { getSupabase } from '@/lib/supabase';
import type { ClockTime, Weekday } from '@/types/domain';

/** The professional's current weekly hours, oldest rule first. */
export async function fetchWeeklySchedule(professionalId: string): Promise<ScheduleEntry[]> {
  const { data, error } = await getSupabase()
    .from('availability_rules')
    .select('weekday, start_time, end_time')
    .eq('professional_id', professionalId)
    .eq('is_active', true)
    .order('weekday', { ascending: true })
    .order('start_time', { ascending: true });

  if (error) throw toWorkspaceError(error);

  return (data ?? []).map((row: Record<string, any>) => ({
    weekday: Number(row.weekday) as Weekday,
    // Postgres returns HH:mm:ss; the editor works in HH:mm.
    startTime: String(row.start_time).slice(0, 5) as ClockTime,
    endTime: String(row.end_time).slice(0, 5) as ClockTime,
  }));
}

/**
 * Replaces the whole week in one transaction, so a failure can never leave a
 * professional with half a schedule.
 */
export async function saveWeeklySchedule(
  professionalId: string,
  entries: readonly ScheduleEntry[],
): Promise<number> {
  const { data, error } = await getSupabase().rpc('set_weekly_schedule', {
    p_professional_id: professionalId,
    p_rules: toSchedulePayload(entries),
  });

  if (error) throw toWorkspaceError(error);
  return Number(data);
}
