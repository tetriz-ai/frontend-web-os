// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { loadProject } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { components, inferLayout, inventory } from '../index.ts';

afterAll(cleanupTempProjects);

const next = { dependencies: { next: '15.0.0', react: '19.0.0' } };

describe('inferLayout (adopt mode on web)', () => {
  it('reads a root Next.js app, its source folders and the UI folder shadcn names', () => {
    const root = tempProject({
      'package.json': next,
      'components.json': { aliases: { components: '@/components', ui: '@/components/ui' } },
      'app/page.tsx': '',
      'components/ui/button.tsx': '',
      'lib/utils.ts': '',
      'middleware.ts': '',
    });
    const l = inferLayout(root);
    expect(l.paths).toEqual({ apps: { web: '.' }, source: ['app/**', 'components/**', 'lib/**', 'middleware.ts'], ui: { web: 'components/ui' } });
    expect(l.found.map((f) => `${f.what}: ${f.value} (${f.from})`)).toEqual([
      'web app: . (package.json depends on next)',
      'app source: app/**, components/**, lib/**, middleware.ts (the folders that exist)',
      'UI components: components/ui (components.json aliases.ui (@/components/ui))',
    ]);
    expect(l.missing).toEqual([]);
  });

  it.each(['.', 'apps/site'])('includes Pages Router source for %s while route checks remain partial', (app) => {
    const at = (path: string) => app === '.' ? path : `${app}/${path}`;
    const root = tempProject({
      ...(app === '.' ? {} : { 'package.json': { private: true } }),
      [at('package.json')]: next,
      [at('pages/index.tsx')]: 'export default function Page() { return <div className="bg-red-500" />; }',
    });
    const inv = inventory(root, { app });
    expect(inv.support).toBe('partial');
    expect(inv.layout.paths.source).toEqual([at('pages/**')]);
    expect(inv.limits.join(' ')).toContain('Pages Router');
  });

  it('maps a shadcn alias into src/ when the app keeps its code there', () => {
    const root = tempProject({
      'package.json': next,
      'components.json': { aliases: { components: '@/components' } },
      'src/app/page.tsx': '',
      'src/components/ui/card.tsx': '',
    });
    const l = inferLayout(root);
    expect(l.paths.source).toEqual(['src/**']);
    expect(l.paths.ui).toEqual({ web: 'src/components/ui' });
    expect(l.found.at(-1)?.from).toBe('components.json aliases.ui (@/components/ui)');
  });

  it('finds the app in apps/* and falls back to a UI folder that exists', () => {
    const root = tempProject({
      'package.json': { private: true },
      'apps/docs/package.json': { dependencies: { astro: '5.0.0' } },
      'apps/site/package.json': next,
      'apps/site/app/page.tsx': '',
      'apps/site/components/ui/button.tsx': '',
      'packages/ui/src/index.ts': '',
    });
    const l = inferLayout(root);
    expect(l.paths.apps).toEqual({ web: 'apps/site' });
    // packages/ui isn't a package the app depends on (it has no package.json), so it isn't scanned.
    expect(l.paths.source).toEqual(['apps/site/app/**', 'apps/site/components/**']);
    expect(l.paths.ui).toEqual({ web: 'apps/site/components/ui' });
    expect(l.found.at(-1)?.from).toBe('the folder exists');
  });

  it('scans the workspace packages the app depends on, and no other', () => {
    const root = tempProject({
      'package.json': { private: true },
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
      'apps/site/package.json': { dependencies: { next: '15.0.0', '@example-org/ui': 'workspace:*' } },
      'apps/site/app/page.tsx': '',
      'apps/admin/package.json': { dependencies: { next: '15.0.0', '@example-org/charts': 'workspace:*' } },
      'apps/admin/app/page.tsx': '',
      'packages/ui/package.json': { name: '@example-org/ui' },
      'packages/ui/src/button.tsx': '',
      'packages/charts/package.json': { name: '@example-org/charts' },
      'packages/charts/src/line.tsx': '',
    });
    const l = inferLayout(root, { app: 'apps/site' });
    expect(l.paths.apps).toEqual({ web: 'apps/site' });
    expect(l.paths.source).toEqual(['apps/site/app/**', 'packages/ui/src/**']);
    expect(l.found).toContainEqual({ what: 'workspace package', value: 'packages/ui/src/**', from: 'apps/site/package.json depends on @example-org/ui' });
    // The other app and the package only it uses are skipped by every check.
    expect(l.paths.ignore).toEqual(['spikes/**', '.fwos/cli/**', 'apps/admin/**', 'packages/charts/**']);
    expect(l.found).toContainEqual({ what: 'skipped', value: 'apps/admin/**, packages/charts/**', from: 'pnpm-workspace.yaml members apps/site does not use' });
  });

  it('says what it could not find, and records nothing it guessed', () => {
    const none = inferLayout(tempProject({ 'package.json': { dependencies: { vite: '6.0.0' } } }));
    expect(none.paths).toEqual({});
    expect(none.missing).toEqual(['a Next.js app (no package.json that depends on next, at the root or in apps/*)']);
    const noUi = inferLayout(tempProject({ 'package.json': next, 'app/page.tsx': '' }));
    expect(noUi.paths.ui).toBeUndefined();
    expect(noUi.missing).toEqual(['a UI components folder (none of components/ui, src/components/ui, src/shared/ui)']);
  });
});

describe('inventory (what fwos adopt reads before it proposes anything)', () => {
  const full = {
    'package.json': {
      name: 'example-org',
      packageManager: 'pnpm@10.0.0',
      scripts: { dev: 'next dev', build: 'next build', test: 'vitest run', 'test:e2e': 'playwright test', lint: 'eslint .' },
      dependencies: {
        next: '15.3.0',
        react: '19.1.0',
        '@radix-ui/react-dialog': '1.1.0',
        'drizzle-orm': '0.43.0',
        swr: '2.3.0',
        'next-auth': '5.0.0',
        '@vercel/flags': '3.0.0',
        'next-themes': '0.4.0',
      },
      devDependencies: { typescript: '5.8.0', tailwindcss: '4.1.0', vitest: '3.0.0', '@playwright/test': '1.50.0', '@testing-library/react': '16.0.0' },
    },
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    'components.json': { style: 'new-york', tailwind: { css: 'app/globals.css' }, aliases: { ui: '@/components/ui' } },
    'app/layout.tsx': 'export default function Layout({ children }) { return children; }\n',
    'app/page.tsx': 'export default function Home() { return null; }\n',
    'app/members/page.tsx': 'export default function Members() { return null; }\n',
    'app/(auth)/sign-in/page.tsx': 'export default function SignIn() { return null; }\n',
    'app/api/members/route.ts': 'export async function GET() { return Response.json([]); }\n',
    'app/members/actions.ts': "'use server';\nexport async function invite() {}\n",
    'app/globals.css': '@import "tailwindcss";\n:root { --background: #fff; }\n.dark { --background: #000; }\n',
    'components/ui/button.tsx': 'export const Button = () => null;\n',
    'components/ui/table.tsx': 'export const Table = () => null;\n',
    'lib/db/schema.ts': "export const users = pgTable('users', { role: varchar('role') });\n",
    'drizzle.config.ts': 'export default {};\n',
    'middleware.ts': 'export function middleware() {}\n',
    'vitest.config.ts': 'export default {};\n',
    'playwright.config.ts': 'export default {};\n',
    'app/members/members.test.tsx': "it('lists members', () => {});\n",
    'e2e/members.spec.ts': "test('members', () => {});\n",
    '.github/workflows/ci.yml': 'on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n',
    '.husky/pre-commit': 'pnpm lint-staged\n',
    'eslint.config.mjs': 'export default [];\n',
    '.prettierrc': '{}\n',
    'AGENTS.md': '# Agents\nUse the components in components/ui.\n',
    'CLAUDE.md': '# Claude\n',
    '.cursor/rules/style.mdc': 'Use Tailwind.\n',
    'README.md': '# Acme\n',
    'docs/adr/0001-use-drizzle.md': '# Use Drizzle\n',
    'docs/product/members-prd.md': '# Members PRD\n',
    '.github/pull_request_template.md': '## What changed\n',
    '.github/CODEOWNERS': '* @example-org/web\n',
  };
  const has = (area: string, what: string | RegExp, from: string | RegExp) =>
    expect.objectContaining({ area, what: typeof what === 'string' ? what : expect.stringMatching(what), from: typeof from === 'string' ? from : expect.stringMatching(from) });

  it('reads every area of a Next.js app and cites the file each finding came from', () => {
    const inv = inventory(tempProject(full));
    expect(inv.support).toBe('supported');
    expect(inv.limits).toEqual([]);
    expect(inv.app).toBe('.');
    expect(inv.apps).toEqual([{ dir: '.', framework: 'Next.js', from: 'package.json dependencies.next', supported: true }]);
    expect(inv.findings).toEqual(
      expect.arrayContaining([
        has('framework', 'Next.js 15.3.0', 'package.json dependencies.next'),
        has('framework', 'React 19.1.0', 'package.json dependencies.react'),
        has('framework', 'TypeScript 5.8.0', 'package.json devDependencies.typescript'),
        has('framework', 'Tailwind CSS 4.1.0', 'package.json devDependencies.tailwindcss'),
        has('routes', 'App Router: 3 pages, 1 layout', 'app/'),
        has('routes', '1 API route handler', 'app/api/members/route.ts'),
        has('routes', 'middleware', 'middleware.ts'),
        has('components', 'shadcn/ui (new-york)', 'components.json'),
        has('components', '2 UI components in components/ui', 'components.json aliases.ui (@/components/ui)'),
        has('components', 'Radix UI', 'package.json dependencies.@radix-ui/react-dialog'),
        has('theme', 'CSS variables, with a dark theme', 'app/globals.css'),
        has('theme', 'next-themes (theme switching)', 'package.json dependencies.next-themes'),
        has('data', 'Drizzle ORM', 'drizzle.config.ts'),
        has('data', 'SWR', 'package.json dependencies.swr'),
        has('data', '1 file of server actions', 'app/members/actions.ts'),
        has('auth', 'Auth.js (NextAuth)', 'package.json dependencies.next-auth'),
        has('auth', 'a role field', 'lib/db/schema.ts'),
        has('flags', 'Vercel Flags', 'package.json dependencies.@vercel/flags'),
        has('tests', 'Vitest', 'vitest.config.ts'),
        has('tests', 'Playwright', 'playwright.config.ts'),
        has('tests', 'Testing Library', 'package.json devDependencies.@testing-library/react'),
        has('tests', '2 test files', /app\/members\/members\.test\.tsx/),
        has('scripts', 'test: vitest run', 'package.json scripts.test'),
        has('scripts', 'test:e2e: playwright test', 'package.json scripts.test:e2e'),
        has('ci', 'GitHub Actions workflow (runs the tests)', '.github/workflows/ci.yml'),
        has('hooks', 'husky pre-commit hook', '.husky/pre-commit'),
        has('lint', 'ESLint', 'eslint.config.mjs'),
        has('lint', 'Prettier', '.prettierrc'),
        has('guidance', 'agent instructions', 'AGENTS.md'),
        has('guidance', 'agent instructions', 'CLAUDE.md'),
        has('guidance', 'Cursor rules', '.cursor/rules/style.mdc'),
        has('docs', 'README', 'README.md'),
        has('docs', '1 decision record', 'docs/adr/'),
        has('docs', 'product or design doc', 'docs/product/members-prd.md'),
        has('review', 'pull request template', '.github/pull_request_template.md'),
        has('review', 'code owners', '.github/CODEOWNERS'),
        has('package-manager', 'pnpm', 'pnpm-lock.yaml'),
      ]),
    );
    expect(inv.unknowns).toEqual([]);
    // Every finding names a file or folder that exists, never a guess.
    for (const f of inv.findings) expect(f.from, f.what).toMatch(/^[\w.@()[\]/-]+(?:[ ,]|$)/);
  });

  it("reads the team's review workflow: its pull request template, code owners, and how its branches are named", () => {
    const root = tempProject({ 'package.json': next, 'app/page.tsx': '', 'docs/pull_request_template.md': '## Why\n', 'CODEOWNERS': '* @example-org/web\n' });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
    for (const b of ['feat/billing', 'feat/invites', 'fix/sign-in', 'chore/deps', 'feat/search']) git('branch', b);
    const inv = inventory(root);
    expect(inv.findings.filter((f) => f.area === 'review')).toEqual([
      { area: 'review', what: 'pull request template', from: 'docs/pull_request_template.md' },
      { area: 'review', what: 'code owners', from: 'CODEOWNERS' },
      { area: 'review', what: 'branches named <type>/<name> (feat, chore, fix)', from: 'git branches feat/billing, feat/invites, feat/search and 2 more' },
    ]);
    expect(inv.workflow).toEqual({ branchPrefixes: ['feat', 'chore', 'fix'], template: 'docs/pull_request_template.md', codeowners: 'CODEOWNERS' });
    // One prefix for everything is a convention too; branches with no prefix are none.
    for (const b of ['feat/billing', 'feat/invites', 'fix/sign-in', 'chore/deps', 'feat/search']) git('branch', '-D', b);
    for (const b of ['feature/billing', 'feature/invites']) git('branch', b);
    expect(inventory(root).findings.find((f) => f.area === 'review' && f.what.startsWith('branches'))).toEqual({ area: 'review', what: 'branches named feature/<name>', from: 'git branches feature/billing, feature/invites' });
    for (const b of ['feature/billing', 'feature/invites']) git('branch', '-D', b);
    for (const b of ['billing', 'invites', 'search']) git('branch', b);
    expect(inventory(root).workflow?.branchPrefixes).toEqual([]);
  });

  it('labels each area it found nothing for, and says what it looked for', () => {
    const inv = inventory(tempProject({ 'package.json': next, 'app/page.tsx': '' }));
    expect(inv.support).toBe('supported');
    expect(inv.unknowns.map((u) => u.area)).toEqual(['components', 'theme', 'data', 'auth', 'flags', 'tests', 'ci', 'hooks', 'guidance', 'docs', 'review']);
    expect(inv.unknowns.find((u) => u.area === 'flags')?.what).toMatch(/^no feature flags found \(looked for /);
    expect(inv.unknowns.find((u) => u.area === 'review')?.what).toMatch(/^no review workflow found \(looked for a pull request template, CODEOWNERS and how git branches are named\)/);
    expect(inv.unknowns.find((u) => u.area === 'tests')?.what).toMatch(/Vitest, Jest, Playwright, Cypress/);
  });

  it('lists every app in a workspace, and picks one only when it is the only Next.js app or named', () => {
    const root = tempProject({
      'package.json': { private: true, scripts: { test: 'turbo test' } },
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
      'apps/site/package.json': { dependencies: { next: '15.3.0', '@example-org/ui': 'workspace:*' } },
      'apps/site/app/page.tsx': '',
      'apps/admin/package.json': { dependencies: { next: '14.2.0' } },
      'apps/admin/app/page.tsx': '',
      'apps/docs/package.json': { dependencies: { astro: '5.0.0' } },
      'packages/ui/package.json': { name: '@example-org/ui' },
      'packages/ui/src/button.tsx': '',
    });
    const all = inventory(root);
    expect(all.apps).toEqual([
      { dir: 'apps/admin', framework: 'Next.js', from: 'apps/admin/package.json dependencies.next', supported: true },
      { dir: 'apps/docs', framework: 'Astro', from: 'apps/docs/package.json dependencies.astro', supported: false },
      { dir: 'apps/site', framework: 'Next.js', from: 'apps/site/package.json dependencies.next', supported: true },
    ]);
    expect(all.app).toBeNull();
    expect(all.layout.paths).toEqual({});
    expect(all.findings).toContainEqual({ area: 'workspace', what: 'pnpm workspace: apps/*, packages/*', from: 'pnpm-workspace.yaml' });

    const site = inventory(root, { app: 'apps/site' });
    expect(site.app).toBe('apps/site');
    expect(site.layout.paths.source).toEqual(['apps/site/app/**', 'packages/ui/src/**']);
    expect(site.layout.paths.ignore).toEqual(['spikes/**', '.fwos/cli/**', 'apps/admin/**', 'apps/docs/**']);
    expect(site.findings).toContainEqual(has('framework', 'Next.js 15.3.0', 'apps/site/package.json dependencies.next'));
    expect(site.findings.filter((f) => f.from.startsWith('apps/admin'))).toEqual([expect.objectContaining({ area: 'workspace' })]);
  });

  it('says plainly when there is no Next.js app to adopt, and what to do instead', () => {
    const inv = inventory(tempProject({ 'package.json': { dependencies: { vite: '6.0.0', react: '19.0.0' } }, 'src/main.tsx': '', 'README.md': '# Vite app\n' }));
    expect(inv.support).toBe('unsupported');
    expect(inv.app).toBeNull();
    expect(inv.apps).toEqual([{ dir: '.', framework: 'Vite', from: 'package.json dependencies.vite', supported: false }]);
    expect(inv.limits).toEqual([
      'No Next.js app: found Vite at . (package.json dependencies.vite). fwos reads Next.js App Router apps, so it sets nothing up here. Start a new Next.js app in a subfolder with /fwos:start, or stop.',
    ]);
    // What it could still read is listed, so the answer is grounded.
    expect(inv.findings).toContainEqual(has('docs', 'README', 'README.md'));
  });

  it('marks the parts it can only partly cover, each with what it means', () => {
    const inv = inventory(
      tempProject({
        'package.json': { dependencies: { next: '14.2.0', react: '18.3.0' }, devDependencies: { tailwindcss: '^3.4.0' } },
        'package-lock.json': '{}',
        'tailwind.config.js': 'module.exports = {};\n',
        'pages/index.tsx': '',
      }),
    );
    expect(inv.support).toBe('partial');
    expect(inv.limits).toEqual([
      'Pages Router only (pages/): screens/ia reads the App Router, so it stays OFF. The other checks run.',
      'Tailwind CSS 3 (package.json devDependencies.tailwindcss): the token checks read your classes, but `fwos tokens build` writes Tailwind 4 CSS, so keep your own theme build.',
    ]);
    expect(inv.findings).toContainEqual(has('package-manager', 'npm', 'package-lock.json'));
    expect(inv.findings).toContainEqual(has('theme', 'Tailwind config', 'tailwind.config.js'));
  });
});

describe('the web components adapter', () => {
  it('lists components in paths.ui when the project sets it, else in <app>/src/shared/ui', () => {
    const files = { 'components/ui/button.tsx': '', 'components/ui/index.ts': '', 'apps/web/src/shared/ui/card.tsx': '' };
    const adopted = loadProject(tempProject({ ...files, '.fwos/state.json': { schema: 1, mode: 'adopt', platforms: ['web'], paths: { apps: { web: '.' }, ui: { web: 'components/ui' } } } }));
    expect(components.listInstalled(adopted)).toEqual([{ id: 'button', file: 'components/ui/button.tsx' }]);
    expect(components.folder?.(adopted)).toBe('components/ui');
    const fresh = loadProject(tempProject({ ...files, '.fwos/state.json': { schema: 1, mode: 'new', platforms: ['web'] } }));
    expect(components.listInstalled(fresh)).toEqual([{ id: 'card', file: 'apps/web/src/shared/ui/card.tsx' }]);
  });
});
