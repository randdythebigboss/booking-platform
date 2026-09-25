import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useWorkspaceErrorText } from '@/i18n/use-error-text';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useIssueText } from '@/i18n/use-issue-text';
import { useAsyncData } from '@/hooks/use-async-data';
import {
  createDateException,
  deleteDateException,
  fetchDateExceptions,
} from '@/services/schedule-admin';
import { spacing } from '@/theme';

const HORIZON_DAYS = 180;

export default function DateExceptionsScreen() {
  const { business, professional } = useRequiredWorkspace();
  const { t } = useTranslation();
  const tk = useDynamicT();
  const issueText = useIssueText();
  const errorText = useWorkspaceErrorText();
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
      <Screen title={t('exceptions.title')}>
        <Card>
          <Text variant="body" tone="muted">
            {t('exceptions.notBookable')}
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
      setFailure(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={t('exceptions.title')} subtitle={t('exceptions.subtitle')}>
      <Card>
        <Text variant="heading">{t('exceptions.add')}</Text>
        <Text variant="caption" tone="muted">
          {t('exceptions.customHoursNote')}
        </Text>

        <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
          <Field
            label={t('exceptions.date')}
            value={date}
            onChangeText={setDate}
            placeholder="2026-09-29"
            autoCapitalize="none"
            error={issueText(errors.date)}
          />

          <Select
            label={t('exceptions.whatChanges')}
            value={kind}
            options={[
              { value: 'closed' as const, label: t('exceptions.kindClosed') },
              { value: 'custom-hours' as const, label: t('exceptions.kindCustom') },
            ]}
            onChange={setKind}
          />

          {kind === 'custom-hours' && (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Field
                  label={t('exceptions.opensAt')}
                  value={startTime}
                  onChangeText={setStartTime}
                  placeholder="12:00"
                  autoCapitalize="none"
                  error={issueText(errors.startTime)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label={t('exceptions.closesAt')}
                  value={endTime}
                  onChangeText={setEndTime}
                  placeholder="20:00"
                  autoCapitalize="none"
                  error={issueText(errors.endTime)}
                />
              </View>
            </View>
          )}

          <Field
            label={t('exceptions.reason')}
            value={reason}
            onChangeText={setReason}
            placeholder={t('exceptions.holidayExample')}
          />

          <Feedback
            tone="muted"
            message={(() => {
              const described = describeException(draft);
              return tk(described.code, described.values);
            })()}
          />

          {failure && <Feedback tone="danger" message={failure} />}
          {saved && <Feedback tone="success" message={t('exceptions.saved')} />}

          <Button label={t('exceptions.save')} onPress={submit} loading={busy} />
        </View>
      </Card>

      <Text variant="heading">{t('exceptions.upcoming')}</Text>

      {exceptions.loading && <ActivityIndicator />}
      {exceptions.error && <Feedback tone="danger" message={exceptions.error} />}
      {exceptions.data?.length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            {t('exceptions.noneApplyWeekly')}
          </Text>
        </Card>
      )}

      <View style={{ gap: spacing.sm }}>
        {(exceptions.data ?? []).map((exception) => (
          <Card key={exception.id}>
            <Text variant="label">{exception.date}</Text>
            <Text variant="body" tone={exception.kind === 'custom-hours' ? 'accent' : 'danger'}>
              {exception.kind === 'closed' && t('exceptions.closedAllDay')}
              {exception.kind === 'closed-period' &&
                t('exceptions.closedFromTo', {
                  start: exception.startTime ?? '',
                  end: exception.endTime ?? '',
                })}
              {exception.kind === 'custom-hours' &&
                t('exceptions.openFromTo', {
                  start: exception.startTime ?? '',
                  end: exception.endTime ?? '',
                })}
            </Text>
            {exception.reason && (
              <Text variant="caption" tone="muted">
                {exception.reason}
              </Text>
            )}
            <Button
              label={t('exceptions.remove')}
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
