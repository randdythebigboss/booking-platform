import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components/ui';
import { isConfigured } from '@/lib/env';
import { formatDuration, formatMoney } from '@/lib/format';
import { fetchPublicBusiness, type PublicBusiness } from '@/services/catalog';
import { spacing } from '@/theme';

type State =
  | { kind: 'unconfigured' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'missing' }
  | { kind: 'ready'; business: PublicBusiness };

export default function PublicBusinessScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
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
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.kind === 'loading') {
    return (
      <Screen title="Loading">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (state.kind === 'unconfigured') {
    return (
      <Screen title="Booking page" subtitle={`/p/${slug}`}>
        <Card>
          <Text variant="heading">Supabase is not configured</Text>
          <Text variant="body" tone="muted">
            This page reads live data. Copy .env.example to .env.local, point it at a Supabase
            project with the migrations applied, and reload.
          </Text>
        </Card>
      </Screen>
    );
  }

  if (state.kind === 'missing') {
    return <Screen title="Page not found" subtitle={`No published business at /p/${slug}.`} />;
  }

  if (state.kind === 'error') {
    return (
      <Screen title="Something went wrong">
        <Card>
          <Text variant="body" tone="danger">
            {state.message}
          </Text>
        </Card>
      </Screen>
    );
  }

  const { business } = state;

  return (
    <Screen title={business.name} subtitle={business.description ?? undefined}>
      {business.address && (
        <Text variant="caption" tone="muted">
          {business.address}
        </Text>
      )}

      <Text variant="heading">Services</Text>
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
              {formatDuration(service.durationMinutes)} {'·'}{' '}
              {formatMoney(service.price, service.currency)}
            </Text>
          </Card>
        ))}
      </View>

      <Link href={`/p/${business.slug}/book`} asChild>
        <Button label="Book an appointment" />
      </Link>
    </Screen>
  );
}
