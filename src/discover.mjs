// Find test files for a runner by walking the tree (no dependency on the runner being installed).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage', '.nx', 'out', '.cache']);
const EXT = /\.(?:[cm]?[jt]sx?)$/;

function walk(root, dir = '', acc = []) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(root, dir ? `${dir}/${e.name}` : e.name, acc); }
    else if (e.isFile()) acc.push(dir ? `${dir}/${e.name}` : e.name);
  }
  return acc;
}

/** testDir from a playwright config, if literally set. */
export function playwrightTestDirs(root) {
  for (const name of ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs']) {
    const p = join(root, name);
    if (!existsSync(p)) continue;
    const m = /testDir\s*:\s*['"`]([^'"`]+)['"`]/.exec(readFileSync(p, 'utf8'));
    if (m) return [m[1].replace(/^\.\//, '').replace(/\/$/, '')];
  }
  return null;
}

export function discover(root, runner) {
  const all = walk(root).filter((f) => EXT.test(f));
  const isTest = (f) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f);
  let files;
  if (runner === 'playwright') {
    const dirs = playwrightTestDirs(root);
    files = all.filter((f) => /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(f) && (dirs ? dirs.some((d) => d === '.' || f.startsWith(`${d}/`)) : true));
  } else if (runner === 'vitest' || runner === 'jest') {
    const pw = playwrightTestDirs(root);
    files = all.filter((f) => (isTest(f) || /(?:^|\/)__tests__\/.+/.test(f) && !/(?:^|\/)__(?:mocks|fixtures|snapshots)__\//.test(f))
      && !(pw && pw.some((d) => f.startsWith(`${d}/`))));
  } else throw new Error(`unknown runner "${runner}" (use vitest, jest or playwright)`);
  return files.sort();
}
