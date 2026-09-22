import { describe, expect, it } from 'vitest';

import {
  ALLOWED_TRANSITIONS,
  availableActions,
  canTransition,
  isTerminal,
  statusLabelKey,
  statusTone,
} from '@/features/appointments';
import { APPOINTMENT_STATUSES } from '@/types/domain';

const PAST = new Date('2026-09-22T13:00:00.000Z');
const FUTURE = new Date('2026-09-30T13:00:00.000Z');
const NOW = new Date('2026-09-25T12:00:00.000Z');

describe('canTransition', () => {
  it('allows a pending appointment to be confirmed or cancelled', () => {
    expect(canTransition('pending', 'confirmed')).toBe(true);
    expect(canTransition('pending', 'cancelled')).toBe(true);
  });

  it('allows a confirmed appointment to reach every outcome', () => {
    expect(canTransition('confirmed', 'completed')).toBe(true);
    expect(canTransition('confirmed', 'no_show')).toBe(true);
    expect(canTransition('confirmed', 'cancelled')).toBe(true);
  });

  it('refuses to skip confirmation', () => {
    expect(canTransition('pending', 'completed')).toBe(false);
    expect(canTransition('pending', 'no_show')).toBe(false);
  });

  it('refuses to un-cancel, because the time may already belong to someone else', () => {
    expect(canTransition('cancelled', 'confirmed')).toBe(false);
    expect(canTransition('cancelled', 'pending')).toBe(false);
  });

  it('treats completed and no-show as final', () => {
    for (const status of APPOINTMENT_STATUSES) {
      expect(canTransition('completed', status)).toBe(false);
      expect(canTransition('no_show', status)).toBe(false);
    }
  });

  it('refuses a transition to the same status', () => {
    expect(canTransition('confirmed', 'confirmed')).toBe(false);
  });
});

describe('isTerminal', () => {
  it('names exactly the three end states', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('no_show')).toBe(true);
    expect(isTerminal('pending')).toBe(false);
    expect(isTerminal('confirmed')).toBe(false);
  });
});

describe('availableActions', () => {
  it('offers confirm and cancel on a pending appointment', () => {
    const actions = availableActions('pending', FUTURE, NOW).map((a) => a.status);
    expect(actions).toEqual(['confirmed', 'cancelled']);
  });

  it('will not offer completed or no-show before the appointment starts', () => {
    const actions = availableActions('confirmed', FUTURE, NOW).map((a) => a.status);
    expect(actions).toEqual(['cancelled']);
  });

  it('offers the full set once it has started', () => {
    const actions = availableActions('confirmed', PAST, NOW).map((a) => a.status);
    expect(actions).toEqual(['completed', 'no_show', 'cancelled']);
  });

  it('offers nothing on a terminal appointment', () => {
    expect(availableActions('completed', PAST, NOW)).toEqual([]);
    expect(availableActions('cancelled', PAST, NOW)).toEqual([]);
    expect(availableActions('no_show', PAST, NOW)).toEqual([]);
  });

  it('marks the actions a professional should think twice about', () => {
    const actions = availableActions('confirmed', PAST, NOW);
    const destructive = actions.filter((a) => a.destructive).map((a) => a.status);
    expect(destructive).toEqual(['no_show', 'cancelled']);
  });

  it('never offers a transition the graph forbids', () => {
    for (const status of APPOINTMENT_STATUSES) {
      for (const action of availableActions(status, PAST, NOW)) {
        expect(ALLOWED_TRANSITIONS[status]).toContain(action.status);
        expect(action.labelKey).toBe(`appointments.action_${action.status}`);
      }
    }
  });
});

describe('statusLabelKey and statusTone', () => {
  it('gives every status a key and a tone', () => {
    for (const status of APPOINTMENT_STATUSES) {
      // A key, never a word: 'no_show' is a database enum and the domain has
      // no business deciding whether it reads 'No-show' or 'No asistió'.
      expect(statusLabelKey(status)).toBe(`appointments.status_${status}`);
      expect(['default', 'muted', 'accent', 'danger', 'success']).toContain(statusTone(status));
    }
  });

  it('reads the two that need attention as danger', () => {
    expect(statusTone('cancelled')).toBe('danger');
    expect(statusTone('no_show')).toBe('danger');
    expect(statusTone('confirmed')).toBe('success');
  });
});
