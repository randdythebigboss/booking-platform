import { toSchedulePayload, type ScheduleEntry } from '@/features/availability/schedule';
import type { ExceptionDraft, ExceptionKind } from '@/features/availability/overrides';
import { toWorkspaceError } from '@/features/workspace';
import { getSupabase } from '@/lib/supabase';
import type { ClockTime, IsoDate, Weekday } from '@/types/domain';

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

// ---------------------------------------------------------------------------
// Blocked time: ad-hoc unavailable periods inside a day.
// ---------------------------------------------------------------------------

export interface BlockedPeriod {
  id: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

export async function fetchBlockedTimes(
  professionalId: string,
  from: Date,
  to: Date,
): Promise<BlockedPeriod[]> {
  const { data, error } = await getSupabase()
    .from('blocked_times')
    .select('id, starts_at, ends_at, reason')
    .eq('professional_id', professionalId)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at', { ascending: true });

  if (error) throw toWorkspaceError(error);

  return (data ?? []).map((row: Record<string, any>) => ({
    id: String(row.id),
    startsAt: new Date(String(row.starts_at)),
    endsAt: new Date(String(row.ends_at)),
    reason: row.reason ?? null,
  }));
}

/**
 * Creates a block. The database refuses one that would cover a live
 * appointment, which surfaces here as BLOCK_CONFLICTS_WITH_APPOINTMENT --
 * nothing is ever cancelled on the customer's behalf.
 */
export async function createBlockedTime(input: {
  professionalId: string;
  startsAt: Date;
  endsAt: Date;
  reason?: string;
}): Promise<string> {
  const { data, error } = await getSupabase()
    .from('blocked_times')
    .insert({
      professional_id: input.professionalId,
      starts_at: input.startsAt.toISOString(),
      ends_at: input.endsAt.toISOString(),
      reason: input.reason?.trim() || null,
    })
    .select('id')
    .single();

  if (error) throw toWorkspaceError(error);
  return String((data as Record<string, unknown>).id);
}

export async function deleteBlockedTime(id: string): Promise<void> {
  const { error } = await getSupabase().from('blocked_times').delete().eq('id', id);
  if (error) throw toWorkspaceError(error);
}

// ---------------------------------------------------------------------------
// Date exceptions: changes to what the schedule SAYS for one date.
// ---------------------------------------------------------------------------

export interface DateExceptionRow {
  id: string;
  date: IsoDate;
  kind: ExceptionKind;
  startTime: ClockTime | null;
  endTime: ClockTime | null;
  reason: string | null;
}

export async function fetchDateExceptions(
  professionalId: string,
  from: IsoDate,
  to: IsoDate,
): Promise<DateExceptionRow[]> {
  const { data, error } = await getSupabase()
    .from('availability_exceptions')
    .select('id, exception_date, exception_type, start_time, end_time, reason')
    .eq('professional_id', professionalId)
    .gte('exception_date', from)
    .lte('exception_date', to)
    .order('exception_date', { ascending: true });

  if (error) throw toWorkspaceError(error);

  return (data ?? []).map((row: Record<string, any>) => ({
    id: String(row.id),
    date: String(row.exception_date),
    // An untimed "unavailable" row is a closed day; anything else is a
    // replacement of that date's hours.
    kind: row.exception_type === 'available' ? 'custom-hours' : 'closed',
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
    endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
    reason: row.reason ?? null,
  }));
}

export async function createDateException(
  professionalId: string,
  draft: ExceptionDraft,
): Promise<string> {
  // A closed day is an untimed "unavailable" row; custom hours are an
  // "available" row that replaces that date's schedule entirely.
  const row: Record<string, unknown> = {
    professional_id: professionalId,
    exception_date: draft.date,
    exception_type: draft.kind === 'closed' ? 'unavailable' : 'available',
    reason: draft.reason?.trim() || null,
  };

  if (draft.kind === 'custom-hours') {
    row.start_time = draft.startTime;
    row.end_time = draft.endTime;
  }

  const { data, error } = await getSupabase()
    .from('availability_exceptions')
    .insert(row)
    .select('id')
    .single();

  if (error) throw toWorkspaceError(error);
  return String((data as Record<string, unknown>).id);
}

export async function deleteDateException(id: string): Promise<void> {
  const { error } = await getSupabase().from('availability_exceptions').delete().eq('id', id);
  if (error) throw toWorkspaceError(error);
}
