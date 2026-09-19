import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Field, Screen, Text, ToggleRow } from '@/components/ui';
import {
  parseNumericInput,
  validateService,
  type ServiceErrors,
} from '@/features/services/validation';
import { toWorkspaceError } from '@/features/workspace';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatDuration, formatMoney } from '@/lib/format';
import {
  deactivateService,
  fetchServices,
  saveService,
  type AdminService,
} from '@/services/service-admin';
import { spacing } from '@/theme';

interface Draft {
  id?: string;
  name: string;
  description: string;
  duration: string;
  price: string;
  bufferBefore: string;
  bufferAfter: string;
  isActive: boolean;
}

const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  duration: '30',
  price: '0',
  bufferBefore: '0',
  bufferAfter: '0',
  isActive: true,
};

function toDraft(service: AdminService): Draft {
  return {
    id: service.id,
    name: service.name,
    description: service.description ?? '',
    duration: String(service.durationMinutes),
    price: String(service.price),
    bufferBefore: String(service.bufferBeforeMinutes),
    bufferAfter: String(service.bufferAfterMinutes),
    isActive: service.isActive,
  };
}

export default function ServicesScreen() {
  const { business } = useRequiredWorkspace();
  const services = useAsyncData(() => fetchServices(business.id), [business.id]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<ServiceErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function edit(next: Draft) {
    setDraft(next);
    setErrors({});
    setFailure(null);
  }

  async function submit() {
    if (!draft) return;

    const parsed = {
      name: draft.name,
      durationMinutes: parseNumericInput(draft.duration),
      price: parseNumericInput(draft.price),
      bufferBeforeMinutes: parseNumericInput(draft.bufferBefore),
      bufferAfterMinutes: parseNumericInput(draft.bufferAfter),
    };

    const nextErrors = validateService(parsed);
    setErrors(nextErrors);
    setFailure(null);
    if (Object.values(nextErrors).some(Boolean)) return;

    setBusy(true);
    try {
      await saveService({
        businessId: business.id,
        serviceId: draft.id,
        name: draft.name,
        description: draft.description,
        durationMinutes: parsed.durationMinutes,
        price: parsed.price,
        bufferBeforeMinutes: parsed.bufferBeforeMinutes,
        bufferAfterMinutes: parsed.bufferAfterMinutes,
        isActive: draft.isActive,
      });
      setDraft(null);
      services.reload();
    } catch (cause) {
      setFailure(toWorkspaceError(cause).message);
    } finally {
      setBusy(false);
    }
  }

  if (draft) {
    return (
      <Screen
        title={draft.id ? 'Edit service' : 'New service'}
        subtitle="Duration and buffers decide which times customers can book."
      >
        <View style={{ gap: spacing.md }}>
          <Field
            label="Name"
            value={draft.name}
            onChangeText={(name) => setDraft({ ...draft, name })}
            placeholder="Haircut"
            error={errors.name}
          />
          <Field
            label="Description"
            value={draft.description}
            onChangeText={(description) => setDraft({ ...draft, description })}
            placeholder="Wash, cut and finish."
            multiline
          />
          <Field
            label="Duration in minutes"
            value={draft.duration}
            onChangeText={(duration) => setDraft({ ...draft, duration })}
            keyboardType="number-pad"
            error={errors.durationMinutes}
          />
          <Field
            label={`Price in ${business.currency}`}
            value={draft.price}
            onChangeText={(price) => setDraft({ ...draft, price })}
            keyboardType="decimal-pad"
            error={errors.price}
          />
          <Field
            label="Buffer before, in minutes"
            value={draft.bufferBefore}
            onChangeText={(bufferBefore) => setDraft({ ...draft, bufferBefore })}
            keyboardType="number-pad"
            error={errors.bufferBeforeMinutes}
            hint="Setup time held before the appointment."
          />
          <Field
            label="Buffer after, in minutes"
            value={draft.bufferAfter}
            onChangeText={(bufferAfter) => setDraft({ ...draft, bufferAfter })}
            keyboardType="number-pad"
            error={errors.bufferAfterMinutes}
            hint="Clean-up time held after the appointment."
          />
          <ToggleRow
            label="Offered to customers"
            description="Turn this off to hide the service without deleting it."
            value={draft.isActive}
            onChange={(isActive) => setDraft({ ...draft, isActive })}
          />

          {failure && <Feedback tone="danger" message={failure} />}

          <Button label="Save service" onPress={submit} loading={busy} />
          <Button label="Cancel" variant="ghost" onPress={() => setDraft(null)} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Services" subtitle="What you offer, how long it takes, what it costs.">
      <Button label="Add a service" onPress={() => edit(EMPTY_DRAFT)} />

      {services.loading && <ActivityIndicator />}
      {services.error && <Feedback tone="danger" message={services.error} />}

      {services.data?.length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            No services yet. Customers cannot book until there is at least one.
          </Text>
        </Card>
      )}

      <View style={{ gap: spacing.sm }}>
        {(services.data ?? []).map((service) => (
          <Card key={service.id}>
            <Text variant="heading">{service.name}</Text>
            <Text variant="label" tone="accent">
              {formatDuration(service.durationMinutes)} {'·'}{' '}
              {formatMoney(service.price, service.currency)}
            </Text>
            {!service.isActive && (
              <Text variant="caption" tone="muted">
                Hidden from customers.
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
              <Button
                label="Edit"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => edit(toDraft(service))}
              />
              {service.isActive && (
                <Button
                  label="Hide"
                  variant="ghost"
                  style={{ flex: 1 }}
                  onPress={async () => {
                    await deactivateService(service.id);
                    services.reload();
                  }}
                />
              )}
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
