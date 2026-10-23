// Per-file timings: from a JSON file or the compiler.dev API (GET /v1/app/repos/{repo}/test-timings),
// with a fallback to file size when none are available.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Accepts the shapes the ingestion endpoint may return, all meaning "seconds per file":
 *   [{path|file|name, durationMs|duration_ms|ms|durationSeconds|seconds|duration}]
 *   {files: [...]} | {timings: [...]} | {durations: {path: ms}} | {path: ms}
 * Returns Map<path, seconds>.
 */
export function parseTimings(body) {
  const out = new Map();
  if (body == null || typeof body !== 'object') return out;
  let list = Array.isArray(body) ? body : body.files ?? body.timings ?? body.tests ?? null;
  if (!list) {
    const map = body.durations && typeof body.durations === 'object' ? body.durations : body;
    list = Object.entries(map).map(([path, v]) => (typeof v === 'number' ? { path, durationMs: v } : { path, ...v }));
  }
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const path = e.path ?? e.file ?? e.name;
    let sec;
    for (const [k, mult] of [['durationMs', 0.001], ['duration_ms', 0.001], ['ms', 0.001], ['durationSeconds', 1], ['seconds', 1], ['duration', 0.001]]) {
      if (typeof e[k] === 'number' && Number.isFinite(e[k]) && e[k] >= 0) { sec = e[k] * mult; break; }
    }
    if (typeof path === 'string' && sec !== undefined) out.set(norm(path), sec);
  }
  return out;
}

export function loadTimingsFile(path) {
  try { return parseTimings(JSON.parse(readFileSync(path, 'utf8'))); } catch { return new Map(); }
}

/** Fetch timings from the API. Any failure returns an empty map (the caller falls back to size). */
export async function fetchTimings({ apiUrl, repo, token, fetchFn = globalThis.fetch, timeoutMs = 5000 }) {
  if (!apiUrl || !repo || !fetchFn) return new Map();
  try {
    const res = await fetchFn(`${apiUrl.replace(/\/$/, '')}/v1/app/repos/${encodeURIComponent(repo)}/test-timings`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return new Map();
    return parseTimings(await res.json());
  } catch { return new Map(); }
}

/**
 * Weight each file: known timing in seconds; unknown files get the median known timing (when any are
 * known) or their size in bytes (when none are). `source` says which one was used.
 * @returns {{items: {file: string, weight: number}[], source: 'timings'|'mixed'|'size'}}
 */
export function weigh(files, timings, cwd = '.', sizeOf = (f) => { try { return statSync(join(cwd, f)).size; } catch { return 1; } }) {
  const known = files.filter((f) => timings.has(f));
  if (known.length === 0) return { items: files.map((file) => ({ file, weight: Math.max(1, sizeOf(file)) })), source: 'size' };
  const vals = known.map((f) => timings.get(f)).sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)];
  const items = files.map((file) => ({ file, weight: timings.has(file) ? timings.get(file) : median }));
  return { items, source: known.length === files.length ? 'timings' : 'mixed' };
}
