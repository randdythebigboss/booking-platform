import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The seed's password is a fixture. It is only harmless while the database it
 * unlocks is disposable.
 *
 * ---------------------------------------------------------------------------
 * Why this test exists
 * ---------------------------------------------------------------------------
 *
 * In Phase 12 the seed was loaded into the shared development project, so the
 * account it creates existed in the cloud with the password printed on the
 * front page of a public repository. Anybody who read the README could sign in
 * as the demo professional and read every customer row in it.
 *
 * Changing the password afterwards fixes the account and not the cause: the
 * value is in git history for ever, and the thing that made it easy was that
 * the README stated it at all. So the README does not state it, and this test
 * is what keeps it that way.
 *
 * `docs/DEVELOPMENT.md` is allowed to, because its whole subject is a local
 * stack -- but only next to the sentence that says what the boundary is.
 */
describe('published credentials', () => {
  const SEEDED_PASSWORD = 'demo-password-123';

  it('is not what the seed thinks it is, if somebody changed it', () => {
    // The literal below is asserted against the seed rather than trusted, so
    // that renaming the fixture does not quietly disarm the rest of the file.
    const seed = readFileSync('supabase/seed.sql', 'utf8');
    expect(seed).toContain(`extensions.crypt('${SEEDED_PASSWORD}'`);
  });

  it('never appears on the front page', () => {
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).not.toContain(SEEDED_PASSWORD);
  });

  it('appears in the development guide only beside its boundary', () => {
    const guide = readFileSync('docs/DEVELOPMENT.md', 'utf8');
    if (!guide.includes(SEEDED_PASSWORD)) return;

    expect(guide).toMatch(/fixture, not a secret/i);
    expect(guide).toMatch(/never load .*seed\.sql.* into a shared project/i);
  });

  it('is fenced off in the seed by a warning that names the consequence', () => {
    const seed = readFileSync('supabase/seed.sql', 'utf8');
    expect(seed).toMatch(/NEVER RUN THIS AGAINST A SHARED PROJECT/);
    expect(seed).toMatch(/git history/i);
  });

  it('keeps the E2E fixture in step with the seed', () => {
    // They are the same account. A mismatch is a green unit suite and a red
    // browser suite twenty minutes later.
    const fixtures = readFileSync('e2e/support/fixtures.ts', 'utf8');
    expect(fixtures).toContain(`password: '${SEEDED_PASSWORD}'`);
  });

  it('publishes no other password-shaped literal in the front page', () => {
    const readme = readFileSync('README.md', 'utf8');
    for (const pattern of [/password:\s*\S/i, /passw(or)?d\s*[=:]\s*\S/i]) {
      expect(readme).not.toMatch(pattern);
    }
  });
});
