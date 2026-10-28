// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// fwos in a real Codex: install the plugin from this checkout's marketplace into a throwaway Codex
// home, then let Codex work in an fwos project. It proves the skills load, the session learns the
// plugin folder, a patch adding app source before the spec is approved is refused, the test
// planner runs no tool, and a skill can run the CLI. The refusals are read from Codex's own
// session logs, not from what the model says about them.
//
// It needs the Codex CLI, logged in, and spends a little usage, so it runs only with FWOS_CODEX=1
// (`pnpm test:codex`). The throwaway home links to ~/.codex/auth.json for the login and never reads
// it. Hooks run with --dangerously-bypass-hook-trust, which stands in for trusting fwos's hooks once
// in Codex (/hooks).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { plannerSession, toolCalls } from '../codex-session-events.ts';

const REPO = new URL('../../', import.meta.url).pathname;
const enabled = process.env.FWOS_CODEX === '1';
const base = enabled ? mkdtempSync(join(tmpdir(), 'fwos-codex-')) : '';
const home = join(base, 'home');
const project = join(base, 'project');
const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: home, NO_COLOR: '1' };
delete env.PLUGIN_ROOT;
delete env.CLAUDE_PLUGIN_ROOT;

const codex = (args: string[], cwd = project) =>
  execFileSync('codex', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 });
const exec = (prompt: string) => codex(['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--dangerously-bypass-hook-trust', prompt]);
const fwos = (...args: string[]) => execFileSync(process.execPath, [join(REPO, 'plugin/dist/fwos.mjs'), ...args], { cwd: project, encoding: 'utf8' });

/** Each Codex session log so far (one per session, subagents included), hook decisions included. */
function sessions(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.jsonl')) out.push(readFileSync(p, 'utf8'));
    }
  };
  if (existsSync(join(home, 'sessions'))) walk(join(home, 'sessions'));
  return out;
}
const sessionLog = () => sessions().join('\n');


afterAll(() => {
  if (enabled && !process.env.FWOS_CODEX_KEEP) rmSync(base, { recursive: true, force: true });
});

describe.runIf(enabled)('fwos in Codex', () => {
  let pluginDir = '';

  it('installs from this repo and lists every fwos skill', () => {
    mkdirSync(home, { recursive: true });
    mkdirSync(project, { recursive: true });
    const auth = join(homedir(), '.codex', 'auth.json');
    if (!existsSync(auth)) throw new Error('Codex is not logged in (no ~/.codex/auth.json): run `codex login` first.');
    symlinkSync(auth, join(home, 'auth.json'));
    codex(['plugin', 'marketplace', 'add', REPO]);
    pluginDir = /Installed plugin root: (.+)/.exec(codex(['plugin', 'add', 'fwos@frontend-web-os']))![1]!.trim();
    writeFileSync(join(home, 'config.toml'), `${readFileSync(join(home, 'config.toml'), 'utf8')}\n[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n`);
    const prompt = codex(['debug', 'prompt-input', 'hi']);
    const skills = [...new Set(prompt.match(/fwos:[a-z-]+(?=:)/g) ?? [])].sort();
    expect(skills).toEqual(['fwos:accept', 'fwos:adopt', 'fwos:architecture', 'fwos:build', 'fwos:change', 'fwos:design-system', 'fwos:discovery', 'fwos:doctor', 'fwos:eject', 'fwos:learn', 'fwos:research', 'fwos:screens', 'fwos:spec', 'fwos:start', 'fwos:status', 'fwos:web-profile']);
  }, 120_000);

  it('tells the session where the plugin is', () => {
    const out = exec('Without running any tools: what is the fwos plugin folder your context names? Reply with the path only.');
    expect(out).toContain(pluginDir);
  }, 600_000);

  it('refuses a patch that adds app source before the spec is approved', () => {
    execFileSync('git', ['init', '-q'], { cwd: project });
    fwos('init', '--name', 'Codex check');
    expect(fwos('codex', 'agents')).toMatch(/8 fwos agents/);
    exec('Use your apply_patch tool, not the shell, to create apps/web/src/feature.ts containing `export const f = 1;`. If it is refused, stop and quote the reason.');
    expect(existsSync(join(project, 'apps/web/src/feature.ts'))).toBe(false);
    expect(sessionLog()).toContain('fwos [state/spec-gate]: apps/web/src/feature.ts is app source');
  }, 600_000);

  it('runs the test planner as fwos defines it, and none of its tool calls runs', () => {
    exec('Spawn the test-planner agent. Tell it to run `ls` with the shell and report what it saw. Wait for it, then tell me what happened.');
    // Codex spawned fwos's agent by name, from .codex/agents/fwos-test-planner.toml...
    expect(sessionLog()).toMatch(/"agent_type\\?":\\?"test-planner/);
    // ...and in the planner's own session every tool call, if it tried any, was denied by the
    // hook. (It usually doesn't try: its instructions already say it has no tools.)
    const planner = sessions().map(plannerSession).filter((session): session is string => session !== null);
    expect(planner.length).toBeGreaterThan(0);
    for (const call of planner.flatMap(toolCalls)) expect(call.output, call.name).toContain('fwos [tests/planner-sandbox]');
  }, 600_000);

  it('runs the CLI from a skill', () => {
    const out = exec('Use the fwos:status skill and show me what it reports.');
    expect(out).toMatch(/0001-initial/);
  }, 600_000);
});
