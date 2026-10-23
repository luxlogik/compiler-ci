import { discover } from './discover.mjs';
import { lpt } from './lpt.mjs';
import { weigh } from './timings.mjs';

/** Files for shard `index` (1-based) of `total`. */
export function shardFiles({ cwd, runner, total, index, timings, files }) {
  if (!Number.isInteger(total) || total < 1) throw new Error('--total must be a positive integer');
  if (!Number.isInteger(index) || index < 1 || index > total) throw new Error(`--index must be between 1 and ${total}`);
  const list = files ?? discover(cwd, runner);
  const { items, source } = weigh(list, timings ?? new Map(), cwd);
  const bins = lpt(items, total);
  return { files: bins[index - 1].files, source, load: bins[index - 1].load, totalFiles: list.length };
}
