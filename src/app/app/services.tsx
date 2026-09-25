import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Feedback,
  Field,
  Segmented,
  Text,
  ToggleRow,
} from '@/components/ui';
import { WorkspaceShell } from '@/components/workspace-shell';
import { PAYMENT_REQUIREMENTS, type PaymentRequirement } from '@/features/payments';
import {
  parseNumericInput,
  validateService,
  type ServiceErrors,
} from '@/features/services/validation';
import { useAsyncData } from '@/hooks/use-async-data';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useWorkspaceErrorText } from '@/i18n/use-error-text';
import { useFormat } from '@/i18n/use-format';
import { useIssueText } from '@/i18n/use-issue-text';
import { fetchPaymentCapabilities } from '@/services/payments';
import {
  fetchServices,
  saveService,
  setServiceActive,
  type AdminService,
} from '@/services/service-admin';
import { radius, spacing, useTheme } from '@/theme';

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

/**
 * What a business sells.
 *
 * ---------------------------------------------------------------------------
 * Hidden is not deleted, and the screen now says so
 * ---------------------------------------------------------------------------
 *
 * There is no delete here and there should not be: an appointment from March
 * points at the service it was booked with, and losing that row to tidy up a
 * list would leave history pointing at nothing. Hiding is the whole of it.
 *
 * The previous version implemented that correctly and communicated none of it.
 * *Hide* was a one-way door with no matching *Show*, the only way back was to
 * open the service and find a switch called "Offered to customers", and
 * nothing anywhere said that deleting was not on the menu. Now hidden services
 * have their own section, their own badge, a button that puts them back, and a
 * line under the list explaining why the delete they are looking for is not
 * there.
 */
export default function ServicesScreen() {
  const { business, professional } = useRequiredWorkspace();
  const { t } = useTranslation();
  const tk = useDynamicT();
  const { palette } = useTheme();
  // A service may only ask to be paid where something can take the payment.
  // The database refuses the booking either way; this stops a professional
  // configuring a service that would strand their own customers.
  const capabilities = useAsyncData(() => fetchPaymentCapabilities(), []);
  const canAskForMoney = capabilities.data?.available === true;
  const format = useFormat();
  const issueText = useIssueText();
  const errorText = useWorkspaceErrorText();
  const services = useAsyncData(() => fetchServices(business.id), [business.id]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [errors, setErrors] = useState<ServiceErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = draft !== null && original !== null && JSON.stringify(draft) !== original;
  useUnsavedChanges(dirty);

  function edit(next: Draft) {
    setDraft(next);
    setOriginal(JSON.stringify(next));
    setErrors({});
    setFailure(null);
  }

  async function setVisible(service: AdminService, isActive: boolean) {
    setFailure(null);
    try {
      await setServiceActive(service.id, isActive);
      services.reload();
    } catch (cause) {
      setFailure(errorText(cause));
    }
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
      setOriginal(null);
      services.reload();
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  if (draft) {
    // What the customer will read on the booking page, from the numbers as
    // they stand. Typing 90 and seeing "1 h 30 min" is worth more than a hint.
    const minutes = parseNumericInput(draft.duration);
    const amount = parseNumericInput(draft.price);
    const preview = [
      Number.isFinite(minutes) && minutes > 0 ? format.duration(minutes) : null,
      Number.isFinite(amount) ? format.money(amount, business.currency) : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <WorkspaceShell
        businessName={business.name}
        professionalName={professional?.displayName ?? undefined}
        title={draft.id ? t('services.edit') : t('services.new')}
        subtitle={t('services.formSubtitle')}
        narrow
        action={<Button label={t('services.save')} onPress={submit} loading={busy} />}
        toolbar={
          dirty ? (
            <View
              style={{
                paddingVertical: spacing.xs,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                backgroundColor: palette.warningMuted,
              }}
            >
              <Text variant="caption" style={{ color: palette.warning }}>
                {t('services.unsaved')}
              </Text>
            </View>
          ) : undefined
        }
      >
        <Card>
          <Text variant="overline" tone="muted">
            {t('services.basics')}
          </Text>
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
        </Card>

        <Card>
          <Text variant="overline" tone="muted">
            {t('services.timeAndPrice')}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Field
                label={t('services.durationMinutes')}
                value={draft.duration}
                onChangeText={(duration) => setDraft({ ...draft, duration })}
                keyboardType="number-pad"
                inputMode="numeric"
                error={issueText(errors.durationMinutes)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label={t('services.priceIn', { currency: format.currencyMark(business.currency) })}
                value={draft.price}
                onChangeText={(price) => setDraft({ ...draft, price })}
                keyboardType="decimal-pad"
                inputMode="decimal"
                error={issueText(errors.price)}
              />
            </View>
          </View>
          {preview.length > 0 && (
            <Text variant="caption" tone="muted">
              {t('services.customerSees', { summary: preview })}
            </Text>
          )}
        </Card>

        <Card>
          <Text variant="overline" tone="muted">
            {t('services.gaps')}
          </Text>
          {/* One explanation for both fields, rather than the same sentence
              twice in two different tenses. */}
          <Text variant="caption" tone="muted">
            {t('services.gapsHint')}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Field
                label={t('services.bufferBefore')}
                value={draft.bufferBefore}
                onChangeText={(bufferBefore) => setDraft({ ...draft, bufferBefore })}
                keyboardType="number-pad"
                inputMode="numeric"
                error={issueText(errors.bufferBeforeMinutes)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label={t('services.bufferAfter')}
                value={draft.bufferAfter}
                onChangeText={(bufferAfter) => setDraft({ ...draft, bufferAfter })}
                keyboardType="number-pad"
                inputMode="numeric"
                error={issueText(errors.bufferAfterMinutes)}
              />
            </View>
          </View>
        </Card>

        <Card>
          <Text variant="overline" tone="muted">
            {t('payments.title')}
          </Text>
          {/* What a customer has to pay before this is booked. Three answers,
              and the deposit box only exists for the one that needs it. */}
          {canAskForMoney ? (
            <Segmented
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
          ) : (
            <Text variant="caption" tone="muted">
              {t('payments.policyLocked')}
            </Text>
          )}

          {draft.paymentRequirement === 'deposit' && (
            <Field
              label={t('services.depositIn', { currency: format.currencyMark(business.currency) })}
              value={draft.deposit}
              onChangeText={(deposit) => setDraft({ ...draft, deposit })}
              keyboardType="decimal-pad"
              inputMode="decimal"
              hint={t('services.depositHint')}
            />
          )}
        </Card>

        <Card>
          <Text variant="overline" tone="muted">
            {t('services.visibility')}
          </Text>
          <ToggleRow
            label={t('services.offered')}
            description={t('services.offeredHint')}
            value={draft.isActive}
            onChange={(isActive) => setDraft({ ...draft, isActive })}
          />
        </Card>

        {failure && <Feedback tone="danger" message={failure} />}

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button label={t('services.save')} onPress={submit} loading={busy} style={{ flex: 1 }} />
          <Button
            label={t('common.cancel')}
            variant="ghost"
            onPress={() => {
              setDraft(null);
              setOriginal(null);
            }}
          />
        </View>
      </WorkspaceShell>
    );
  }

  const rows = services.data ?? [];
  const offered = rows.filter((service) => service.isActive);
  const hidden = rows.filter((service) => !service.isActive);

  return (
    <WorkspaceShell
      businessName={business.name}
      professionalName={professional?.displayName ?? undefined}
      title={t('services.title')}
      subtitle={t('services.subtitle')}
      narrow
      action={<Button label={t('services.add')} onPress={() => edit(EMPTY_DRAFT)} />}
    >
      {services.loading && <ActivityIndicator />}
      {services.error && <Feedback tone="danger" message={services.error} />}
      {failure && <Feedback tone="danger" message={failure} />}

      {!services.loading && rows.length === 0 && (
        <Card>
          <EmptyState
            mark="✂"
            title={t('services.noneYet')}
            action={
              <Button
                label={t('services.add')}
                variant="secondary"
                size="compact"
                onPress={() => edit(EMPTY_DRAFT)}
              />
            }
          />
        </Card>
      )}

      {offered.length > 0 && (
        <Card style={{ paddingVertical: spacing.xs }}>
          {offered.map((service, position) => (
            <ServiceRow
              key={service.id}
              service={service}
              summary={`${format.duration(service.durationMinutes)} · ${format.money(service.price, service.currency)}`}
              warning={
                service.paymentRequirement !== 'none' && !canAskForMoney
                  ? t('payments.unavailableService')
                  : undefined
              }
              onEdit={() => edit(toDraft(service))}
              onToggle={() => setVisible(service, false)}
              toggleLabel={t('services.hide')}
              divider={position < offered.length - 1}
            />
          ))}
        </Card>
      )}

      {hidden.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <Text variant="overline" tone="muted">
            {t('services.hiddenSection')}
          </Text>
          <Card style={{ paddingVertical: spacing.xs }}>
            {hidden.map((service, position) => (
              <ServiceRow
                key={service.id}
                service={service}
                summary={`${format.duration(service.durationMinutes)} · ${format.money(service.price, service.currency)}`}
                badge={t('services.hiddenBadge')}
                onEdit={() => edit(toDraft(service))}
                onToggle={() => setVisible(service, true)}
                toggleLabel={t('services.show')}
                divider={position < hidden.length - 1}
              />
            ))}
          </Card>
        </View>
      )}

      {rows.length > 0 && (
        <Text variant="caption" tone="muted">
          {t('services.neverDeleted')}
        </Text>
      )}
    </WorkspaceShell>
  );
}

/** One service: what it is, and the two things you can do to it. */
function ServiceRow({
  service,
  summary,
  badge,
  warning,
  onEdit,
  onToggle,
  toggleLabel,
  divider,
}: {
  service: AdminService;
  summary: string;
  badge?: string;
  warning?: string;
  onEdit: () => void;
  onToggle: () => void;
  toggleLabel: string;
  divider: boolean;
}) {
  const { palette } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.sm,
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: palette.borderSubtle,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${service.name}. ${summary}`}
        onPress={onEdit}
        style={{ flex: 1, gap: 2, minHeight: 44, justifyContent: 'center' }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
            {service.name}
          </Text>
          {badge && <Badge label={badge} tone="neutral" mark="–" />}
        </View>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {summary}
        </Text>
        {warning && (
          <Text variant="caption" tone="danger" numberOfLines={2}>
            {warning}
          </Text>
        )}
      </Pressable>

      <Button label={toggleLabel} variant="ghost" size="compact" onPress={onToggle} />
    </View>
  );
}
