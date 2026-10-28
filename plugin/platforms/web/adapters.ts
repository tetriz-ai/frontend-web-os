// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The web (Next.js App Router) adapters: components, screens, state fixtures and the verify driver.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix } from 'node:path';
import type {
  AppLink,
  AppRedirect,
  ComponentAdapter,
  ContractModel,
  GeneratedFile,
  Project,
  ScreenAdapter,
  ScreenRef,
  StateFixturesAdapter,
  VerifyDriver,
} from '../../kernel/index.ts';
import { FwosError, Resolver, extractImports, isDir, isTestFile, keyBefore, lexSource, lineOf, pluginPath, readJson, readText, sourceKind } from '../../kernel/index.ts';
import { renderFixture } from './render.ts';

export const webApp = (p: Project) => p.paths.apps.web ?? 'apps/web';
export const UI_DIR = 'src/shared/ui';
export const DEV_ONLY_GROUP = '(fwos-screens)';
/** The screens browser's route. Only it, in the dev-only group, is dev-only: any other page there is a real route. */
export const DEV_ONLY_ROUTE = '/fwos-screens';

/** The UI components folder: `paths.ui.web` when set (adopt mode finds it), else `<app>/src/shared/ui`. */
export const uiDir = (p: Project) => p.paths.ui.web ?? posix.join(webApp(p), UI_DIR);

const SCRIPT = /\.[cm]?[jt]sx?$/;

export const components: ComponentAdapter = {
  platform: 'web',
  importFor: (id) => `@/shared/ui/${id}`,
  folder: uiDir,
  /**
   * A script file in the UI folder is a component named after the file. A folder in it is one
   * component named after the folder, whatever it holds, and its `file` is the folder, as
   * `@/shared/ui/<id>` reaches it. The folder's own index (the barrel), tests (`__tests__/`,
   * `*.test.*` and `*.spec.*`, whatever the project's test globs say), stories, type declarations
   * and dotfiles such as `.eslintrc.cjs` aren't components.
   */
  listInstalled(project) {
    const dir = uiDir(project);
    const byId = new Map<string, string>();
    const tests = ['**/__tests__/**', '**/__mocks__/**', '**/*.test.*', '**/*.spec.*'];
    const skip = [`${dir}/index.*`, ...project.paths.tests, ...tests, '**/*.stories.*', '**/*.d.ts', '**/*.d.mts', '**/*.d.cts'];
    for (const file of project.files([`${dir}/**`], skip)) {
      if (!SCRIPT.test(file) || file.slice(dir.length + 1).split('/').some((part) => part.startsWith('.'))) continue;
      const [top, ...rest] = file.slice(dir.length + 1).split('/');
      if (rest.length === 0) byId.set(top!.replace(SCRIPT, ''), file);
      else if (!byId.has(top!)) byId.set(top!, posix.join(dir, top!));
    }
    return [...byId].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, file]) => ({ id, file }));
  },
};

/** `app/(group)/items/[id]/page.tsx` -> `/items/[id]`. Route groups vanish; private and parallel folders are skipped. */
export function routeOf(appRel: string): string | null {
  const parts = appRel.split('/').slice(0, -1);
  const segs: string[] = [];
  for (const p of parts) {
    if (p.startsWith('_') || p.startsWith('@')) return null;
    if (/^\(\.{1,3}\)/.test(p)) return null; // intercepting route
    if (/^\(.+\)$/.test(p)) continue;
    segs.push(p);
  }
  return `/${segs.join('/')}`;
}

/** Whether a file at `rel` under an app root belongs to the screens browser: only it, in the dev-only group, is dev-only. */
function isDevOnly(rel: string): boolean {
  const route = routeOf(rel);
  return route !== null && rel.split('/').includes(DEV_ONLY_GROUP) && (route === DEV_ONLY_ROUTE || route.startsWith(`${DEV_ONLY_ROUTE}/`));
}

/** The files Next.js renders for a route: the page and what wraps it. */
const ROUTE_FILE = /(?:^|\/)(?:page|layout|template|default|loading|error|global-error|not-found)\.(?:[cm]?[jt]sx?|mdx)$/;
/** The keys whose path is a link: `href="/x"`, `{ href: '/x' }` in a nav list, `{ pathname: '/x' }`. */
const LINK_KEYS = new Set(['href', 'to', 'pathname', 'path', 'route', 'url']);
/** The calls whose path is a navigation: `router.push('/x')`, `redirect('/x')`. */
const NAV_CALLS = new Set(['push', 'replace', 'redirect', 'permanentRedirect']);
/** A link attribute set from an expression, `href={p.route}`: in a file that imports ia.json, a nav built from it. */
const LINK_FROM_DATA = /\b(?:href|to)\s*=\s*\{(?!\s*['"`])/;

/** The function a string is the first argument of: `push('/x')` -> push. */
function callBefore(masked: string, open: number): string | undefined {
  let j = open - 1;
  while (j >= 0 && /\s/.test(masked[j]!)) j--;
  if (masked[j] !== '(') return undefined;
  j--;
  while (j >= 0 && /\s/.test(masked[j]!)) j--;
  const end = j + 1;
  while (j >= 0 && /[\w$]/.test(masked[j]!)) j--;
  return masked.slice(j + 1, end) || undefined;
}

/** fwos's access guard: `guardPage('<id>')` declares the page's ID and applies ia.json's roles and flag. */
const GUARD = 'guardPage';
const GUARD_CALL = /(?<![\w$.])guardPage\s*\(/;
/** A file that defines the guard: its own refusals run only through guardPage calls. */
const DEFINES_GUARD = /export\s+(?:async\s+)?function\s+guardPage\b|export\s+const\s+guardPage\b/;
/** Anything that can turn a visitor away or send them elsewhere. */
const EXITS = [
  /(?<![\w$.])(?:notFound|redirect|permanentRedirect|forbidden|unauthorized)\s*\(/,
  /\brouter\s*\.\s*(?:push|replace)\s*\(/,
  /\blocation\s*\.\s*(?:assign|replace)\s*\(|\blocation\s*\.\s*href\s*=(?!=)/,
];
/** A redirect call whose target isn't a string literal. */
const COMPUTED_REDIRECT = /(?<![\w$.])(?:redirect|permanentRedirect)\s*\(\s*(?![\s'"`])/;
const REDIRECT_CALLS = new Set(['redirect', 'permanentRedirect']);

/** What one file of the app says, for links and access. */
interface FileFacts {
  links: AppLink[];
  imports: string[];
  /** Page IDs it passes to guardPage as literals. */
  guards: string[];
  /** It calls guardPage at all. */
  guarded: boolean;
  exits: boolean;
  /** The literal paths it redirects to; `?` for a redirect fwos can't read. */
  redirects: string[];
}

/**
 * Reads the code the app's routes render: every route file (pages, layouts and the rest, the
 * screens browser aside) and every project file they import, through tsconfig paths and barrels.
 * Tests and stories don't count. A link is a path, starting with `/`, given to a link key or a
 * navigation call; a `${...}` in a template literal is a dynamic segment.
 */
function readApp(project: Project, roots: string[]): { facts: Map<string, FileFacts>; iaNav: string[] } {
  const resolver = new Resolver(project.root);
  const ia = posix.join(project.paths.docs, 'ia.json');
  const queue = roots.flatMap((root) => project.files([`${root}/**`]).filter((f) => ROUTE_FILE.test(f) && !isDevOnly(f.slice(root.length + 1))));
  const facts = new Map<string, FileFacts>();
  const iaNav: string[] = [];
  // An index, not shift(), so a large app is walked in linear time.
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i]!;
    if (facts.has(file)) continue;
    const f: FileFacts = { links: [], imports: [], guards: [], guarded: false, exits: false, redirects: [] };
    facts.set(file, f);
    const kind = sourceKind(file);
    if (!kind || kind === 'css' || isTestFile(project, file) || /\.stories\.[^/]+$/.test(file)) continue;
    const src = project.read(file) ?? '';
    const { masked, code, strings } = lexSource(src, kind);
    for (const s of strings) {
      if (!s.closed) continue;
      const call = callBefore(masked, s.open) ?? '';
      const text = s.runs.map(([a, b]) => src.slice(a, b)).join('[]');
      if (call === GUARD && s.runs.length === 1) f.guards.push(text);
      if (!(LINK_KEYS.has(keyBefore(masked, s.open) ?? '') || NAV_CALLS.has(call))) continue;
      const path = text.split(/[?#]/)[0]!;
      if (!path.startsWith('/') || path.startsWith('//')) continue;
      f.links.push({ to: path, file, line: lineOf(src, s.open) });
      if (REDIRECT_CALLS.has(call)) f.redirects.push(path);
    }
    // The file that defines the guard neither calls it nor refuses anyone of its own accord.
    const definesGuard = DEFINES_GUARD.test(code);
    f.guarded = !definesGuard && GUARD_CALL.test(code);
    f.exits = !definesGuard && EXITS.some((re) => re.test(code));
    if (COMPUTED_REDIRECT.test(code)) f.redirects.push('?');
    let importsIa = false;
    for (const imp of extractImports(src, kind)) {
      const r = resolver.resolve(file, imp.spec);
      if (r.kind !== 'file' || !r.exists) continue;
      if (r.path === ia) importsIa = true;
      else if (!r.path.split('/').includes('node_modules')) {
        f.imports.push(r.path);
        if (!facts.has(r.path)) queue.push(r.path);
      }
    }
    if (importsIa && LINK_FROM_DATA.test(code)) iaNav.push(file);
  }
  return { facts, iaNav: iaNav.sort() };
}

/** The layouts and templates around a page, from the root segment down: `app/layout.tsx`, `app/(main)/layout.tsx`... */
function wrappers(root: string, rel: string, all: Set<string>): string[] {
  const dirs = rel.split('/').slice(0, -1);
  const out: string[] = [];
  for (let i = 0; i <= dirs.length; i++) {
    const dir = [root, ...dirs.slice(0, i)].join('/');
    for (const name of ['layout', 'template']) {
      for (const ext of ['tsx', 'ts', 'jsx', 'js']) if (all.has(`${dir}/${name}.${ext}`)) out.push(`${dir}/${name}.${ext}`);
    }
  }
  return out;
}

/** The literal redirects in a next.config: `{ source, destination }` pairs in its redirects section, and whether it has any it can't read. */
function configRedirects(project: Project, app: string): { redirects: AppRedirect[]; unreadable: string | null } {
  const file = ['ts', 'mjs', 'js', 'cjs', 'mts'].map((e) => `${app}/next.config.${e}`).find((f) => project.exists(f));
  if (!file) return { redirects: [], unreadable: null };
  const src = project.read(file) ?? '';
  const { masked, code, strings } = lexSource(src, sourceKind(file) ?? 'js');
  const at = code.search(/(?<![\w$.])redirects\s*[(:]/);
  if (at === -1) return { redirects: [], unreadable: null };
  // The redirects section runs to the next sibling that isn't a redirect (headers, rewrites) or the end.
  const next = code.slice(at + 1).search(/(?<![\w$.])(?:headers|rewrites)\s*[(:]/);
  const end = next === -1 ? code.length : at + 1 + next;
  const literal = (key: string) =>
    strings.filter((s) => s.open > at && s.open < end && s.closed && s.runs.length === 1 && keyBefore(masked, s.open) === key).map((s) => src.slice(s.runs[0]![0], s.runs[0]![1]).split(/[?#]/)[0]!);
  const sources = literal('source');
  const destinations = literal('destination');
  const keys = (key: string) => (code.slice(at, end).match(new RegExp(`(?<![\\w$.])${key}\\s*:`, 'g')) ?? []).length;
  const readable = sources.length > 0 && keys('source') === sources.length && keys('destination') === destinations.length && sources.length === destinations.length;
  if (!readable) return { redirects: [], unreadable: file };
  return { redirects: sources.map((from, i) => ({ from, to: destinations[i]!, file })), unreadable: null };
}

/** A proxy or middleware at the app's root or in src/: it runs before every route. */
function gatekeeperFiles(project: Project, app: string): string[] {
  return project.files([`${app}/{proxy,middleware}.{ts,js,mjs,mts,tsx}`, `${app}/src/{proxy,middleware}.{ts,js,mjs,mts,tsx}`]);
}

export const screens: ScreenAdapter = {
  platform: 'web',
  listScreens(project) {
    const app = webApp(project);
    // Joined, not templated: an app at the project root (`.`) has its routes in `app/`, not `./app/`.
    const roots = [posix.join(app, 'app'), posix.join(app, 'src/app')].filter((r) => isDir(project.abs(r)));
    if (roots.length === 0) return null;
    const { facts, iaNav } = readApp(project, roots);
    const config = configRedirects(project, app);
    const gatekeepers = [...gatekeeperFiles(project, app), ...(config.unreadable ? [config.unreadable] : [])];
    // What a file and everything it imports can do, once per file.
    const reach = new Map<string, Set<string>>();
    const closure = (file: string): Set<string> => {
      const done = reach.get(file);
      if (done) return done;
      const seen = new Set<string>();
      const stack = [file];
      while (stack.length > 0) {
        const f = stack.pop()!;
        if (seen.has(f)) continue;
        seen.add(f);
        stack.push(...(facts.get(f)?.imports ?? []));
      }
      reach.set(file, seen);
      return seen;
    };
    const out: ScreenRef[] = [];
    for (const root of roots) {
      const all = new Set(project.files([`${root}/**`]));
      for (const file of project.files([`${root}/**/page.{tsx,ts,jsx,js,mdx}`])) {
        const rel = file.slice(root.length + 1);
        const route = routeOf(rel);
        if (route === null) continue;
        const devOnly = isDevOnly(rel);
        if (devOnly) {
          out.push({ route, file, devOnly });
          continue;
        }
        const chain = [...wrappers(root, rel, all), file];
        const reached = new Set(chain.flatMap((f) => [...closure(f)]));
        const own = facts.get(file);
        // A layout's guard covers the pages under it, but declares its own segment's page, not theirs.
        const id = own?.guards[0];
        // The route guards itself when the page or a layout around it calls guardPage; anything it
        // imports that could turn a visitor away makes its access unknown, never none.
        const guarded = chain.some((f) => facts.get(f)?.guarded);
        const exits = [...reached].some((f) => facts.get(f)?.exits);
        const access = guarded ? 'ia' : exits || gatekeepers.length > 0 ? 'unknown' : 'none';
        // One target is where it goes; two or more, such as a sign-in redirect first, can't be told apart.
        const targets = [...new Set(own?.redirects ?? [])];
        const redirectTo = targets.length === 1 ? targets[0] : targets.length > 1 ? '?' : undefined;
        out.push({ route, file, devOnly, ...(id ? { id } : {}), access, ...(redirectTo ? { redirectTo } : {}) });
      }
    }
    const files = [...facts.keys()].filter((f) => facts.get(f)!.links.length > 0).sort();
    return {
      screens: out,
      inputs: roots.map((r) => `${r}/**/page.tsx`),
      links: files.flatMap((f) => facts.get(f)!.links),
      iaNav,
      redirects: config.redirects,
      gatekeepers,
    };
  },
};


/** A fail-closed mock `fetch` built from the contract and its fixtures. Framework-free, so it runs in Vitest and the browser. */
export function mockFetchSource(contract: ContractModel): string {
  const fixtures = [...contract.fixtures].sort((a, b) => a.file.localeCompare(b.file));
  const variable = new Map(fixtures.map((fixture, index) => [fixture.file, `fixture_${index}`]));
  const imports = fixtures.map(
    (f) => `import ${variable.get(f.file)} from ${JSON.stringify(posix.relative(posix.join(contract.dir, 'generated'), f.file).replace(/^(?!\.)/, './'))} with { type: 'json' };`,
  );
  const ops = contract.operations.map((o) => {
    const pattern = o.path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '[^/]+');
    return `  { operationId: ${JSON.stringify(o.operationId)}, method: ${JSON.stringify(o.method)}, path: ${JSON.stringify(o.path)}, pattern: new RegExp(${JSON.stringify(`^${pattern}$`)}) },`;
  });
  const byOp = new Map<string, string[]>();
  for (const f of fixtures) byOp.set(f.operationId, [...(byOp.get(f.operationId) ?? []), `    ${JSON.stringify(f.variant)}: ${variable.get(f.file)} as Fixture,`]);
  const table = [...byOp].map(([op, lines]) => `  ${JSON.stringify(op)}: {\n${lines.join('\n')}\n  },`);
  return `/* generated by fwos, do not edit. source: ${contract.source} + ${contract.dir}/fixtures/. Run \`fwos contract mocks\` after changing them. */
// A fail-closed mock fetch: any request the contract doesn't declare throws, and every call is recorded
// so tests can assert the handler was hit. Pick a fixture variant per operation (default: "default").
${imports.join('\n')}

export interface Fixture {
  status: number;
  body?: unknown;
}

export const operations = [
${ops.join('\n')}
] as const;

export type OperationId = (typeof operations)[number]['operationId'];

export const fixtures: Partial<Record<OperationId, Record<string, Fixture>>> = {
${table.join('\n')}
};

export interface MockCall {
  operationId: OperationId;
  method: string;
  url: string;
  body?: unknown;
}

export type MockFetch = typeof fetch & { calls: MockCall[] };

export function createMockFetch(variants: Partial<Record<OperationId, string>> = {}, baseUrl = ''): MockFetch {
  const calls: MockCall[] = [];
  const mock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    const path = baseUrl && url.pathname.startsWith(baseUrl) ? url.pathname.slice(baseUrl.length) || '/' : url.pathname;
    const op = operations.find((o) => o.method === method && o.pattern.test(path));
    if (!op) throw new Error(\`mock fetch: unexpected request \${method} \${url.pathname} (not in the contract)\`);
    const variant = variants[op.operationId] ?? 'default';
    const fixture = fixtures[op.operationId]?.[variant];
    if (!fixture) throw new Error(\`mock fetch: no fixture \${op.operationId}.\${variant}.json\`);
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ operationId: op.operationId, method, url: url.pathname + url.search, ...(body === undefined ? {} : { body }) });
    const payload = fixture.body === undefined || fixture.status === 204 ? null : JSON.stringify(fixture.body);
    return new Response(payload, { status: fixture.status, headers: payload ? { 'content-type': 'application/json' } : {} });
  };
  return Object.assign(mock as typeof fetch, { calls });
}
`;
}

export const fixtures: StateFixturesAdapter = {
  platform: 'web',
  generate(project, contract): GeneratedFile[] {
    if (contract.operations.length === 0) return [];
    return [
      {
        path: posix.join(contract.dir, 'generated', 'mock-fetch.ts'),
        content: mockFetchSource(contract),
        source: `${contract.source} + ${contract.dir}/fixtures/`,
      },
    ];
  },
};

export function playwrightBrowsersDir(): string {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  return join(homedir(), '.cache', 'ms-playwright');
}

export function hasChromium(): boolean {
  const dir = playwrightBrowsersDir();
  try {
    return readdirSync(dir).some((d) => d.startsWith('chromium'));
  } catch {
    return false;
  }
}

/** fwos's harness files, as the plugin ships them, and the name each takes in the app's e2e folder. */
export const HARNESS_DIR = pluginPath('platforms', 'web', 'templates', 'harness');
const HARNESS_FILES = [
  ['states', 'fwos-states.spec.ts'],
  ['ia', 'fwos-ia.spec.ts'],
] as const;

export const verify: VerifyDriver = {
  platform: 'web',
  name: 'Playwright',
  probe(project) {
    const app = webApp(project);
    const pkg = readJson<{ devDependencies?: Record<string, string>; dependencies?: Record<string, string> }>(project.abs(`${app}/package.json`));
    if (!pkg) return { ready: false, reason: `no ${app}/package.json yet (the scaffold creates it)` };
    const declared = { ...pkg.dependencies, ...pkg.devDependencies }['@playwright/test'];
    if (!declared) return { ready: false, reason: `@playwright/test isn't a dependency of ${app}` };
    if (!project.exists(`${app}/playwright.config.ts`)) return { ready: false, reason: `no ${app}/playwright.config.ts` };
    if (!existsSync(project.abs(`${app}/node_modules/@playwright/test`)) && !existsSync(project.abs('node_modules/@playwright/test'))) {
      return { ready: false, reason: 'dependencies not installed (run pnpm install)' };
    }
    if (!hasChromium()) return { ready: false, reason: `no Chromium in ${playwrightBrowsersDir()} (run: pnpm exec playwright install chromium)` };
    return { ready: true, detail: `@playwright/test ${declared}` };
  },
  harness(project) {
    return HARNESS_FILES.map(([kind, name]) => {
      const content = readText(join(HARNESS_DIR, name));
      if (content === null) throw new FwosError(`The plugin is missing its harness file ${name}.`, 'Reinstall the plugin.');
      return { kind, file: posix.join(webApp(project), 'e2e', name), content };
    });
  },
  fixture(project, f) {
    const state = encodeURIComponent(f.state);
    const routes = [posix.join(webApp(project), 'app'), posix.join(webApp(project), 'src/app')];
    const has = (folder: string) => routes.some((r) => project.exists(posix.join(r, DEV_ONLY_GROUP, 'fwos-screens', folder, 'page.tsx')));
    // The screens browser, which the scaffold writes, renders pages and components; the comparison gallery, in any app it was written into, components.
    if (f.kind === 'page') return has('[pageId]') ? `${DEV_ONLY_ROUTE}/${f.id}?state=${state}` : null;
    if (has('components/[componentId]')) return `${DEV_ONLY_ROUTE}/components/${f.id}?state=${state}`;
    if (has('fwos-gallery')) return `${DEV_ONLY_ROUTE}/fwos-gallery?fixture=${encodeURIComponent(f.id)}&state=${state}`;
    return null;
  },
  render: (project, request) => renderFixture(project.root, webApp(project), request),
};

export function commandVersion(cmd: string, args: string[] = ['--version']): string | null {
  try {
    return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, shell: process.platform === 'win32' })
      .toString()
      .trim()
      .split('\n')[0]!;
  } catch {
    return null;
  }
}
