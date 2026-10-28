// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Codex sends Claude Code's hook payload, but an edit is one apply_patch naming every file, its
// PreToolUse can't carry context, and its shell doesn't know the plugin folder. The payloads below
// are the shapes Codex CLI 0.155 sent in a real session.

import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { loadProject } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { initProject, writeOwned } from '../../../modules/state/index.ts';
import { lockTests } from '../../../modules/tests/index.ts';
import { asEdits, codexSessionContext, fromCodex, patchedFiles } from '../codex.ts';
import { dispatch } from '../index.ts';

afterAll(cleanupTempProjects);
const saved = { PLUGIN_ROOT: process.env.PLUGIN_ROOT, CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const patch = (...lines: string[]) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');
/** A Codex PreToolUse payload for an apply_patch, as Codex sends it. */
const applyPatch = (cwd: string, text: string, extra: Record<string, unknown> = {}) => ({
  session_id: 's',
  turn_id: 't',
  cwd,
  hook_event_name: 'PreToolUse',
  model: 'gpt',
  permission_mode: 'bypassPermissions',
  tool_name: 'apply_patch',
  tool_input: { command: text },
  ...extra,
});

describe('patchedFiles', () => {
  it('names every file a patch adds, updates, deletes or moves to', () => {
    const text = patch(
      '*** Add File: apps/web/src/new.ts',
      '+export const a = 1;',
      '*** Update File: apps/web/src/old.ts',
      '@@',
      '-a',
      '+b',
      '*** Delete File: apps/web/e2e/gone.spec.ts',
      '*** Update File: docs/a.md',
      '*** Move to: docs/b.md',
    );
    expect(patchedFiles(text)).toEqual([
      { path: 'apps/web/src/new.ts', op: 'add' },
      { path: 'apps/web/src/old.ts', op: 'update' },
      { path: 'apps/web/e2e/gone.spec.ts', op: 'delete' },
      { path: 'docs/a.md', op: 'update' },
      { path: 'docs/b.md', op: 'add' },
    ]);
  });

  it('ignores lines that only look like headers inside a hunk', () => {
    expect(patchedFiles(patch('*** Update File: a.ts', '+// *** Add File: not-a-file.ts'))).toEqual([{ path: 'a.ts', op: 'update' }]);
  });
});

describe('asEdits', () => {
  it('turns an apply_patch into one Write or Edit per file, and leaves other calls alone', () => {
    const input = applyPatch('/p', patch('*** Add File: x.ts', '+1', '*** Update File: y.ts'));
    expect(asEdits(input).map((e) => [e.tool_name, e.tool_input?.file_path])).toEqual([
      ['Write', 'x.ts'],
      ['Edit', 'y.ts'],
    ]);
    const bash = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    expect(asEdits(bash)).toEqual([bash]);
  });

  it("passes on each file's added lines, so the edit-time scans read what the patch writes", () => {
    const text = patch(
      '*** Add File: x.ts',
      '+const a = 1;',
      '+const b = 2;',
      '*** Update File: y.ts',
      '@@ function f',
      ' kept',
      '-old',
      '+new',
      '*** End of File',
      '*** Delete File: z.ts',
      '*** Update File: m.ts',
      '*** Move to: n.ts',
      '@@',
      '-a',
      '+moved',
    );
    expect(asEdits(applyPatch('/p', text)).map((e) => [e.tool_name, e.tool_input])).toEqual([
      ['Write', { file_path: 'x.ts', content: 'const a = 1;\nconst b = 2;' }],
      ['Edit', { file_path: 'y.ts', new_string: 'new' }],
      ['Edit', { file_path: 'z.ts' }],
      ['Edit', { file_path: 'm.ts', new_string: '' }],
      ['Write', { file_path: 'n.ts', content: 'moved' }],
    ]);
  });

  it('reads a patch sent as an argument list, and headers with leading spaces', () => {
    const text = patch('  *** Add File: x.ts', '+1', ' *** Update File: y.ts', '+2');
    const calls = asEdits({ tool_name: 'apply_patch', tool_input: { command: ['apply_patch', text] } });
    expect(calls.map((e) => [e.tool_name, e.tool_input?.file_path])).toEqual([
      ['Write', 'x.ts'],
      ['Edit', 'y.ts'],
    ]);
  });

  it('gives nothing back for an apply_patch it cannot read, so the dispatcher can refuse it', () => {
    for (const tool_input of [{ command: 42 }, { command: { patch: 'x' } }, { command: 'apply_patch' }, { command: patch() }, {}]) {
      expect(asEdits({ tool_name: 'apply_patch', tool_input }), JSON.stringify(tool_input)).toEqual([]);
    }
  });
});

describe('fromCodex', () => {
  it('knows Codex by apply_patch, a turn_id or PLUGIN_ROOT, and Claude Code by none of them', () => {
    expect(fromCodex({ tool_name: 'apply_patch' }, {})).toBe(true);
    expect(fromCodex({ tool_name: 'Bash', turn_id: 't' } as never, {})).toBe(true);
    expect(fromCodex({ hook_event_name: 'SessionStart' }, { PLUGIN_ROOT: '/p' })).toBe(true);
    expect(fromCodex({ tool_name: 'Write', session_id: 's' }, { CLAUDE_PLUGIN_ROOT: '/p' })).toBe(false);
  });
});

describe('fwos hooks in Codex', () => {
  const project = () => {
    const root = tempProject({ 'apps/web/src/x.ts': '', 'apps/web/e2e/a.spec.ts': 'x' });
    initProject(root);
    lockTests(loadProject(root), ['apps/web/e2e/a.spec.ts'], { evidence: 'existing' });
    return root;
  };
  const decision = (stdout: string) => (stdout ? JSON.parse(stdout).hookSpecificOutput : null);

  it('denies a patch that adds app source before the spec is approved', () => {
    const root = project();
    const out = decision(dispatch('pre-tool-use', applyPatch(root, patch('*** Add File: apps/web/src/feature.ts', '+export const f = 1;'))).stdout);
    expect(out.permissionDecision).toBe('deny');
    expect(out.permissionDecisionReason).toMatch(/state\/spec-gate\]: apps\/web\/src\/feature\.ts is app source/);
  });

  it('denies a patch that touches a locked test, even when it also edits allowed files', () => {
    const root = project();
    const text = patch('*** Update File: docs/app/notes.md', '+ok', '*** Update File: apps/web/e2e/a.spec.ts', '+changed');
    expect(decision(dispatch('pre-tool-use', applyPatch(root, text)).stdout).permissionDecisionReason).toMatch(/tests\/locked\]: apps\/web\/e2e\/a\.spec\.ts is a locked test/);
    const deleting = patch('*** Delete File: apps/web/e2e/a.spec.ts');
    expect(decision(dispatch('pre-tool-use', applyPatch(root, deleting)).stdout).permissionDecision).toBe('deny');
  });

  it('lets a patch through when every file it touches is allowed', () => {
    const root = project();
    expect(dispatch('pre-tool-use', applyPatch(root, patch('*** Add File: docs/app/notes.md', '+ok'))).stdout).toBe('');
  });

  it('reads patch paths from the session folder, so a session started below the root is gated too', () => {
    const root = project();
    const below = join(root, 'apps/web');
    const reason = (text: string) => decision(dispatch('pre-tool-use', applyPatch(below, patch(text, '+x'))).stdout)?.permissionDecisionReason;
    expect(reason('*** Add File: src/feature.ts')).toMatch(/state\/spec-gate\]: apps\/web\/src\/feature\.ts is app source/);
    expect(reason('*** Update File: e2e/a.spec.ts')).toMatch(/tests\/locked\]: apps\/web\/e2e\/a\.spec\.ts is a locked test/);
    expect(reason('*** Add File: ../../.fwos/changes/0002-x.json')).toMatch(/\.fwos\/changes\/0002-x\.json/);
    expect(reason('*** Add File: ../../docs/app/notes.md')).toBeUndefined();
  });

  it('denies a gated or locked file in a patch sent as an argument list or with indented headers', () => {
    const root = project();
    const listed = { ...applyPatch(root, ''), tool_input: { command: ['apply_patch', patch('*** Add File: apps/web/src/feature.ts', '+export const f = 1;')] } };
    expect(decision(dispatch('pre-tool-use', listed).stdout).permissionDecisionReason).toMatch(/state\/spec-gate\]: apps\/web\/src\/feature\.ts is app source/);
    const indented = applyPatch(root, patch('*** Add File: docs/app/notes.md', '+ok', '  *** Update File: apps/web/e2e/a.spec.ts', '+changed'));
    expect(decision(dispatch('pre-tool-use', indented).stdout).permissionDecisionReason).toMatch(/tests\/locked\]: apps\/web\/e2e\/a\.spec\.ts is a locked test/);
  });

  it("denies an apply_patch whose files it can't read in an fwos project, and stays silent outside one", () => {
    const root = project();
    for (const tool_input of [{ command: 42 }, { command: 'apply_patch' }, {}]) {
      const out = decision(dispatch('pre-tool-use', { ...applyPatch(root, ''), tool_input }).stdout);
      expect(out.permissionDecision, JSON.stringify(tool_input)).toBe('deny');
      expect(out.permissionDecisionReason).toMatch(/^fwos \[hooks\/codex\]: fwos couldn't read which files this apply_patch changes/);
    }
    // After the call there is nothing left to refuse.
    expect(dispatch('post-tool-use', { ...applyPatch(root, ''), hook_event_name: 'PostToolUse', tool_input: { command: 42 } }).stdout).toBe('');
    const elsewhere = tempProject({});
    expect(dispatch('pre-tool-use', { ...applyPatch(elsewhere, ''), tool_input: { command: 42 } }).stdout).toBe('');
  });

  it('flags raw design values and rule breaks in what a patch adds, as it does for a Write', () => {
    const root = project();
    const text = patch('*** Add File: apps/web/src/features/x.tsx', "+import { PieChart } from 'recharts';", '+export const X = () => <div className="bg-red-500" />;');
    const out = decision(dispatch('post-tool-use', { ...applyPatch(root, text), hook_event_name: 'PostToolUse' }).stdout);
    expect(out.additionalContext).toMatch(/fwos \[design-system\/tokens\] apps\/web\/src\/features\/x\.tsx[^\n]*\n- "bg-red-500" uses Tailwind's default palette/);
    expect(out.additionalContext).toMatch(/fwos \[rules\/edit-time\] apps\/web\/src\/features\/x\.tsx[\s\S]*no-pie-chart/);
  });

  it('only denies on PreToolUse, never sends context there (Codex treats that as a hook error)', () => {
    const root = project();
    writeOwned(root, 'packages/tokens/generated/tokens.css', ':root{}\n', 'generated', 'design-system/');
    // In Claude Code this edit gets a "generated file" warning as context.
    const claude = decision(dispatch('pre-tool-use', { tool_name: 'Edit', cwd: root, tool_input: { file_path: join(root, 'packages/tokens/generated/tokens.css') } }).stdout);
    expect(claude.additionalContext).toMatch(/state\/owned/);
    expect(dispatch('pre-tool-use', applyPatch(root, patch('*** Update File: packages/tokens/generated/tokens.css', '+x'))).stdout).toBe('');
  });

  it('denies the test planner every tool, from the agent_type Codex sends for a subagent', () => {
    const root = project();
    const call = { session_id: 's', turn_id: 't', cwd: root, agent_id: 'a', agent_type: 'test-planner', tool_name: 'Bash', tool_input: { command: 'ls' } };
    expect(decision(dispatch('pre-tool-use', call).stdout).permissionDecisionReason).toMatch(/tests\/planner-sandbox/);
  });

  it('tells a Codex session where the plugin is, in an fwos project or before there is one', () => {
    process.env.PLUGIN_ROOT = '/opt/fwos';
    process.env.CLAUDE_PLUGIN_ROOT = '/opt/fwos';
    const start = { session_id: 's', hook_event_name: 'SessionStart', source: 'startup' };
    const empty = tempProject({});
    const before = decision(dispatch('session-start', { ...start, cwd: empty }, empty).stdout);
    expect(before.additionalContext).toBe(codexSessionContext());
    expect(before.additionalContext).toContain('node "/opt/fwos/dist/fwos.mjs" next --json');
    const root = project();
    const after = decision(dispatch('session-start', { ...start, cwd: root }, root).stdout).additionalContext as string;
    expect(after.startsWith(codexSessionContext()!)).toBe(true);
    expect(after).toMatch(/fwos: change 0001-initial, step discovery/);
  });

  it('stays silent outside an fwos project in Claude Code', () => {
    delete process.env.PLUGIN_ROOT;
    const empty = tempProject({});
    expect(dispatch('session-start', { session_id: 's', hook_event_name: 'SessionStart', cwd: empty }, empty).stdout).toBe('');
  });
});
