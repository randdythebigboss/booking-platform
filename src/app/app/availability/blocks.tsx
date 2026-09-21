import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Field, Screen, Text } from '@/components/ui';
import { isoDateIn, toBlockRange, validateBlock, type BlockErrors } from '@/features/availability';
import { toWorkspaceError } from '@/features/workspace';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatDateIn, formatTimeIn } from '@/lib/format';
import { createBlockedTime, deleteBlockedTime, fetchBlockedTimes } from '@/services/schedule-admin';
import { spacing } from '@/theme';

const HORIZON_DAYS = 90;

export default function BlockedTimeScreen() {
  const { business, professional } = useRequiredWorkspace();
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
      <Screen title="Blocked time">
        <Card>
          <Text variant="body" tone="muted">
            Your account is not set up as a bookable professional in this business yet.
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
      setFailure(toWorkspaceError(cause).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Blocked time"
      subtitle={`Time taken out of a day. Hours are ${business.timezone.split('/').pop()?.replace(/_/g, ' ')} time.`}
    >
      <Card>
        <Text variant="heading">Block a period</Text>
        <Text variant="caption" tone="muted">
          To close a whole day instead, use Date exceptions: that changes what your schedule says,
          rather than carving a hole in it.
        </Text>

        <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
          <Field
            label="Date"
            value={date}
            onChangeText={setDate}
            placeholder="2026-09-28"
            autoCapitalize="none"
            error={errors.date}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Field
                label="From"
                value={startTime}
                onChangeText={setStartTime}
                placeholder="12:00"
                autoCapitalize="none"
                error={errors.startTime}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="To"
                value={endTime}
                onChangeText={setEndTime}
                placeholder="14:30"
                autoCapitalize="none"
                error={errors.endTime}
              />
            </View>
          </View>
          <Field
            label="Reason"
            value={reason}
            onChangeText={setReason}
            placeholder="Personal appointment"
          />

          {failure && <Feedback tone="danger" message={failure} />}
          {saved && <Feedback tone="success" message="That period is blocked." />}

          <Button label="Block this period" onPress={submit} loading={busy} />
        </View>
      </Card>

      <Text variant="heading">Upcoming blocks</Text>

      {blocks.loading && <ActivityIndicator />}
      {blocks.error && <Feedback tone="danger" message={blocks.error} />}
      {blocks.data?.length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            Nothing blocked in the next {HORIZON_DAYS} days.
          </Text>
        </Card>
      )}

      <View style={{ gap: spacing.sm }}>
        {(blocks.data ?? []).map((block) => (
          <Card key={block.id}>
            <Text variant="label">{formatDateIn(block.startsAt, timezone)}</Text>
            <Text variant="body" tone="accent">
              {formatTimeIn(block.startsAt, timezone)} {'–'} {formatTimeIn(block.endsAt, timezone)}
            </Text>
            {block.reason && (
              <Text variant="caption" tone="muted">
                {block.reason}
              </Text>
            )}
            <Button
              label="Remove"
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
