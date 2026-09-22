import { Link } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui';
import { statusLabelKey, statusTone } from '@/features/appointments';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useFormat } from '@/i18n/use-format';
import type { ProfessionalAppointment } from '@/services/appointments';
import { radius, spacing, useTheme } from '@/theme';

export interface AppointmentRowProps {
  appointment: ProfessionalAppointment;
  timezone: string;
  /** Off for a day view, where every row shares the same date. */
  showDate?: boolean;
}

/** One appointment, readable at a glance on a phone. */
export function AppointmentRow({ appointment, timezone, showDate = true }: AppointmentRowProps) {
  const { palette } = useTheme();
  const tk = useDynamicT();
  const format = useFormat();
  const service = appointment.items[0];

  const time = format.time(appointment.startsAt, timezone);
  const status = tk(statusLabelKey(appointment.status));

  return (
    <Link href={`/app/appointments/${appointment.id}`} asChild>
      <Pressable
        accessibilityRole="button"
        // The status belongs in the spoken label too: sighted readers get it
        // from the badge, and a screen reader should not have to guess.
        accessibilityLabel={`${time} · ${appointment.customer.fullName} · ${status}`}
        style={({ pressed }) => ({
          padding: spacing.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: palette.border,
          backgroundColor: pressed ? palette.surfaceMuted : palette.surface,
          gap: spacing.xs,
        })}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
          <Text variant="label">{time}</Text>
          <Text variant="caption" tone={statusTone(appointment.status)}>
            {status}
          </Text>
        </View>

        {showDate && (
          <Text variant="caption" tone="muted">
            {format.date(appointment.startsAt, timezone)}
          </Text>
        )}

        <Text variant="body">{appointment.customer.fullName}</Text>

        {service && (
          <Text variant="caption" tone="muted">
            {service.name} {'·'} {format.duration(service.durationMinutes)}
          </Text>
        )}
      </Pressable>
    </Link>
  );
}
