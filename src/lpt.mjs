// Greedy longest-processing-time-first balancing. Deterministic: ties break by name, then lowest bin.

/**
 * @param {{file: string, weight: number}[]} items
 * @param {number} n number of bins (>= 1)
 * @returns {{files: string[], load: number}[]} n bins; each bin's files are sorted by name
 */
export function lpt(items, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`shard count must be a positive integer, got ${n}`);
  const bins = Array.from({ length: n }, () => ({ files: [], load: 0 }));
  const sorted = [...items].sort((a, b) => b.weight - a.weight || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  for (const it of sorted) {
    let best = 0;
    for (let i = 1; i < n; i++) if (bins[i].load < bins[best].load) best = i;
    bins[best].files.push(it.file);
    bins[best].load += it.weight;
  }
  for (const b of bins) b.files.sort();
  return bins;
}
