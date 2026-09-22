import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * `t()` for keys that are built at runtime.
 *
 * Most keys are literals, and those go through the normal `t()`, which is
 * key-checked at compile time -- a typo is an error, which is the whole point
 * of typing the dictionary. A few keys are genuinely computed: the status of
 * an appointment, the actor on a history event, the code a validator emitted.
 * Those cannot be literals, so the cast happens here, once, with a name that
 * says what it is, rather than being scattered as `as never` across screens.
 *
 * The safety net for these is the parity test, which walks every status,
 * every actor, every event type and every validation code a validator can
 * emit, and fails if any of them is missing from either dictionary.
 */
export function useDynamicT(): (key: string, values?: Record<string, unknown>) => string {
  const { t } = useTranslation();

  return useCallback(
    (key: string, values?: Record<string, unknown>) => t(key as never, values ?? {}) as string,
    [t],
  );
}
