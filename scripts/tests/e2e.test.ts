// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The walking skeleton, for real: scaffold a fresh app into a temp folder, install it, and run its
// typecheck, unit tests, Playwright default rows and fwos's harness (against a production build)
// and `fwos check`. Then plant behavioural defects, each behind a passing tagged
// test with the expected name: a loading state that renders the ready one, an error that keeps the
// stale rows, rows that paint on hover while a click only reaches their title (a dead hit area), a
// page every role and flag setting can open, and a nav that shows it to them. Show the harness
// catch each in the running app and `fwos check` fail on each, then pass again once they're fixed.
// Before that, `fwos doctor --start` must render a state fixture in the running app and claim the
// very defects planted. Then a prototype bundle is promoted once committed, and its intended IA is
// compared with the app as the clean run saw it. Last, a nav page gets its screen before its route,
// as at the screens step, and the harness must still render every fixture in the production build.
// Slow and needs the network, so it only runs with FWOS_E2E=1 (`pnpm test:e2e`).

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const REPO = new URL('../../', import.meta.url).pathname;
const FWOS = join(REPO, 'plugin/dist/fwos.mjs');
const enabled = process.env.FWOS_E2E === '1';
const dir = enabled ? mkdtempSync(join(tmpdir(), 'fwos-e2e-')) : '';

const env = { ...process.env, CI: '1', NO_COLOR: '1' };
const sh = (cmd: string, args: string[], cwd = dir) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env, timeout: 600_000 }).toString();
const fwos = (...args: string[]) => sh(process.execPath, [FWOS, ...args]);
/** A command that may fail, for its exit code and output. */
const tryRun = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8', timeout: 600_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const write = (rel: string, text: string) => writeFileSync(join(dir, rel), text);
/** One check's result from `fwos check --json`. */
const result = (id: string) => (JSON.parse(tryRun(process.execPath, [FWOS, 'check', id, '--json']).out) as { results: { id: string; status: string; findings: { rule?: string; message: string }[]; info?: string[] }[] }).results.find((r) => r.id === id)!;
const HEADER = '// Copyright 2026 Workloom Solutions Private Limited\n// SPDX-License-Identifier: MIT\n\n';
/** The scaffold's nav, as it shows each page only to the roles and flag setting ia.json gives it. */
let NAV = '';

afterAll(() => {
  if (enabled && !process.env.FWOS_E2E_KEEP) rmSync(dir, { recursive: true, force: true });
});

describe.runIf(enabled)('scaffolded web app, end to end', () => {
  it('scaffolds', () => {
    sh('git', ['init', '-q']);
    fwos('init', '--name', 'E2E app');
    fwos('design-system', 'init');
    // The default pin: the scaffold vendors this CLI into .fwos/cli, the path a real user takes.
    fwos('scaffold', 'web');
    expect(fwos('tokens', 'build')).toMatch(/wrote packages\/tokens\/generated\/theme.css/);
  });

  it('installs, with the browser for the Playwright version it resolved', () => {
    sh('pnpm', ['install']);
    sh('pnpm', ['--filter', 'web', 'exec', 'playwright', 'install', 'chromium']);
  }, 600_000);

  it('typechecks and passes its component tests', () => {
    sh('pnpm', ['typecheck']);
    expect(sh('pnpm', ['test'])).toMatch(/16 passed/);
  }, 300_000);

  it("passes the default rows and fwos's harness against a production build", () => {
    // 6 default rows and home's state test, plus the harness: home and the 6 starter components with required states, and one run of the IA.
    expect(sh('pnpm', ['e2e'])).toMatch(/14 passed/);
  }, 600_000);

  it('passes fwos check with nothing failing, each state proven by a render, and the IA by a run', () => {
    const out = fwos('check');
    expect(out).toMatch(/0 fail/);
    expect(result('screens/states')).toMatchObject({ status: 'pass', info: [expect.stringMatching(/^1 page state renders as its contract says/), expect.stringMatching(/^rendered by fwos's harness at revision \w+ \(production build, chromium/)] });
    expect(result('design-system/required-states')).toMatchObject({ status: 'pass', info: [expect.stringMatching(/^15 required states render as their contract says/), expect.anything()] });
    expect(result('screens/ia').info).toEqual(['web: 1 app route, 1 ia page', expect.stringMatching(/^web: 1 role and flag setting opened 1 route and read the nav \(fwos's IA harness at revision \w+\)$/)]);
    // `pnpm exec fwos` runs the vendored copy, with no path to this repo.
    expect(sh('pnpm', ['exec', 'fwos', 'check'])).toMatch(/0 fail/);
    expect(sh('pnpm', ['exec', 'fwos', 'doctor'])).toMatch(/vendored copy in \.fwos\/cli, same version/);
  }, 120_000);

  it('calls the verify driver active only once doctor started the app and rendered a state fixture, and names what that lets it catch', () => {
    const verify = (args: string[]) => (JSON.parse(fwos('doctor', ...args, '--json')) as { adapters: { web: { adapter: string; active: string | null; catches?: string; note?: string }[] } }).adapters.web.find((a) => a.adapter === 'verify')!;
    // Installed is not running: without --start, nothing is active.
    expect(verify([])).toMatchObject({ active: null, note: expect.stringMatching(/^installed, not started/) });
    const started = verify(['--start']);
    expect(started.active).toMatch(/^rendered page home "ready" at \/fwos-screens\/home\?state=ready \(next dev, chromium [\d.]+\)$/);
    // Each class it claims is planted below, and the harness must catch it.
    expect(started.catches).toBe(
      'a state that renders wrong (another state under its name, stale content on error, a loading state not busy) and a hover with a dead hit area; a page or nav link shown to a role or flag setting ia.json hides it from, and a nav page missing from the nav',
    );
  }, 300_000);

  it("catches each planted defect in the running app, though every state's tagged test passes", () => {
    NAV = sh('cat', ['apps/web/src/shared/nav/nav.tsx']);
    sh('git', ['add', '-A']);
    sh('git', ['-c', 'user.name=fwos e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'scaffold', '--no-verify']);
    // A members page for admin behind a flag, and a list page with four states.
    const ia = JSON.parse(sh('cat', ['docs/app/ia.json']));
    ia.roles = ['member', 'admin'];
    ia.flags = ['members-enabled'];
    ia.pages.push(
      { id: 'list', title: 'Reading list', route: '/list', kind: 'nav', order: 2, states: ['loading', 'empty', 'error', 'ready'] },
      { id: 'members', title: 'Members', route: '/members', kind: 'nav', order: 3, visibleTo: ['admin'], flag: 'members-enabled', states: ['ready'] },
    );
    write('docs/app/ia.json', `${JSON.stringify(ia, null, 2)}\n`);
    // The list's loading fixture draws the ready rows, and its error keeps them beside the alert. Each
    // row paints on hover and shows a pointer, but only its title is a link: a dead hit area.
    write('apps/web/src/screens/list.tsx', `${HEADER}'use client';

import Link from 'next/link';
import { Alert, StateHandler } from '@/shared/ui';
import type { ScreenProps } from './registry';

const rows = [
  { id: 'dune', title: 'Dune', author: 'Frank Herbert' },
  { id: 'neuromancer', title: 'Neuromancer', author: 'William Gibson' },
];

export function ListScreen({ state }: ScreenProps) {
  const list = (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.id} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-body text-fg hover:bg-hover">
          <Link href={\`/list?book=\${r.id}\`} className="text-label text-fg">
            {r.title}
          </Link>
          <span className="text-fg-secondary">by {r.author}</span>
        </li>
      ))}
    </ul>
  );
  if (state === 'loading') return list;
  if (state === 'empty') return <StateHandler status="empty" label="links" />;
  if (state === 'error') {
    return (
      <section className="flex flex-col gap-2">
        <Alert tone="critical" title="Couldn't load your list">
          Try again.
        </Alert>
        {list}
      </section>
    );
  }
  return (
    <StateHandler status="ready" label="links">
      {list}
    </StateHandler>
  );
}
`);
    const registry = sh('cat', ['apps/web/src/screens/registry.tsx']);
    write('apps/web/src/screens/registry.tsx', registry.replace("import { HomeScreen } from './home';", "import { HomeScreen } from './home';\nimport { ListScreen } from './list';").replace('  home: HomeScreen,\n', '  home: HomeScreen,\n  list: ListScreen,\n'));
    sh('mkdir', ['-p', 'apps/web/app/list', 'apps/web/app/members']);
    write('apps/web/app/list/page.tsx', `${HEADER}import { screens } from '@/screens';\nimport { guardPage } from '@/shared/session';\n\nexport default async function List() {\n  await guardPage('list');\n  const Screen = screens.list!;\n  return <Screen state="ready" />;\n}\n`);
    // The members page renders for everyone, whatever ia.json says, and the nav links it for everyone.
    write('apps/web/app/members/page.tsx', `${HEADER}export default function Members() {\n  return <h1 className="text-title text-fg">Members</h1>;\n}\n`);
    // It also leaves the list out of the nav: a nav page with no link to it.
    write('apps/web/src/shared/nav/nav.tsx', NAV.replace(".filter((p) => p.kind === 'nav' && p.route && canSee(p, access))", ".filter((p) => p.kind === 'nav' && p.route && p.id !== 'list')"));
    // Every state has a tagged test, and each passes, checking nothing.
    write('apps/web/e2e/planted.spec.ts', `${HEADER}import { expect, test } from '@playwright/test';\n\nfor (const state of ['loading', 'empty', 'error', 'ready']) test(\`renders @state:list:\${state}\`, () => expect(1).toBe(1));\ntest('renders @state:members:ready', () => expect(1).toBe(1));\n`);

    // Before a run of the new code, the code alone shows the members page can't turn anyone away.
    expect(result('screens/ia').findings.map((f) => f.rule)).toEqual(['ungated']);
    const run = tryRun('pnpm', ['e2e']);
    expect(run.code, run.out).toBe(1);
    // The harness fails on the list page and on every role and flag setting (each misses the list in the nav); the tagged tests pass.
    expect(run.out).toMatch(/5 failed/);
    expect(run.out).toMatch(/page list renders each state as its contract says/);
    expect(run.out).toMatch(/hovering \\?"Dune by Frank Herbert\\?" paints it \(background-color, cursor: pointer\), but a click on it outside link/);
    expect(run.out).toMatch(/opens every route as member with members-enabled on/);
    expect(run.out).toMatch(/✓ .* renders @state:list:loading/);
    const states = result('screens/states');
    expect(states.status).toBe('fail');
    const byState = Object.fromEntries(states.findings.map((f) => [f.message.slice(0, f.message.indexOf(':')), f.message]));
    expect(Object.keys(byState)).toEqual(['list "loading"', 'list "error"', 'list "ready"']);
    const dead = (state: string) =>
      `${state}: hovering "Dune by Frank Herbert" paints it (background-color, cursor: pointer), but a click on it outside link "Dune" does nothing; hovering "Neuromancer by William Gibson" paints it (background-color, cursor: pointer), but a click on it outside link "Neuromancer" does nothing. In any state, anything that changes on hover, or shows a pointer, acts on a click anywhere on it`;
    // The wrong state under the right name, and stale rows on error: each named by its contract.
    expect(byState['list "loading"']).toMatch(/^list "loading": nothing is marked aria-busy="true"; keeps the ready state's content \(by Frank Herbert, by William Gibson\); renders exactly as "ready", so the fixture ignores its state\. A "loading" state renders /);
    expect(byState['list "error"']).toMatch(/^list "error": keeps the ready state's content \(by Frank Herbert, by William Gibson\)\. An "error" state renders /);
    // The dead hit area, in every state that draws the rows.
    for (const state of ['loading', 'error']) expect(byState[`list "${state}"`]).toContain(dead('').slice(2));
    expect(byState['list "ready"']).toBe(dead('list "ready"'));
    const ia2 = result('screens/ia');
    expect(ia2.status).toBe('fail');
    const audience = 'which ia.json shows only to admin with members-enabled on';
    expect(ia2.findings.map((f) => f.message)).toEqual(
      ['member (members-enabled on)', 'member (members-enabled off)', 'admin (members-enabled on)', 'admin (members-enabled off)'].flatMap((who) => [
        ...(who === 'admin (members-enabled on)'
          ? []
          : [`web: ${who} can open "members" (/members), ${audience}`, `web: the nav shows "members" (/members) to ${who}, ${audience}`]),
        `web: ${who} sees no link to "list" (/list) in the nav`,
      ]),
    );
  }, 600_000);

  it('passes again once the defects are fixed (the clean control)', () => {
    const list = sh('cat', ['apps/web/src/screens/list.tsx']);
    const row = /<li key=\{r\.id\} className="[^"]*">\n\s*<Link href=\{`\/list\?book=\$\{r\.id\}`\} className="text-label text-fg">\n\s*\{r\.title\}\n\s*<\/Link>\n\s*<span className="text-fg-secondary">by \{r\.author\}<\/span>\n\s*<\/li>/;
    expect(list).toMatch(row);
    write(
      'apps/web/src/screens/list.tsx',
      list
        .replace("  if (state === 'loading') return list;", "  if (state === 'loading') return <StateHandler status=\"loading\" label=\"links\" />;")
        .replace(/ {8}\{list\}\n {6}<\/section>/, '      </section>')
        // The whole row is the link, so wherever it paints on hover, a click opens the book.
        .replace(
          row,
          `<li key={r.id}>
          <Link href={\`/list?book=\${r.id}\`} className="flex items-center gap-2 rounded-md px-3 py-2 text-body text-fg hover:bg-hover">
            <span className="text-label">{r.title}</span>
            <span className="text-fg-secondary">by {r.author}</span>
          </Link>
        </li>`,
        ),
    );
    write('apps/web/src/shared/nav/nav.tsx', NAV);
    // Members gets its guard, and a screen the harness can render.
    write('apps/web/src/screens/members.tsx', `${HEADER}import type { ScreenProps } from './registry';\n\nexport function MembersScreen(_props: ScreenProps) {\n  return <h1 className="text-title text-fg">Members</h1>;\n}\n`);
    const registry = sh('cat', ['apps/web/src/screens/registry.tsx']);
    write('apps/web/src/screens/registry.tsx', registry.replace("import { ListScreen } from './list';", "import { ListScreen } from './list';\nimport { MembersScreen } from './members';").replace('  list: ListScreen,\n', '  list: ListScreen,\n  members: MembersScreen,\n'));
    write('apps/web/app/members/page.tsx', `${HEADER}import { screens } from '@/screens';\nimport { guardPage } from '@/shared/session';\n\nexport default async function Members() {\n  await guardPage('members');\n  const Screen = screens.members!;\n  return <Screen state="ready" />;\n}\n`);
    const run = tryRun('pnpm', ['e2e']);
    expect(run.code, run.out).toBe(0);
    expect(result('screens/states')).toMatchObject({ status: 'pass', findings: [], info: [expect.stringMatching(/^6 page states render as their contract says/), expect.anything()] });
    expect(result('screens/ia')).toMatchObject({ status: 'pass', findings: [] });
    expect(fwos('check')).toMatch(/0 fail/);
  }, 600_000);

  it('promotes a prototype bundle once it is committed, and compares its intended IA with the app as the harness saw it', () => {
    // The intent: a reports page in the nav, members moved under /team (the same page ID), and the list for admins only.
    const ia = JSON.parse(sh('cat', ['docs/app/ia.json'])) as { pages: { id: string; route?: string; visibleTo?: string[] }[] };
    const pages = ia.pages.map((p) => (p.id === 'members' ? { ...p, route: '/team/members' } : p.id === 'list' ? { ...p, visibleTo: ['admin'] } : p));
    const dir = 'docs/app/prototypes/team';
    sh('mkdir', ['-p', dir]);
    write(`${dir}/ia.json`, `${JSON.stringify({ ...ia, pages: [...pages, { id: 'reports', title: 'Reports', route: '/reports', kind: 'nav', order: 4, states: ['loading', 'ready'] }] }, null, 2)}\n`);
    write(`${dir}/states.md`, '## members\n- ready: the members table\n\n## reports\n- loading: a skeleton while the report loads\n- ready: the report\n');
    write('docs/app/spec.md', '# Spec\n\n## Team pages\n\nMembers move under /team, and a reports page joins the nav.\n');
    const bundle = {
      schema: 1,
      id: 'team',
      title: 'Team pages',
      pages: ['members', 'reports'],
      visual: [{ kind: 'route', ref: '/fwos-screens/members' }],
      companion: [
        { kind: 'route', page: 'members', ref: '/fwos-screens/members' },
        { kind: 'route', page: 'reports', ref: '/fwos-screens/reports' },
      ],
      states: `${dir}/states.md`,
      spec: 'docs/app/spec.md#team-pages',
      ia: `${dir}/ia.json`,
    };
    write(`${dir}/bundle.json`, `${JSON.stringify(bundle, null, 2)}\n`);
    expect(fwos('prototype', 'check')).toBe(`team  ${dir}/bundle.json\n  ready to promote: fwos prototype promote team --by "<who>"\n`);
    // Only a committed bundle is promoted.
    expect(tryRun(process.execPath, [FWOS, 'prototype', 'promote', 'team', '--by', 'e2e'])).toMatchObject({ code: 2, out: expect.stringContaining('commit these first') });
    sh('git', ['add', '-A']);
    sh('git', ['-c', 'user.name=fwos e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'the team pages bundle', '--no-verify']);
    expect(fwos('prototype', 'promote', 'team', '--by', 'e2e')).toMatch(/^Promoted team: 4 inputs pinned in \.fwos\/prototypes\.json\./);
    // Against the app: its routes, and who saw what in the clean run of fwos's IA harness above.
    expect(fwos('prototype', 'diff', 'team').trim()).toBe(
      [
        '+ added        reports: Reports at /reports (nav); the app has no route for it',
        '~ moved        members: the bundle puts it at /team/members; the app has it at /members',
        '! hidden       list: the bundle hides it from member; the app lets member open it',
      ].join('\n'),
    );
  }, 120_000);

  it('renders every state fixture while a nav page still lacks its route, as at the screens step', () => {
    // Settings joins the nav with a screen in the screens browser, and its tagged test there, but no
    // app/settings/page.tsx yet. The nav, read from ia.json, links /settings on every page, so the
    // production build prefetches it, and Next.js never reads the 404 it gets back: Chromium never
    // finishes that request, and a harness that waited for the network to go idle sat out every test's timeout.
    const ia = JSON.parse(sh('cat', ['docs/app/ia.json'])) as { pages: unknown[] };
    ia.pages.push({ id: 'settings', title: 'Settings', route: '/settings', kind: 'nav', order: 4, states: ['ready'] });
    write('docs/app/ia.json', `${JSON.stringify(ia, null, 2)}\n`);
    write('apps/web/src/screens/settings.tsx', `${HEADER}import type { ScreenProps } from './registry';\n\nexport function SettingsScreen(_props: ScreenProps) {\n  return <h1 className="text-title text-fg">Settings</h1>;\n}\n`);
    const registry = sh('cat', ['apps/web/src/screens/registry.tsx']);
    write('apps/web/src/screens/registry.tsx', registry.replace("import { MembersScreen } from './members';", "import { MembersScreen } from './members';\nimport { SettingsScreen } from './settings';").replace('  members: MembersScreen,\n', '  members: MembersScreen,\n  settings: SettingsScreen,\n'));
    write('apps/web/e2e/settings.spec.ts', `${HEADER}import { expect, test } from '@playwright/test';\n\ntest('settings shows its title @state:settings:ready', async ({ page }) => {\n  await page.goto('/fwos-screens/settings?state=ready');\n  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();\n});\n`);
    const run = tryRun('pnpm', ['e2e']);
    // Every page and component fixture renders, settings' included.
    expect(run.out).not.toMatch(/✘ .* renders each state as its contract says/);
    expect(result('screens/states')).toMatchObject({ status: 'pass', findings: [], info: [expect.stringMatching(/^7 page states render as their contract says/), expect.anything()] });
    expect(result('design-system/required-states')).toMatchObject({ status: 'pass', findings: [] });
    // What fails is the missing route, and only that: the default crawl's broken link, and each role and
    // flag setting's run of the IA, which opened every route and found /settings not there.
    expect(run.out).toMatch(/5 failed/);
    expect(run.out).toMatch(/✘ .* every route loads with no console errors or broken links/);
    expect(result('screens/ia').findings.map((f) => f.message)).toEqual([
      'web: page "settings" (/settings) isn\'t in the app',
      ...['member (members-enabled on)', 'member (members-enabled off)', 'admin (members-enabled on)', 'admin (members-enabled off)'].map((who) => `web: ${who} can't open "settings" (/settings): not found (404)`),
    ]);
  }, 600_000);
});
