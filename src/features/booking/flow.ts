import type { Slot } from '@/features/availability';
import type { IsoDate } from '@/types/domain';

import { EMPTY_CUSTOMER, isCustomerComplete, type CustomerDraft } from './customer';

/**
 * The guest booking journey, as data.
 *
 * Keeping the step logic here rather than in the screen means the awkward
 * parts -- a slot that stops existing while the customer is typing, a service
 * change that invalidates the chosen time -- are testable without a browser.
 */
export type BookingStep = 'service' | 'date' | 'slot' | 'details' | 'review';

export const BOOKING_STEPS: BookingStep[] = ['service', 'date', 'slot', 'details', 'review'];

export interface BookingSelection {
  serviceId: string | null;
  date: IsoDate | null;
  /** ISO instant of the chosen slot, exactly as the backend returned it. */
  slotStartsAt: string | null;
  customer: CustomerDraft;
}

export const EMPTY_SELECTION: BookingSelection = {
  serviceId: null,
  date: null,
  slotStartsAt: null,
  customer: EMPTY_CUSTOMER,
};

/** Availability differs per service, so the chosen time cannot survive. */
export function selectService(
  selection: BookingSelection,
  serviceId: string,
): BookingSelection {
  if (selection.serviceId === serviceId) return selection;
  return { ...selection, serviceId, slotStartsAt: null };
}

export function selectDate(selection: BookingSelection, date: IsoDate): BookingSelection {
  if (selection.date === date) return selection;
  return { ...selection, date, slotStartsAt: null };
}

export function selectSlot(selection: BookingSelection, slotStartsAt: string): BookingSelection {
  return { ...selection, slotStartsAt };
}

export function updateCustomer(
  selection: BookingSelection,
  patch: Partial<CustomerDraft>,
): BookingSelection {
  return { ...selection, customer: { ...selection.customer, ...patch } };
}

/**
 * Drops a chosen slot that the backend no longer offers.
 *
 * Someone else booking that time, a block appearing, or simply leaving the
 * page open long enough for minimum notice to pass all lead here. The backend
 * would refuse the booking anyway; this is what stops the customer reaching
 * the review step with a time that is already gone.
 */
export function reconcileSlot(
  selection: BookingSelection,
  available: readonly Slot[],
): BookingSelection {
  if (!selection.slotStartsAt) return selection;

  const stillOffered = available.some(
    (slot) => slot.startsAt.toISOString() === selection.slotStartsAt,
  );

  return stillOffered ? selection : { ...selection, slotStartsAt: null };
}

/** The furthest step the current selection has earned. */
export function currentStep(selection: BookingSelection): BookingStep {
  if (!selection.serviceId) return 'service';
  if (!selection.date) return 'date';
  if (!selection.slotStartsAt) return 'slot';
  if (!isCustomerComplete(selection.customer)) return 'details';
  return 'review';
}

export function isReadyToBook(selection: BookingSelection): boolean {
  return currentStep(selection) === 'review';
}

/** Position in the journey, for a progress line that means something. */
export function stepIndex(step: BookingStep): number {
  return BOOKING_STEPS.indexOf(step);
}
