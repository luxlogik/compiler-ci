import { discover } from './discover.mjs';
import { lpt } from './lpt.mjs';
import { weigh } from './timings.mjs';

/**
 * Smallest shard count whose LPT-balanced slowest shard fits the target. With no timings the
 * per-file time is assumed (default 5s) and the result is marked source "estimate".
 */
export function planShards({ cwd, runner, targetMinutes, timings, files, maxShards = 32, assumeSecondsPerFile = 5, overheadSeconds = 0 }) {
  if (!(targetMinutes > 0)) throw new Error('--target-minutes must be a positive number');
  const list = files ?? discover(cwd, runner);
  if (list.length === 0) return { shards: 1, matrix: [1], source: 'none', totalSeconds: 0, slowestSeconds: 0, files: 0 };
  const w = weigh(list, timings ?? new Map(), cwd);
  const items = w.source === 'size' ? list.map((file) => ({ file, weight: assumeSecondsPerFile })) : w.items;
  const source = w.source === 'size' ? 'estimate' : w.source;
  const budget = targetMinutes * 60 - overheadSeconds;
  const cap = Math.max(1, Math.min(maxShards, list.length));
  let n = Math.max(1, Math.min(cap, Math.ceil(items.reduce((s, i) => s + i.weight, 0) / Math.max(budget, 1))));
  let bins = lpt(items, n);
  while (Math.max(...bins.map((b) => b.load)) > budget && n < cap) bins = lpt(items, ++n);
  const slowest = Math.max(...bins.map((b) => b.load));
  return {
    shards: n, matrix: Array.from({ length: n }, (_, i) => i + 1), source, files: list.length,
    totalSeconds: Math.round(items.reduce((s, i) => s + i.weight, 0)), slowestSeconds: Math.round(slowest),
    fitsTarget: slowest <= budget,
  };
}
