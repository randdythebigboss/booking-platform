import { describe, expect, it } from 'vitest';

import {
  EMPTY_SELECTION,
  currentStep,
  isReadyToBook,
  reconcileSlot,
  selectDate,
  selectService,
  selectSlot,
  stepIndex,
  updateCustomer,
  type BookingSelection,
} from '@/features/booking';
import type { Slot } from '@/features/availability';

const SLOT_A = '2026-09-28T13:00:00.000Z';
const SLOT_B = '2026-09-28T13:15:00.000Z';

function slot(iso: string): Slot {
  return { startsAt: new Date(iso), endsAt: new Date(new Date(iso).getTime() + 30 * 60_000) };
}

function complete(): BookingSelection {
  let selection = selectService(EMPTY_SELECTION, 'svc-1');
  selection = selectDate(selection, '2026-09-28');
  selection = selectSlot(selection, SLOT_A);
  return updateCustomer(selection, { fullName: 'Maria Peralta', phone: '+1 809 555 0199' });
}

describe('currentStep', () => {
  it('walks the journey in order', () => {
    let selection = EMPTY_SELECTION;
    expect(currentStep(selection)).toBe('service');

    selection = selectService(selection, 'svc-1');
    expect(currentStep(selection)).toBe('date');

    selection = selectDate(selection, '2026-09-28');
    expect(currentStep(selection)).toBe('slot');

    selection = selectSlot(selection, SLOT_A);
    expect(currentStep(selection)).toBe('details');

    selection = updateCustomer(selection, { fullName: 'Maria Peralta', phone: '+1 809 555 0199' });
    expect(currentStep(selection)).toBe('review');
  });

  it('falls back a step when details become invalid', () => {
    const selection = updateCustomer(complete(), { phone: '' });
    expect(currentStep(selection)).toBe('details');
    expect(isReadyToBook(selection)).toBe(false);
  });
});

describe('selectService', () => {
  it('drops the chosen time, because availability is per service', () => {
    const changed = selectService(complete(), 'svc-2');
    expect(changed.slotStartsAt).toBeNull();
    expect(changed.date).toBe('2026-09-28');
    expect(currentStep(changed)).toBe('slot');
  });

  it('keeps the selection untouched when the service does not change', () => {
    const selection = complete();
    expect(selectService(selection, 'svc-1')).toBe(selection);
  });
});

describe('selectDate', () => {
  it('drops the chosen time', () => {
    const changed = selectDate(complete(), '2026-09-29');
    expect(changed.slotStartsAt).toBeNull();
    expect(changed.serviceId).toBe('svc-1');
  });

  it('is a no-op for the same date', () => {
    const selection = complete();
    expect(selectDate(selection, '2026-09-28')).toBe(selection);
  });
});

describe('reconcileSlot', () => {
  it('keeps a slot the backend still offers', () => {
    const selection = complete();
    expect(reconcileSlot(selection, [slot(SLOT_A), slot(SLOT_B)]).slotStartsAt).toBe(SLOT_A);
  });

  it('drops a slot that has disappeared', () => {
    const selection = complete();
    const reconciled = reconcileSlot(selection, [slot(SLOT_B)]);
    expect(reconciled.slotStartsAt).toBeNull();
    expect(currentStep(reconciled)).toBe('slot');
  });

  it('drops the slot when nothing is available at all', () => {
    expect(reconcileSlot(complete(), []).slotStartsAt).toBeNull();
  });

  it('does nothing when no slot was chosen', () => {
    const selection = selectDate(selectService(EMPTY_SELECTION, 'svc-1'), '2026-09-28');
    expect(reconcileSlot(selection, [])).toBe(selection);
  });

  it('preserves the customer details while recovering', () => {
    const reconciled = reconcileSlot(complete(), []);
    expect(reconciled.customer.fullName).toBe('Maria Peralta');
  });
});

describe('stepIndex', () => {
  it('orders the journey for a progress indicator', () => {
    expect(stepIndex('service')).toBe(0);
    expect(stepIndex('review')).toBe(4);
  });
});
