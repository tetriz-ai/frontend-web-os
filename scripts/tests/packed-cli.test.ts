// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT
// Exercise the actual packed CLI archive, without registry access or a full plugin installation.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
const repo = new URL('../../', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'fwos-packed-cli-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const env = { ...process.env, npm_config_cache: join(scratch, '.npm-cache'), npm_config_userconfig: '/dev/null', npm_config_registry: 'https://registry.npmjs.org', CODEX_THREAD_ID: '', CODEX_SESSION_ID: 'synthetic-packed-codex', NO_COLOR: '1' };
const pack = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], { cwd: repo, env, encoding: 'utf8' }))[0];
execFileSync('tar', ['-xf', join(scratch, pack.filename), '-C', scratch]);
const pkgRoot = join(scratch, 'package');
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
const app = join(scratch, 'app'); mkdirSync(app);
writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { next: '16.2.3', react: '19.2.4' } }));
mkdirSync(join(app, 'app')); writeFileSync(join(app, 'app/page.tsx'), 'export default function P(){return null;}');
const run = (...args: string[]) => spawnSync(process.execPath, [join(pkgRoot, pkg.bin.fwos), ...args], { cwd: app, env, encoding: 'utf8' });
it('adopts in a Codex session without pretending this CLI payload contains host agents', () => {
  const adopted = run('adopt', '--yes');
  expect(adopted.status, adopted.stderr).toBe(0);
  expect(adopted.stdout).not.toMatch(/missing.*agent|reinstall the plugin/i);
  const explicit = run('codex', 'agents');
  expect(explicit.status).toBe(2);
  expect(explicit.stderr).toMatch(/npm distribution|checks CLI/);
  expect(explicit.stderr).toMatch(/full installed plugin CLI/);
});
it('ships the actual harness templates and can generate them from the packed CLI', () => {
  const generated = run('harness');
  expect(generated.status, generated.stderr).toBe(0);
  expect(readFileSync(join(app, 'app/../e2e/fwos-states.spec.ts'), 'utf8')).toContain('harness');
});
it('keeps genuinely corrupt full-plugin agent assets an error', () => {
  const full = join(scratch, 'corrupt-plugin'); mkdirSync(join(full, '.claude-plugin'), { recursive: true }); mkdirSync(join(full, 'dist'));
  writeFileSync(join(full, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'fwos', version: '0.1.0', agents: ['./missing-agent.md'] }));
  writeFileSync(join(full, 'dist/fwos.mjs'), readFileSync(join(repo, 'plugin/dist/fwos.mjs'))); chmodSync(join(full, 'dist/fwos.mjs'), 0o755);
  const result = spawnSync(process.execPath, [join(full, 'dist/fwos.mjs'), 'codex', 'agents'], { cwd: app, env, encoding: 'utf8' });
  expect(result.status).toBe(2); expect(result.stderr).toMatch(/missing.*agent|missing-agent/i);
});
