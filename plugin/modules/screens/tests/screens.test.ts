// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type AppLink, type AppRedirect, adapterSet, type CheckResult, type IaRun, loadProject, revisionOf, type ScreenRef, type StateObservation } from '../../../kernel/index.ts';
import { TEST_HARNESS, syntheticTestRun, cleanupTempProjects, harnessProfile, installHarness, minimalState, recordRun, tempProject, writeFiles } from '../../../kernel/testing.ts';
import { checks, diffIa, formatIaDiff, type Ia, iaRunPlan, judgeIaRun, normRoute, parseIa, renderTemplate, validateIa } from '../index.ts';

afterAll(cleanupTempProjects);

const base: Ia = {
  schema: 1,
  roles: ['member', 'admin'],
  flags: ['sharing'],
  pages: [
    { id: 'list', title: 'Reading list', route: '/', kind: 'nav', order: 1, states: ['loading', 'empty', 'error', 'ready'] },
    { id: 'item', title: 'Item', route: '/items/[id]', kind: 'drilldown', parent: 'list', states: ['ready', 'not-found'] },
    { id: 'settings', title: 'Settings', route: '/settings', kind: 'nav', order: 2, states: ['ready'] },
    { id: 'admin', title: 'Admin', route: '/admin', kind: 'nav', order: 3, visibleTo: ['admin'], states: ['ready'] },
  ],
};

describe('normRoute', () => {
  it.each([
    ['/items/[id]', '/items/[]'],
    ['/items/:itemId', '/items/[]'],
    ['/items/{id}', '/items/[]'],
    ['/docs/[...slug]', '/docs/[...]'],
    ['/docs/[[...slug]]', '/docs/[[...]]'],
    ['/a/', '/a'],
    ['/', '/'],
    ['/search?q=1', '/search'],
  ])('%s -> %s', (a, b) => expect(normRoute(a)).toBe(b));
});

describe('validateIa', () => {
  it('accepts a sound IA', () => {
    expect(validateIa(base)).toEqual([]);
  });

  it('catches duplicate IDs and routes, unknown roles and flags, dangling parents, and unreachable pages', () => {
    const bad: Ia = {
      ...base,
      pages: [
        ...base.pages,
        { id: 'list', title: 'Dup', route: '/dup', kind: 'nav', states: ['ready'] },
        { id: 'clash', title: 'Clash', route: '/items/[itemId]', kind: 'nav', states: ['ready'] },
        { id: 'ghost', title: 'Ghost', route: '/ghost', kind: 'nav', visibleTo: ['owner'], flag: 'nope', states: ['ready'] },
        { id: 'orphan', title: 'Orphan', route: '/orphan', kind: 'drilldown', parent: 'missing', states: ['ready'] },
        { id: 'hidden', title: 'Hidden', route: '/hidden', kind: 'unlinked', states: ['ready'] },
        { id: 'deep', title: 'Deep', route: '/deep', kind: 'drilldown', parent: 'hidden', states: [] },
        { id: 'peek', title: 'Peek', route: '/admin/peek', kind: 'drilldown', parent: 'admin', visibleTo: ['member', 'admin'], states: ['ready'] },
      ],
    };
    expect(validateIa(bad)).toEqual([
      'page id "list" is used twice',
      'page "clash" and page "item" share the route /items/[itemId]',
      'page "ghost" is visible to unknown role "owner"',
      'page "ghost" uses unknown flag "nope"',
      'page "orphan" has unknown parent "missing"',
      'page "hidden" is unlinked with no unlinkedReason',
      'page "deep" lists no states',
      'page "peek" is visible to member, but its parent "admin" isn\'t',
      'page "deep" is neither reachable nor marked unlinked (its parent chain never reaches a nav page)',
    ]);
  });

  it('reports schema errors before anything else', () => {
    expect(parseIa('{"schema":1,"roles":[],"pages":[]}').errors).toEqual(['/roles must NOT have fewer than 1 items']);
    expect(parseIa('nope').errors[0]).toMatch(/not valid JSON/);
  });
});

describe('diffIa', () => {
  it('shows an added nav item, a moved page that kept its ID, and a page hidden from one role', () => {
    const after: Ia = {
      ...base,
      pages: [
        base.pages[0]!,
        { ...base.pages[1]!, route: '/read/[id]' },
        { ...base.pages[2]!, visibleTo: ['admin'] },
        base.pages[3]!,
        { id: 'archive', title: 'Archive', route: '/archive', kind: 'nav', order: 4, states: ['empty', 'ready'] },
      ],
    };
    const changes = diffIa(base, after);
    expect(changes.map((c) => `${c.kind}:${c.id}${c.role ? `:${c.role}` : ''}`)).toEqual([
      'moved:item',
      'hidden:settings:member',
      'added:archive',
    ]);
    expect(formatIaDiff(changes)).toContain('~ moved    item: route /items/[id] -> /read/[id]');
  });

  it('shows removed pages, state changes and exposure', () => {
    const after: Ia = {
      ...base,
      pages: [{ ...base.pages[0]!, states: ['loading', 'empty', 'ready', 'offline'] }, { ...base.pages[3]!, visibleTo: undefined }],
    };
    expect(diffIa(base, after).map((c) => `${c.kind}:${c.id}:${c.detail}`)).toEqual([
      'states:list:+offline -error',
      'exposed:admin:now visible to member',
      'removed:item:Item at /items/[id]',
      'removed:settings:Settings at /settings',
    ]);
    expect(formatIaDiff([])).toBe('No IA changes.');
  });

  // Flags gate visibility as much as roles do, so a flag added, removed or swapped is reviewed too.
  describe('flags', () => {
    const gated: Ia = {
      schema: 1,
      roles: ['member', 'admin'],
      flags: ['members-enabled', 'beta'],
      pages: [
        { id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['ready'] },
        { id: 'members', title: 'Members', route: '/members', kind: 'nav', visibleTo: ['admin'], flag: 'members-enabled', states: ['ready'] },
      ],
    };
    const withMembers = (members: Partial<Ia['pages'][number]>, ia: Ia = gated): Ia => ({ ...ia, pages: [ia.pages[0]!, { ...ia.pages[1]!, ...members }] });
    const lines = (after: Ia, before: Ia = gated) => formatIaDiff(diffIa(before, after)).split('\n');

    it('shows nothing for an unchanged IA (the clean control)', () => {
      expect(diffIa(gated, structuredClone(gated))).toEqual([]);
    });

    it('shows a removed flag, and that the page is exposed while the flag is off', () => {
      const changes = diffIa(gated, withMembers({ flag: undefined }));
      expect(lines(withMembers({ flag: undefined }))).toEqual([
        '~ flag     members: no longer behind flag members-enabled',
        '! exposed  members: now visible to admin while members-enabled is off',
      ]);
      expect(changes[1]).toMatchObject({ kind: 'exposed', id: 'members', role: 'admin', when: { 'members-enabled': false } });
    });

    it('shows an added flag, and that the page is hidden while the flag is off', () => {
      const before = withMembers({ flag: undefined });
      expect(lines(gated, before)).toEqual([
        '~ flag     members: now behind flag members-enabled',
        '! hidden   members: no longer visible to admin while members-enabled is off',
      ]);
    });

    it('shows a swapped flag, and when the page is hidden and exposed', () => {
      expect(lines(withMembers({ flag: 'beta' }))).toEqual([
        '~ flag     members: flag members-enabled -> beta',
        '! hidden   members: no longer visible to admin while members-enabled is on and beta is off',
        '! exposed  members: now visible to admin while members-enabled is off and beta is on',
      ]);
    });

    it('names the flag a role change applies under, and keeps a role change with the flag unconditional', () => {
      // admin loses the page: it only ever saw it with the flag on, so that is when it changes.
      // Roles come in ia.json's order.
      expect(lines(withMembers({ visibleTo: ['member'] }))).toEqual([
        '! exposed  members: now visible to member while members-enabled is on',
        '! hidden   members: no longer visible to admin while members-enabled is on',
      ]);
      // With no flag before or after, a role change is unconditional, as it always was.
      const open = withMembers({ flag: undefined });
      expect(lines(withMembers({ flag: undefined, visibleTo: undefined }), open)).toEqual(['! exposed  members: now visible to member']);
    });

    it('keeps the stable ID when a page moves and loses its flag in one change', () => {
      expect(lines(withMembers({ route: '/team', flag: undefined }))).toEqual([
        '~ moved    members: route /members -> /team',
        '~ flag     members: no longer behind flag members-enabled',
        '! exposed  members: now visible to admin while members-enabled is off',
      ]);
    });

    it('shows a page whose flag stays while the flag list changes as unchanged', () => {
      expect(diffIa(gated, { ...gated, flags: ['members-enabled', 'beta', 'later'] })).toEqual([]);
    });
  });
});

describe('the IA harness: plan and judge', () => {
  // The ungated route fixture: /members is a nav page for admin, behind members-enabled.
  const ia: Ia = {
    schema: 1,
    roles: ['member', 'admin'],
    flags: ['members-enabled', 'unused'],
    pages: [
      { id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['ready'] },
      { id: 'members', title: 'Members', route: '/members', kind: 'nav', visibleTo: ['admin'], flag: 'members-enabled', states: ['ready'] },
      { id: 'item', title: 'Item', route: '/items/[id]', kind: 'drilldown', parent: 'home', states: ['ready'] },
      { id: 'invite', title: 'Invite', route: '/invite', kind: 'unlinked', unlinkedReason: 'sent by email', states: ['ready'] },
      { id: 'old-members', title: 'Old members', route: '/people', kind: 'redirect', redirectTo: 'members', states: ['ready'] },
    ],
  };

  it('opens every static route as every role, with every setting of the flags pages use', () => {
    const plan = iaRunPlan(ia);
    expect(plan.runs.map((r) => r.key)).toEqual(['member+members-enabled', 'member', 'admin+members-enabled', 'admin']);
    expect(plan.visits).toEqual([
      { page: 'home', path: '/' },
      { page: 'members', path: '/members' },
      { page: 'invite', path: '/invite' },
      { page: 'old-members', path: '/people' },
    ]);
    expect(plan.skipped).toEqual([{ page: 'item', why: 'a dynamic route (/items/[id])' }]);
  });

  it('tries each flag on alone, then all on and all off, once five or more flags gate pages', () => {
    const many: Ia = { schema: 1, roles: ['user'], flags: ['a', 'b', 'c', 'd', 'e'], pages: ['a', 'b', 'c', 'd', 'e'].map((f) => ({ id: f, title: f, route: `/${f}`, kind: 'nav', flag: f, states: ['ready'] })) };
    expect(iaRunPlan(many).runs.map((r) => r.key)).toEqual(['user+a+b+c+d+e', 'user', 'user+a', 'user+b', 'user+c', 'user+d', 'user+e']);
  });

  /** A run where the app does exactly what ia.json says. */
  const faithful = (role: string, flags: string[]): IaRun => {
    const sees = role === 'admin' && flags.includes('members-enabled');
    return {
      role,
      flags,
      applied: true,
      nav: sees ? ['/', '/members'] : ['/'],
      visits: [
        { page: 'home', path: '/', status: 200, finalPath: '/', notFound: false },
        sees ? { page: 'members', path: '/members', status: 200, finalPath: '/members', notFound: false } : { page: 'members', path: '/members', status: 404, finalPath: '/members', notFound: true },
        { page: 'invite', path: '/invite', status: 200, finalPath: '/invite', notFound: false },
        sees ? { page: 'old-members', path: '/people', status: 200, finalPath: '/members', notFound: false, redirectedTo: '/members' } : { page: 'old-members', path: '/people', status: 404, finalPath: '/members', notFound: true, redirectedTo: '/members' },
      ],
    };
  };
  const problems = (run: IaRun) => judgeIaRun(ia, run).map((p) => `${p.rule}: ${p.message}`);

  it('passes an app that shows each role and flag setting exactly what ia.json says (the clean control)', () => {
    for (const r of iaRunPlan(ia).runs) expect(problems(faithful(r.role, r.flags)), r.key).toEqual([]);
  });

  it('fails a page the app shows a role ia.json hides it from, in the nav or by its URL', () => {
    const run = faithful('member', ['members-enabled']);
    run.nav = ['/', '/members'];
    run.visits[1] = { page: 'members', path: '/members', status: 200, finalPath: '/members', notFound: false };
    expect(problems(run)).toEqual([
      'exposed: member (members-enabled on) can open "members" (/members), which ia.json shows only to admin with members-enabled on',
      'exposed: the nav shows "members" (/members) to member (members-enabled on), which ia.json shows only to admin with members-enabled on',
    ]);
    // Behind the flag too: admin with it off.
    const off = faithful('admin', []);
    off.visits[1] = { page: 'members', path: '/members', status: 200, finalPath: '/members', notFound: false };
    expect(problems(off)).toEqual(['exposed: admin (members-enabled off) can open "members" (/members), which ia.json shows only to admin with members-enabled on']);
  });

  it("fails a page a role should open but can't, and a nav page with no link in the nav", () => {
    const run = faithful('admin', ['members-enabled']);
    run.nav = ['/'];
    run.visits[1] = { page: 'members', path: '/members', status: 404, finalPath: '/members', notFound: true };
    run.visits[2] = { page: 'invite', path: '/invite', status: 200, finalPath: '/login', notFound: false, redirectedTo: '/login' };
    expect(problems(run)).toEqual([
      'inaccessible: admin (members-enabled on) can\'t open "members" (/members): not found (404)',
      'inaccessible: admin (members-enabled on) can\'t open "invite" (/invite): it redirects to /login',
      'no-link: admin (members-enabled on) sees no link to "members" (/members) in the nav',
    ]);
  });

  it('fails a redirect that goes elsewhere, an unlinked page in the nav, a nav link to no page, and an identity the app ignored', () => {
    const run = faithful('admin', ['members-enabled']);
    run.visits[3] = { page: 'old-members', path: '/people', status: 200, finalPath: '/people', notFound: false };
    run.nav = ['/', '/members', '/invite', '/debug'];
    expect(problems(run)).toEqual([
      'redirect: "old-members" (/people) should send admin (members-enabled on) to "members" (/members), but it stays at /people',
      'linked: the nav admin (members-enabled on) sees links "invite" (/invite), which ia.json marks unlinked (sent by email)',
      "unlisted-link: the nav admin (members-enabled on) sees links /debug, which ia.json doesn't list",
    ]);
    expect(problems({ ...faithful('member', []), applied: false })).toEqual([
      "identity: the app didn't confirm it took member (members-enabled off), so this run proves nothing about who sees what; read the test identity in currentAccess() and render <meta name=\"fwos-access\"> (the scaffold's src/shared/access does both)",
    ]);
  });

  it("requires actual denial at the visited route, even when IA declares no-permission", () => {
    const gentle: Ia = { ...ia, pages: ia.pages.map((p) => (p.id === 'members' ? { ...p, states: ['ready', 'no-permission'] } : p)) };
    const run = faithful('member', []);
    run.visits[1] = { page: 'members', path: '/members', status: 200, finalPath: '/members', notFound: false };
    expect(judgeIaRun(gentle, run).some((problem) => problem.rule === 'exposed')).toBe(true);
    run.visits[1]!.denied = true;
    expect(judgeIaRun(gentle, run)).toEqual([]);
    delete run.visits[1]!.denied; run.visits[1]!.status = 403;
    expect(judgeIaRun(gentle, run)).toEqual([]);
  });
});

const screenAdapter = (screens: ScreenRef[] | null, read: { links?: AppLink[]; iaNav?: string[]; redirects?: AppRedirect[]; gatekeepers?: string[] } = {}) =>
  adapterSet([
    {
      platform: 'web',
      status: 'supported',
      checks: [],
      tools: [],
      screens: { platform: 'web', listScreens: () => (screens ? { screens, inputs: ['apps/web/app/**'], ...read } : null) },
    },
  ]);

const run = async (id: string, root: string, adapters = adapterSet([])) =>
  (await checks.find((c) => c.id === id)!.run({ project: loadProject(root), adapters })) as CheckResult;

describe('screens/ia', () => {
  it('compares ia.json with the app in both directions and ignores dev-only screens', async () => {
    const root = tempProject({ 'docs/app/ia.json': base });
    const r = await run(
      'screens/ia',
      root,
      screenAdapter([
        { route: '/', file: 'apps/web/app/page.tsx', devOnly: false },
        { route: '/items/[itemId]', file: 'apps/web/app/items/[itemId]/page.tsx', devOnly: false },
        { route: '/settings', file: 'apps/web/app/settings/page.tsx', devOnly: false },
        { route: '/debug', file: 'apps/web/app/debug/page.tsx', devOnly: false },
        { route: '/fwos-screens', file: 'apps/web/app/(fwos-screens)/fwos-screens/page.tsx', devOnly: true },
      ]),
    );
    expect(r.findings.map((f) => `${f.rule}: ${f.message}`)).toEqual([
      'missing: web: page "admin" (/admin) isn\'t in the app',
      "unexpected: web: the app exposes /debug, which ia.json doesn't list; add it (or mark it unlinked) or remove it",
    ]);
  });

  it('is off, and says why, when there is no app or adapter to compare ia.json with', async () => {
    const root = tempProject({ 'docs/app/ia.json': base });
    expect(await run('screens/ia', root)).toMatchObject({ status: 'off', reason: "web: no screen adapter, so ia.json isn't compared with the app" });
    expect(await run('screens/ia', root, screenAdapter(null))).toMatchObject({ status: 'off', reason: "web: no app found yet, so ia.json isn't compared with it" });
    expect((await run('screens/ia', tempProject())).status).toBe('off');
  });

  it('counts one route and one page in the singular', async () => {
    const ia: Ia = { schema: 1, roles: ['member'], pages: [{ id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['ready'] }] };
    const r = await run('screens/ia', tempProject({ 'docs/app/ia.json': ia }), screenAdapter([{ route: '/', file: 'apps/web/app/page.tsx', devOnly: false }]));
    expect(r.status).toBe('pass');
    expect(r.info).toEqual(['web: 1 app route, 1 ia page']);
  });

  describe('nav links', () => {
    const ia: Ia = {
      schema: 1,
      roles: ['user'],
      pages: [
        { id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['ready'] },
        { id: 'settings', title: 'Settings', route: '/settings', kind: 'nav', states: ['ready'] },
        { id: 'item', title: 'Item', route: '/items/[id]', kind: 'nav', states: ['ready'] },
        { id: 'secret', title: 'Secret', route: '/secret', kind: 'unlinked', unlinkedReason: 'shared by URL', states: ['ready'] },
      ],
    };
    const app: ScreenRef[] = ['/', '/settings', '/items/[id]', '/secret'].map((route) => ({ route, file: `apps/web/app${route}/page.tsx`, devOnly: false }));
    const link = (to: string, file = 'apps/web/src/shared/nav/nav.tsx'): AppLink => ({ to, file, line: 1 });
    const check = (read: { links?: AppLink[]; iaNav?: string[] }, pages = ia) => run('screens/ia', tempProject({ 'docs/app/ia.json': pages }), screenAdapter(app, read));

    it('fails a nav page the app has no link to; the page at / is where the app opens, and an unlinked page needs none', async () => {
      const r = await check({ links: [link('/items/42')] });
      expect(r.findings.map((f) => `${f.rule}: ${f.message}`)).toEqual([
        'no-link: web: nav page "settings" (/settings) has no link to it in the app; link it from the nav, or make it a drilldown or unlinked page in ia.json',
      ]);
    });

    it('passes once every nav page has a link, a literal or a dynamic one, and says how many it checked', async () => {
      for (const to of ['/items/42', '/items/[]']) {
        const r = await check({ links: [link('/settings?tab=1'), link(to)] });
        expect(r.status, to).toBe('pass');
        expect(r.info).toEqual(['web: 4 app routes, 4 ia pages, 2 nav pages linked']);
      }
    });

    it('counts a nav built from ia.json as linking every nav page', async () => {
      const r = await check({ links: [], iaNav: ['apps/web/src/shared/nav/nav.tsx'] });
      expect(r.status).toBe('pass');
      expect(r.info).toEqual(['web: 4 app routes, 4 ia pages, 2 nav pages linked (apps/web/src/shared/nav/nav.tsx renders the nav from ia.json)']);
    });

    it("is off, naming the nav pages, when the adapter can't read links and nothing else fails", async () => {
      expect(await check({})).toMatchObject({
        status: 'off',
        reason: "web: 4 app routes match 4 ia pages, but the web screen adapter doesn't read links, so these nav pages aren't checked for a link: settings, item",
      });
    });

    it("doesn't ask for a link to a page the app lacks: that's already a finding", async () => {
      const r = await run('screens/ia', tempProject({ 'docs/app/ia.json': ia }), screenAdapter(app.slice(0, 1).concat(app.slice(2)), { links: [link('/items/1')] }));
      expect(r.findings.map((f) => f.rule)).toEqual(['missing']);
    });
  });

  describe('roles and flags', () => {
    const gated: Ia = {
      schema: 1,
      roles: ['member', 'admin'],
      flags: ['members-enabled'],
      pages: [
        { id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['ready'] },
        { id: 'members', title: 'Members', route: '/members', kind: 'nav', visibleTo: ['admin'], flag: 'members-enabled', states: ['ready'] },
        { id: 'beta', title: 'Beta', route: '/beta', kind: 'unlinked', unlinkedReason: 'invite link', flag: 'members-enabled', states: ['ready'] },
      ],
    };
    const app: ScreenRef[] = ['/', '/members', '/beta'].map((route) => ({ route, file: `apps/web/app${route}/page.tsx`, devOnly: false }));
    const links: AppLink[] = [{ to: '/members', file: 'apps/web/app/layout.tsx', line: 3 }];

    it("is off, naming each page ia.json limits by role or flag, when no run of the app shows who sees it", async () => {
      const r = await run('screens/ia', tempProject({ 'docs/app/ia.json': gated }), screenAdapter(app, { links }));
      expect(r).toMatchObject({
        status: 'off',
        reason:
          "web: 3 app routes match 3 ia pages and 1 nav page is linked, but the web platform has no harness that opens the app as each role, so who sees these isn't compared with the app: members (admin, flag members-enabled), beta (flag members-enabled)",
      });
    });

    it('still fails on what it can see, and says what it left unchecked', async () => {
      const r = await run('screens/ia', tempProject({ 'docs/app/ia.json': gated }), screenAdapter(app, { links: [] }));
      expect(r.status).toBe('fail');
      expect(r.findings.map((f) => f.rule)).toEqual(['no-link']);
      expect(r.info).toEqual([
        'web: 3 app routes, 3 ia pages, 0 nav pages linked',
        "web: who sees these isn't compared with the app (the web platform has no harness that opens the app as each role): members (admin, flag members-enabled), beta (flag members-enabled)",
      ]);
    });

    it('passes a page visible to every role and behind no flag (the clean control)', async () => {
      const open: Ia = { ...gated, flags: [], pages: gated.pages.map(({ visibleTo: _v, flag: _f, ...p }) => p) };
      expect((await run('screens/ia', tempProject({ 'docs/app/ia.json': open }), screenAdapter(app, { links }))).status).toBe('pass');
      // visibleTo listing every role limits nothing either.
      const all: Ia = { ...open, pages: open.pages.map((p) => ({ ...p, visibleTo: ['member', 'admin'] })) };
      expect((await run('screens/ia', tempProject({ 'docs/app/ia.json': all }), screenAdapter(app, { links }))).status).toBe('pass');
    });

    // The ungated route fixture: /members renders for everyone, whatever ia.json says.
    it('fails a limited page whose route has nothing that could turn anyone away, without running the app', async () => {
      const open = app.map((s) => ({ ...s, access: 'none' as const }));
      const r = await run('screens/ia', tempProject({ 'docs/app/ia.json': gated }), screenAdapter(open, { links }));
      expect(r.findings.map((f) => `${f.rule} ${f.file}: ${f.message}`)).toEqual([
        "ungated apps/web/app/members/page.tsx: web: \"members\" (/members) is for admin with members-enabled on, but nothing in its route can turn anyone away, so it renders for every role and flag setting; call guardPage('members') in it",
        "ungated apps/web/app/beta/page.tsx: web: \"beta\" (/beta) is for every role with members-enabled on, but nothing in its route can turn anyone away, so it renders for every role and flag setting; call guardPage('beta') in it",
      ]);
      // Guarded through fwos's guard, or by a check fwos can't read: not ungated, though still unproven without a run.
      for (const access of ['ia', 'unknown'] as const) {
        const guarded = await run('screens/ia', tempProject({ 'docs/app/ia.json': gated }), screenAdapter(app.map((s) => ({ ...s, access })), { links }));
        expect(guarded.status, access).toBe('off');
      }
      // Declaring a denial state does not establish that an unguarded route enforces it.
      const gentle: Ia = { ...gated, pages: gated.pages.map((p) => ({ ...p, states: [...p.states, 'no-permission'] })) };
      expect((await run('screens/ia', tempProject({ 'docs/app/ia.json': gentle }), screenAdapter(open, { links }))).findings.map((finding) => finding.rule)).toEqual(['ungated', 'ungated']);
    });

    it('fails a route that declares another page ID than ia.json has there', async () => {
      const ids = app.map((s) => ({ ...s, id: s.route === '/members' ? 'people' : s.route === '/' ? 'home' : undefined }));
      const r = await run('screens/ia', tempProject({ 'docs/app/ia.json': gated }), screenAdapter(ids, { links }));
      expect(r.findings.map((f) => `${f.rule}: ${f.message}`)).toEqual(['page-id: web: apps/web/app/members/page.tsx declares page "people", but ia.json has "members" at /members']);
    });

    describe('redirects', () => {
      const withRedirect: Ia = { ...gated, pages: [...gated.pages, { id: 'old-members', title: 'Old', route: '/people', kind: 'redirect', redirectTo: 'members', states: ['ready'] }] };
      const check = (screens: ScreenRef[], read: { redirects?: AppRedirect[]; gatekeepers?: string[] }) =>
        run('screens/ia', tempProject({ 'docs/app/ia.json': withRedirect }), screenAdapter(screens, { links, redirects: [], gatekeepers: [], ...read }));
      const rules = async (screens: ScreenRef[], read: { redirects?: AppRedirect[]; gatekeepers?: string[] } = {}) => (await check(screens, read)).findings.map((f) => `${f.rule}: ${f.message}`);

      it('fails a redirect page nothing in the app redirects, or that goes elsewhere; passes one that goes where ia.json says', async () => {
        expect(await rules(app)).toEqual(['redirect: web: nothing in the app redirects /people (no route there, no redirect in its config), but ia.json sends "old-members" to "members" (/members)']);
        expect(await rules(app, { redirects: [{ from: '/people', to: '/members', file: 'apps/web/next.config.ts' }] })).toEqual([]);
        expect(await rules(app, { redirects: [{ from: '/people', to: '/', file: 'apps/web/next.config.ts' }] })).toEqual(['redirect: web: apps/web/next.config.ts redirects /people to /, but ia.json sends "old-members" to "members" (/members)']);
        const page = { route: '/people', file: 'apps/web/app/people/page.tsx', devOnly: false };
        expect(await rules([...app, { ...page, access: 'unknown', redirectTo: '/members' }])).toEqual([]);
        expect(await rules([...app, { ...page, access: 'unknown', redirectTo: '/' }])).toEqual(['redirect: web: apps/web/app/people/page.tsx redirects /people to /, but ia.json sends "old-members" to "members" (/members)']);
        expect(await rules([...app, { ...page, access: 'none' }])).toEqual(['redirect: web: apps/web/app/people/page.tsx renders a page at /people, but ia.json sends "old-members" to "members" (/members)']);
        // A redirect fwos can't read, or a proxy in front of every route, may well do it.
        expect(await rules([...app, { ...page, access: 'unknown', redirectTo: '?' }])).toEqual([]);
        expect(await rules(app, { gatekeepers: ['apps/web/proxy.ts'] })).toEqual([]);
      });
    });

    describe('run as each role and flag setting', () => {
      const plan = iaRunPlan(gated);
      /** A run of an app that does exactly what ia.json says. */
      const faithful = (role: string, flags: string[]): IaRun => {
        const sees = (p: string) => p === 'home' || (flags.includes('members-enabled') && (p === 'beta' || role === 'admin'));
        return {
          role,
          flags,
          applied: true,
          nav: sees('members') ? ['/', '/members'] : ['/'],
          visits: plan.visits.map((v) => ({ page: v.page, path: v.path, status: sees(v.page) ? 200 : 404, finalPath: v.path, notFound: !sees(v.page) })),
        };
      };
      const guarded = app.map((s) => ({ ...s, access: 'ia' as const }));
      const project = (step = 'build', runs = (role: string, flags: string[]) => faithful(role, flags)) => {
        const root = tempProject({
          '.fwos/state.json': minimalState(),
          '.fwos/changes/0001-initial.json': { schema: 1, id: '0001-initial', title: 'Initial app', route: 'initial', step, status: 'open', createdAt: '2026-10-07', approvals: {} },
          'docs/app/ia.json': gated,
          'apps/web/app/page.tsx': '',
        });
        installHarness(root);
        for (const r of plan.runs) recordRun(root, 'ia', r.key, runs(r.role, r.flags));
        return root;
      };
      const check = (root: string, screens: ScreenRef[] = guarded, read: { links?: AppLink[] } = { links }) =>
        run('screens/ia', root, adapterSet([harnessProfile({ screens: { platform: 'web', listScreens: () => ({ screens, inputs: ['apps/web/app/**'], ...read }) } })]));

      it('passes when every role and flag setting sees what ia.json says, and says what ran (the clean control)', async () => {
        const root = project();
        const r = await check(root);
        expect(r.status).toBe('pass');
        expect(r.info).toEqual([
          'web: 3 app routes, 3 ia pages',
          `web: 4 role and flag settings opened 3 routes and read the nav (fwos's IA harness at revision ${revisionOf(loadProject(root))})`,
        ]);
      });

      it('fails a page shown to a role ia.json hides it from, whatever its route code says', async () => {
        const root = project('build', (role, flags) => {
          const run = faithful(role, flags);
          // The members page renders for every role with the flag on.
          if (flags.includes('members-enabled')) run.visits[1] = { ...run.visits[1]!, status: 200, notFound: false };
          return run;
        });
        expect((await check(root)).findings.map((f) => `${f.rule}: ${f.message}`)).toEqual([
          'exposed: web: member (members-enabled on) can open "members" (/members), which ia.json shows only to admin with members-enabled on',
        ]);
      });

      it("fails a page a role can't open and a nav page missing from the rendered nav, though the code links it", async () => {
        const root = project('build', (role, flags) => {
          const run = faithful(role, flags);
          if (role === 'admin' && flags.includes('members-enabled')) {
            run.nav = ['/'];
            run.visits[1] = { ...run.visits[1]!, status: 404, notFound: true };
          }
          return run;
        });
        expect((await check(root)).findings.map((f) => `${f.rule}: ${f.message}`)).toEqual([
          'inaccessible: web: admin (members-enabled on) can\'t open "members" (/members): not found (404)',
          'no-link: web: admin (members-enabled on) sees no link to "members" (/members) in the nav',
        ]);
      });

      it('takes the rendered nav over link paths read from the code', async () => {
        // No link in the code it can read (a nav built from an API), but the running app's nav has it.
        expect((await check(project(), guarded, { links: [] })).status).toBe('pass');
      });

      it("doesn't count runs of older code: off before acceptance, a failure from the accept step on", async () => {
        const root = project();
        writeFiles(root, { 'apps/web/app/page.tsx': 'export default function P() { return null; }\n' });
        expect(await check(root)).toMatchObject({
          status: 'off',
          reason: expect.stringMatching(/^web: 3 app routes match 3 ia pages and 1 nav page is linked, but the last run of fwos's IA harness doesn't count \(the code changed since the harness ran; run the end-to-end tests\), so who sees these isn't compared with the app: members/),
        });
        const accepting = project('accept');
        writeFiles(accepting, { 'apps/web/app/page.tsx': 'export default function P() { return null; }\n' });
        expect((await check(accepting)).findings.map((f) => `${f.rule}: ${f.message}`)).toEqual([
          "no-run: web: no fresh run of fwos's IA harness shows the app to each role and flag setting: the last run of fwos's IA harness doesn't count (the code changed since the harness ran; run the end-to-end tests)",
        ]);
      });

      it("still fails a limited page at a dynamic route, which no run opens, when nothing in its route can turn anyone away", async () => {
        const withItem: Ia = { ...gated, pages: [...gated.pages, { id: 'item', title: 'Item', route: '/items/[id]', kind: 'drilldown', parent: 'home', visibleTo: ['admin'], states: ['ready'] }] };
        const root = project();
        writeFiles(root, { 'docs/app/ia.json': withItem });
        for (const r of iaRunPlan(withItem).runs) recordRun(root, 'ia', r.key, faithful(r.role, r.flags));
        const r = await check(root, [...guarded, { route: '/items/[id]', file: 'apps/web/app/items/[id]/page.tsx', devOnly: false, access: 'none' }]);
        expect(r.findings.map((f) => `${f.rule} ${f.file}`)).toEqual(['ungated apps/web/app/items/[id]/page.tsx']);
      });

      it('takes a run over what the code says about a redirect', async () => {
        const withRedirect: Ia = { ...gated, pages: [...gated.pages, { id: 'old-members', title: 'Old', route: '/people', kind: 'redirect', redirectTo: 'members', states: ['ready'] }] };
        const root = project();
        writeFiles(root, { 'docs/app/ia.json': withRedirect });
        const plan = iaRunPlan(withRedirect);
        for (const r of plan.runs) {
          const run = faithful(r.role, r.flags);
          // The code shows nothing at /people, but the running app redirects it to /members.
          const sees = r.role === 'admin' && r.flags.includes('members-enabled');
          run.visits = [...run.visits, { page: 'old-members', path: '/people', status: sees ? 200 : 404, finalPath: '/members', notFound: !sees, redirectedTo: '/members' }];
          recordRun(root, 'ia', r.key, run);
        }
        const read = { links, redirects: [], gatekeepers: [] };
        const r = await run('screens/ia', root, adapterSet([harnessProfile({ screens: { platform: 'web', listScreens: () => ({ screens: guarded, inputs: ['apps/web/app/**'], ...read }) } })]));
        expect(r).toMatchObject({ status: 'pass', findings: [] });
      });

      it("says to restore the harness when the app's copy isn't this fwos version's", async () => {
        const root = project();
        writeFiles(root, { [TEST_HARNESS[1]!.file]: '// an older fwos harness\n' });
        expect((await check(root)).reason).toMatch(/but the harness in the app \(apps\/web\/e2e\/fwos-ia\.spec\.ts\) isn't this fwos version's: run `fwos harness` to restore it, then the end-to-end tests, so who sees these/);
      });

      it("is off for a page it couldn't open, a dynamic route, saying so", async () => {
        const withItem: Ia = { ...gated, pages: [...gated.pages, { id: 'item', title: 'Item', route: '/items/[id]', kind: 'drilldown', parent: 'home', visibleTo: ['admin'], states: ['ready'] }] };
        const root = project();
        writeFiles(root, { 'docs/app/ia.json': withItem });
        for (const r of iaRunPlan(withItem).runs) recordRun(root, 'ia', r.key, faithful(r.role, r.flags));
        const r = await check(root, [...guarded, { route: '/items/[id]', file: 'apps/web/app/items/[id]/page.tsx', devOnly: false, access: 'ia' }]);
        expect(r).toMatchObject({ status: 'off', reason: expect.stringMatching(/the harness opens static routes only, so who sees these isn't compared with the app: item \(admin\)$/) });
      });
    });
  });

  it('still fails on an invalid ia.json when there is no app to compare it with', async () => {
    const root = tempProject({ 'docs/app/ia.json': { ...base, pages: [...base.pages, { ...base.pages[0]!, route: '/again' }] } });
    const r = await run('screens/ia', root, screenAdapter(null));
    expect(r.status).toBe('fail');
    expect(r.info).toEqual(["web: no app found yet, so ia.json isn't compared with it"]);
  });
});

describe('screens/states', () => {
  it('needs a passing test per page state, and ignores flaky passes', async () => {
    const ia: Ia = { schema: 1, roles: ['member'], pages: [{ id: 'list', title: 'L', route: '/', kind: 'nav', states: ['empty', 'ready', 'error'] }] };
    const xml = `<testsuite>
      <testcase classname="list" name="shows the zero state @state:list:empty"/>
      <testcase classname="list" name="renders items @state:list:ready"><failure message="boom">x</failure></testcase>
      <testcase classname="list" name="renders items @state:list:ready"/>
    </testsuite>`;
    const r = await run('screens/states', tempProject({ 'docs/app/ia.json': ia, '.fwos/local/results/a.xml': xml }));
    expect(r.findings.map((f) => f.message)).toEqual([
      'list "ready": its test fails (boom)',
      'list "error": no passing test is tagged @state:list:error (tag the test that renders it)',
    ]);
    expect(r.info).toEqual([
      '1 page state with a passing tagged test (fwos trusts the tag, not what the test renders)',
      "rendered states aren't checked: no platform here has a harness that renders state fixtures",
    ]);
  });

  describe('render proofs', () => {
    const ia: Ia = { schema: 1, roles: ['member'], pages: [{ id: 'list', title: 'List', route: '/', kind: 'nav', states: ['loading', 'empty', 'error', 'ready'] }] };
    const tags = `<testsuite>${ia.pages[0]!.states.map((s) => `<testcase classname="list" name="renders @state:list:${s}"/>`).join('')}</testsuite>`;
    const seen = (state: string, over: Partial<StateObservation> = {}): StateObservation => ({
      state,
      status: 200,
      found: true,
      nodes: 3,
      text: `${state} view`,
      busy: 0,
      alerts: [],
      statuses: [],
      items: [],
      disabled: 0,
      invalid: 0,
      ...over,
    });
    const right = (): StateObservation[] => [
      seen('loading', { busy: 1 }),
      seen('empty', { statuses: ['Save your first link'] }),
      seen('error', { alerts: ["Couldn't load the list"] }),
      seen('ready', { items: ['Dune example.com', 'Neuromancer example.org'] }),
    ];
    /** A web app with fwos's harness, its tests run, mid-build (not yet at acceptance) unless `step` says otherwise. */
    const app = (step = 'build') => {
      const root = tempProject({
        '.fwos/state.json': minimalState(),
        '.fwos/changes/0001-initial.json': { schema: 1, id: '0001-initial', title: 'Initial app', route: 'initial', step, status: 'open', createdAt: '2026-10-07', approvals: {} },
        'docs/app/ia.json': ia,
        'apps/web/src/screens/list.tsx': 'export const ListScreen = () => null;\n',
        '.fwos/local/results/e2e.xml': tags,
      });
      installHarness(root);
      syntheticTestRun(root);
      return root;
    };
    const check = (root: string) => run('screens/states', root, adapterSet([harnessProfile()]));

    it('passes a state with a passing tagged test that renders as its contract says, and says where the proof came from', async () => {
      const root = app();
      recordRun(root, 'states', 'page.list', right());
      const r = await check(root);
      expect(r.status).toBe('pass');
      expect(r.info).toEqual([
        '4 page states render as their contract says, with a passing tagged test',
        `rendered by fwos's harness at revision ${revisionOf(loadProject(root))} (production build, chromium)`,
      ]);
    });

    it('fails a state whose tagged test passes while its fixture renders another state', async () => {
      const root = app();
      const obs = right();
      obs[0] = { ...obs[3]!, state: 'loading' };
      recordRun(root, 'states', 'page.list', obs);
      const r = await check(root);
      expect(r.status).toBe('fail');
      expect(r.findings.map((f) => f.message)).toEqual([
        'list "loading": nothing is marked aria-busy="true"; keeps the ready state\'s content (Dune example.com, Neuromancer example.org); renders exactly as "ready", so the fixture ignores its state. A "loading" state renders something marked aria-busy="true", no alert, none of the ready state\'s content',
      ]);
    });

    it('fails an error state that keeps the stale list beside its alert', async () => {
      const root = app();
      const obs = right();
      obs[2] = seen('error', { alerts: ["Couldn't load the list"], items: ['Dune example.com'] });
      recordRun(root, 'states', 'page.list', obs);
      expect((await check(root)).findings.map((f) => `${f.rule}: ${f.message}`)).toEqual([
        "list: list \"error\": keeps the ready state's content (Dune example.com). An \"error\" state renders a role=\"alert\" that says what went wrong, nothing aria-busy, none of the ready state's content",
      ]);
    });

    it('fails a ready state whose rows paint on hover while a click only acts on their title, and passes once the whole row acts', async () => {
      const root = app();
      const obs = right();
      const row = { text: 'Dune example.com', paints: ['background-color', 'cursor: pointer'], controls: ['link "Dune"'], click: 'nothing' };
      obs[3] = { ...obs[3]!, hits: [row] };
      recordRun(root, 'states', 'page.list', obs);
      expect((await check(root)).findings.map((f) => f.message)).toEqual([
        'list "ready": hovering "Dune example.com" paints it (background-color, cursor: pointer), but a click on it outside link "Dune" does nothing. In any state, anything that changes on hover, or shows a pointer, acts on a click anywhere on it',
      ]);
      obs[3] = { ...obs[3]!, hits: [{ ...row, controls: [], click: 'navigated to /books/dune' }] };
      recordRun(root, 'states', 'page.list', obs);
      expect(await check(root)).toMatchObject({ status: 'pass', findings: [] });
    });

    it("doesn't count a run of older code: off before acceptance, a failure from the accept step on", async () => {
      const root = app();
      recordRun(root, 'states', 'page.list', right());
      writeFiles(root, { 'apps/web/src/screens/list.tsx': 'export const ListScreen = () => 1;\n' });
      expect(await check(root)).toMatchObject({
        status: 'off',
        reason: '0 of 4 page states render as their contract says, with a passing tagged test; not proven yet: list "loading", list "empty", list "error", list "ready" (the code changed since the harness ran; run the end-to-end tests)',
      });
      const accepting = app('accept');
      recordRun(accepting, 'states', 'page.list', right());
      writeFiles(accepting, { 'apps/web/src/screens/list.tsx': 'export const ListScreen = () => 1;\n' });
      syntheticTestRun(accepting); // Current synthetic JUnit isolates the stale harness proof.
      const r = await check(accepting);
      expect(r.status).toBe('fail');
      expect(r.findings.map((f) => f.message)).toContain('list "error": no fresh render proof (the code changed since the harness ran; run the end-to-end tests)');
    });

    it("is off, not a pass, when only tags vouch for the states: the app has no harness, or no platform renders fixtures", async () => {
      const root = app();
      rmSync(join(root, TEST_HARNESS[0]!.file));
      expect(await check(root)).toMatchObject({
        status: 'off',
        reason: "4 page states have a passing tagged test (fwos trusts the tag, not what the test renders), but nothing shows them rendering: fwos's state harness isn't in the app (apps/web/e2e/fwos-states.spec.ts; `fwos harness` writes it)",
      });
      // A failing tag still fails, harness or not.
      writeFiles(root, { '.fwos/local/results/e2e.xml': tags.replace('name="renders @state:list:empty"/>', 'name="renders @state:list:empty"><failure message="no zero state"/></testcase>') });
      expect((await check(root)).findings.map((f) => f.message)).toEqual(['list "empty": its test fails (no zero state)']);
    });

    it("doesn't count a run an edited harness recorded, and names a record fwos didn't write", async () => {
      const root = app();
      recordRun(root, 'states', 'page.list', right(), { harness: { file: TEST_HARNESS[0]!.file, sha: 'edited00000' } });
      expect((await check(root)).reason).toMatch(/not proven yet: .*\(a harness other than this fwos version's recorded it; run the end-to-end tests\)$/);
      writeFiles(root, { '.fwos/local/runs/states/page.list.json': '{"schema":1,"kind":"states","target":"page.list"}' });
      const r = await check(root);
      expect(r.findings).toEqual([
        {
          file: '.fwos/local/runs/states/page.list.json',
          rule: 'run-record',
          message: expect.stringMatching(/^not a run record that fwos wrote: \(root\) must have required property 'fwos'; /),
        },
      ]);
    });

    it("says to restore the harness when the app's copy isn't this fwos version's: a new run of it wouldn't count", async () => {
      const root = app();
      recordRun(root, 'states', 'page.list', right());
      writeFiles(root, { [TEST_HARNESS[0]!.file]: '// an older fwos harness\n' });
      expect((await check(root)).reason).toMatch(
        /not proven yet: list "loading", list "empty", list "error", list "ready" \(the harness in the app \(apps\/web\/e2e\/fwos-states\.spec\.ts\) isn't this fwos version's: run `fwos harness` to restore it, then the end-to-end tests\)$/,
      );
    });

    it('waits for a page with no state fixture until acceptance, then fails it', async () => {
      const obs = right().map((o) => ({ ...o, found: false, missing: true }));
      const building = app();
      recordRun(building, 'states', 'page.list', obs);
      expect((await check(building)).reason).toMatch(/not proven yet: list "loading", .* \(no state fixture renders it yet: register the screen in src\/screens\/registry\.tsx\)$/);
      const accepting = app('accept');
      recordRun(accepting, 'states', 'page.list', obs);
      syntheticTestRun(accepting);
      expect((await check(accepting)).findings.map((f) => f.message)[0]).toBe('list "loading": no fresh render proof (no state fixture renders it yet: register the screen in src/screens/registry.tsx)');
    });
  });
});

describe('renderTemplate', () => {
  it('fills placeholders and renames dotfiles', () => {
    const files = renderTemplate('web', { APP_NAME: 'Reading list', APP_SLUG: 'reading-list' });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('.gitignore');
    expect(paths).toContain('apps/web/package.json');
    expect(files.every((f) => !f.content.includes('{{APP_'))).toBe(true);
  });

  it('refuses unknown platforms', () => {
    expect(() => renderTemplate('ios', { APP_NAME: 'x', APP_SLUG: 'x' })).toThrow(/No scaffold template/);
  });

  it('pins the same pnpm as this repo, so CI in a new app finds a version', () => {
    const repo = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'));
    const files = renderTemplate('web', { APP_NAME: 'x', APP_SLUG: 'x' });
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content);
    expect(pkg.packageManager).toBe(repo.packageManager);
  });
});
