// Which workspace packages does a change touch? Conservative: any doubt means "all".
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dependents, loadWorkspace } from './workspace.mjs';

const ROOT_CONFIG = [
  /^package\.json$/, /^(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|pnpm-workspace\.yaml)$/,
  /^(?:turbo|nx|lerna)\.json$/, /^\.(?:npmrc|yarnrc|yarnrc\.yml|nvmrc|node-version|tool-versions)$/, /^\.yarn\//, /^\.pnpmfile\.cjs$/,
  /^tsconfig[^/]*\.json$/, /^(?:vitest|vite|jest|babel|playwright|eslint|prettier|biome)[^/]*\.(?:[cm]?[jt]s|json|yaml|yml)$/,
  /^\.(?:eslintrc|prettierrc|babelrc)[^/]*$/, /^biome\.jsonc?$/, /^\.github\//,
];
const HARMLESS = [/\.mdx?$/i, /^docs\//, /^LICENSE/i, /^\.gitignore$/];

const gitOut = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * Pure core. changedFiles are repo-relative, '/'-separated.
 * @returns {{all: true, reason: string} | {all: false, packages: string[], changed: string[], vitest?: string[]}}
 */
export function computeAffected({ root, changedFiles, onDefaultBranch = false, mergeBase }) {
  if (onDefaultBranch) return { all: true, reason: 'default branch' };
  if (!changedFiles) return { all: true, reason: 'could not determine changed files' };
  if (changedFiles.length === 0) return { all: false, packages: [], changed: [] };
  const ws = loadWorkspace(root);
  const globalDeps = [];
  if (ws.tools.includes('turbo')) {
    try { globalDeps.push(...(JSON.parse(readFileSync(join(root, 'turbo.json'), 'utf8')).globalDependencies ?? [])); } catch { return { all: true, reason: 'unreadable turbo.json' }; }
  }
  const pkgs = [...ws.packages.values()].sort((a, b) => b.dir.length - a.dir.length);
  const hit = new Set();
  let single = false;
  for (const f of changedFiles) {
    const owner = pkgs.find((p) => f === p.dir || f.startsWith(`${p.dir}/`));
    if (owner) { hit.add(owner.name); continue; }
    if (ROOT_CONFIG.some((r) => r.test(f))) return { all: true, reason: `root config changed: ${f}` };
    if (globalDeps.some((g) => f === g.replace(/^\.\//, ''))) return { all: true, reason: `turbo globalDependencies changed: ${f}` };
    if (HARMLESS.some((r) => r.test(f))) continue;
    if (ws.packages.size === 0) { single = true; continue; } // not a workspace: the root is the one package
    return { all: true, reason: `file outside any package: ${f}` };
  }
  if (single) {
    let name = '.';
    try { name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name ?? '.'; } catch { /* unnamed */ }
    return { all: false, packages: [name], changed: [name], ...(mergeBase ? { vitest: ['--changed', mergeBase] } : {}) };
  }
  const packages = [...dependents(ws, hit)].sort();
  return { all: false, packages, changed: [...hit].sort() };
}

export function currentBranch(cwd) {
  return process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || (() => { try { return gitOut(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']); } catch { return ''; } })();
}

export function defaultBranch(cwd, given) {
  if (given) return given;
  try { return gitOut(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, ''); } catch { /* fall through */ }
  for (const b of ['main', 'master']) { try { gitOut(cwd, ['rev-parse', '--verify', '-q', b]); return b; } catch { /* next */ } }
  return 'main';
}

/** Git facts for the working tree: {onDefaultBranch, mergeBase, changedFiles|null}. Any git problem yields null files. */
export function gitChanges({ cwd, base, defaultBranch: def }) {
  const dflt = defaultBranch(cwd, def);
  const branch = process.env.GITHUB_BASE_REF ? process.env.GITHUB_HEAD_REF : currentBranch(cwd);
  if (!process.env.GITHUB_BASE_REF && branch === dflt) return { onDefaultBranch: true, mergeBase: undefined, changedFiles: null };
  try {
    const baseRef = base || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : existsSync(join(cwd, '.git')) ? `origin/${dflt}` : dflt);
    let ref = baseRef;
    try { gitOut(cwd, ['rev-parse', '--verify', '-q', ref]); } catch { ref = dflt; }
    const mergeBase = gitOut(cwd, ['merge-base', 'HEAD', ref]);
    const diff = gitOut(cwd, ['diff', '--name-only', '--no-renames', '--relative', mergeBase]);
    const untracked = gitOut(cwd, ['ls-files', '--others', '--exclude-standard']);
    return { onDefaultBranch: false, mergeBase, changedFiles: [...new Set([...diff.split('\n'), ...untracked.split('\n')].filter(Boolean))] };
  } catch {
    return { onDefaultBranch: false, mergeBase: undefined, changedFiles: null };
  }
}
