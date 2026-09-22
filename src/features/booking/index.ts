export { BookingError, BOOKING_ERROR_CODES, toBookingError, type BookingErrorCode } from './errors';
export {
  validateCustomer,
  isCustomerComplete,
  countPhoneDigits,
  EMPTY_CUSTOMER,
  type CustomerDraft,
  type CustomerErrors,
} from './customer';
export {
  BOOKING_STEPS,
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
  type BookingStep,
} from './flow';
export {
  parseGuestAppointment,
  guestStatusKey,
  MalformedConfirmationError,
  type GuestAppointment,
  type GuestAppointmentItem,
} from './confirmation';
export {
  confirmationPath,
  tokenFromFragment,
  tokenFromUrl,
  upgradeLegacyTokenUrl,
} from './guest-token';
