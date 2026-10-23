import { parseArgs } from 'node:util';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeAffected, gitChanges } from './affected.mjs';
import { planShards } from './plan.mjs';
import { shardFiles } from './shard.mjs';
import { fetchTimings, loadTimingsFile } from './timings.mjs';

const HELP = `compiler-ci <command> [options]

  shard --total N --index I --runner vitest|jest|playwright   print this shard's test files (I is 1-based)
  plan  --target-minutes M [--runner R]                       suggest a shard count (JSON)
  affected                                                    list affected packages, or "all"

Common: --cwd DIR  --timings FILE  --repo OWNER/NAME  --api-url URL  (token: COMPILER_TOKEN)
shard:  --format lines|json|space      plan: --max-shards N --github-output
affected: --base REF --default-branch NAME --json
Without timings, shard balances by file size and plan assumes 5s per file.`;

const FEATURE_FOR = { shard: 'sharding', plan: 'sharding', affected: 'affected' };

/** Entitlement check; unreachable or unconfigured means allowed. */
async function allowed(command, o, env, fetchFn) {
  const feature = FEATURE_FOR[command];
  const org = o.org ?? env.COMPILER_ORG;
  const api = o['api-url'] ?? env.COMPILER_API_URL;
  if (!feature || !org || !api) return true;
  try {
    const res = await fetchFn(`${api.replace(/\/$/, '')}/v1/app/orgs/${encodeURIComponent(org)}/ci-features`, {
      headers: env.COMPILER_TOKEN ? { authorization: `Bearer ${env.COMPILER_TOKEN}` } : {}, signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return true;
    return (await res.json())[feature] !== false;
  } catch { return true; }
}

async function timingsFor(o, env, fetchFn) {
  if (o.timings) return loadTimingsFile(resolve(o.timings));
  return fetchTimings({ apiUrl: o['api-url'] ?? env.COMPILER_API_URL, repo: o.repo ?? env.GITHUB_REPOSITORY, token: env.COMPILER_TOKEN, fetchFn });
}

/** Runs a command; returns the text for stdout. Throws Error with .exitCode for usage errors. */
export async function run(argv, { env = process.env, fetchFn = globalThis.fetch, log = console.error } = {}) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help') return HELP;
  const { values: o } = parseArgs({
    args: rest, strict: true,
    options: {
      total: { type: 'string' }, index: { type: 'string' }, runner: { type: 'string', default: 'vitest' },
      'target-minutes': { type: 'string' }, 'max-shards': { type: 'string' }, cwd: { type: 'string', default: '.' },
      timings: { type: 'string' }, repo: { type: 'string' }, 'api-url': { type: 'string' }, org: { type: 'string' },
      format: { type: 'string', default: 'lines' }, base: { type: 'string' }, 'default-branch': { type: 'string' },
      json: { type: 'boolean', default: false }, 'github-output': { type: 'boolean', default: false },
    },
  });
  const cwd = resolve(o.cwd);
  const int = (v, name) => { const n = Number(v); if (v === undefined || !Number.isInteger(n)) throw new Error(`--${name} is required and must be an integer`); return n; };

  if (!(await allowed(command, o, env, fetchFn))) throw new Error(`the "${FEATURE_FOR[command]}" feature is not enabled for this organization`);

  if (command === 'shard') {
    const r = shardFiles({ cwd, runner: o.runner, total: int(o.total, 'total'), index: int(o.index, 'index'), timings: await timingsFor(o, env, fetchFn) });
    log(`shard ${o.index}/${o.total}: ${r.files.length} of ${r.totalFiles} files, balanced by ${r.source === 'size' ? 'file size (no timings)' : r.source}`);
    if (o.format === 'json') return JSON.stringify(r.files);
    return o.format === 'space' ? r.files.join(' ') : r.files.join('\n');
  }
  if (command === 'plan') {
    const minutes = Number(o['target-minutes']);
    if (!(minutes > 0)) throw new Error('--target-minutes is required and must be positive');
    const r = planShards({ cwd, runner: o.runner, targetMinutes: minutes, timings: await timingsFor(o, env, fetchFn), maxShards: o['max-shards'] ? Number(o['max-shards']) : 32 });
    if (o['github-output'] && env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `shards=${r.shards}\nmatrix=${JSON.stringify({ shard: r.matrix })}\n`);
    return JSON.stringify({ ...r, matrix: { shard: r.matrix } });
  }
  if (command === 'affected') {
    const g = gitChanges({ cwd, base: o.base, defaultBranch: o['default-branch'] });
    const r = computeAffected({ root: cwd, changedFiles: g.changedFiles, onDefaultBranch: g.onDefaultBranch, mergeBase: g.mergeBase });
    if (r.all) log(`affected: all (${r.reason})`);
    const result = r.all ? { affected: 'all', reason: r.reason } : { affected: r.packages, changed: r.changed, ...(r.vitest ? { vitestArgs: r.vitest } : {}) };
    if (o['github-output'] && env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `affected=${JSON.stringify(result.affected)}\n`);
    if (o.json) return JSON.stringify(result);
    return r.all ? 'all' : r.packages.join('\n');
  }
  throw new Error(`unknown command "${command}"\n\n${HELP}`);
}
