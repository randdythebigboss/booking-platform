import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { RoadmapNote } from '@/components/roadmap-note';
import { Button, Card, Feedback, Field, Screen, Text } from '@/components/ui';
import {
  DEFAULT_WEEKLY_SCHEDULE,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  validateWeeklySchedule,
  type ScheduleEntry,
} from '@/features/availability/schedule';
import { toWorkspaceError } from '@/features/workspace';
import { useAsyncData } from '@/hooks/use-async-data';
import { fetchWeeklySchedule, saveWeeklySchedule } from '@/services/schedule-admin';
import { spacing } from '@/theme';
import type { Weekday } from '@/types/domain';

export default function AvailabilityScreen() {
  const { professional } = useRequiredWorkspace();
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
      <Screen title="Availability">
        <Card>
          <Text variant="body" tone="muted">
            Your account is not set up as a bookable professional in this business yet.
          </Text>
        </Card>
      </Screen>
    );
  }

  const issues = entries ? validateWeeklySchedule(entries) : [];
  const issueByIndex = new Map(issues.map((issue) => [issue.index, issue.message]));

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
      setFailure('Fix the highlighted hours first.');
      return;
    }

    setBusy(true);
    setFailure(null);
    try {
      await saveWeeklySchedule(professionalId, entries);
      setSaved(true);
      loaded.reload();
    } catch (cause) {
      setFailure(toWorkspaceError(cause).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Availability"
      subtitle="The hours customers may book. Times are local to your business."
    >
      {loaded.loading && !entries && <ActivityIndicator />}
      {loaded.error && <Feedback tone="danger" message={loaded.error} />}

      {entries?.length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            No working hours set, so nothing can be booked yet.
          </Text>
          <Button
            label="Use a standard week"
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
              <Text variant="heading">{WEEKDAY_LABELS[weekday]}</Text>

              {rows.length === 0 && (
                <Text variant="caption" tone="muted">
                  Closed.
                </Text>
              )}

              {rows.map(({ entry, index }) => (
                <View key={index} style={{ gap: spacing.xs, marginTop: spacing.xs }}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Opens"
                        value={entry.startTime}
                        onChangeText={(startTime) => update(index, { startTime })}
                        placeholder="09:00"
                        autoCapitalize="none"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Closes"
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
                    label="Remove this window"
                    variant="ghost"
                    onPress={() => removeWindow(index)}
                  />
                </View>
              ))}

              <Button
                label={rows.length === 0 ? 'Open this day' : 'Add another window'}
                variant="secondary"
                onPress={() => addWindow(weekday)}
              />
            </Card>
          );
        })}
      </View>

      {failure && <Feedback tone="danger" message={failure} />}
      {saved && <Feedback tone="success" message="Your weekly hours are saved." />}

      <Button label="Save weekly hours" onPress={submit} loading={busy} disabled={!entries} />

      <RoadmapNote
        phase="Phase 2 - Scheduling engine"
        summary="One-off exceptions and ad-hoc blocks are already in the database and the engine; the screens for them arrive with the calendar."
        items={[
          'Close a single date',
          'Open a date that is normally closed',
          'Block time without cancelling',
        ]}
      />
    </Screen>
  );
}
