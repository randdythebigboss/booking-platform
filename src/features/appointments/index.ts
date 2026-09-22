export {
  ALLOWED_TRANSITIONS,
  BLOCKING_STATUSES,
  availableActions,
  canTransition,
  isTerminal,
  statusLabel,
  statusTone,
  type AppointmentAction,
  type StatusTone,
} from './lifecycle';

export {
  APPOINTMENT_ACTOR_TYPES,
  APPOINTMENT_EVENT_TYPES,
  actorLabel,
  describeEvent,
  rescheduleCount,
  sortEvents,
  type AppointmentActorType,
  type AppointmentEvent,
  type AppointmentEventType,
} from './history';
