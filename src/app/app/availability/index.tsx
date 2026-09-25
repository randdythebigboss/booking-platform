import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { DayHoursRow, type DayWindow } from '@/components/day-hours-row';
import { useRequiredWorkspace } from '@/components/providers';
import { Button, Card, EmptyState, Feedback, PressableLink, Text } from '@/components/ui';
import { WorkspaceShell } from '@/components/workspace-shell';
import { parseClockTime } from '@/features/availability';
import {
  DEFAULT_WEEKLY_SCHEDULE,
  WEEKDAY_KEYS,
  WEEKDAY_ORDER,
  validateWeeklySchedule,
  type ScheduleEntry,
} from '@/features/availability/schedule';
import { useAsyncData } from '@/hooks/use-async-data';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useWorkspaceErrorText } from '@/i18n/use-error-text';
import { useIssueText } from '@/i18n/use-issue-text';
import { fetchWeeklySchedule, saveWeeklySchedule } from '@/services/schedule-admin';
import { radius, spacing, useTheme } from '@/theme';
import type { Weekday } from '@/types/domain';

/** What a day gets when it is opened and nothing is remembered for it. */
const DEFAULT_WINDOW = { startTime: '09:00', endTime: '17:00' } as const;

/** Order-independent, so a reordering is not mistaken for an edit. */
function fingerprint(entries: readonly ScheduleEntry[]): string {
  return [...entries]
    .map((entry) => `${entry.weekday} ${entry.startTime} ${entry.endTime}`)
    .sort()
    .join('|');
}

/**
 * The week a business works.
 *
 * ---------------------------------------------------------------------------
 * What this screen is not
 * ---------------------------------------------------------------------------
 *
 * It is the *rule*, not the calendar. Saving here never touches a date-specific
 * exception or a block: those live in their own tables and are applied on top
 * of this, which is why a holiday you entered last month survives changing your
 * Tuesday hours today. The card at the bottom says so, because the previous
 * version left a professional to find out by experiment.
 *
 * ---------------------------------------------------------------------------
 * Unsaved work
 * ---------------------------------------------------------------------------
 *
 * Every edit here is local until Save. That is the right model -- a half-typed
 * `1` in an hour field should not close the shop at one in the morning -- but
 * it means the screen owes the person an honest account of what is not yet
 * real. So the bar under the title appears the moment anything differs from
 * what was loaded, offers to throw the changes away, and the browser is asked
 * to confirm before the tab closes on top of them.
 */
export default function AvailabilityScreen() {
  const { business, professional } = useRequiredWorkspace();
  const { t } = useTranslation();
  const tk = useDynamicT();
  const { palette } = useTheme();
  const issueText = useIssueText();
  const errorText = useWorkspaceErrorText();
  const professionalId = professional?.id ?? null;

  const loaded = useAsyncData(
    () => (professionalId ? fetchWeeklySchedule(professionalId) : Promise.resolve([])),
    [professionalId],
  );

  const [entries, setEntries] = useState<ScheduleEntry[] | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  // Hours a closed day had, so switching it back on returns them.
  const [remembered, setRemembered] = useState<Partial<Record<Weekday, ScheduleEntry[]>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // Only the day being changed shows its boxes; the rest stay a summary.
  const [expanded, setExpanded] = useState<Weekday | null>(null);

  useEffect(() => {
    if (!loaded.data) return;
    setEntries(loaded.data);
    setBaseline(fingerprint(loaded.data));
  }, [loaded.data]);

  const dirty = entries !== null && baseline !== null && fingerprint(entries) !== baseline;
  useUnsavedChanges(dirty);

  const issues = useMemo(() => (entries ? validateWeeklySchedule(entries) : []), [entries]);
  const issueByIndex = useMemo(
    () => new Map(issues.map((entry) => [entry.index, issueText(entry.issue)])),
    [issues, issueText],
  );

  // Minutes of work a week, so the top of the screen answers the question the
  // whole screen exists to answer.
  const weeklyMinutes = useMemo(() => {
    let total = 0;
    for (const entry of entries ?? []) {
      try {
        total += parseClockTime(entry.endTime) - parseClockTime(entry.startTime);
      } catch {
        // A half-typed hour contributes nothing rather than a negative.
      }
    }
    return Math.max(0, total);
  }, [entries]);

  if (!professionalId) {
    return (
      <WorkspaceShell
        businessName={business.name}
        professionalName={professional?.displayName ?? undefined}
        title={t('availability.title')}
        narrow
      >
        <Card>
          <EmptyState mark="◷" title={t('availability.notBookable')} />
        </Card>
      </WorkspaceShell>
    );
  }

  function touch() {
    setSaved(false);
    setFailure(null);
  }

  function update(index: number, patch: Partial<ScheduleEntry>) {
    touch();
    setEntries((current) =>
      (current ?? []).map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );
  }

  function addWindow(weekday: Weekday) {
    touch();
    setEntries((current) => [...(current ?? []), { weekday, ...DEFAULT_WINDOW }]);
  }

  function removeWindow(index: number) {
    touch();
    setEntries((current) => (current ?? []).filter((_, i) => i !== index));
  }

  function toggleDay(weekday: Weekday, open: boolean) {
    touch();
    setExpanded(open ? weekday : null);
    setEntries((current) => {
      const rows = current ?? [];
      if (!open) {
        const closing = rows.filter((entry) => entry.weekday === weekday);
        if (closing.length > 0) setRemembered((memory) => ({ ...memory, [weekday]: closing }));
        return rows.filter((entry) => entry.weekday !== weekday);
      }
      const restored = remembered[weekday] ?? [{ weekday, ...DEFAULT_WINDOW }];
      return [...rows, ...restored];
    });
  }

  /** Gives every other day the hours of this one, closed days included. */
  function copyToOthers(weekday: Weekday) {
    touch();
    setEntries((current) => {
      const rows = current ?? [];
      const source = rows.filter((entry) => entry.weekday === weekday);
      if (source.length === 0) return rows;

      return WEEKDAY_ORDER.flatMap((day) => source.map((entry) => ({ ...entry, weekday: day })));
    });
  }

  function discard() {
    if (!loaded.data) return;
    touch();
    setEntries(loaded.data);
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
      setBaseline(fingerprint(entries));
      setSaved(true);
      loaded.reload();
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  const openDays = new Set((entries ?? []).map((entry) => entry.weekday)).size;

  return (
    <WorkspaceShell
      businessName={business.name}
      professionalName={professional?.displayName ?? undefined}
      title={t('availability.weekly')}
      subtitle={t('availability.weeklyHint')}
      narrow
      action={
        <Button
          label={t('availability.saveWeek')}
          onPress={submit}
          loading={busy}
          disabled={!entries || !dirty}
        />
      }
      toolbar={
        dirty ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              paddingVertical: spacing.xs,
              paddingHorizontal: spacing.md,
              borderRadius: radius.md,
              backgroundColor: palette.warningMuted,
            }}
          >
            <Text variant="caption" style={{ flex: 1, color: palette.warning }}>
              {t('availability.unsaved')}
            </Text>
            <Button label={t('common.discard')} variant="ghost" size="compact" onPress={discard} />
          </View>
        ) : undefined
      }
    >
      {loaded.loading && !entries && <ActivityIndicator />}
      {loaded.error && <Feedback tone="danger" message={loaded.error} />}

      {entries?.length === 0 && (
        <Card>
          <EmptyState
            mark="◷"
            title={t('availability.noHoursSet')}
            body={t('availability.nothingOpenHint')}
            action={
              <Button
                label={t('availability.useStandardWeek')}
                variant="secondary"
                size="compact"
                onPress={() => {
                  touch();
                  setEntries([...DEFAULT_WEEKLY_SCHEDULE]);
                }}
              />
            }
          />
        </Card>
      )}

      {entries && entries.length > 0 && (
        <Card style={{ paddingVertical: spacing.xs }}>
          {WEEKDAY_ORDER.map((weekday, position) => {
            const windows: DayWindow[] = entries
              .map((entry, index) => ({ entry, index }))
              .filter((row) => row.entry.weekday === weekday)
              .map((row) => ({ ...row, error: issueByIndex.get(row.index) }));

            return (
              <DayHoursRow
                key={weekday}
                label={tk(WEEKDAY_KEYS[weekday])}
                windows={windows}
                divider={position < WEEKDAY_ORDER.length - 1}
                expanded={expanded === weekday || windows.some((window) => window.error)}
                onExpand={(next) => setExpanded(next ? weekday : null)}
                onToggle={(open) => toggleDay(weekday, open)}
                onChange={update}
                onAdd={() => addWindow(weekday)}
                onRemove={removeWindow}
                onCopyToOthers={windows.length > 0 ? () => copyToOthers(weekday) : undefined}
              />
            );
          })}
        </Card>
      )}

      {entries && entries.length > 0 && (
        <Text variant="caption" tone="muted">
          {t('availability.weeklyTotal', {
            hours: Math.round((weeklyMinutes / 60) * 10) / 10,
            count: openDays,
          })}
        </Text>
      )}

      {failure && <Feedback tone="danger" message={failure} />}
      {saved && <Feedback tone="success" message={t('availability.saved')} />}

      <Card>
        <Text variant="heading">{t('availability.dateSpecific')}</Text>
        <Text variant="caption" tone="muted">
          {t('availability.dateSpecificBody')}
        </Text>

        <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
          <DestinationRow
            href="/app/availability/exceptions"
            title={t('availability.exceptions')}
            hint={t('availability.exceptionsHint')}
          />
          <DestinationRow
            href="/app/availability/blocks"
            title={t('availability.blocks')}
            hint={t('availability.blocksHint')}
          />
          <DestinationRow
            href="/app/availability/preview"
            title={t('availability.preview')}
            hint={t('availability.previewHint')}
          />
        </View>
      </Card>
    </WorkspaceShell>
  );
}

/** A place to go, with the one line that says why you would. */
function DestinationRow({ href, title, hint }: { href: string; title: string; hint: string }) {
  const { palette } = useTheme();

  return (
    <PressableLink
      href={href}
      accessibilityLabel={`${title}. ${hint}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 56,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface,
      }}
    >
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="label">{title}</Text>
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      </View>
      <Text variant="label" tone="muted">
        {'›'}
      </Text>
    </PressableLink>
  );
}
