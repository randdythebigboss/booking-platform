import { getSupabase } from '@/lib/supabase';

/** Who wrote a message. */
export type MessageAuthor = 'professional' | 'customer';

export interface AppointmentMessage {
  id: string;
  author: MessageAuthor;
  /** What the author was called when they wrote it. Frozen, like the booking. */
  authorName: string;
  body: string;
  createdAt: Date;
  readAt: Date | null;
}

/** The longest message the database will accept. */
export const MESSAGE_MAX_LENGTH = 2000;

function parseMessages(raw: unknown): AppointmentMessage[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((entry) => {
    const row = entry as Record<string, unknown>;
    return {
      id: String(row.id),
      author: row.author === 'professional' ? 'professional' : 'customer',
      authorName: String(row.author_name ?? row.authorName ?? ''),
      body: String(row.body ?? ''),
      createdAt: new Date(String(row.created_at ?? row.createdAt)),
      readAt: row.read_at || row.readAt ? new Date(String(row.read_at ?? row.readAt)) : null,
    };
  });
}

/**
 * The conversation about one appointment, read with the guest's credential.
 *
 * A guest has no account, so the booking link is the only thing that proves
 * who they are -- the same credential that already lets them read, move and
 * cancel the appointment. The database function checks it before returning a
 * single row, and returns an empty thread rather than an error when it is
 * wrong, so a stranger cannot learn that an appointment exists.
 */
export async function fetchMessagesByToken(params: {
  appointmentId: string;
  accessToken: string;
}): Promise<AppointmentMessage[]> {
  const { data, error } = await getSupabase().rpc('get_appointment_messages_by_token', {
    p_appointment_id: params.appointmentId,
    p_access_token: params.accessToken,
  });

  if (error) throw error;
  return parseMessages(data);
}

/** Writes into that same thread, with the same proof. */
export async function sendMessageByToken(params: {
  appointmentId: string;
  accessToken: string;
  body: string;
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('send_appointment_message_by_token', {
    p_appointment_id: params.appointmentId,
    p_access_token: params.accessToken,
    p_body: params.body,
  });

  if (error) throw error;
  return String(data);
}

/**
 * Marks the professional's messages read.
 *
 * Deliberately not awaited by the screens that call it: whether the badge
 * clears is not worth delaying a conversation for, and failing to mark
 * something read is not an error a customer needs to hear about.
 */
export async function markMessagesReadByToken(params: {
  appointmentId: string;
  accessToken: string;
}): Promise<number> {
  const { data, error } = await getSupabase().rpc('mark_messages_read_by_token', {
    p_appointment_id: params.appointmentId,
    p_access_token: params.accessToken,
  });

  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * The same thread, read by a member of the business.
 *
 * Straight at the table: Row Level Security already answers "is this your
 * business?", so there is nothing for a function to add.
 */
export async function fetchMessages(appointmentId: string): Promise<AppointmentMessage[]> {
  const { data, error } = await getSupabase()
    .from('appointment_messages')
    .select('id, author, author_name, body, created_at, read_at')
    .eq('appointment_id', appointmentId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return parseMessages(data);
}

/** The professional writes. The policy refuses `author: 'customer'` here. */
export async function sendMessageAsProfessional(params: {
  appointmentId: string;
  businessId: string;
  authorUserId: string;
  authorName: string;
  body: string;
}): Promise<void> {
  const { error } = await getSupabase().from('appointment_messages').insert({
    appointment_id: params.appointmentId,
    business_id: params.businessId,
    author: 'professional',
    author_user_id: params.authorUserId,
    author_name: params.authorName,
    body: params.body.trim(),
  });

  if (error) throw error;
}

/** Marks the customer's messages read, from the business's side. */
export async function markMessagesRead(appointmentId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('appointment_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('appointment_id', appointmentId)
    .eq('author', 'customer')
    .is('read_at', null);

  if (error) throw error;
}
