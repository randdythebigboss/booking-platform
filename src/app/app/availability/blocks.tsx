import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Field, Screen, Text } from '@/components/ui';
import { isoDateIn, toBlockRange, validateBlock, type BlockErrors } from '@/features/availability';
import { useWorkspaceErrorText } from '@/i18n/use-error-text';
import { useFormat } from '@/i18n/use-format';
import { useIssueText } from '@/i18n/use-issue-text';
import { useAsyncData } from '@/hooks/use-async-data';
import { createBlockedTime, deleteBlockedTime, fetchBlockedTimes } from '@/services/schedule-admin';
import { spacing } from '@/theme';

const HORIZON_DAYS = 90;

export default function BlockedTimeScreen() {
  const { business, professional } = useRequiredWorkspace();
  const { t } = useTranslation();
  const format = useFormat();
  const issueText = useIssueText();
  const errorText = useWorkspaceErrorText();
  const timezone = business.timezone;
  const professionalId = professional?.id ?? null;

  const from = new Date();
  const to = new Date(from.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const blocks = useAsyncData(
    () => (professionalId ? fetchBlockedTimes(professionalId, from, to) : Promise.resolve([])),
    [professionalId],
  );

  const [date, setDate] = useState(() => isoDateIn(new Date(), timezone));
  const [startTime, setStartTime] = useState('12:00');
  const [endTime, setEndTime] = useState('14:30');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<BlockErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!professionalId) {
    return (
      <Screen title={t('blocks.title')}>
        <Card>
          <Text variant="body" tone="muted">
            {t('blocks.notBookable')}
          </Text>
        </Card>
      </Screen>
    );
  }

  async function submit() {
    const draft = { date, startTime, endTime, reason };
    const nextErrors = validateBlock(draft);
    setErrors(nextErrors);
    setFailure(null);
    setSaved(false);
    if (Object.values(nextErrors).some(Boolean)) return;

    setBusy(true);
    try {
      const range = toBlockRange(draft, timezone);
      await createBlockedTime({
        professionalId: professionalId as string,
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        reason,
      });
      setReason('');
      setSaved(true);
      blocks.reload();
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={t('blocks.title')}
      subtitle={t('blocks.subtitle')}
    >
      <Card>
        <Text variant="heading">{t('blocks.add')}</Text>
        <Text variant="caption" tone="muted">
          {t('blocks.useExceptionInstead')}
        </Text>

        <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
          <Field
            label={t('blocks.date')}
            value={date}
            onChangeText={setDate}
            placeholder="2026-09-28"
            autoCapitalize="none"
            error={issueText(errors.date)}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Field
                label={t('blocks.startTime')}
                value={startTime}
                onChangeText={setStartTime}
                placeholder="12:00"
                autoCapitalize="none"
                error={issueText(errors.startTime)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label={t('blocks.endTime')}
                value={endTime}
                onChangeText={setEndTime}
                placeholder="14:30"
                autoCapitalize="none"
                error={issueText(errors.endTime)}
              />
            </View>
          </View>
          <Field
            label={t('blocks.reason')}
            value={reason}
            onChangeText={setReason}
            placeholder={t('blocks.reasonExample')}
          />

          {failure && <Feedback tone="danger" message={failure} />}
          {saved && <Feedback tone="success" message={t('blocks.blocked')} />}

          <Button label={t('blocks.add')} onPress={submit} loading={busy} />
        </View>
      </Card>

      <Text variant="heading">{t('blocks.upcoming')}</Text>

      {blocks.loading && <ActivityIndicator />}
      {blocks.error && <Feedback tone="danger" message={blocks.error} />}
      {blocks.data?.length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            {t('blocks.empty')}
          </Text>
        </Card>
      )}

      <View style={{ gap: spacing.sm }}>
        {(blocks.data ?? []).map((block) => (
          <Card key={block.id}>
            <Text variant="label">{format.date(block.startsAt, timezone)}</Text>
            <Text variant="body" tone="accent">
              {format.time(block.startsAt, timezone)} {'–'} {format.time(block.endsAt, timezone)}
            </Text>
            {block.reason && (
              <Text variant="caption" tone="muted">
                {block.reason}
              </Text>
            )}
            <Button
              label={t('blocks.remove')}
              variant="ghost"
              onPress={async () => {
                await deleteBlockedTime(block.id);
                blocks.reload();
              }}
            />
          </Card>
        ))}
      </View>
    </Screen>
  );
}
