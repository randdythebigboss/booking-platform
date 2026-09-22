import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Button, Feedback, Field, Text } from '@/components/ui';
import { addDays, type Slot } from '@/features/availability';
import { formatDateIn, formatTimeIn } from '@/lib/format';
import { fetchAvailableSlots } from '@/services/availability';
import { radius, spacing, useTheme } from '@/theme';
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
  /**
   * Bump to re-ask. A list fetched a minute ago may be offering a time that
   * has since gone, and the caller finds that out when a write is refused.
   */
  reloadKey?: number;
}

/**
 * A day, and the times available on it.
 *
 * Extracted because three screens now ask the same question -- a guest
 * booking, a guest moving their booking, a professional moving somebody
 * else's -- and the answer has to come from the same place each time. The
 * list is whatever `get_available_slots` returns and nothing else: the client
 * never computes availability, it only draws it.
 */
export function SlotPicker({
  professionalId,
  serviceId,
  timezone,
  date,
  onDateChange,
  selected,
  onSelect,
  reloadKey = 0,
}: SlotPickerProps) {
  const { palette } = useTheme();

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailure(null);

    fetchAvailableSlots({ professionalId, serviceId, date })
      .then((result) => {
        if (!cancelled) setSlots(result);
      })
      .catch(() => {
        if (cancelled) return;
        setFailure('We could not load the available times. Please try again.');
        setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [professionalId, serviceId, date, reloadKey]);

  // The time the appointment already holds is never in this list: it is
  // occupied, so the engine does not offer it. Every option here is a move.

  return (
    <View style={{ gap: spacing.sm }}>
      <Field
        label="Day"
        value={date}
        onChangeText={onDateChange}
        placeholder="2026-09-28"
        autoCapitalize="none"
        hint={`Times are shown in ${timezone.replace(/_/g, ' ')}.`}
      />

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button
          label="Previous day"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => onDateChange(addDays(date, -1))}
        />
        <Button
          label="Next day"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => onDateChange(addDays(date, 1))}
        />
      </View>

      <Text variant="caption" tone="muted">
        {formatDateIn(new Date(`${date}T12:00:00Z`), timezone)}
      </Text>

      {loading && <ActivityIndicator />}
      {failure && <Feedback tone="danger" message={failure} />}

      {!loading && !failure && slots.length === 0 && (
        <Feedback tone="muted" message="No times available that day. Try another date." />
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {slots.map((slot) => {
          const iso = slot.startsAt.toISOString();
          const chosen = iso === selected;
          return (
            <Pressable
              key={iso}
              accessibilityRole="radio"
              accessibilityState={{ selected: chosen }}
              onPress={() => onSelect(iso)}
              style={{
                minWidth: 92,
                alignItems: 'center',
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: chosen ? palette.accent : palette.border,
                backgroundColor: chosen ? palette.accent : 'transparent',
              }}
            >
              <Text variant="label" style={chosen ? { color: palette.accentText } : undefined}>
                {formatTimeIn(slot.startsAt, timezone)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
