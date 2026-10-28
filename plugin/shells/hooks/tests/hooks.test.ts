// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The hook path from stdin to a decision: malformed input never blocks a tool call, and an edit
// can't step around the lock guard or the spec gate by spelling the path another way.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type HookInput, editedPath, loadProject } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { initProject, hooks as stateHooks } from '../../../modules/state/index.ts';
import { lockTests, hooks as testsHooks } from '../../../modules/tests/index.ts';
import { dispatch } from '../index.ts';

const links: string[] = [];
afterAll(() => {
  for (const l of links) rmSync(l, { force: true });
  cleanupTempProjects();
});

const main = new URL('../../cli/main.ts', import.meta.url).pathname;
/** `fwos hook <event>` from source, in its own process, with `input` on stdin. */
const hook = (cwd: string, input: string, event = 'pre-tool-use') => {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', main, 'hook', event], { cwd, input });
  return { code: r.status, out: r.stdout.toString(), err: r.stderr.toString() };
};

describe('fwos hook with input it cannot use', () => {
  const root = tempProject({ 'apps/web/src/a.ts': '' });
  initProject(root);
  const write = JSON.stringify({ tool_name: 'Write', cwd: root, tool_input: { file_path: join(root, 'apps/web/src/a.ts') } });

  it('denies a gated write (positive control)', () => {
    const r = hook(root, write);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it.each(['null', '[]', '"Write"', '42', 'true', '{ not json', `${write}}`])('exits 0 with no output for %s', (input) => {
    for (const event of ['pre-tool-use', 'post-tool-use', 'session-start']) {
      expect(hook(root, input, event)).toEqual({ code: 0, out: '', err: '' });
    }
  });

  it('treats a non-object in-process the same way', () => {
    for (const input of [null, [], 'x', 1]) expect(dispatch('pre-tool-use', input as unknown as HookInput, root)).toEqual({ stdout: '', code: 0 });
  });
});

describe('the edited path', () => {
  const setup = () => {
    const root = tempProject({ 'apps/web/e2e/a.spec.ts': 'x', 'apps/web/src/x.ts': '' });
    initProject(root);
    lockTests(loadProject(root), ['apps/web/e2e/a.spec.ts'], { evidence: 'existing' });
    return root;
  };
  const edit = (root: string, file_path: string) => dispatch('pre-tool-use', { tool_name: 'Edit', cwd: root, tool_input: { file_path } }).stdout;
  /** Whether the folder holding temp projects ignores case: true on a default macOS or Windows disk. */
  const probe = realpathSync(tempProject());
  const caseInsensitive = existsSync(join(dirname(probe), basename(probe).toUpperCase()));

  it('is the same file through a symlink to the project root', () => {
    const root = setup();
    const link = `${root}-link`;
    symlinkSync(root, link, 'dir');
    links.push(link);
    expect(edit(root, join(root, 'apps/web/e2e/a.spec.ts'))).toMatch(/tests\/locked/);
    expect(edit(root, join(link, 'apps/web/e2e/a.spec.ts'))).toMatch(/tests\/locked\]: apps\/web\/e2e\/a\.spec\.ts is a locked test/);
    // The real path behind the root, as macOS reports /var as /private/var.
    expect(edit(root, join(realpathSync(root), 'apps/web/e2e/a.spec.ts'))).toMatch(/tests\/locked/);
    expect(editedPath({ tool_input: { file_path: join(link, 'apps/web/src/new.ts') } }, loadProject(root))).toBe('apps/web/src/new.ts');
  });

  it('is the same file spelled in another case, where the disk ignores case', { skip: !caseInsensitive }, () => {
    const root = setup();
    expect(edit(root, join(root, 'apps/web/E2E/a.spec.ts'))).toMatch(/tests\/locked\]: apps\/web\/e2e\/a\.spec\.ts is a locked test/);
    expect(edit(root, join(root, 'APPS/Web/e2e/A.SPEC.TS'))).toMatch(/tests\/locked/);
    expect(edit(root, join(root.toUpperCase(), 'apps/web/e2e/a.spec.ts'))).toMatch(/tests\/locked/);
    // A new file keeps the name it is given, under the folders' own spelling.
    expect(editedPath({ tool_input: { file_path: join(root, 'APPS/WEB/SRC/New.ts') } }, loadProject(root))).toBe('apps/web/src/New.ts');
    expect(edit(root, join(root, 'Apps/Web/Src/x.ts'))).toMatch(/state\/spec-gate\]: apps\/web\/src\/x\.ts is app source/);
    // `..` is read before the disk is asked, so a detour through a missing folder still finds apps/.
    expect(editedPath({ tool_input: { file_path: `${root}/nope/../Apps/web/src/x.ts` } }, loadProject(root))).toBe('apps/web/src/x.ts');
    // A folder first written as Apps/ is still the gated apps/, in either spelling.
    const fresh = tempProject();
    initProject(fresh);
    mkdirSync(join(fresh, 'Apps/web/src/features'), { recursive: true });
    for (const f of ['Apps/web/src/features/x.ts', 'apps/web/src/features/y.ts']) {
      expect(dispatch('pre-tool-use', { tool_name: 'Write', cwd: fresh, tool_input: { file_path: join(fresh, f) } }).stdout, f).toMatch(/state\/spec-gate/);
    }
  });

  it('knows the disk ignores case when the root folder has no letters to swap', { skip: !caseInsensitive }, () => {
    for (const name of ['1234', '_42_']) {
      const root = join(tempProject(), name);
      mkdirSync(root);
      initProject(root);
      expect(loadProject(root).caseInsensitive, name).toBe(true);
      expect(dispatch('pre-tool-use', { tool_name: 'Write', cwd: root, tool_input: { file_path: join(root, 'Apps/web/src/features/x.ts') } }).stdout, name).toMatch(/state\/spec-gate/);
    }
  });

  it('is gated and locked in any case where the disk ignores case, even before its folder exists (any OS)', () => {
    const root = tempProject({ 'e2e/a.spec.ts': 'x' });
    initProject(root);
    lockTests(loadProject(root), ['e2e/a.spec.ts'], { evidence: 'existing' });
    // The disk is said to ignore case, as a default macOS or Windows disk does, so this runs on Linux too.
    const project = loadProject(root);
    project.caseInsensitive = true;
    const handlers = [...(stateHooks.preToolUse ?? []), ...(testsHooks.preToolUse ?? [])];
    const deny = (file: string) => handlers.map((h) => h({ tool_name: 'Write', tool_input: { file_path: join(root, file) } }, project)?.deny).find(Boolean);
    expect(deny('Apps/web/src/features/x.ts')).toMatch(/state\/spec-gate\]: Apps\/web\/src\/features\/x\.ts is app source/);
    expect(deny('E2E/A.spec.ts')).toMatch(/tests\/locked\]: .*is a locked test/);
    // Positive control: where the disk keeps case, Apps/ is another folder, which nothing gates.
    project.caseInsensitive = false;
    expect(deny('Apps/web/src/features/x.ts')).toBeUndefined();
  });

  it('reads `..` as written before following a link, as the edit tools do', () => {
    const root = setup();
    mkdirSync(join(root, 'docs/app'), { recursive: true });
    symlinkSync(join(root, 'docs/app'), join(root, 'link'), 'dir');
    // The tool writes <root>/apps/web/src/new.ts, not <root>/docs/apps/web/src/new.ts.
    expect(editedPath({ tool_input: { file_path: `${root}/link/../apps/web/src/new.ts` } }, loadProject(root))).toBe('apps/web/src/new.ts');
    expect(edit(root, `${root}/link/../apps/web/e2e/a.spec.ts`)).toMatch(/tests\/locked/);
  });

  it('is a record of fwos in any case where the disk ignores case', () => {
    const root = setup();
    const project = loadProject(root);
    project.caseInsensitive = true;
    const deny = (file: string) => (stateHooks.preToolUse ?? []).map((h) => h({ tool_name: 'Edit', tool_input: { file_path: join(root, file) } }, project)?.deny).find(Boolean);
    expect(deny('.FWOS/changes/0001-initial.json')).toMatch(/state\/records/);
    expect(deny('.Fwos/Local/results/v.xml')).toBeUndefined();
  });

  it('is outside the project when it is outside the root, whatever the spelling', () => {
    const root = setup();
    const project = loadProject(root);
    expect(editedPath({ tool_input: { file_path: `${root}-sibling/apps/web/src/x.ts` } }, project)).toBeNull();
    expect(editedPath({ tool_input: { file_path: join(root, '../elsewhere/x.ts') } }, project)).toBeNull();
    expect(editedPath({ tool_input: { file_path: 'apps/web/src/../e2e/a.spec.ts' } }, project)).toBe('apps/web/e2e/a.spec.ts');
  });
});

describe('the test planner sandbox', () => {
  it('knows the planner by whichever field the host names the agent in', () => {
    const root = tempProject();
    initProject(root);
    const read = (agent: Record<string, unknown>) => dispatch('pre-tool-use', { tool_name: 'Read', cwd: root, tool_input: { file_path: join(root, 'docs/app/spec.md') }, ...agent } as HookInput).stdout;
    for (const field of ['agent_type', 'agent_name', 'subagent_type', 'subagent_name', 'agent']) {
      expect(read({ [field]: 'fwos:test-planner' }), field).toMatch(/tests\/planner-sandbox/);
      expect(read({ [field]: 'test-planner' }), field).toMatch(/tests\/planner-sandbox/);
    }
    expect(read({ agent: { name: 'fwos:test-planner' } })).toMatch(/tests\/planner-sandbox/);
    expect(read({ agent: { type: 'test-planner' } })).toMatch(/tests\/planner-sandbox/);
    // Positive control: another agent, the main session and a lookalike name aren't sandboxed.
    for (const other of [{ agent_name: 'fwos:builder' }, {}, { agent_type: 'test-planner-2' }]) expect(read(other), JSON.stringify(other)).toBe('');
  });
});

describe('fwos hook while a .fwos/ file does not parse', () => {
  const broken = (rel: string, text = '{') => {
    const root = tempProject({ 'apps/web/src/x.ts': '', 'docs/app/brief.md': 'b' });
    initProject(root);
    writeFileSync(join(root, rel), text);
    return root;
  };
  const warnings = (stdout: string) => stdout.match(/couldn't read its state/g)?.length ?? 0;

  it('warns once at session start and after an edit, naming the file', () => {
    const root = broken('.fwos/changes/0002-x.json');
    const start = dispatch('session-start', { cwd: root, session_id: 's' }).stdout;
    expect(warnings(start)).toBe(1);
    expect(JSON.parse(start).hookSpecificOutput.additionalContext).toMatch(/\(\.fwos\/changes\/0002-x\.json is not valid JSON/);
    const state = broken('.fwos/state.json', '{bad');
    expect(warnings(dispatch('post-tool-use', { tool_name: 'Write', cwd: state, tool_input: { file_path: join(state, 'docs/app/brief.md'), content: 'b' } }).stdout)).toBe(1);
  });

  it('denies in Codex the same way, and stays silent on what it allows (no PreToolUse context there)', () => {
    const root = broken('.fwos/changes/0002-x.json');
    const patch = (...files: string[]) => ['*** Begin Patch', ...files.map((f) => `*** Add File: ${f}\n+x`), '*** End Patch'].join('\n');
    const call = (text: string) => {
      const input = { tool_name: 'apply_patch', turn_id: 't', cwd: root, tool_input: { command: text } };
      return dispatch('pre-tool-use', input).stdout;
    };
    expect(JSON.parse(call(patch('docs/app/notes.md', 'apps/web/src/feature.ts'))).hookSpecificOutput.permissionDecisionReason).toMatch(/state\/unreadable/);
    expect(call(patch('docs/app/notes.md', 'design-system/voice.md'))).toBe('');
  });
});

describe("fwos's own records in .fwos/", () => {
  const setup = () => {
    const root = tempProject({ 'apps/web/e2e/a.spec.ts': 'x' });
    initProject(root);
    lockTests(loadProject(root), ['apps/web/e2e/a.spec.ts'], { evidence: 'existing' });
    return root;
  };
  const call = (root: string, tool_name: string, rel: string) =>
    dispatch('pre-tool-use', { tool_name, cwd: root, tool_input: tool_name === 'NotebookEdit' ? { notebook_path: join(root, rel) } : { file_path: join(root, rel), content: '{}' } }).stdout;

  it('are closed to every edit tool, so no edit can drop a lock, forge an approval or empty the gate', () => {
    const root = setup();
    const records = ['.fwos/changes/0001-initial.json', '.fwos/changes/0002-forged.json', '.fwos/state.json', '.fwos/manifest.json', '.fwos/provenance.json', '.fwos/baseline.json', '.fwos/cli/dist/fwos.mjs'];
    for (const tool of ['Write', 'Edit', 'MultiEdit']) {
      for (const rel of records) expect(call(root, tool, rel), `${tool} ${rel}`).toMatch(/fwos \[state\/records\]: .* only the fwos CLI writes/);
    }
    expect(call(root, 'NotebookEdit', '.fwos/notes.ipynb')).toMatch(/state\/records/);
    // Codex: a patch is checked file by file, through the same handlers.
    const patch = ['*** Begin Patch', '*** Update File: .fwos/changes/0001-initial.json', '@@', '-x', '+y', '*** End Patch'].join('\n');
    const applyPatch = { tool_name: 'apply_patch', turn_id: 't', cwd: root, tool_input: { command: patch } };
    const codex = JSON.parse(dispatch('pre-tool-use', applyPatch).stdout);
    expect(codex.hookSpecificOutput.permissionDecisionReason).toMatch(/state\/records/);
  });

  it('leave open what the agent writes there by design: local evidence, slice manifests and the quarantine', () => {
    const root = setup();
    for (const rel of ['.fwos/local/results/v.xml', '.fwos/local/evidence/list-dark.png', '.fwos/slices/0001-initial/S1.json', '.fwos/quarantine.json']) expect(call(root, 'Write', rel), rel).toBe('');
  });

  it("close the run records, which only `fwos harness record` and `fwos tests run` write", () => {
    const root = setup();
    for (const rel of ['.fwos/local/runs/states/page.list.json', '.fwos/local/runs/ia/admin.json', '.fwos/local/runs/tests/test.json']) {
      for (const tool of ['Write', 'Edit']) expect(call(root, tool, rel), `${tool} ${rel}`).toMatch(/fwos \[state\/records\]: .* only the fwos CLI writes/);
    }
  });

  it('keep the lock in place, so the locked test stays locked (the two-edit bypass)', () => {
    const root = setup();
    expect(call(root, 'Edit', '.fwos/changes/0001-initial.json')).toMatch(/state\/records/);
    expect(call(root, 'Edit', 'apps/web/e2e/a.spec.ts')).toMatch(/tests\/locked/);
  });
});
