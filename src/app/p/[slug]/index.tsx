import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { Button, Card, EmptyState, Initials, Screen, Text } from '@/components/ui';
import { useFormat } from '@/i18n/use-format';
import { isConfigured } from '@/lib/env';
import { fetchPublicBusiness, type PublicBusiness } from '@/services/catalog';
import { radius, spacing, useTheme } from '@/theme';

type State =
  | { kind: 'unconfigured' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'missing' }
  | { kind: 'ready'; business: PublicBusiness };

/**
 * A business's own page: who they are, what they do, and one way in.
 *
 * ---------------------------------------------------------------------------
 * The button was at the bottom
 * ---------------------------------------------------------------------------
 *
 * *Reservar* used to sit below every service, so on a shop with six of them a
 * phone user scrolled past the entire price list to find the only thing the
 * page exists for. It is in the header now, next to the name, and repeated
 * after the services for somebody who read their way down. The services above
 * it are a menu, not a form: choosing one happens on the next screen, and a
 * card that looks pressable but is not was its own small lie.
 */
export default function PublicBusinessScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t } = useTranslation();
  const format = useFormat();
  const { palette } = useTheme();
  const [state, setState] = useState<State>(() =>
    isConfigured() ? { kind: 'loading' } : { kind: 'unconfigured' },
  );

  useEffect(() => {
    if (!isConfigured() || !slug) return;

    let cancelled = false;
    setState({ kind: 'loading' });

    fetchPublicBusiness(slug)
      .then((business) => {
        if (cancelled) return;
        setState(business ? { kind: 'ready', business } : { kind: 'missing' });
      })
      .catch(() => {
        // Deliberately not the raw failure: a customer gets a sentence they
        // can act on, never a database message.
        if (!cancelled) setState({ kind: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.kind === 'loading') {
    return (
      <Screen title={t('common.loading')}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (state.kind === 'unconfigured') {
    return (
      <Screen title={t('publicPage.notFound')} subtitle={`/p/${slug}`}>
        <Card>
          <Text variant="heading">{t('auth.notConfigured')}</Text>
          <Text variant="body" tone="muted">
            {t('publicPage.unconfiguredBody')}
          </Text>
        </Card>
      </Screen>
    );
  }

  if (state.kind === 'missing') {
    return (
      <Screen title={t('publicPage.notFound')}>
        <Card>
          <EmptyState
            mark="?"
            title={t('publicPage.noPublishedBusiness', { slug })}
            body={t('publicPage.notFoundBody')}
          />
        </Card>
      </Screen>
    );
  }

  if (state.kind === 'error') {
    return (
      <Screen title={t('common.somethingWentWrong')}>
        <Card>
          <EmptyState mark="!" title={t('publicPage.couldNotLoad')} />
        </Card>
      </Screen>
    );
  }

  const { business } = state;
  const bookHref = `/p/${business.slug}/book`;

  return (
    <Screen>
      {/* The shop front: mark, name, one line about it, and the way in. */}
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Initials name={business.name} size={64} />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text variant="title">{business.name}</Text>
            {business.description && (
              <Text variant="body" tone="muted">
                {business.description}
              </Text>
            )}
          </View>
        </View>

        <Link href={bookHref} asChild>
          <Button label={t('publicPage.book')} />
        </Link>
        <Text variant="caption" tone="muted">
          {t('publicPage.bookWithUs')}
        </Text>

        {(business.phone || business.address) && (
          <View style={{ gap: spacing.xs }}>
            {business.phone && (
              <DetailRow mark="☎" value={business.phone} label={t('settings.phone')} />
            )}
            {business.address && (
              <DetailRow mark="⌖" value={business.address} label={t('settings.address')} />
            )}
          </View>
        )}
      </View>

      {business.professionals.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <Text variant="heading">{t('publicPage.professionals')}</Text>
          <Card style={{ paddingVertical: spacing.xs }}>
            {business.professionals.map((professional, position) => (
              <View
                key={professional.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  paddingVertical: spacing.sm,
                  borderBottomWidth: position < business.professionals.length - 1 ? 1 : 0,
                  borderBottomColor: palette.borderSubtle,
                }}
              >
                <Initials name={professional.displayName} size={40} tone="neutral" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label">{professional.displayName}</Text>
                  {professional.bio && (
                    <Text variant="caption" tone="muted">
                      {professional.bio}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </Card>
        </View>
      )}

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('publicPage.services')}</Text>
        <Card style={{ paddingVertical: spacing.xs }}>
          {business.services.map((service, position) => (
            <View
              key={service.id}
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: spacing.md,
                paddingVertical: spacing.sm,
                borderBottomWidth: position < business.services.length - 1 ? 1 : 0,
                borderBottomColor: palette.borderSubtle,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label">{service.name}</Text>
                {service.description && (
                  <Text variant="caption" tone="muted">
                    {service.description}
                  </Text>
                )}
              </View>
              {/* Price and length in their own column, right-aligned, so the
                  list reads down as a menu rather than as four paragraphs. */}
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text variant="label">{format.money(service.price, service.currency)}</Text>
                <Text variant="caption" tone="muted">
                  {format.duration(service.durationMinutes)}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      </View>

      {/* Repeated for somebody who read to the end rather than scrolled back. */}
      <Link href={bookHref} asChild>
        <Button label={t('publicPage.book')} variant="secondary" />
      </Link>
    </Screen>
  );
}

/** A phone number or an address, with a mark that makes it scannable. */
function DetailRow({ mark, value, label }: { mark: string; value: string; label: string }) {
  const { palette } = useTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.surfaceMuted,
        }}
      >
        <Text variant="caption" tone="muted">
          {mark}
        </Text>
      </View>
      <Text variant="caption" tone="muted" selectable accessibilityLabel={`${label}: ${value}`}>
        {value}
      </Text>
    </View>
  );
}
