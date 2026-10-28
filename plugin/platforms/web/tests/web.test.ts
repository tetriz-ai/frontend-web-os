// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { execFileSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type CheckResult, type ContractModel, adapterSet, loadProject } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { components, fixtures, mockFetchSource, profile, routeOf, screens, verify } from '../index.ts';

afterAll(cleanupTempProjects);

describe('routeOf', () => {
  it.each([
    ['page.tsx', '/'],
    ['items/[id]/page.tsx', '/items/[id]'],
    ['(main)/settings/page.tsx', '/settings'],
    ['(fwos-screens)/fwos-screens/[page]/page.tsx', '/fwos-screens/[page]'],
    ['__screens/page.tsx', null],
    ['_private/page.tsx', null],
    ['@modal/x/page.tsx', null],
    ['(.)photo/page.tsx', null],
  ])('%s -> %s', (rel, route) => expect(routeOf(rel)).toBe(route));
});

describe('screen adapter', () => {
  it('walks app/ and src/app, marking the screens group dev-only', () => {
    const root = tempProject({
      'apps/web/app/page.tsx': '',
      'apps/web/app/(main)/settings/page.tsx': '',
      'apps/web/app/(fwos-screens)/fwos-screens/page.tsx': '',
      'apps/web/app/api/items/route.ts': '',
      'apps/web/app/layout.tsx': '',
    });
    const r = screens.listScreens(loadProject(root))!;
    expect(r.screens.map((s) => `${s.route}${s.devOnly ? ' (dev)' : ''}`).sort()).toEqual(['/', '/fwos-screens (dev)', '/settings']);
  });

  it('marks only the screens browser dev-only, not every page in its route group', () => {
    const root = tempProject({
      'apps/web/app/page.tsx': '',
      'apps/web/app/(fwos-screens)/fwos-screens/page.tsx': '',
      'apps/web/app/(fwos-screens)/fwos-screens/[pageId]/page.tsx': '',
      'apps/web/app/(fwos-screens)/admin/page.tsx': '',
      'apps/web/app/(fwos-screens)/fwos-screens-old/page.tsx': '',
      'apps/web/src/app/fwos-screens/elsewhere/page.tsx': '',
    });
    const r = screens.listScreens(loadProject(root))!;
    expect(r.screens.map((s) => `${s.route}${s.devOnly ? ' (dev)' : ''}`).sort()).toEqual([
      '/',
      '/admin',
      '/fwos-screens (dev)',
      '/fwos-screens-old',
      '/fwos-screens/[pageId] (dev)',
      '/fwos-screens/elsewhere',
    ]);
  });

  it('returns null when there is no app', () => {
    expect(screens.listScreens(loadProject(tempProject()))).toBeNull();
  });

  it('reads the routes of an app at the project root, as adopt mode records it', () => {
    const root = tempProject({
      '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'new', platforms: ['web'], paths: { apps: { web: '.' } } },
      'app/page.tsx': '',
      'app/legal/[doc]/page.tsx': '',
      'app/(marketing)/pricing/page.tsx': '',
      'app/(fwos-screens)/fwos-screens/page.tsx': '',
      'app/nav.tsx': "export const NAV = [{ href: '/pricing' }];\n",
      'app/layout.tsx': "import { NAV } from './nav';\nexport default function L() { return NAV; }\n",
    });
    const r = screens.listScreens(loadProject(root))!;
    expect(r.screens.map((s) => `${s.route}${s.devOnly ? ' (dev)' : ''}`).sort()).toEqual(['/', '/fwos-screens (dev)', '/legal/[doc]', '/pricing']);
    expect(r.links!.map((l) => l.to)).toEqual(['/pricing']);
  });

  describe('links', () => {
    const tsconfig = { compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } };
    const links = (files: Record<string, string | object>) => {
      const r = screens.listScreens(loadProject(tempProject({ 'apps/web/tsconfig.json': tsconfig, ...files })))!;
      return { to: r.links!.map((l) => `${l.to} ${l.file}:${l.line}`), iaNav: r.iaNav };
    };

    it('reads link paths from hrefs, nav lists, router calls and redirects, with a template literal\'s ${...} as a dynamic segment', () => {
      const page = [
        "import Link from 'next/link';",
        "import { redirect, useRouter } from 'next/navigation';",
        "const NAV = [{ label: 'Team', href: '/team' }, { label: 'Help', path: '/help' }];",
        'export default function Page({ id }) {',
        '  const router = useRouter();',
        "  if (!id) redirect('/start');",
        '  return <>',
        '    <Link href="/settings?tab=profile#top">Settings</Link>',
        "    <a href={'/about'}>About</a>",
        '    <Link href={`/items/${id}/edit`}>Edit</Link>',
        "    <button onClick={() => router.push('/members')}>Members</button>",
        '    <a href="https://example.com/out">Out</a> <a href="#main">Skip</a> <img src="/logo.png" />',
        '  </>;',
        '}',
      ].join('\n');
      expect(links({ 'apps/web/app/page.tsx': page }).to).toEqual([
        '/team apps/web/app/page.tsx:3',
        '/help apps/web/app/page.tsx:3',
        '/start apps/web/app/page.tsx:6',
        '/settings apps/web/app/page.tsx:8',
        '/about apps/web/app/page.tsx:9',
        '/items/[]/edit apps/web/app/page.tsx:10',
        '/members apps/web/app/page.tsx:11',
      ]);
    });

    it('reads only code a route renders: its files and what they import, through aliases and barrels', () => {
      const r = links({
        'apps/web/app/layout.tsx': "import { Nav } from '@/shared/nav';\nexport default function L({ children }) { return <><Nav />{children}</>; }",
        'apps/web/app/page.tsx': 'export default function P() { return null; }',
        'apps/web/src/shared/nav/index.ts': "export { Nav } from './nav';",
        'apps/web/src/shared/nav/nav.tsx': "export const Nav = () => <a href=\"/settings\">Settings</a>;",
        // Imported by no route, a test, a story, or only by the dev-only screens browser.
        'apps/web/src/features/orphan.tsx': 'export const Orphan = () => <a href="/orphan">x</a>;',
        'apps/web/src/shared/nav/nav.test.tsx': "it('links', () => <a href=\"/from-test\" />);",
        'apps/web/src/shared/nav/nav.stories.tsx': 'export const S = () => <a href="/from-story" />;',
        'apps/web/app/(fwos-screens)/fwos-screens/page.tsx': "import { Preview } from '@/screens/preview';\nexport default function S() { return <Preview />; }",
        'apps/web/src/screens/preview.tsx': 'export const Preview = () => <a href="/from-screens-browser" />;',
      });
      expect(r.to).toEqual(['/settings apps/web/src/shared/nav/nav.tsx:1']);
      expect(r.iaNav).toEqual([]);
    });

    it("counts a nav built from ia.json, as the scaffold's is, as linking every nav page, when a route renders it", () => {
      const nav = "import ia from '../../../../../docs/app/ia.json';\nexport const Nav = () => ia.pages.map((p) => <a key={p.id} href={p.route}>{p.title}</a>);";
      const layout = "import { Nav } from '@/shared/nav/nav';\nexport default function L({ children }) { return <><Nav />{children}</>; }";
      const files = { 'docs/app/ia.json': { schema: 1, roles: ['user'], pages: [] }, 'apps/web/src/shared/nav/nav.tsx': nav, 'apps/web/app/page.tsx': '' };
      expect(links({ ...files, 'apps/web/app/layout.tsx': layout }).iaNav).toEqual(['apps/web/src/shared/nav/nav.tsx']);
      // Not rendered by any route, or reading ia.json for titles only: no links.
      expect(links(files).iaNav).toEqual([]);
      const titles = "import ia from '../../../../../docs/app/ia.json';\nexport const Nav = () => <h1>{ia.pages[0].title}</h1>;";
      expect(links({ ...files, 'apps/web/src/shared/nav/nav.tsx': titles, 'apps/web/app/layout.tsx': layout }).iaNav).toEqual([]);
    });
  });
});

describe('screen adapter: IDs, access and redirects', () => {
  const tsconfig = { compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } };
  const guard = "import { guardPage } from '@/shared/access/server';\n";
  const read = (files: Record<string, string | object>) => screens.listScreens(loadProject(tempProject({ 'apps/web/tsconfig.json': tsconfig, ...files })))!;
  const rows = (r: ReturnType<typeof read>) => r.screens.filter((s) => !s.devOnly).map((s) => `${s.route} ${s.id ?? '-'} ${s.access}${s.redirectTo ? ` -> ${s.redirectTo}` : ''}`).sort();

  it('reads the page ID a route declares with guardPage, and whether anything in its code could turn a visitor away', () => {
    const r = read({
      'apps/web/app/layout.tsx': 'export default function L({ children }) { return children; }',
      'apps/web/app/page.tsx': `${guard}export default async function P() { await guardPage('home'); return null; }`,
      // Renders for everyone: nothing in it, its layouts or what they import can refuse anyone.
      'apps/web/app/members/page.tsx': "import { Table } from '@/features/members';\nexport default function M() { return <Table />; }",
      'apps/web/src/features/members/index.tsx': 'export const Table = () => <table />;',
      // Its own check, which fwos can't read: it might limit access, so it's unknown, never none.
      'apps/web/app/admin/page.tsx': "import { notFound } from 'next/navigation';\nimport { isAdmin } from '@/shared/session';\nexport default async function A() { if (!(await isAdmin())) notFound(); return null; }",
      'apps/web/src/shared/session.ts': 'export const isAdmin = async () => false;',
      // A layout's guard covers the pages under it; the page itself declares no ID.
      'apps/web/app/settings/layout.tsx': `${guard}export default async function L({ children }) { await guardPage('settings'); return children; }`,
      'apps/web/app/settings/billing/page.tsx': 'export default function B() { return null; }',
    });
    expect(rows(r)).toEqual(['/ home ia', '/admin - unknown', '/members - none', '/settings/billing - ia']);
    expect(r.gatekeepers).toEqual([]);
  });

  it("doesn't take the guard's own definition, which the layout imports, for a call to it", () => {
    // The scaffold's layout imports the session module, where guardPage is defined (and calls notFound).
    const session = "import { notFound } from 'next/navigation';\nexport async function currentAccess() { return { role: 'member', flags: [] }; }\nexport async function guardPage(id: string) { if (id === 'x') notFound(); }\n";
    const r = read({
      'apps/web/src/shared/session/index.ts': "export { currentAccess, guardPage } from './session';",
      'apps/web/src/shared/session/session.ts': session,
      'apps/web/app/layout.tsx': "import { currentAccess } from '@/shared/session';\nexport default async function L({ children }) { await currentAccess(); return children; }",
      'apps/web/app/page.tsx': `${guard.replace('/server', '')}export default async function P() { await guardPage('home'); return null; }`,
      'apps/web/app/members/page.tsx': 'export default function M() { return <main>Members</main>; }',
    });
    expect(rows(r)).toEqual(['/ home ia', '/members - none']);
  });

  it('reads an app at the project root, as adopt mode records it, with its layouts and guards', () => {
    const r = screens.listScreens(
      loadProject(
        tempProject({
          '.fwos/state.json': { schema: 1, platforms: ['web'], paths: { apps: { web: '.' } } },
          'tsconfig.json': tsconfig,
          'app/layout.tsx': `${guard}export default async function L({ children }) { await guardPage('home'); return children; }`,
          'app/page.tsx': `${guard}export default async function P() { await guardPage('home'); return null; }`,
          'app/about/page.tsx': 'export default function A() { return null; }',
        }),
      ),
    )!;
    // The layout's guard covers /about too: access through it, though /about declares no ID.
    expect(rows(r)).toEqual(['/ home ia', '/about - ia']);
  });

  it('calls no route open when a proxy or middleware stands in front of every route', () => {
    for (const file of ['apps/web/proxy.ts', 'apps/web/middleware.ts', 'apps/web/src/proxy.ts']) {
      const r = read({ 'apps/web/app/members/page.tsx': 'export default function M() { return null; }', [file]: 'export function proxy() {}' });
      expect(rows(r), file).toEqual(['/members - unknown']);
      expect(r.gatekeepers, file).toEqual([file]);
    }
  });

  it('reads redirects: where a page redirects, and next.config redirects written as literal paths', () => {
    const r = read({
      'apps/web/app/old/page.tsx': "import { redirect } from 'next/navigation';\nexport default function O() { redirect('/new'); }",
      'apps/web/app/elsewhere/page.tsx': "import { redirect } from 'next/navigation';\nexport default function E({ to }) { redirect(to); }",
      // Two targets, one only when signed out: which it takes isn't in the code.
      'apps/web/app/either/page.tsx': "import { redirect } from 'next/navigation';\nexport default function E({ user }) { if (!user) redirect('/login'); redirect('/new'); }",
      'apps/web/app/new/page.tsx': 'export default function N() { return null; }',
      'apps/web/next.config.ts': "export default { async redirects() { return [{ source: '/legacy', destination: '/new?from=legacy', permanent: true }]; } };",
    });
    expect(rows(r)).toEqual(['/either - unknown -> ?', '/elsewhere - unknown -> ?', '/new - none', '/old - unknown -> /new']);
    expect(r.redirects).toEqual([{ from: '/legacy', to: '/new', file: 'apps/web/next.config.ts' }]);
    expect(r.gatekeepers).toEqual([]);
  });

  it("counts next.config redirects it can't read as a gatekeeper, rather than reading none", () => {
    const r = read({
      'apps/web/app/page.tsx': '',
      'apps/web/next.config.ts': "import legacy from './legacy.json';\nexport default { redirects: async () => legacy.map((l) => ({ source: l.from, destination: l.to, permanent: true })) };",
    });
    expect(r.redirects).toEqual([]);
    expect(r.gatekeepers).toEqual(['apps/web/next.config.ts']);
  });
});

describe('verify driver harness', () => {
  it("ships fwos's two harness files for the app's e2e folder, read from the plugin", () => {
    const h = verify.harness!(loadProject(tempProject()));
    expect(h.map((x) => `${x.kind} ${x.file}`)).toEqual(['states apps/web/e2e/fwos-states.spec.ts', 'ia apps/web/e2e/fwos-ia.spec.ts']);
    for (const x of h) expect(x.content).toMatch(/^\/\/ Copyright 2026 Workloom Solutions Private Limited\n/);
    // An app elsewhere gets them in its own e2e folder.
    const elsewhere = tempProject({ '.fwos/state.json': { schema: 1, platforms: ['web'], paths: { apps: { web: 'site' } } } });
    expect(verify.harness!(loadProject(elsewhere)).map((x) => x.file)).toEqual(['site/e2e/fwos-states.spec.ts', 'site/e2e/fwos-ia.spec.ts']);
  });
});

describe('component adapter', () => {
  it('lists installed components by file name', () => {
    const root = tempProject({
      'apps/web/src/shared/ui/button.tsx': '',
      'apps/web/src/shared/ui/state-handler.tsx': '',
      'apps/web/src/shared/ui/button.test.tsx': '',
      'apps/web/src/shared/ui/index.ts': '',
    });
    expect(components.listInstalled(loadProject(root)).map((c) => c.id)).toEqual(['button', 'state-handler']);
    expect(components.importFor('button')).toBe('@/shared/ui/button');
  });

  it('lists .jsx and .js components, and a folder in the UI folder as one component named after it', () => {
    const root = tempProject({
      'apps/web/src/shared/ui/button.tsx': '',
      'apps/web/src/shared/ui/fancy.jsx': '',
      'apps/web/src/shared/ui/legacy.js': '',
      'apps/web/src/shared/ui/index.tsx': '',
      'apps/web/src/shared/ui/types.d.ts': '',
      'apps/web/src/shared/ui/fancy.stories.jsx': '',
      'apps/web/src/shared/ui/data-table/index.ts': '',
      'apps/web/src/shared/ui/data-table/columns.tsx': '',
      'apps/web/src/shared/ui/date-picker/parts/calendar.tsx': '',
      'apps/web/src/shared/ui/__tests__/helpers.tsx': '',
      'apps/web/src/shared/ui/only-tests/x.test.tsx': '',
      'apps/web/src/shared/ui/styles/theme.css': '',
      // Type declarations, config dotfiles and tests, whatever the project's test globs say.
      'apps/web/src/shared/ui/globals.d.mts': '',
      'apps/web/src/shared/ui/.eslintrc.cjs': '',
      'apps/web/src/shared/ui/button.test.tsx': '',
      'apps/web/src/shared/ui/button.spec.ts': '',
    });
    const expected = [
      { id: 'button', file: 'apps/web/src/shared/ui/button.tsx' },
      { id: 'data-table', file: 'apps/web/src/shared/ui/data-table' },
      { id: 'date-picker', file: 'apps/web/src/shared/ui/date-picker' },
      { id: 'fancy', file: 'apps/web/src/shared/ui/fancy.jsx' },
      { id: 'legacy', file: 'apps/web/src/shared/ui/legacy.js' },
    ];
    expect(components.listInstalled(loadProject(root))).toEqual(expected);
    const project = loadProject(root);
    project.paths.tests = ['**/e2e/**'];
    expect(components.listInstalled(project)).toEqual(expected);
  });
});

const contract: ContractModel = {
  dir: 'packages/api-contract',
  source: 'packages/api-contract/openapi.yaml',
  operations: [
    { operationId: 'listItems', method: 'GET', path: '/items', statuses: ['200'] },
    { operationId: 'deleteItem', method: 'DELETE', path: '/items/{id}', statuses: ['204'] },
  ],
  fixtures: [
    { operationId: 'listItems', variant: 'default', file: 'packages/api-contract/fixtures/listItems.default.json', status: 200 },
    { operationId: 'listItems', variant: 'empty', file: 'packages/api-contract/fixtures/listItems.empty.json', status: 200 },
    { operationId: 'deleteItem', variant: 'default', file: 'packages/api-contract/fixtures/deleteItem.default.json', status: 204 },
  ],
};

describe('fixtures adapter', () => {
  it('generates a fail-closed mock fetch that actually works', async () => {
    const [file] = fixtures.generate(loadProject(tempProject()), contract);
    expect(file!.path).toBe('packages/api-contract/generated/mock-fetch.ts');
    const root = tempProject({
      'generated/mock-fetch.ts': file!.content,
      'fixtures/listItems.default.json': { status: 200, body: [{ id: '1' }] },
      'fixtures/listItems.empty.json': { status: 200, body: [] },
      'fixtures/deleteItem.default.json': { status: 204 },
      'run.ts': `import { createMockFetch } from './generated/mock-fetch.ts';
const f = createMockFetch({ listItems: 'empty' }, '/api');
const a = await (await f('/api/items')).json();
const d = await f('/api/items/42', { method: 'DELETE' });
let err = '';
try { await f('/api/nope'); } catch (e) { err = (e as Error).message; }
console.log(JSON.stringify({ a, status: d.status, calls: f.calls.map((c) => c.operationId), err }));
`,
    });
    const out = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'run.ts'], { cwd: root }).toString();
    expect(JSON.parse(out)).toEqual({
      a: [],
      status: 204,
      calls: ['listItems', 'deleteItem'],
      err: 'mock fetch: unexpected request GET /api/nope (not in the contract)',
    });
  });

  it('generates nothing for an empty contract', () => {
    expect(fixtures.generate(loadProject(tempProject()), { ...contract, operations: [], fixtures: [] })).toEqual([]);
  });

  it('keeps generated output stable', () => {
    const src = mockFetchSource(contract);
    // Positive control: the output reflects the contract, so a stub that returns a constant fails here.
    expect(src.split('\n').filter((l) => l.startsWith('import '))).toEqual([
      "import fixture_0 from \"../fixtures/deleteItem.default.json\" with { type: 'json' };",
      "import fixture_1 from \"../fixtures/listItems.default.json\" with { type: 'json' };",
      "import fixture_2 from \"../fixtures/listItems.empty.json\" with { type: 'json' };",
    ]);
    expect(mockFetchSource({ ...contract, operations: contract.operations.slice(0, 1) })).not.toBe(src);
    // Stable: the same contract, with its fixtures listed in another order, gives the same file.
    expect(mockFetchSource({ ...contract, fixtures: [...contract.fixtures].reverse() })).toBe(src);
  });
});

describe('verify driver', () => {
  it('explains why it is not ready', () => {
    expect(verify.probe(loadProject(tempProject())).reason).toMatch(/no apps\/web\/package.json/);
    const root = tempProject({ 'apps/web/package.json': { devDependencies: {} } });
    expect(verify.probe(loadProject(root)).reason).toMatch(/@playwright\/test isn't a dependency/);
  });
});

const run = async (id: string, root: string) =>
  (await profile.checks.find((c) => c.id === id)!.run({ project: loadProject(root), adapters: adapterSet([profile]) })) as CheckResult;

describe('web/security', () => {
  it('needs a CSP and catches public secrets and hard-coded keys', async () => {
    const root = tempProject({
      'apps/web/package.json': {},
      'apps/web/next.config.ts': 'export default {};',
      'apps/web/src/env.ts': 'export const k = process.env.NEXT_PUBLIC_PAYMENTS_SECRET_KEY;\nconst aws = "AKIAABCDEFGHIJKLMNOP";', // gitleaks:allow (a made-up key the check must catch)
    });
    const r = await run('web/security', root);
    expect(r.findings.map((f) => f.rule)).toEqual(['csp', 'public-secret', 'hard-coded-secret']);
  });

  it('passes with a CSP and clean source', async () => {
    const root = tempProject({
      'apps/web/package.json': {},
      'apps/web/next.config.ts': "export default {headers: async () => [{source: '/:path*', headers: [{key: 'Content-Security-Policy', value: \"default-src 'self'\"}]}]};",
      'apps/web/src/env.ts': 'export const k = process.env.NEXT_PUBLIC_MAPS_PUBLIC_KEY;',
    });
    expect((await run('web/security', root)).status).toBe('pass');
  });

  it('is off with no app', async () => {
    expect((await run('web/security', tempProject())).status).toBe('off');
  });

  it('flags a committed .env anywhere, but not .env.example or one that is only on disk', async () => {
    const root = tempProject({
      'apps/web/package.json': {},
      'apps/web/next.config.ts': "export default {headers: async () => [{source: '/:path*', headers: [{key: 'Content-Security-Policy', value: \"default-src 'self'\"}]}]};",
      '.env': 'TOKEN=1',
      '.env.example': 'TOKEN=',
      'apps/web/.env.local': 'TOKEN=2',
      'apps/web/.env.production': 'TOKEN=3',
    });
    // Outside a git repo nothing is committed.
    expect((await run('web/security', root)).findings).toEqual([]);
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '.env', '.env.example', 'apps/web/.env.local'], { cwd: root });
    const r = await run('web/security', root);
    expect(r.findings.map((f) => `${f.rule}: ${f.file}`)).toEqual(['env-committed: .env', 'env-committed: apps/web/.env.local']);
    expect(r.findings[0]!.message).toBe('an .env file is committed; commit .env.example instead and gitignore the real one');
  });

  const cspRules = async (config: string, file = 'apps/web/next.config.ts') =>
    (await run('web/security', tempProject({ 'apps/web/package.json': {}, [file]: config }))).findings.map((f) => f.rule);

  it('fails when the CSP is only mentioned in a comment', async () => {
    expect(await cspRules('// TODO: add a Content-Security-Policy header\nexport default {};\n')).toEqual(['csp']);
    expect(await cspRules('/* headers: [{ key: "Content-Security-Policy", value: "default-src \'self\'" }] */\nexport default {};\n')).toEqual(['csp']);
  });

  it('fails when the CSP header is mentioned but has no value', async () => {
    expect(await cspRules("export default { headers: async () => [{ source: '/', headers: [{ key: 'Content-Security-Policy', value: '' }] }] };")).toEqual(['csp']);
    expect(await cspRules("console.log('Content-Security-Policy');\nexport default {};")).toEqual(['csp']);
    expect(await cspRules("export default { headers: async () => [{ source: '/', headers: [{ key: 'Content-Security-Policy-Report-Only', value: 'x' }] }] };")).toEqual(['csp']);
  });

  it('fails when the CSP header is set to undefined, null or false, in each form it reads', async () => {
    for (const v of ['undefined', 'null', 'false']) {
      expect(await cspRules(`export default { headers: async () => [{ source: '/', headers: [{ key: 'Content-Security-Policy', value: ${v} }] }] };`)).toEqual(['csp']);
      expect(await cspRules(`export default { headers: async () => [{ source: '/', headers: [{ value: ${v}, key: 'Content-Security-Policy' }] }] };`)).toEqual(['csp']);
      expect(await cspRules(`export function proxy() { const res = NextResponse.next(); res.headers.set('Content-Security-Policy', ${v}); return res; }`, 'apps/web/proxy.ts')).toEqual(['csp']);
      expect(await cspRules(`export function middleware() { return NextResponse.next({ headers: { 'Content-Security-Policy': ${v} } }); }`, 'apps/web/middleware.ts')).toEqual(['csp']);
      expect(await cspRules(`export function middleware() { return new Response(null, { headers: [['Content-Security-Policy', ${v}]] }); }`, 'apps/web/middleware.ts')).toEqual(['csp']);
    }
    // Positive control: a variable whose name only starts with one of them is a value.
    expect(await cspRules("const nullSafePolicy = \"default-src 'self'\"; export default { headers: async () => [{ source: '/', headers: [{ key: 'Content-Security-Policy', value: nullSafePolicy }] }] };")).toEqual([]);
  });

  it('scans every script file the token scan reads for keys, in the app and in packages/*, and counts them', async () => {
    // Built here, so no secret scanner flags this file.
    const key = ['sk', 'live', 'abcdefghij0123456789'].join('_');
    const root = tempProject({
      'apps/web/package.json': {},
      'apps/web/next.config.ts': "export default {headers: async () => [{source: '/:path*', headers: [{key: 'Content-Security-Policy', value: \"default-src 'self'\"}]}]};",
      'apps/web/src/a.cjs': `module.exports = '${key}';`,
      'apps/web/src/b.mts': `export const k = '${key}';`,
      'packages/api/src/c.js': `export const k = '${key}';`,
      'packages/api/src/d.cts': `export const k = '${key}';`,
    });
    const r = await run('web/security', root);
    expect(r.findings.map((f) => `${f.rule} ${f.file}`)).toEqual([
      'hard-coded-secret apps/web/src/a.cjs',
      'hard-coded-secret apps/web/src/b.mts',
      'hard-coded-secret packages/api/src/c.js',
      'hard-coded-secret packages/api/src/d.cts',
    ]);
    // The app's package.json is read too.
    expect(r.info).toEqual(['6 files scanned']);
    const one = tempProject({ 'apps/web/package.json': {}, 'apps/web/next.config.ts': "export default {headers: async () => [{source: '/:path*', headers: [{key: 'Content-Security-Policy', value: \"default-src 'self'\"}]}]};" });
    const staged = await profile.checks.find((c) => c.id === 'web/security')!.run({ project: loadProject(one), adapters: adapterSet([profile]), staged: ['apps/web/next.config.ts'] });
    expect(staged.info).toEqual(['1 file scanned']);
  });

  it('scans JSON and HTML files too, and all of packages/*, not only its src/ folders', async () => {
    // Built here, so no secret scanner flags this file.
    const key = ['sk', 'live', 'abcdefghij0123456789'].join('_');
    const pem = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ');
    const root = tempProject({
      'apps/web/package.json': {},
      'apps/web/next.config.ts': "export default {headers: async () => [{source: '/:path*', headers: [{key: 'Content-Security-Policy', value: \"default-src 'self'\"}]}]};",
      'apps/web/public/config.json': `{ "stripe": "${key}" }`,
      'apps/web/public/embed.html': `<script>window.KEY = '${key}';</script>`,
      'packages/api/client.ts': `export const k = '${key}';`,
      'packages/api/lib/service-account.json': `{ "private_key": "${pem}\\nMIIE" }`,
      'packages/api/client.test.ts': `export const k = '${key}';`,
      'packages/api/node_modules/dep/index.js': `export const k = '${key}';`,
    });
    const r = await run('web/security', root);
    expect(r.findings.map((f) => `${f.rule} ${f.file}`)).toEqual([
      'hard-coded-secret apps/web/public/config.json',
      'hard-coded-secret apps/web/public/embed.html',
      'hard-coded-secret packages/api/client.ts',
      'hard-coded-secret packages/api/lib/service-account.json',
    ]);
  });

  it('accepts a CSP header set in next.config or in proxy/middleware', async () => {
    expect(await cspRules("const csp = \"default-src 'self'\";\nexport default { headers: async () => [{ source: '/', headers: [\n  { key: 'Content-Security-Policy', value: csp },\n] }] };")).toEqual([]);
    expect(await cspRules("const csp = \"default-src 'self'\"; export default { headers: async () => [{ source: '/', headers: [{ value: csp, key: \"Content-Security-Policy\" }] }] };")).toEqual([]);
    expect(await cspRules("const csp = \"default-src 'self'\"; export function proxy() { const res = NextResponse.next(); res.headers.set('Content-Security-Policy', csp); return res; }", 'apps/web/proxy.ts')).toEqual([]);
    expect(await cspRules("export function middleware() { return NextResponse.next({ headers: { 'Content-Security-Policy': `default-src 'self'` } }); }", 'apps/web/src/middleware.ts')).toEqual([]);
  });

  describe('in a static export, which cannot send headers', () => {
    const exported = "export default { output: 'export' };\n";
    const rules = async (files: Record<string, string>) =>
      (await run('web/security', tempProject({ 'apps/web/package.json': {}, 'apps/web/next.config.ts': exported, ...files }))).findings;

    it('accepts a CSP meta tag in the app, either attribute order', async () => {
      expect(await rules({ 'apps/web/app/layout.tsx': 'const csp = \"default-src \'self\'\"; export default function L(){return <head><meta httpEquiv="Content-Security-Policy" content={csp} /></head>;}' })).toEqual([]);
      expect(await rules({ 'apps/web/app/layout.tsx': "export default function L(){return <meta content=\"default-src 'self'\" http-equiv='Content-Security-Policy' />;}" })).toEqual([]);
    });

    it('accepts a CSP line in public/_headers', async () => {
      expect(await rules({ 'apps/web/public/_headers': "/*\n  Content-Security-Policy: default-src 'self'\n" })).toEqual([]);
    });

    it("still fails with neither, or an empty or commented-out one, and says what a static export needs", async () => {
      const none = await rules({});
      expect(none.map((f) => f.rule)).toEqual(['csp']);
      expect(none[0]!.message).toMatch(/static export.*<meta http-equiv>.*public\/_headers/);
      expect((await rules({ 'apps/web/app/layout.tsx': '<meta httpEquiv="Content-Security-Policy" content="" />' })).map((f) => f.rule)).toEqual(['csp']);
      expect((await rules({ 'apps/web/app/layout.tsx': '{/* <meta httpEquiv="Content-Security-Policy" content={csp} /> */}' })).map((f) => f.rule)).toEqual(['csp']);
      expect((await rules({ 'apps/web/public/_headers': '/*\n  # Content-Security-Policy: later\n' })).map((f) => f.rule)).toEqual(['csp']);
    });

    it("doesn't accept a CSP from next.config headers() or proxy/middleware, which a static export never sends", async () => {
      const csp = "const csp = \"default-src 'self'\";\n";
      const viaConfig = await run('web/security', tempProject({
        'apps/web/package.json': {},
        'apps/web/next.config.ts': `${csp}export default { output: 'export', headers: async () => [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: csp }] }] };\n`,
      }));
      expect(viaConfig.findings.map((f) => f.rule)).toEqual(['csp']);
      expect(viaConfig.findings[0]!.message).toMatch(/never sent.*<meta http-equiv>.*public\/_headers/);
      const viaProxy = await rules({ 'apps/web/proxy.ts': "export function proxy() { const res = NextResponse.next(); res.headers.set('Content-Security-Policy', csp); return res; }" });
      expect(viaProxy.map((f) => f.rule)).toEqual(['csp']);
      // With a meta tag as well, the page sets it, so it passes.
      expect(await rules({
        'apps/web/proxy.ts': "export function proxy() { const res = NextResponse.next(); res.headers.set('Content-Security-Policy', csp); return res; }",
        'apps/web/app/layout.tsx': 'export default function L(){return <meta httpEquiv="Content-Security-Policy" content="default-src self" />;}',
      })).toEqual([]);
    });

    it("doesn't accept a meta tag in an app that can send headers", async () => {
      const r = await run('web/security', tempProject({ 'apps/web/package.json': {}, 'apps/web/next.config.ts': 'export default {};\n', 'apps/web/app/layout.tsx': '<meta httpEquiv="Content-Security-Policy" content={csp} />' }));
      expect(r.findings.map((f) => f.rule)).toEqual(['csp']);
    });
  });
});

describe('web/licences', () => {
  it('denies AGPL and allows an OR with an allowed branch', async () => {
    const root = tempProject({
      'package.json': { dependencies: { good: '1', bad: '1', dual: '1' } },
      'node_modules/good/package.json': { license: 'MIT' },
      'node_modules/bad/package.json': { license: 'AGPL-3.0-only' },
      'node_modules/dual/package.json': { license: '(AGPL-3.0 OR MIT)' },
    });
    const r = await run('web/licences', root);
    expect(r.findings.map((f) => f.rule)).toEqual(['bad']);
    expect(r.info).toEqual(['3 dependencies checked (3 direct)']);
  });

  it('is off, naming them, while any direct dependency is not installed', async () => {
    const root = tempProject({
      'package.json': { dependencies: { good: '1', ghost: '1' } },
      'apps/web/package.json': { dependencies: { phantom: '1' }, optionalDependencies: { 'fsevents-ish': '1' } },
      'node_modules/good/package.json': { license: 'MIT' },
    });
    const r = await run('web/licences', root);
    expect(r.status).toBe('off');
    expect(r.reason).toBe("not installed, so their licences can't be read: ghost, phantom (run pnpm install; licences come from node_modules)");
  });

  it('fails on a definite finding even while another direct dependency is not installed, and names the missing ones', async () => {
    const root = tempProject({
      'package.json': { dependencies: { bad: '1', ghost: '1' } },
      'node_modules/bad/package.json': { license: 'AGPL-3.0-only' },
    });
    const r = await run('web/licences', root);
    expect(r.status).toBe('fail');
    expect(r.findings.map((f) => f.rule)).toEqual(['bad']);
    expect(r.info).toEqual([
      '1 dependency checked (1 direct)',
      "not installed, so their licences can't be read: ghost (run pnpm install; licences come from node_modules)",
    ]);
  });

  it.each([
    ['package.json workspaces', { 'package.json': { name: 'root', private: true, workspaces: ['apps/*', 'libs/*'] } }],
    ['pnpm-workspace.yaml', { 'package.json': { name: 'root', private: true }, 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'libs/*'\n" }],
  ])('follows a workspace package outside packages/* to what it pulls in (%s)', async (_, workspace) => {
    const root = tempProject({
      ...workspace,
      'apps/web/package.json': { name: 'web', private: true, dependencies: { ui: 'workspace:*' } },
      'libs/ui/package.json': { name: 'ui', license: 'MIT', dependencies: { grabby: '1' } },
      'node_modules/grabby/package.json': { name: 'grabby', license: 'AGPL-3.0-only' },
    });
    const r = await run('web/licences', root);
    expect(r.status).toBe('fail');
    expect(r.findings.map((f) => f.message)).toEqual(["grabby is AGPL-3.0-only, which this project can't ship (pulled in by ui > grabby)"]);
    expect(r.info).toEqual(['1 dependency checked (1 direct)', 'local packages, not checked: ui']);
    expect(r.inputs).toContain('libs/ui/package.json');
  });

  it('follows link: and file: folders and an installed private package to what they pull in', async () => {
    const root = tempProject({
      'package.json': { name: 'app', dependencies: { linked: 'link:./vendor/linked', filed: 'file:vendor/filed', mine: '1', tarball: 'file:./mine-1.0.0.tgz' } },
      'vendor/linked/package.json': { name: 'linked', dependencies: { grabby: '1' } },
      'vendor/filed/package.json': { name: 'filed', dependencies: { tidy: '1', nested: 'file:../nested' } },
      'vendor/nested/package.json': { name: 'nested', dependencies: { sspl: '1' } },
      'node_modules/mine/package.json': { name: 'mine', private: true, dependencies: { busl: '1', ghost: '1' } },
      'node_modules/grabby/package.json': { name: 'grabby', license: 'AGPL-3.0-only' },
      'node_modules/tidy/package.json': { name: 'tidy', license: 'MIT' },
      'node_modules/sspl/package.json': { name: 'sspl', license: 'SSPL-1.0' },
      'node_modules/busl/package.json': { name: 'busl', license: 'BUSL-1.1' },
    });
    const r = await run('web/licences', root);
    expect(r.findings.map((f) => f.message)).toEqual([
      "grabby is AGPL-3.0-only, which this project can't ship (pulled in by linked > grabby)",
      "busl is BUSL-1.1, which this project can't ship (pulled in by mine > busl)",
      "sspl is SSPL-1.0, which this project can't ship (pulled in by filed > nested > sspl)",
    ]);
    expect(r.info).toEqual([
      '4 dependencies checked (4 direct)',
      "not installed, so their licences can't be read: ghost (run pnpm install; licences come from node_modules)",
      'local packages not found, so not checked: tarball',
      'local packages, not checked: linked, filed, mine, nested',
    ]);
  });

  it('walks what each dependency pulls in, and names the path to a denied licence', async () => {
    const root = tempProject({
      'package.json': { dependencies: { wrapper: '1' }, devDependencies: { tooling: '1' } },
      'node_modules/wrapper/package.json': {
        name: 'wrapper',
        license: 'MIT',
        dependencies: { inner: '1' },
        optionalDependencies: { 'opt-in': '1', 'opt-out': '1' },
        peerDependencies: { peer: '1', 'peer-absent': '1' },
        devDependencies: { 'dev-only': '1' },
      },
      // npm's nested layout: inner's own copy of grabby, beside a hoisted one that is fine.
      'node_modules/inner/package.json': { name: 'inner', license: 'ISC', dependencies: { grabby: '2', wrapper: '1' } },
      'node_modules/inner/node_modules/grabby/package.json': { name: 'grabby', license: 'AGPL-3.0-only' },
      'node_modules/grabby/package.json': { name: 'grabby', license: 'MIT' },
      'node_modules/opt-in/package.json': { name: 'opt-in', license: 'SSPL-1.0' },
      'node_modules/peer/package.json': { name: 'peer', license: 'BUSL-1.1' },
      'node_modules/dev-only/package.json': { name: 'dev-only', license: 'AGPL-3.0-only' },
      'node_modules/tooling/package.json': { name: 'tooling', license: 'AGPL-3.0-only' },
    });
    const r = await run('web/licences', root);
    expect(r.findings.map((f) => `${f.rule}: ${f.message}`)).toEqual([
      "opt-in: opt-in is SSPL-1.0, which this project can't ship (pulled in by wrapper > opt-in)",
      "peer: peer is BUSL-1.1, which this project can't ship (pulled in by wrapper > peer)",
      "grabby: grabby is AGPL-3.0-only, which this project can't ship (pulled in by wrapper > inner > grabby)",
    ]);
    expect(r.info).toEqual(['5 dependencies checked (1 direct)']);
  });

  it('follows the pnpm layout through its symlinks', async () => {
    const root = tempProject({
      'package.json': { dependencies: { wrapper: '1' } },
      'node_modules/.pnpm/wrapper@1/node_modules/wrapper/package.json': { name: 'wrapper', license: 'MIT', dependencies: { grabby: '1' } },
      'node_modules/.pnpm/grabby@1/node_modules/grabby/package.json': { name: 'grabby', license: 'AGPL-3.0-only' },
    });
    symlinkSync(join(root, 'node_modules/.pnpm/wrapper@1/node_modules/wrapper'), join(root, 'node_modules/wrapper'), 'dir');
    symlinkSync(join(root, 'node_modules/.pnpm/grabby@1/node_modules/grabby'), join(root, 'node_modules/.pnpm/wrapper@1/node_modules/grabby'), 'dir');
    const r = await run('web/licences', root);
    expect(r.findings.map((f) => f.message)).toEqual(["grabby is AGPL-3.0-only, which this project can't ship (pulled in by wrapper > grabby)"]);
  });

  it('is off, naming them, while a package something pulls in is not found, since it could pull in anything', async () => {
    const root = tempProject({
      'package.json': { dependencies: { wrapper: '1' } },
      'node_modules/wrapper/package.json': { name: 'wrapper', license: 'MIT', dependencies: { lost: '1', mine: 'file:../mine' }, optionalDependencies: { 'opt-out': '1' } },
    });
    const r = await run('web/licences', root);
    expect(r.status).toBe('off');
    expect(r.reason).toBe('not found in node_modules, so not checked: lost (via wrapper); local packages not found, so not checked: mine (via wrapper)');
    // A finding stands while some are missing, and the result still names them.
    const failing = tempProject({
      'package.json': { dependencies: { wrapper: '1', bad: '1' } },
      'node_modules/wrapper/package.json': { name: 'wrapper', license: 'MIT', dependencies: { lost: '1' } },
      'node_modules/bad/package.json': { license: 'AGPL-3.0-only' },
    });
    const f = await run('web/licences', failing);
    expect(f.status).toBe('fail');
    expect(f.info).toEqual(['2 dependencies checked (2 direct)', 'not found in node_modules, so not checked: lost (via wrapper)']);
  });

  it("fails when a package.json of the project's own isn't valid JSON, instead of skipping what it declares", async () => {
    const root = tempProject({
      'package.json': '{ "dependencies": { "grabby": "1" }',
      'apps/web/package.json': { name: 'web', dependencies: { tidy: '1', lib: 'link:../../libs/lib' } },
      'packages/ui/package.json': '{ "name": "ui",',
      'libs/lib/package.json': '["not", "an", "object"]',
      'node_modules/grabby/package.json': { license: 'AGPL-3.0-only' },
      'node_modules/tidy/package.json': { license: 'MIT' },
    });
    const r = await run('web/licences', root);
    expect(r.status).toBe('fail');
    expect(r.findings.map((f) => `${f.file}: ${f.rule}`)).toEqual(['package.json: manifest', 'packages/ui/package.json: manifest', 'libs/lib/package.json: manifest']);
    expect(r.findings[0]!.message).toMatch(/^not valid JSON: .+, so the dependencies it declares can't be checked$/);
    expect(r.findings[2]!.message).toBe("not a JSON object, so the dependencies it declares can't be checked");
    // With nothing else to grade, a broken manifest still fails rather than turning the check off.
    expect((await run('web/licences', tempProject({ 'package.json': '{ "dependencies": {' }))).status).toBe('fail');
  });

  it('denies UNLICENSED in any case', async () => {
    const root = tempProject({
      'package.json': { dependencies: { upper: '1', lower: '1' } },
      'node_modules/upper/package.json': { license: 'UNLICENSED' },
      'node_modules/lower/package.json': { license: 'unlicensed' },
    });
    expect((await run('web/licences', root)).findings.map((f) => f.rule)).toEqual(['upper', 'lower']);
  });

  it('reads SPDX expressions: AND is denied if any part is, OR is allowed if any branch is', async () => {
    const root = tempProject({
      'package.json': { dependencies: { both: '1', either: '1', nested: '1', nestedOk: '1', exception: '1', lower: '1', clause: '1', classpath: '1', custom: '1' } },
      'node_modules/both/package.json': { license: '(MIT AND AGPL-3.0-only)' },
      'node_modules/either/package.json': { license: 'MIT OR AGPL-3.0-only' },
      'node_modules/nested/package.json': { license: '(MIT OR Apache-2.0) AND SSPL-1.0' },
      'node_modules/nestedOk/package.json': { license: 'MIT OR (AGPL-3.0-only AND BSD-3-Clause)' },
      'node_modules/exception/package.json': { license: 'AGPL-3.0-or-later WITH Classpath-exception-2.0' },
      'node_modules/lower/package.json': { license: 'mit and agpl-3.0' },
      'node_modules/clause/package.json': { license: 'Apache-2.0 WITH Commons-Clause' },
      'node_modules/classpath/package.json': { license: 'GPL-2.0-only WITH Classpath-exception-2.0' },
      'node_modules/custom/package.json': { license: 'SEE LICENSE IN LICENSE.md' },
    });
    const r = await run('web/licences', root);
    expect(r.findings.map((f) => f.rule)).toEqual(['both', 'nested', 'exception', 'lower', 'clause']);
    expect(r.info).toEqual(['9 dependencies checked (9 direct)', 'not an SPDX licence, so read it yourself: custom (SEE LICENSE IN LICENSE.md)']);
  });

  it('reads the legacy license object and licenses array, and treats a missing licence as UNLICENSED', async () => {
    const root = tempProject({
      'package.json': { dependencies: { obj: '1', arr: '1', arrOk: '1', none: '1', blank: '1', ok: '1', mine: 'workspace:*' } },
      'node_modules/obj/package.json': { license: { type: 'AGPL-3.0', url: 'https://example.org' } },
      'node_modules/arr/package.json': { licenses: [{ type: 'AGPL-3.0' }] },
      'node_modules/arrOk/package.json': { licenses: [{ type: 'AGPL-3.0' }, { type: 'MIT' }] },
      'node_modules/none/package.json': { name: 'none' },
      'node_modules/blank/package.json': { license: ' ' },
      'node_modules/ok/package.json': { license: { type: 'MIT' } },
      'node_modules/mine/package.json': { name: 'mine', private: true },
    });
    const r = await run('web/licences', root);
    expect(r.findings.map((f) => f.rule)).toEqual(['obj', 'arr', 'none', 'blank']);
    expect(r.findings.find((f) => f.rule === 'none')!.message).toMatch(/no licence.*UNLICENSED/);
    expect(r.info).toEqual(['6 dependencies checked (6 direct)', 'local packages, not checked: mine']);
  });

  it('is off until dependencies are installed', async () => {
    expect((await run('web/licences', tempProject({ 'package.json': { dependencies: { a: '1' } } }))).status).toBe('off');
  });
});
