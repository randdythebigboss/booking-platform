/**
 * What a validator says when something is wrong.
 *
 * A stable code plus the values the sentence needs -- never a sentence. The
 * rules live in the domain and the words live in `src/locales`, so the same
 * rule can be read in Spanish or English without the domain knowing either
 * language exists. It is the same discipline the database already follows by
 * raising `SLOT_TAKEN` rather than a message.
 *
 * `code` indexes `validation.*` in the dictionaries, and a test asserts that
 * every code a validator can emit has an entry in both.
 */
export interface ValidationIssue {
  code: string;
  /** Interpolation for the message, e.g. `{ min: 8 }`. */
  values?: Record<string, string | number>;
}

export function issue(code: string, values?: Record<string, string | number>): ValidationIssue {
  return values ? { code, values } : { code };
}

/** True when any field of an error object carries an issue. */
export function hasIssues(errors: object): boolean {
  return Object.values(errors).some(Boolean);
}
