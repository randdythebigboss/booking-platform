import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The narrow seam through which a test may touch the database directly.
 *
 * Almost nothing should. A test that sets up its state with SQL and then
 * asserts it with SQL has proved something about SQL. These helpers exist for
 * the two jobs the browser genuinely cannot do: flipping a server-side switch
 * that the product deliberately never exposes to a client, and reading back a
 * fact the UI does not display.
 *
 * `E2E_DB_URL` must name the same database the application is pointed at.
 */

const psql = process.env.PSQL ?? 'psql';
const url = process.env.E2E_DB_URL;

/**
 * Runs one statement through psql, via a UTF-8 file rather than an argument.
 *
 * `-c "... 'Lucía' ..."` looks simpler and is wrong on Windows: the accented
 * character is transcoded to the console code page somewhere between Node's
 * argument list and the process, and PostgreSQL rejects the result as an
 * invalid UTF-8 byte sequence. The product's demo data is Spanish, so this is
 * not an edge case -- it is most of the names in it.
 *
 * A file has an encoding that everyone agrees on.
 */
function run(sql: string): string {
  if (!url) {
    throw new Error('E2E_DB_URL is not set. See tools/e2e/run.sh.');
  }

  const file = join(tmpdir(), `bp-e2e-${randomUUID()}.sql`);

  try {
    writeFileSync(file, sql, 'utf8');
    return execFileSync(psql, [url, '-tAf', file], {
      encoding: 'utf8',
      env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
    }).trim();
  } finally {
    rmSync(file, { force: true });
  }
}

/** A single value, as text. */
export function query(sql: string): string {
  return run(sql);
}

/** How many rows match. Saves writing `select count(*)` twelve times. */
export function count(from: string, where: string): number {
  return Number(run(`select count(*) from ${from} where ${where}`));
}

/**
 * Turns the demo payment provider on or off.
 *
 * This is a server-side switch with no client route to it -- which is the
 * whole point of it, and why a test that wants it on has to reach around the
 * application to say so.
 */
export function setPaymentSimulation(enabled: boolean): void {
  run(`update public.platform_settings set payment_simulation_enabled = ${enabled}`);
}

/**
 * Puts the database back to the fixtures, before every single test.
 *
 * Not caution: necessity. The seeded professional works 09:00 to 18:00, and a
 * suite that books a dozen appointments into the same day eventually meets
 * "no hay horas disponibles" -- at which point tests start failing in the
 * order they happen to run in, which is the least debuggable failure there is.
 *
 * Reloading the seed costs a fraction of a second. Sharing state costs an
 * afternoon.
 */
export function resetDatabase(): void {
  if (!url) {
    throw new Error('E2E_DB_URL is not set. See tools/e2e/run.sh.');
  }

  execFileSync('bash', ['tools/e2e/reset.sh'], {
    encoding: 'utf8',
    env: { ...process.env, E2E_DB_URL: url, PSQL: psql },
  });
}
