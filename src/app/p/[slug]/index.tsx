import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { LanguageSwitcher } from '@/components/language-switcher';
import { Button, Card, Screen, Text } from '@/components/ui';
import { useFormat } from '@/i18n/use-format';
import { isConfigured } from '@/lib/env';
import { fetchPublicBusiness, type PublicBusiness } from '@/services/catalog';
import { spacing } from '@/theme';

type State =
  | { kind: 'unconfigured' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'missing' }
  | { kind: 'ready'; business: PublicBusiness };

export default function PublicBusinessScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t } = useTranslation();
  const format = useFormat();
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
      <Screen
        title={t('publicPage.notFound')}
        subtitle={t('publicPage.noPublishedBusiness', { slug })}
      >
        <Card>
          <Text variant="body" tone="muted">
            {t('publicPage.notFoundBody')}
          </Text>
        </Card>
        <Card>
          <LanguageSwitcher />
        </Card>
      </Screen>
    );
  }

  if (state.kind === 'error') {
    return (
      <Screen title={t('common.somethingWentWrong')}>
        <Card>
          <Text variant="body" tone="danger">
            {t('publicPage.couldNotLoad')}
          </Text>
        </Card>
      </Screen>
    );
  }

  const { business } = state;

  return (
    <Screen title={business.name} subtitle={business.description ?? undefined}>
      {business.phone && (
        <Text variant="caption" tone="muted" selectable>
          {business.phone}
        </Text>
      )}

      {business.address && (
        <Text variant="caption" tone="muted">
          {business.address}
        </Text>
      )}

      {business.professionals.length > 0 && (
        <>
          <Text variant="heading">{t('publicPage.professionals')}</Text>
          <View style={{ gap: spacing.sm }}>
            {business.professionals.map((professional) => (
              <Card key={professional.id}>
                <Text variant="heading">{professional.displayName}</Text>
                {professional.bio && (
                  <Text variant="body" tone="muted">
                    {professional.bio}
                  </Text>
                )}
              </Card>
            ))}
          </View>
        </>
      )}

      <Text variant="heading">{t('publicPage.services')}</Text>
      <View style={{ gap: spacing.sm }}>
        {business.services.map((service) => (
          <Card key={service.id}>
            <Text variant="heading">{service.name}</Text>
            {service.description && (
              <Text variant="body" tone="muted">
                {service.description}
              </Text>
            )}
            <Text variant="label" tone="accent">
              {format.duration(service.durationMinutes)} {'·'}{' '}
              {format.money(service.price, service.currency)}
            </Text>
          </Card>
        ))}
      </View>

      <Link href={`/p/${business.slug}/book`} asChild>
        <Button label={t('publicPage.book')} />
      </Link>

      <Card>
        <LanguageSwitcher />
      </Card>
    </Screen>
  );
}
