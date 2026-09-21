import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Field, Screen, Select, Text } from '@/components/ui';
import {
  addDays,
  describeException,
  isoDateIn,
  validateException,
  type ExceptionErrors,
  type ExceptionKind,
} from '@/features/availability';
import { toWorkspaceError } from '@/features/workspace';
import { useAsyncData } from '@/hooks/use-async-data';
import {
  createDateException,
  deleteDateException,
  fetchDateExceptions,
} from '@/services/schedule-admin';
import { spacing } from '@/theme';

const HORIZON_DAYS = 180;

const KIND_OPTIONS = [
  { value: 'closed' as const, label: 'Closed all day' },
  { value: 'custom-hours' as const, label: 'Different hours that day' },
];

export default function DateExceptionsScreen() {
  const { business, professional } = useRequiredWorkspace();
  const timezone = business.timezone;
  const professionalId = professional?.id ?? null;

  const today = isoDateIn(new Date(), timezone);
  const exceptions = useAsyncData(
    () =>
      professionalId
        ? fetchDateExceptions(professionalId, today, addDays(today, HORIZON_DAYS))
        : Promise.resolve([]),
    [professionalId, today],
  );

  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<ExceptionKind>('closed');
  const [startTime, setStartTime] = useState('12:00');
  const [endTime, setEndTime] = useState('20:00');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<ExceptionErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!professionalId) {
    return (
      <Screen title="Date exceptions">
        <Card>
          <Text variant="body" tone="muted">
            Your account is not set up as a bookable professional in this business yet.
          </Text>
        </Card>
      </Screen>
    );
  }

  const draft = {
    date,
    kind,
    ...(kind === 'custom-hours' ? { startTime, endTime } : {}),
    reason,
  };

  async function submit() {
    const nextErrors = validateException(draft);
    setErrors(nextErrors);
    setFailure(null);
    setSaved(false);
    if (Object.values(nextErrors).some(Boolean)) return;

    setBusy(true);
    try {
      await createDateException(professionalId as string, draft);
      setReason('');
      setSaved(true);
      exceptions.reload();
    } catch (cause) {
      setFailure(toWorkspaceError(cause).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Date exceptions"
      subtitle="A change to what your schedule says on one specific date."
    >
      <Card>
        <Text variant="heading">Add an exception</Text>
        <Text variant="caption" tone="muted">
          Custom hours replace that day&apos;s normal hours entirely. To take a couple of hours out
          of an otherwise normal day, use Blocked time instead.
        </Text>

        <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
          <Field
            label="Date"
            value={date}
            onChangeText={setDate}
            placeholder="2026-09-29"
            autoCapitalize="none"
            error={errors.date}
          />

          <Select label="What changes" value={kind} options={KIND_OPTIONS} onChange={setKind} />

          {kind === 'custom-hours' && (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Opens"
                  value={startTime}
                  onChangeText={setStartTime}
                  placeholder="12:00"
                  autoCapitalize="none"
                  error={errors.startTime}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Closes"
                  value={endTime}
                  onChangeText={setEndTime}
                  placeholder="20:00"
                  autoCapitalize="none"
                  error={errors.endTime}
                />
              </View>
            </View>
          )}

          <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Holiday" />

          <Feedback tone="muted" message={describeException(draft)} />

          {failure && <Feedback tone="danger" message={failure} />}
          {saved && <Feedback tone="success" message="That exception is saved." />}

          <Button label="Save exception" onPress={submit} loading={busy} />
        </View>
      </Card>

      <Text variant="heading">Upcoming exceptions</Text>

      {exceptions.loading && <ActivityIndicator />}
      {exceptions.error && <Feedback tone="danger" message={exceptions.error} />}
      {exceptions.data?.length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            No exceptions. Your weekly schedule applies to every date.
          </Text>
        </Card>
      )}

      <View style={{ gap: spacing.sm }}>
        {(exceptions.data ?? []).map((exception) => (
          <Card key={exception.id}>
            <Text variant="label">{exception.date}</Text>
            <Text variant="body" tone={exception.kind === 'closed' ? 'danger' : 'accent'}>
              {exception.kind === 'closed'
                ? 'Closed all day'
                : `Open ${exception.startTime} to ${exception.endTime}`}
            </Text>
            {exception.reason && (
              <Text variant="caption" tone="muted">
                {exception.reason}
              </Text>
            )}
            <Button
              label="Remove"
              variant="ghost"
              onPress={async () => {
                await deleteDateException(exception.id);
                exceptions.reload();
              }}
            />
          </Card>
        ))}
      </View>
    </Screen>
  );
}
