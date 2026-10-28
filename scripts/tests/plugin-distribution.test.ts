// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';

const repo = new URL('../../', import.meta.url).pathname;
const marketplace = JSON.parse(readFileSync(join(repo, '.claude-plugin/marketplace.json'), 'utf8'));
const payload = join(repo, marketplace.plugins[0].source);
const scratch = mkdtempSync(join(tmpdir(), 'fwos-plugin-distribution-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function files(root: string, prefix = ''): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = join(prefix, entry.name);
    return entry.isDirectory() ? files(root, path) : [path];
  });
}

it('installs a committed runtime payload without developer tests, fixtures or source modules', () => {
  expect(marketplace.plugins[0].source).toBe('./distribution/plugin');
  const shipped = files(payload);
  expect(shipped).toContain('dist/fwos.mjs');
  expect(shipped).toContain('kernel/knowledge/house-rules.md');
  expect(shipped).toContain('modules/tests/agents/test-planner.md');
  expect(shipped).toContain('modules/screens/templates/web/apps/web/src/shared/ui/ui.test.tsx');
  expect(shipped.filter((path) => /\/(checks\/fixtures|tests\/tests|evals)\//.test(path))).toEqual([]);
  expect(shipped.filter((path) => path.endsWith('.ts') && !path.includes('/templates/'))).toEqual([]);
  expect(shipped.length).toBeLessThan(files(join(repo, 'plugin')).length / 2);
});

it('keeps manifest entries and every prompt reference inside the installed payload', () => {
  const manifest = JSON.parse(readFileSync(join(payload, '.claude-plugin/plugin.json'), 'utf8'));
  for (const path of [...manifest.skills, ...manifest.agents, manifest.hooks]) expect(existsSync(join(payload, path)), path).toBe(true);
  for (const file of files(payload).filter((path) => path.endsWith('.md'))) {
    const text = readFileSync(join(payload, file), 'utf8');
    for (const match of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s`",;)]+)/g)) {
      const path = match[1]!.replace(/\.$/, '');
      expect(existsSync(join(payload, path)), `${file}: ${path}`).toBe(true);
    }
  }
});

it('scaffolds and writes Codex agents using only the installed payload', () => {
  const installed = join(scratch, 'plugin');
  cpSync(payload, installed, { recursive: true });
  const app = join(scratch, 'app');
  mkdirSync(app);
  const run = (...args: string[]) => execFileSync(process.execPath, [join(installed, 'dist/fwos.mjs'), ...args], { cwd: app, env: { ...process.env, CODEX_THREAD_ID: '', CODEX_SESSION_ID: '' }, encoding: 'utf8' });
  run('init', '--name', 'sample');
  run('scaffold', 'web');
  run('codex', 'agents');
  const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  expect(pkg.devDependencies['fwos-check']).toBe('file:.fwos/cli');
  expect(readFileSync(join(app, '.fwos/cli/dist/fwos.mjs'), 'utf8')).toBe(readFileSync(join(installed, 'dist/fwos.mjs'), 'utf8'));
  expect(readFileSync(join(app, '.codex/agents/fwos-builder.toml'), 'utf8')).toContain(installed);
});
