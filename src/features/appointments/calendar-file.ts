import type { AppointmentStatus } from '@/types/domain';

/**
 * An appointment as a calendar file, which is the one reminder this product
 * can honestly promise today.
 *
 * ---------------------------------------------------------------------------
 * What this is, and what it is emphatically not
 * ---------------------------------------------------------------------------
 *
 * The field test asked to be reminded 15 or 30 minutes before an appointment.
 * We cannot deliver a push notification to a closed phone (docs/DECISIONS/0024
 * says why, and what would change it), and we will not ship a switch that
 * claims we can.
 *
 * What we can do is hand the appointment to the calendar application the
 * person already trusts, with the alarm already set. After that the reminder
 * belongs to their calendar, not to us:
 *
 *   - if they delete the event, no reminder arrives and we never know;
 *   - if we cancel the appointment, their calendar does not find out unless
 *     they import the cancellation this file can also express;
 *   - an alarm is a REQUEST. iOS, Android and Outlook each honour VALARM
 *     differently, and some ignore it entirely for imported events.
 *
 * So a downloaded file is not proof that anybody will be reminded, and the
 * copy around this feature has to say so.
 *
 * ---------------------------------------------------------------------------
 * Identity, so a second download corrects rather than duplicates
 * ---------------------------------------------------------------------------
 *
 * `UID` is derived from the appointment id and never changes. `SEQUENCE`
 * increases every time the appointment is rescheduled. Together they are what
 * lets a calendar treat the second file as an UPDATE to the first: without a
 * stable UID a rescheduled appointment quietly becomes two events, which is
 * exactly the stale-reminder problem this was meant to avoid.
 *
 * A cancelled appointment is expressed as `STATUS:CANCELLED` with the same
 * UID, so importing it removes the event instead of adding a second one.
 */

const PRODID = '-//Booking Platform//Appointment//EN';

export interface CalendarEventInput {
  /** The appointment's own id. Becomes the immutable UID. */
  appointmentId: string;
  startsAt: Date;
  endsAt: Date;
  /** What the customer booked, e.g. "Corte de cabello". */
  serviceName: string;
  businessName: string;
  location?: string | null;
  /** Minutes before the start to ask for an alarm. 0 or null asks for none. */
  reminderMinutes?: number | null;
  status: AppointmentStatus;
  /** Bumped on every reschedule so calendars accept the newer file. */
  sequence?: number;
  /** Injected in tests; the stamp a calendar uses to order revisions. */
  now?: Date;
}

/** RFC 5545 escaping: backslash, semicolon, comma and newline, in that order. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** UTC basic format, which needs no VTIMEZONE and cannot be misread. */
function toUtcStamp(date: Date): string {
  return `${date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')}`;
}

/**
 * Folds a line to 75 octets, as the specification requires.
 *
 * Counted in OCTETS, not characters: an accented name in a Spanish service
 * title is two bytes, and folding by character length produces lines that are
 * legal to us and too long for a strict parser.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines start with a space, which costs one of the 75.
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  if (current) out.push(current);
  return out.map((part, index) => (index === 0 ? part : ` ${part}`)).join('\r\n');
}

/** Builds the iCalendar text for one appointment. CRLF throughout, per RFC. */
export function buildAppointmentIcs(input: CalendarEventInput): string {
  const {
    appointmentId,
    startsAt,
    endsAt,
    serviceName,
    businessName,
    location,
    reminderMinutes,
    status,
    sequence = 0,
    now = new Date(),
  } = input;

  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime())) {
    throw new Error('startsAt must be a valid Date');
  }
  if (!(endsAt instanceof Date) || Number.isNaN(endsAt.getTime())) {
    throw new Error('endsAt must be a valid Date');
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new Error('endsAt must be after startsAt');
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    // A cancelled appointment is published as a cancellation, so importing it
    // withdraws the event that is already in the calendar.
    status === 'cancelled' ? 'METHOD:CANCEL' : 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${appointmentId}@booking-platform`,
    `SEQUENCE:${Math.max(0, Math.trunc(sequence))}`,
    `DTSTAMP:${toUtcStamp(now)}`,
    `DTSTART:${toUtcStamp(startsAt)}`,
    `DTEND:${toUtcStamp(endsAt)}`,
    fold(`SUMMARY:${escapeText(serviceName)} - ${escapeText(businessName)}`),
    `STATUS:${status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
  ];

  if (location && location.trim()) {
    lines.push(fold(`LOCATION:${escapeText(location.trim())}`));
  }

  // No alarm on a cancellation: the point of that file is to remove the event.
  if (status !== 'cancelled' && reminderMinutes && reminderMinutes > 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      fold(`DESCRIPTION:${escapeText(serviceName)}`),
      `TRIGGER:-PT${Math.trunc(reminderMinutes)}M`,
      'END:VALARM',
    );
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

/** A filename a person can recognise in their downloads folder. */
export function icsFileName(serviceName: string, startsAt: Date): string {
  const day = startsAt.toISOString().slice(0, 10);
  const slug = serviceName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${slug || 'cita'}-${day}.ics`;
}
