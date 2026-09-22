/**
 * What this build calls itself.
 *
 * Two numbers exist and they are not the same thing:
 *
 *   `expo.version` is the platform's version. Apple and Google parse it, and
 *   both require plain dotted numerals -- `0.1.0-beta.1` is not a value either
 *   will accept, so this one stays boring.
 *
 *   `expo.extra.release` is what the product calls itself, prerelease tag and
 *   all. It is what a tester quotes in a report and what the release checklist
 *   is written against.
 *
 * `package.json` carries the same release string, and a test asserts the two
 * agree -- they disagreed before this existed, and the diagnostics screen
 * confidently reported a version nobody had ever released.
 */
import Constants from 'expo-constants';

/** The full release name, prerelease tag included. */
export function releaseVersion(): string {
  const extra = Constants.expoConfig?.extra as { release?: unknown } | undefined;
  const release = extra?.release;

  if (typeof release === 'string' && release.length > 0) return release;

  // Falling back to the platform version is better than showing nothing, and
  // it is still true -- just less specific.
  return Constants.expoConfig?.version ?? 'unknown';
}

/** True when this build calls itself a prerelease. */
export function isPrerelease(): boolean {
  return releaseVersion().includes('-');
}
