import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Field, Screen, Text } from '@/components/ui';
import {
  DEFAULT_WEEKLY_SCHEDULE,
  WEEKDAY_KEYS,
  WEEKDAY_ORDER,
  validateWeeklySchedule,
  type ScheduleEntry,
} from '@/features/availability/schedule';
import { useWorkspaceErrorText } from '@/i18n/use-error-text';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useIssueText } from '@/i18n/use-issue-text';
import { useAsyncData } from '@/hooks/use-async-data';
import { fetchWeeklySchedule, saveWeeklySchedule } from '@/services/schedule-admin';
import { spacing } from '@/theme';
import type { Weekday } from '@/types/domain';

export default function AvailabilityScreen() {
  const { professional } = useRequiredWorkspace();
  const { t } = useTranslation();
  const tk = useDynamicT();
  const issueText = useIssueText();
  const errorText = useWorkspaceErrorText();
  const professionalId = professional?.id ?? null;

  const loaded = useAsyncData(
    () => (professionalId ? fetchWeeklySchedule(professionalId) : Promise.resolve([])),
    [professionalId],
  );

  const [entries, setEntries] = useState<ScheduleEntry[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded.data) setEntries(loaded.data);
  }, [loaded.data]);

  if (!professionalId) {
    return (
      <Screen title={t('availability.title')}>
        <Card>
          <Text variant="body" tone="muted">
            {t('availability.notBookable')}
          </Text>
        </Card>
      </Screen>
    );
  }

  const issues = entries ? validateWeeklySchedule(entries) : [];
  const issueByIndex = new Map(issues.map((entry) => [entry.index, issueText(entry.issue)]));

  function update(index: number, patch: Partial<ScheduleEntry>) {
    setSaved(false);
    setEntries((current) =>
      (current ?? []).map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );
  }

  function addWindow(weekday: Weekday) {
    setSaved(false);
    setEntries((current) => [
      ...(current ?? []),
      { weekday, startTime: '09:00', endTime: '17:00' },
    ]);
  }

  function removeWindow(index: number) {
    setSaved(false);
    setEntries((current) => (current ?? []).filter((_, i) => i !== index));
  }

  async function submit() {
    if (!entries || !professionalId) return;

    if (validateWeeklySchedule(entries).length > 0) {
      setFailure(t('availability.fixHighlighted'));
      return;
    }

    setBusy(true);
    setFailure(null);
    try {
      await saveWeeklySchedule(professionalId, entries);
      setSaved(true);
      loaded.reload();
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={t('availability.title')}
      subtitle={t('availability.subtitle')}
    >
      {loaded.loading && !entries && <ActivityIndicator />}
      {loaded.error && <Feedback tone="danger" message={loaded.error} />}

      {entries?.length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            {t('availability.noHoursSet')}
          </Text>
          <Button
            label={t('availability.useStandardWeek')}
            variant="secondary"
            onPress={() => setEntries([...DEFAULT_WEEKLY_SCHEDULE])}
          />
        </Card>
      )}

      <View style={{ gap: spacing.sm }}>
        {WEEKDAY_ORDER.map((weekday) => {
          const rows = (entries ?? [])
            .map((entry, index) => ({ entry, index }))
            .filter((row) => row.entry.weekday === weekday);

          return (
            <Card key={weekday}>
              <Text variant="heading">{tk(WEEKDAY_KEYS[weekday])}</Text>

              {rows.length === 0 && (
                <Text variant="caption" tone="muted">
                  {t('availability.closed')}
                </Text>
              )}

              {rows.map(({ entry, index }) => (
                <View key={index} style={{ gap: spacing.xs, marginTop: spacing.xs }}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t('availability.opens')}
                        value={entry.startTime}
                        onChangeText={(startTime) => update(index, { startTime })}
                        placeholder="09:00"
                        autoCapitalize="none"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t('availability.closes')}
                        value={entry.endTime}
                        onChangeText={(endTime) => update(index, { endTime })}
                        placeholder="18:00"
                        autoCapitalize="none"
                      />
                    </View>
                  </View>

                  {issueByIndex.has(index) && (
                    <Feedback tone="danger" message={issueByIndex.get(index) as string} />
                  )}

                  <Button
                    label={t('availability.removeThisWindow')}
                    variant="ghost"
                    onPress={() => removeWindow(index)}
                  />
                </View>
              ))}

              <Button
                label={
                  rows.length === 0
                    ? t('availability.openThisDay')
                    : t('availability.addAnotherWindow')
                }
                variant="secondary"
                onPress={() => addWindow(weekday)}
              />
            </Card>
          );
        })}
      </View>

      {failure && <Feedback tone="danger" message={failure} />}
      {saved && <Feedback tone="success" message={t('availability.savedWeekly')} />}

      <Button
        label={t('availability.saveWeekly')}
        onPress={submit}
        loading={busy}
        disabled={!entries}
      />

      <Card>
        <Text variant="heading">{t('availability.dateSpecific')}</Text>
        <Text variant="body" tone="muted">
          {t('availability.dateSpecificBody')}
        </Text>
        <Link href="/app/availability/exceptions" asChild>
          <Button label={t('exceptions.title')} variant="secondary" />
        </Link>
        <Text variant="caption" tone="muted">
          {t('availability.exceptionsHelp')}
        </Text>
        <Link href="/app/availability/blocks" asChild>
          <Button label={t('blocks.title')} variant="secondary" />
        </Link>
        <Text variant="caption" tone="muted">
          {t('blocks.subtitle')}
        </Text>
        <Link href="/app/availability/preview" asChild>
          <Button label={t('preview.title')} variant="secondary" />
        </Link>
        <Text variant="caption" tone="muted">
          {t('preview.subtitle')}
        </Text>
      </Card>
    </Screen>
  );
}
