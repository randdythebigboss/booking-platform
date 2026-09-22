export {
  ALLOWED_TRANSITIONS,
  BLOCKING_STATUSES,
  availableActions,
  canTransition,
  isTerminal,
  statusLabelKey,
  statusTone,
  type AppointmentAction,
  type StatusTone,
} from './lifecycle';

export {
  APPOINTMENT_ACTOR_TYPES,
  APPOINTMENT_EVENT_TYPES,
  describeEvent,
  rescheduleCount,
  sortEvents,
  type AppointmentActorType,
  type AppointmentEvent,
  type AppointmentEventType,
  type EventDescription,
} from './history';
