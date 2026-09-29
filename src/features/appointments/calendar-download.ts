import { Platform } from 'react-native';

import { buildAppointmentIcs, icsFileName, type CalendarEventInput } from './calendar-file';

/**
 * Handing the finished .ics to whatever the person uses as a calendar.
 *
 * ---------------------------------------------------------------------------
 * Why this is web only, and says so
 * ---------------------------------------------------------------------------
 *
 * The deployed product is a web export on GitHub Pages. Saving a file on a
 * native build needs `expo-file-system` and `expo-sharing`, and adding two
 * dependencies for a target nothing ships to would be paying for a feature
 * nobody can use. So the button asks first -- `canDownloadCalendarFile()` --
 * and is simply absent where the answer is no, rather than present and dead.
 *
 * ---------------------------------------------------------------------------
 * What Booking Platform does and does not do
 * ---------------------------------------------------------------------------
 *
 * It writes a file. The reminder inside that file is an instruction to the
 * calendar application, and it is that application -- not this one -- that
 * decides whether an alarm actually goes off, and honours it only after the
 * event has been imported. Nothing here is a push notification and the copy
 * beside the button says so. See ADR 0024.
 */

/** Minutes before the appointment that the calendar is asked to alarm. */
export const REMINDER_CHOICES = [15, 30] as const;
export type ReminderChoice = (typeof REMINDER_CHOICES)[number];

export function canDownloadCalendarFile(): boolean {
  return Platform.OS === 'web' && typeof document !== 'undefined';
}

/**
 * Builds the file and asks the browser to save it.
 *
 * Returns the file name so a caller can say what happened; throws only if the
 * event itself is impossible to describe, which `buildAppointmentIcs` already
 * refuses to do quietly.
 */
export function downloadAppointmentIcs(input: CalendarEventInput): string {
  const ics = buildAppointmentIcs(input);
  const name = icsFileName(input.serviceName, input.startsAt);

  if (!canDownloadCalendarFile()) {
    throw new Error('Saving a calendar file is only available on the web build.');
  }

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  // Some browsers refuse a click on an element that is not in the document.
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Freeing it immediately races the download in Safari; a tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return name;
}
