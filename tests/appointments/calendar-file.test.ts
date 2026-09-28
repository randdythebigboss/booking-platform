/**
 * The calendar file is the only reminder this product can honestly offer, so
 * it has to be a correct one. These check the parts a calendar application
 * will actually reject or misread: line endings, escaping, folding by octets,
 * UTC stamps, and the identity that makes a second download an update rather
 * than a duplicate.
 */
import { describe, expect, it } from 'vitest';

import { buildAppointmentIcs, icsFileName } from '@/features/appointments/calendar-file';

const BASE = {
  appointmentId: '11111111-2222-3333-4444-555555555555',
  startsAt: new Date('2026-10-05T14:30:00.000Z'),
  endsAt: new Date('2026-10-05T15:00:00.000Z'),
  serviceName: 'Corte de cabello',
  businessName: 'NombreBarberia',
  status: 'confirmed' as const,
  now: new Date('2026-10-01T09:00:00.000Z'),
};

const linesOf = (ics: string) => ics.split('\r\n');

describe('the appointment calendar file', () => {
  it('is CRLF throughout, which the specification requires', () => {
    const ics = buildAppointmentIcs(BASE);
    expect(ics.includes('\r\n')).toBe(true);
    // No bare newline anywhere: a lone \n is the classic reason Outlook refuses.
    expect(/[^\r]\n/.test(ics)).toBe(false);
    expect(ics.endsWith('\r\n')).toBe(true);
  });

  it('opens and closes as one calendar with one event', () => {
    const lines = linesOf(buildAppointmentIcs(BASE));
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('BEGIN:VEVENT');
    expect(lines).toContain('END:VEVENT');
    expect(lines.at(-2)).toBe('END:VCALENDAR');
  });

  it('writes the start and end in UTC, so no timezone can be misread', () => {
    const lines = linesOf(buildAppointmentIcs(BASE));
    expect(lines).toContain('DTSTART:20261005T143000Z');
    expect(lines).toContain('DTEND:20261005T150000Z');
  });

  it('keeps the same UID whatever else changes, so a reschedule updates', () => {
    const first = buildAppointmentIcs(BASE);
    const moved = buildAppointmentIcs({
      ...BASE,
      startsAt: new Date('2026-10-06T16:00:00.000Z'),
      endsAt: new Date('2026-10-06T16:30:00.000Z'),
      sequence: 1,
    });
    const uid = `UID:${BASE.appointmentId}@booking-platform`;
    expect(linesOf(first)).toContain(uid);
    expect(linesOf(moved)).toContain(uid);
    expect(linesOf(first)).toContain('SEQUENCE:0');
    expect(linesOf(moved)).toContain('SEQUENCE:1');
    expect(linesOf(moved)).toContain('DTSTART:20261006T160000Z');
  });

  it('asks for the alarm the professional chose', () => {
    const lines = linesOf(buildAppointmentIcs({ ...BASE, reminderMinutes: 30 }));
    expect(lines).toContain('BEGIN:VALARM');
    expect(lines).toContain('TRIGGER:-PT30M');
    expect(lines).toContain('ACTION:DISPLAY');
  });

  it('asks for no alarm when the lead time is zero or absent', () => {
    expect(buildAppointmentIcs({ ...BASE, reminderMinutes: 0 })).not.toContain('VALARM');
    expect(buildAppointmentIcs({ ...BASE, reminderMinutes: null })).not.toContain('VALARM');
    expect(buildAppointmentIcs(BASE)).not.toContain('VALARM');
  });

  it('publishes a cancellation that withdraws the event rather than adding one', () => {
    const lines = linesOf(
      buildAppointmentIcs({ ...BASE, status: 'cancelled', reminderMinutes: 30, sequence: 2 }),
    );
    expect(lines).toContain('METHOD:CANCEL');
    expect(lines).toContain('STATUS:CANCELLED');
    expect(lines).toContain(`UID:${BASE.appointmentId}@booking-platform`);
    // A cancellation carrying an alarm would be a stale reminder in a file.
    expect(lines).not.toContain('BEGIN:VALARM');
  });

  it('escapes the characters that would otherwise end a property early', () => {
    const lines = linesOf(
      buildAppointmentIcs({
        ...BASE,
        serviceName: 'Corte, barba; y toalla\\caliente',
        location: 'Av. Churchill 1, Local 2\nSanto Domingo',
      }),
    );
    const summary = lines.find((line) => line.startsWith('SUMMARY:'))!;
    expect(summary).toContain('Corte\\, barba\\; y toalla\\\\caliente');
    const location = lines.filter((line) => line.startsWith('LOCATION:') || line.startsWith(' '));
    expect(location.join('')).toContain('\\n');
  });

  it('folds long lines to 75 octets, counting accents as the two bytes they are', () => {
    const ics = buildAppointmentIcs({
      ...BASE,
      serviceName: 'Sesión de coloración y mechas con tratamiento de queratina á la maison',
      businessName: 'Peluquería y Estética Doña Begoña del Camino Real',
    });
    const encoder = new TextEncoder();
    for (const line of linesOf(ics)) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    // And the content survives the fold: unfolding restores the words.
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('queratina');
    expect(unfolded).toContain('Bego');
  });

  it('refuses a range that is not a range', () => {
    expect(() => buildAppointmentIcs({ ...BASE, endsAt: BASE.startsAt })).toThrow();
    expect(() =>
      buildAppointmentIcs({ ...BASE, endsAt: new Date('2026-10-05T14:00:00.000Z') }),
    ).toThrow();
    expect(() => buildAppointmentIcs({ ...BASE, startsAt: new Date('nope') })).toThrow();
  });

  it('names the file after the service and the day', () => {
    expect(icsFileName('Corte de cabello', BASE.startsAt)).toBe('corte-de-cabello-2026-10-05.ics');
    expect(icsFileName('Sesión & Color', BASE.startsAt)).toBe('sesion-color-2026-10-05.ics');
    expect(icsFileName('', BASE.startsAt)).toBe('cita-2026-10-05.ics');
  });

  it('omits the location when there is not one', () => {
    expect(buildAppointmentIcs({ ...BASE, location: '   ' })).not.toContain('LOCATION:');
    expect(buildAppointmentIcs({ ...BASE, location: null })).not.toContain('LOCATION:');
  });
});
