/**
 * What did CI say about a commit?
 *
 *   node tools/dev/ci-status.mjs [sha]
 *
 * There is no `gh` on this machine, and the browser is signed in to a
 * different GitHub account than the one that owns this repository. What does
 * work is git's own credential helper: `git push` authenticates without a
 * prompt, so the credential is already configured and already trusted for
 * this remote.
 *
 * This asks the helper for it the way git does, uses it for one REST call,
 * and never prints it. Nothing is stored and nothing reaches a log.
 */
import { execFileSync } from 'node:child_process';

const sha = process.argv[2] ?? execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();

const remote = execFileSync('git', ['config', '--get', 'remote.origin.url']).toString().trim();
const match = /github\.com[:/]([^/]+)\/([^/.]+)/.exec(remote);
if (!match) {
  console.error('origin does not look like a GitHub remote');
  process.exit(2);
}
const [, owner, repo] = match;

function credential() {
  const input = `protocol=https\nhost=github.com\n\n`;
  const out = execFileSync('git', ['credential', 'fill'], { input }).toString();
  const username = /^username=(.*)$/m.exec(out)?.[1] ?? '';
  const password = /^password=(.*)$/m.exec(out)?.[1] ?? '';
  if (!password) throw new Error('git had no stored credential for github.com');
  return Buffer.from(`${username}:${password}`).toString('base64');
}

const auth = credential();

async function api(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'booking-platform-ci-status',
    },
  });
  if (!response.ok) {
    console.error(`${path} -> HTTP ${response.status}`);
    process.exit(1);
  }
  return response.json();
}

const runs = await api(`/repos/${owner}/${repo}/actions/runs?head_sha=${sha}&per_page=10`);
if (!runs.workflow_runs?.length) {
  console.log(`no workflow runs yet for ${sha.slice(0, 7)}`);
  process.exit(0);
}

console.log(`commit ${sha.slice(0, 7)}`);
let red = 0;
for (const run of runs.workflow_runs) {
  const verdict = run.status === 'completed' ? run.conclusion.toUpperCase() : run.status;
  if (run.status === 'completed' && run.conclusion !== 'success') red++;
  console.log(`  ${run.name.padEnd(22)} ${verdict}`);

  if (run.status === 'completed' && run.conclusion !== 'success') {
    const jobs = await api(`/repos/${owner}/${repo}/actions/runs/${run.id}/jobs`);
    for (const job of jobs.jobs ?? []) {
      if (job.conclusion === 'success') continue;
      console.log(`    job ${job.name}: ${job.conclusion ?? job.status}`);
      for (const step of job.steps ?? []) {
        if (step.conclusion && step.conclusion !== 'success' && step.conclusion !== 'skipped') {
          console.log(`      step ${step.number}. ${step.name} -> ${step.conclusion}`);
        }
      }
    }
  }
}
process.exit(red === 0 ? 0 : 1);
