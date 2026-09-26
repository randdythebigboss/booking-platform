/**
 * Creates one fictional account on a development project, on purpose.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... node tools/dev/provision-demo-account.mjs alguien@example.test "Alguien Demo"
 *   ... node tools/dev/provision-demo-account.mjs alguien@example.test "Alguien Demo" --out C:/path/cred.txt
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * The hosted demonstration had public sign-up on with email confirmation off,
 * so GoTrue issued a usable session for any address, owned or not. Nobody
 * could reach anybody else's data that way -- appointments are claimed with
 * the booking credential and the database enforces it -- but somebody could
 * register `owner@a-real-salon.com` and, to a human reading the screen, be
 * them.
 *
 * The server-side fix is to turn public registration off. The cost is that
 * nobody can create the fictional accounts a demonstration needs. This is that
 * path, kept deliberately narrow:
 *
 *   * it needs the service-role key, supplied at run time and never stored
 *   * it refuses any address that could belong to a real person
 *   * it refuses a project that does not say it is `development`
 *   * it writes the password to a file outside the repository, once
 *
 * Nothing here weakens the server-side posture. It is the key you already
 * hold, used once, with the rules written down.
 *
 * ---------------------------------------------------------------------------
 * What it never does
 * ---------------------------------------------------------------------------
 *
 * Create a business, publish anything, or touch an account that already
 * exists. A new professional still goes through the product's own onboarding,
 * signed in as the account this makes.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * RFC 2606 and RFC 6761 reserved domains. Mail never leaves for these, which
 * is exactly why they are the only addresses a demonstration accepts.
 *
 * Kept identical to `isDemoRegistrationAllowed` in
 * src/features/auth/validation.ts; tests/packaging/demo-domains.test.ts fails
 * if the two ever drift.
 */
const RESERVED_DOMAINS = /(^|\.)(test|example|invalid|localhost)$/i;

function isReserved(email) {
  const domain = String(email).trim().toLowerCase().split('@')[1];
  return Boolean(domain) && RESERVED_DOMAINS.test(domain);
}

const [email, fullName] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const outIndex = process.argv.indexOf('--out');
const outPath =
  outIndex > -1
    ? process.argv[outIndex + 1]
    : `C:/Users/${process.env.USERNAME ?? 'user'}/booking-platform-demo-account.txt`;

const die = (message) => {
  process.stderr.write(message + '\n');
  process.exit(1);
};

if (!email || !fullName) {
  die(
    'Usage: SUPABASE_SERVICE_ROLE_KEY=... node tools/dev/provision-demo-account.mjs <email> "<full name>"',
  );
}

if (!isReserved(email)) {
  die(
    `Refusing: "${email}" is not on a reserved test domain.\n\n` +
      'A demonstration account must use an address that cannot belong to\n' +
      'anybody: .test, .example, .invalid or localhost. Nothing here can\n' +
      'verify a real address, so nothing here accepts one.',
  );
}

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  die(
    'Refusing: set SUPABASE_SERVICE_ROLE_KEY for this command only.\n\n' +
      'Do not put it in .env.local, do not commit it, and do not leave it in\n' +
      'your shell history -- it bypasses every Row Level Security policy in\n' +
      'the project.',
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

// The project has to say it is development. A production project must never
// be reachable by a convenience script, whatever key is in the environment.
const settings = await fetch(`${base}/rest/v1/platform_settings?select=environment`, {
  headers: admin,
});
if (!settings.ok) die(`Refusing: could not read platform_settings (HTTP ${settings.status}).`);
const [row] = await settings.json();
if (row?.environment !== 'development') {
  die(`Refusing: this project says it is "${row?.environment}", not development.`);
}

const exists = await fetch(`${base}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, {
  headers: admin,
}).then((r) => r.json().catch(() => ({})));
if ((exists?.users ?? []).some((u) => u.email?.toLowerCase() === email.toLowerCase())) {
  die(`Refusing: ${email} already exists. This never touches an existing account.`);
}

// 32 bytes of urlsafe base64: nothing derived from the address or the repo.
const password = randomBytes(32).toString('base64url');

const created = await fetch(`${base}/auth/v1/admin/users`, {
  method: 'POST',
  headers: admin,
  body: JSON.stringify({
    email,
    password,
    // Confirmed on creation, because there is no mail provider to confirm it
    // and this address cannot receive mail by design.
    email_confirm: true,
    user_metadata: { full_name: fullName },
  }),
});

if (!created.ok) {
  die(
    `Could not create the account (HTTP ${created.status}): ${(await created.text()).slice(0, 200)}`,
  );
}

const user = await created.json();

writeFileSync(
  outPath,
  [
    'Booking platform — fictional demonstration account',
    `project: ${base}`,
    '',
    `email:    ${email}`,
    `password: ${password}`,
    `name:     ${fullName}`,
    `user id:  ${user.id}`,
    '',
    'Created deliberately because public registration is disabled on this',
    'project. Move this into your password manager and delete this file.',
    '',
  ].join('\n'),
  'utf8',
);

process.stdout.write(
  `Created ${email} (${user.id}).\nThe password is in ${outPath} — move it to your password manager and delete the file.\n`,
);
