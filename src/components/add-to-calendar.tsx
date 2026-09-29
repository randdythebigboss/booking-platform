import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Feedback, Segmented, Text } from '@/components/ui';
import { calendarSequence } from '@/features/appointments';
import {
  REMINDER_CHOICES,
  canDownloadCalendarFile,
  downloadAppointmentIcs,
  type ReminderChoice,
} from '@/features/appointments/calendar-download';
import { spacing } from '@/theme';
import type { AppointmentStatus } from '@/types/domain';

export interface AddToCalendarProps {
  appointmentId: string;
  startsAt: Date;
  endsAt: Date;
  serviceName: string;
  businessName: string;
  location?: string | null;
  status: AppointmentStatus;
  /** From the appointment's `updated_at`; makes a second download supersede the first. */
  updatedAt?: Date | null;
}

/**
 * "Add to calendar", and the honest sentence underneath it.
 *
 * ---------------------------------------------------------------------------
 * Why the reminder is a choice and not a setting
 * ---------------------------------------------------------------------------
 *
 * Fifteen minutes is right for somebody who works next door and wrong for
 * somebody who drives. It is two taps either way and it belongs to the person
 * downloading the file, not to the business, so it is asked here and stored
 * nowhere.
 *
 * ---------------------------------------------------------------------------
 * What it promises
 * ---------------------------------------------------------------------------
 *
 * Exactly one thing: a file. The alarm is the calendar application's to ring,
 * and only once the event has been imported. The caption says that rather than
 * letting somebody infer that Booking Platform will be reminding them, which
 * it will not -- there is no push delivery and ADR 0024 explains why.
 *
 * A cancelled appointment still offers the file, and that file is a
 * cancellation: importing it withdraws the event somebody already has. That is
 * more useful than hiding the button and leaving a stale entry in their week.
 */
export function AddToCalendar({
  appointmentId,
  startsAt,
  endsAt,
  serviceName,
  businessName,
  location,
  status,
  updatedAt,
}: AddToCalendarProps) {
  const { t } = useTranslation();
  const [reminder, setReminder] = useState<ReminderChoice>(REMINDER_CHOICES[0]);
  const [saved, setSaved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  if (!canDownloadCalendarFile()) return null;

  const cancelled = status === 'cancelled';

  function save() {
    setFailed(false);
    try {
      const name = downloadAppointmentIcs({
        appointmentId,
        startsAt,
        endsAt,
        serviceName,
        businessName,
        location,
        status,
        reminderMinutes: cancelled ? null : reminder,
        sequence: calendarSequence(updatedAt),
      });
      setSaved(name);
    } catch {
      setFailed(true);
    }
  }

  return (
    <View
      style={{ gap: spacing.sm }}
      // A handle for the browser suite: the block has no text of its own that
      // does not also appear elsewhere on the page.
      {...({ dataSet: { addToCalendar: 'true' } } as object)}
    >
      <Text variant="label">{t('calendarFile.title')}</Text>

      {!cancelled && (
        <Segmented
          label={t('calendarFile.reminderLabel')}
          value={String(reminder)}
          onChange={(next) => setReminder(Number(next) as ReminderChoice)}
          options={REMINDER_CHOICES.map((minutes) => ({
            value: String(minutes),
            label: t('calendarFile.reminderMinutes', { count: minutes }),
          }))}
        />
      )}

      <Button
        label={cancelled ? t('calendarFile.downloadCancel') : t('calendarFile.download')}
        variant="secondary"
        onPress={save}
      />

      {saved && <Feedback tone="success" message={t('calendarFile.saved', { file: saved })} />}
      {failed && <Feedback tone="danger" message={t('calendarFile.failed')} />}

      <Text variant="caption" tone="muted">
        {cancelled ? t('calendarFile.cancelNote') : t('calendarFile.alarmNote')}
      </Text>
    </View>
  );
}
