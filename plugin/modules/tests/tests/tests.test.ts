// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type CheckResult, adapterSet, loadProject, writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, syntheticTestRun, tempProject } from '../../../kernel/testing.ts';
import { createChange, initProject, updateChange } from '../../state/index.ts';
import { checks, hooks, isLocked, lockTests, lockedFiles, parseTestPlan, unlockTest } from '../index.ts';
import { expired } from '../quarantine.ts';

afterAll(cleanupTempProjects);

const spec = `## 10. Acceptance criteria
### AC-list-1: Save a link
- Proven against: local
### AC-list-2: Mark read
- Proven against: local
### AC-list-3: Later thing
- Proven against: local
- Release: later
### AC-list-4: Screen reader
- Proven against: real
- Manual: needs a person using VoiceOver
`;

const defaults = ['crawl', 'a11y', 'keyboard', 'themes', 'phone', 'prod']
  .map((r) => `### TC-default-${r}: ${r}\n- Level: e2e\n`)
  .join('\n');

const plan = `# Test plan
### TC-list-1: saves a link
- AC: AC-list-1
- Level: component
- Platform: web
- Status: new

### TC-list-2: marks read
- AC: AC-list-2, AC-list-1
- Level: e2e
- Status: existing

### TC-list-4: VoiceOver walkthrough
- AC: AC-list-4
- Level: manual
- Status: new

### GAP-1: Real sync service
- Missing: no staging account for the sync API

${defaults}`;

const run = async (id: string, root: string) =>
  (await checks.find((c) => c.id === id)!.run({ project: loadProject(root), adapters: adapterSet([]) })) as CheckResult;

describe('parseTestPlan', () => {
  it('reads cases with their ACs, level and status, and named gaps', () => {
    const { cases, gaps } = parseTestPlan(plan);
    expect(cases[1]).toMatchObject({ id: 'TC-list-2', acs: ['AC-list-2', 'AC-list-1'], level: 'e2e', status: 'existing' });
    expect(gaps).toEqual([{ id: 'GAP-1', title: 'Real sync service', line: 18, missing: 'no staging account for the sync API' }]);
  });
});

describe('off, never a pass on nothing', () => {
  it('tests/plan is off with no test plan, tests/locked with no locked tests', async () => {
    expect((await run('tests/plan', tempProject({ 'docs/app/spec.md': spec }))).status).toBe('off');
    const root = tempProject({});
    initProject(root);
    const locked = await run('tests/locked', root);
    expect(locked.status).toBe('off');
    expect(locked.reason).toMatch(/no locked tests yet/);
    expect((await run('tests/locked', tempProject({}))).reason).toBe('not an fwos project');
  });
});

describe('tests/plan', () => {
  it('passes when every first-release AC has a case and the default rows exist', async () => {
    const r = await run('tests/plan', tempProject({ 'docs/app/spec.md': spec, 'docs/app/test-plan.md': plan }));
    expect(r.findings).toEqual([]);
  });

  it('catches uncovered ACs, unknown ACs, bad levels and statuses, and missing default rows', async () => {
    const bad = `### TC-x-1: a
- AC: AC-list-9
- Level: smoke
### TC-x-2: b
- Level: unit
- Status: new
### TC-list-4: manual only
- AC: AC-list-2
- Level: manual
- Status: new
`;
    const r = await run('tests/plan', tempProject({ 'docs/app/spec.md': spec, 'docs/app/test-plan.md': bad }));
    expect(r.findings.map((f) => f.rule)).toEqual([
      'case-ac',
      'level',
      'status',
      'case-ac',
      'coverage',
      'coverage',
      'coverage',
      ...Array(6).fill('default-row'),
    ]);
  });
});

const xml = (cases: string) => `<?xml version="1.0"?><testsuites><testsuite name="s">${cases}</testsuite></testsuites>`;

describe('tests/traceability', () => {
  it('is off until the tests have run', async () => {
    expect((await run('tests/traceability', tempProject({ 'docs/app/spec.md': spec }))).reason).toMatch(/run the tests first/);
  });

  it('fails at acceptance with no results at all, and stays off before it', async () => {
    const root = tempProject({ 'docs/app/spec.md': spec });
    initProject(root);
    expect((await run('tests/traceability', root)).status).toBe('off');
    updateChange(root, (c) => {
      c.step = 'accept';
    });
    const r = await run('tests/traceability', root);
    expect(r.status).toBe('fail');
    expect(r.findings[0]!.message).toMatch(/no first-release AC is proven \(AC-list-1, AC-list-2\)/);
  });

  it('proves ACs from passing tagged tests only', async () => {
    const root = tempProject({
      'docs/app/spec.md': spec,
      '.fwos/local/results/vitest.xml': xml(`
        <testcase classname="list.test.tsx" name="saves a link @AC-list-1"/>
        <testcase classname="list.test.tsx" name="marks read @AC-list-2"><failure message="expected Read tab">AssertionError</failure></testcase>
        <testcase classname="list.test.tsx" name="old @AC-list-99"/>
        <testcase classname="list.test.tsx" name="not @AC-list-10 either"/>`),
    });
    const r = await run('tests/traceability', root);
    expect(r.findings.map((f) => f.message)).toEqual([
      'AC-list-2: failing (expected Read tab)',
      '"old @AC-list-99" is tagged @AC-list-99, which the spec doesn\'t define',
      '"not @AC-list-10 either" is tagged @AC-list-10, which the spec doesn\'t define',
    ]);
    expect(r.info).toEqual(['1 proven, 1 failing, 1 not-run, 1 manual']);
  });

  it("doesn't count quarantined or flaky passes, and fails on an expired quarantine", async () => {
    const root = tempProject({
      'docs/app/spec.md': spec,
      '.fwos/quarantine.json': { schema: 1, tests: [{ match: '@AC-list-1', reason: 'flaky clock', by: 'Ada', until: '2000-01-01' }] },
      '.fwos/local/results/e2e.xml': xml(`
        <testcase classname="e2e" name="saves @AC-list-1"/>
        <testcase classname="e2e" name="marks @AC-list-2"><failure message="timeout"/></testcase>
        <testcase classname="e2e" name="marks @AC-list-2"/>`),
    });
    const r = await run('tests/traceability', root);
    expect(r.findings.map((f) => f.message)).toEqual([
      "AC-list-1: only quarantined tests ran, so it's not proven",
      'AC-list-2: failing (timeout)',
      'quarantine of "@AC-list-1" expired on 2000-01-01; fix the test (no fixed sleeps) or remove it',
    ]);
  });
});

describe('what proves an AC', () => {
  /** An initialised project at acceptance, where a missing proof fails instead of waiting. */
  function atAccept(files: Record<string, unknown>) {
    const root = tempProject({ 'docs/app/spec.md': spec, ...files });
    initProject(root);
    updateChange(root, (c) => {
      c.step = 'accept';
    });
    // These parser/trace fixtures intentionally stand in for a current test execution.
    syntheticTestRun(root);
    return root;
  }
  const messages = async (root: string) => (await run('tests/traceability', root)).findings.map((f) => f.message);

  it.each(['input', 'result'] as const)('rejects synthetic evidence after its %s bytes change', async (changed) => {
    const root = atAccept({
      'apps/web/app/page.tsx': 'export default function Page() { return null; }',
      '.fwos/local/results/v.xml': xml(`<testcase classname="t" name="a @AC-list-1"/><testcase classname="t" name="b @AC-list-2"/>`),
    });
    expect(await messages(root)).toEqual([]);
    if (changed === 'input') writeText(join(root, 'apps/web/app/page.tsx'), 'export default function Page() { return "changed"; }');
    else writeText(join(root, '.fwos/local/results/v.xml'), xml(`<testcase classname="t" name="new a @AC-list-1"/><testcase classname="t" name="new b @AC-list-2"/>`));
    // A check must not bind these bytes again: only another deliberately recorded run can do that.
    expect(await messages(root)).toEqual([
      'no test results in .fwos/local/results/**/*.xml, so no first-release AC is proven (AC-list-1, AC-list-2); run the tests first',
    ]);
  });

  it('never counts a skipped test', async () => {
    const root = atAccept({
      '.fwos/local/results/v.xml': xml(`<testcase classname="t" name="a @AC-list-1"><skipped/></testcase><testcase classname="t" name="b @AC-list-2"/>`),
    });
    expect(await messages(root)).toEqual(['AC-list-1: no test ran (tag a test @AC-list-1)']);
  });

  it('treats <error> as a failure', async () => {
    const root = atAccept({
      '.fwos/local/results/v.xml': xml(`<testcase classname="t" name="a @AC-list-1"><error message="boom"/></testcase><testcase classname="t" name="b @AC-list-2"/>`),
    });
    expect(await messages(root)).toEqual(['AC-list-1: failing (boom)']);
  });

  it('fails an AC when one of its tests fails, even beside a passing one', async () => {
    const root = atAccept({
      '.fwos/local/results/v.xml': xml(`
        <testcase classname="t" name="a @AC-list-1"/>
        <testcase classname="t" name="b @AC-list-1"><failure message="wrong order"/></testcase>
        <testcase classname="t" name="c @AC-list-2"/>`),
    });
    expect(await messages(root)).toEqual(['AC-list-1: failing (wrong order)']);
  });

  it('matches a tag as a whole word, so @AC-list-10 never proves AC-list-1', async () => {
    const root = atAccept({
      '.fwos/local/results/v.xml': xml(`<testcase classname="t" name="a @AC-list-10"/><testcase classname="t" name="b @AC-list-2"/>`),
    });
    expect(await messages(root)).toEqual([
      'AC-list-1: no test ran (tag a test @AC-list-1)',
      '"a @AC-list-10" is tagged @AC-list-10, which the spec doesn\'t define',
    ]);
  });

  it('matches a tag as a whole id, so @AC-list-1-2 and @AC-list-1.5 never prove AC-list-1 and are named as unknown', async () => {
    const root = atAccept({
      '.fwos/local/results/v.xml': xml(`<testcase classname="t" name="a @AC-list-1-2"/><testcase classname="t" name="c @AC-list-1.5"/><testcase classname="t" name="b @AC-list-2."/>`),
    });
    expect(await messages(root)).toEqual([
      'AC-list-1: no test ran (tag a test @AC-list-1)',
      '"a @AC-list-1-2" is tagged @AC-list-1-2, which the spec doesn\'t define',
      '"c @AC-list-1.5" is tagged @AC-list-1.5, which the spec doesn\'t define',
    ]);
  });

  it('fails an AC whose tagged test fails, even when a > in its name was left unescaped', async () => {
    const root = atAccept({
      '.fwos/local/results/v.xml': xml(
        `<testcase classname="t" name="a @AC-list-1"/><testcase classname="t" name="b @AC-list-1 when 2 > 1"><failure message="boom"/></testcase><testcase classname="t" name="c @AC-list-2"/>`,
      ),
    });
    expect(await messages(root)).toEqual(['AC-list-1: failing (boom)']);
  });
});

describe('counts and reasons', () => {
  const oneAc = '## 10. Acceptance criteria\n### AC-list-1: Save a link\n- Proven against: local\n';
  const onePlan = '### TC-list-1: saves\n- AC: AC-list-1\n- Level: component\n- Status: new\n';

  it('counts one of a thing in the singular', async () => {
    expect((await run('tests/plan', tempProject({ 'docs/app/spec.md': oneAc, 'docs/app/test-plan.md': onePlan }))).info).toEqual(['1 case for 1 AC']);
    expect((await run('tests/plan', tempProject({ 'docs/app/spec.md': spec, 'docs/app/test-plan.md': plan }))).info).toEqual(['9 cases for 4 ACs']);
    const root = tempProject({ 'apps/web/e2e/list.spec.ts': 'test("b @AC-list-1", () => {})' });
    initProject(root);
    lockTests(loadProject(root), ['apps/web/e2e/list.spec.ts'], { evidence: 'existing' });
    expect((await run('tests/locked', root)).info).toEqual(['1 locked file']);
  });

  it('says what an adopted app lacks, never a step, when it has no test plan or locked tests yet', async () => {
    const root = tempProject({ 'docs/app/spec.md': oneAc });
    initProject(root, { mode: 'adopt' });
    expect((await run('tests/plan', root)).reason).toBe('no docs/app/test-plan.md yet; a change delivered through fwos writes its test delta there');
    expect((await run('tests/locked', root)).reason).toBe('no locked tests yet; at level delivery, a change locks the tests it adds or changes, never the suite you have');
    const fresh = tempProject({ 'docs/app/spec.md': oneAc });
    initProject(fresh);
    expect((await run('tests/plan', fresh)).reason).toBe('no docs/app/test-plan.md yet; the test-planner writes it in the spec step');
    expect((await run('tests/locked', fresh)).reason).toBe("no locked tests yet; the build step locks each slice's tests");
  });
});

describe('quarantine', () => {
  const twoAcs = `## 10. Acceptance criteria\n### AC-list-1: Save\n- Proven against: local\n### AC-list-11: Sort\n- Proven against: local\n`;
  const future = '2999-01-01';

  it('matches whole words, so quarantining @AC-list-1 leaves @AC-list-11 alone', async () => {
    const root = tempProject({
      'docs/app/spec.md': twoAcs,
      '.fwos/quarantine.json': { schema: 1, tests: [{ match: '@AC-list-1', reason: 'flaky', by: 'Ada', until: future }] },
      '.fwos/local/results/v.xml': xml(`<testcase classname="t" name="a @AC-list-1"/><testcase classname="t" name="b @AC-list-11"><failure message="B is broken"/></testcase>`),
    });
    initProject(root);
    expect((await run('tests/traceability', root)).findings.map((f) => f.message)).toEqual([
      "AC-list-1: only quarantined tests ran, so it's not proven",
      'AC-list-11: failing (B is broken)',
    ]);
  });

  it('matches whole words at the start too, so quarantining "saves" leaves "autosaves" alone', async () => {
    const root = tempProject({
      'docs/app/spec.md': twoAcs,
      '.fwos/quarantine.json': { schema: 1, tests: [{ match: 'saves', reason: 'flaky', by: 'Ada', until: future }] },
      '.fwos/local/results/v.xml': xml(`<testcase classname="t" name="autosaves @AC-list-1"/><testcase classname="t" name="sorts @AC-list-11"/>`),
    });
    expect((await run('tests/traceability', root)).findings).toEqual([]);
  });

  it('reports a malformed quarantine file even before any test has run', async () => {
    const root = tempProject({ 'docs/app/spec.md': twoAcs, '.fwos/quarantine.json': { schema: 1, tests: [{ match: 'saves' }] } });
    const r = await run('tests/traceability', root);
    expect(r.status).toBe('fail');
    expect(r.findings.every((f) => f.rule === 'quarantine')).toBe(true);
  });

  it("doesn't let a quarantined test that failed read as not run during the build", async () => {
    const root = tempProject({
      'docs/app/spec.md': twoAcs,
      '.fwos/quarantine.json': { schema: 1, tests: [{ match: '@AC-list-1', reason: 'flaky', by: 'Ada', until: future }] },
      '.fwos/local/results/v.xml': xml(`<testcase classname="t" name="a @AC-list-1"><failure message="broken"/></testcase><testcase classname="t" name="b @AC-list-11"/>`),
    });
    initProject(root);
    updateChange(root, (c) => {
      c.step = 'build';
    });
    const r = await run('tests/traceability', root);
    expect(r.findings.map((f) => f.message)).toEqual(["AC-list-1: only quarantined tests ran, so it's not proven"]);
    expect((r.info ?? []).join(' ')).not.toMatch(/pending/);
  });

  it('needs a readable expiry date, and treats a missing or unreadable one as expired', async () => {
    const root = tempProject({
      'docs/app/spec.md': twoAcs,
      '.fwos/quarantine.json': { schema: 1, tests: [{ match: 'saves', reason: 'flaky', by: 'Ada' }, { match: 'sorts', reason: 'flaky', by: 'Ada', until: 'next sprint' }] },
      '.fwos/local/results/v.xml': xml(`<testcase classname="t" name="a @AC-list-1"/><testcase classname="t" name="b @AC-list-11"/>`),
    });
    const msgs = (await run('tests/traceability', root)).findings.map((f) => f.message);
    expect(msgs.filter((m) => m.startsWith('/tests/'))).toHaveLength(2);
    expect(msgs.filter((m) => m.includes('expired'))).toHaveLength(2);
    expect(expired([{ match: 'x', reason: 'r', by: 'b', until: '2026-10-08' }], '2026-10-08')).toEqual([]);
    expect(expired([{ match: 'x', reason: 'r', by: 'b', until: '2026-10-07' }], '2026-10-08')).toHaveLength(1);
  });
});

describe('locked tests', () => {
  function project(results?: string) {
    const root = tempProject({
      'apps/web/src/features/list/list.test.tsx': 'test("a @AC-list-1", () => {})',
      'apps/web/e2e/list.spec.ts': 'test("b @AC-list-2", () => {})',
      ...(results ? { '.fwos/local/results/vitest.xml': results } : {}),
    });
    initProject(root);
    return { root, project: loadProject(root) };
  }

  it('needs a red run for new tests, unless the behaviour already exists', () => {
    const { project: p } = project(
      xml(`<testcase classname="apps/web/src/features/list/list.test.tsx" name="a @AC-list-1"><failure message="not implemented"/></testcase>
           <testcase classname="list.spec.ts" name="b"/>`),
    );
    expect(lockTests(p, ['apps/web/src/features/list/list.test.tsx'], { evidence: 'red', slice: 'S1' }).failing).toEqual(['a @AC-list-1']);
    expect(() => lockTests(p, ['apps/web/e2e/list.spec.ts'], { evidence: 'red' })).toThrow(/no failing test/);
    lockTests(p, ['apps/web/e2e/list.spec.ts'], { evidence: 'existing' });
    expect(lockedFiles(p).map((l) => l.status)).toEqual(['ok', 'ok']);
  });

  it('takes an absolute path inside the project and refuses one outside it', () => {
    const { root, project: p } = project();
    lockTests(p, [join(root, 'apps/web/e2e/list.spec.ts')], { evidence: 'existing' });
    expect(lockedFiles(p).map((l) => l.path)).toEqual(['apps/web/e2e/list.spec.ts']);
    expect(() => lockTests(p, ['../outside.spec.ts'], { evidence: 'existing' })).toThrow(/outside the project/);
  });

  it('refuses to lock nothing', () => {
    const { project: p } = project();
    expect(() => lockTests(p, [], { evidence: 'existing' })).toThrow(/Name the test files/);
  });

  it('refuses a red lock with no results at all', () => {
    const { project: p } = project();
    expect(() => lockTests(p, ['apps/web/e2e/list.spec.ts'], { evidence: 'red' })).toThrow(/No test results/);
  });

  it('fails the check when a locked test changes by any means, and allows it after an unlock', async () => {
    const { root, project: p } = project();
    lockTests(p, ['apps/web/e2e/list.spec.ts'], { evidence: 'existing' });
    expect((await run('tests/locked', root)).status).toBe('pass');
    writeText(join(root, 'apps/web/e2e/list.spec.ts'), 'test.skip("b", () => {})');
    const r = await run('tests/locked', root);
    expect(r.findings.map((f) => f.rule)).toEqual(['changed']);
    expect(() => unlockTest(p, 'apps/web/e2e/list.spec.ts', '', 'Ada')).toThrow(/reason/);
    unlockTest(p, 'apps/web/e2e/list.spec.ts', 'the AC changed in 0002', 'Ada');
    const after = await run('tests/locked', root);
    expect(after.status).toBe('pass');
    expect(after.info).toContain('apps/web/e2e/list.spec.ts unlocked by Ada: the AC changed in 0002');
    lockTests(p, ['apps/web/e2e/list.spec.ts'], { evidence: 'existing' });
    expect(isLocked(p, 'apps/web/e2e/list.spec.ts')).toBe(true);
  });

  it('re-arms the lock when a later change locks the file again', async () => {
    const { root, project: p } = project();
    lockTests(p, ['apps/web/e2e/list.spec.ts'], { evidence: 'existing' });
    unlockTest(p, 'apps/web/e2e/list.spec.ts', 'typo in the test', 'Ana');
    createChange(root, { title: 'next', route: 'code-only', step: 'build' });
    lockTests(loadProject(root), ['apps/web/e2e/list.spec.ts'], { evidence: 'existing' });
    writeText(join(root, 'apps/web/e2e/list.spec.ts'), "test('a', () => {});");
    expect((await run('tests/locked', root)).findings.map((f) => f.rule)).toEqual(['changed']);
    expect(isLocked(loadProject(root), 'apps/web/e2e/list.spec.ts')).toBe(true);
  });

  it('reads every spelling of a locked path the same way', () => {
    const { root, project: p } = project();
    lockTests(p, ['./apps/web/e2e/list.spec.ts'], { evidence: 'existing' });
    expect(lockedFiles(p).map((l) => l.path)).toEqual(['apps/web/e2e/list.spec.ts']);
    expect(isLocked(p, 'apps/web/e2e/list.spec.ts')).toBe(true);
    const [, guard] = hooks.preToolUse!;
    for (const file_path of [join(root, 'apps/web/e2e/list.spec.ts'), `${root}/docs/../apps/web/e2e/list.spec.ts`, `${root}//apps/web/e2e/list.spec.ts`]) {
      expect(guard!({ tool_name: 'Edit', tool_input: { file_path } }, p)?.deny, file_path).toMatch(/is a locked test/);
    }
    unlockTest(p, 'apps/web/e2e//list.spec.ts', 'the AC changed', 'Ana');
    expect(isLocked(p, 'apps/web/e2e/list.spec.ts')).toBe(false);
  });

  it('fails when a lock the last commit holds is gone from the change files, or locked again at another hash, with no unlock since', async () => {
    const { root, project: p } = project();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    git('init', '-q');
    lockTests(p, ['apps/web/e2e/list.spec.ts', 'apps/web/src/features/list/list.test.tsx'], { evidence: 'existing' });
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'lock');
    expect((await run('tests/locked', root)).status).toBe('pass');
    // The two-edit bypass, by a shell: the lock record edited out, then the test bent.
    const file = join(root, '.fwos/changes/0001-initial.json');
    const committed = readFileSync(file, 'utf8');
    const edit = (f: (c: { lockedTests: Record<string, { sha: string }> }) => void) => {
      const c = JSON.parse(committed);
      f(c);
      writeFileSync(file, JSON.stringify(c));
    };
    edit((c) => delete c.lockedTests['apps/web/e2e/list.spec.ts']);
    writeText(join(root, 'apps/web/e2e/list.spec.ts'), 'test.skip("b", () => {})');
    let r = await run('tests/locked', root);
    expect(r.status).toBe('fail');
    expect(r.findings).toEqual([{ file: 'apps/web/e2e/list.spec.ts', rule: 'vanished', message: expect.stringMatching(/the last commit locks it \(in 0001-initial\)/) }]);
    // Every lock gone fails too: it isn't "no locked tests yet".
    edit((c) => (c.lockedTests = {}));
    r = await run('tests/locked', root);
    expect(r.status).toBe('fail');
    expect(r.findings.map((f) => f.rule)).toEqual(['vanished', 'vanished']);
    // Locked again at the bent test's hash, with no unlock: the lock is laundered, not kept.
    writeFileSync(file, committed);
    lockTests(loadProject(root), ['apps/web/e2e/list.spec.ts'], { evidence: 'existing' });
    expect((await run('tests/locked', root)).findings.map((f) => `${f.file}:${f.rule}`)).toEqual(['apps/web/e2e/list.spec.ts:rehashed']);
    // With an unlock recorded since the commit, the same new hash is the normal path.
    unlockTest(loadProject(root), 'apps/web/e2e/list.spec.ts', 'the AC changed', 'Ada');
    lockTests(loadProject(root), ['apps/web/e2e/list.spec.ts'], { evidence: 'existing' });
    expect((await run('tests/locked', root)).status).toBe('pass');
  });

  it('reports a deleted locked test', async () => {
    const { root, project: p } = project();
    lockTests(p, ['apps/web/e2e/list.spec.ts'], { evidence: 'existing' });
    const { rmSync } = await import('node:fs');
    rmSync(join(root, 'apps/web/e2e/list.spec.ts'));
    expect((await run('tests/locked', root)).findings.map((f) => f.rule)).toEqual(['missing']);
  });

  it('blocks edits to locked tests and every tool call from the test planner', () => {
    const { root, project: p } = project();
    lockTests(p, ['apps/web/e2e/list.spec.ts'], { evidence: 'existing' });
    const [planner, guard] = hooks.preToolUse!;
    const edit = { tool_name: 'Edit', tool_input: { file_path: join(root, 'apps/web/e2e/list.spec.ts') } };
    expect(guard!(edit, p)?.deny).toMatch(/is a locked test/);
    expect(guard!({ ...edit, tool_input: { file_path: join(root, 'apps/web/src/x.ts') } }, p)).toBeNull();
    expect(planner!({ tool_name: 'Read', agent_type: 'fwos:test-planner' }, p)?.deny).toMatch(/test planner/);
    for (const tool of ['Bash', 'ToolSearch', 'ListAgents', 'WebFetch']) {
      expect(planner!({ tool_name: tool, agent_type: 'fwos:test-planner' }, p)?.deny).toMatch(/test planner/);
    }
    // In auto mode a subagent returns its result through SubagentHandback; blocking it loses the plan.
    expect(planner!({ tool_name: 'SubagentHandback', agent_type: 'fwos:test-planner' }, p)).toBeNull();
    expect(planner!({ tool_name: 'Read', agent_type: 'builder' }, p)).toBeNull();
    expect(planner!({ tool_name: 'Read' }, p)).toBeNull();
  });
});
