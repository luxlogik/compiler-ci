// Workspace graph for npm/yarn/pnpm workspaces, plus Nx project.json projects. Turbo has no graph of
// its own (it reads package.json), so turbo.json only contributes global inputs (see affected.mjs).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage', '.nx', 'out', '.cache']);
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function globToRegExp(g) {
  const s = g.replace(/^\.\//, '').replace(/\/$/, '');
  let re = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '*' && s[i + 1] === '*') { re += '.*'; i++; if (s[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function pnpmPatterns(root) {
  const p = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(p)) return [];
  const out = [];
  let inPk = false;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) { inPk = true; continue; }
    if (inPk) {
      const m = /^\s+-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/.exec(line);
      if (m) out.push(m[1]); else if (/^\S/.test(line)) inPk = false;
    }
  }
  return out;
}

/** @returns {{manager: string, tools: string[], packages: Map<string, {name: string, dir: string, deps: string[]}>}} */
export function loadWorkspace(root) {
  const rootPkg = readJSON(join(root, 'package.json')) ?? {};
  let patterns = [];
  let manager = 'none';
  if (existsSync(join(root, 'pnpm-workspace.yaml'))) { manager = 'pnpm'; patterns = pnpmPatterns(root); }
  else if (rootPkg.workspaces) {
    patterns = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : rootPkg.workspaces.packages ?? [];
    manager = existsSync(join(root, 'yarn.lock')) ? 'yarn' : 'npm';
  }
  const tools = ['turbo.json', 'nx.json'].filter((f) => existsSync(join(root, f))).map((f) => f.replace('.json', ''));
  const nx = tools.includes('nx');
  const inc = patterns.filter((p) => !p.startsWith('!')).map(globToRegExp);
  const exc = patterns.filter((p) => p.startsWith('!')).map((p) => globToRegExp(p.slice(1)));

  const found = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!e.isDirectory() || SKIP.has(e.name)) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      const byPattern = inc.some((r) => r.test(rel)) && !exc.some((r) => r.test(rel));
      const pj = readJSON(join(root, rel, 'package.json'));
      const nj = nx ? readJSON(join(root, rel, 'project.json')) : null;
      if ((byPattern && pj) || nj) found.push({ rel, pj, nj });
      walk(rel);
    }
  };
  if (inc.length || nx) walk('');

  const packages = new Map();
  for (const { rel, pj, nj } of found) {
    const name = pj?.name ?? nj?.name ?? rel;
    const deps = new Set([
      ...Object.keys(pj?.dependencies ?? {}), ...Object.keys(pj?.devDependencies ?? {}),
      ...Object.keys(pj?.peerDependencies ?? {}), ...Object.keys(pj?.optionalDependencies ?? {}),
      ...(nj?.implicitDependencies ?? []),
    ]);
    packages.set(name, { name, dir: rel, deps: [...deps] });
  }
  for (const p of packages.values()) p.deps = p.deps.filter((d) => packages.has(d) && d !== p.name);
  return { manager, tools, packages };
}

/** name -> names of packages that (transitively) depend on it, excluding itself. */
export function dependents(ws, names) {
  const rev = new Map();
  for (const p of ws.packages.values()) for (const d of p.deps) (rev.get(d) ?? rev.set(d, []).get(d)).push(p.name);
  const seen = new Set(names);
  const queue = [...names];
  while (queue.length) for (const n of rev.get(queue.shift()) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  return seen;
}
