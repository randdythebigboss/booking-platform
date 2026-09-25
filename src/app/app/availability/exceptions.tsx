import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { DatePicker } from '@/components/date-picker';
import { useRequiredWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Field, Segmented, Text } from '@/components/ui';
import { WorkspaceShell } from '@/components/workspace-shell';
import {
  addDays,
  describeException,
  isoDateIn,
  parseIsoDate,
  validateException,
  type ExceptionErrors,
  type ExceptionKind,
} from '@/features/availability';
import { useWorkspaceErrorText } from '@/i18n/use-error-text';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useFormat } from '@/i18n/use-format';
import { useIssueText } from '@/i18n/use-issue-text';
import { useAsyncData } from '@/hooks/use-async-data';
import {
  createDateException,
  deleteDateException,
  fetchDateExceptions,
} from '@/services/schedule-admin';
import { spacing } from '@/theme';

const HORIZON_DAYS = 180;

/** Midday UTC, so formatting never slides a date into its neighbour. */
function asDate(iso: string): Date {
  const { year, month, day } = parseIsoDate(iso);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export default function DateExceptionsScreen() {
  const { business, professional } = useRequiredWorkspace();
  const { t } = useTranslation();
  const tk = useDynamicT();
  const issueText = useIssueText();
  const errorText = useWorkspaceErrorText();
  const timezone = business.timezone;
  const format = useFormat();
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
      <WorkspaceShell
        businessName={business.name}
        professionalName={professional?.displayName ?? undefined}
        narrow
        title={t('exceptions.title')}
      >
        <Card>
          <Text variant="body" tone="muted">
            {t('exceptions.notBookable')}
          </Text>
        </Card>
      </WorkspaceShell>
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
    <WorkspaceShell
      businessName={business.name}
      professionalName={professional?.displayName ?? undefined}
      narrow
      title={t('exceptions.title')}
      subtitle={t('exceptions.subtitle')}
    >
      <Card>
        <Text variant="heading">{t('exceptions.add')}</Text>
        <Text variant="caption" tone="muted">
          {t('exceptions.customHoursNote')}
        </Text>

        <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
          <View style={{ gap: spacing.xs }}>
            <Text variant="label">{t('exceptions.date')}</Text>
            <DatePicker
              label={t('common.chooseADay')}
              value={date}
              minDate={today}
              maxDate={addDays(today, 365)}
              onChange={setDate}
            />
            {issueText(errors.date) && (
              <Text variant="caption" tone="danger">
                {issueText(errors.date)}
              </Text>
            )}
          </View>

          <View style={{ gap: spacing.xs }}>
            <Text variant="label">{t('exceptions.whatChanges')}</Text>
            <Segmented
              label={t('exceptions.whatChanges')}
              value={kind}
              options={[
                { value: 'closed' as const, label: t('exceptions.kindClosed') },
                { value: 'custom-hours' as const, label: t('exceptions.kindCustom') },
              ]}
              onChange={setKind}
            />
          </View>

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
            {/* The date as a person writes it, not as the column stores it. */}
            <Text variant="label">{format.date(asDate(exception.date), 'UTC')}</Text>
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
    </WorkspaceShell>
  );
}
