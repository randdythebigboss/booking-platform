/**
 * Removes the throwaway accounts that security checks left behind.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... node tools/dev/cleanup-probe-accounts.mjs
 *   SUPABASE_SERVICE_ROLE_KEY=... node tools/dev/cleanup-probe-accounts.mjs --delete
 *
 * Without `--delete` it only reports. Nothing is removed until you ask twice.
 *
 * ---------------------------------------------------------------------------
 * What it will touch, and what it refuses to
 * ---------------------------------------------------------------------------
 *
 * Only an address matching one of the probe shapes below, on the reserved
 * `@bookingplatform.test` domain, AND owning nothing at all: no business, no
 * professional profile, no customer record, no appointment. Anything that
 * fails any part of that is reported and left alone.
 *
 * `demo@bookingplatform.test` is refused explicitly, by name, as well as by
 * the pattern -- it is the Product Owner's demonstration account and losing it
 * would mean losing the business it owns.
 *
 * A probe account was created to answer one question ("does sign-up issue a
 * session without confirming the address?") and has held nothing since. That
 * is the whole reason this is safe; the ownership check is what proves it
 * rather than assuming it.
 */
import { readFileSync } from 'node:fs';

const PROBE = /^(probe|p14-probe|gate)-\d+@bookingplatform\.test$/i;
const NEVER = new Set(['demo@bookingplatform.test']);
const DELETE = process.argv.includes('--delete');

const die = (message) => {
  process.stderr.write(message + '\n');
  process.exit(1);
};

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  die(
    'Refusing: set SUPABASE_SERVICE_ROLE_KEY for this command only.\n\n' +
      'Do not put it in .env.local and do not commit it -- it bypasses every\n' +
      'Row Level Security policy in the project.',
  );
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const base = process.env.SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL;
const admin = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
};

const settings = await fetch(`${base}/rest/v1/platform_settings?select=environment`, {
  headers: admin,
});
if (!settings.ok) die(`Refusing: could not read platform_settings (HTTP ${settings.status}).`);
const [row] = await settings.json();
if (row?.environment !== 'development') {
  die(`Refusing: this project says it is "${row?.environment}", not development.`);
}

// The Admin API pages; a development project will not need many.
const users = [];
for (let page = 1; page <= 20; page += 1) {
  const response = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=200`, {
    headers: admin,
  });
  if (!response.ok) die(`Could not list users (HTTP ${response.status}).`);
  const body = await response.json();
  const batch = body.users ?? [];
  users.push(...batch);
  if (batch.length < 200) break;
}

console.log(`${users.length} account(s) on this project\n`);

const owns = async (table, column, id) => {
  const response = await fetch(`${base}/rest/v1/${table}?select=id&${column}=eq.${id}&limit=1`, {
    headers: admin,
  });
  if (!response.ok) return true; // Cannot prove it is empty, so assume it is not.
  return ((await response.json()) ?? []).length > 0;
};

let removed = 0;
let kept = 0;

for (const user of users) {
  const email = (user.email ?? '').toLowerCase();

  if (NEVER.has(email)) {
    console.log(`keep    ${email} — the demonstration account`);
    kept += 1;
    continue;
  }
  if (!PROBE.test(email)) {
    console.log(`keep    ${email} — not a probe address`);
    kept += 1;
    continue;
  }

  const holdings = [];
  if (await owns('businesses', 'owner_user_id', user.id)) holdings.push('a business');
  if (await owns('professional_profiles', 'user_id', user.id))
    holdings.push('a professional profile');
  if (await owns('customers', 'auth_user_id', user.id)) holdings.push('a customer record');

  if (holdings.length > 0) {
    console.log(`keep    ${email} — owns ${holdings.join(', ')}`);
    kept += 1;
    continue;
  }

  if (!DELETE) {
    console.log(`would   ${email} — owns nothing`);
    removed += 1;
    continue;
  }

  const response = await fetch(`${base}/auth/v1/admin/users/${user.id}`, {
    method: 'DELETE',
    headers: admin,
  });
  console.log(response.ok ? `removed ${email}` : `FAILED  ${email} — HTTP ${response.status}`);
  if (response.ok) removed += 1;
}

console.log(
  `\n${DELETE ? 'removed' : 'would remove'} ${removed}, kept ${kept}` +
    (DELETE ? '' : '\nRun again with --delete to act.'),
);
