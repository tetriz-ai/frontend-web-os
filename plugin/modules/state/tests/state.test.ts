// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fingerprint, loadProject, writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, contextFor, tempProject } from '../../../kernel/testing.ts';
import {
  acquireLock,
  applyBaseline,
  approvalState,
  approve,
  checks,
  createChange,
  currentChange,
  docStaleness,
  ensureGitignore,
  hooks,
  initProject,
  listChanges,
  now,
  readLock,
  releaseLock,
  satisfied,
  skip,
  slugify,
  stampBasedOn,
  updateChange,
  writeBaseline,
  writeOwned,
  writeOwnedAll,
  writeYours,
} from '../index.ts';

afterAll(cleanupTempProjects);

const check = (id: string) => checks.find((c) => c.id === id)!;

function newProject(files: Record<string, string> = {}) {
  const root = tempProject(files);
  initProject(root, { name: 'Test app' });
  return { root, project: loadProject(root) };
}

describe('init', () => {
  it('creates state, manifest, provenance and the first change', () => {
    const { root } = newProject();
    const changes = listChanges(root);
    expect(changes.map((c) => c.id)).toEqual(['0001-initial']);
    expect(changes[0]!.step).toBe('discovery');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.fwos/local/');
  });

  it('refuses to run twice', () => {
    const { root } = newProject();
    expect(() => initProject(root)).toThrow(/already has/);
  });

  it('adds the gitignore line only once', () => {
    const root = tempProject({ '.gitignore': 'node_modules' });
    expect(ensureGitignore(root)).toBe(true);
    expect(ensureGitignore(root)).toBe(false);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules\n# fwos: evidence, run logs and test results (local only)\n.fwos/local/\n',
    );
  });
});

describe('changes', () => {
  it('numbers changes and picks the route entry step', () => {
    const { root } = newProject();
    updateChange(root, (c) => {
      c.status = 'done';
      c.step = 'done';
    });
    const c = createChange(root, { title: 'Add a filter to the list', route: 'touches-ac', step: 'spec' });
    expect(c.id).toBe('0002-add-a-filter-to-the-list');
    expect(c.step).toBe('spec');
    expect(currentChange(root)?.id).toBe(c.id);
  });

  it('returns null when every change is done', () => {
    const { root } = newProject();
    updateChange(root, (c) => {
      c.status = 'done';
    });
    expect(currentChange(root)).toBeNull();
  });

  it('slugifies titles', () => {
    expect(slugify('  Add "sharing" -- now!  ')).toBe('add-sharing-now');
    expect(slugify('!!!')).toBe('change');
  });
});

describe('approvals', () => {
  it('goes missing -> approved -> stale on a hand edit -> approved again', () => {
    const { root, project } = newProject({ 'docs/app/brief.md': '# Brief\n' });
    expect(approvalState(project, 'brief').status).toBe('missing');
    approve(project, 'brief', 'Ada');
    expect(approvalState(project, 'brief').status).toBe('approved');
    writeText(join(root, 'docs/app/brief.md'), '# Brief\nchanged\n');
    const stale = approvalState(project, 'brief');
    expect(stale.status).toBe('stale');
    expect(stale.changed).toEqual(['docs/app/brief.md']);
    approve(project, 'brief', 'Ada');
    expect(approvalState(project, 'brief').status).toBe('approved');
  });

  it('compares content, not timestamps: rewriting identical content keeps the approval', () => {
    const { root, project } = newProject({ 'docs/app/brief.md': '# Brief\n' });
    approve(project, 'brief', 'Ada');
    writeText(join(root, 'docs/app/brief.md'), '# Brief\n');
    writeText(join(root, 'docs/app/brief.md'), '# Brief\r\n');
    expect(approvalState(project, 'brief').status).toBe('approved');
  });

  it('approves the spec and test plan together, and either edit makes it stale', () => {
    const { root, project } = newProject({ 'docs/app/spec.md': 'spec', 'docs/app/test-plan.md': 'plan' });
    approve(project, 'spec', 'Ada');
    writeText(join(root, 'docs/app/test-plan.md'), 'plan v2');
    expect(approvalState(project, 'spec').changed).toEqual(['docs/app/test-plan.md']);
  });

  it("won't approve a missing doc", () => {
    const { project } = newProject({ 'docs/app/spec.md': 'spec' });
    expect(() => approve(project, 'spec', 'Ada')).toThrow(/test-plan.md doesn't exist/);
    expect(approvalState(project, 'spec').status).toBe('absent');
  });

  it('inherits an untouched approval in a later change', () => {
    const { root, project } = newProject({ 'docs/app/brief.md': 'b' });
    approve(project, 'brief', 'Ada');
    updateChange(root, (c) => {
      c.status = 'done';
    });
    createChange(root, { title: 'tweak', route: 'code-only', step: 'build' });
    expect(approvalState(project, 'brief').status).toBe('approved');
  });

  it('lets optional approvals be skipped but not required ones', () => {
    const { project } = newProject();
    skip(project, 'research', 'no web access', 'Ada');
    expect(approvalState(project, 'research').status).toBe('skipped');
    expect(() => skip(project, 'brief', 'nah', 'Ada')).toThrow(/required/);
    expect(() => skip(project, 'screens', ' ', 'Ada')).toThrow(/reason/);
  });

  it('rejects unknown targets', () => {
    const { project } = newProject();
    expect(() => approve(project, 'vibes', 'Ada')).toThrow(/Unknown approval/);
  });

  it('lets the newest change that approved or skipped a target decide, so an old skip never hides a stale approval', () => {
    const { root, project } = newProject();
    skip(project, 'design-system', 'no UI yet', 'Ada');
    updateChange(root, (c) => {
      c.status = 'done';
      c.step = 'done';
    });
    createChange(root, { title: 'brand', route: 'design-system', step: 'design-system' });
    writeText(join(root, 'design-system/voice.md'), 'calm\n');
    approve(project, 'design-system', 'Ada');
    expect(approvalState(project, 'design-system')).toMatchObject({ status: 'approved', changeId: '0002-brand' });
    writeText(join(root, 'design-system/voice.md'), 'calm\nloud\n');
    expect(approvalState(project, 'design-system')).toMatchObject({ status: 'stale', changeId: '0002-brand', changed: ['design-system'] });
    // A newer skip decides over an older approval that still holds, too.
    approve(project, 'design-system', 'Ada');
    updateChange(root, (c) => {
      c.status = 'done';
      c.step = 'done';
    });
    createChange(root, { title: 'copy', route: 'code-only', step: 'build' });
    skip(project, 'design-system', 'copy only', 'Ada');
    expect(approvalState(project, 'design-system')).toMatchObject({ status: 'skipped', changeId: '0003-copy', reason: 'copy only' });
  });

  it('lets the later of an approval and a skip decide across changes, as when a merged branch brings an older skip', () => {
    const { root, project } = newProject({ 'design-system/voice.md': 'calm\n' });
    approve(project, 'design-system', 'Ada');
    createChange(root, { title: 'restyle', route: 'design-system', step: 'design-system' });
    skip(project, 'design-system', 'no UI yet', 'Ada');
    // The skip was made on a branch before the approval on main, and the merge brought it in.
    updateChange(root, (c) => {
      for (const s of c.skips ?? []) s.at = '2000-01-01T00:00:00.000Z';
    });
    expect(approvalState(project, 'design-system')).toMatchObject({ status: 'approved', changeId: '0001-initial' });
    writeText(join(root, 'design-system/voice.md'), 'calm\nloud\n');
    expect(approvalState(project, 'design-system')).toMatchObject({ status: 'stale', changeId: '0001-initial' });
  });

  it('within one change, the later of an approval and a skip decides', () => {
    const { root, project } = newProject({ 'docs/app/research.md': '# Research\n' });
    const at = (iso: string) =>
      updateChange(root, (c) => {
        for (const s of c.skips ?? []) s.at = iso;
      });
    approve(project, 'research', 'Ada');
    skip(project, 'research', 'no web access', 'Ada');
    expect(approvalState(project, 'research').status).toBe('skipped');
    at('2000-01-01T00:00:00.000Z');
    expect(approvalState(project, 'research').status).toBe('approved');
  });

  it('never lets a skip satisfy a required approval, even one written into a change file by hand', () => {
    const { root, project } = newProject({ 'docs/app/brief.md': 'b', 'docs/app/spec.md': 's', 'docs/app/test-plan.md': 't' });
    approve(project, 'brief', 'Ada');
    updateChange(root, (c) => {
      c.skips = [{ target: 'spec', reason: 'trust me', by: 'agent', at: now() }];
      c.step = 'build';
    });
    const spec = approvalState(project, 'spec');
    expect(spec.status).toBe('skipped');
    expect(satisfied(spec)).toBe(false);
    const gate = hooks.preToolUse![0]!;
    expect(gate({ tool_name: 'Write', tool_input: { file_path: join(root, 'apps/web/src/x.ts') } }, project)?.deny).toMatch(/aren't approved yet \(skipped\)/);
    expect(check('state/approvals').run(contextFor(root))).toMatchObject({ status: 'fail', findings: [{ rule: 'spec', message: "spec is skipped; it's a required approval" }] });
  });
});

describe('based_on staleness', () => {
  it('flows downstream when a source changes', () => {
    const { root, project } = newProject({
      'docs/app/brief.md': 'brief v1',
      'docs/app/spec.md': '---\ntitle: Spec\n---\n# Spec\n',
    });
    const refs = stampBasedOn(project, 'docs/app/spec.md', ['brief.md']);
    expect(refs[0]).toMatch(/^brief\.md@[0-9a-f]{12}$/);
    const spec = readFileSync(join(root, 'docs/app/spec.md'), 'utf8');
    expect(spec).toContain('title: Spec');
    expect(docStaleness(project)).toEqual([]);
    writeText(join(root, 'docs/app/brief.md'), 'brief v2');
    expect(docStaleness(project).map((d) => d.doc)).toEqual(['docs/app/spec.md']);
    stampBasedOn(project, 'docs/app/spec.md', ['brief.md']);
    expect(docStaleness(project)).toEqual([]);
    expect(readFileSync(join(root, 'docs/app/spec.md'), 'utf8').match(/based_on/g)).toHaveLength(1);
  });
});

describe('owned files', () => {
  it('writes, leaves unchanged content alone, and refuses to clobber hand edits', () => {
    const { root } = newProject();
    expect(writeOwned(root, 'packages/tokens/generated/tokens.css', 'a', 'generated', 'design-system/tokens').status).toBe(
      'written',
    );
    expect(writeOwned(root, 'packages/tokens/generated/tokens.css', 'a', 'generated').status).toBe('unchanged');
    expect(writeOwned(root, 'packages/tokens/generated/tokens.css', 'b', 'generated').status).toBe('written');
    writeText(join(root, 'packages/tokens/generated/tokens.css'), 'hand edit');
    expect(() => writeOwned(root, 'packages/tokens/generated/tokens.css', 'c', 'generated')).toThrow(/edited by hand/);
    expect(check('state/owned').run(contextFor(root))).toMatchObject({ status: 'fail' });
  });

  it("refuses to overwrite a file it didn't write", () => {
    const { root } = newProject({ 'x.css': 'mine' });
    expect(() => writeOwned(root, 'x.css', 'theirs', 'generated')).toThrow(/didn't write it/);
  });

  it('writes a set of files all or none: one hand edit among them stops every write', () => {
    const { root } = newProject();
    const files = (n: number) => ['tokens.css', 'theme.css'].map((f) => ({ path: `packages/tokens/generated/${f}`, content: `${f} ${n}`, source: 'design-system/' }));
    expect(writeOwnedAll(root, files(1), 'generated').map((w) => w.status)).toEqual(['written', 'written']);
    writeText(join(root, 'packages/tokens/generated/theme.css'), 'hand edit');
    expect(() => writeOwnedAll(root, files(2), 'generated')).toThrow(/theme\.css was edited by hand/);
    // The file before it in the set wasn't written on the way to the one that stopped it.
    expect(readFileSync(join(root, 'packages/tokens/generated/tokens.css'), 'utf8')).toBe('tokens.css 1');
  });

  it('never overwrites a [yours] file and records provenance', () => {
    const { root } = newProject({ 'README.md': 'mine' });
    expect(writeYours(root, 'README.md', 'fwos', 'scaffold')).toBe(false);
    expect(writeYours(root, 'docs/app/brief.md', '# Brief', 'discovery')).toBe(true);
    const ledger = JSON.parse(readFileSync(join(root, '.fwos/provenance.json'), 'utf8'));
    expect(ledger.entries.map((e: { path: string }) => e.path)).toEqual(['docs/app/brief.md']);
  });
});

describe('lock', () => {
  it('lets one session hold it and tells the second who has it', () => {
    const { root } = newProject();
    expect(acquireLock(root, 'session-a')).toEqual({ ok: true });
    expect(acquireLock(root, 'session-a')).toEqual({ ok: true });
    const second = acquireLock(root, 'session-b');
    expect(second.ok).toBe(false);
    expect(releaseLock(root, 'session-b')).toBe(false);
    expect(releaseLock(root, 'session-a')).toBe(true);
    expect(acquireLock(root, 'session-b')).toEqual({ ok: true });
  });

  it('expires after the TTL', () => {
    const { root } = newProject();
    acquireLock(root, 'a');
    expect(readLock(root, new Date(Date.now() + 5 * 60 * 60 * 1000))).toBeNull();
  });
});

describe('baseline', () => {
  const failing = (n: number) => ({
    id: 'design-system/tokens',
    status: 'fail' as const,
    inputs: [],
    findings: Array.from({ length: n }, (_, i) => ({ file: `src/f${i}.tsx`, message: 'raw colour #fff' })),
  });

  it('hides baselined findings and can only shrink', () => {
    const { root } = newProject();
    writeBaseline(root, [failing(3)], { init: true });
    const applied = applyBaseline([failing(3)], JSON.parse(readFileSync(join(root, '.fwos/baseline.json'), 'utf8')));
    expect(applied[0]).toMatchObject({ status: 'pass', baselined: 3 });
    expect(writeBaseline(root, [failing(2)])).toEqual({ removed: 1, total: 2 });
    expect(() => writeBaseline(root, [failing(3)])).toThrow(/only shrink/);
    expect(() => writeBaseline(root, [failing(1)], { init: true })).toThrow(/already exists/);
  });

  it('fails on a new finding while still counting the baselined ones', () => {
    const { root } = newProject();
    writeBaseline(root, [failing(1)], { init: true });
    const base = JSON.parse(readFileSync(join(root, '.fwos/baseline.json'), 'utf8'));
    const r = applyBaseline([failing(2)], base)[0]!;
    expect(r.status).toBe('fail');
    expect(r.reason).toBe('1 new finding (1 baselined)');
  });
});

describe('baseline counts each finding', () => {
  const tokens = (...findings: { message: string; line?: number }[]) => ({
    id: 'design-system/tokens',
    status: 'fail' as const,
    inputs: [],
    findings: findings.map((f) => ({ file: 'src/row.tsx', rule: 'raw-color', ...f })),
  });
  const hex = (h: string, line = 1) => ({ message: `"bg-[${h}]" hard-codes a colour; use a slot colour class`, line });
  const readBase = (root: string) => JSON.parse(readFileSync(join(root, '.fwos/baseline.json'), 'utf8'));

  it('does not hide a new finding behind a baselined one that differs only in its digits', () => {
    const { root } = newProject();
    writeBaseline(root, [tokens(hex('#111111'))], { init: true });
    const r = applyBaseline([tokens(hex('#111111'), hex('#222222', 2))], readBase(root))[0]!;
    expect(r.reason).toBe('1 new finding (1 baselined)');
    expect(r.findings.map((f) => f.message)).toEqual([hex('#222222').message]);
  });

  it('treats a second identical finding beyond the baselined count as new', () => {
    const { root } = newProject();
    writeBaseline(root, [tokens(hex('#111111', 3), hex('#111111', 9))], { init: true });
    expect(readBase(root).findings['design-system/tokens']).toEqual({ [`design-system/tokens|src/row.tsx|raw-color|${hex('#111111').message}`]: 2 });
    expect(applyBaseline([tokens(hex('#111111', 3), hex('#111111', 9))], readBase(root))[0]).toMatchObject({ status: 'pass', baselined: 2 });
    const r = applyBaseline([tokens(hex('#111111', 3), hex('#111111', 9), hex('#111111', 20))], readBase(root))[0]!;
    expect(r.reason).toBe('1 new finding (2 baselined)');
    expect(() => writeBaseline(root, [tokens(hex('#111111'), hex('#111111'), hex('#111111'))])).toThrow(/only shrink/);
    expect(writeBaseline(root, [tokens(hex('#111111'))])).toEqual({ removed: 1, total: 1 });
  });

  it('still ignores line numbers, in the finding and in its message', () => {
    const { root } = newProject();
    const dup = (line: number, first: number) => ({ message: `AC-x-1 is defined twice (first at line ${first})`, line });
    writeBaseline(root, [tokens(dup(10, 3))], { init: true });
    expect(applyBaseline([tokens(dup(42, 30))], readBase(root))[0]).toMatchObject({ status: 'pass', baselined: 1 });
    expect(fingerprint('m/c', { message: 'a at col 12', line: 1 })).toBe(fingerprint('m/c', { message: 'a at col 7', line: 2 }));
    expect(fingerprint('m/c', { message: 'bg-[#111111]' })).not.toBe(fingerprint('m/c', { message: 'bg-[#222222]' }));
  });

  it('reads a baseline written before counts were kept, then rewrites it with counts when it shrinks', () => {
    const { root } = newProject();
    const legacy = 'design-system/tokens|src/row.tsx|raw-color|"bg-[#N]" hard-codes a colour; use a slot colour class';
    writeText(join(root, '.fwos/baseline.json'), JSON.stringify({ schema: 1, createdAt: '2026-01-01', findings: { 'design-system/tokens': [legacy] } }));
    expect(check('state/schema').run(contextFor(root))).toMatchObject({ status: 'pass' });
    // The old file had no counts, so it hides what it hid before.
    expect(applyBaseline([tokens(hex('#111111'), hex('#222222'))], readBase(root))[0]).toMatchObject({ status: 'pass', baselined: 2 });
    expect(() => writeBaseline(root, [tokens(hex('#111111'), { message: 'a new kind of finding' })])).toThrow(/only shrink/);
    expect(writeBaseline(root, [tokens(hex('#111111'))])).toEqual({ removed: 0, total: 1 });
    expect(readBase(root)).toMatchObject({ createdAt: '2026-01-01', findings: { 'design-system/tokens': { [`design-system/tokens|src/row.tsx|raw-color|${hex('#111111').message}`]: 1 } } });
    expect(check('state/schema').run(contextFor(root))).toMatchObject({ status: 'pass' });
    expect(applyBaseline([tokens(hex('#111111'), hex('#222222'))], readBase(root))[0]!.reason).toBe('1 new finding (1 baselined)');
  });
});

describe('checks', () => {
  it('state/schema is off outside an fwos project and fails closed on a future schema', () => {
    expect(check('state/schema').run(contextFor(tempProject()))).toMatchObject({ status: 'off' });
    const { root } = newProject();
    expect(check('state/schema').run(contextFor(root))).toMatchObject({ status: 'pass' });
    writeText(join(root, '.fwos/state.json'), JSON.stringify({ schema: 2, pluginVersion: '9', mode: 'new', platforms: [] }));
    const r = check('state/schema').run(contextFor(root)) as { status: string; findings: { message: string }[] };
    expect(r.status).toBe('fail');
    expect(r.findings[0]!.message).toMatch(/schema 2 unsupported/);
  });

  it('state/schema names a file that is not valid JSON, with no stack trace and no absolute path', () => {
    const { root } = newProject();
    writeText(join(root, '.fwos/changes/0002-x.json'), '{');
    const r = check('state/schema').run(contextFor(root)) as { status: string; reason?: string; findings: { file?: string; message: string }[] };
    expect(r.status).toBe('fail');
    expect(r.findings).toEqual([{ file: '.fwos/changes/0002-x.json', message: expect.stringMatching(/^is not valid JSON: /) }]);
    expect(JSON.stringify(r)).not.toMatch(/crashed|FwosError|\n\s+at |\.ts:\d|\.mjs:\d/);
    expect(JSON.stringify(r)).not.toContain(root);
  });

  it('state/approvals is off before build and fails on a stale spec during build', () => {
    const { root, project } = newProject({
      'docs/app/brief.md': 'b',
      'docs/app/spec.md': 's',
      'docs/app/test-plan.md': 't',
    });
    expect(check('state/approvals').run(contextFor(root))).toMatchObject({ status: 'off' });
    approve(project, 'brief', 'Ada');
    approve(project, 'spec', 'Ada');
    updateChange(root, (c) => {
      c.step = 'build';
    });
    expect(check('state/approvals').run(contextFor(root))).toMatchObject({ status: 'pass' });
    writeText(join(root, 'docs/app/spec.md'), 's2');
    const r = check('state/approvals').run(contextFor(root)) as { status: string; findings: { message: string }[] };
    expect(r.status).toBe('fail');
    expect(r.findings[0]!.message).toMatch(/spec changed after it was approved/);
  });
});

describe('hooks', () => {
  const edit = (root: string, file: string) => ({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: join(root, file), content: 'x' },
  });

  it('blocks app source before the spec is approved, allows docs and screens paths', () => {
    const { root, project } = newProject({ 'docs/app/spec.md': 's', 'docs/app/test-plan.md': 't' });
    const gate = hooks.preToolUse![0]!;
    expect(gate(edit(root, 'apps/web/src/features/list/list.tsx'), project)?.deny).toMatch(/aren't approved yet/);
    expect(gate(edit(root, 'docs/app/brief.md'), project)).toBeNull();
    expect(gate(edit(root, 'apps/web/app/(fwos-screens)/fwos-screens/page.tsx'), project)).toBeNull();
    expect(gate(edit(root, 'README.md'), project)).toBeNull();
    expect(gate({ ...edit(root, 'apps/web/src/a.ts'), tool_name: 'Read' }, project)).toBeNull();
    approve(project, 'spec', 'Ada');
    expect(gate(edit(root, 'apps/web/src/features/list/list.tsx'), project)).toBeNull();
  });

  it('opens only the dev-only screens routes of the (fwos-screens) group before the spec is approved', () => {
    const { root, project } = newProject();
    const gate = hooks.preToolUse![0]!;
    for (const page of ['apps/web/app/(fwos-screens)/admin/page.tsx', 'apps/web/app/(fwos-screens)/layout.tsx']) {
      expect(gate(edit(root, page), project)?.deny, page).toMatch(/state\/spec-gate\]: .* is app source/);
    }
    for (const page of ['apps/web/app/(fwos-screens)/fwos-screens/page.tsx', 'apps/web/app/(fwos-screens)/fwos-screens/[pageId]/page.tsx']) {
      expect(gate(edit(root, page), project), page).toBeNull();
    }
  });

  it('ignores files outside the project', () => {
    const { project } = newProject();
    const gate = hooks.preToolUse![0]!;
    expect(gate({ tool_name: 'Write', tool_input: { file_path: '/elsewhere/apps/x.ts' } }, project)).toBeNull();
  });

  it('warns on generated files', () => {
    const { root, project } = newProject();
    writeOwned(root, 'packages/tokens/generated/tokens.css', 'a', 'generated', 'design-system/tokens');
    const warn = hooks.preToolUse![1]!;
    expect(warn(edit(root, 'packages/tokens/generated/tokens.css'), project)?.context).toMatch(/is generated from design-system\/tokens/);
  });

  it('summarises the change at session start and reports a held lock', () => {
    const { root, project } = newProject();
    updateChange(root, (c) => {
      c.cursor = { section: 'states', pending: ['Q-3', 'Q-4'] };
    });
    const summary = hooks.sessionStart![0]!;
    expect(summary({ session_id: 'aaaa1111' }, project)?.context).toBe(
      'fwos: change 0001-initial, step discovery (section states); 2 questions pending. Run /fwos:start to continue.',
    );
    expect(summary({ session_id: 'bbbb2222' }, project)?.context).toMatch(/another session \(aaaa1111\) holds this change/);
  });
});


describe('initialization file boundaries', () => {
  it.each(['.fwos', '.fwos/state.json', '.fwos/manifest.json', '.fwos/provenance.json', '.fwos/changes', '.fwos/local', '.gitignore'])('refuses symlinked %s before writing state or outside files', (rel) => {
    const root = tempProject();
    const outside = tempProject({ 'sentinel.txt': 'synthetic sentinel' });
    const directory = ['.fwos', '.fwos/changes', '.fwos/local'].includes(rel);
    if (rel.startsWith('.fwos/')) mkdirSync(join(root, '.fwos'));
    symlinkSync(directory ? outside : join(outside, 'sentinel.txt'), join(root, rel), directory ? 'dir' : 'file');
    expect(() => initProject(root)).toThrow(/symlink/i);
    expect(readFileSync(join(outside, 'sentinel.txt'), 'utf8')).toBe('synthetic sentinel');
    expect(readdirSync(outside)).toEqual(['sentinel.txt']);
    if (!['.fwos', '.fwos/state.json'].includes(rel)) expect(existsSync(join(root, '.fwos/state.json'))).toBe(false);
  });
});
