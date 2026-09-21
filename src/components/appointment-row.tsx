import { Link } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui';
import { statusLabel, statusTone } from '@/features/appointments';
import { formatDateIn, formatDuration, formatTimeIn } from '@/lib/format';
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
  const service = appointment.items[0];

  return (
    <Link href={`/app/appointments/${appointment.id}`} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${formatTimeIn(appointment.startsAt, timezone)} ${appointment.customer.fullName}`}
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
          <Text variant="label">{formatTimeIn(appointment.startsAt, timezone)}</Text>
          <Text variant="caption" tone={statusTone(appointment.status)}>
            {statusLabel(appointment.status)}
          </Text>
        </View>

        {showDate && (
          <Text variant="caption" tone="muted">
            {formatDateIn(appointment.startsAt, timezone)}
          </Text>
        )}

        <Text variant="body">{appointment.customer.fullName}</Text>

        {service && (
          <Text variant="caption" tone="muted">
            {service.name} {'·'} {formatDuration(service.durationMinutes)}
          </Text>
        )}
      </Pressable>
    </Link>
  );
}
