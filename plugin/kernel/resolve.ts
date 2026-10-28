// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Resolves an import specifier the way TypeScript does: relative paths, tsconfig `paths` and
// `baseUrl` (following `extends`, a string or a list, a file or a package), package.json `imports`
// (`#name`) and workspace package names. A bare name is a package when Node has it built in, or a
// package.json on the way up declares it, or a node_modules on the way up has it. Anything else is
// unresolved, so a check can say so instead of passing it. The walls check and the design-system
// registry both resolve imports with it.

import { readdirSync, realpathSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { isDir, isFile, readJson, readText, toPosix } from './files.ts';
import { matchGlob } from './glob.ts';

/** A project file. `package` names the workspace package the specifier reached it through, if any. */
type FileResolved = { kind: 'file'; path: string; exists: boolean; package?: string };

export type Resolved =
  | FileResolved
  | { kind: 'package'; name: string }
  /** A bare specifier that is no project file and no installed or declared package. `hint` says what to check. */
  | { kind: 'unresolved'; name: string; hint: string };

const EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.md'];
const INDEX = ['index.ts', 'index.tsx', 'index.d.ts', 'index.js', 'index.jsx', 'index.mjs'];
/** The TypeScript files a `.js`, `.jsx`, `.mjs` or `.cjs` specifier can stand for. */
const TS_FOR_JS = ['.ts', '.tsx', '.d.ts', '.mts', '.d.mts', '.cts', '.d.cts'];
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
/** A URL-style specifier (`node:fs`, `virtual:x`, `bun:test`): the runtime or a bundler plugin owns it. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** A name npm can publish (lowercase, optional scope). */
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** compilerOptions that decide how a bare specifier resolves, already merged across `extends`. */
interface TsConfig {
  /** The tsconfig.json nearest the importing file, relative to the root (`../` when above it). */
  file: string;
  /** The `paths` map and the folder of the config that set it. */
  paths?: { map: [string, string[]][]; dir: string };
  /** Absolute. */
  baseUrl?: string;
  /** Things TypeScript would complain about, such as an `extends` that can't be found. */
  problems: string[];
}

type Options = Omit<TsConfig, 'file' | 'problems'>;

export class Resolver {
  private tsconfigCache = new Map<string, TsConfig | null>();
  private workspace: Map<string, string> | null = null;
  private declaredCache = new Map<string, Set<string>>();
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  resolve(fromFile: string, specifier: string): Resolved {
    // A bundler query (`./notes.md?raw`, `@/icons/x.svg?url`) isn't part of the file name.
    const spec = specifier.replace(/\?.*$/, '');
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const base = spec.startsWith('/') ? spec.slice(1) : posix.join(posix.dirname(fromFile), spec);
      return this.file(posix.normalize(base));
    }
    if (SCHEME.test(spec)) return { kind: 'package', name: spec.split('/')[0]! };
    if (spec.startsWith('#')) return this.viaImportsField(fromFile, spec);
    const cfg = this.nearestTsconfig(dirname(join(this.root, fromFile)));
    const notes: string[] = [];
    const alias = cfg ? this.viaPaths(cfg, spec, notes) : null;
    if (alias) return alias;
    if (cfg?.baseUrl) {
      const r = this.file(this.rel(resolve(cfg.baseUrl, spec)));
      if (r.exists) return r;
    }
    const ws = this.viaWorkspace(spec);
    if (ws) return ws;
    return this.bare(fromFile, spec, [...notes, ...(cfg?.problems ?? [])], cfg?.file);
  }

  /** A package name, if Node has it built in or it is declared or installed; otherwise unresolved. */
  private bare(fromFile: string, spec: string, notes: string[], tsconfig?: string): Resolved {
    const name = packageName(spec);
    if (isBuiltin(spec) || isBuiltin(name)) return { kind: 'package', name };
    const dir = dirname(join(this.root, fromFile));
    if (this.declared(dir).has(name) || this.installed(dir, name)) return { kind: 'package', name };
    const checks = notes.length > 0 ? ` (${notes.join('; ')})` : tsconfig ? ` (${tsconfig})` : '';
    // `@/x` or `~/x` can only be an alias, so adding it to package.json is no fix.
    const orAdd = NPM_NAME.test(name) ? `, or add ${name} to package.json and install it` : '';
    return { kind: 'unresolved', name, hint: `Check the tsconfig paths, baseUrl and extends that apply to this file${checks}${orAdd}.` };
  }

  /**
   * Tries the path as written, with extensions (a `.d.ts` too), `.js` or `.jsx` -> `.ts` or `.tsx`, and as
   * a folder: the `types`, `typings` or `main` its package.json names, then an index.
   */
  private file(rel: string, inFolder = false): FileResolved {
    const abs = (p: string) => join(this.root, p);
    const candidates = [rel, ...EXTENSIONS.map((e) => rel + e)];
    const js = /\.(?:[mc]?js|jsx)$/;
    if (js.test(rel)) candidates.push(...TS_FOR_JS.map((e) => rel.replace(js, '') + e));
    for (const c of candidates) if (isFile(abs(c))) return { kind: 'file', path: c, exists: true };
    if (isDir(abs(rel))) {
      const pkg = inFolder ? null : safeJson<Record<string, unknown>>(abs(posix.join(rel, 'package.json')));
      for (const field of ['types', 'typings', 'main']) {
        const entry = pkg?.[field];
        if (typeof entry !== 'string') continue;
        const r = this.file(posix.normalize(posix.join(rel, entry)), true);
        if (r.exists) return r;
      }
      for (const i of INDEX) if (isFile(abs(posix.join(rel, i)))) return { kind: 'file', path: posix.join(rel, i), exists: true };
    }
    return { kind: 'file', path: rel, exists: false };
  }

  /** Root-relative posix path of an absolute one. */
  private rel(abs: string): string {
    return posix.normalize(toPosix(relative(this.root, abs)) || '.');
  }

  /**
   * TypeScript's `paths`, matched by `matchPattern`. Its targets resolve against baseUrl when one
   * is set, otherwise against the config that set them. When no target exists TypeScript moves on,
   * and so does this, noting where the alias pointed.
   */
  private viaPaths(cfg: TsConfig, spec: string, notes: string[]): Resolved | null {
    const hit = cfg.paths && matchPattern(cfg.paths.map, spec);
    if (!hit) return null;
    const base = cfg.baseUrl ?? cfg.paths!.dir;
    const tried = hit.value.map((t) => this.file(this.rel(resolve(base, t.replace('*', hit.rest)))));
    const found = tried.find((r) => r.exists);
    if (found) return found;
    if (tried[0]) notes.push(`its paths map ${spec} to ${tried[0].path}, which doesn't exist`);
    return null;
  }

  /** The tsconfig.json nearest an absolute folder, looking above the project root too, as TypeScript does. */
  private nearestTsconfig(dir: string): TsConfig | null {
    const hit = this.tsconfigCache.get(dir);
    if (hit !== undefined) return hit;
    let found: TsConfig | null = null;
    const file = join(dir, 'tsconfig.json');
    if (isFile(file)) {
      const problems: string[] = [];
      found = { file: this.rel(file), ...this.readTsconfig(file, dir, problems, []), problems };
    } else if (dirname(dir) !== dir) found = this.nearestTsconfig(dirname(dir));
    this.tsconfigCache.set(dir, found);
    return found;
  }

  /**
   * The options a tsconfig ends up with: each `extends` entry in order (a later one wins), then its
   * own compilerOptions. Relative values resolve against the file that sets them; `${configDir}`
   * is the folder of the tsconfig being read for the importing file.
   */
  private readTsconfig(abs: string, leafDir: string, problems: string[], chain: string[]): Options {
    // `chain` is the extends path that led here, so a loop stops instead of recursing forever.
    if (chain.includes(abs) || chain.length > 16) return {};
    chain = [...chain, abs];
    let cfg: { extends?: unknown; compilerOptions?: { baseUrl?: unknown; paths?: unknown } } | null = null;
    try {
      cfg = readJson(abs);
    } catch {
      problems.push(`${this.rel(abs)} isn't valid JSON`);
    }
    if (!cfg || typeof cfg !== 'object') return {};
    const dir = dirname(abs);
    let merged: Options = {};
    const parents = typeof cfg.extends === 'string' ? [cfg.extends] : Array.isArray(cfg.extends) ? cfg.extends.filter((e): e is string => typeof e === 'string') : [];
    for (const spec of parents) {
      const parent = this.findExtends(spec, dir);
      if (!parent) {
        problems.push(`${this.rel(abs)} extends "${spec}", which ${spec.startsWith('.') ? "doesn't exist" : "isn't installed or in the workspace"}`);
        continue;
      }
      merged = { ...merged, ...this.readTsconfig(parent, leafDir, problems, chain) };
    }
    const own = cfg.compilerOptions ?? {};
    const sub = (v: string) => v.replaceAll('${configDir}', leafDir);
    if (typeof own.baseUrl === 'string') merged.baseUrl = resolve(dir, sub(own.baseUrl));
    if (own.paths && typeof own.paths === 'object') {
      const map = Object.entries(own.paths as Record<string, unknown>).map(
        ([k, v]) => [k, (Array.isArray(v) ? v : []).filter((t): t is string => typeof t === 'string').map(sub)] as [string, string[]],
      );
      merged.paths = { map, dir };
    }
    return merged;
  }

  /** The file an `extends` entry names: a path, or a package found in node_modules or the workspace. */
  private findExtends(spec: string, fromDir: string): string | null {
    const withJson = (p: string) => [p, ...(p.endsWith('.json') ? [] : [`${p}.json`])].find(isFile) ?? null;
    if (spec.startsWith('.') || isAbsolute(spec)) return withJson(resolve(fromDir, spec));
    const name = packageName(spec);
    const subpath = spec.slice(name.length + 1);
    const inPackage = (pkgDir: string): string | null => {
      const pkg = safeJson<{ tsconfig?: unknown; exports?: unknown }>(join(pkgDir, 'package.json'));
      const exported = exportTarget(pkg?.exports, subpath ? `./${subpath}` : '.');
      if (exported) return withJson(resolve(pkgDir, exported));
      if (subpath) return withJson(join(pkgDir, subpath));
      return withJson(join(pkgDir, typeof pkg?.tsconfig === 'string' ? pkg.tsconfig : 'tsconfig.json'));
    };
    for (let d = fromDir; ; d = dirname(d)) {
      if (posix.basename(toPosix(d)) !== 'node_modules') {
        const pkgDir = join(d, 'node_modules', name);
        if (isDir(pkgDir)) {
          const hit = inPackage(pkgDir);
          if (hit) return realpath(hit);
        }
      }
      if (dirname(d) === d) break;
    }
    this.workspace ??= readWorkspace(this.root);
    const ws = this.workspace.get(name);
    return ws ? inPackage(join(this.root, ws)) : null;
  }

  /** `#name` through the `imports` field of the nearest package.json. */
  private viaImportsField(fromFile: string, spec: string): Resolved {
    for (let d = dirname(join(this.root, fromFile)); ; d = dirname(d)) {
      const pkgFile = join(d, 'package.json');
      if (isFile(pkgFile)) {
        const exists = (t: string) => this.file(this.rel(resolve(d, t))).exists;
        const target = exportTarget(safeJson<{ imports?: unknown }>(pkgFile)?.imports, spec, exists);
        if (target?.startsWith('./')) return this.file(this.rel(resolve(d, target)));
        if (target) return this.bare(fromFile, target, []);
        return { kind: 'unresolved', name: spec, hint: `Add it to the "imports" field of ${this.rel(pkgFile)}.` };
      }
      if (dirname(d) === d) return { kind: 'unresolved', name: spec, hint: 'Add it to the "imports" field of your package.json.' };
    }
  }

  private viaWorkspace(spec: string): Resolved | null {
    this.workspace ??= readWorkspace(this.root);
    for (const [name, dir] of this.workspace) {
      if (spec === name) {
        const pkg = readJson<{ main?: string; types?: string; exports?: unknown }>(join(this.root, dir, 'package.json')) ?? {};
        const exp = typeof pkg.exports === 'string' ? pkg.exports : (pkg.exports as Record<string, unknown> | undefined)?.['.'];
        const main = typeof exp === 'string' ? exp : (pkg.types ?? pkg.main);
        return { ...this.file(main ? posix.normalize(posix.join(dir, main)) : dir), package: name };
      }
      if (spec.startsWith(`${name}/`)) return { ...this.file(posix.join(dir, spec.slice(name.length + 1))), package: name };
    }
    return null;
  }

  /** Every name a package.json in `dir` or above declares (any dependency field, or its own name). */
  private declared(dir: string): Set<string> {
    const hit = this.declaredCache.get(dir);
    if (hit) return hit;
    const parent = dirname(dir);
    const names = new Set(parent === dir ? [] : this.declared(parent));
    const pkg = safeJson<Record<string, unknown>>(join(dir, 'package.json'));
    if (pkg) {
      if (typeof pkg.name === 'string') names.add(pkg.name);
      for (const field of DEP_FIELDS) for (const n of Object.keys((pkg[field] as Record<string, unknown>) ?? {})) names.add(n);
    }
    this.declaredCache.set(dir, names);
    return names;
  }

  /** Whether a node_modules in `dir` or above has the package, or its @types. */
  private installed(dir: string, name: string): boolean {
    const types = `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`;
    for (let d = dir; ; d = dirname(d)) {
      if (isDir(join(d, 'node_modules', name)) || isDir(join(d, 'node_modules', types))) return true;
      if (dirname(d) === d) return false;
    }
  }
}

/** `react` for `react/jsx-runtime`, `@scope/pkg` for `@scope/pkg/sub`. */
function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/**
 * The target an `exports` or `imports` map gives a key, with `*` patterns. Condition objects are
 * read in order, and the first target `accept` takes wins (the first string when none does).
 */
function exportTarget(map: unknown, key: string, accept: (target: string) => boolean = () => true): string | null {
  if (typeof map === 'string') return key === '.' ? map : null;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const entries = Object.entries(map as Record<string, unknown>);
  if (key === '.' && !entries.some(([k]) => k.startsWith('.') || k.startsWith('#'))) return firstTarget(map, accept);
  const hit = matchPattern(entries, key);
  if (!hit) return null;
  return firstTarget(hit.value, (t) => accept(t.replaceAll('*', hit.rest)))?.replaceAll('*', hit.rest) ?? null;
}

/** The entry for `key`: an exact one first, then the `*` pattern with the longest prefix, as TypeScript and Node match them. */
function matchPattern<T>(entries: [string, T][], key: string): { value: T; rest: string } | null {
  const exact = entries.find(([k]) => k === key);
  if (exact) return { value: exact[1], rest: '' };
  let best: { value: T; rest: string; prefix: number } | null = null;
  for (const [k, value] of entries) {
    const star = k.indexOf('*');
    if (star === -1) continue;
    const pre = k.slice(0, star);
    const post = k.slice(star + 1);
    if (key.length >= pre.length + post.length && key.startsWith(pre) && key.endsWith(post) && (!best || pre.length > best.prefix)) {
      best = { value, rest: key.slice(pre.length, key.length - post.length), prefix: pre.length };
    }
  }
  return best;
}

function firstTarget(value: unknown, accept: (target: string) => boolean): string | null {
  const all: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') all.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return all.find(accept) ?? all[0] ?? null;
}

function safeJson<T>(path: string): T | null {
  try {
    return readJson<T>(path);
  } catch {
    return null;
  }
}

function realpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Workspace package name -> folder, from pnpm-workspace.yaml or package.json `workspaces`. A
 * package.json that isn't valid JSON names no package, so one broken file doesn't hide the rest.
 */
export function readWorkspace(root: string): Map<string, string> {
  const globs: string[] = [];
  const pnpm = readText(join(root, 'pnpm-workspace.yaml'));
  if (pnpm) {
    const parsed = parseYaml(pnpm) as { packages?: string[] } | null;
    globs.push(...(parsed?.packages ?? []));
  }
  const pkg = safeJson<{ workspaces?: string[] | { packages?: string[] } }>(join(root, 'package.json'));
  const ws = pkg?.workspaces;
  globs.push(...(Array.isArray(ws) ? ws : (ws?.packages ?? [])));
  const map = new Map<string, string>();
  if (globs.length === 0) return map;
  const dirs = new Set<string>();
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(join(root, dir));
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const rel = dir ? `${dir}/${e}` : e;
      if (!isDir(join(root, rel))) continue;
      dirs.add(rel);
      walk(rel, depth + 1);
    }
  };
  walk('', 0);
  for (const d of dirs) {
    if (!globs.some((g) => !g.startsWith('!') && matchGlob(d, g.replace(/\/$/, '')))) continue;
    if (globs.some((g) => g.startsWith('!') && matchGlob(d, g.slice(1)))) continue;
    const pj = safeJson<{ name?: string }>(join(root, d, 'package.json'));
    if (pj?.name) map.set(pj.name, d);
  }
  return map;
}
