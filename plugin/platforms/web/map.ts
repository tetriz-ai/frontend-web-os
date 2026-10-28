// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// `fwos change map` on web: what a change touches in a Next.js App Router app, read from its code.
// A route resolves to its page. The page, the route files around it and everything they import
// are the change's files; a '/api/...' string in them reaches a route handler, and an import from
// a 'use server' file is a server action. Existing tests that import a target or visit its route
// are the tests around the change. Read-only: a target that matches nothing is refused.

import { posix } from 'node:path';
import {
  type ChangeMap,
  type ChangeMapAdapter,
  FwosError,
  type Project,
  Resolver,
  codeOwners,
  extractImportBindings,
  extractImports,
  isDir,
  isTestFile,
  lexSource,
  maskComments,
  normalizeRel,
  sourceKind,
} from '../../kernel/index.ts';
import { routeOf, uiDir, webApp } from './adapters.ts';

const PAGE = /(?:^|\/)page\.(?:tsx|ts|jsx|js|mdx)$/;
const HANDLER = /(?:^|\/)route\.(?:[cm]?[jt]s)$/;
const WRAPPER = /^(?:layout|template|loading|error|not-found|global-error|default)\.(?:tsx|ts|jsx|js|mdx)$/;
const SCRIPT = /\.[cm]?[jt]sx?$/;
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const USE_SERVER = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use server['"]/;

const segments = (s: string) => s.split('/').filter(Boolean);

/**
 * Whether route segments match a path's: a literal its equal, `[x]` any one segment, `[...x]` one
 * or more, `[[...x]]` none or more. A path segment `[]`, a value only known at run time (a
 * template literal's `${...}`), matches only a dynamic segment.
 */
function segmentsMatch(route: string[], path: string[]): boolean {
  const [head, ...rest] = route;
  if (head === undefined) return path.length === 0;
  if (/^\[\[\.\.\..+\]\]$/.test(head)) return true;
  if (/^\[\.\.\..+\]$/.test(head)) return path.length > 0;
  if (path.length === 0) return false;
  if (/^\[.+\]$/.test(head)) return segmentsMatch(rest, path.slice(1));
  return head === path[0] && segmentsMatch(rest, path.slice(1));
}

/** The route that serves `path` (a URL path, with `[]` for a run-time segment): the most literal one that matches, or null. */
export function matchRoute(path: string, routes: string[]): string | null {
  const p = segments(path.split(/[?#]/)[0]!);
  const weight = (r: string) => segments(r).reduce((n, s) => n + (s.startsWith('[[...') ? 100 : s.startsWith('[...') ? 10 : s.startsWith('[') ? 1 : 0), 0);
  const hits = routes.filter((r) => segmentsMatch(segments(r), p)).sort((a, b) => weight(a) - weight(b));
  return hits[0] ?? null;
}

/** The URL path in a string a test or a page holds: `/members?x`, or the path of an absolute URL. */
function pathOf(value: string): string | null {
  const url = /^https?:\/\/[^/]+(\/.*)?$/.exec(value);
  const path = url ? (url[1] ?? '/') : value;
  return path.startsWith('/') && !path.startsWith('//') ? path.split(/[?#]/)[0]! : null;
}

/** The HTTP methods a route handler exports. */
function methodsOf(project: Project, file: string): string[] {
  const code = maskComments(project.read(file) ?? '', 'js');
  return METHODS.filter((m) => new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b|export\\s+(?:const|let|var)\\s+${m}\\b|export\\s*\\{[^}]*\\b${m}\\b[^}]*\\}`).test(code));
}

/** The values of a file's strings, a template literal's `${...}` read as `[]`. */
function stringValues(src: string, kind: NonNullable<ReturnType<typeof sourceKind>>): string[] {
  return lexSource(src, kind)
    .strings.filter((s) => s.closed)
    .map((s) => s.runs.map(([a, b]) => src.slice(a, b)).join('[]'));
}

export function mapChange(project: Project, targets: string[]): ChangeMap {
  const app = webApp(project);
  const roots = ['app', 'src/app'].map((d) => posix.join(app, d)).filter((d) => isDir(project.abs(d)));
  const all = project.files(['**/*']);
  const pages = new Map<string, string>();
  const handlers = new Map<string, string>();
  for (const root of roots) {
    for (const f of all.filter((x) => x.startsWith(`${root}/`))) {
      const route = PAGE.test(f) || HANDLER.test(f) ? routeOf(f.slice(root.length + 1)) : null;
      if (route === null) continue;
      const into = PAGE.test(f) ? pages : handlers;
      if (!into.has(route)) into.set(route, f);
    }
  }

  // Each target: a route by its URL (a page, else a route handler), or a file by its path.
  const resolved: ChangeMap['targets'] = [];
  const routeOfTarget = new Map<string, string>();
  for (const target of targets) {
    if (target.startsWith('/')) {
      const route = matchRoute(target, [...pages.keys()]) ?? matchRoute(target, [...handlers.keys()]);
      if (route === null) {
        const known = [...pages.keys()].sort();
        throw new FwosError(`${target} matches no route or file. Routes: ${known.slice(0, 20).join(', ')}${known.length > 20 ? ', ...' : ''}.`, 'Name a route by its URL (/dashboard) or a file by its path from the project folder.');
      }
      routeOfTarget.set(target, route);
      resolved.push({ target, file: pages.get(route) ?? handlers.get(route)! });
    } else {
      const rel = normalizeRel(target);
      if (rel.startsWith('../') || !project.exists(rel) || isDir(project.abs(rel))) {
        throw new FwosError(`${target} matches no route or file.`, 'Name a route by its URL (/dashboard) or a file by its path from the project folder.');
      }
      resolved.push({ target, file: rel });
    }
  }

  // The route files around each page: in its folder and every folder above it, up to the app's root.
  const wrappers = new Set<string>();
  for (const t of resolved.filter((x) => PAGE.test(x.file))) {
    const root = roots.find((r) => t.file.startsWith(`${r}/`))!;
    for (let dir = posix.dirname(t.file); dir === root || dir.startsWith(`${root}/`); dir = posix.dirname(dir)) {
      for (const f of all) if (posix.dirname(f) === dir && WRAPPER.test(posix.basename(f))) wrappers.add(f);
    }
  }

  // Everything they render or import, and the data handlers they call, with what those import.
  const resolver = new Resolver(project.root);
  const serverActions = new Map<string, boolean>();
  const isActions = (f: string) => {
    if (!serverActions.has(f)) serverActions.set(f, SCRIPT.test(f) && USE_SERVER.test(project.read(f) ?? ''));
    return serverActions.get(f)!;
  };
  const files = new Set<string>();
  const apis = new Map<string, { route: string; file: string }>();
  const actions = new Map<string, { what: string; file: string }>();
  const queue = [...resolved.map((t) => t.file), ...wrappers];
  const seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const f = queue[i]!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (isTestFile(project, f) || /\.stories\.[^/]+$/.test(f)) continue;
    files.add(f);
    const kind = sourceKind(f);
    if (!kind || kind === 'css') continue;
    const src = project.read(f) ?? '';
    for (const imp of extractImportBindings(src, kind)) {
      const r = resolver.resolve(f, imp.spec);
      if (r.kind !== 'file' || !r.exists || r.path.split('/').includes('node_modules')) continue;
      if (!imp.typeOnly && r.path !== f && isActions(r.path) && !isActions(f)) {
        for (const name of imp.names) if (name !== 'default' && name !== '*') actions.set(`${r.path}\0${name}`, { what: name, file: r.path });
      }
      queue.push(r.path);
    }
    for (const value of stringValues(src, kind)) {
      const path = value.startsWith('/api/') ? value : null;
      const route = path ? matchRoute(path, [...handlers.keys()]) : null;
      if (!route) continue;
      apis.set(route, { route, file: handlers.get(route)! });
      queue.push(handlers.get(route)!);
    }
  }
  const data: ChangeMap['data'] = [
    ...[...apis.values()]
      .sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0))
      .map((a) => {
        const methods = methodsOf(project, a.file);
        return { kind: 'api' as const, what: `${methods.length > 0 ? `${methods.join(', ')} ` : ''}${a.route}`, file: a.file };
      }),
    ...[...actions.values()].sort((a, b) => (a.file + a.what < b.file + b.what ? -1 : 1)).map((a) => ({ kind: 'action' as const, ...a })),
  ];

  // The existing tests around the change: those that import a target, or visit a target route.
  const targetFiles = new Set(resolved.map((t) => t.file));
  const tests: ChangeMap['tests'] = [];
  for (const t of all.filter((f) => SCRIPT.test(f) && isTestFile(project, f))) {
    const kind = sourceKind(t);
    if (!kind) continue;
    const src = project.read(t) ?? '';
    let via: string | null = null;
    for (const imp of extractImports(src, kind)) {
      const r = resolver.resolve(t, imp.spec);
      if (r.kind === 'file' && r.exists && targetFiles.has(r.path)) {
        via = `imports ${r.path}`;
        break;
      }
    }
    if (!via && routeOfTarget.size > 0) {
      for (const value of stringValues(src, kind)) {
        const path = pathOf(value);
        if (path && [...routeOfTarget.values()].some((route) => matchRoute(path, [route]) === route)) {
          via = `visits ${path}`;
          break;
        }
      }
    }
    if (via) tests.push({ file: t, via });
  }

  const ui = uiDir(project);
  const sorted = [...files].sort();
  return {
    targets: resolved,
    wrappers: [...wrappers].sort(),
    files: sorted,
    components: sorted.filter((f) => f.startsWith(`${ui}/`)),
    data,
    tests,
    owners: codeOwners(project.root, [...targetFiles]).owners,
  };
}

export const changeMap: ChangeMapAdapter = { platform: 'web', map: mapChange };
