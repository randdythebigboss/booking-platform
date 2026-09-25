import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { DaySchedule } from '@/components/day-schedule';
import { Dropdown, Feedback, Text } from '@/components/ui';
import { WeekStrip } from '@/components/week-strip';
import { addDays, isoDateIn, type DaySlot } from '@/features/availability';
import { useAsyncData } from '@/hooks/use-async-data';
import { useFormat } from '@/i18n/use-format';
import { fetchDaySchedule } from '@/services/availability';
import { fetchServices } from '@/services/service-admin';
import { spacing } from '@/theme';

export interface SchedulePreviewProps {
  businessId: string;
  professionalId: string;
  timezone: string;
  /** True while the editor above holds changes that have not been saved. */
  dirty: boolean;
}

/**
 * What a customer would see, without leaving the screen that decides it.
 *
 * ---------------------------------------------------------------------------
 * Why it is here rather than only on its own page
 * ---------------------------------------------------------------------------
 *
 * Configuring Tuesday and then navigating to a preview to find out what
 * Tuesday became is two screens for one question. A professional who has to
 * remember what they changed while they walk to the answer will stop checking,
 * and the first they will hear of a mistake is a customer booking into it.
 *
 * ---------------------------------------------------------------------------
 * Two things it is careful about
 * ---------------------------------------------------------------------------
 *
 * **It is the real engine.** `get_day_schedule` is the same function the
 * public booking page calls, with the same working windows, exceptions,
 * blocks, appointments, buffers, notice and horizon. There is no second
 * calculation here to drift from it.
 *
 * **It shows what is published, not what is being typed.** The rules only
 * exist for the backend once they are saved, so while the editor is dirty this
 * is last saved state and says so in as many words. Showing a draft as though
 * it were live would be the one lie that matters on this screen.
 *
 * Availability depends on the service -- an hour-long booking does not fit a
 * forty-minute gap that a half-hour one does -- so the service is a control
 * here, not an assumption.
 */
export function SchedulePreview({
  businessId,
  professionalId,
  timezone,
  dirty,
}: SchedulePreviewProps) {
  const { t } = useTranslation();
  const format = useFormat();

  const today = isoDateIn(new Date(), timezone);
  const [date, setDate] = useState(today);
  const [serviceId, setServiceId] = useState<string | null>(null);

  const services = useAsyncData(() => fetchServices(businessId), [businessId]);
  const active = (services.data ?? []).filter((service) => service.isActive);
  const chosen = serviceId ?? active[0]?.id ?? null;

  const [slots, setSlots] = useState<DaySlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!chosen) {
      setSlots([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    fetchDaySchedule({ professionalId, serviceId: chosen, date })
      .then((result) => {
        if (!cancelled) setSlots(result);
      })
      .catch(() => {
        if (!cancelled) {
          setSlots([]);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [professionalId, chosen, date, dirty]);

  const free = slots.filter((slot) => slot.state === 'available').length;

  return (
    <View style={{ gap: spacing.md }}>
      {active.length > 1 && (
        <Dropdown
          label={t('preview.service')}
          value={chosen ?? ''}
          options={active.map((service) => ({
            value: service.id,
            label: `${service.name} · ${format.duration(service.durationMinutes)}`,
          }))}
          onChange={setServiceId}
        />
      )}

      <WeekStrip
        label={t('common.chooseADay')}
        value={date}
        onChange={setDate}
        today={today}
        minDate={today}
        maxDate={addDays(today, 90)}
      />

      {/* The whole point of the warning: a draft is not availability. */}
      {dirty && <Feedback tone="warning" message={t('preview.draftNotLive')} />}

      {loading && <ActivityIndicator />}
      {failed && <Feedback tone="danger" message={t('preview.couldNotLoad')} />}

      {!loading && !failed && active.length === 0 && (
        <Feedback tone="muted" message={t('preview.noActiveServices')} />
      )}

      {!loading && !failed && chosen && slots.length === 0 && (
        <Feedback tone="muted" message={t('preview.noneOffered')} />
      )}

      {!loading && slots.length > 0 && (
        <>
          <Text variant="caption" tone="muted">
            {t('preview.offered', { count: free })}
          </Text>
          {/* The professional's own calendar, so `taken` and `closed` are told
              apart here. The public page never distinguishes them. */}
          <DaySchedule
            slots={slots}
            selected={null}
            onSelect={() => undefined}
            timezone={timezone}
            revealReason
          />
        </>
      )}
    </View>
  );
}
