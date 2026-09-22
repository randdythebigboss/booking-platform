import { useCallback } from 'react';
import { useDynamicT } from './use-dynamic-t';

import type { ValidationIssue } from '@/features/validation';

/**
 * Turns a validation issue into a sentence in the current language.
 *
 * Validators emit `{ code: 'password.tooShort', values: { min: 8 } }`. The
 * constant lives with the rule, the wording lives with the language, and
 * neither has to know about the other.
 */
export function useIssueText(): (issue: ValidationIssue | undefined) => string | undefined {
  const t = useDynamicT();

  return useCallback(
    (issue: ValidationIssue | undefined) => {
      if (!issue) return undefined;
      // The code is built at runtime from a domain constant, so it cannot be
      // narrowed to a key literal here. The parity test is what guarantees
      // every code a validator can emit has an entry in both dictionaries.
      return t(`validation.${issue.code}`, issue.values ?? {});
    },
    [t],
  );
}
