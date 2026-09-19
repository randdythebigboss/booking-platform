import { computeAvailableSlots } from './slots';
import type {
  BookingPolicy,
  BusyPeriod,
  DateException,
  ServiceTiming,
  Slot,
  WeeklyRule,
} from './types';

import type { AvailabilityExceptionType, IsoDate, Weekday } from '@/types/domain';

/** Everything needed to compute slots for one professional and one service. */
export interface AvailabilityContext {
  timezone: string;
  policy: BookingPolicy;
  service: ServiceTiming & { id: string; name: string; price: number; currency: string };
  rules: WeeklyRule[];
  exceptions: DateException[];
  busy: BusyPeriod[];
}

export class MalformedAvailabilityContextError extends Error {
  constructor(field: string) {
    super(`Availability context is missing or malformed: ${field}.`);
    this.name = 'MalformedAvailabilityContextError';
  }
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MalformedAvailabilityContextError(field);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new MalformedAvailabilityContextError(field);
  return value;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new MalformedAvailabilityContextError(field);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new MalformedAvailabilityContextError(field);
  }
  return parsed;
}

function asDate(value: unknown, field: string): Date {
  const parsed = new Date(asString(value, field));
  if (Number.isNaN(parsed.getTime())) throw new MalformedAvailabilityContextError(field);
  return parsed;
}

/**
 * Converts the JSON returned by `public.get_availability_context` into the
 * shapes the engine expects. Written defensively: this is a trust boundary,
 * even though the other side is our own database function.
 */
export function parseAvailabilityContext(raw: unknown): AvailabilityContext {
  const root = asRecord(raw, 'root');
  const policy = asRecord(root.policy, 'policy');
  const service = asRecord(root.service, 'service');

  return {
    timezone: asString(root.timezone, 'timezone'),
    policy: {
      slotIntervalMinutes: asNumber(policy.slotIntervalMinutes, 'policy.slotIntervalMinutes'),
      minimumNoticeMinutes: asNumber(policy.minimumNoticeMinutes, 'policy.minimumNoticeMinutes'),
      bookingHorizonDays: asNumber(policy.bookingHorizonDays, 'policy.bookingHorizonDays'),
    },
    service: {
      id: asString(service.id, 'service.id'),
      name: asString(service.name, 'service.name'),
      durationMinutes: asNumber(service.durationMinutes, 'service.durationMinutes'),
      bufferBeforeMinutes: asNumber(service.bufferBeforeMinutes, 'service.bufferBeforeMinutes'),
      bufferAfterMinutes: asNumber(service.bufferAfterMinutes, 'service.bufferAfterMinutes'),
      price: asNumber(service.price, 'service.price'),
      currency: asString(service.currency, 'service.currency'),
    },
    rules: asArray(root.rules, 'rules').map((entry, index) => {
      const rule = asRecord(entry, `rules[${index}]`);
      return {
        weekday: asNumber(rule.weekday, `rules[${index}].weekday`) as Weekday,
        startTime: asString(rule.startTime, `rules[${index}].startTime`),
        endTime: asString(rule.endTime, `rules[${index}].endTime`),
        effectiveFrom: (rule.effectiveFrom as IsoDate | null) ?? null,
        effectiveUntil: (rule.effectiveUntil as IsoDate | null) ?? null,
      };
    }),
    exceptions: asArray(root.exceptions, 'exceptions').map((entry, index) => {
      const exception = asRecord(entry, `exceptions[${index}]`);
      return {
        date: asString(exception.date, `exceptions[${index}].date`),
        type: asString(exception.type, `exceptions[${index}].type`) as AvailabilityExceptionType,
        startTime: (exception.startTime as string | null) ?? null,
        endTime: (exception.endTime as string | null) ?? null,
      };
    }),
    busy: asArray(root.busy, 'busy').map((entry, index) => {
      const period = asRecord(entry, `busy[${index}]`);
      return {
        startsAt: asDate(period.startsAt, `busy[${index}].startsAt`),
        endsAt: asDate(period.endsAt, `busy[${index}].endsAt`),
      };
    }),
  };
}

/** Slots for one date, derived entirely from an already-fetched context. */
export function slotsForDate(
  context: AvailabilityContext,
  date: IsoDate,
  now: Date = new Date(),
): Slot[] {
  return computeAvailableSlots({
    date,
    timezone: context.timezone,
    service: context.service,
    rules: context.rules,
    exceptions: context.exceptions,
    busy: context.busy,
    policy: context.policy,
    now,
  });
}
