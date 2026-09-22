import { describe, expect, it } from 'vitest';

import {
  MalformedConfirmationError,
  describeStatus,
  parseGuestAppointment,
} from '@/features/booking';

const RAW = {
  appointmentId: 'apt-1',
  professionalId: 'pro-1',
  serviceId: 'svc-1',
  status: 'confirmed',
  startsAt: '2026-09-28T13:00:00+00:00',
  endsAt: '2026-09-28T13:45:00+00:00',
  timezone: 'America/Santo_Domingo',
  businessName: 'Demo Studio',
  businessSlug: 'demo-studio',
  businessPhone: '+1 809 555 0100',
  businessAddress: 'Av. Winston Churchill 1',
  professionalName: 'Alex Rivera',
  customerName: 'Maria Peralta',
  items: [{ name: 'Haircut + Beard', durationMinutes: 45, price: '1200.00', currency: 'DOP' }],
  canCancel: true,
  canReschedule: true,
};

describe('parseGuestAppointment', () => {
  it('reads what the token function returns', () => {
    const appointment = parseGuestAppointment(RAW);

    expect(appointment.appointmentId).toBe('apt-1');
    expect(appointment.startsAt.toISOString()).toBe('2026-09-28T13:00:00.000Z');
    expect(appointment.timezone).toBe('America/Santo_Domingo');
    expect(appointment.items[0]?.price).toBe(1200);
    expect(appointment.canCancel).toBe(true);
  });

  it('carries what a guest needs to ask for another time', () => {
    const appointment = parseGuestAppointment(RAW);

    expect(appointment.professionalId).toBe('pro-1');
    expect(appointment.serviceId).toBe('svc-1');
    expect(appointment.canReschedule).toBe(true);
  });

  it('treats a missing reschedule flag as no, never as yes', () => {
    const { canReschedule: _omitted, ...withoutFlag } = RAW;
    expect(parseGuestAppointment(withoutFlag).canReschedule).toBe(false);
  });

  it('survives an appointment whose service has since been removed', () => {
    expect(parseGuestAppointment({ ...RAW, serviceId: null }).serviceId).toBeNull();
  });

  it('tolerates a business with no phone or address', () => {
    const appointment = parseGuestAppointment({
      ...RAW,
      businessPhone: null,
      businessAddress: null,
    });
    expect(appointment.businessPhone).toBeNull();
    expect(appointment.businessAddress).toBeNull();
  });

  it('treats a missing canCancel as "no", never as "yes"', () => {
    const { canCancel: _canCancel, ...rest } = RAW;
    expect(parseGuestAppointment(rest).canCancel).toBe(false);
    expect(parseGuestAppointment({ ...RAW, canCancel: 'yes' }).canCancel).toBe(false);
  });

  it('handles an appointment with no items', () => {
    expect(parseGuestAppointment({ ...RAW, items: [] }).items).toEqual([]);
  });

  it('names the field it could not read', () => {
    expect(() => parseGuestAppointment({ ...RAW, startsAt: 'soon' })).toThrow(
      MalformedConfirmationError,
    );
    expect(() => parseGuestAppointment({ ...RAW, startsAt: 'soon' })).toThrow(/startsAt/);
  });

  it('rejects a response that is not an object', () => {
    expect(() => parseGuestAppointment(null)).toThrow(MalformedConfirmationError);
  });
});

describe('describeStatus', () => {
  it('gives a customer words, not a database enum', () => {
    expect(describeStatus('confirmed')).toBe('Confirmed');
    expect(describeStatus('pending')).toMatch(/Waiting/);
    expect(describeStatus('no_show')).toBe('Missed');
  });
});
