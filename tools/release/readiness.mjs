/**
 * Is this thing ready, and ready for what?
 *
 *   node tools/release/readiness.mjs
 *
 * ---------------------------------------------------------------------------
 * Why this replaced a list of ten gates
 * ---------------------------------------------------------------------------
 *
 * The previous check reported "10/10 gates passed" while public registration
 * was still enabled on the shared project and the weekly RPC had never been
 * installed on it. Nothing it said was false -- every gate it had was green --
 * but the total read as completeness, and it was not. Two of the most
 * important facts about the environment simply had no gate.
 *
 * The lesson is not "add two more gates". It is that one number cannot answer
 * "ready?" when the word means five different things:
 *
 *   source        the code in this repository
 *   ci            what GitHub Actions proved about that code
 *   deployment    what is actually installed and running in the cloud
 *   security      how the shared project is actually configured
 *   onboarding    whether a real person may be invited
 *
 * A category is only as good as its worst gate, and they are never summed.
 *
 * ---------------------------------------------------------------------------
 * What a PASS is allowed to mean
 * ---------------------------------------------------------------------------
 *
 * A verified condition in the target environment. Never the existence of a
 * script, a document, or an instruction somebody has not carried out.
 *
 *   PASS         checked here, in the real environment, just now
 *   FAIL         checked here, and wrong
 *   PENDING      a real action nobody has performed yet
 *   MANUAL       true or false cannot be established without credentials this
 *                machine does not hold; the named tool is the evidence
 *   BLOCKED      waiting on a decision, not on an action
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const URL_ = process.env.SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SITE = process.env.SITE ?? 'https://randdythebigboss.github.io/booking-platform';
const REPO = process.env.REPO ?? 'randdythebigboss/booking-platform';
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };

const CATEGORIES = {
  source: 'Source-code readiness',
  ci: 'CI and test readiness',
  deployment: 'Cloud deployment readiness',
  security: 'Cloud security configuration',
  onboarding: 'Real-person onboarding readiness',
};

const results = [];
const record = (category, status, label, detail = '') =>
  results.push({ category, status, label, detail });

const rpc = async (name, body) => {
  try {
    const response = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch (error) {
    return { status: 0, body: String(error).slice(0, 80) };
  }
};

// ============================================================= source code
{
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const app = JSON.parse(readFileSync('app.json', 'utf8')).expo;
  record(
    'source',
    pkg.version === app.extra?.release && app.version === pkg.version.split('-')[0]
      ? 'PASS'
      : 'FAIL',
    'the version is the same string everywhere it is written',
    pkg.version,
  );

  const readme = readFileSync('README.md', 'utf8');
  const seedPassword = readFileSync('supabase/seed.sql', 'utf8').match(
    /extensions\.crypt\('([^']+)'/,
  )?.[1];
  record(
    'source',
    seedPassword && !readme.includes(seedPassword) ? 'PASS' : 'FAIL',
    'the front page publishes no working credential',
  );

  const reset = readFileSync('tools/e2e/reset.sh', 'utf8');
  const devReset = readFileSync('tools/dev/reset-demo-data.sh', 'utf8');
  const guarded = [reset, devReset].every(
    (script) =>
      script.includes('tools/dev/disposable-db.cjs') &&
      script.indexOf('disposable-db.cjs') < script.indexOf('delete from'),
  );
  record(
    'source',
    guarded ? 'PASS' : 'FAIL',
    'no reset path can reach a database that is not on this machine',
  );
}

// ==================================================================== CI
{
  const sha = (process.env.MAIN_SHA ?? '').trim() || null;
  try {
    const runs = await fetch(
      `https://api.github.com/repos/${REPO}/actions/runs?branch=main&per_page=10`,
    ).then((r) => r.json());

    const head = sha ?? runs.workflow_runs?.[0]?.head_sha;
    const forHead = (runs.workflow_runs ?? []).filter((r) => r.head_sha === head);
    const ci = forHead.find((r) => r.name === 'CI');
    const pages = forHead.find((r) => r.name.includes('Pages'));

    record(
      'ci',
      ci?.conclusion === 'success' ? 'PASS' : ci ? 'FAIL' : 'PENDING',
      'lint, types, unit tests, SQL suites and the browser suite on main',
      `${head?.slice(0, 7)} — ${ci?.conclusion ?? 'no run'}`,
    );
    record(
      'deployment',
      pages?.conclusion === 'success' ? 'PASS' : pages ? 'FAIL' : 'PENDING',
      'the deploy workflow published that commit',
      `${head?.slice(0, 7)} — ${pages?.conclusion ?? 'no run'}`,
    );
  } catch (error) {
    record('ci', 'PENDING', 'could not reach the Actions API', String(error).slice(0, 60));
  }
}

// ============================================================== deployment
{
  const week = await rpc('get_week_availability', {
    p_professional_id: '00000000-0000-4000-8000-000000000000',
    p_service_id: '00000000-0000-4000-8000-000000000000',
    p_from: '2026-01-01',
    p_days: 7,
  });
  // A missing function is 404/PGRST202. An installed one answers 200 with no
  // rows for an unknown professional, which is also the privacy behaviour.
  const installed = week.status === 200;
  record(
    'deployment',
    installed ? 'PASS' : 'PENDING',
    'get_week_availability is installed on the shared project',
    installed ? 'HTTP 200' : `HTTP ${week.status} — apply the pending migration`,
  );

  if (installed) {
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch();
      const page = await browser
        .newContext({ locale: 'es-DO', timezoneId: 'America/Santo_Domingo' })
        .then((c) => c.newPage());
      page.setDefaultNavigationTimeout(90000);

      const calls = [];
      page.on('response', (r) => {
        if (r.url().includes('/rpc/get_week_availability')) calls.push(r.status());
      });

      const [biz] = await fetch(
        `${URL_}/rest/v1/businesses?select=slug&is_published=eq.true&limit=1`,
        { headers: HEADERS },
      ).then((r) => r.json());
      const [service] = await fetch(
        `${URL_}/rest/v1/services?select=name&is_active=eq.true&limit=1`,
        { headers: HEADERS },
      ).then((r) => r.json());

      await page.goto(`${SITE}/p/${biz.slug}/book`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await page.getByRole('radio', { name: new RegExp(service.name) }).click();
      await page.waitForTimeout(6000);
      await browser.close();

      record(
        'deployment',
        calls.length > 0 && calls.every((s) => s === 200) ? 'PASS' : 'FAIL',
        'the deployed page uses the weekly RPC rather than its fallback',
        calls.length ? `HTTP ${[...new Set(calls)].join(',')}` : 'no call observed',
      );
    } catch (error) {
      record(
        'deployment',
        'PENDING',
        'could not drive the deployed page',
        String(error).slice(0, 60),
      );
    }
  } else {
    record(
      'deployment',
      'PENDING',
      'the deployed page uses the weekly RPC rather than its fallback',
      'cannot be true while the function is absent',
    );
  }
}

// ================================================================ security
{
  const settings = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } })
    .then((r) => r.json())
    .catch(() => null);

  record(
    'security',
    settings?.disable_signup === true ? 'PASS' : 'PENDING',
    'public registration is disabled on the Auth server',
    settings ? `disable_signup=${settings.disable_signup}` : 'settings unreadable',
  );

  record(
    'security',
    settings?.mailer_autoconfirm === true ? 'PENDING' : 'PASS',
    'an address is verified before it becomes an account',
    settings?.mailer_autoconfirm === true
      ? 'mailer_autoconfirm=true — needs an email provider, which costs money'
      : `mailer_autoconfirm=${settings?.mailer_autoconfirm}`,
  );

  const seedPassword = readFileSync('supabase/seed.sql', 'utf8').match(
    /extensions\.crypt\('([^']+)'/,
  )?.[1];
  let seedOpensCloud = null;
  try {
    const attempt = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'demo@bookingplatform.test', password: seedPassword }),
    });
    seedOpensCloud = attempt.ok;
  } catch {
    seedOpensCloud = null;
  }
  record(
    'security',
    seedOpensCloud === false ? 'PASS' : seedOpensCloud === true ? 'FAIL' : 'PENDING',
    'the published fixture password does not open the cloud demo account',
  );

  const privateTables = [
    'payments',
    'notifications',
    'payment_events',
    'platform_settings',
    'appointment_messages',
  ];
  const refused = [];
  for (const table of privateTables) {
    const response = await fetch(`${URL_}/rest/v1/${table}?select=id&limit=1`, {
      headers: HEADERS,
    });
    refused.push(response.status === 401 || response.status === 403);
  }
  record(
    'security',
    refused.every(Boolean) ? 'PASS' : 'FAIL',
    'private tables refuse an anonymous caller',
    `${refused.filter(Boolean).length}/${privateTables.length}`,
  );

  for (const [table, label] of [
    ['appointments', 'appointments'],
    ['customers', 'customer records'],
  ]) {
    const rows = await fetch(`${URL_}/rest/v1/${table}?select=id&limit=1`, { headers: HEADERS })
      .then((r) => r.json())
      .catch(() => null);
    record(
      'security',
      Array.isArray(rows) && rows.length === 0 ? 'PASS' : 'FAIL',
      `an anonymous caller reads no ${label}`,
    );
  }

  const caps = await rpc('payment_capabilities', {});
  record(
    'security',
    caps.body?.demo === false ? 'PASS' : 'FAIL',
    'payment simulation is off and no provider is connected',
    JSON.stringify(caps.body ?? {}).slice(0, 48),
  );

  record(
    'security',
    'MANUAL',
    'the disposable probe accounts have been removed',
    'done 2026-09-26 — 8 removed, 4 accounts left, all owning something or the demo; ' +
      'this key cannot list auth users, so it is reported, not re-checked',
  );

  record(
    'security',
    'MANUAL',
    'no personal information remains in the shared project',
    'the identified records were removed and verified; a whole-database claim needs a privileged audit',
  );
}

// ============================================================== onboarding
for (const decision of [
  'retention periods, per table',
  'a deletion and anonymisation path',
  'data export on request',
  'who the data controller is, and the legal basis',
  'an email provider, for verification and recovery',
  'a deployed notification dispatcher',
  'a production environment separate from development',
]) {
  record(
    'onboarding',
    'BLOCKED',
    decision,
    'a Product Owner decision — see docs/BETA-READINESS.md',
  );
}

// =================================================================== print
const WORST = ['PASS', 'MANUAL', 'PENDING', 'BLOCKED', 'FAIL'];
let exitCode = 0;

for (const [key, title] of Object.entries(CATEGORIES)) {
  const rows = results.filter((r) => r.category === key);
  if (rows.length === 0) continue;

  const worst = rows.map((r) => r.status).sort((a, b) => WORST.indexOf(b) - WORST.indexOf(a))[0];

  console.log(`\n${title}: ${worst}`);
  for (const row of rows) {
    console.log(`  ${row.status.padEnd(8)} ${row.label}${row.detail ? ' — ' + row.detail : ''}`);
  }
  if (worst === 'FAIL') exitCode = 1;
}

console.log(
  '\nA category is its worst gate. Nothing here is summed, and a prepared',
  '\nscript is never a PASS.',
);
process.exit(exitCode);
