import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Field, Screen, Select, Text, ToggleRow } from '@/components/ui';
import { PAYMENT_REQUIREMENTS, type PaymentRequirement } from '@/features/payments';
import {
  parseNumericInput,
  validateService,
  type ServiceErrors,
} from '@/features/services/validation';
import { useWorkspaceErrorText } from '@/i18n/use-error-text';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useFormat } from '@/i18n/use-format';
import { useIssueText } from '@/i18n/use-issue-text';
import { useAsyncData } from '@/hooks/use-async-data';
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
  paymentRequirement: PaymentRequirement;
  deposit: string;
}

const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  duration: '30',
  price: '0',
  bufferBefore: '0',
  bufferAfter: '0',
  isActive: true,
  paymentRequirement: 'none',
  deposit: '',
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
    paymentRequirement: service.paymentRequirement,
    deposit: service.depositAmount ?? '',
  };
}

export default function ServicesScreen() {
  const { business } = useRequiredWorkspace();
  const { t } = useTranslation();
  const tk = useDynamicT();
  const format = useFormat();
  const issueText = useIssueText();
  const errorText = useWorkspaceErrorText();
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
        paymentRequirement: draft.paymentRequirement,
        // Only meaningful for a deposit, and the database says so too.
        depositAmount:
          draft.paymentRequirement === 'deposit' ? parseNumericInput(draft.deposit) : null,
      });
      setDraft(null);
      services.reload();
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  if (draft) {
    return (
      <Screen
        title={draft.id ? t('services.edit') : t('services.new')}
        subtitle={t('services.formSubtitle')}
      >
        <View style={{ gap: spacing.md }}>
          <Field
            label={t('services.name')}
            value={draft.name}
            onChangeText={(name) => setDraft({ ...draft, name })}
            placeholder={t('services.namePlaceholder')}
            error={issueText(errors.name)}
          />
          <Field
            label={t('services.description')}
            value={draft.description}
            onChangeText={(description) => setDraft({ ...draft, description })}
            placeholder={t('services.descriptionPlaceholder')}
            multiline
          />
          <Field
            label={t('services.durationMinutes')}
            value={draft.duration}
            onChangeText={(duration) => setDraft({ ...draft, duration })}
            keyboardType="number-pad"
            error={issueText(errors.durationMinutes)}
          />
          <Field
            label={t('services.priceIn', { currency: business.currency })}
            value={draft.price}
            onChangeText={(price) => setDraft({ ...draft, price })}
            keyboardType="decimal-pad"
            error={issueText(errors.price)}
          />
          <Field
            label={t('services.bufferBefore')}
            value={draft.bufferBefore}
            onChangeText={(bufferBefore) => setDraft({ ...draft, bufferBefore })}
            keyboardType="number-pad"
            error={issueText(errors.bufferBeforeMinutes)}
            hint={t('services.bufferBeforeHint')}
          />
          <Field
            label={t('services.bufferAfter')}
            value={draft.bufferAfter}
            onChangeText={(bufferAfter) => setDraft({ ...draft, bufferAfter })}
            keyboardType="number-pad"
            error={issueText(errors.bufferAfterMinutes)}
            hint={t('services.bufferAfterHint')}
          />
          {/* What a customer has to pay before this is booked. Three answers,
              and the deposit box only exists for the one that needs it. */}
          <Select
            label={t('payments.title')}
            value={draft.paymentRequirement}
            options={PAYMENT_REQUIREMENTS.map((requirement) => ({
              value: requirement,
              label: tk(`payments.requirement.${requirement}`),
            }))}
            onChange={(paymentRequirement) =>
              setDraft({ ...draft, paymentRequirement: paymentRequirement as PaymentRequirement })
            }
          />

          {draft.paymentRequirement === 'deposit' && (
            <Field
              label={t('services.depositIn', { currency: business.currency })}
              value={draft.deposit}
              onChangeText={(deposit) => setDraft({ ...draft, deposit })}
              keyboardType="decimal-pad"
              hint={t('services.depositHint')}
            />
          )}

          <ToggleRow
            label={t('services.offered')}
            description={t('services.offeredHint')}
            value={draft.isActive}
            onChange={(isActive) => setDraft({ ...draft, isActive })}
          />

          {failure && <Feedback tone="danger" message={failure} />}

          <Button label={t('services.save')} onPress={submit} loading={busy} />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setDraft(null)} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={t('services.title')} subtitle={t('services.subtitle')}>
      <Button label={t('services.add')} onPress={() => edit(EMPTY_DRAFT)} />

      {services.loading && <ActivityIndicator />}
      {services.error && <Feedback tone="danger" message={services.error} />}

      {services.data?.length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            {t('services.noneYet')}
          </Text>
        </Card>
      )}

      <View style={{ gap: spacing.sm }}>
        {(services.data ?? []).map((service) => (
          <Card key={service.id}>
            <Text variant="heading">{service.name}</Text>
            <Text variant="label" tone="accent">
              {format.duration(service.durationMinutes)} {'·'}{' '}
              {format.money(service.price, service.currency)}
            </Text>
            {!service.isActive && (
              <Text variant="caption" tone="muted">
                {t('services.hiddenFromCustomers')}
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
              <Button
                label={t('services.edit')}
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => edit(toDraft(service))}
              />
              {service.isActive && (
                <Button
                  label={t('services.hide')}
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
