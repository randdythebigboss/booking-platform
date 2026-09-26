import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isDemoRegistrationAllowed } from '@/features/auth/validation';

/**
 * One rule about which addresses a demonstration accepts, in two places.
 *
 * The application refuses a non-reserved address in the sign-up form, and
 * `tools/dev/provision-demo-account.mjs` refuses one before it calls the
 * Admin API. The second is the one that matters once public registration is
 * turned off at the Auth level, because it holds the service-role key.
 *
 * They cannot import from each other -- one is TypeScript inside the bundle,
 * the other a standalone Node script that must run with no build step -- so
 * this is what stops them drifting. A rule enforced in two places that
 * disagree is worse than a rule enforced in one.
 */
describe('the reserved-domain rule', () => {
  const tool = readFileSync('tools/dev/provision-demo-account.mjs', 'utf8');
  const app = readFileSync('src/features/auth/validation.ts', 'utf8');

  const patternIn = (source: string): string => {
    const match = /const RESERVED_DOMAINS = (\/.+\/[a-z]*);/.exec(source);
    const literal = match?.[1];
    expect(literal, 'RESERVED_DOMAINS must be a single literal regex').toBeTruthy();
    return literal as string;
  };

  it('is literally the same expression in the app and in the tool', () => {
    expect(patternIn(tool)).toBe(patternIn(app));
  });

  it('agrees on the addresses that matter, evaluated independently', () => {
    // Rebuilt from the tool's own source, so this compares behaviour and not
    // just two identical strings.
    const source = patternIn(tool);
    const body = source.slice(1, source.lastIndexOf('/'));
    const flags = source.slice(source.lastIndexOf('/') + 1);
    const toolRule = (email: string) => {
      const domain = email.trim().toLowerCase().split('@')[1] ?? '';
      return domain.length > 0 && new RegExp(body, flags).test(domain);
    };

    for (const address of [
      'alguien@example.test',
      'demo@bookingplatform.test',
      'a@b.invalid',
      'a@localhost',
      'owner@a-real-salon.com',
      'someone@gmail.com',
      'a@test.com',
      'a@nottest',
    ]) {
      expect(toolRule(address), address).toBe(isDemoRegistrationAllowed(address));
    }
  });

  it('keeps the tool refusing without a service-role key in the repository', () => {
    expect(tool).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(tool).toMatch(/Refusing: set SUPABASE_SERVICE_ROLE_KEY/);
    // The key is read from the environment and never written anywhere.
    expect(tool).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  });

  it('refuses a project that does not call itself development', () => {
    expect(tool).toMatch(/environment !== 'development'/);
  });
});
