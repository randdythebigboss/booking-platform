import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { Button, Card, Feedback, Field, Text } from '@/components/ui';
import { isoDateIn } from '@/features/availability';
import { useFormat } from '@/i18n/use-format';
import {
  MESSAGE_MAX_LENGTH,
  type AppointmentMessage,
  type MessageAuthor,
} from '@/services/messages';
import { radius, spacing, useTheme } from '@/theme';

export interface MessageThreadProps {
  messages: AppointmentMessage[];
  loading: boolean;
  /** Which side of the conversation this screen is. */
  viewer: MessageAuthor;
  timezone: string;
  onSend: (body: string) => Promise<void>;
  /** Hides the composer for a closed appointment. Reading stays open. */
  readOnly?: boolean;
}

/**
 * One appointment's conversation, drawn the same way for both sides.
 *
 * Deliberately not a chat application. There is no presence, no typing
 * indicator, no attachment, no editing and no deleting: a conversation
 * somebody can rewrite is not a record of anything, and the reason this exists
 * is so that "I have to move Thursday" is on the record.
 *
 * The same component serves a professional and a customer, with `viewer`
 * deciding only which side is "you". Two implementations of a thread would
 * drift, and the one nobody looked at would be the one with the bug.
 */
export function MessageThread({
  messages,
  loading,
  viewer,
  timezone,
  onSend,
  readOnly = false,
}: MessageThreadProps) {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const format = useFormat();

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Guards the composer against a second press while the first is in flight.
  const inFlight = useRef(false);

  const tooLong = draft.length > MESSAGE_MAX_LENGTH;
  const canSend = draft.trim().length > 0 && !tooLong && !sending;

  async function send() {
    if (!canSend || inFlight.current) return;

    inFlight.current = true;
    setSending(true);
    setFailure(null);

    try {
      await onSend(draft.trim());
      // Cleared only on success: a message that failed to send is still the
      // customer's words, and retyping them is the wrong thing to ask.
      setDraft('');
    } catch {
      setFailure(t('messages.couldNotSend'));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">{t('messages.title')}</Text>

      {loading && <ActivityIndicator />}

      {!loading && messages.length === 0 && (
        <View style={{ gap: spacing.xs }}>
          <Text variant="body" tone="muted">
            {t('messages.empty')}
          </Text>
          <Text variant="caption" tone="muted">
            {viewer === 'professional'
              ? t('messages.emptyHintProfessional')
              : t('messages.emptyHintCustomer')}
          </Text>
        </View>
      )}

      {messages.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          {messages.map((message, position) => {
            const mine = message.author === viewer;
            const previous = messages[position - 1];
            // A date once per day, a clock on every message. Stamping the
            // full date on each of them made a four-line exchange look like
            // four separate events.
            const newDay =
              !previous ||
              isoDateIn(previous.createdAt, timezone) !== isoDateIn(message.createdAt, timezone);

            return (
              <View key={message.id} style={{ gap: spacing.xs }}>
                {newDay && (
                  <Text variant="overline" tone="muted" style={{ textAlign: 'center' }}>
                    {format.date(message.createdAt, timezone)}
                  </Text>
                )}

                <View
                  style={{
                    alignSelf: mine ? 'flex-end' : 'flex-start',
                    maxWidth: '88%',
                    gap: 2,
                    padding: spacing.sm,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: mine ? palette.accentMuted : palette.border,
                    backgroundColor: mine ? palette.accentMuted : palette.surface,
                  }}
                >
                  <Text variant="caption" tone="muted">
                    {mine
                      ? t('messages.you')
                      : message.author === 'professional'
                        ? t('messages.fromProfessional', { name: message.authorName })
                        : t('messages.fromCustomer', { name: message.authorName })}
                  </Text>
                  <Text variant="body">{message.body}</Text>
                  <Text variant="caption" tone="muted">
                    {format.time(message.createdAt, timezone)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {!readOnly && (
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <Field
            label={t('messages.writeLabel')}
            value={draft}
            onChangeText={setDraft}
            placeholder={t('messages.placeholder')}
            multiline
            error={tooLong ? t('messages.tooLong') : undefined}
            // Silent until the limit is close, then a count rather than a
            // message that only appears once it is already too late.
            hint={
              !tooLong && draft.length > MESSAGE_MAX_LENGTH - 120
                ? t('messages.remaining', { count: MESSAGE_MAX_LENGTH - draft.length })
                : undefined
            }
          />
          {failure && <Feedback tone="danger" message={failure} />}
          <Button
            label={sending ? t('messages.sending') : t('messages.send')}
            onPress={send}
            disabled={!canSend}
            loading={sending}
          />
        </View>
      )}

      {/* Nobody should wonder whether this reached a phone. It did not. */}
      <Text variant="caption" tone="muted">
        {t('messages.stayInApp')}
      </Text>
    </Card>
  );
}
