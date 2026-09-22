import { formatDateIn, formatMoney, formatTimeIn } from '@/lib/format';
import { INTL_LOCALES, resolveLocale, type Locale } from '@/locales';

import type { NotificationMessage, NotificationPayload, TemplateKey } from './types';

/**
 * What a customer is actually told, in the language they booked in.
 *
 * Deliberately not the interface dictionary. A screen says "Confirmada" next
 * to a badge; a message has to greet somebody, say which business it is from
 * and stand on its own in an inbox a week later. Sharing the strings would
 * force one of the two to read badly, so the registry is separate and the
 * tone is its own.
 *
 * Spanish is the source, as everywhere else in this product (ADR 0017). The
 * English record is typed against the Spanish one, so a template that exists
 * in one language and not the other is a compile error rather than a message
 * that silently goes out in the wrong language.
 *
 * Two independent rules, exactly as in the interface:
 *
 *   * the **locale** is the reader's -- the one frozen on the appointment;
 *   * the **timezone** is the business's -- the appointment happens when it
 *     happens, and no reader's device moves it.
 */

export interface TemplateContext extends NotificationPayload {
  locale: Locale;
}

type Template = (context: TemplateContext) => NotificationMessage;

function when(context: TemplateContext): string {
  const instant = new Date(context.startsAt);
  const intl = INTL_LOCALES[context.locale];
  return `${formatDateIn(instant, context.timezone, intl)}, ${formatTimeIn(
    instant,
    context.timezone,
    intl,
  )}`;
}

/** What was paid, when anything was. Formatted, never added up. */
function howMuch(context: TemplateContext): string {
  if (!context.amount || !context.currency) return '';
  return formatMoney(context.amount, context.currency, INTL_LOCALES[context.locale]);
}

/** The service and the person, when the booking recorded them. */
function what(context: TemplateContext, joiner: string): string {
  const parts = [context.serviceName, context.professionalName].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  );
  return parts.join(joiner);
}

const es: Record<TemplateKey, Template> = {
  'booking.confirmed': (context) => ({
    subject: `Tu cita en ${context.businessName} está confirmada`,
    body: [
      `Hola ${context.customerName}:`,
      '',
      `Tu cita en ${context.businessName} quedó confirmada.`,
      '',
      what(context, ' con ') ? `Servicio: ${what(context, ' con ')}` : null,
      `Cuándo: ${when(context)} (${context.timezone})`,
      '',
      'Si necesitas moverla o cancelarla, usa el enlace que guardaste al reservar.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  }),

  'booking.rescheduled': (context) => ({
    subject: `Tu cita en ${context.businessName} cambió de hora`,
    body: [
      `Hola ${context.customerName}:`,
      '',
      `Tu cita en ${context.businessName} quedó para otra hora.`,
      '',
      what(context, ' con ') ? `Servicio: ${what(context, ' con ')}` : null,
      `Nueva hora: ${when(context)} (${context.timezone})`,
      '',
      'Si esa hora no te sirve, puedes volver a moverla desde tu enlace.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  }),

  'booking.cancelled': (context) => ({
    subject: `Tu cita en ${context.businessName} fue cancelada`,
    body: [
      `Hola ${context.customerName}:`,
      '',
      `Tu cita del ${when(context)} en ${context.businessName} fue cancelada.`,
      '',
      'Si fue un error o quieres otra hora, puedes reservar de nuevo cuando quieras.',
    ].join('\n'),
  }),

  'booking.reminder': (context) => ({
    subject: `Recordatorio: tu cita en ${context.businessName}`,
    body: [
      `Hola ${context.customerName}:`,
      '',
      `Te recordamos tu cita en ${context.businessName}.`,
      '',
      what(context, ' con ') ? `Servicio: ${what(context, ' con ')}` : null,
      `Cuándo: ${when(context)} (${context.timezone})`,
      '',
      'Si no puedes asistir, avísanos desde tu enlace de reserva.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  }),
'payment.received': (context) => ({
    subject: `Recibimos tu pago para ${context.businessName}`,
    body: [
      `Hola ${context.customerName}:`,
      '',
      `Recibimos tu pago de ${howMuch(context)}.`,
      '',
      what(context, ' con ') ? `Servicio: ${what(context, ' con ')}` : null,
      `Cuándo: ${when(context)} (${context.timezone})`,
      '',
      'Guarda este correo como comprobante.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  }),

  'payment.failed': (context) => ({
    subject: `No pudimos procesar tu pago para ${context.businessName}`,
    body: [
      `Hola ${context.customerName}:`,
      '',
      'El pago no se completó, así que tu cita todavía no está pagada.',
      '',
      `Cuándo: ${when(context)} (${context.timezone})`,
      '',
      'Puedes intentarlo de nuevo desde tu enlace de reserva.',
    ].join('\n'),
  }),

  'payment.refunded': (context) => ({
    subject: `Te devolvimos tu pago de ${context.businessName}`,
    body: [
      `Hola ${context.customerName}:`,
      '',
      `Reembolsamos ${howMuch(context)}.`,
      '',
      'Según tu banco, puede tardar unos días en aparecer.',
    ].join('\n'),
  }),

  'professional.booking_created': (context) => ({
    subject: `Reserva nueva: ${context.customerName}`,
    body: [
      `${context.customerName} reservó una cita.`,
      '',
      what(context, ' con ') ? `Servicio: ${what(context, ' con ')}` : null,
      `Cuándo: ${when(context)} (${context.timezone})`,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  }),

  'professional.booking_rescheduled': (context) => ({
    subject: `${context.customerName} cambió su cita de hora`,
    body: [
      `${context.customerName} movió su cita.`,
      '',
      what(context, ' con ') ? `Servicio: ${what(context, ' con ')}` : null,
      `Nueva hora: ${when(context)} (${context.timezone})`,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  }),

  'professional.booking_cancelled': (context) => ({
    subject: `${context.customerName} canceló su cita`,
    body: [
      `${context.customerName} canceló la cita del ${when(context)}.`,
      '',
      'Esa hora vuelve a estar disponible.',
    ].join('\n'),
  }),
};

const en: Record<TemplateKey, Template> = {
  'booking.confirmed': (context) => ({
    subject: `Your appointment at ${context.businessName} is confirmed`,
    body: [
      `Hello ${context.customerName},`,
      '',
      `Your appointment at ${context.businessName} is confirmed.`,
      '',
      what(context, ' with ') ? `Service: ${what(context, ' with ')}` : null,
      `When: ${when(context)} (${context.timezone})`,
      '',
      'To move or cancel it, use the link you saved when you booked.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  }),

  'booking.rescheduled': (context) => ({
    subject: `Your appointment at ${context.businessName} has moved`,
    body: [
      `Hello ${context.customerName},`,
      '',
      `Your appointment at ${context.businessName} is now at a different time.`,
      '',
      what(context, ' with ') ? `Service: ${what(context, ' with ')}` : null,
      `New time: ${when(context)} (${context.timezone})`,
      '',
      'If that time does not suit you, you can move it again from your link.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  }),

  'booking.cancelled': (context) => ({
    subject: `Your appointment at ${context.businessName} was cancelled`,
    body: [
      `Hello ${context.customerName},`,
      '',
      `Your ${when(context)} appointment at ${context.businessName} was cancelled.`,
      '',
      'If that was a mistake, or you would like another time, you can book again whenever you like.',
    ].join('\n'),
  }),

  'booking.reminder': (context) => ({
    subject: `Reminder: your appointment at ${context.businessName}`,
    body: [
      `Hello ${context.customerName},`,
      '',
      `This is a reminder of your appointment at ${context.businessName}.`,
      '',
      what(context, ' with ') ? `Service: ${what(context, ' with ')}` : null,
      `When: ${when(context)} (${context.timezone})`,
      '',
      'If you cannot make it, let us know from your booking link.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  }),
'payment.received': (context) => ({
    subject: `We received your payment for ${context.businessName}`,
    body: [
      `Hello ${context.customerName},`,
      '',
      `We received your payment of ${howMuch(context)}.`,
      '',
      what(context, ' with ') ? `Service: ${what(context, ' with ')}` : null,
      `When: ${when(context)} (${context.timezone})`,
      '',
      'Keep this email as your receipt.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  }),

  'payment.failed': (context) => ({
    subject: `We could not process your payment for ${context.businessName}`,
    body: [
      `Hello ${context.customerName},`,
      '',
      'The payment did not go through, so your appointment is not paid for yet.',
      '',
      `When: ${when(context)} (${context.timezone})`,
      '',
      'You can try again from your booking link.',
    ].join('\n'),
  }),

  'payment.refunded': (context) => ({
    subject: `Your payment from ${context.businessName} has been refunded`,
    body: [
      `Hello ${context.customerName},`,
      '',
      `We have refunded ${howMuch(context)}.`,
      '',
      'Depending on your bank, it may take a few days to appear.',
    ].join('\n'),
  }),

  'professional.booking_created': (context) => ({
    subject: `New booking: ${context.customerName}`,
    body: [
      `${context.customerName} booked an appointment.`,
      '',
      what(context, ' with ') ? `Service: ${what(context, ' with ')}` : null,
      `When: ${when(context)} (${context.timezone})`,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  }),

  'professional.booking_rescheduled': (context) => ({
    subject: `${context.customerName} moved their appointment`,
    body: [
      `${context.customerName} moved their appointment.`,
      '',
      what(context, ' with ') ? `Service: ${what(context, ' with ')}` : null,
      `New time: ${when(context)} (${context.timezone})`,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  }),

  'professional.booking_cancelled': (context) => ({
    subject: `${context.customerName} cancelled their appointment`,
    body: [
      `${context.customerName} cancelled the ${when(context)} appointment.`,
      '',
      'That time is available again.',
    ].join('\n'),
  }),
};

export const notificationTemplates: Record<Locale, Record<TemplateKey, Template>> = { es, en };

/**
 * Renders one message.
 *
 * An unsupported language falls back to Spanish, never to English, for the
 * same reason the interface does: Spanish is the product's language, not its
 * second choice.
 */
export function renderNotification(
  templateKey: TemplateKey,
  locale: string,
  payload: NotificationPayload,
): NotificationMessage {
  const resolved = resolveLocale(locale);
  return notificationTemplates[resolved][templateKey]({ ...payload, locale: resolved });
}
