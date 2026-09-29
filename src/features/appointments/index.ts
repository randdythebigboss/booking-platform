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

// calendar-download is deliberately NOT re-exported here: it imports
// `Platform` from react-native, and this barrel is imported by pure domain
// tests that run under node. One re-export and they all fail to parse
// react-native/index.js. Import it by path from the component that needs it.
export {
  buildAppointmentIcs,
  calendarSequence,
  icsFileName,
  type CalendarEventInput,
} from './calendar-file';
