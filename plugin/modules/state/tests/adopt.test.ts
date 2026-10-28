// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// An adopted app's records: its level, the adoption record, approvals scoped to one change, the
// spec gate per level, and a baseline that covers checks by name and can't be widened by hand.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type CheckResult, loadProject, writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, contextFor, tempProject } from '../../../kernel/testing.ts';
import {
  approve,
  baselineAtHead,
  changeApprovalState,
  checks,
  createChange,
  currentChange,
  hooks,
  honouredBaseline,
  initProject,
  isAdoptionRecord,
  readBaseline,
  setAdoptLevel,
  strictCoverage,
  today,
  updateChange,
  writeBaseline,
} from '../index.ts';

afterAll(cleanupTempProjects);

const state = (root: string) => JSON.parse(readFileSync(join(root, '.fwos/state.json'), 'utf8'));
/** Records what the open change touches, as `fwos change map` would: a change's spec is approved only once it's mapped. */
const mapped = (root: string, file = 'apps/site/app/members/page.tsx') =>
  updateChange(root, (c) => {
    c.map = { targets: [{ target: '/members', file }], wrappers: [], files: [file], components: [], data: [], tests: [], owners: [], at: '2026-10-23T00:00:00.000Z' };
  });
const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const commit = (root: string) => {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--no-verify', '-m', 'snapshot');
};

function adopted(files: Record<string, string | object> = {}, paths: object = { apps: { web: '.' }, source: ['app/**'] }) {
  const root = tempProject(files);
  initProject(root, { mode: 'adopt', name: 'Existing', paths: paths as never });
  return root;
}

describe('the adoption level', () => {
  it('starts at checks, recorded with when it was set', () => {
    const root = adopted();
    expect(state(root).adopt).toEqual({ level: 'checks', history: [{ level: 'checks', at: today() }] });
    expect(loadProject(root).level).toBe('checks');
    expect(checks.find((c) => c.id === 'state/schema')!.run(contextFor(root))).toMatchObject({ status: 'pass' });
  });

  it('changes level without touching paths, changes or anything else in the state', () => {
    const root = adopted();
    const before = state(root);
    setAdoptLevel(root, 'delivery');
    const after = state(root);
    expect(after.adopt).toEqual({ level: 'delivery', history: [{ level: 'checks', at: today() }, { level: 'delivery', at: today() }] });
    expect({ ...after, adopt: before.adopt }).toEqual(before);
    expect(loadProject(root).level).toBe('delivery');
    expect(() => setAdoptLevel(root, 'everything' as never)).toThrow(/Unknown level "everything"/);
  });

  it('is only for adopted apps, and reads an adopted app from before levels as checks', () => {
    const fresh = tempProject();
    initProject(fresh);
    expect(loadProject(fresh).level).toBeNull();
    expect(() => setAdoptLevel(fresh, 'design')).toThrow(/only an adopted app has a level/);
    const legacy = tempProject({ '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'adopt', platforms: ['web'] } });
    expect(loadProject(legacy).level).toBe('checks');
  });

  it("gates only the adopted app's own files: its source for an app at the root, its folder and packages in a monorepo", () => {
    expect(loadProject(adopted()).paths.gated).toEqual(['app/**']);
    expect(loadProject(adopted({}, { apps: { web: 'apps/site' }, source: ['apps/site/app/**', 'packages/ui/src/**'] })).paths.gated).toEqual(['apps/site/**', 'packages/ui/src/**']);
    // A path set by hand wins.
    expect(loadProject(adopted({}, { apps: { web: '.' }, gated: ['src/features/**'] })).paths.gated).toEqual(['src/features/**']);
    expect(loadProject(adopted()).paths.allowedBeforeSpec).toEqual([]);
  });
});

describe('the adoption record', () => {
  it('is the first change of an adopted app, never a change of an app fwos started', () => {
    const root = adopted();
    const p = loadProject(root);
    expect(isAdoptionRecord(p, currentChange(root)!)).toBe(true);
    const c = createChange(root, { title: 'Add member search', route: 'touches-ac', step: 'spec' });
    expect(isAdoptionRecord(p, c)).toBe(false);
    const fresh = tempProject();
    initProject(fresh);
    expect(isAdoptionRecord(loadProject(fresh), currentChange(fresh)!)).toBe(false);
  });

  it('holds test coverage to acceptance strength while no change is open', () => {
    const root = adopted();
    expect(strictCoverage(root)).toBe(true);
    createChange(root, { title: 'Add member search', route: 'touches-ac', step: 'spec' });
    expect(strictCoverage(root)).toBe(false);
  });

  it('says at session start that the app is adopted, never "step discovery"', () => {
    const root = adopted();
    const summary = hooks.sessionStart![0]!;
    expect(summary({}, loadProject(root))?.context).toBe('fwos: adopted app (level checks). /fwos:status says what fwos checks here, and /fwos:adopt changes the level.');
    setAdoptLevel(root, 'delivery');
    createChange(root, { title: 'Add member search', route: 'touches-ac', step: 'spec' });
    expect(summary({}, loadProject(root))?.context).toBe('fwos: change 0002-add-member-search, step spec. Run /fwos:start to continue.');
  });
});

describe('approvals in an adopted change', () => {
  it("count only when that change recorded them: another change's approval is imported context", () => {
    const root = adopted({ 'docs/app/spec.md': 'spec v1', 'docs/app/test-plan.md': 'plan v1' });
    setAdoptLevel(root, 'delivery');
    const p = loadProject(root);
    const first = createChange(root, { title: 'Add member search', route: 'touches-ac', step: 'spec' });
    expect(() => approve(p, 'spec', 'Ada')).toThrow(/Map change 0002-add-member-search before its spec is approved/);
    mapped(root);
    approve(p, 'spec', 'Ada');
    expect(changeApprovalState(p, currentChange(root)!, 'spec')).toMatchObject({ status: 'approved', record: { by: 'Ada' } });
    updateChange(root, (c) => {
      c.status = 'done';
      c.step = 'done';
    });
    const second = createChange(root, { title: 'Add an empty state', route: 'touches-ac', step: 'spec' });
    expect(second.id).not.toBe(first.id);
    // The spec is unchanged and approved in the first change, which says nothing about the second.
    expect(changeApprovalState(p, currentChange(root)!, 'spec').status).toBe('missing');
    mapped(root);
    approve(p, 'spec', 'Ada');
    expect(changeApprovalState(p, currentChange(root)!, 'spec').status).toBe('approved');
    writeText(join(root, 'docs/app/spec.md'), 'spec v2');
    expect(changeApprovalState(p, currentChange(root)!, 'spec')).toMatchObject({ status: 'stale', changed: ['docs/app/spec.md'] });
  });
});

describe('the spec gate in an adopted app', () => {
  const edit = (root: string, file: string) => ({ tool_name: 'Write', tool_input: { file_path: join(root, file), content: 'x' } });
  const gate = hooks.preToolUse![0]!;
  const monorepo = { apps: { web: 'apps/site' }, source: ['apps/site/app/**'] };

  it('never blocks at the checks and design levels, apps/** in a monorepo included', () => {
    const root = adopted({}, monorepo);
    expect(gate(edit(root, 'apps/site/app/page.tsx'), loadProject(root))).toBeNull();
    expect(gate(edit(root, 'apps/admin/app/page.tsx'), loadProject(root))).toBeNull();
    setAdoptLevel(root, 'design');
    expect(gate(edit(root, 'apps/site/app/page.tsx'), loadProject(root))).toBeNull();
  });

  it("blocks only the adopted app, only while a change is open and its own spec isn't approved", () => {
    const root = adopted({ 'docs/app/spec.md': 's', 'docs/app/test-plan.md': 't' }, monorepo);
    setAdoptLevel(root, 'delivery');
    // No change open: work outside fwos goes on as before.
    expect(gate(edit(root, 'apps/site/app/page.tsx'), loadProject(root))).toBeNull();
    createChange(root, { title: 'Add member search', route: 'touches-ac', step: 'spec' });
    const p = loadProject(root);
    expect(gate(edit(root, 'apps/site/app/members/page.tsx'), p)?.deny).toMatch(/apps\/site\/app\/members\/page\.tsx is app source, and change 0002-add-member-search's spec and test plan aren't approved yet/);
    expect(gate(edit(root, 'apps/admin/app/page.tsx'), p)).toBeNull();
    expect(gate(edit(root, 'docs/app/spec.md'), p)).toBeNull();
    mapped(root);
    approve(p, 'spec', 'Ada');
    expect(gate(edit(root, 'apps/site/app/members/page.tsx'), p)).toBeNull();
  });

  it('lets a code-only change through, since it has no spec', () => {
    const root = adopted({}, monorepo);
    setAdoptLevel(root, 'delivery');
    createChange(root, { title: 'Fix a typo', route: 'code-only', step: 'build' });
    expect(gate(edit(root, 'apps/site/app/page.tsx'), loadProject(root))).toBeNull();
  });
});

describe('a baseline that names what it covers', () => {
  const run = (id: string, status: CheckResult['status'], n = 0): CheckResult => ({
    id,
    status,
    inputs: [],
    findings: Array.from({ length: n }, (_, i) => ({ file: `app/f${i}.tsx`, message: `raw colour #${i}` })),
  });

  it('records which checks ran, clean ones included, and when', () => {
    const root = adopted();
    writeBaseline(root, [run('rules/pack', 'fail', 2), run('web/security', 'pass'), run('design-system/tokens', 'off')], { init: true });
    expect(readBaseline(root)?.checks).toEqual({ 'rules/pack': today(), 'web/security': today() });
  });

  it('takes in a check that was off when it was recorded, and never widens one it covers', () => {
    const root = adopted();
    writeBaseline(root, [run('rules/pack', 'fail', 2), run('web/security', 'pass'), run('design-system/tokens', 'off')], { init: true });
    // design-system/tokens turned on (a design system arrived): its findings are debt it never saw.
    expect(writeBaseline(root, [run('rules/pack', 'fail', 2), run('web/security', 'pass'), run('design-system/tokens', 'fail', 3)])).toEqual({
      removed: 0,
      total: 5,
      added: [{ id: 'design-system/tokens', count: 3 }],
    });
    expect(Object.keys(readBaseline(root)!.checks!)).toEqual(['design-system/tokens', 'rules/pack', 'web/security']);
    // A check that was clean when recorded covers nothing, so a finding there is new.
    expect(() => writeBaseline(root, [run('rules/pack', 'fail', 2), run('web/security', 'fail', 1), run('design-system/tokens', 'fail', 3)])).toThrow(/only shrink; 1 finding is new/);
    expect(() => writeBaseline(root, [run('rules/pack', 'fail', 2), run('web/security', 'pass'), run('design-system/tokens', 'fail', 4)])).toThrow(/only shrink/);
  });

  it('never takes in a check for a baseline written before it named its checks', () => {
    const root = adopted();
    writeText(join(root, '.fwos/baseline.json'), JSON.stringify({ schema: 1, createdAt: '2026-01-01', findings: {} }));
    expect(() => writeBaseline(root, [run('design-system/tokens', 'fail', 1)])).toThrow(/only shrink/);
  });

  it('honours no more of a covered check than the last commit holds', () => {
    const head = { schema: 1 as const, createdAt: '2026-10-01', checks: { 'rules/pack': '2026-10-01' }, findings: { 'rules/pack': { 'rules/pack|a.tsx||x': 1 } } };
    const working = {
      ...head,
      checks: { ...head.checks, 'design-system/tokens': '2026-10-02' },
      findings: { 'rules/pack': { 'rules/pack|a.tsx||x': 3, 'rules/pack|b.tsx||y': 1 }, 'design-system/tokens': { 'design-system/tokens|c.tsx||z': 2 } },
    };
    expect(honouredBaseline(working, head)).toEqual({
      baseline: { ...working, findings: { 'rules/pack': { 'rules/pack|a.tsx||x': 1 }, 'design-system/tokens': { 'design-system/tokens|c.tsx||z': 2 } } },
      widened: { 'rules/pack': 3 },
    });
    expect(honouredBaseline(working, null)).toEqual({ baseline: working, widened: {} });
  });

  it("reads the last commit's baseline from git, and won't start a new one over it", () => {
    const root = adopted();
    git(root, 'init', '-q');
    expect(baselineAtHead(root)).toBeNull();
    writeBaseline(root, [run('rules/pack', 'fail', 1)], { init: true });
    commit(root);
    expect(baselineAtHead(root)?.findings).toEqual(readBaseline(root)?.findings);
    rmSync(join(root, '.fwos/baseline.json'));
    expect(() => writeBaseline(root, [run('rules/pack', 'fail', 2)], { init: true })).toThrow(/The last commit has a baseline/);
  });
});
