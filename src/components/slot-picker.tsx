import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { DatePicker } from '@/components/date-picker';
import { DaySchedule } from '@/components/day-schedule';
import { Feedback, Text } from '@/components/ui';
import { addDays, isoDateIn, type DaySlot } from '@/features/availability';
import { fetchDaySchedule } from '@/services/availability';
import { spacing } from '@/theme';
import type { IsoDate } from '@/types/domain';

export interface SlotPickerProps {
  professionalId: string;
  serviceId: string;
  timezone: string;
  /** Business-local date, `YYYY-MM-DD`. */
  date: IsoDate;
  onDateChange: (date: IsoDate) => void;
  /** ISO instant of the chosen slot, or null. */
  selected: string | null;
  onSelect: (startsAt: string) => void;
  /** How far ahead this business lets people book. */
  horizonDays?: number;
  /**
   * Bump to re-ask. A list fetched a minute ago may be offering a time that
   * has since gone, and the caller finds that out when a write is refused.
   */
  reloadKey?: number;
  /**
   * The professional's own screens may see *why* a time is unavailable. The
   * public may not; see DaySchedule.
   */
  revealReason?: boolean;
}

/**
 * A day, and every time on it.
 *
 * Extracted because three screens ask the same question -- a guest booking, a
 * guest moving their booking, a professional moving somebody else's -- and the
 * answer has to come from the same place each time. The list is whatever
 * `get_day_schedule` returns and nothing else: the client never computes
 * availability, it only draws it.
 *
 * It used to show only the free times, which made a quiet Tuesday and a nearly
 * full one look identical, and it used to ask for the day as typed text. Both
 * are now controls: a week of days you tap, and a day of times where the ones
 * you cannot have are visibly there rather than silently absent.
 */
export function SlotPicker({
  professionalId,
  serviceId,
  timezone,
  date,
  onDateChange,
  selected,
  onSelect,
  horizonDays = 60,
  reloadKey = 0,
  revealReason = false,
}: SlotPickerProps) {
  const { t } = useTranslation();

  const [slots, setSlots] = useState<DaySlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailure(null);

    fetchDaySchedule({ professionalId, serviceId, date })
      .then((result) => {
        if (!cancelled) setSlots(result);
      })
      .catch(() => {
        if (cancelled) return;
        setFailure(t('reschedule.couldNotLoadTimes'));
        setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [professionalId, serviceId, date, reloadKey, t]);

  // The time the appointment already holds shows as taken, not as free: the
  // engine counts it as occupied, which it is. Every bookable option is a move.
  const today = isoDateIn(new Date(), timezone);
  const free = slots.filter((slot) => slot.state === 'available').length;

  return (
    <View style={{ gap: spacing.md }}>
      <DatePicker
        label={t('common.chooseADay')}
        value={date}
        minDate={today}
        maxDate={addDays(today, horizonDays)}
        onChange={onDateChange}
      />

      <Text variant="caption" tone="muted">
        {t('common.timesShownIn', { timezone: timezone.replace(/_/g, ' ') })}
      </Text>

      {loading && <ActivityIndicator />}
      {failure && <Feedback tone="danger" message={failure} />}

      {!loading && !failure && slots.length === 0 && (
        <Feedback tone="muted" message={t('schedule.nothingOpenThatDay')} />
      )}

      {!loading && !failure && slots.length > 0 && free === 0 && (
        <Feedback tone="muted" message={t('reschedule.noTimesThatDay')} />
      )}

      {!loading && !failure && slots.length > 0 && (
        <>
          <Text variant="caption" tone="muted">
            {t('schedule.freeCount', { count: free })}
          </Text>
          <DaySchedule
            slots={slots}
            selected={selected}
            onSelect={onSelect}
            timezone={timezone}
            revealReason={revealReason}
          />
        </>
      )}
    </View>
  );
}
