import { View, useWindowDimensions } from 'react-native';

import { Badge, PressableLink, Text, type BadgeTone } from '@/components/ui';
import { statusLabelKey } from '@/features/appointments';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useFormat } from '@/i18n/use-format';
import type { ProfessionalAppointment } from '@/services/appointments';
import { radius, spacing, useTheme } from '@/theme';
import type { AppointmentStatus } from '@/types/domain';

export interface AppointmentRowProps {
  appointment: ProfessionalAppointment;
  timezone: string;
  /** Off for a day view, where every row shares the same date. */
  showDate?: boolean;
}

/**
 * How a status looks, and the character that carries it when colour does not.
 *
 * The mark matters more than the tint: a cancelled appointment among confirmed
 * ones has to be obvious to somebody who cannot tell the two hues apart, and
 * to anybody glancing at a phone in daylight.
 */
export function statusBadge(status: AppointmentStatus): { tone: BadgeTone; mark: string } {
  switch (status) {
    case 'confirmed':
      return { tone: 'success', mark: '✓' };
    case 'pending':
      return { tone: 'warning', mark: '•' };
    case 'cancelled':
      return { tone: 'danger', mark: '✕' };
    case 'completed':
      return { tone: 'accent', mark: '✓' };
    default:
      return { tone: 'neutral', mark: '–' };
  }
}

/**
 * One appointment, readable at a glance.
 *
 * The time leads, in a fixed-width column, so a list of them scans down the
 * left edge instead of wandering. The one this replaced was four lines of
 * loose text with the status floated to the right of the first one, and
 * nothing lined up with anything.
 */
export function AppointmentRow({ appointment, timezone, showDate = true }: AppointmentRowProps) {
  const { palette } = useTheme();
  // At 375px a fixed time column, a name, a service and a status word do not
  // fit on one line, and what got cut was the customer's name. Below this the
  // row stacks instead of truncating.
  const narrow = useWindowDimensions().width < 480;
  const tk = useDynamicT();
  const format = useFormat();
  const service = appointment.items[0];

  const time = format.time(appointment.startsAt, timezone);
  const status = tk(statusLabelKey(appointment.status));
  const badge = statusBadge(appointment.status);
  const cancelled = appointment.status === 'cancelled';

  return (
    <PressableLink
      href={`/app/appointments/${appointment.id}`}
      // The status belongs in the spoken label too: sighted readers get it
      // from the badge, and a screen reader should not have to guess.
      accessibilityLabel={`${time} · ${appointment.customer.fullName} · ${service?.name ?? ''} · ${status}`}
      style={{
        flexDirection: 'row',
        alignItems: narrow ? 'stretch' : 'center',
        gap: spacing.md,
        minHeight: 64,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface,
        opacity: cancelled ? 0.7 : 1,
      }}
    >
      {narrow ? (
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text
              variant="label"
              style={{ flex: 1, textDecorationLine: cancelled ? 'line-through' : 'none' }}
              numberOfLines={1}
            >
              {time}
              {showDate ? ` · ${format.dayAndMonth(appointment.startsAt, timezone)}` : ''}
            </Text>
            <Badge label={status} tone={badge.tone} mark={badge.mark} />
          </View>
          <Text variant="body" numberOfLines={1}>
            {appointment.customer.fullName}
          </Text>
          {service && (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {service.name} {'·'} {format.duration(service.durationMinutes)}
            </Text>
          )}
        </View>
      ) : (
        <>
          {/* The time column. Fixed width so every row in a list aligns. */}
          <View style={{ width: 72, gap: 1 }}>
            <Text
              variant="label"
              style={{ textDecorationLine: cancelled ? 'line-through' : 'none' }}
              numberOfLines={1}
            >
              {time}
            </Text>
            {showDate && (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {format.dayAndMonth(appointment.startsAt, timezone)}
              </Text>
            )}
          </View>

          <View style={{ flex: 1, gap: 1 }}>
            <Text variant="body" numberOfLines={1}>
              {appointment.customer.fullName}
            </Text>
            {service && (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {service.name} {'·'} {format.duration(service.durationMinutes)}
              </Text>
            )}
          </View>

          <Badge label={status} tone={badge.tone} mark={badge.mark} />
        </>
      )}
    </PressableLink>
  );
}
