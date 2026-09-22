# 0017 - Spanish is the source language, and the type system enforces parity

**Date:** 2026-09-24
**Status:** Accepted

## Context

The product became multilingual: Spanish primary, English secondary, and more
languages later without a rewrite.

The usual failure of a bilingual product is not a missing translation. It is a
half-translated screen nobody notices, because the fallback renders the other
language mid-sentence and everything still "works".

## Decision

**i18next + react-i18next + expo-localization.** Mature, small, works on web,
iOS and Android, and brings plural rules from `Intl.PluralRules` so neither
language gets English's rules by accident.

**Spanish is the source, not a translation.** `src/locales/es` is the
canonical dictionary. `src/locales/en` is declared as `Translations`, which is
`typeof es` with its string values widened, so:

- a key added to Spanish and forgotten in English fails the typecheck
- a key invented in English that Spanish does not have fails too, by excess
  property checking

`t()` is key-checked as well, through i18next's `CustomTypeOptions`. A typo in
a key is a compile error rather than a string that renders as its own name.

The few keys built at runtime — a status, an actor, a validation code — go
through one named helper, `useDynamicT`, and are covered by a parity test that
walks every enum value and every error code and fails if either dictionary is
missing a cell.

**Unsupported languages fall back to Spanish.** A Japanese browser gets
Spanish. English is the other language the product speaks, not the default it
retreats to. A browser asking for `ja, fr, en` does get English, because it
genuinely prefers English to nothing.

**The domain speaks in codes, not sentences.** Validators return
`{ code: 'password.tooShort', values: { min: 8 } }`. `BookingError` and
`WorkspaceError` carry only their code; `Error.message` is the code, which is
what a log wants and what no screen renders. Statuses, actions, actors and
weekdays are keys. This is the same discipline the database has followed since
Phase 0 by raising `SLOT_TAKEN` rather than a message, extended up the stack.

**The actor is part of a history key, not a value in it.** "You booked" and
"The customer booked" share a verb form in English and do not in Spanish --
"Reservaste" against "El cliente reservó". Interpolating the actor produced
"Tú reservó esta cita", which is wrong. Each actor gets its own key so each
language writes its own sentence.

## Consequences

**Web rendering is deterministic.** i18next initialises synchronously in
Spanish and `LocaleProvider` applies the resolved language after mount. Expo
Router static-renders every web route at build time, where there is no visitor
and no browser locale; resolving at module load would render one language on
the server and hydrate with another. The cost is a brief flash of Spanish for
an English-speaking visitor on first load, which is the right trade against a
hydration mismatch on every page.

**Business content is never translated.** A business name, a service name, a
note and a cancellation reason are shown exactly as they were entered. The
data model could carry translated variants later -- nothing here forecloses it
-- but this phase translates the product interface and nothing else.

**Formatting is locale-aware without touching timezone authority.** Every
formatter takes the locale and the business timezone as separate arguments and
neither can supply the other. That separation is the point: a screen reaching
for a language must not quietly reach for the device's timezone too.

**Adding a language is one file plus one line.** Write `src/locales/pt`, typed
as `Translations` so the compiler lists what is missing, and add `'pt'` to
`SUPPORTED_LOCALES`. Nothing in the database changes, because
`profiles.preferred_locale` is constrained to the shape of a language tag
rather than to a list of the languages that exist today.
