// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Every plugin agent must start on current models. Claude Code refuses to spawn an agent whose
// tool list resolves to nothing, and some built-in tools exist only on some models: the task
// tools (TodoWrite, TaskCreate...) are absent on current models, so a tool list made only of them
// leaves the agent unable to start.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter, walkFiles } from '../../plugin/kernel/index.ts';

const PLUGIN = join(__dirname, '../../plugin');
/** Tools Claude Code provides only on some models, or has retired. */
const NOT_EVERYWHERE = new Set(['TodoWrite', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'MultiEdit']);
/** Tools that may be absent by default on some platforms (Glob and Grep on macOS and Linux). */
const PLATFORM_OPTIONAL = new Set(['Glob', 'Grep']);

const agents = walkFiles(PLUGIN, { include: ['**/agents/*.md'] }).map((rel) => {
  const fm = parseFrontmatter(readFileSync(join(PLUGIN, rel), 'utf8')).data as { name?: string; tools?: string };
  return { rel, name: fm.name ?? rel, tools: String(fm.tools ?? '').split(',').map((t) => t.trim()).filter(Boolean) };
});

describe('plugin agents', () => {
  it('found the agents', () => {
    expect(agents.length).toBeGreaterThanOrEqual(8);
  });

  it.each(agents.map((a) => [a.name, a] as const))('%s can start on every current model and platform', (_name, a) => {
    expect(a.tools.length, `${a.rel} needs a tools list`).toBeGreaterThan(0);
    expect(a.tools.filter((t) => NOT_EVERYWHERE.has(t)), `${a.rel} lists tools that don't exist on current models`).toEqual([]);
    expect(a.tools.some((t) => !PLATFORM_OPTIONAL.has(t)), `${a.rel} has only platform-optional tools`).toBe(true);
  });

  it('keeps the test planner away from files, shells and the web', () => {
    const planner = agents.find((a) => a.name === 'test-planner');
    expect(planner?.tools.filter((t) => /^(Read|Write|Edit|Glob|Grep|Bash|PowerShell|NotebookEdit|LSP|WebFetch|WebSearch)$/.test(t))).toEqual([]);
  });

  // The lens reviewer reads files and has no shell, so it can't run `git diff` itself. In live
  // Reviewers told only to review
  // `git diff lens-base` read whole files and guessed what had changed, and reviewers handed the
  // diff as a file cited lines by their place in the patch.
  it('hands the lens reviewers the diff itself, since they have no shell to run git', () => {
    const lens = agents.find((a) => a.name === 'lens-reviewer')!;
    expect(lens.tools).not.toContain('Bash');
    const accept = readFileSync(join(PLUGIN, 'modules/accept/skills/accept/SKILL.md'), 'utf8');
    const step = accept.slice(accept.indexOf('**Lens review.**'), accept.indexOf('5. **'));
    expect(step).toMatch(/the\s+diff\s+itself/);
    const body = parseFrontmatter(readFileSync(join(PLUGIN, 'modules/rules/agents/lens-reviewer.md'), 'utf8')).body;
    expect(body).toMatch(/no\s+shell/);
    expect(body).toMatch(/as\s+Read\s+shows/);
    // ...and opens each changed file before it cites a line: given the diff, a reviewer that
    // counted lines in the pasted hunk still cited the wrong one (the same README, round 2).
    expect(body).toMatch(/Read\s+each\s+changed\s+file\s+before/);
  });
});
