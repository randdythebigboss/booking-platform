import { useTranslation } from 'react-i18next';
import { ActivityIndicator, type ActivityIndicatorProps } from 'react-native';

/**
 * A spinner that says what it is.
 *
 * React Native Web renders `ActivityIndicator` as `div[role="progressbar"]`,
 * and an ARIA progressbar with no accessible name is a serious WCAG failure --
 * a screen reader announces that something is in progress without saying what,
 * or announces nothing at all.
 *
 * It surfaced as an intermittent one: the audit only catches it if it runs
 * while something is still loading, so the violation appeared on the dashboard
 * only once another request was added to that screen. The fix is not to make
 * the audit wait; it is for every spinner in the product to carry a name.
 */
export function Loading(props: ActivityIndicatorProps) {
  const { t } = useTranslation();

  return <ActivityIndicator accessibilityLabel={t('common.loading')} {...props} />;
}
