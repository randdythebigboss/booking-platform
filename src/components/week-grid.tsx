import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { statusBadge } from '@/components/appointment-row';
import { Text } from '@/components/ui/text';
import {
  addDays,
  hourIn,
  isoDateIn,
  parseClockTime,
  parseIsoDate,
  zonedInstant,
} from '@/features/availability';
import type { ScheduleEntry } from '@/features/availability/schedule';
import { useFormat } from '@/i18n/use-format';
import type { ProfessionalAppointment } from '@/services/appointments';
import type { BlockedPeriod, DateExceptionRow } from '@/services/schedule-admin';
import { radius, spacing, useTheme } from '@/theme';

export interface WeekGridProps {
  /** Monday of the week being drawn, `YYYY-MM-DD`. */
  weekStart: string;
  timezone: string;
  today: string;
  selected: string;
  onSelectDay: (date: string) => void;
  appointments: ProfessionalAppointment[];
  rules: ScheduleEntry[];
  exceptions: DateExceptionRow[];
  blocks: BlockedPeriod[];
  onOpenAppointment: (id: string) => void;
}

const DAYS = 7;
const PX_PER_HOUR = 64;
const GUTTER = 66;
/** Nothing useful is drawn outside this, and it keeps the grid a sane height. */
const FALLBACK_RANGE = { from: 8, to: 20 };

/** Midday UTC, so formatting never slides a date into its neighbour. */
function asDate(iso: string): Date {
  const { year, month, day } = parseIsoDate(iso);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** The weekday a calendar date falls on, read from the date itself. */
function weekdayOfDate(iso: string): number {
  return asDate(iso).getUTCDay();
}

/**
 * A week, drawn as a week.
 *
 * ---------------------------------------------------------------------------
 * Why a grid and not another list
 * ---------------------------------------------------------------------------
 *
 * The Agenda screen was a list of appointments, which answers "what is
 * booked" and nothing else. A professional opening it in the morning wants
 * the shape of the week: where the gaps are, which afternoon is free, whether
 * Thursday is worth opening at all. A list cannot show a gap -- a gap is
 * exactly the thing a list has no row for.
 *
 * So the canvas is the working hours and the appointments sit on it. Empty
 * space inside a working band is bookable time, and that is the single most
 * useful fact on the screen.
 *
 * ---------------------------------------------------------------------------
 * The four layers, bottom to top
 * ---------------------------------------------------------------------------
 *
 *   1. outside working hours   the page's own background, left alone
 *   2. working window          a pale band -- this is when the shop is open
 *   3. exception / block       hatched over the band, with the reason
 *   4. appointment             a solid card, pressable, opening the booking
 *
 * Cancelled appointments are deliberately NOT drawn as blocks: that time is
 * free again, and drawing it as occupied would be a lie told in the one place
 * a professional trusts. They stay reachable in the list beneath.
 *
 * ---------------------------------------------------------------------------
 * Mobile
 * ---------------------------------------------------------------------------
 *
 * This is not it. Seven columns on a 375px screen is 45px each, which fits
 * neither a time nor a name. The caller draws a single-day agenda there and
 * uses this only where there is width for it.
 */
export function WeekGrid({
  weekStart,
  timezone,
  today,
  selected,
  onSelectDay,
  appointments,
  rules,
  exceptions,
  blocks,
  onOpenAppointment,
}: WeekGridProps) {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const format = useFormat();

  const dates = useMemo(
    () => Array.from({ length: DAYS }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );

  const windowsFor = useCallback(
    (iso: string) => {
      const closedAllDay = exceptions.some(
        (entry) => entry.date === iso && entry.kind === 'closed',
      );
      if (closedAllDay) return [];

      const custom = exceptions.filter(
        (entry) =>
          entry.date === iso && entry.kind === 'custom-hours' && entry.startTime && entry.endTime,
      );
      // A custom day replaces the recurring one wholesale; that is what the
      // exceptions screen promises, and the grid must not contradict it.
      if (custom.length > 0) {
        return custom.map((entry) => ({
          from: parseClockTime(entry.startTime as string),
          to: parseClockTime(entry.endTime as string),
        }));
      }

      return rules
        .filter((rule) => rule.weekday === weekdayOfDate(iso))
        .map((rule) => ({
          from: parseClockTime(rule.startTime),
          to: parseClockTime(rule.endTime),
        }));
    },
    [rules, exceptions],
  );

  // The grid spans only the hours the week actually uses, plus what the
  // appointments need -- a shop that opens at ten should not scroll past two
  // empty hours every morning.
  const span = useMemo(() => {
    let from = Infinity;
    let to = -Infinity;

    for (const date of dates) {
      for (const win of windowsFor(date)) {
        from = Math.min(from, win.from);
        to = Math.max(to, win.to);
      }
    }
    for (const appointment of appointments) {
      if (appointment.status === 'cancelled') continue;
      from = Math.min(from, hourIn(appointment.startsAt, timezone) * 60);
      to = Math.max(to, hourIn(appointment.endsAt, timezone) * 60 + 60);
    }

    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      return { from: FALLBACK_RANGE.from * 60, to: FALLBACK_RANGE.to * 60 };
    }
    return { from: Math.floor(from / 60) * 60, to: Math.ceil(to / 60) * 60 };
  }, [dates, windowsFor, appointments, timezone]);

  const hours = Array.from(
    { length: Math.max(1, Math.round((span.to - span.from) / 60)) },
    (_, index) => span.from / 60 + index,
  );
  const height = hours.length * PX_PER_HOUR;

  /** Where a wall-clock minute sits, in pixels from the top of the grid. */
  const offsetOf = (minutes: number) => ((minutes - span.from) / 60) * PX_PER_HOUR;

  const minutesInDay = (instant: Date, iso: string) => {
    const start = zonedInstant(iso, 0, timezone).getTime();
    return (instant.getTime() - start) / 60000;
  };

  return (
    <View style={{ gap: spacing.xs }}>
      {/* Day headings, aligned to the columns under them. */}
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: GUTTER }} />
        {dates.map((date) => {
          const isToday = date === today;
          const chosen = date === selected;
          const count = appointments.filter(
            (a) => a.status !== 'cancelled' && isoDateIn(a.startsAt, timezone) === date,
          ).length;

          return (
            <Pressable
              key={date}
              accessibilityRole="button"
              accessibilityState={{ selected: chosen }}
              accessibilityLabel={`${format.date(asDate(date), 'UTC')} — ${t('calendar.appointmentsThatDay', { count })}`}
              onPress={() => onSelectDay(date)}
              style={{
                flex: 1,
                alignItems: 'center',
                gap: 1,
                paddingVertical: spacing.xs,
                marginHorizontal: 1,
                borderRadius: radius.sm,
                backgroundColor: chosen ? palette.accentMuted : 'transparent',
              }}
            >
              <Text variant="caption" tone="muted">
                {format.weekday(asDate(date), 'UTC')}
              </Text>
              <Text variant="label" tone={isToday ? 'accent' : 'default'}>
                {asDate(date).getUTCDate()}
              </Text>
              <Text variant="caption" tone="muted">
                {count > 0 ? count : '·'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Tall enough that a nine-hour day needs no scrolling at all. */}
      <ScrollView
        style={{ maxHeight: 640 }}
        nestedScrollEnabled
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 }}
      >
        <View style={{ flexDirection: 'row', height }}>
          {/* The hour gutter. */}
          <View style={{ width: GUTTER }}>
            {[...hours, (hours[hours.length - 1] ?? 0) + 1].map((hour, index) => (
              <View
                key={hour}
                style={{ position: 'absolute', top: index * PX_PER_HOUR - 7, right: spacing.xs }}
              >
                <Text variant="caption" tone="muted">
                  {format.time(zonedInstant(weekStart, hour * 60, timezone), timezone)}
                </Text>
              </View>
            ))}
          </View>

          {dates.map((date) => {
            const windows = windowsFor(date);
            const dayAppointments = appointments.filter(
              (a) => a.status !== 'cancelled' && isoDateIn(a.startsAt, timezone) === date,
            );
            const dayBlocks = blocks.filter((b) => isoDateIn(b.startsAt, timezone) === date);
            const closed = windows.length === 0;

            return (
              <View
                key={date}
                style={{
                  flex: 1,
                  marginHorizontal: 1,
                  borderRadius: radius.sm,
                  borderLeftWidth: 1,
                  borderLeftColor: palette.borderSubtle,
                  backgroundColor: date === selected ? palette.accentMuted : 'transparent',
                }}
              >
                {/* Hour lines, so a block's position is readable. */}
                {hours.map((hour, index) => (
                  <View
                    key={hour}
                    style={{
                      position: 'absolute',
                      top: index * PX_PER_HOUR,
                      left: 0,
                      right: 0,
                      height: 1,
                      backgroundColor: palette.borderSubtle,
                    }}
                  />
                ))}

                {/* Layer 2: when the shop is open. */}
                {windows.map((win, index) => (
                  <View
                    key={`w${index}`}
                    style={{
                      position: 'absolute',
                      top: offsetOf(win.from),
                      height: Math.max(2, offsetOf(win.to) - offsetOf(win.from)),
                      left: 1,
                      right: 1,
                      borderRadius: radius.sm,
                      backgroundColor: palette.surface,
                      borderWidth: 1,
                      borderColor: palette.borderSubtle,
                    }}
                  />
                ))}

                {closed && (
                  <View
                    style={{
                      position: 'absolute',
                      top: 6,
                      left: 0,
                      right: 0,
                      alignItems: 'center',
                    }}
                  >
                    <Text variant="caption" tone="muted">
                      {t('availability.closed')}
                    </Text>
                  </View>
                )}

                {/* Layer 3: time taken out of the day on purpose. */}
                {dayBlocks.map((block) => {
                  const from = minutesInDay(block.startsAt, date);
                  const to = minutesInDay(block.endsAt, date);
                  return (
                    <View
                      key={block.id}
                      accessibilityLabel={`${t('blocks.title')}: ${format.time(block.startsAt, timezone)}`}
                      style={{
                        position: 'absolute',
                        top: offsetOf(from),
                        height: Math.max(6, offsetOf(to) - offsetOf(from)),
                        left: 2,
                        right: 2,
                        borderRadius: radius.sm,
                        backgroundColor: palette.surfaceMuted,
                        borderWidth: 1,
                        borderStyle: 'dashed',
                        borderColor: palette.border,
                      }}
                    />
                  );
                })}

                {/* Layer 4: the work itself. */}
                {dayAppointments.map((appointment) => {
                  const from = minutesInDay(appointment.startsAt, date);
                  const to = minutesInDay(appointment.endsAt, date);
                  const badge = statusBadge(appointment.status);
                  const pending = appointment.status === 'pending';
                  const blockHeight = Math.max(22, offsetOf(to) - offsetOf(from) - 2);

                  return (
                    <Pressable
                      key={appointment.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${format.time(appointment.startsAt, timezone)} ${appointment.customer.fullName} ${appointment.items[0]?.name ?? ''}`}
                      onPress={() => onOpenAppointment(appointment.id)}
                      style={{
                        position: 'absolute',
                        top: offsetOf(from) + 1,
                        height: blockHeight,
                        left: 2,
                        right: 2,
                        overflow: 'hidden',
                        paddingHorizontal: 4,
                        paddingVertical: 2,
                        borderRadius: radius.sm,
                        borderWidth: 1,
                        borderLeftWidth: 3,
                        borderColor: pending ? palette.warning : palette.accent,
                        backgroundColor: pending ? palette.warningMuted : palette.accentMuted,
                      }}
                    >
                      {/* Short bookings get one line with everything on it;
                          clipping a name in half is worse than shortening it. */}
                      {blockHeight < 44 ? (
                        <Text variant="caption" numberOfLines={1}>
                          <Text
                            variant="caption"
                            style={{
                              fontWeight: '700',
                              color: pending ? palette.warning : palette.accent,
                            }}
                          >
                            {badge.mark} {format.clock(appointment.startsAt, timezone)}
                          </Text>
                          {'  '}
                          {appointment.customer.fullName}
                        </Text>
                      ) : (
                        <>
                          <Text
                            variant="caption"
                            numberOfLines={1}
                            style={{
                              fontWeight: '700',
                              color: pending ? palette.warning : palette.accent,
                            }}
                          >
                            {badge.mark} {format.clock(appointment.startsAt, timezone)}
                          </Text>
                          <Text variant="caption" numberOfLines={1}>
                            {appointment.customer.fullName}
                          </Text>
                          {blockHeight > 62 && (
                            <Text variant="caption" tone="muted" numberOfLines={1}>
                              {appointment.items[0]?.name ?? ''}
                            </Text>
                          )}
                        </>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
