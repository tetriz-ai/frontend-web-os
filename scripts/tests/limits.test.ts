// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Pins every limit the README lists under "Before you rely on it", so a change that removes one
// also updates the README, and none of them turns up as a surprise. Each pin first shows the
// mechanism catching the normal case (a positive control), then the documented miss, so a
// mechanism stubbed to do nothing fails here instead of passing every "it is not seen".

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type IaRun, type RunKind, type StateObservation, adapterSet, type CheckResult, hashText, judgeStates, loadProject, revisionOf, writeRun } from '../../plugin/kernel/index.ts';
import { syntheticTestRun, cleanupTempProjects, tempProject, writeFiles } from '../../plugin/kernel/testing.ts';
import { extractImports, runWalls } from '../../plugin/modules/architecture/index.ts';
import { checks as designChecks, scanRawValues } from '../../plugin/modules/design-system/index.ts';
import { type Ia, checks as screenChecks, iaRunPlan } from '../../plugin/modules/screens/index.ts';
import { approvalState, approve, initProject, listChanges, updateChange } from '../../plugin/modules/state/index.ts';
import { browserResults, checks as testChecks, lockTests, lockedFiles, recordRun as recordTestRun } from '../../plugin/modules/tests/index.ts';
import { profile as web, verify } from '../../plugin/platforms/web/index.ts';
import { dispatch } from '../../plugin/shells/hooks/index.ts';

afterAll(cleanupTempProjects);

const bundle = join(__dirname, '../../plugin/dist/fwos.mjs');
/** screens/ia on a web app with a home page at / and these files. */
const iaCheck = async (files: Record<string, unknown>) =>
  screenChecks
    .find((c) => c.id === 'screens/ia')!
    .run({ project: loadProject(tempProject({ 'apps/web/package.json': {}, 'apps/web/app/page.tsx': '', ...files })), adapters: adapterSet([web]) });
/** An ia.json with a home page at / and `page`, for two roles and one flag. */
const iaWith = (page: object) => ({
  schema: 1,
  roles: ['member', 'admin'],
  flags: ['members-enabled'],
  pages: [{ id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['ready'] }, page],
});

/** fwos's own harness files in the project's app, as `fwos harness` writes them. */
const installHarness = (root: string) => writeFiles(root, Object.fromEntries(verify.harness!(loadProject(root)).map((h) => [h.file, h.content])));
/** A run of fwos's harness on the project as it is now, as `fwos harness record` keeps it. */
const recordRun = (root: string, kind: RunKind, target: string, observations: unknown) => {
  const project = loadProject(root);
  const h = verify.harness!(project).find((x) => x.kind === kind)!;
  writeRun(project, { schema: 1, kind, target, fwos: '0.1.0', harness: { file: h.file, sha: hashText(h.content) }, revision: revisionOf(project), config: {}, at: '2026-10-23T00:00:00.000Z', observations });
};
/** What the state harness sees in one state's fixture. */
const seen = (state: string, over: Partial<StateObservation> = {}): StateObservation => ({ state, status: 200, found: true, nodes: 3, text: `${state} view`, busy: 0, alerts: [], statuses: [], items: [], disabled: 0, invalid: 0, ...over });
/** A run where the app shows each page to exactly whom ia.json says. */
const faithfulRun = (ia: Ia, role: string, flags: string[]): IaRun => {
  const sees = (id: string) => {
    const p = ia.pages.find((x) => x.id === id)!;
    return (!p.visibleTo || p.visibleTo.includes(role)) && (!p.flag || flags.includes(p.flag));
  };
  const plan = iaRunPlan(ia);
  return {
    role,
    flags,
    applied: true,
    nav: ia.pages.filter((p) => p.kind === 'nav' && p.route && !p.route.includes('[') && sees(p.id)).map((p) => p.route!),
    visits: plan.visits.map((v) => ({ page: v.page, path: v.path, status: sees(v.page) ? 200 : 404, finalPath: v.path, notFound: !sees(v.page) })),
  };
};

/** The CLI from source, in its own process, as any shell would run it. */
const fwos = (cwd: string, ...argv: string[]) => {
  const main = join(__dirname, '../../plugin/shells/cli/main.ts');
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', main, ...argv], { cwd });
  return { code: r.status, out: r.stdout.toString(), err: r.stderr.toString() };
};

describe('misses (can let something through)', () => {
  it('the edit hooks only see Write and Edit, so a shell command writes past them; fwos check still catches a locked test changed that way', () => {
    const root = tempProject({ 'e2e/a.spec.ts': 'x' });
    initProject(root);
    lockTests(loadProject(root), ['e2e/a.spec.ts'], { evidence: 'existing' });
    // Positive control: the hook stops an Edit of the locked test.
    const viaEdit = { tool_name: 'Edit', cwd: root, tool_input: { file_path: join(root, 'e2e/a.spec.ts') } };
    expect(dispatch('pre-tool-use', viaEdit).stdout).toMatch(/tests\/locked.*e2e\/a\.spec\.ts is a locked test/);
    expect(lockedFiles(loadProject(root))[0]!.status).toBe('ok');
    // The miss: the same edit through the shell is not seen by the hook.
    const viaShell = { tool_name: 'Bash', cwd: root, tool_input: { command: 'echo y > e2e/a.spec.ts' } };
    expect(dispatch('pre-tool-use', viaShell).stdout).toBe('');
    execFileSync('sh', ['-c', 'echo y > e2e/a.spec.ts'], { cwd: root });
    expect(lockedFiles(loadProject(root))[0]!.status).toBe('changed');
  });

  it('the token scan reads source text, so a colour assembled at runtime is not seen', () => {
    // Positive control: a literal colour is caught.
    expect(scanRawValues('a.tsx', "const c = '#ff0000';").map((f) => f.rule)).toEqual(['raw-color']);
    expect(scanRawValues('a.tsx', "const c = '#' + 'ff0000';")).toEqual([]);
  });

  it('the token scan checks colours, type and radii, not spacing, so a raw padding, margin, gap or width passes', () => {
    // Positive control: a raw font size and radius, in a class, a style object and CSS, are caught.
    expect(scanRawValues('a.tsx', '<div className="text-[14px] rounded-[9px]" />').map((f) => f.rule)).toEqual(['raw-size', 'raw-radius']);
    expect(scanRawValues('a.tsx', "const s = { padding: 13, margin: '7px', fontSize: 14, borderRadius: 9 };").map((f) => f.rule)).toEqual(['raw-size', 'raw-radius']);
    expect(scanRawValues('a.css', '.x { margin: 7px; padding: 13px; font-size: 14px; }').map((f) => f.rule)).toEqual(['raw-size']);
    // The miss: the spacing beside them.
    expect(scanRawValues('a.tsx', '<div className="p-[13px] m-3 gap-7 w-[333px]" />')).toEqual([]);
  });

  it('the walls check reads import specifiers, so an import from a computed path is not seen', () => {
    // Positive control: a static import is read, and one across a wall is caught.
    expect(extractImports("const m = await import('./features/list');").map((i) => i.spec)).toEqual(['./features/list']);
    const project = (aIndex: string) => {
      const root = tempProject({
        'docs/app/modules.json': { schema: 1, modules: [{ name: 'a', path: 'src/a', dependsOn: [] }, { name: 'b', path: 'src/b', dependsOn: [] }] },
        'src/a/index.ts': aIndex,
        'src/b/index.ts': 'export {};',
      });
      const p = loadProject(root);
      p.paths.source = ['src/**'];
      return p;
    };
    expect(runWalls(project("export const m = import('../b');")).findings.length).toBeGreaterThan(0);
    // The miss.
    expect(extractImports('const m = await import(`./features/${name}`);')).toEqual([]);
    expect(runWalls(project("const name = 'b'; export const m = import('../' + name);")).findings).toEqual([]);
  });

  it("traceability trusts the AC tag on a passing test; whether the test checks the right thing is the adjudicator agent's job", () => {
    const traceability = (testcase: string) => {
      const root = tempProject({
        'docs/app/spec.md': '### AC-x-1: Saves\n- Proven against: local\n',
        '.fwos/local/results/v.xml': `<testsuite>${testcase}</testsuite>`,
      });
      initProject(root);
      expect(approvalState(loadProject(root), 'brief').status).toBe('absent');
      const out = spawnSync(process.execPath, [bundle, 'check', 'traceability', '--json'], { cwd: root }).stdout.toString();
      return JSON.parse(out).results.find((r: { id: string }) => r.id === 'tests/traceability').status;
    };
    // Positive control: a failing test with the tag does not prove the AC.
    expect(traceability('<testcase classname="c" name="saves @AC-x-1"><failure message="no row"/></testcase>')).toBe('fail');
    // The miss: a passing test that checks nothing does.
    expect(traceability('<testcase classname="c" name="expect(true).toBe(true) @AC-x-1"/>')).toBe('pass');
  });

  it("a state's tagged test is taken on trust: fwos's harness proves what each state renders, not what it does, so a retry that does nothing passes with a test that checks nothing", async () => {
    // Run the state-rendering assertions: button needs default and loading, the list page four states.
    const tags = ['@state:button:default', '@state:button:loading', '@state:list:loading', '@state:list:empty', '@state:list:error', '@state:list:ready'];
    const root = tempProject({
      'apps/web/package.json': { name: 'web' },
      'design-system/components.json': { schema: 1, components: [{ id: 'button', status: 'stable', requiredStates: ['default', 'loading'] }] },
      'docs/app/ia.json': { schema: 1, roles: ['member'], pages: [{ id: 'list', title: 'List', route: '/', kind: 'nav', states: ['loading', 'empty', 'error', 'ready'] }] },
      // Each test asserts only 1 === 1: nothing renders.
      'tests/states.test.mjs': `import { test } from 'node:test';\nimport assert from 'node:assert';\nfor (const tag of ${JSON.stringify(tags)}) test(\`renders \${tag}\`, () => assert.equal(1, 1));\n`,
    });
    mkdirSync(join(root, '.fwos/local/results'), { recursive: true });
    spawnSync(process.execPath, ['--test', '--test-reporter=junit', '--test-reporter-destination=.fwos/local/results/node.xml', 'tests/states.test.mjs'], { cwd: root });
    const statuses = async () => {
      const project = loadProject(root);
      const ids = ['design-system/required-states', 'screens/states'];
      return Promise.all(ids.map(async (id) => ((await [...designChecks, ...screenChecks].find((c) => c.id === id)!.run({ project, adapters: adapterSet([web]) })) as CheckResult).status));
    };
    // Tags alone show nothing rendering: off.
    expect(await statuses()).toEqual(['off', 'off']);
    // Positive control: fwos's harness saw the button idle while loading and the error keep the ready rows. Both fail.
    installHarness(root);
    const rows = ['Dune example.com'];
    recordRun(root, 'states', 'component.button', [seen('default', { text: 'Save' }), seen('loading', { text: 'Save', disabled: 1 })]);
    recordRun(root, 'states', 'page.list', [seen('loading', { busy: 1 }), seen('empty', { statuses: ['Nothing yet'] }), seen('error', { alerts: ["Couldn't load"], items: rows }), seen('ready', { items: rows })]);
    expect(await statuses()).toEqual(['fail', 'fail']);
    // The miss: rendered right, the states pass, though their tests never clicked the retry or checked anything they do.
    recordRun(root, 'states', 'component.button', [seen('default', { text: 'Save' }), seen('loading', { text: 'Loading', busy: 1, disabled: 1 })]);
    recordRun(root, 'states', 'page.list', [seen('loading', { busy: 1 }), seen('empty', { statuses: ['Nothing yet'] }), seen('error', { alerts: ["Couldn't load Try again"] }), seen('ready', { items: rows })]);
    expect(await statuses()).toEqual(['pass', 'pass']);
  });

  it("the render contract reads a state's content from list items, table rows and articles, so stale content shown in plain boxes, such as a grid of cards, is not seen", () => {
    const states = (errorItems: string[]) => judgeStates([seen('error', { alerts: ["Couldn't load"], items: errorItems }), seen('ready', { items: ['Dune'] })]).map((v) => v.verdict);
    // Positive control: the ready rows, still listed beside the error, are stale content.
    expect(states(['Dune'])).toEqual(['violation', 'ok']);
    // The miss: the same text in a card grid of divs reaches the harness as text, not items, and passes.
    expect(judgeStates([seen('error', { alerts: ["Couldn't load"], text: "Couldn't load Dune" }), seen('ready', { text: 'Dune' })]).map((v) => v.verdict)).toEqual(['ok', 'ok']);
  });

  it('a state whose name the render contract has no rule for is held only to rendering, and differently from ready', () => {
    // Positive control: an empty state with nothing announcing it fails.
    expect(judgeStates([seen('empty'), seen('ready')]).map((v) => v.verdict)).toEqual(['violation', 'ok']);
    // The miss: the same render under a name of its own passes.
    expect(judgeStates([seen('vacant'), seen('ready')]).map((v) => `${v.verdict} ${v.contract}`)).toEqual(['ok generic', 'ok named']);
  });

  it("fwos's state harness renders each state's fixture in the screens browser, not the page at its route, so a route that draws a state differently from its fixture is not seen", () => {
    const p = loadProject(tempProject({ 'apps/web/app/(fwos-screens)/fwos-screens/[pageId]/page.tsx': '' }));
    const states = verify.harness!(p).find((h) => h.kind === 'states')!.content;
    // Positive control: it opens each page's fixture, in each state, at the path the driver gives: the screens browser.
    expect(states).toContain('const at = t.paths[state];');
    expect(verify.fixture!(p, { kind: 'page', id: 'list', state: 'error' })).toBe('/fwos-screens/list?state=error');
    // The miss: nothing in it opens a page's own route; the IA harness does, and judges who sees it, not its state.
    expect(states).not.toMatch(/route/);
  });

  it('the harness looks for dead hit areas in list items, table rows, articles, pointer cursors and hover or group classes, so a card styled for hover any other way is not tried', () => {
    const states = verify.harness!(loadProject(tempProject())).find((h) => h.kind === 'states')!.content;
    // Positive control: a row the harness saw paint on hover, with a click there that did nothing, fails its state.
    const row = { text: 'Dune by Frank Herbert', paints: ['background-color'], controls: ['link "Dune"'], click: 'nothing' };
    expect(judgeStates([seen('ready', { hits: [row] })])[0]!.dead).toHaveLength(1);
    // The miss: what it hovers is chosen by these rules alone, so anything else is never a hit to judge.
    expect(states).toContain(`const item = e.matches('li, [role="listitem"], [role="row"], article') || (e.tagName === 'TR' && !!e.querySelector('td'));`);
    expect(states).toContain(`const pointer = getComputedStyle(e).cursor === 'pointer'`);
    expect(states).toContain(`const styled = [...e.classList].some((c) => c.includes('hover:') || c === 'group' || c.startsWith('group/'));`);
  });

  it("doctor --start runs the app's next dev, not a production build, with what the app needs to boot, and shows the browser checks can run, not that they pass", async () => {
    // A stand-in Next.js that notes how it was started, then stops the way an app missing its env does.
    const root = tempProject({
      'apps/web/package.json': { name: 'web' },
      'apps/web/node_modules/next/package.json': { name: 'next', version: '16.4.0' },
      'apps/web/node_modules/next/dist/bin/next': "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'argv.json'), JSON.stringify({ argv: process.argv.slice(2), screens: process.env.FWOS_SCREENS }));\nconsole.error('Error: POSTGRES_URL is not set');\nprocess.exit(1);\n",
      'apps/web/node_modules/@playwright/test/package.json': { name: '@playwright/test', main: 'index.js' },
      'apps/web/node_modules/@playwright/test/index.js': 'module.exports = {};\n',
    });
    const r = await verify.render!(loadProject(root), { fixture: { kind: 'page', id: 'home', state: 'ready' }, path: '/fwos-screens/home?state=ready' });
    // Positive control: an app that doesn't start renders nothing, and says what it said.
    expect(r).toEqual({ ok: false, reason: 'the app stopped before it was up (exit 1): Error: POSTGRES_URL is not set' });
    // The miss: it was next dev with the screens browser on, not the production build the harness runs.
    const started = JSON.parse(readFileSync(join(root, 'apps/web/node_modules/next/dist/bin/argv.json'), 'utf8')) as { argv: string[]; screens: string };
    expect(started.argv.slice(0, 2)).toEqual(['dev', '--port']);
    expect(started.screens).toBe('1');
  });

  it('web/security rejects a known empty or undelivered policy and accepts an exported response policy', async () => {
    const csp = async (files: Record<string, string>) =>
      (
        (await web.checks
          .find((c) => c.id === 'web/security')!
          .run({ project: loadProject(tempProject({ 'apps/web/package.json': {}, 'apps/web/next.config.ts': 'export default {};', ...files })), adapters: adapterSet([web]) })) as CheckResult
      ).findings.map((f) => f.rule);
    const headers = (source: string, value: string) => `export default { headers: async () => [{ source: '${source}', headers: [{ key: 'Content-Security-Policy', value: ${value} }] }] };`;
    // Positive controls: no header, or an empty one written in place, fails; a policy passes.
    expect(await csp({})).toEqual(['csp']);
    expect(await csp({ 'apps/web/next.config.ts': headers('/:path*', "''") })).toEqual(['csp']);
    expect(await csp({ 'apps/web/next.config.ts': headers('/:path*', `"default-src 'self'"`) })).toEqual([]);
    // Negative controls: the same empty value through a variable, a header object nothing sends, a source
    // no page matches, and a header set on the request instead of the response.
    expect(await csp({ 'apps/web/next.config.ts': `const policy = '';\n${headers('/:path*', 'policy')}` })).toEqual(['csp']);
    expect(await csp({ 'apps/web/next.config.ts': `const unused = { 'Content-Security-Policy': "default-src 'self'" };\nexport default {};` })).toEqual(['csp']);
    expect(await csp({ 'apps/web/next.config.ts': headers('/nothing', `"default-src 'self'"`) })).toEqual(['csp']);
    expect(
      await csp({
        'apps/web/middleware.ts':
          "export function middleware(req) {\n  const requestHeaders = new Headers(req.headers);\n  requestHeaders.set('Content-Security-Policy', \"default-src 'self'\");\n  return NextResponse.next({ request: { headers: requestHeaders } });\n}",
      }),
    ).toEqual(['csp']);
  });

  it('before the accept step, a first-release AC that no test ran yet is pending, so traceability passes; from the accept step on it fails', async () => {
    const root = tempProject({
      'docs/app/spec.md': '## 10. Acceptance criteria\n### AC-x-1: a\n- Proven against: local\n### AC-x-2: b\n- Proven against: local\n',
      '.fwos/local/results/v.xml': '<testsuite><testcase classname="c" name="a @AC-x-1"/></testsuite>',
    });
    initProject(root);
    const traceability = async () => (await testChecks.find((c) => c.id === 'tests/traceability')!.run({ project: loadProject(root), adapters: adapterSet([]) })) as CheckResult;
    // Positive control: at the accept step, the AC no test ran fails.
    updateChange(root, (c) => void (c.step = 'accept'));
    syntheticTestRun(root);
    expect(await traceability()).toMatchObject({ status: 'fail', findings: [{ rule: 'AC-x-2' }] });
    // The miss: during the build it is pending, and the check passes while saying so.
    updateChange(root, (c) => void (c.step = 'build'));
    const during = await traceability();
    expect(during.status).toBe('pass');
    expect(during.info).toContain('not built yet (pending until acceptance): AC-x-2');
  });

  it('a hook payload that is not a JSON object gets no answer, so the edit goes through; fwos check still reads the files', () => {
    const root = tempProject({ 'apps/web/src/x.ts': '' });
    initProject(root);
    const main = join(__dirname, '../../plugin/shells/cli/main.ts');
    const hook = (input: string) => {
      const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', main, 'hook', 'pre-tool-use'], { cwd: root, input });
      return { code: r.status, out: r.stdout.toString() };
    };
    const write = JSON.stringify({ tool_name: 'Write', cwd: root, tool_input: { file_path: join(root, 'apps/web/src/x.ts') } });
    // Positive control: the edit, well formed, is denied before the spec is approved.
    expect(hook(write).out).toMatch(/"permissionDecision":"deny"/);
    // The miss: the same edit with a byte missing, or JSON that isn't an object, gets no answer.
    for (const input of [write.slice(0, -1), 'null', '[]']) expect(hook(input), input.slice(0, 20)).toEqual({ code: 0, out: '' });
  });

  it('the screen check reads the Next.js App Router; with no app/ folder screens/ia compares nothing and is off, saying why', async () => {
    const ia = { schema: 1, roles: ['user'], pages: [{ id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['ready'] }] };
    const run = async (files: Record<string, unknown>) =>
      (await screenChecks
        .find((c) => c.id === 'screens/ia')!
        .run({ project: loadProject(tempProject({ 'apps/web/package.json': {}, 'docs/app/ia.json': ia, ...files })), adapters: adapterSet([web]) })) as CheckResult;
    // Positive control: with an App Router app, a route ia.json lacks is caught.
    const appRouter = await run({ 'apps/web/app/page.tsx': '', 'apps/web/app/debug/page.tsx': '' });
    expect(appRouter.findings.map((f) => f.rule)).toEqual(['unexpected']);
    // The miss: the same app on the Pages Router is not read.
    const pagesRouter = await run({ 'apps/web/pages/index.tsx': '', 'apps/web/pages/debug.tsx': '' });
    expect(pagesRouter).toMatchObject({ status: 'off', reason: "web: no app found yet, so ia.json isn't compared with it" });
  });

  it("without a fresh run of fwos's IA harness, screens/ia can't see who a guarded page lets in, so while ia.json limits a page by role or flag it is off unless something else fails", async () => {
    const gated = { visibleTo: ['admin'], flag: 'members-enabled' };
    const run = async (page: string) =>
      (await iaCheck({
        'docs/app/ia.json': iaWith({ id: 'members', title: 'Members', route: '/members', kind: 'nav', states: ['ready'], ...gated }),
        'apps/web/app/layout.tsx': 'export default function L({ children }) { return <body><a href="/members">Members</a>{children}</body>; }',
        'apps/web/app/members/page.tsx': page,
      })) as CheckResult;
    // Positive control: a page that renders for everyone, with nothing in its route to turn anyone away, fails without a run.
    expect((await run('export default function M() { return <main>Members</main>; }')).findings.map((f) => f.rule)).toEqual(['ungated']);
    // The miss: guarded, by fwos's guard or a check of its own, it is off, naming it, until a run shows who it lets in.
    for (const page of [
      "import { guardPage } from '../../src/shared/session';\nexport default async function M() { await guardPage('members'); return <main>Members</main>; }",
      "import { notFound } from 'next/navigation';\nimport { isAdmin } from '../../src/session';\nexport default async function M() { if (!(await isAdmin())) notFound(); return <main>Members</main>; }",
    ]) {
      expect(await run(page)).toMatchObject({ status: 'off', reason: expect.stringMatching(/fwos's IA harness isn't in the app .*so who sees these isn't compared with the app: members \(admin, flag members-enabled\)$/) });
    }
  });

  it("fwos's IA harness opens static routes only, so who sees a page at a dynamic route is compared through its code alone", async () => {
    const ia: Ia = {
      schema: 1,
      roles: ['member', 'admin'],
      pages: [
        { id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['ready'] },
        { id: 'admin', title: 'Admin', route: '/admin', kind: 'unlinked', unlinkedReason: 'staff only', visibleTo: ['admin'], states: ['ready'] },
        { id: 'item', title: 'Item', route: '/items/[id]', kind: 'drilldown', parent: 'home', visibleTo: ['admin'], states: ['ready'] },
      ],
    };
    const guard = (id: string) => `import { guardPage } from '../../src/shared/session';\nexport default async function P() { await guardPage('${id}'); return null; }`;
    const root = tempProject({
      'apps/web/package.json': {},
      'docs/app/ia.json': ia,
      'apps/web/app/page.tsx': guard('home'),
      'apps/web/app/admin/page.tsx': guard('admin'),
      'apps/web/app/items/[id]/page.tsx': guard('item'),
    });
    installHarness(root);
    const check = async () => (await screenChecks.find((c) => c.id === 'screens/ia')!.run({ project: loadProject(root), adapters: adapterSet([web]) })) as CheckResult;
    // Positive control: a run that shows admin to a member fails; a faithful one shows who sees /admin.
    for (const r of iaRunPlan(ia).runs) {
      const run = faithfulRun(ia, r.role, r.flags);
      if (r.role === 'member') run.visits[1] = { ...run.visits[1]!, status: 200, notFound: false };
      recordRun(root, 'ia', r.key, run);
    }
    expect((await check()).findings.map((f) => f.rule)).toEqual(['exposed']);
    for (const r of iaRunPlan(ia).runs) recordRun(root, 'ia', r.key, faithfulRun(ia, r.role, r.flags));
    // The miss: /items/[id] is never opened, so who sees it stays off, named.
    expect(await check()).toMatchObject({ status: 'off', reason: expect.stringMatching(/but the harness opens static routes only, so who sees these isn't compared with the app: item \(admin\)$/) });
  });

  it("without a fresh run of fwos's IA harness, screens/ia reads the link paths in the code a route imports, not the rendered page, so a link that never renders still counts", async () => {
    const ia = iaWith({ id: 'settings', title: 'Settings', route: '/settings', kind: 'nav', states: ['ready'] });
    const files = (layout: string) => ({ 'docs/app/ia.json': ia, 'apps/web/app/layout.tsx': layout, 'apps/web/app/settings/page.tsx': '' });
    const never = 'export default function L({ children }) { return <body>{false && <a href="/settings">Settings</a>}{children}</body>; }';
    // Positive control: with no link to the nav page anywhere, it fails.
    expect(((await iaCheck(files('export default function L({ children }) { return <body>{children}</body>; }'))) as CheckResult).findings.map((f) => f.rule)).toEqual(['no-link']);
    // And with a run of the app, the rendered nav decides: the link that never renders is missing.
    const root = tempProject({ 'apps/web/package.json': {}, 'apps/web/app/page.tsx': '', ...files(never) });
    installHarness(root);
    for (const r of iaRunPlan(ia as Ia).runs) recordRun(root, 'ia', r.key, { ...faithfulRun(ia as Ia, r.role, r.flags), nav: [] });
    const withRun = (await screenChecks.find((c) => c.id === 'screens/ia')!.run({ project: loadProject(root), adapters: adapterSet([web]) })) as CheckResult;
    expect(withRun.findings.map((f) => f.rule)).toEqual(['no-link', 'no-link']);
    // The miss: without a run, the link behind a condition that is never true counts.
    expect(((await iaCheck(files(never))) as CheckResult).status).toBe('pass');
  });
});

describe('trust (who did what is not proven)', () => {
  it('approvals are not authenticated: `fwos approve spec --by "<name>"` works from any shell and records the name it is given', () => {
    const root = tempProject({ 'docs/app/spec.md': '# Spec\n', 'docs/app/test-plan.md': '# Test plan\n' });
    initProject(root);
    // Positive control: an approval needs a name, and records the spec's hash.
    expect(fwos(root, 'approve', 'spec').code).toBe(2);
    expect(fwos(root, 'approve', 'spec', '--by', ' ').code).toBe(2);
    expect(approvalState(loadProject(root), 'spec').status).toBe('missing');
    // The miss: any name is taken as given; nothing checks who ran the command.
    expect(fwos(root, 'approve', 'spec', '--by', 'anyone').code).toBe(0);
    expect(approvalState(loadProject(root), 'spec').status).toBe('approved');
    expect(listChanges(root).at(-1)!.approvals.spec).toMatchObject({ by: 'anyone', via: 'chat' });
  });
});

describe('platforms', () => {
  it('phone apps are not supported: `fwos init --platforms ios` is refused', () => {
    // Positive control: a supported platform starts a project.
    const ok = tempProject();
    expect(fwos(ok, 'init', '--platforms', 'web').code).toBe(0);
    expect(existsSync(join(ok, '.fwos/state.json'))).toBe(true);
    // The limit.
    const phone = tempProject();
    const r = fwos(phone, 'init', '--platforms', 'ios');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Unknown platform: ios\..*\n.*Phone apps aren't supported/);
    expect(existsSync(join(phone, '.fwos'))).toBe(false);
  });
});

describe('trust (what fwos takes as given)', () => {
  it("before acceptance, traceability can read unbound JUnit; at acceptance, current input/result bindings are required; a run record of fwos's harness, or of your tests through `fwos tests run`, counts only for the code it ran on, but a shell command can write one", async () => {
    const spec = '## 10. Acceptance criteria\n### AC-x-1: a\n- Proven against: local\n';
    const run = async (xml: string) => {
      const root = tempProject({ 'docs/app/spec.md': spec, '.fwos/local/results/v.xml': xml });
      return (await testChecks.find((c) => c.id === 'tests/traceability')!.run({ project: loadProject(root), adapters: adapterSet([]) })) as CheckResult;
    };
    // Positive control: a failing result fails the AC.
    expect((await run('<testsuite><testcase classname="c" name="a @AC-x-1"><failure message="no"/></testcase></testsuite>')).status).toBe('fail');
    // The limit: a file nobody's test run wrote proves it just the same.
    expect((await run('<testsuite><testcase classname="c" name="written by hand @AC-x-1"/></testsuite>')).status).toBe('pass');
    // A page state needs a run record of fwos's harness as well, bound to the code it ran on.
    const ia = { schema: 1, roles: ['user'], pages: [{ id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['empty'] }] };
    const root = tempProject({ 'apps/web/package.json': {}, 'docs/app/ia.json': ia, '.fwos/local/results/v.xml': '<testsuite><testcase classname="c" name="written by hand @state:home:empty"/></testsuite>' });
    installHarness(root);
    const states = async () => ((await screenChecks.find((c) => c.id === 'screens/states')!.run({ project: loadProject(root), adapters: adapterSet([web]) })) as CheckResult).status;
    // Positive control: a hand-written tag alone shows nothing rendering, and a record of older code doesn't count.
    expect(await states()).toBe('fail');
    recordRun(root, 'states', 'page.home', [seen('empty', { statuses: ['Nothing yet'] })]);
    writeFiles(root, { 'apps/web/app/page.tsx': 'export default function P() { return null; }\n' });
    expect(await states()).toBe('fail');
    // The limit: a record written for the code as it is now counts, whoever wrote it. The edit tools can't write one (see the hooks), a shell can.
    recordRun(root, 'states', 'page.home', [seen('empty', { statuses: ['Nothing yet'] })]);
    expect(await states()).toBe('pass');
    // A run of your tests says which results a browser wrote, the same way.
    const app = tempProject({ 'apps/web/app/page.tsx': 'export default function P() { return null; }\n', '.fwos/local/results/e2e.xml': '<testsuite><testcase name="synthetic browser result"/></testsuite>' });
    const e2e = { script: 'e2e', dir: '.', display: 'pnpm e2e', command: 'playwright test', runner: 'Playwright', browser: true, mapped: true, exit: 0, results: ['.fwos/local/results/e2e.xml'], cases: { passed: 1, failed: 0, skipped: 0 } };
    const ran = () => recordTestRun(loadProject(app), e2e, { revision: revisionOf(loadProject(app)), at: '2026-10-23T00:00:00.000Z', command: 'pnpm run e2e' });
    const seenInBrowser = () => browserResults(loadProject(app)).has('.fwos/local/results/e2e.xml');
    // Positive control: a run of older code says nothing about this code.
    ran();
    writeFiles(app, { 'apps/web/app/page.tsx': 'export default function P() { return 1; }\n' });
    expect(seenInBrowser()).toBe(false);
    // The limit: one written for the code as it is now counts, whoever wrote it.
    ran();
    expect(seenInBrowser()).toBe(true);
  });

  it("fwos's IA harness opens the app as each role through a test cookie the app honours only while FWOS_TEST_ACCESS=1, so a run proves what the app shows that identity, not your sign-in", () => {
    const template = (rel: string) => readFileSync(join(__dirname, '../../plugin/modules/screens/templates/web/apps/web', rel), 'utf8');
    const ia = verify.harness!(loadProject(tempProject())).find((h) => h.kind === 'ia')!.content;
    // Positive control: the harness sets the cookie, and the scaffold's session reads it only in that mode.
    expect(ia).toContain('context.addCookies([{ name: plan.cookie');
    expect(template('src/shared/session/session.ts')).toMatch(/if \(testAccess\(\)\) \{\n\s+const asked = parseTestAccess\(\(await cookies\(\)\)\.get\(TEST_ACCESS_COOKIE\)\?\.value\);/);
    expect(template('playwright.config.ts')).toContain("env: { FWOS_SCREENS: '1', FWOS_TEST_ACCESS: '1' }");
    // The limit: past the cookie, sign-in itself is never run; currentAccess's default stands in for it.
    expect(template('src/shared/session/session.ts')).toMatch(/return defaultAccess;/);
  });

  it('with an unreadable .fwos/ file the edit hooks close app source and test files and leave the broken file, docs and the design system open for the repair; fwos check fails closed', () => {
    for (const [broken, text] of [['.fwos/changes/0002-x.json', '{'], ['.fwos/state.json', '{bad']] as const) {
      const root = tempProject({ 'apps/web/src/x.ts': 'export {};', 'e2e/a.spec.ts': 'x', 'docs/app/spec.md': 's', 'docs/app/test-plan.md': 't' });
      initProject(root);
      approve(loadProject(root), 'spec', 'Ada');
      const write = (rel: string) => dispatch('pre-tool-use', { tool_name: 'Write', cwd: root, tool_input: { file_path: join(root, rel), content: 'x' } }).stdout;
      // Positive control: with readable state and the spec approved, app source and tests are open.
      expect(write('apps/web/src/x.ts'), broken).toBe('');
      expect(write('e2e/a.spec.ts'), broken).toBe('');
      // The limit: fwos can't tell what is approved or locked, so it treats the spec as unapproved
      // and every test as locked until the file reads again.
      writeFileSync(join(root, broken), text);
      for (const rel of ['apps/web/src/x.ts', 'e2e/a.spec.ts']) expect(write(rel), `${broken}: ${rel}`).toMatch(/"permissionDecision":"deny".*state\/unreadable\]: fwos couldn't read its state/);
      for (const rel of [broken, 'docs/app/brief.md', 'design-system/tokens/light.json']) {
        const out = write(rel);
        expect(out, `${broken}: ${rel}`).not.toMatch(/permissionDecision/);
        expect(out.match(/couldn't read its state/g), `${broken}: ${rel} warns once`).toHaveLength(1);
      }
      // Only the broken file opens: the records that read stay closed.
      expect(write(broken === '.fwos/state.json' ? '.fwos/changes/0001-initial.json' : '.fwos/state.json'), broken).toMatch(/state\/records/);
      expect(fwos(root, 'check').code, broken).toBe(1);
    }
  });
});

describe('flags too much (harmless)', () => {
  it('a click counts as acting when it changes the address, the page or focus, or opens a window, so a row whose click only sends a request fails as a dead hit area', () => {
    const states = verify.harness!(loadProject(tempProject())).find((h) => h.kind === 'states')!.content;
    const verdict = (click: string) => judgeStates([seen('ready', { hits: [{ text: 'Dune', paints: ['cursor: pointer'], controls: [], click }] })])[0]!.verdict;
    // Positive control: a row whose click changed the page acts.
    expect(verdict('changed the page')).toBe('ok');
    // What the harness counts: an address, a change on the page, focus, a window. A request alone shows none of them, so it records "nothing".
    expect(states).toContain("if (watch.changed) return 'changed the page';");
    expect(states).toContain("click = 'opened a window';");
    expect(verdict('nothing')).toBe('violation');
  });

  it('an import resolved only by a bundler alias, not tsconfig, is reported unresolved', () => {
    const project = (tsconfig: object) => {
      const root = tempProject({
        'package.json': { name: 'app' },
        'tsconfig.json': tsconfig,
        'docs/app/modules.json': { schema: 1, modules: [{ name: 'a', path: 'src/a', dependsOn: [] }, { name: 'b', path: 'src/b', dependsOn: [] }] },
        'src/a/index.ts': "import { b } from '~/b';\nexport const a = b;",
        'src/b/index.ts': 'export const b = 1;',
      });
      const p = loadProject(root);
      p.paths.source = ['src/**'];
      return runWalls(p).findings.map((f) => f.rule);
    };
    // Positive control: with the alias in tsconfig, the import resolves and the wall applies.
    expect(project({ compilerOptions: { paths: { '~/*': ['./src/*'] } } })).toEqual(['dependency']);
    // The over-flag: the same alias set only in a bundler config.
    expect(project({})).toEqual(['unresolved']);
  });

  it("without a fresh run of fwos's IA harness, screens/ia reads link paths written in the code, so a nav page linked only through a path built from data fails; a nav read from ia.json counts", async () => {
    const run = async (layout: string, files: Record<string, string> = {}) =>
      (await iaCheck({
        'docs/app/ia.json': iaWith({ id: 'settings', title: 'Settings', route: '/settings', kind: 'nav', states: ['ready'] }),
        'apps/web/app/layout.tsx': layout,
        'apps/web/app/settings/page.tsx': '',
        ...files,
      })) as CheckResult;
    // Positive controls: a literal path in a nav list, and a nav built from ia.json, as the scaffold's is.
    expect((await run("const NAV = [{ href: '/settings', label: 'Settings' }];\nexport default function L({ children }) { return <body>{NAV.map((n) => <a href={n.href}>{n.label}</a>)}{children}</body>; }")).status).toBe('pass');
    const fromIa = "import ia from '../../../docs/app/ia.json';\nexport default function L({ children }) { return <body>{ia.pages.map((p) => <a href={p.route}>{p.title}</a>)}{children}</body>; }";
    expect((await run(fromIa)).status).toBe('pass');
    // The over-flag: the same link, its path read from an API.
    const fromApi = "export default async function L({ children }) { const nav = await (await fetch(process.env.NAV_URL)).json(); return <body>{nav.map((n) => <a href={n.url}>{n.label}</a>)}{children}</body>; }";
    expect((await run(fromApi)).findings.map((f) => f.rule)).toEqual(['no-link']);
    // A run of the app reads the rendered nav, which has the link: it passes.
    const ia = iaWith({ id: 'settings', title: 'Settings', route: '/settings', kind: 'nav', states: ['ready'] }) as Ia;
    const root = tempProject({ 'apps/web/package.json': {}, 'apps/web/app/page.tsx': '', 'docs/app/ia.json': ia, 'apps/web/app/layout.tsx': fromApi, 'apps/web/app/settings/page.tsx': '' });
    installHarness(root);
    for (const r of iaRunPlan(ia).runs) recordRun(root, 'ia', r.key, faithfulRun(ia, r.role, r.flags));
    expect(((await screenChecks.find((c) => c.id === 'screens/ia')!.run({ project: loadProject(root), adapters: adapterSet([web]) })) as CheckResult).status).toBe('pass');
  });

  it('a string that is exactly a short hex value, such as "#add", reads as a colour unless it is the value of href, to, id or key; `// fwos-ignore tokens` silences it', () => {
    // Positive control: as the value of href, the anchor is not read as a colour.
    expect(scanRawValues('a.tsx', "const link = { href: '#add' };")).toEqual([]);
    // The over-flag: the same string anywhere else.
    expect(scanRawValues('a.tsx', "const anchor = '#add';").map((f) => f.rule)).toEqual(['raw-color']);
    expect(scanRawValues('a.tsx', "const anchor = '#add'; // fwos-ignore tokens")).toEqual([]);
  });

  it("a style object's font size, font or radius string is read as CSS, so a CSS-in-JS theme key such as fontSize: 'md' is flagged; `// fwos-ignore tokens` silences it", () => {
    // Positive control: a token in the same place is fine.
    expect(scanRawValues('a.tsx', "const s = { fontSize: 'var(--ds-type-body-size)' };")).toEqual([]);
    // The over-flag: a theme key, which only a CSS-in-JS library would resolve.
    expect(scanRawValues('a.tsx', "const s = { fontSize: 'md', borderRadius: 'md' };").map((f) => f.rule)).toEqual(['raw-size', 'raw-radius']);
    expect(scanRawValues('a.tsx', "const s = { fontSize: 'md' }; // fwos-ignore tokens")).toEqual([]);
  });
});

describe('prototype bundles', () => {
  const home = { id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['ready'] };
  const members = { id: 'members', title: 'Members', route: '/members', kind: 'nav', visibleTo: ['admin'], states: ['ready'] };
  const IA = { schema: 1, roles: ['member', 'admin'], pages: [home, members] };
  const bundle = (over: object = {}) => ({
    schema: 1,
    id: 'members',
    title: 'Members',
    pages: ['members'],
    visual: [{ kind: 'html', ref: 'docs/app/prototypes/members/prototype.html' }],
    companion: [{ kind: 'route', page: 'members', ref: '/fwos-screens/members' }],
    states: 'docs/app/prototypes/members/states.md',
    spec: 'docs/app/spec.md',
    ia: 'docs/app/prototypes/members/ia.json',
    ...over,
  });
  const project = (over: Record<string, unknown> = {}) =>
    tempProject({
      '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'new', platforms: ['web'] },
      'apps/web/package.json': { name: 'web' },
      'apps/web/app/page.tsx': "await guardPage('home');\n",
      'apps/web/app/members/page.tsx': "await guardPage('members');\n",
      'docs/app/ia.json': IA,
      'docs/app/spec.md': '# Spec\n',
      'docs/app/prototypes/members/bundle.json': bundle(),
      'docs/app/prototypes/members/ia.json': IA,
      'docs/app/prototypes/members/states.md': '## members\n- ready: the table\n',
      'docs/app/prototypes/members/prototype.html': '<p>Members</p>\n',
      ...over,
    });
  const problems = (root: string) => JSON.parse(fwos(root, 'prototype', 'check', '--json').out).bundles[0].problems as string[];

  it("checks a visual artifact is linked, not that the app looks like it", () => {
    // Positive control: a visual in a working/ draft is refused.
    expect(problems(project({ 'docs/app/prototypes/members/bundle.json': bundle({ visual: [{ kind: 'html', ref: 'working/members.html' }] }), 'working/members.html': '<p>draft</p>\n' }))).toEqual([
      "visual working/members.html is in working/: a promoted bundle can't rest on a draft",
    ]);
    // The miss: a visual that looks nothing like the app passes.
    expect(problems(project({ 'docs/app/prototypes/members/prototype.html': '<h1>A different product altogether</h1>\n' }))).toEqual([]);
  });

  it('checks a companion as a link to a page the bundle covers, not that it renders', () => {
    // Positive control: a page with no companion is refused.
    expect(problems(project({ 'docs/app/prototypes/members/bundle.json': bundle({ companion: [] }) }))[0]).toMatch(/^members has no real-component companion/);
    // The miss: a companion route nothing in the app serves passes; screens/states is what shows it renders.
    expect(problems(project({ 'docs/app/prototypes/members/bundle.json': bundle({ companion: [{ kind: 'route', page: 'members', ref: '/fwos-screens/nowhere' }] }) }))).toEqual([]);
  });

  it('compares who sees what as the last runs of the IA harness saw it, so a route no run opened, and a redirect page, are not compared', async () => {
    const { compareWithApp } = await import('../../plugin/modules/screens/index.ts');
    const routes = [
      { route: '/', file: 'apps/web/app/page.tsx', devOnly: false, id: 'home' },
      { route: '/members', file: 'apps/web/app/members/page.tsx', devOnly: false, id: 'members' },
      { route: '/team', file: 'apps/web/app/team/page.tsx', devOnly: false, id: 'team' },
    ];
    const run = (role: string): IaRun => ({ role, flags: [], applied: true, nav: ['/', '/members'], visits: [home, members].map((p) => ({ page: p.id, path: p.route, status: 200, finalPath: p.route, notFound: false })) });
    const intended = { ...IA, pages: [home, members, { id: 'team', title: 'Team', route: '/team', kind: 'drilldown', parent: 'home', states: ['ready'] }, { id: 'old', title: 'Old', route: '/old', kind: 'redirect', redirectTo: 'home', states: ['ready'] }] } as Ia;
    const d = compareWithApp(intended, { routes, runs: [run('member'), run('admin')] });
    // Positive control: members, which the intent shows only to admin, opened for member in a run.
    expect(d.changes.map((c) => `${c.kind} ${c.id}`)).toEqual(['hidden members']);
    // The miss: no run opened /team, which only the bundle's IA lists, and the redirect page isn't compared at all.
    expect(d.notCompared).toEqual(["/team: no run of fwos's IA harness opened it (it opens the routes the project's ia.json lists), so who sees it isn't compared"]);
  });

  it('a promotion needs git to hold each input as it is, not that the commit was pushed or reviewed, and records the name it is given', () => {
    const root = project();
    // Positive control: an input git doesn't hold is refused.
    execFileSync('git', ['init', '-q'], { cwd: root });
    expect(fwos(root, 'prototype', 'promote', 'members', '--by', 'Ada')).toMatchObject({ code: 2, err: expect.stringContaining('commit these first') });
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=x', '-c', 'user.email=x@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'bundle', '--no-verify'], { cwd: root });
    // The miss: committed locally, by whatever name it is given.
    expect(fwos(root, 'prototype', 'promote', 'members', '--by', 'Anyone at all')).toMatchObject({ code: 0 });
    expect(JSON.parse(readFileSync(join(root, '.fwos/prototypes.json'), 'utf8')).bundles.members.by).toBe('Anyone at all');
  });
});
