// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { initProject } from '../../../modules/state/index.ts';

const source = new URL('../entry.mjs', import.meta.url);
const shell = new URL('../entry.sh', import.meta.url);
const hooks = JSON.parse(readFileSync(new URL('../hooks.json', import.meta.url), 'utf8'));
afterAll(cleanupTempProjects);

function install(withBundle: boolean): string {
  const root = tempProject();
  mkdirSync(join(root, 'shells/hooks'), { recursive: true });
  copyFileSync(source, join(root, 'shells/hooks/entry.mjs'));
  copyFileSync(shell, join(root, 'shells/hooks/entry.sh'));
  if (withBundle) {
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist/fwos.mjs'), `export function dispatch(event, input, cwd) {
      return { stdout: JSON.stringify({ event, input, cwd }), code: 0 };
    }\n`);
  }
  return join(root, 'shells/hooks/entry.sh');
}

function invoke(entry: string, cwd: string, input: string, event = 'pre-tool-use') {
  const result = spawnSync('/bin/sh', [entry, event], { cwd, input, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const silent = { code: 0, out: '', err: '' };

describe('lightweight hook entry', () => {
  it.runIf(spawnSync('jq', ['--version']).status === 0)('does not start Node outside a project when jq is available', () => {
    const bin = tempProject();
    const marker = join(bin, 'node-started');
    writeFileSync(join(bin, 'node'), `#!/bin/sh\nprintf started > '${marker}'\nexit 99\n`);
    chmodSync(join(bin, 'node'), 0o755);
    const result = spawnSync('/bin/sh', [install(false), 'pre-tool-use'], {
      cwd: tempProject(), input: JSON.stringify({ tool_name: 'Read' }), encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    expect({ code: result.status, out: result.stdout, err: result.stderr }).toEqual(silent);
    expect(() => readFileSync(marker)).toThrow();
  });

  it('falls back to Node when jq is unavailable', () => {
    const bin = tempProject();
    symlinkSync(process.execPath, join(bin, 'node'));
    const cat = spawnSync('/bin/sh', ['-c', 'command -v cat'], { encoding: 'utf8' }).stdout.trim();
    symlinkSync(cat, join(bin, 'cat'));
    const cwd = tempProject({ '.fwos/state.json': '{}' });
    const result = spawnSync('/bin/sh', [install(true), 'pre-tool-use'], {
      cwd: tempProject(), input: JSON.stringify({ tool_name: 'Read', cwd }), encoding: 'utf8', env: { ...process.env, PATH: bin },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).input).toEqual({ tool_name: 'Read', cwd });
  });

  it.each(['apps/web/../web', 'apps//web/.'])('normalizes payload cwd %s without bypassing an ancestor project', (suffix) => {
    const cwd = tempProject({ '.fwos/state.json': '{}', 'apps/web/file.ts': '' });
    const input = { tool_name: 'Read', cwd: `${cwd}/${suffix}` };
    expect(JSON.parse(invoke(install(true), tempProject(), JSON.stringify(input)).out).input).toEqual(input);
  });

  it('falls back for relative cwd and paths containing newlines', () => {
    const cwd = tempProject({ '.fwos/state.json': '{}', 'line\nend/file.ts': '' });
    for (const path of ['line\nend', `${cwd}/line\nend`]) {
      const input = { tool_name: 'Read', cwd: path };
      expect(JSON.parse(invoke(install(true), cwd, JSON.stringify(input)).out).input).toEqual(input);
    }
  });

  it('preserves real planner denials through the installed shell entry, including a payload cwd override', () => {
    const project = tempProject();
    initProject(project);
    const entry = new URL('../../../../distribution/plugin/shells/hooks/entry.sh', import.meta.url).pathname;
    for (const cwd of [project, tempProject()]) {
      for (const tool_name of ['Read', 'Bash', 'mcp__custom_tool']) {
        const input = { cwd: project, tool_name, agent_type: 'fwos:test-planner' };
        const result = invoke(entry, cwd, JSON.stringify(input));
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out).hookSpecificOutput.permissionDecision).toBe('deny');
        expect(result.out).toContain('tests/planner-sandbox');
      }
    }
  });

  it('does not load the CLI outside fwos projects, even when the bundle is absent', () => {
    expect(invoke(install(false), tempProject(), JSON.stringify({ tool_name: 'Read' }))).toEqual(silent);
  });

  it.each(['null', '[]', '42', 'true', '"Read"', '{ invalid'])('ignores malformed input %s before loading the CLI', (input) => {
    expect(invoke(install(false), tempProject({ '.fwos/state.json': '{}' }), input)).toEqual(silent);
  });

  it('uses the payload cwd rather than the process cwd and finds ancestor state without reading it', () => {
    const project = tempProject({ '.fwos/state.json': '{ malformed state', 'apps/web/file.ts': '' });
    const cwd = tempProject();
    const input = { tool_name: 'Read', cwd: join(project, 'apps/web'), agent_type: 'fwos:test-planner' };
    const result = invoke(install(true), cwd, JSON.stringify(input));
    expect(result.code).toBe(0);
    expect(result.err).toBe('');
    expect(JSON.parse(result.out)).toEqual({ event: 'pre-tool-use', input, cwd: realpathSync(cwd) });
  });

  it('stays silent for a non-project payload cwd even when the process cwd is an fwos project', () => {
    const project = tempProject({ '.fwos/state.json': '{}' });
    expect(invoke(install(false), project, JSON.stringify({ cwd: tempProject(), tool_name: 'Read' }))).toEqual(silent);
  });

  it.each(['Read', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'apply_patch', 'mcp__custom_tool', 'SubagentHandback'])('forwards %s and all planner metadata unchanged', (tool_name) => {
    const cwd = tempProject({ '.fwos/state.json': '{}' });
    const input = { tool_name, agent: { name: 'fwos:test-planner' }, tool_input: { command: '*** Begin Patch\n*** End Patch' } };
    const result = invoke(install(true), cwd, JSON.stringify(input));
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({ event: 'pre-tool-use', input, cwd: realpathSync(cwd) });
  });

  it('forwards empty stdin as an empty object, as the CLI hook command does', () => {
    const cwd = tempProject({ '.fwos/state.json': '{}' });
    const result = invoke(install(true), cwd, '   ');
    expect(JSON.parse(result.out)).toEqual({ event: 'pre-tool-use', input: {}, cwd: realpathSync(cwd) });
  });

  it('uses the lightweight entry for pre/post hooks while SessionStart always loads the CLI', () => {
    expect(hooks.hooks.PreToolUse[0].matcher).toBe('*');
    for (const event of ['PreToolUse', 'PostToolUse']) expect(hooks.hooks[event][0].hooks[0].command).toContain('/shells/hooks/entry.sh');
    expect(hooks.hooks.SessionStart[0].hooks[0].command).toContain('/dist/fwos.mjs');
  });

  it('forwards post-tool-use after finding state', () => {
    const cwd = tempProject({ '.fwos/state.json': '{}' });
    const input = { tool_name: 'Edit' };
    const result = invoke(install(true), cwd, JSON.stringify(input), 'post-tool-use');
    expect(JSON.parse(result.out)).toEqual({ event: 'post-tool-use', input, cwd: realpathSync(cwd) });
  });
});
