// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadProject, pluginPath, pluginVersion, revisionOf, walkFiles, writeText } from '../../../kernel/index.ts';
import { fingerprintsOf } from '../../../modules/state/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { COMMANDS, FLAGS, type Io, preCommitHook } from '../commands.ts';
import { main, parseArgs } from '../main.ts';
import { runChecks } from '../runner.ts';
import { dispatch } from '../../hooks/index.ts';

afterAll(cleanupTempProjects);

async function fwos(cwd: string, ...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (...l) => out.push(...l), err: (...l) => err.push(...l), cwd };
  const code = await main(argv, io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/**
 * The test results a run would leave under .fwos/ that git doesn't ignore. It writes a file
 * wherever a test config sends results under .fwos/, as the run would, then asks git status.
 */
function unignoredResults(root: string): string[] {
  for (const config of walkFiles(root, { include: ['**/*.config.{js,cjs,mjs,ts,cts,mts}'] })) {
    const text = readFileSync(join(root, config), 'utf8');
    for (const [, out] of text.matchAll(/['"]([^'"\n]*\.fwos\/[^'"\n]*)['"]/g)) writeText(join(root, dirname(config), out!), '<testsuites/>\n');
  }
  return execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', '.fwos'], { cwd: root }).toString().split('\n').filter(Boolean);
}

describe('parseArgs', () => {
  it('splits positionals and flags', () => {
    expect(parseArgs(['approve', 'brief', '--by', 'Example Owner', '--json', '--via=pr'])).toEqual({
      command: 'approve',
      args: { positionals: ['brief'], flags: { by: 'Example Owner', json: true, via: 'pr' } },
      dashed: [],
    });
    // A single-dash word is set aside as a typo; after `--` it's a positional, and a flag's value stays one.
    expect(parseArgs(['status', '-json'])).toMatchObject({ command: 'status', dashed: ['-json'] });
    expect(parseArgs(['change', 'new', '--', '-x'])).toMatchObject({ args: { positionals: ['new', '-x'] }, dashed: [] });
    expect(parseArgs(['change', 'spend', '--usd', '-5'])).toMatchObject({ args: { flags: { usd: '-5' } }, dashed: [] });
  });

  it('treats known boolean flags as booleans even before a positional', () => {
    expect(parseArgs(['tests', 'lock', '--red', 'a.test.ts']).args).toEqual({ positionals: ['lock', 'a.test.ts'], flags: { red: true } });
  });
});

describe('the flow, start to finish, through the CLI', () => {
  it('walks every gate', async () => {
    const root = tempProject({});
    expect((await fwos(root, 'next', '--json')).out).toContain('"skill": "fwos:start"');
    expect((await fwos(root, 'init', '--name', 'Reading list')).code).toBe(0);
    expect((await fwos(root, 'init')).code).toBe(2);

    let next = JSON.parse((await fwos(root, 'next', '--json')).out);
    expect(next.step).toBe('discovery');
    expect(next.skill).toBe('fwos:discovery');

    // Can't approve a brief that doesn't exist, and can't jump ahead.
    expect((await fwos(root, 'approve', 'brief', '--by', 'Ada')).err).toMatch(/doesn't exist yet/);
    expect((await fwos(root, 'step', 'research')).err).toMatch(/brief is absent/);

    writeText(join(root, 'docs/app/brief.md'), '# Brief\n- Offline: [ASSUMED] reads offline\n');
    expect((await fwos(root, 'approve', 'brief', '--by', 'Ada')).code).toBe(0);
    next = JSON.parse((await fwos(root, 'next', '--json')).out);
    expect(next.action).toMatch(/fwos step research/);
    expect((await fwos(root, 'step', 'research')).code).toBe(0);

    // Required approvals can't be skipped; optional ones can, with a reason.
    expect((await fwos(root, 'skip', 'brief', '--reason', 'x', '--by', 'Ada')).err).toMatch(/can't be skipped/);
    for (const t of ['research', 'architecture', 'design-system', 'screens']) {
      expect((await fwos(root, 'skip', t, '--reason', 'fixture', '--by', 'Ada')).code).toBe(0);
    }
    expect((await fwos(root, 'step', 'spec')).code).toBe(0);
    expect((await fwos(root, 'step', 'build')).err).toMatch(/spec is absent/);

    writeText(join(root, 'docs/app/spec.md'), '# Spec\n');
    writeText(join(root, 'docs/app/test-plan.md'), '# Plan\n');
    expect((await fwos(root, 'approve', 'spec', '--by', 'Ada')).code).toBe(0);
    expect((await fwos(root, 'step', 'build')).code).toBe(0);

    // A hand edit makes the approval stale, and next routes back.
    writeText(join(root, 'docs/app/brief.md'), '# Brief\nchanged\n');
    next = JSON.parse((await fwos(root, 'next', '--json')).out);
    expect(next.blocked[0]).toMatchObject({ target: 'brief', status: 'stale' });
    expect(next.action).toMatch(/brief changed after it was approved/);
    const status = await fwos(root, 'status');
    expect(status.out).toMatch(/brief\s+STALE/);

    // Going back is always allowed.
    expect((await fwos(root, 'step', 'discovery')).code).toBe(0);
    expect((await fwos(root, 'approve', 'brief', '--by', 'Ada')).code).toBe(0);
    expect((await fwos(root, 'step', 'build')).code).toBe(0);
  });

  it('says which earlier change is still open when a new one starts', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    const r = await fwos(root, 'change', 'new', 'Fix the copy', '--route', 'code-only');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Created change 0002-fix-the-copy/);
    expect(r.out).toMatch(/0001-initial \(step discovery\) is still open\. fwos works on 0002-fix-the-copy now/);
    expect((await fwos(root, 'change', 'new', 'More', '--route', 'code-only')).out).toMatch(/0001-initial \(step discovery\) and 0002-fix-the-copy \(step build\) are still open/);
    // Positive control: with every earlier change closed, there is nothing to say.
    const done = tempProject({});
    await fwos(done, 'init');
    writeText(join(done, '.fwos/changes/0001-initial.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(done, '.fwos/changes/0001-initial.json'), 'utf8')), status: 'done', step: 'done' }));
    expect((await fwos(done, 'change', 'new', 'Fix the copy', '--route', 'code-only')).out).not.toMatch(/still open/);
  });

  it('starts later changes at the route entry step and inherits approvals', async () => {
    const root = tempProject({ 'docs/app/brief.md': 'b', 'docs/app/spec.md': 's', 'docs/app/test-plan.md': 't' });
    await fwos(root, 'init');
    await fwos(root, 'approve', 'brief', '--by', 'Ada');
    await fwos(root, 'approve', 'spec', '--by', 'Ada');
    for (const t of ['research', 'architecture', 'design-system', 'screens']) await fwos(root, 'skip', t, '--reason', 'r', '--by', 'Ada');
    expect((await fwos(root, 'change', 'new', 'Add a filter', '--route', 'nope')).code).toBe(2);
    const r = await fwos(root, 'change', 'new', 'Add a filter', '--route', 'touches-ac');
    expect(r.out).toMatch(/0002-add-a-filter \(route touches-ac, enters at spec\)/);
    const next = JSON.parse((await fwos(root, 'next', '--json')).out);
    expect(next.change.id).toBe('0002-add-a-filter');
    expect(next.blocked).toEqual([]);
    expect((await fwos(root, 'change', 'list')).out.split('\n')).toHaveLength(2);
  });
});

describe('check', () => {
  it('exits 1 on a failure, 0 when clean, and stops everything when a gate fails', async () => {
    const root = tempProject({ 'apps/web/src/a.tsx': '<div className="bg-red-500" />' });
    await fwos(root, 'init');
    const bad = await fwos(root, 'check', 'tokens');
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/FAIL\s+design-system\/tokens/);
    expect(bad.out).toMatch(/NOT VERIFIED/);
    writeText(join(root, 'apps/web/src/a.tsx'), '<div className="bg-surface" />');
    expect((await fwos(root, 'check', 'tokens')).code).toBe(0);
    writeText(join(root, '.fwos/state.json'), JSON.stringify({ schema: 7, pluginVersion: 'x', mode: 'new', platforms: ['web'] }));
    const gated = JSON.parse((await fwos(root, 'check', '--json')).out) as { results: { id: string; status: string; reason?: string }[] };
    const stopped = gated.results.filter((r) => !['state/schema', 'design-system/schema'].includes(r.id));
    expect(stopped.length).toBeGreaterThan(15);
    for (const r of stopped) {
      expect(r.status, r.id).toBe('off');
      expect(r.reason, r.id).toMatch(/stopped: state\/schema failed/);
    }
  });

  it('fails screens/ia on a nav page with no link and on a limited page nothing guards, and is off for what only a run can show', async () => {
    // The route-visibility fixture: /members is a nav page for admin behind members-enabled, the
    // home page has no navigation, and the members page renders for everyone.
    const ia = {
      schema: 1,
      roles: ['member', 'admin'],
      flags: ['members-enabled'],
      pages: [
        { id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['ready'] },
        { id: 'members', title: 'Members', route: '/members', kind: 'nav', visibleTo: ['admin'], flag: 'members-enabled', states: ['ready'] },
      ],
    };
    const root = tempProject({
      'docs/app/ia.json': ia,
      'apps/web/package.json': { name: 'web' },
      'apps/web/app/page.tsx': 'export default function Home() { return <main>Home</main>; }\n',
      'apps/web/app/members/page.tsx': 'export default function Members() { return <main>Members</main>; }\n',
    });
    await fwos(root, 'init');
    const gaps = await fwos(root, 'check', 'screens/ia');
    expect(gaps.code).toBe(1);
    expect(gaps.out).toMatch(/FAIL\s+screens\/ia\s+2 findings\n/);
    expect(gaps.out).toMatch(/docs\/app\/ia\.json {2}web: nav page "members" \(\/members\) has no link to it in the app/);
    expect(gaps.out).toMatch(/apps\/web\/app\/members\/page\.tsx {2}web: "members" \(\/members\) is for admin with members-enabled on, but nothing in its route can turn anyone away/);
    // With a real link, the page that renders for everyone still fails.
    writeText(join(root, 'apps/web/app/layout.tsx'), "import Link from 'next/link';\nexport default function L({ children }) { return <body><Link href=\"/members\">Members</Link>{children}</body>; }\n");
    const open = JSON.parse((await fwos(root, 'check', 'screens/ia', '--json')).out).results.find((r: { id: string }) => r.id === 'screens/ia');
    expect(open.findings.map((f: { rule: string }) => f.rule)).toEqual(['ungated']);
    // Guarded, who sees it is what only a run of the app shows: off, naming it, not a pass.
    writeText(join(root, 'apps/web/app/members/page.tsx'), "import { guardPage } from '../../src/shared/session';\nexport default async function Members() { await guardPage('members'); return <main>Members</main>; }\n");
    const gating = JSON.parse((await fwos(root, 'check', 'screens/ia', '--json')).out).results.find((r: { id: string }) => r.id === 'screens/ia');
    expect(gating).toMatchObject({ status: 'off', reason: expect.stringMatching(/fwos's IA harness isn't in the app \(apps\/web\/e2e\/fwos-ia\.spec\.ts; `fwos harness` writes it\), so who sees these isn't compared with the app: members \(admin, flag members-enabled\)$/) });
  });

  it('says NOT VERIFIED (spike mode) and exits 1 in a spike, for check, --json, --staged and report', async () => {
    const root = tempProject({ 'apps/web/src/a.tsx': '<div className="bg-red-500" />' });
    execFileSync('git', ['init', '-q'], { cwd: root });
    await fwos(root, 'init', '--mode', 'spike');
    const text = await fwos(root, 'check');
    expect(text.code).toBe(1);
    expect(text.out).toMatch(/NOT VERIFIED \(spike mode\)/);
    const json = await fwos(root, 'check', '--json');
    expect(json.code).toBe(1);
    expect(JSON.parse(json.out)).toMatchObject({ results: [], exit: 1, mode: 'spike', reason: expect.stringMatching(/NOT VERIFIED \(spike mode\)/) });
    execFileSync('git', ['add', '-A'], { cwd: root });
    expect(await fwos(root, 'check', '--staged')).toMatchObject({ code: 1, out: expect.stringMatching(/NOT VERIFIED \(spike mode\)/) });
    const report = await fwos(root, 'report');
    expect(report).toMatchObject({ code: 1, out: expect.stringMatching(/NOT VERIFIED \(spike mode\)/) });
    expect(JSON.parse((await fwos(root, 'report', '--json')).out)).toMatchObject({ exit: 1, mode: 'spike' });
    expect(existsSync(join(root, 'docs/app/reports/acceptance.md'))).toBe(false);
  });

  it('fails state/schema when state.json names no platform it knows, so a typo never runs zero checks and passes', async () => {
    for (const platforms of [[], ['webb']]) {
      const root = tempProject({});
      execFileSync('git', ['init', '-q'], { cwd: root });
      await fwos(root, 'init');
      const state = JSON.parse(readFileSync(join(root, '.fwos/state.json'), 'utf8'));
      writeText(join(root, '.fwos/state.json'), JSON.stringify({ ...state, platforms }));
      const r = await fwos(root, 'check');
      expect(r.code, JSON.stringify(platforms)).toBe(1);
      expect(r.out, JSON.stringify(platforms)).toMatch(/FAIL\s+state\/schema/);
      expect(JSON.parse((await fwos(root, 'check', '--json')).out).exit, JSON.stringify(platforms)).toBe(1);
      expect((await fwos(root, 'check', '--staged')).code, JSON.stringify(platforms)).toBe(1);
    }
  });

  it('fails state/schema on a .fwos/ file that is not valid JSON, naming it, and stops the rest (exit 1)', async () => {
    for (const [rel, text] of [['.fwos/changes/0002-x.json', '{'], ['.fwos/state.json', '{bad']] as const) {
      const root = tempProject({});
      await fwos(root, 'init');
      writeText(join(root, rel), text);
      const r = await fwos(root, 'check');
      expect(r.code, rel).toBe(1);
      expect(r.out, rel).toMatch(new RegExp(`FAIL\\s+state/schema\\s+1 finding\\n\\s+${rel.replace(/\./g, '\\.')}  is not valid JSON: `));
      expect(r.out, rel).not.toMatch(/crashed|FwosError|\n\s+at /);
      const json = JSON.parse((await fwos(root, 'check', '--json')).out) as { results: { id: string; status: string }[]; exit: number };
      expect(json.exit, rel).toBe(1);
      expect(json.results.filter((x) => x.status !== 'off').map((x) => `${x.id}:${x.status}`), rel).toEqual(['state/schema:fail']);
      // The report is built from those records, so it isn't written while they can't be read.
      const report = await fwos(root, 'report');
      expect(report, rel).toMatchObject({ code: 1, out: expect.stringMatching(/isn't written while state\/schema fails/) });
      expect(existsSync(join(root, 'docs/app/reports/acceptance.md')), rel).toBe(false);
    }
  });

  it('names a broken record or doc a check reads, with no stack trace and no absolute path', async () => {
    const slice = { schema: 1, slice: 'S1', change: '0001-initial', title: 'x', platform: 'web', modules: ['list'], screens: [], components: [], states: [], acs: ['AC-list-1'], status: 'planned' };
    for (const rel of ['.fwos/quarantine.json', 'docs/app/modules.json']) {
      // A slice, a spec and a test result, so build/slices reads both files.
      const root = tempProject({
        '.fwos/slices/0001-initial/S1.json': slice,
        'docs/app/spec.md': '### AC-list-1: Save\n- Proven against: local\n',
        '.fwos/local/results/v.xml': '<testsuite><testcase classname="x" name="saves @AC-list-1"/></testsuite>',
      });
      await fwos(root, 'init');
      writeText(join(root, rel), '[{"file": ');
      const r = await fwos(root, 'check');
      expect(r.out, rel).toMatch(new RegExp(`FAIL\\s+build/slices\\s+${rel.replace(/\./g, '\\.')} is not valid JSON: `));
      expect(r.out, rel).not.toMatch(/crashed|FwosError|\n\s+at |fwos\.mjs|main\.ts|\.ts:\d/);
      expect(r.out, rel).not.toContain(root);
    }
  });

  it('refuses a change file that is not a change record, naming it, instead of crashing', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    writeText(join(root, '.fwos/changes/0002-x.json'), '[]');
    for (const cmd of [['status'], ['next'], ['change', 'list']]) {
      const r = await fwos(root, ...cmd);
      expect(r, cmd.join(' ')).toMatchObject({ code: 2, err: expect.stringMatching(/^fwos: \.fwos\/changes\/0002-x\.json isn't a change record/) });
      expect(r.err, cmd.join(' ')).not.toMatch(/unexpected error|TypeError|\n\s+at /);
    }
    expect((await fwos(root, 'check')).out).toMatch(/FAIL\s+state\/schema/);
  });

  it('writes a deterministic acceptance report', async () => {
    const root = tempProject({ 'docs/app/spec.md': '### AC-x-1: a\n- Proven against: local\n', '.fwos/local/results/v.xml': '<testsuite><testcase classname="c" name="a @AC-x-1"/></testsuite>' });
    await fwos(root, 'init');
    const first = await fwos(root, 'report');
    const report = readFileSync(join(root, 'docs/app/reports/acceptance.md'), 'utf8');
    expect(report).toContain('| AC-x-1 | a | PROVEN | local |');
    expect(first.out).toMatch(/Wrote docs\/app\/reports\/acceptance.md/);
    expect((await fwos(root, 'report')).out).toMatch(/Unchanged: docs\/app\/reports\/acceptance.md/);
  });
});

describe('design system, tokens and baseline commands', () => {
  it('writes the starter, builds tokens, and refuses to overwrite either', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    expect((await fwos(root, 'design-system', 'init', '--name', 'Acme')).code).toBe(0);
    expect(JSON.parse(readFileSync(join(root, 'design-system/design-system.json'), 'utf8')).name).toBe('Acme');
    expect((await fwos(root, 'design-system', 'init')).err).toMatch(/never overwrites your design system/);
    expect((await fwos(root, 'tokens', 'build')).out).toMatch(/wrote packages\/tokens\/generated\/tokens.css/);
    expect((await fwos(root, 'tokens', 'build', '--check')).code).toBe(0);
    writeText(join(root, 'packages/tokens/generated/theme.css'), 'hand edit');
    expect((await fwos(root, 'tokens', 'build')).err).toMatch(/edited by hand/);
  });

  it('writes the mapping report with a shadcn theme, and says where it is and what it counted', async () => {
    const theme = ':root { --background: #ffffff; --foreground: #111111; --popover: #ffffff; --radius: 0.5rem; }';
    const root = tempProject({ 'app/globals.css': theme });
    await fwos(root, 'init');
    const r = await fwos(root, 'design-system', 'init', '--from-shadcn', 'app/globals.css');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Wrote design-system\/ \(8 files, from app\/globals\.css\)\. These files are yours\.\nMapping report in docs\/app\/reports\/design-system\.md: \d+ preserved, \d+ approximated, \d+ defaulted, 1 unsupported\./);
    expect(readFileSync(join(root, 'design-system/source/globals.css'), 'utf8')).toBe(theme);
    const report = readFileSync(join(root, 'docs/app/reports/design-system.md'), 'utf8');
    expect(report).toContain('app/globals.css (copied to design-system/source/globals.css)');
    expect(report).toContain('| `--popover` |');
    // The starter imports nothing, so it writes no report.
    const plain = tempProject({});
    await fwos(plain, 'init');
    expect((await fwos(plain, 'design-system', 'init')).out).not.toMatch(/Mapping report/);
    expect(existsSync(join(plain, 'docs/app/reports/design-system.md'))).toBe(false);
  });

  it('records a baseline that only shrinks', async () => {
    const root = tempProject({ 'apps/web/src/a.tsx': '<a className="bg-red-500" /><b className="text-sm" />' });
    await fwos(root, 'init', '--mode', 'adopt');
    expect((await fwos(root, 'baseline', '--init')).out).toMatch(/2 findings recorded/);
    expect((await fwos(root, 'check', 'tokens')).code).toBe(0);
    writeText(join(root, 'apps/web/src/a.tsx'), '<a className="bg-red-500" />');
    expect((await fwos(root, 'baseline')).out).toMatch(/1 finding recorded, 1 fixed and dropped/);
    writeText(join(root, 'apps/web/src/a.tsx'), '<a className="bg-red-500" /><i className="text-xs" />');
    expect((await fwos(root, 'check', 'tokens')).code).toBe(1);
    expect((await fwos(root, 'baseline')).err).toMatch(/only shrink/);
  });
});

describe('tests, signoff, spike, eject and git hook commands', () => {
  it('signs off only a manual AC or a gap the test plan names, and refuses any other id (exit 2)', async () => {
    const root = tempProject({
      'docs/app/spec.md': '### AC-calc-1: Split the bill\n- Proven against: local\n### AC-calc-2: Feels right on a phone\n- Manual: try it on a phone\n- Proven against: local\n',
      'docs/app/test-plan.md': '### TC-calc-1: splits\n- AC: AC-calc-1, AC-calc-7\n### GAP-1: Real sync\n- Missing: no staging account\n### GAP-sync-api: Sync API\n- Missing: no key\n',
    });
    await fwos(root, 'init');
    for (const id of ['AC-calc-2', 'GAP-1', 'GAP-sync-api']) expect((await fwos(root, 'signoff', id, '--by', 'Ada')).code, id).toBe(0);
    const typo = await fwos(root, 'signoff', 'AC-calc-99', '--by', 'Tester');
    expect(typo).toMatchObject({ code: 2, err: expect.stringMatching(/"AC-calc-99" isn't a manual AC in docs\/app\/spec\.md or a gap in docs\/app\/test-plan\.md\.\n.*AC-calc-2, GAP-1, GAP-sync-api\./) });
    // Tests prove an AC with no Manual line, and the report reads no sign-off for it.
    const automated = await fwos(root, 'signoff', 'AC-calc-1', '--by', 'Ada');
    expect(automated).toMatchObject({ code: 2, err: expect.stringMatching(/^fwos: AC-calc-1 is proven by its tests, so a sign-off wouldn't count/) });
    // An AC the plan mentions but the spec doesn't define, a gap no plan names, and no id at all.
    for (const id of ['AC-calc-7', 'GAP-2', 'hello']) expect((await fwos(root, 'signoff', id, '--by', 'Ada')).code, id).toBe(2);
    const change = JSON.parse(readFileSync(join(root, '.fwos/changes/0001-initial.json'), 'utf8'));
    expect(change.signoffs.map((s: { item: string }) => s.item)).toEqual(['AC-calc-2', 'GAP-1', 'GAP-sync-api']);
  });

  it('locks, refuses a lock without evidence, unlocks with a reviewer', async () => {
    const root = tempProject({ 'e2e/a.spec.ts': 'x', 'docs/app/test-plan.md': '### GAP-1: Real sync\n- Missing: no staging account\n' });
    await fwos(root, 'init');
    expect((await fwos(root, 'tests', 'lock', 'e2e/a.spec.ts')).err).toMatch(/--red .* or --existing/);
    expect((await fwos(root, 'tests', 'lock', 'e2e/a.spec.ts', '--existing')).code).toBe(0);
    expect((await fwos(root, 'tests', 'unlock', 'e2e/a.spec.ts', '--reason', 'AC changed')).err).toMatch(/--reviewer/);
    expect((await fwos(root, 'tests', 'unlock', 'e2e/a.spec.ts', '--reason', 'AC changed', '--reviewer', 'Grace')).code).toBe(0);
    expect((await fwos(root, 'tests', 'status')).out).toMatch(/unlocked\s+e2e\/a.spec.ts/);
    expect((await fwos(root, 'signoff', 'GAP-1', '--by', 'Grace', '--note', 'ok')).code).toBe(0);
  });

  it('creates a spike folder', async () => {
    const root = tempProject({});
    await fwos(root, 'spike', 'new', 'Try Charts');
    expect(existsSync(join(root, 'spikes/try-charts/README.md'))).toBe(true);
  });

  it('installs the git hook, then previews and performs eject', async () => {
    const root = tempProject({});
    execFileSync('git', ['init', '-q'], { cwd: root });
    await fwos(root, 'init');
    expect((await fwos(root, 'git-hook', 'install')).code).toBe(0);
    expect(readFileSync(join(root, '.git/hooks/pre-commit'), 'utf8')).toContain('fwos check --staged');
    const preview = await fwos(root, 'eject');
    expect(preview.out).toMatch(/\.fwos\//);
    expect(preview.out).toMatch(/\.git\/hooks\/pre-commit/);
    expect(existsSync(join(root, '.fwos'))).toBe(true);
    await fwos(root, 'eject', '--yes');
    expect(existsSync(join(root, '.fwos'))).toBe(false);
    expect(existsSync(join(root, '.git/hooks/pre-commit'))).toBe(false);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).not.toContain('.fwos/local/');
  });

  it('ejects only the fwos entries step 0 writes, naming each, and keeps the pnpm and git ones and your own', async () => {
    // Step 0's allowlist merged after the user's own entries, next to a setting that isn't a permission.
    // Its fwos entry names the plugin's CLI by absolute path, which a plugin update moves, and an
    // older step 0 wrote a pattern. Two of the user's entries name fwos too: eject can't know they're done with them.
    const yours = ['Bash(make lint)', 'Bash(pnpm exec fwos check)', 'Bash(node ".fwos/cli/dist/fwos.mjs":*)'];
    const step0 = [`Bash(node "${pluginPath('dist', 'fwos.mjs')}":*)`, 'Bash(node "/home/ada/.claude/plugins/cache/fwos/0.0.9/dist/fwos.mjs":*)', 'Bash(node:*fwos.mjs*)'];
    const pnpmAndGit = ['Bash(pnpm typecheck)', 'Bash(pnpm test)', 'Bash(pnpm e2e)', 'Bash(git status:*)', 'Bash(git diff:*)'];
    const root = tempProject({ '.claude/settings.json': JSON.stringify({ model: 'opus', permissions: { allow: [...yours, ...step0, ...pnpmAndGit] } }) });
    await fwos(root, 'init');
    const [removed, left = ''] = (await fwos(root, 'eject')).out.split('Left alone');
    for (const rule of step0) expect(removed).toContain(`.claude/settings.json  the permission entry ${rule}`);
    for (const rule of yours.slice(1)) {
      expect(left).toContain(`.claude/settings.json  the permission entry ${rule}`);
      expect(removed).not.toContain(rule);
    }
    await fwos(root, 'eject', '--yes');
    expect(JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'))).toEqual({ model: 'opus', permissions: { allow: [...yours, ...pnpmAndGit] } });
  });

  it('refuses to write its hook into a hooks folder set in global git config, which every repository shares', async () => {
    const root = tempProject({});
    const shared = join(tempProject({}), 'hooks');
    mkdirSync(shared);
    const config = join(dirname(shared), 'gitconfig');
    writeText(config, `[core]\n\thooksPath = ${shared}\n`);
    execFileSync('git', ['init', '-q'], { cwd: root });
    await fwos(root, 'init');
    const saved = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = config;
    try {
      const r = await fwos(root, 'git-hook', 'install');
      expect(r).toMatchObject({ code: 2, err: expect.stringMatching(/core\.hooksPath is set in your global git config/) });
      expect(r.err).toMatch(/git config core\.hooksPath \.githooks/);
      expect(readdirSync(shared)).toEqual([]);
    } finally {
      process.env.GIT_CONFIG_GLOBAL = saved;
    }
  });

  it('installs the commit hook where git runs hooks: core.hooksPath, a linked worktree, a project in a subfolder', async () => {
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });
    const hook = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
    // core.hooksPath: git runs .githooks/pre-commit, never .git/hooks/pre-commit.
    const custom = tempProject({});
    git(custom, 'init', '-q');
    git(custom, 'config', 'core.hooksPath', '.githooks');
    await fwos(custom, 'init');
    expect((await fwos(custom, 'git-hook', 'install')).code).toBe(0);
    expect(hook(join(custom, '.githooks/pre-commit'))).toContain('fwos check --staged');
    expect(existsSync(join(custom, '.git/hooks/pre-commit'))).toBe(false);
    expect((await fwos(custom, 'eject')).out).toMatch(/\.githooks\/pre-commit/);
    await fwos(custom, 'eject', '--yes');
    expect(existsSync(join(custom, '.githooks/pre-commit'))).toBe(false);
    // A linked worktree: .git is a file there, and hooks live in the main repository's git folder.
    const base = tempProject({});
    const main = join(base, 'main');
    mkdirSync(main);
    git(main, 'init', '-q');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
    git(main, 'worktree', 'add', '-q', join(base, 'wt'));
    await fwos(join(base, 'wt'), 'init');
    expect((await fwos(join(base, 'wt'), 'git-hook', 'install')).code).toBe(0);
    expect(hook(join(main, '.git/hooks/pre-commit'))).toContain('fwos check --staged');
    // A project in a subfolder: git runs the hook at the top, so it changes into the project first.
    const repo = tempProject({});
    git(repo, 'init', '-q');
    const app = join(repo, 'apps/site');
    mkdirSync(app, { recursive: true });
    await fwos(app, 'init');
    expect((await fwos(app, 'git-hook', 'install')).code).toBe(0);
    expect(hook(join(repo, '.git/hooks/pre-commit'))).toContain("cd 'apps/site' || exit 1");
    const r = spawnSync('sh', ['.git/hooks/pre-commit'], { cwd: repo, encoding: 'utf8', env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin` } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/PASS\s+state\/schema/);
  });

  it('takes out the pin to .fwos/cli and the scripts and CI step that run fwos, so install and CI still work', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    await fwos(root, 'scaffold', 'web');
    const pkgPath = join(root, 'package.json');
    const ciPath = join(root, '.github/workflows/fwos.yml');
    const preview = await fwos(root, 'eject');
    expect(preview.out).toMatch(/package\.json\s+the fwos-check pin to \.fwos\/cli/);
    expect(preview.out).toMatch(/package\.json\s+the check script \(fwos check\)/);
    expect(preview.out).toMatch(/package\.json\s+the tokens script \(fwos tokens build\)/);
    expect(preview.out).toMatch(/\.github\/workflows\/fwos\.yml\s+the fwos check step/);
    expect(preview.out).not.toMatch(/Left alone/);
    expect(JSON.parse(readFileSync(pkgPath, 'utf8')).devDependencies['fwos-check']).toBe('file:.fwos/cli');

    writeText(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    const r = await fwos(root, 'eject', '--yes');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/run pnpm install/i);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }['fwos-check']).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
    expect(Object.values(pkg.scripts as Record<string, string>).filter((s) => /\bfwos\b/.test(s))).toEqual([]);
    expect(Object.keys(pkg.scripts)).toEqual(['dev', 'build', 'typecheck', 'test', 'e2e']);
    // The workflow stays, since the rest of it is the app's own CI. Only its name still says fwos.
    const ci = readFileSync(ciPath, 'utf8');
    expect(ci).toContain('- run: pnpm e2e');
    expect(ci.split('\n').filter((l) => l.includes('fwos'))).toEqual(['name: fwos']);
  });

  it('leaves a pin you chose and a script or CI line you changed, and lists them as still using fwos', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    await fwos(root, 'scaffold', 'web', '--fwos-check', '^9.9.9');
    const pkgPath = join(root, 'package.json');
    const ciPath = join(root, '.github/workflows/fwos.yml');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    writeText(pkgPath, JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, check: 'fwos check && eslint .' } }, null, 2));
    const ci = readFileSync(ciPath, 'utf8').replace('- run: pnpm exec fwos check', '- run: pnpm exec fwos check --json').replace('- run: pnpm exec fwos tests run', '- run: pnpm exec fwos tests run e2e');
    writeText(ciPath, ci);
    writeText(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    const r = await fwos(root, 'eject', '--yes');
    expect(r.code).toBe(0);
    const [, left = ''] = r.out.split('Left alone');
    expect(left).toMatch(/package\.json\s+the fwos-check pin \(\^9\.9\.9\)/);
    expect(left).toMatch(/package\.json\s+the check script \(fwos check && eslint \.\)/);
    expect(left).toMatch(/\.github\/workflows\/fwos\.yml\s+- run: pnpm exec fwos check --json/);
    const after = JSON.parse(readFileSync(pkgPath, 'utf8'));
    expect(after.devDependencies).toEqual({ 'fwos-check': '^9.9.9' });
    expect(after.scripts.check).toBe('fwos check && eslint .');
    expect(after.scripts.tokens).toBeUndefined();
    expect(left).toContain('- run: pnpm exec fwos tests run e2e');
    expect(readFileSync(ciPath, 'utf8')).toBe(ci);
    expect(r.out).not.toMatch(/pnpm install/);
  });

  it("lists a line in the app's own workflows that runs fwos, which fails once the pin goes, and never edits it", async () => {
    const root = tempProject({ 'package.json': { dependencies: { next: '15.0.0' } }, 'app/page.tsx': '' });
    await fwos(root, 'init', '--mode', 'adopt');
    await fwos(root, 'vendor');
    // What `pnpm add -D file:.fwos/cli` writes, then the CI step the README has an adopted app add.
    const pkgPath = join(root, 'package.json');
    writeText(pkgPath, JSON.stringify({ dependencies: { next: '15.0.0' }, devDependencies: { 'fwos-check': 'file:.fwos/cli' } }, null, 2));
    const ciPath = join(root, '.github/workflows/ci.yml');
    const ci = 'jobs:\n  test:\n    steps:\n      - run: pnpm test\n      # fwos check gates the pull request\n      - run: pnpm exec fwos check\n';
    writeText(ciPath, ci);
    const nightlyPath = join(root, '.github/workflows/nightly.yaml');
    const nightly = 'jobs:\n  report:\n    steps:\n      - run: |\n          pnpm install\n          pnpm exec fwos report\n';
    writeText(nightlyPath, nightly);
    expect((await fwos(root, 'eject')).out).toMatch(/Left alone[\s\S]*\.github\/workflows\/ci\.yml\s+- run: pnpm exec fwos check/);

    const r = await fwos(root, 'eject', '--yes');
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(pkgPath, 'utf8'))).toEqual({ dependencies: { next: '15.0.0' } });
    expect(readFileSync(ciPath, 'utf8')).toBe(ci);
    expect(readFileSync(nightlyPath, 'utf8')).toBe(nightly);
    const [removing = '', left = ''] = r.out.split('Left alone');
    expect(removing).not.toMatch(/workflows/);
    expect(left).toMatch(/^ {2}\.github\/workflows\/ci\.yml\s+- run: pnpm exec fwos check$/m);
    expect(left).toMatch(/^ {2}\.github\/workflows\/nightly\.yaml\s+pnpm exec fwos report$/m);
    expect(left).not.toMatch(/gates the pull request/);
  });

  it('takes the JUnit reporters out of the test configs, so no test run leaves results unignored in .fwos/', async () => {
    const root = tempProject({});
    execFileSync('git', ['init', '-q'], { cwd: root });
    await fwos(root, 'init');
    await fwos(root, 'scaffold', 'web');
    const preview = await fwos(root, 'eject');
    expect((await fwos(root, 'eject', '--yes')).code).toBe(0);
    expect(unignoredResults(root)).toEqual([]);
    expect(preview.out).toMatch(/apps\/web\/vitest\.config\.ts\s+the JUnit reporter/);
    expect(preview.out).toMatch(/apps\/web\/playwright\.config\.ts\s+the JUnit reporter/);
    // Each runner keeps the console reporter it had. Only the JUnit file for fwos check goes.
    const vitest = readFileSync(join(root, 'apps/web/vitest.config.ts'), 'utf8');
    const playwright = readFileSync(join(root, 'apps/web/playwright.config.ts'), 'utf8');
    expect(vitest).toContain("\n    reporters: ['default'],\n  },\n");
    expect(playwright).toContain("\n  reporter: 'list',\n");
    expect(`${vitest}${playwright}`).not.toMatch(/junit/i);
    expect(`${vitest}${playwright}`).not.toContain('.fwos');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).not.toContain('.fwos/local/');
  });

  it('keeps the .fwos/local/ ignore lines while a reporter line you changed still writes there', async () => {
    const root = tempProject({});
    execFileSync('git', ['init', '-q'], { cwd: root });
    await fwos(root, 'init');
    await fwos(root, 'scaffold', 'web');
    const vitestPath = join(root, 'apps/web/vitest.config.ts');
    const vitest = readFileSync(vitestPath, 'utf8').replace('results/vitest.xml', 'results/unit.xml');
    writeText(vitestPath, vitest);
    const r = await fwos(root, 'eject', '--yes');
    expect(r.code).toBe(0);
    const [removed = '', left = ''] = r.out.split('Left alone');
    expect(removed).toMatch(/apps\/web\/playwright\.config\.ts\s+the JUnit reporter/);
    expect(removed).not.toMatch(/vitest|\.gitignore/);
    expect(left).toMatch(/apps\/web\/vitest\.config\.ts\s+outputFile: \{ junit: '\.\.\/\.\.\/\.fwos\/local\/results\/unit\.xml' \},/);
    expect(left).toMatch(/\.gitignore\s+the \.fwos\/local\/ lines/);
    expect(readFileSync(vitestPath, 'utf8')).toBe(vitest);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('# fwos: evidence, run logs and test results (local only)\n.fwos/local/\n');
    expect(unignoredResults(root)).toEqual([]);
  });

  it("keeps them for an adopted app's own test config that writes there, and never edits it", async () => {
    const config = "export default {\n  test: {\n    reporters: ['default', 'junit'],\n    outputFile: { junit: '.fwos/local/results/vitest.xml' },\n  },\n};\n";
    const root = tempProject({ 'vitest.config.mts': config });
    execFileSync('git', ['init', '-q'], { cwd: root });
    await fwos(root, 'init', '--mode', 'adopt');
    const r = await fwos(root, 'eject', '--yes');
    expect(r.code).toBe(0);
    const [, left = ''] = r.out.split('Left alone');
    expect(left).toMatch(/vitest\.config\.mts\s+outputFile: \{ junit: '\.fwos\/local\/results\/vitest\.xml' \},/);
    expect(left).toMatch(/\.gitignore\s+the \.fwos\/local\/ lines/);
    expect(readFileSync(join(root, 'vitest.config.mts'), 'utf8')).toBe(config);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.fwos/local/');
    expect(unignoredResults(root)).toEqual([]);
  });

  it('runs the commit hook before anything is installed, through the plugin CLI', async () => {
    const root = tempProject({});
    execFileSync('git', ['init', '-q'], { cwd: root });
    await fwos(root, 'init');
    await fwos(root, 'git-hook', 'install');
    // No node_modules and no fwos on PATH: only node itself.
    const r = spawnSync('sh', ['.git/hooks/pre-commit'], { cwd: root, encoding: 'utf8', env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin` } });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\d+ pass, 0 fail/);
  });

  it('merges the scaffold into a package.json that already exists, keeping its values', async () => {
    const root = tempProject({ 'package.json': JSON.stringify({ name: 'mine', scripts: { test: 'my-runner' }, devDependencies: { 'fwos-check': 'link:../fwos' } }) });
    await fwos(root, 'init', '--name', 'Mine');
    expect((await fwos(root, 'scaffold', 'web')).out).toContain('package.json merged');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('mine');
    expect(pkg.devDependencies['fwos-check']).toBe('link:../fwos');
    expect(existsSync(join(root, '.fwos/cli'))).toBe(false);
    expect(pkg.scripts.test).toBe('my-runner');
    expect(pkg.scripts.e2e).toBe('pnpm --filter web e2e');
    expect(pkg.packageManager).toMatch(/^pnpm@/);
  });

  it("won't replace a pre-commit hook that isn't fwos's", async () => {
    const root = tempProject({});
    execFileSync('git', ['init', '-q'], { cwd: root });
    await fwos(root, 'init');
    writeText(join(root, '.git/hooks/pre-commit'), '#!/bin/sh\nmy-linter\n');
    expect(await fwos(root, 'git-hook', 'install')).toMatchObject({ code: 2, err: expect.stringMatching(/isn't fwos's/) });
    expect(readFileSync(join(root, '.git/hooks/pre-commit'), 'utf8')).toBe('#!/bin/sh\nmy-linter\n');
  });

  it('explains a broken state file in doctor instead of failing', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    writeText(join(root, '.fwos/state.json'), '{bad');
    const r = await fwos(root, 'doctor');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/state\.json is not valid JSON/);
    expect(r.out).toMatch(/restore it from git/);
  });

  it("won't close a change until its acceptance report is approved", async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    const r = await fwos(root, 'change', 'done');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/needs the acceptance report approved first/);
  });

  it('quotes the plugin path in the commit hook', () => {
    expect(preCommitHook("/plugins/it's here/fwos.mjs")).toContain(`exec node '/plugins/it'\\''s here/fwos.mjs' check --staged`);
  });

  it("prints the command's own help for --help, and changes nothing", async () => {
    const root = tempProject({});
    for (const cmd of ['scaffold', 'init', 'design-system', 'tokens']) {
      const r = await fwos(root, cmd, '--help');
      expect(r.code, cmd).toBe(0);
      expect(r.out, cmd).toMatch(new RegExp(`^Usage:\\n  fwos ${cmd}\\b`, 'm'));
      expect(r.out, cmd).not.toMatch(/Every day/);
    }
    expect(readdirSync(root)).toEqual([]);
    expect((await fwos(root, 'help', 'check')).out).toMatch(/^ {2}fwos check \[ids\.\.\.\] \[--staged\] \[--json\]/m);
    const spend = (await fwos(root, 'change', 'spend', '--help')).out;
    expect(spend).toMatch(/fwos change spend --step <step> --usd <n>/);
    expect(spend).not.toMatch(/change new/);
    expect((await fwos(root, '--help')).out).toMatch(/Usage: fwos <command>/);
    expect((await fwos(root, 'help')).out).toMatch(/Every day/);
    expect(await fwos(root, '--version')).toMatchObject({ code: 0, out: pluginVersion() });
  });

  it("names every flag a command takes in that command's help", async () => {
    const root = tempProject({});
    for (const [key, flags] of Object.entries(FLAGS)) {
      const out = (await fwos(root, ...key.split(' '), '--help')).out;
      for (const f of flags) expect(out, `fwos ${key} --help`).toContain(`--${f}`);
    }
    // Every command but the hook, which never fails on its arguments, has its flags listed.
    expect(Object.keys(COMMANDS).filter((c) => c !== 'hook' && !(c in FLAGS))).toEqual([]);
  });

  it('refuses a flag the command does not take (exit 2), naming the ones it does', async () => {
    const root = tempProject({ 'e2e/a.spec.ts': 'x' });
    await fwos(root, 'init');
    expect(await fwos(root, 'check', '--jsn')).toMatchObject({ code: 2, out: '', err: expect.stringMatching(/^fwos: unknown flag --jsn for "fwos check"\.\nIt takes --staged, --json and --dir/) });
    // A flag that belongs to another subcommand is unknown here too.
    expect((await fwos(root, 'change', 'list', '--usd', '5')).code).toBe(2);
    expect((await fwos(root, 'tests', 'lock', 'e2e/a.spec.ts', '--existing', '--reviewer', 'Ada')).code).toBe(2);
    expect(JSON.parse(readFileSync(join(root, '.fwos/changes/0001-initial.json'), 'utf8')).lockedTests).toBeUndefined();
    // A single dash is a typo for two, never a positional.
    expect(await fwos(root, 'status', '-json')).toMatchObject({ code: 2, err: expect.stringMatching(/^fwos: unknown flag -json\b/) });
    // Before the command, an unknown flag would take the command as its value and print the help.
    expect(await fwos(root, '--jsn', 'check')).toMatchObject({ code: 2, out: '', err: expect.stringMatching(/^fwos: unknown flag --jsn\b/) });
    expect((await fwos(root, '--bogus')).code).toBe(2);
    // An unknown command is one, with --help too.
    expect(await fwos(root, 'bogus', '--help')).toMatchObject({ code: 2, out: '', err: expect.stringMatching(/^fwos: unknown command "bogus"/) });
    expect((await fwos(root, 'help', 'bogus')).code).toBe(2);
    // Positive control: the flags a command takes work, before or after it.
    expect((await fwos(root, '--json', 'status')).code).toBe(0);
    expect((await fwos(root, '--help')).code).toBe(0);
    expect((await fwos(root, 'help', 'check')).out).toMatch(/fwos check/);
    expect((await fwos(root, 'tests', 'lock', 'e2e/a.spec.ts', '--existing')).code).toBe(0);
    // The hook never fails on its arguments: exit 2 there would block the tool call.
    const hook = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../main.ts', import.meta.url).pathname, 'hook', 'pre-tool-use', '--unknown'], { cwd: root, input: '{}' });
    expect(hook.status).toBe(0);
  });

  it('runs only when it is the script node was given, not when another script imports it', () => {
    const dir = tempProject({});
    const main = new URL('../main.ts', import.meta.url).pathname;
    writeText(join(dir, 'my-fwos.mjs'), `import ${JSON.stringify(main)};\n`);
    const node = (script: string, ...args: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', script, ...args], { cwd: dir, encoding: 'utf8' });
    expect(node(join(dir, 'my-fwos.mjs'), 'version')).toMatchObject({ status: 0, stdout: '', stderr: '' });
    // Positive control: run directly, it is the CLI, and so it is through a link, as a bin shim runs it.
    expect(node(main, 'version').stdout.trim()).toBe(pluginVersion());
    const link = join(dir, 'fwos-link.ts');
    symlinkSync(main, link);
    expect(node(link, 'version').stdout.trim()).toBe(pluginVersion());
  });

  it('treats an unknown check id and a missing --dir as usage errors (exit 2)', async () => {
    const root = tempProject({});
    expect(await fwos(root, 'check', 'no-such-check')).toMatchObject({ code: 2, err: expect.stringMatching(/No check matches "no-such-check"/) });
    expect((await fwos(root, 'check', '--dir', join(root, 'nowhere'))).code).toBe(2);
    expect((await fwos(root, 'check', '--dir')).code).toBe(2);
    expect((await fwos(root, 'init', '--dir', join(root, 'nowhere'))).code).toBe(2);
    expect(existsSync(join(root, 'nowhere'))).toBe(false);
    expect((await fwos(root, 'check', 'tokens')).code).toBe(0);
  });

  it('refuses --staged when a staged file has unstaged edits too', async () => {
    const root = tempProject({});
    execFileSync('git', ['init', '-q'], { cwd: root });
    await fwos(root, 'init');
    writeText(join(root, 'apps/web/src/row.tsx'), 'export const R = () => <div className="bg-red-500" />;\n');
    execFileSync('git', ['add', 'apps/web/src/row.tsx'], { cwd: root });
    expect((await fwos(root, 'check', '--staged')).code).toBe(1);
    writeText(join(root, 'apps/web/src/row.tsx'), 'export const R = () => <div className="bg-surface" />;\n');
    const r = await fwos(root, 'check', '--staged');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/apps\/web\/src\/row\.tsx differs on disk from what you're committing/);
  });

  it('refuses --staged when the commit moves a locked test away and leaves a copy behind', async () => {
    const root = tempProject({ 'apps/web/e2e/a.spec.ts': 'test("a", () => {})' });
    execFileSync('git', ['init', '-q'], { cwd: root });
    await fwos(root, 'init');
    await fwos(root, 'tests', 'lock', 'apps/web/e2e/a.spec.ts', '--existing');
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'lock'], { cwd: root });
    execFileSync('git', ['mv', 'apps/web/e2e/a.spec.ts', 'apps/web/e2e/b.spec.ts'], { cwd: root });
    writeText(join(root, 'apps/web/e2e/a.spec.ts'), 'test("a", () => {})');
    expect((await fwos(root, 'check', '--staged', 'tests/locked')).code).toBe(2);
  });

  it('reads staged file names with accents exactly', async () => {
    const root = tempProject({});
    execFileSync('git', ['init', '-q'], { cwd: root });
    await fwos(root, 'init');
    writeText(join(root, 'apps/web/src/features/x/Bouton-é.tsx'), 'export const B = () => <div className="bg-red-500" />;');
    execFileSync('git', ['add', '-A'], { cwd: root });
    const r = await fwos(root, 'check', '--staged', 'design-system/tokens');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Bouton-é\.tsx/);
  });

  it('refuses --staged when the commit deletes a file that is still on disk', async () => {
    const root = tempProject({ 'apps/web/e2e/a.spec.ts': 'test("a", () => {})' });
    execFileSync('git', ['init', '-q'], { cwd: root });
    await fwos(root, 'init');
    await fwos(root, 'tests', 'lock', 'apps/web/e2e/a.spec.ts', '--existing');
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'lock'], { cwd: root });
    execFileSync('git', ['rm', '-q', '--cached', 'apps/web/e2e/a.spec.ts'], { cwd: root });
    const r = await fwos(root, 'check', '--staged', 'tests/locked');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/apps\/web\/e2e\/a\.spec\.ts differs on disk/);
  });

  it('keeps every edit when fwos commands run at once', async () => {
    const root = tempProject({ 'docs/app/test-plan.md': Array.from({ length: 12 }, (_, i) => `### GAP-${i}: gap ${i}\n`).join('') });
    await fwos(root, 'init');
    const cli = new URL('../main.ts', import.meta.url).pathname;
    const runs = Array.from({ length: 12 }, (_, i) =>
      new Promise<number>((done) => {
        const child = spawn(process.execPath, [cli, 'signoff', `GAP-${i}`, '--by', 'Ada'], { cwd: root, stdio: 'ignore' });
        child.on('exit', (code) => done(code ?? 1));
      }),
    );
    expect(await Promise.all(runs)).toEqual(Array(12).fill(0));
    const change = JSON.parse(readFileSync(join(root, '.fwos/changes/0001-initial.json'), 'utf8'));
    expect(change.signoffs).toHaveLength(12);
  });

  it('gives each change its own number when several start at once', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    const cli = new URL('../main.ts', import.meta.url).pathname;
    const runs = Array.from({ length: 12 }, () =>
      new Promise<number>((done) => {
        const child = spawn(process.execPath, [cli, 'change', 'new', 'same', '--route', 'code-only'], { cwd: root, stdio: 'ignore' });
        child.on('exit', (code) => done(code ?? 1));
      }),
    );
    expect(await Promise.all(runs)).toEqual(Array(12).fill(0));
    expect(readdirSync(join(root, '.fwos/changes')).sort()).toHaveLength(13);
  });

  it('refuses unknown commands with exit 2 and prints help', async () => {
    const root = tempProject({});
    expect((await fwos(root, 'frobnicate')).code).toBe(2);
    expect((await fwos(root, 'help')).out).toMatch(/Usage: fwos <command>/);
  });
});

describe('the baseline never covers gates or test proof', () => {
  /** Writes a baseline by hand that records every current finding, gates included. */
  async function baselineEverything(root: string) {
    const raw = await runChecks(loadProject(root), { baseline: false });
    writeText(join(root, '.fwos/baseline.json'), JSON.stringify({ schema: 1, createdAt: '2026-10-07', findings: fingerprintsOf(raw, new Set()) }));
  }

  it('refuses to write a baseline while a gate fails, and a recorded gate finding still fails the run', async () => {
    const root = tempProject({});
    await fwos(root, 'init', '--mode', 'adopt');
    await fwos(root, 'design-system', 'init');
    const ds = join(root, 'design-system/design-system.json');
    writeText(ds, JSON.stringify({ ...JSON.parse(readFileSync(ds, 'utf8')), bogus: true }));
    expect(await fwos(root, 'baseline', '--init')).toMatchObject({ code: 2, err: expect.stringMatching(/design-system\/schema fails/) });
    await baselineEverything(root);
    writeText(join(root, 'apps/web/src/b.tsx'), 'export const B = () => <div className="bg-blue-500" />;');
    const r = await fwos(root, 'check');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL\s+design-system\/schema/);
  });

  it('never hides an unproven requirement or a changed locked test', async () => {
    const root = tempProject({
      'docs/app/spec.md': '## 10. Acceptance criteria\n### AC-x-1: a\n- Proven against: local\n### AC-x-2: b\n- Proven against: local\n',
      '.fwos/local/results/v.xml': '<testsuite><testcase classname="c" name="b @AC-x-2"/></testsuite>',
      'apps/web/e2e/a.spec.ts': 'test("a", () => {})',
    });
    await fwos(root, 'init', '--mode', 'adopt');
    // Locked tests and requirements belong to a change delivered at level delivery.
    await fwos(root, 'adopt', '--level', 'delivery', '--yes');
    await fwos(root, 'change', 'new', 'x', '--route', 'touches-ac');
    expect((await fwos(root, 'tests', 'lock', 'apps/web/e2e/a.spec.ts', '--existing')).code).toBe(0);
    writeText(join(root, 'apps/web/e2e/a.spec.ts'), 'test.skip("a", () => {})');
    const change = join(root, '.fwos/changes/0002-x.json');
    writeText(change, JSON.stringify({ ...JSON.parse(readFileSync(change, 'utf8')), step: 'accept' }));
    await baselineEverything(root);
    const r = await fwos(root, 'check', 'tests/traceability', 'tests/locked');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL\s+tests\/traceability/);
    expect(r.out).toMatch(/FAIL\s+tests\/locked/);
  });

  it('never hides an approval that no longer holds', async () => {
    const root = tempProject({ 'docs/app/spec.md': 'spec', 'docs/app/test-plan.md': 'plan', 'src/export.ts': 'export const toCsv = () => "";\n' });
    await fwos(root, 'init', '--mode', 'adopt');
    await fwos(root, 'adopt', '--level', 'delivery', '--yes');
    await fwos(root, 'change', 'new', 'add export', '--route', 'touches-ac');
    await fwos(root, 'change', 'map', 'src/export.ts');
    expect((await fwos(root, 'approve', 'spec', '--by', 'Ada')).code).toBe(0);
    await fwos(root, 'step', 'build');
    writeText(join(root, 'docs/app/spec.md'), 'spec, edited after it was approved');
    expect((await fwos(root, 'check', 'state/approvals')).code).toBe(1);
    await baselineEverything(root);
    expect((await fwos(root, 'check', 'state/approvals')).code).toBe(1);
  });

  it('is adopt mode only: a new project refuses to write one and ignores one written by hand', async () => {
    const root = tempProject({ 'apps/web/src/a.tsx': 'export const A = () => <div className="bg-red-500" />;' });
    await fwos(root, 'init');
    expect(await fwos(root, 'baseline', '--init')).toMatchObject({ code: 2, err: expect.stringMatching(/adopt mode/) });
    await baselineEverything(root);
    expect((await fwos(root, 'check', 'design-system/tokens')).code).toBe(1);
  });
});

describe('contract and change subcommands', () => {
  const openapi = `openapi: 3.1.0
info: { title: t, version: '1' }
paths:
  /items:
    get:
      operationId: listItems
      responses:
        '200':
          description: ok
`;

  it('writes the mocks, then --check passes, survives CRLF, and catches a stale file', async () => {
    const root = tempProject({ 'packages/api-contract/openapi.yaml': openapi, 'packages/api-contract/fixtures/listItems.default.json': { status: 200, body: [] } });
    await fwos(root, 'init');
    expect((await fwos(root, 'contract', 'mocks')).out).toMatch(/wrote /);
    expect((await fwos(root, 'contract', 'mocks', '--check')).code).toBe(0);
    const out = (await fwos(root, 'contract', 'mocks')).out.split(' ').at(-1)!;
    const file = join(root, out);
    writeText(file, readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
    expect((await fwos(root, 'contract', 'mocks', '--check')).code).toBe(0);
    writeText(file, '// edited by hand\n');
    expect(await fwos(root, 'contract', 'mocks', '--check')).toMatchObject({ code: 1, out: expect.stringMatching(/stale/) });
  });

  it('shows the change, moves its cursor and adds up its spend', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    expect(JSON.parse((await fwos(root, 'change', 'show')).out).id).toBe('0001-initial');
    await fwos(root, 'change', 'cursor', '--section', 'T3', '--pending', 'T4, T5', '--note', 'paused');
    await fwos(root, 'change', 'spend', '--step', 'discovery', '--usd', '0.25');
    await fwos(root, 'change', 'spend', '--step', 'discovery', '--usd', '0.5');
    for (const usd of ['lots', '5abc', '-5', '0']) {
      expect(await fwos(root, 'change', 'spend', '--step', 'discovery', '--usd', usd), usd).toMatchObject({ code: 2, err: 'fwos: --usd must be a positive number of dollars, such as 0.25.' });
    }
    expect((await fwos(root, 'signoff', 'AC-typo-l', '--by', 'Ada')).code).toBe(2);
    const c = JSON.parse((await fwos(root, 'change', 'show', '0001-initial')).out);
    expect(c.cursor).toEqual({ pending: ['T4', 'T5'], section: 'T3', note: 'paused' });
    expect(c.spend).toEqual({ discovery: 0.75 });
  });
});

describe('ia diff', () => {
  it('diffs against a file', async () => {
    const page = { id: 'list', title: 'List', route: '/', kind: 'nav', states: ['ready'] };
    const root = tempProject({
      'docs/app/ia.json': { schema: 1, roles: ['user'], pages: [page, { ...page, id: 'archive', route: '/archive' }] },
      'old.json': { schema: 1, roles: ['user'], pages: [page] },
    });
    expect((await fwos(root, 'ia', 'diff', '--from', 'old.json')).out).toBe('+ added    archive: List at /archive (nav)');
  });

  it('shows a flag removed from a page', async () => {
    const members = { id: 'members', title: 'Members', route: '/members', kind: 'nav', visibleTo: ['admin'], flag: 'members-enabled', states: ['ready'] };
    const ia = { schema: 1, roles: ['member', 'admin'], flags: ['members-enabled'], pages: [{ id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['ready'] }, members] };
    const { flag: _, ...ungated } = members;
    const root = tempProject({ 'docs/app/ia.json': { ...ia, pages: [ia.pages[0], ungated] }, 'before.json': ia });
    expect((await fwos(root, 'ia', 'diff', '--from', 'before.json')).out).toBe(
      ['~ flag     members: no longer behind flag members-enabled', '! exposed  members: now visible to admin while members-enabled is off'].join('\n'),
    );
    expect(JSON.parse((await fwos(root, 'ia', 'diff', '--from', 'before.json', '--json')).out)).toEqual([
      { kind: 'flag', id: 'members', detail: 'no longer behind flag members-enabled' },
      { kind: 'exposed', id: 'members', role: 'admin', when: { 'members-enabled': false }, detail: 'now visible to admin while members-enabled is off' },
    ]);
  });
});

describe('fwos harness', () => {
  const main = join(__dirname, '../main.ts');
  /** The CLI in its own process, as the harness spec runs it, with JSON on stdin. */
  const cli = (cwd: string, args: string[], input?: string) => {
    const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', main, ...args], { cwd, input, encoding: 'utf8' });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const ia = {
    schema: 1,
    roles: ['member', 'admin'],
    flags: ['members-enabled'],
    pages: [
      { id: 'list', title: 'List', route: '/', kind: 'nav', states: ['loading', 'ready'] },
      { id: 'members', title: 'Members', route: '/members', kind: 'nav', visibleTo: ['admin'], flag: 'members-enabled', states: ['ready'] },
      { id: 'item', title: 'Item', route: '/items/[id]', kind: 'drilldown', parent: 'list', states: ['ready'] },
    ],
  };
  const components = { schema: 1, components: [{ id: 'button', status: 'stable', requiredStates: ['default', 'loading'] }, { id: 'badge', status: 'stable', requiredStates: [] }] };
  const app = async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    await fwos(root, 'scaffold', 'web', '--fwos-check', '^9.9.9');
    writeText(join(root, 'docs/app/ia.json'), JSON.stringify(ia));
    writeText(join(root, 'design-system/components.json'), JSON.stringify(components));
    return root;
  };
  const seen = (state: string, over: object = {}) => ({ state, status: 200, found: true, nodes: 2, text: state, busy: 0, alerts: [], statuses: [], items: [], disabled: 0, invalid: 0, ...over });

  it("puts fwos's own harness files in the app, which scaffold writes too; --check names one that isn't fwos's", async () => {
    const bare = tempProject({});
    await fwos(bare, 'init');
    expect(await fwos(bare, 'harness')).toMatchObject({ code: 2, err: expect.stringMatching(/No app at apps\/web yet/) });
    const root = await app();
    const manifest = JSON.parse(readFileSync(join(root, '.fwos/manifest.json'), 'utf8'));
    for (const f of ['apps/web/e2e/fwos-states.spec.ts', 'apps/web/e2e/fwos-ia.spec.ts']) {
      expect(manifest.files[f], f).toMatchObject({ kind: 'fwos', source: 'fwos harness' });
      expect(readFileSync(join(root, f), 'utf8')).toBe(readFileSync(pluginPath('platforms/web/templates/harness', f.split('/').pop()!), 'utf8'));
    }
    expect(await fwos(root, 'harness')).toMatchObject({ code: 0, out: expect.stringMatching(/unchanged apps\/web\/e2e\/fwos-states\.spec\.ts/) });
    expect((await fwos(root, 'harness', '--check')).code).toBe(0);
    writeText(join(root, 'apps/web/e2e/fwos-ia.spec.ts'), '// my own version\n');
    expect(await fwos(root, 'harness', '--check')).toMatchObject({ code: 1, out: 'edited apps/web/e2e/fwos-ia.spec.ts' });
    // A hand edit is never overwritten: it's named, and the file stays.
    expect(await fwos(root, 'harness')).toMatchObject({ code: 2, err: expect.stringMatching(/apps\/web\/e2e\/fwos-ia\.spec\.ts was edited by hand/) });
    expect(readFileSync(join(root, 'apps/web/e2e/fwos-ia.spec.ts'), 'utf8')).toBe('// my own version\n');
  });

  it('lists what the harness renders and opens, with the revision the run starts on', async () => {
    const root = await app();
    const revision = revisionOf(loadProject(root));
    expect(JSON.parse(cli(join(root, 'apps/web/e2e'), ['harness', 'targets', 'states']).out)).toEqual({
      revision,
      // Each state with the path that renders its fixture: the screens browser, in an app fwos scaffolded.
      targets: [
        { key: 'page.list', kind: 'page', id: 'list', states: ['loading', 'ready'], paths: { loading: '/fwos-screens/list?state=loading', ready: '/fwos-screens/list?state=ready' } },
        { key: 'page.members', kind: 'page', id: 'members', states: ['ready'], paths: { ready: '/fwos-screens/members?state=ready' } },
        { key: 'page.item', kind: 'page', id: 'item', states: ['ready'], paths: { ready: '/fwos-screens/item?state=ready' } },
        {
          key: 'component.button',
          kind: 'component',
          id: 'button',
          states: ['default', 'loading'],
          paths: { default: '/fwos-screens/components/button?state=default', loading: '/fwos-screens/components/button?state=loading' },
        },
      ],
    });
    const plan = JSON.parse((await fwos(root, 'harness', 'targets', 'ia')).out);
    expect(plan).toMatchObject({ revision, cookie: 'fwos-test-access', skipped: [{ page: 'item', why: 'a dynamic route (/items/[id])' }] });
    expect(plan.runs.map((r: { key: string }) => r.key)).toEqual(['member+members-enabled', 'member', 'admin+members-enabled', 'admin']);
    expect(plan.visits).toEqual([{ page: 'list', path: '/' }, { page: 'members', path: '/members' }]);
    expect((await fwos(root, 'harness', 'targets', 'nav')).code).toBe(2);
  });

  it('runs no IA in an app with no ia.json, such as an adopted one, and refuses an ia.json with errors', async () => {
    const root = await app();
    rmSync(join(root, 'docs/app/ia.json'));
    expect(JSON.parse((await fwos(root, 'harness', 'targets', 'ia')).out)).toEqual({ revision: revisionOf(loadProject(root)), cookie: 'fwos-test-access', runs: [], visits: [], skipped: [] });
    writeText(join(root, 'docs/app/ia.json'), '{ "schema": 1 }');
    expect(await fwos(root, 'harness', 'targets', 'ia')).toMatchObject({ code: 2, err: expect.stringMatching(/has errors, so there's no IA to run/) });
  });

  it('keeps what a run saw, bound to the revision it ran on, and answers with what breaks the contract', async () => {
    const root = await app();
    const revision = revisionOf(loadProject(root));
    const config = { server: 'production build', browser: 'chromium 141' };
    // The loading fixture draws the ready state: a violation, kept and answered.
    const wrong = cli(root, ['harness', 'record', 'states', 'page.list', '--revision', revision], JSON.stringify({ config, observations: [seen('loading', { text: 'ready' }), seen('ready')] }));
    expect(wrong.code).toBe(1);
    expect(JSON.parse(wrong.out)).toEqual({
      file: '.fwos/local/runs/states/page.list.json',
      violations: ['list "loading": nothing is marked aria-busy="true"; renders exactly as "ready", so the fixture ignores its state'],
    });
    const record = JSON.parse(readFileSync(join(root, '.fwos/local/runs/states/page.list.json'), 'utf8'));
    expect(record).toMatchObject({ schema: 1, kind: 'states', target: 'page.list', fwos: pluginVersion(), revision, config, harness: { file: 'apps/web/e2e/fwos-states.spec.ts' } });
    // A clean run answers no violations, and a run that started on other code is kept as stale.
    const ok = cli(root, ['harness', 'record', 'states', 'component.button', '--revision', 'other0000000'], JSON.stringify({ config, observations: [seen('default'), seen('loading', { busy: 1 })] }));
    expect(ok.code).toBe(0);
    expect(JSON.parse(readFileSync(join(root, '.fwos/local/runs/states/component.button.json'), 'utf8')).revision).toBeNull();
    // An IA run, judged against ia.json.
    const exposed = {
      role: 'member',
      flags: ['members-enabled'],
      applied: true,
      nav: ['/', '/members'],
      visits: [
        { page: 'list', path: '/', status: 200, finalPath: '/', notFound: false },
        { page: 'members', path: '/members', status: 200, finalPath: '/members', notFound: false },
      ],
    };
    const ia = cli(root, ['harness', 'record', 'ia', 'member+members-enabled', '--revision', revision], JSON.stringify({ config, observations: exposed }));
    expect(ia.code).toBe(1);
    expect(JSON.parse(ia.out).violations).toEqual([
      'member (members-enabled on) can open "members" (/members), which ia.json shows only to admin with members-enabled on',
      'the nav shows "members" (/members) to member (members-enabled on), which ia.json shows only to admin with members-enabled on',
    ]);
    // Refused: a target the harness doesn't run, observations of the wrong shape, no revision.
    expect(cli(root, ['harness', 'record', 'states', 'page.nowhere', '--revision', revision], '{"config":{},"observations":[]}')).toMatchObject({ code: 2, err: expect.stringMatching(/page\.nowhere isn't a state harness target/) });
    expect(cli(root, ['harness', 'record', 'ia', 'admin', '--revision', revision], '{"config":{},"observations":[]}')).toMatchObject({ code: 2, err: expect.stringMatching(/an IA run/) });
    expect(cli(root, ['harness', 'record', 'states', 'page.list'], '{}')).toMatchObject({ code: 2, err: expect.stringMatching(/Missing --revision/) });
  });

  it('says which runs still count', async () => {
    const root = await app();
    const revision = revisionOf(loadProject(root));
    cli(root, ['harness', 'record', 'states', 'page.list', '--revision', revision], JSON.stringify({ config: {}, observations: [seen('loading', { busy: 1 }), seen('ready')] }));
    expect((await fwos(root, 'harness', 'status')).out).toBe(
      [
        'states  apps/web/e2e/fwos-states.spec.ts  fwos\'s own',
        '  page.list  counts',
        'ia      apps/web/e2e/fwos-ia.spec.ts  fwos\'s own',
        '  (no runs yet)',
      ].join('\n'),
    );
    writeText(join(root, 'apps/web/src/screens/list.tsx'), 'export const ListScreen = () => null;\n');
    expect(JSON.parse((await fwos(root, 'harness', 'status', '--json')).out).runs).toEqual([{ kind: 'states', target: 'page.list', counts: false, why: 'the code changed since the harness ran' }]);
  });
});

describe('doctor', () => {
  it('reports platforms, tools, adapters and every check on or off', async () => {
    const root = tempProject({});
    await fwos(root, 'init', '--platforms', 'web,mac');
    const d = JSON.parse((await fwos(root, 'doctor', '--json')).out);
    expect(d.platforms.find((p: { platform: string }) => p.platform === 'mac')).toMatchObject({ status: 'unavailable', enabled: true });
    expect(d.tools.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(['Node.js', 'pnpm', 'git', 'Xcode']));
    expect(d.adapters.web.map((a: { adapter: string }) => a.adapter)).toEqual(['components', 'screens', 'fixtures', 'verify']);
    expect(d.checks.every((c: { on: boolean; reason?: string }) => c.on || c.reason)).toBe(true);
    expect(d.fwosCheckPin.note).toMatch(/not pinned/);
    // The supported distribution vendors the CLI into the app.
    expect(d.fwosCheckPin.note).toMatch(/fwos vendor.*pnpm add -D file:\.fwos\/cli/);
    expect(d.fwosCheckPin.note).not.toMatch(/add -D fwos-check/);
    writeText(join(root, 'package.json'), JSON.stringify({ devDependencies: { 'fwos-check': 'link:../frontend-web-os' } }));
    expect(JSON.parse((await fwos(root, 'doctor', '--json')).out).fwosCheckPin.note).toMatch(/link:\.\.\/frontend-web-os.*CI won't have/);
  });
});

describe('hooks dispatcher', () => {
  it('stays silent outside an fwos project', () => {
    const root = tempProject({});
    expect(dispatch('pre-tool-use', { tool_name: 'Write', cwd: root, tool_input: { file_path: join(root, 'apps/x.ts') } })).toEqual({ stdout: '', code: 0 });
  });

  it('emits Claude Code hook JSON for denies and context', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    const deny = JSON.parse(dispatch('pre-tool-use', { tool_name: 'Write', cwd: root, tool_input: { file_path: join(root, 'apps/web/src/x.ts') } }).stdout);
    expect(deny.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    const ctx = JSON.parse(dispatch('session-start', { cwd: root, session_id: 's1' }).stdout);
    expect(ctx.hookSpecificOutput.additionalContext).toMatch(/^fwos: change 0001-initial, step discovery/);
    expect(dispatch('pre-tool-use', { tool_name: 'Read', cwd: root, agent_type: 'fwos:test-planner' }).stdout).toMatch(/test planner/);
  });

  it('never breaks the session when state is unreadable: it answers, closes app source and leaves the repair open', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    writeText(join(root, '.fwos/state.json'), '{ broken');
    const write = (rel: string) => dispatch('pre-tool-use', { tool_name: 'Write', cwd: root, tool_input: { file_path: join(root, rel) } });
    const app = write('apps/web/src/x.ts');
    expect(app.code).toBe(0);
    expect(JSON.parse(app.stdout).hookSpecificOutput).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: expect.stringMatching(/couldn't read its state/) });
    for (const rel of ['.fwos/state.json', 'docs/app/brief.md']) {
      const r = write(rel);
      expect(r.code, rel).toBe(0);
      expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, rel).toMatch(/couldn't read its state/);
    }
  });
});

describe('the bundle', () => {
  const bundle = new URL('../../../dist/fwos.mjs', import.meta.url).pathname;

  it('exits quietly when the reader closes the pipe early', () => {
    const r = spawnSync('sh', ['-c', `node "${bundle}" help | head -1`]);
    expect(r.stdout.toString()).toMatch(/^fwos \d/);
    expect(r.stderr.toString()).toBe('');
  });

  it('runs and reads hook input from stdin', () => {
    expect(execFileSync(process.execPath, [bundle, 'version']).toString().trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const root = tempProject({ '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'new', platforms: ['web'] } });
    const r = spawnSync(process.execPath, [bundle, 'hook', 'pre-tool-use'], {
      input: JSON.stringify({ tool_name: 'Write', cwd: root, tool_input: { file_path: join(root, 'apps/web/src/a.ts') } }),
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.toString()).hookSpecificOutput.permissionDecision).toBe('deny');
  });
});

describe('the web scaffold', () => {
  it('vendors the CLI into .fwos/cli and pins it there, so install and CI need no registry package', async () => {
    const root = tempProject({});
    await fwos(root, 'init', '--name', 'Reads');
    expect((await fwos(root, 'scaffold', 'web')).code).toBe(0);
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['fwos-check']).toBe('file:.fwos/cli');
    expect(JSON.stringify(pkg)).not.toContain(pluginPath());
    expect(JSON.parse(readFileSync(join(root, '.fwos/cli/package.json'), 'utf8'))).toMatchObject({
      name: 'fwos-check',
      version: pluginVersion(),
      bin: { fwos: 'dist/fwos.mjs' },
    });
    expect(readFileSync(join(root, '.fwos/cli/dist/fwos.mjs')).equals(readFileSync(pluginPath('dist', 'fwos.mjs')))).toBe(true);
    for (const f of ['LICENSE', 'NOTICE', 'dist/THIRD-PARTY-LICENSES.txt']) expect(existsSync(join(root, '.fwos/cli', f))).toBe(true);
    expect(readdirSync(join(root, '.fwos/cli/modules/rules/pack'))).toEqual(readdirSync(pluginPath('modules/rules/pack')).filter((f) => f.endsWith('.yaml')).sort());
    const manifest = JSON.parse(readFileSync(join(root, '.fwos/manifest.json'), 'utf8'));
    expect(manifest.files['.fwos/cli/dist/fwos.mjs']).toMatchObject({ kind: 'fwos' });

    // The vendored copy runs on its own: its version, and the rule pack it reads from disk.
    const cli = (...args: string[]) => spawnSync(process.execPath, [join(root, '.fwos/cli/dist/fwos.mjs'), ...args], { cwd: root, encoding: 'utf8' });
    expect(cli('--version').stdout).toContain(pluginVersion());
    const pack = JSON.parse(cli('check', 'rules/pack', '--json').stdout).results.find((x: { id: string }) => x.id === 'rules/pack');
    expect(pack.status).toBe('pass');
    expect(JSON.parse((await fwos(root, 'doctor', '--json')).out).fwosCheckPin.note).toMatch(/vendored copy in \.fwos\/cli, same version/);
  });

  it('fwos vendor refreshes only the vendored CLI, never a file you deleted or own', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    await fwos(root, 'scaffold', 'web');
    rmSync(join(root, '.fwos/cli'), { recursive: true });
    rmSync(join(root, 'apps/web/e2e/home.spec.ts')); // the user removed a starter test
    const r = await fwos(root, 'vendor');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\.fwos\/cli/);
    expect(readFileSync(join(root, '.fwos/cli/dist/fwos.mjs')).equals(readFileSync(pluginPath('dist', 'fwos.mjs')))).toBe(true);
    expect(existsSync(join(root, 'apps/web/e2e/home.spec.ts'))).toBe(false);
  });

  it("fwos vendor won't replace a pin the project chose", async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    await fwos(root, 'scaffold', 'web', '--fwos-check', '^9.9.9');
    expect(await fwos(root, 'vendor')).toMatchObject({ code: 2, err: expect.stringMatching(/pins fwos-check to \^9\.9\.9/) });
    expect(existsSync(join(root, '.fwos/cli'))).toBe(false);
  });

  it('leaves the CLI out when the pin is given', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    await fwos(root, 'scaffold', 'web', '--fwos-check', '^9.9.9');
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies['fwos-check']).toBe('^9.9.9');
    expect(existsSync(join(root, '.fwos/cli'))).toBe(false);
  });

  it('passes its own walls when the architect wrote modules.json first, with no entry overrides', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    // The architecture step writes modules.json before the scaffold runs, and the scaffold never
    // overwrites it. So the template's modules must work with the default entry, index.ts.
    const template = JSON.parse(readFileSync(pluginPath('modules/screens/templates/web/docs/app/modules.json'), 'utf8'));
    const modules = template.modules.map(({ entry, ...m }: { entry?: string[]; name: string }) => (m.name === 'api-contract' ? { ...m, entry } : m));
    writeText(join(root, 'docs/app/modules.json'), JSON.stringify({ ...template, modules }));
    await fwos(root, 'scaffold', 'web');
    const r = await fwos(root, 'check', 'architecture/walls', '--json');
    const walls = JSON.parse(r.out).results.find((x: { id: string }) => x.id === 'architecture/walls');
    expect(walls.findings).toEqual([]);
    expect(walls.status).toBe('pass');
  });
});

describe('init --mode adopt', () => {
  it('records the app it finds, with where each value came from', async () => {
    const root = tempProject({
      'package.json': { dependencies: { next: '15.0.0' } },
      'components.json': { aliases: { ui: '@/components/ui' } },
      'app/page.tsx': '',
      'components/ui/button.tsx': '',
    });
    const r = await fwos(root, 'init', '--mode', 'adopt', '--name', 'Existing');
    expect(r.code).toBe(0);
    expect(r.out).toContain('UI components: components/ui  (components.json aliases.ui (@/components/ui))');
    expect(r.out).toContain('fwos baseline --init');
    const state = JSON.parse(readFileSync(join(root, '.fwos/state.json'), 'utf8'));
    expect(state.paths).toEqual({ apps: { web: '.' }, ui: { web: 'components/ui' }, source: ['app/**', 'components/**'] });
    expect((await fwos(root, 'check', 'state/schema')).code).toBe(0);
  });

  it('says what it could not find, and writes no paths it would have to guess', async () => {
    const root = tempProject({ 'package.json': { dependencies: { vite: '6.0.0' } } });
    const r = await fwos(root, 'init', '--mode', 'adopt');
    expect(r.out).toContain('Not found: a Next.js app');
    expect(JSON.parse(readFileSync(join(root, '.fwos/state.json'), 'utf8')).paths).toBeUndefined();
  });

  it('names what to run or write when a check is off, never a step an adopted app does not run', async () => {
    const root = tempProject({ 'package.json': { dependencies: { next: '15.0.0' } }, 'app/page.tsx': 'export default function Home() {\n  return null;\n}\n' });
    const init = await fwos(root, 'init', '--mode', 'adopt');
    expect(init.out).not.toMatch(/\bstep\b|0001-initial/);
    const { results } = JSON.parse((await fwos(root, 'check', '--json')).out) as { results: { id: string; status: string; reason?: string }[] };
    const off = results.filter((r) => r.status === 'off');
    expect(off.map((r) => r.id)).toEqual(expect.arrayContaining(['architecture/walls', 'screens/ia', 'spec/format', 'build/slices', 'state/approvals']));
    // No step names, and no /fwos:change, whose flow starts at the discovery step.
    for (const r of off) expect(r.reason, r.id).not.toMatch(/\bstep\b|test-planner|\/fwos:change/);
    expect((await fwos(root, 'doctor')).out).not.toMatch(/\bstep writes\b/);
    const next = JSON.parse((await fwos(root, 'next', '--json')).out) as { skill: string | null; action: string };
    expect(next).toMatchObject({ skill: null, action: expect.stringContaining('fwos baseline --init') });
    expect(next.action).not.toMatch(/\bstep\b|discovery/);
    await fwos(root, 'baseline', '--init');
    expect(JSON.parse((await fwos(root, 'next', '--json')).out).action).toMatch(/`fwos check`/);
    // A project fwos started keeps the step names.
    const fresh = tempProject({});
    await fwos(fresh, 'init');
    const started = JSON.parse((await fwos(fresh, 'check', '--json')).out) as { results: { id: string; reason?: string }[] };
    expect(started.results.find((r) => r.id === 'spec/format')?.reason).toBe('no docs/app/spec.md yet; the spec step writes it');
  });

  it('leaves a new project to the defaults', async () => {
    const root = tempProject({ 'package.json': { dependencies: { next: '15.0.0' } }, 'app/page.tsx': '' });
    const r = await fwos(root, 'init');
    expect(r.out).not.toContain('Found in your app');
    expect(JSON.parse(readFileSync(join(root, '.fwos/state.json'), 'utf8')).paths).toBeUndefined();
  });
});

describe('doctor: each adapter at 3 levels', () => {
  type Row = { adapter: string; loaded: boolean; matched: string | null; active: string | null; note?: string };
  const rows = async (root: string) => {
    const d = JSON.parse((await fwos(root, 'doctor', '--json')).out) as { adapters: { web: Row[] } };
    return Object.fromEntries(d.adapters.web.map((a) => [a.adapter, a])) as Record<string, Row>;
  };

  it('is never active without matching app data, and says where it looked', async () => {
    const root = tempProject({});
    await fwos(root, 'init', '--mode', 'adopt');
    const a = await rows(root);
    expect(a.components).toEqual({ adapter: 'components', loaded: true, matched: null, active: null, note: 'none in apps/web/src/shared/ui' });
    expect(a.screens).toMatchObject({ loaded: true, matched: null, active: null, note: 'no app yet' });
    expect(a.fixtures).toMatchObject({ loaded: true, matched: null, active: null, note: 'no openapi.yaml yet' });
    expect(a.verify).toMatchObject({ loaded: true, matched: null, active: null });
  });

  it('matches app data before a check can use it, then turns active with that check', async () => {
    const root = tempProject({
      'package.json': { dependencies: { next: '15.0.0' } },
      'components.json': { aliases: { ui: '@/components/ui' } },
      'app/page.tsx': 'export default function Home() {\n  return null;\n}\n',
      'app/settings/page.tsx': 'export default function Settings() {\n  return null;\n}\n',
      'components/ui/button.tsx': 'export const Button = () => null;\n',
    });
    await fwos(root, 'init', '--mode', 'adopt');
    let a = await rows(root);
    // Found in the app, but no registry or ia.json yet: matched, not active.
    expect(a.components).toEqual({ adapter: 'components', loaded: true, matched: '1 installed component', active: null });
    expect(a.screens).toEqual({ adapter: 'screens', loaded: true, matched: '2 routes', active: null });
    rmSync(join(root, 'app/settings'), { recursive: true });
    expect((await rows(root)).screens?.matched).toBe('1 route');
    await fwos(root, 'design-system', 'init');
    a = await rows(root);
    expect(a.components?.active).toBe('design-system/registry');
    // A contract with an operation is something to generate mocks from; the check that compares them turns on once they exist.
    writeText(
      join(root, 'packages/api-contract/openapi.yaml'),
      "openapi: 3.1.0\ninfo: { title: t, version: '1' }\npaths:\n  /items:\n    get:\n      operationId: listItems\n      responses:\n        '200': { description: ok }\n",
    );
    expect((await rows(root)).fixtures).toEqual({ adapter: 'fixtures', loaded: true, matched: 'mock fetch generated from the contract', active: null });
    await fwos(root, 'contract', 'mocks');
    expect((await rows(root)).fixtures?.active).toBe('architecture/mocks');
  });

  // Finding Playwright, its config and Chromium shows the verify loop can start, not that it ran: `doctor --start` runs it (doctor.test.ts).
  it("calls the verify driver installed, never active, unless doctor starts the app", async () => {
    const browsers = tempProject({ 'chromium-1200/INSTALLATION_COMPLETE': '' });
    const root = tempProject({
      'apps/web/package.json': { devDependencies: { '@playwright/test': '1.50.0' } },
      'apps/web/playwright.config.ts': 'export default {};\n',
      'apps/web/node_modules/@playwright/test/package.json': { name: '@playwright/test' },
    });
    await fwos(root, 'init');
    const before = process.env.PLAYWRIGHT_BROWSERS_PATH;
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
    try {
      expect((await rows(root)).verify).toEqual({
        adapter: 'verify',
        loaded: true,
        matched: '@playwright/test 1.50.0',
        active: null,
        note: 'installed, not started: `fwos doctor --start` starts the app and renders a state fixture before calling it active',
      });
    } finally {
      if (before === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
      else process.env.PLAYWRIGHT_BROWSERS_PATH = before;
    }
  });
});

it('hash requires at least one operand with actionable usage', async () => {
  const result = await fwos(tempProject(), 'hash');
  expect(result.code).toBe(2);
  expect(result.err).toMatch(/hash.*<file|usage|path/i);
  expect(result.out).toBe('');
});
