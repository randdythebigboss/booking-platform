import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isDisposable, isLoopback } = require('../../tools/dev/disposable-db.cjs') as {
  isDisposable: (url: string, env?: Record<string, string | undefined>) => boolean;
  isLoopback: (url: string) => boolean;
};

/**
 * The gate that stops a reset handing a shared project to the internet.
 *
 * Both reset scripts delete every fixture account and reload
 * `supabase/seed.sql`, which recreates the demo professional with the password
 * published in this repository. Aiming one at the shared Supabase project
 * would put that password back.
 *
 * The old gate asked the database what it was and accepted `development`. The
 * shared project answers `development`, truthfully, so the gate never fired.
 * This one asks where the database is instead.
 */
describe('isDisposable', () => {
  it('allows the local stack the Supabase CLI starts', () => {
    expect(isDisposable('postgresql://postgres:postgres@127.0.0.1:54322/postgres')).toBe(true);
    expect(isDisposable('postgresql://postgres@localhost:55432/booking')).toBe(true);
    expect(isDisposable('postgresql://postgres@[::1]:5432/postgres')).toBe(true);
  });

  it('refuses the shared cloud project, which is the whole point', () => {
    expect(
      isDisposable('postgresql://postgres:x@db.qqzzscfrbotsoizfabvw.supabase.co:5432/postgres'),
    ).toBe(false);
    expect(isDisposable('postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres')).toBe(
      false,
    );
  });

  it('reads a libpq keyword string as well as a URL', () => {
    expect(isDisposable('host=127.0.0.1 port=54322 dbname=postgres')).toBe(true);
    expect(isDisposable('host=db.example.supabase.co port=5432 dbname=postgres')).toBe(false);
  });

  it('treats a socket or bare database name as local', () => {
    expect(isLoopback('postgres')).toBe(true);
    expect(isLoopback('dbname=postgres')).toBe(true);
  });

  /** Deliberate, typed, and the moment to read the URL again. */
  it('lets somebody override it on purpose', () => {
    const remote = 'postgresql://u:p@db.example.supabase.co:5432/postgres';
    expect(isDisposable(remote, {})).toBe(false);
    expect(isDisposable(remote, { ALLOW_REMOTE_RESET: 'yes' })).toBe(true);
    // Anything other than the exact word is not an override.
    expect(isDisposable(remote, { ALLOW_REMOTE_RESET: 'true' })).toBe(false);
  });

  it('is wired into every destructive script, before it touches anything', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs') as typeof import('node:fs');

    // Each entry: the script, and the first thing in it that destroys data.
    const guarded: [string, string][] = [
      ['tools/e2e/reset.sh', 'delete from'],
      ['tools/dev/reset-demo-data.sh', 'delete from'],
      // This one drops a whole database, which is worse than any delete.
      ['tools/local-postgres/run-validation.sh', 'drop database'],
    ];

    for (const [script, destructive] of guarded) {
      const text = readFileSync(script, 'utf8');
      expect(text, `${script} must call the gate`).toContain('tools/dev/disposable-db.cjs');
      expect(
        text.indexOf('disposable-db.cjs'),
        `${script} must call the gate before "${destructive}"`,
      ).toBeLessThan(text.indexOf(destructive));
    }
  });
});
