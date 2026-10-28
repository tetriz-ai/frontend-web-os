// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pluginRoot, readJson } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { type Io } from '../commands.ts';
import { CODEX_AGENTS_DIR, codexAgentFiles, codexAgentsStatus, writeCodexAgents } from '../codex.ts';
import { main } from '../main.ts';

afterAll(cleanupTempProjects);
const savedThread = process.env.CODEX_THREAD_ID;
const savedSession = process.env.CODEX_SESSION_ID;
beforeEach(() => {
  delete process.env.CODEX_THREAD_ID;
  delete process.env.CODEX_SESSION_ID;
});
afterEach(() => {
  if (savedThread === undefined) delete process.env.CODEX_THREAD_ID;
  else process.env.CODEX_THREAD_ID = savedThread;
  if (savedSession === undefined) delete process.env.CODEX_SESSION_ID;
  else process.env.CODEX_SESSION_ID = savedSession;
});

async function fwos(cwd: string, ...argv: string[]) {
  const out: string[] = [];
  const io: Io = { out: (...l) => out.push(...l), err: (...l) => out.push(...l), cwd };
  const code = await main(argv, io);
  return { code, out: out.join('\n') };
}

const shipped = readJson<{ agents: string[] }>(join(pluginRoot, '.claude-plugin', 'plugin.json'))!.agents;
/** One TOML key's string value: a basic "..." string or a '''...''' literal block. */
const value = (toml: string, key: string) => {
  const basic = new RegExp(`^${key} = ("(?:[^"\\\\]|\\\\.)*")$`, 'm').exec(toml);
  if (basic) return JSON.parse(basic[1]!) as string;
  const literal = new RegExp(`^${key} = '''\\n([\\s\\S]*?)'''$`, 'm').exec(toml);
  return literal ? literal[1]! : null;
};

describe('Codex agent files', () => {
  const files = codexAgentFiles();

  it('has one per agent the plugin ships, named as fwos skills and hooks name them', () => {
    expect(files.map((f) => f.name).sort()).toEqual(['adjudicator', 'builder', 'lens-reviewer', 'qa-explorer', 'researcher', 'spec-reviewer', 'test-planner', 'test-writer']);
    expect(files.length).toBe(shipped.length);
    for (const f of files) expect(f.path).toBe(`${CODEX_AGENTS_DIR}/fwos-${f.name}.toml`);
  });

  it('carries each agent\'s description and instructions, with the plugin folder filled in', () => {
    for (const f of files) {
      expect(value(f.content, 'name')).toBe(f.name);
      expect(value(f.content, 'description')).toMatch(/^Frontend Web OS/);
      const instructions = value(f.content, 'developer_instructions');
      expect(instructions?.length, f.name).toBeGreaterThan(200);
      expect(f.content, f.name).not.toContain('${CLAUDE_PLUGIN_ROOT}');
    }
    expect(value(files.find((f) => f.name === 'lens-reviewer')!.content, 'developer_instructions')).toContain(join(pluginRoot, 'modules/rules/lenses'));
  });

  it('gives a writable workspace only to agents that may write or run commands', () => {
    const sandbox = Object.fromEntries(files.map((f) => [f.name, /^sandbox_mode = "(.+)"$/m.exec(f.content)?.[1]]));
    expect(sandbox).toEqual({
      adjudicator: 'read-only',
      builder: 'workspace-write',
      'lens-reviewer': 'read-only',
      'qa-explorer': 'workspace-write',
      researcher: 'read-only',
      'spec-reviewer': 'read-only',
      'test-planner': 'read-only',
      'test-writer': 'workspace-write',
    });
  });

  it('points an agent that preloads skills in Claude Code at them', () => {
    expect(value(files.find((f) => f.name === 'qa-explorer')!.content, 'developer_instructions')).toMatch(/read the `fwos:web-profile` skill/);
  });
});

describe('fwos codex agents', () => {
  it('writes the files, git-ignores them, and leaves them alone when nothing changed', async () => {
    const root = tempProject({ '.gitignore': 'node_modules/\n' });
    const first = await fwos(root, 'codex', 'agents');
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/Wrote 8 fwos agents in \.codex\/agents\//);
    expect(readdirSync(join(root, CODEX_AGENTS_DIR)).sort()).toEqual(codexAgentFiles().map((f) => f.path.split('/').pop()).sort());
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe("node_modules/\n# fwos: its agents for Codex hold this machine's plugin folder\n.codex/agents/fwos-*.toml\n");
    expect((await fwos(root, 'codex', 'agents')).out).toMatch(/Unchanged: 8 fwos agents/);
    expect(readFileSync(join(root, '.gitignore'), 'utf8').match(/fwos-\*\.toml/g)?.length).toBe(1);
  });

  it("won't replace an agent file fwos didn't write", () => {
    const root = tempProject({ [`${CODEX_AGENTS_DIR}/fwos-builder.toml`]: 'name = "builder"\n' });
    expect(() => writeCodexAgents(root)).toThrow(/fwos didn't write it/);
  });

  it('reports files that are missing or from another version or folder', () => {
    const root = tempProject({});
    expect(codexAgentsStatus(root)).toEqual({ found: 0, expected: 8, stale: codexAgentFiles().map((f) => f.path) });
    writeCodexAgents(root);
    expect(codexAgentsStatus(root).stale).toEqual([]);
    const builder = join(root, CODEX_AGENTS_DIR, 'fwos-builder.toml');
    writeFileSync(builder, readFileSync(builder, 'utf8').replace(pluginRoot, '/an/older/plugin'));
    expect(codexAgentsStatus(root).stale).toEqual([`${CODEX_AGENTS_DIR}/fwos-builder.toml`]);
  });
});

describe('Codex in init and doctor', () => {
  it('init writes the agents when it runs inside Codex, and not otherwise', async () => {
    delete process.env.CODEX_THREAD_ID;
    const plain = tempProject({});
    expect((await fwos(plain, 'init')).out).not.toContain('Codex');
    expect(codexAgentsStatus(plain).found).toBe(0);
    process.env.CODEX_THREAD_ID = 'thread';
    const inCodex = tempProject({});
    expect((await fwos(inCodex, 'init')).out).toContain('Codex: 8 fwos agents in .codex/agents/');
    expect(codexAgentsStatus(inCodex).stale).toEqual([]);
  });

  it('detects Codex from the session id without a thread id', async () => {
    process.env.CODEX_SESSION_ID = 'synthetic-codex-session';
    const root = tempProject({});
    expect((await fwos(root, 'init')).out).toContain('Codex: 8 fwos agents in .codex/agents/');
    expect(codexAgentsStatus(root).stale).toEqual([]);
  });

  it("init still sets the project up when Codex's sandbox keeps .codex/ read-only, and says how to finish", async () => {
    process.env.CODEX_THREAD_ID = 'thread';
    const root = tempProject({});
    mkdirSync(join(root, '.codex'));
    chmodSync(join(root, '.codex'), 0o555);
    try {
      const r = await fwos(root, 'init');
      expect(r.code).toBe(0);
      expect(existsSync(join(root, '.fwos/state.json'))).toBe(true);
      expect(r.out).toMatch(/Codex: Couldn't write \.codex\/agents\/: Codex's sandbox keeps \.codex\/ read-only\. Approve running it outside the sandbox/);
      expect(r.out).toContain(`node "${join(pluginRoot, 'dist', 'fwos.mjs')}" codex agents`);
    } finally {
      chmodSync(join(root, '.codex'), 0o755);
    }
  });

  it('doctor shows the Codex agents when a project has them, and says when to rewrite them', async () => {
    delete process.env.CODEX_THREAD_ID;
    const root = tempProject({});
    await fwos(root, 'init');
    expect(JSON.parse((await fwos(root, 'doctor', '--json')).out).codex).toBeNull();
    writeCodexAgents(root);
    expect((await fwos(root, 'doctor')).out).toContain('Codex  8 agents in .codex/agents/, current');
    const tester = join(root, CODEX_AGENTS_DIR, 'fwos-test-writer.toml');
    writeFileSync(tester, readFileSync(tester, 'utf8').replace('fwos 0.', 'fwos 9.'));
    expect((await fwos(root, 'doctor')).out).toMatch(/Codex {2}1 of 8 agents .* run `fwos codex agents`/);
  });
});
