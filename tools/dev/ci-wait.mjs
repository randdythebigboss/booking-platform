/**
 * Waits for the newest CI run on the current branch and reports it.
 *
 *   node tools/dev/ci-wait.mjs
 *
 * Listing by branch rather than by head_sha on purpose: the head_sha filter
 * returned "no runs" for a commit whose run was plainly queued, and a wait
 * loop built on that never finishes. The branch listing is ordered newest
 * first and has been reliable.
 *
 * Credential handling is the same as ci-status.mjs: git's own helper, one
 * call, never printed.
 */
import { execFileSync } from 'node:child_process';

const remote = execFileSync('git', ['config', '--get', 'remote.origin.url']).toString().trim();
const [, owner, repo] = /github\.com[:/]([^/]+)\/([^/.]+)/.exec(remote) ?? [];
const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
const head = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();

const credentials = execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
}).toString();
const auth = Buffer.from(
  `${/^username=(.*)$/m.exec(credentials)?.[1] ?? ''}:${/^password=(.*)$/m.exec(credentials)?.[1] ?? ''}`,
).toString('base64');

const api = async (path) => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'booking-platform-ci-wait',
    },
  });
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
  return response.json();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = Date.now() + 25 * 60 * 1000;

let run = null;
while (Date.now() < deadline) {
  const { workflow_runs: runs = [] } = await api(
    `/repos/${owner}/${repo}/actions/runs?branch=${branch}&per_page=5`,
  );
  run = runs.find((candidate) => candidate.head_sha === head) ?? null;
  if (run && run.status === 'completed') break;
  process.stdout.write(`  ${head.slice(0, 7)} ${run ? run.status : 'no run yet'}\n`);
  await sleep(30_000);
}

if (!run || run.status !== 'completed') {
  console.log('  gave up waiting; the run had not finished');
  process.exit(2);
}

console.log(`\n  ${head.slice(0, 7)}  ${run.conclusion.toUpperCase()}  ${run.html_url}`);

const { jobs = [] } = await api(`/repos/${owner}/${repo}/actions/runs/${run.id}/jobs`);
for (const job of jobs) {
  console.log(`    ${job.name.padEnd(42)} ${(job.conclusion ?? job.status).toUpperCase()}`);
  if (job.conclusion && job.conclusion !== 'success') {
    for (const step of job.steps ?? []) {
      if (step.conclusion && !['success', 'skipped'].includes(step.conclusion)) {
        console.log(`      step ${step.number}. ${step.name} -> ${step.conclusion}`);
      }
    }
  }
}

process.exit(run.conclusion === 'success' ? 0 : 1);
