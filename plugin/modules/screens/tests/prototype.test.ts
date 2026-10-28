// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Prototype bundles: what a promotion needs (a visual artifact, a real-component companion, a state
// inventory, the build spec, the decision record where there is one, and the intended ia.json), what
// it refuses (a working/ link, a role or flag the pack doesn't have, a duplicate ID, an app route the
// IA doesn't classify, an input changed since it was promoted), and how the intended IA compares
// with the real app: its routes, and what runs of the IA harness showed each role.

import { afterAll, describe, expect, it } from 'vitest';
import { type AppScreens, type IaRun, type Project, hashText, loadProject } from '../../../kernel/index.ts';
import { cleanupTempProjects, minimalState, tempProject, writeFiles } from '../../../kernel/testing.ts';
import { type Ia, type Promotion, checkBundle, compareWithApp, formatAppDiff, listBundles, parseStates } from '../index.ts';

afterAll(cleanupTempProjects);

const home = { id: 'home', title: 'Home', route: '/', kind: 'nav', order: 1, states: ['ready'] };
const list = { id: 'list', title: 'Reading list', route: '/list', kind: 'nav', order: 2, states: ['loading', 'empty', 'error', 'ready'] };
const members = { id: 'members', title: 'Members', route: '/members', kind: 'nav', order: 3, visibleTo: ['admin'], flag: 'members-enabled', states: ['ready'] };
/** The app's IA as the pack has it: what the IA harness runs from. */
const PACK: Ia = { schema: 1, roles: ['member', 'admin'], flags: ['members-enabled'], pages: [home, list, members] as Ia['pages'] };
/** The bundle's intended IA: it adds a reports page to the nav, moves members (keeping its ID) and hides the list from members. */
const INTENDED: Ia = {
  schema: 1,
  roles: ['member', 'admin'],
  flags: ['members-enabled'],
  pages: [home, { ...list, visibleTo: ['admin'] }, { ...members, route: '/team/members' }, { id: 'reports', title: 'Reports', route: '/reports', kind: 'nav', order: 4, states: ['loading', 'ready'] }] as Ia['pages'],
};
const DIR = 'docs/app/prototypes/members';
const BUNDLE = {
  schema: 1,
  id: 'members',
  title: 'Members and reports',
  pages: ['members', 'reports'],
  visual: [
    { kind: 'html', ref: `${DIR}/prototype.html` },
    { kind: 'figma', ref: 'https://example.com/design/design/abc123/Members' },
  ],
  companion: [
    { kind: 'route', page: 'members', ref: '/fwos-screens/members' },
    { kind: 'route', page: 'reports', ref: '/fwos-screens/reports' },
  ],
  states: `${DIR}/states.md`,
  spec: 'docs/app/spec.md#members-and-reports',
  decision: 'docs/app/decisions.md#D-4',
  ia: `${DIR}/ia.json`,
};
const STATES = '# States: members and reports\n\n## members\n- ready: the members table, one row per member\n\n## reports\n- loading: a skeleton while the report loads\n- ready: the report\n';
const SPEC = '# Spec\n\n## Members and reports\n\n### AC-members-1: Admins see the members table\n- Given ...\n\n## Something else\n\nText.\n';
const DECISIONS = '| # | Date | Step | Decision | Why |\n|---|---|---|---|---|\n| D-4 | 2026-10-20 | screens | Members move under /team | the team area groups people pages |\n';

function project(over: Record<string, string | object> = {}): Project {
  return loadProject(
    tempProject({
      '.fwos/state.json': minimalState(),
      'docs/app/ia.json': PACK,
      'docs/app/spec.md': SPEC,
      'docs/app/decisions.md': DECISIONS,
      [`${DIR}/bundle.json`]: BUNDLE,
      [`${DIR}/ia.json`]: INTENDED,
      [`${DIR}/states.md`]: STATES,
      [`${DIR}/prototype.html`]: '<!doctype html><title>Members</title><a href="reports.html">Reports</a>\n',
      ...over,
    }),
  );
}

/** The app's routes, each declaring its page ID as guardPage does. */
const APP: AppScreens = {
  screens: [
    { route: '/', file: 'apps/web/app/page.tsx', devOnly: false, id: 'home' },
    { route: '/list', file: 'apps/web/app/list/page.tsx', devOnly: false, id: 'list' },
    { route: '/members', file: 'apps/web/app/members/page.tsx', devOnly: false, id: 'members' },
    { route: '/fwos-screens', file: 'apps/web/app/(fwos-screens)/fwos-screens/page.tsx', devOnly: true },
  ],
  inputs: [],
};

const check = (p: Project, app: AppScreens | null = APP, promotions: Record<string, Promotion> = {}) => {
  const bundles = listBundles(p);
  return checkBundle(p, bundles.find((b) => b.path === `${DIR}/bundle.json`)!, { app, bundles, promotions });
};

describe('prototype bundles: what a promotion needs', () => {
  it('passes a bundle that links each part, and pins each input it would promote', () => {
    const r = check(project());
    expect(r.problems).toEqual([]);
    expect(Object.keys(r.inputs).sort()).toEqual([
      'docs/app/decisions.md#D-4',
      `${DIR}/bundle.json`,
      `${DIR}/ia.json`,
      `${DIR}/prototype.html`,
      `${DIR}/states.md`,
      'docs/app/spec.md#members-and-reports',
    ]);
    // The spec's section and the decision's row, not the whole file: an unrelated edit elsewhere doesn't stale it.
    expect(r.inputs['docs/app/spec.md#members-and-reports']).toBe(hashText('## Members and reports\n\n### AC-members-1: Admins see the members table\n- Given ...\n'));
  });

  it('refuses a link into working/, in the bundle or in a page it links', () => {
    const p = project({ [`${DIR}/bundle.json`]: { ...BUNDLE, visual: [{ kind: 'html', ref: 'working/members-v2.html' }, ...BUNDLE.visual.slice(1)] }, 'working/members-v2.html': '<p>draft</p>\n' });
    expect(check(p).problems).toEqual(["visual working/members-v2.html is in working/: a promoted bundle can't rest on a draft"]);
    const q = project({ [`${DIR}/states.md`]: `${STATES}\nSee [the draft](../../../../working/states-notes.md).\n` });
    expect(check(q).problems).toEqual(["states.md links into working/ (../../../../working/states-notes.md): a promoted bundle can't rest on a draft"]);
  });

  it("refuses a role or flag the pack doesn't have, and one a page uses that its IA doesn't declare", () => {
    const p = project({
      [`${DIR}/ia.json`]: { ...INTENDED, roles: [...INTENDED.roles, 'auditor'], pages: INTENDED.pages.map((x) => (x.id === 'reports' ? { ...x, visibleTo: ['auditor'], flag: 'beta' } : x)) },
    });
    expect(check(p).problems).toEqual([
      'ia.json: page "reports" uses unknown flag "beta"',
      'ia.json declares role "auditor", which docs/app/ia.json doesn\'t: add it there first, or use one it has',
    ]);
  });

  it("refuses a duplicate page ID, and a bundle whose ID isn't its folder's", () => {
    const p = project({ [`${DIR}/ia.json`]: { ...INTENDED, pages: [...INTENDED.pages, { ...INTENDED.pages[3]!, route: '/reports-2' }] }, [`${DIR}/bundle.json`]: { ...BUNDLE, id: 'team' } });
    expect(check(p).problems).toEqual(['bundle id "team" isn\'t its folder\'s name (members): one folder per feature', 'ia.json: page id "reports" is used twice']);
  });

  it("refuses an app route the intended IA neither lists nor marks unlinked, and takes it once it's classified", () => {
    const app: AppScreens = { ...APP, screens: [...APP.screens, { route: '/about', file: 'apps/web/app/about/page.tsx', devOnly: false }] };
    expect(check(project(), app).problems).toEqual([
      "the app's route /about (apps/web/app/about/page.tsx) isn't in the bundle's ia.json: list it as a nav, drill-down or redirect page, or mark it unlinked with a reason",
    ]);
    const about = { id: 'about', title: 'About', route: '/about', kind: 'unlinked', unlinkedReason: 'linked from the footer of the marketing site', states: ['ready'] };
    expect(check(project({ [`${DIR}/ia.json`]: { ...INTENDED, pages: [...INTENDED.pages, about] } }), app).problems).toEqual([]);
    // With no app yet, there is nothing to classify, and it says so.
    expect(check(project(), null).notes).toContain('no app yet, so no route of it is classified');
  });

  it('refuses a missing or partial state inventory', () => {
    const missing = project({ [`${DIR}/bundle.json`]: { ...BUNDLE, states: `${DIR}/nope.md` } });
    expect(check(missing).problems).toEqual([`states ${DIR}/nope.md doesn't exist`]);
    const partial = project({ [`${DIR}/states.md`]: '## members\n- ready: the table\n- error: it failed\n- ready: again\n\n## home\n- ready: welcome\n' });
    expect(check(partial).problems).toEqual([
      'states.md: members lists "ready" twice',
      'states.md: members lists "error", which the bundle\'s ia.json doesn\'t give it',
      'states.md: home isn\'t one of the bundle\'s pages (members, reports)',
      'states.md: reports has no section (## reports, then a line per state: - <state>: what it shows)',
    ]);
    expect(parseStates(STATES).sections.map((s) => [s.page, s.states.map((x) => x.state)])).toEqual([
      ['members', ['ready']],
      ['reports', ['loading', 'ready']],
    ]);
  });

  it('refuses a visual artifact alone: each page needs its real-component companion', () => {
    const p = project({ [`${DIR}/bundle.json`]: { ...BUNDLE, companion: [BUNDLE.companion[0]] } });
    expect(check(p).problems).toEqual(['reports has no real-component companion: a route in the app (the screens browser\'s /fwos-screens/reports) or a Storybook story that renders it from registered components']);
    const q = project({ [`${DIR}/bundle.json`]: { ...BUNDLE, visual: [{ kind: 'pdf', ref: 'x.pdf' }], spec: 'docs/app/spec.md#nowhere', decision: 'docs/app/decisions.md#D-9' } });
    expect(check(q).problems).toEqual([
      'visual kind "pdf" isn\'t one fwos knows: html, image, figma, storybook, route or url',
      'spec docs/app/spec.md#nowhere: no heading there is "nowhere"',
      'decision docs/app/decisions.md#D-9: no heading there is "D-9", and no decision row either',
    ]);
  });

  it('fails closed on a bundle from a schema it does not read', () => {
    const p = project({ [`${DIR}/bundle.json`]: { ...BUNDLE, schema: 2 } });
    expect(check(p).problems).toEqual([`${DIR}/bundle.json is bundle schema 2, and this fwos reads schema 1: update fwos`]);
  });

  it('is stale once a pinned input changes after promotion, and current while none does', () => {
    const p = project();
    const promoted: Promotion = { bundle: `${DIR}/bundle.json`, at: '2026-10-23T10:00:00Z', by: 'Ada', inputs: check(p).inputs };
    expect(check(p, APP, { members: promoted })).toMatchObject({ problems: [], stale: [] });
    // An edit elsewhere in the spec leaves the bundle current; one to its states doesn't.
    writeFiles(p.root, { 'docs/app/spec.md': `${SPEC}\nAnother line.\n` });
    expect(check(loadProject(p.root), APP, { members: promoted }).stale).toEqual([]);
    writeFiles(p.root, { [`${DIR}/states.md`]: STATES.replace('a skeleton', 'a spinner') });
    expect(check(loadProject(p.root), APP, { members: promoted }).stale).toEqual([`${DIR}/states.md changed since Ada promoted it on 2026-10-23`]);
  });
});

/** A run of the IA harness as `role` with `flags` on: the routes it could open, and the paths its nav links. */
const run = (role: string, flags: string[], open: string[], nav: string[]): IaRun => ({
  role,
  flags,
  applied: true,
  nav,
  visits: [home, list, members].map((p) => ({ page: p.id, path: p.route, status: open.includes(p.route) ? 200 : 404, finalPath: p.route, notFound: !open.includes(p.route) })),
});
/** What the scaffolded app shows: members only to admin with the flag on, in the nav and at its route. */
const RUNS = [
  run('member', ['members-enabled'], ['/', '/list'], ['/', '/list']),
  run('member', [], ['/', '/list'], ['/', '/list']),
  run('admin', ['members-enabled'], ['/', '/list', '/members'], ['/', '/list', '/members']),
  run('admin', [], ['/', '/list'], ['/', '/list']),
];

describe('prototype bundles: the intended IA against the real app', () => {
  it('shows a nav item added, a page moved under its stable ID and a page hidden from one role', () => {
    const d = compareWithApp(INTENDED, { routes: APP.screens, runs: RUNS });
    expect(formatAppDiff(d)).toBe(
      [
        '+ added        reports: Reports at /reports (nav); the app has no route for it',
        '~ moved        members: the bundle puts it at /team/members; the app has it at /members',
        '! hidden       list: the bundle hides it from member; the app lets member open it',
      ].join('\n'),
    );
    // A parser that only spots new strings would see the route change, not who sees the list.
    expect(d.changes.find((c) => c.kind === 'hidden')).toMatchObject({ id: 'list', role: 'member' });
  });

  it("shows what the app exposes or hides against the intent, the nav included, and when", () => {
    // The intent: members for every admin, whatever the flag, and the list as a drill-down off home.
    const intended: Ia = { ...PACK, pages: [home, { ...list, kind: 'drilldown', parent: 'home' }, { ...members, flag: undefined }] as Ia['pages'] };
    const d = compareWithApp(intended, { routes: APP.screens, runs: RUNS });
    expect(formatAppDiff(d)).toBe(
      [
        '! exposed      members: the bundle shows it to admin; the app doesn\'t let admin open it (while members-enabled is off)',
        '! nav          list: the app\'s nav links it for every role; the bundle doesn\'t put it in the nav',
      ].join('\n'),
    );
  });

  it("names a route the intent doesn't classify, and what no run covered", () => {
    const routes = [...APP.screens, { route: '/about', file: 'apps/web/app/about/page.tsx', devOnly: false }];
    const d = compareWithApp(INTENDED, { routes, runs: RUNS.filter((r) => r.role !== 'admin') });
    expect(d.changes.filter((c) => c.kind === 'unclassified')).toEqual([{ kind: 'unclassified', route: '/about', detail: "the app exposes it (apps/web/app/about/page.tsx); the bundle's ia.json neither lists it nor marks it unlinked" }]);
    expect(d.notCompared).toEqual(["admin (members-enabled on), admin (members-enabled off): no fresh run of fwos's IA harness opened the app that way, so who sees what isn't compared there"]);
    expect(compareWithApp(INTENDED, { routes: APP.screens, runs: [] }).notCompared).toEqual([
      "no fresh run of fwos's IA harness, so only routes are compared, not who sees what (run the end-to-end tests)",
    ]);
  });
});
