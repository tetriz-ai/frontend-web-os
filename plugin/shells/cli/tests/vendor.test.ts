// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The copy of the CLI that `fwos scaffold` vendors into a project (.fwos/cli) runs with no path to
// the plugin, so it has to hold every file the CLI reads from the plugin folder at run time. It and
// the other files fwos owns in a project are refreshed all or none, never around a hand edit.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hashText, pluginPath, pluginRoot, readJson, walkFiles, writeJson, writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { type Manifest, backupFiles, initProject } from '../../../modules/state/index.ts';
import { VENDORED_CLI, vendorCli } from '../vendor.ts';

afterAll(cleanupTempProjects);

const vendoredProject = () => {
  const root = tempProject({});
  initProject(root);
  vendorCli(root);
  return root;
};

/** Every file under a folder, relative to it. */
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name]));

describe('the vendored CLI', () => {
  it('runs design-system init from the copy alone, in a project with no design system yet', () => {
    const root = vendoredProject();
    const r = spawnSync(process.execPath, [join(root, VENDORED_CLI, 'dist', 'fwos.mjs'), 'design-system', 'init'], { cwd: root, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    for (const f of ['design-system.json', 'components.json', 'tokens/light.json', 'tokens/dark.json']) expect(existsSync(join(root, 'design-system', f)), f).toBe(true);
  });

  it('holds, unchanged, every file and folder the CLI names with pluginPath', () => {
    const root = vendoredProject();
    // The vendored package.json is written for the copy, and carries the version plugin.json would.
    const writtenForTheCopy = ['package.json', '.claude-plugin/plugin.json'];
    const named = walkFiles(pluginRoot, { include: ['**/*.ts'], exclude: ['**/tests/**', '**/templates/**', 'dist/**'] })
      .flatMap((f) => [...readFileSync(join(pluginRoot, f), 'utf8').matchAll(/\bpluginPath\(((?:\s*'[^']*'\s*,?)+)\)/g)])
      .map((m) => [...m[1]!.matchAll(/'([^']*)'/g)].map((a) => a[1]).join('/'))
      .filter((p) => !writtenForTheCopy.includes(p));
    // Positive control: the scan finds the bundle, the rule pack, the starter, the templates and the harness.
    expect(new Set(named)).toEqual(new Set(['dist/fwos.mjs', 'modules/rules/pack', 'modules/design-system/starter', 'modules/screens/templates', 'platforms/web/templates/harness']));
    for (const p of named) {
      const files = statSync(pluginPath(p)).isDirectory() ? filesUnder(pluginPath(p)).map((f) => `${p}/${f}`) : [p];
      for (const f of files) {
        expect(existsSync(join(root, VENDORED_CLI, f)), `${VENDORED_CLI}/${f}`).toBe(true);
        expect(readFileSync(join(root, VENDORED_CLI, f)).equals(readFileSync(pluginPath(f))), f).toBe(true);
      }
    }
  });
});

/** What an older fwos left in the copy: `rel` holds `text`, and the manifest says fwos wrote it. */
function olderBuild(root: string, rel: string, text: string): void {
  const path = join(root, '.fwos', 'manifest.json');
  const manifest = readJson<Manifest>(path)!;
  writeText(join(root, rel), text);
  manifest.files[rel] = { sha: hashText(text), kind: 'fwos', source: `plugin ${rel.slice(VENDORED_CLI.length + 1)}`, pluginVersion: '0.0.9' };
  writeJson(path, manifest);
}

const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');
const backups = (root: string) => (existsSync(join(root, '.fwos/local/backup')) ? readdirSync(join(root, '.fwos/local/backup')) : []);

describe('refreshing the vendored CLI', () => {
  it('writes nothing while a file in the copy is patched, and names every patched file', () => {
    const root = vendoredProject();
    olderBuild(root, `${VENDORED_CLI}/dist/fwos.mjs`, '// an older build\n');
    // Someone weakened a rule in the copy, and edited a template: the manifest still holds what fwos wrote.
    writeText(join(root, VENDORED_CLI, 'modules/rules/pack/no-raw-intl.yaml'), 'id: no-raw-intl\n');
    writeText(join(root, VENDORED_CLI, 'modules/screens/templates/web/README.md'), '# ours\n');
    expect(() => vendorCli(root)).toThrow(
      new RegExp(`${VENDORED_CLI}/modules/rules/pack/no-raw-intl\\.yaml[^]*${VENDORED_CLI}/modules/screens/templates/web/README\\.md`),
    );
    // Nothing was refreshed around them: the older bundle is still there, and nothing was backed up.
    expect(read(root, `${VENDORED_CLI}/dist/fwos.mjs`)).toBe('// an older build\n');
    expect(backups(root)).toEqual([]);
  });

  it('refuses a file fwos did not write in a folder the CLI reads, such as an extra rule', () => {
    const root = vendoredProject();
    olderBuild(root, `${VENDORED_CLI}/dist/fwos.mjs`, '// an older build\n');
    writeText(join(root, VENDORED_CLI, 'modules/rules/pack/our-rule.yaml'), 'id: our-rule\n');
    expect(() => vendorCli(root)).toThrow(/\.fwos\/cli\/modules\/rules\/pack\/our-rule\.yaml/);
    expect(read(root, `${VENDORED_CLI}/dist/fwos.mjs`)).toBe('// an older build\n');
  });

  it('backs up what it replaces, then holds exactly what this fwos ships', () => {
    const root = vendoredProject();
    olderBuild(root, `${VENDORED_CLI}/dist/fwos.mjs`, '// an older build\n');
    vendorCli(root);
    expect(readFileSync(join(root, VENDORED_CLI, 'dist/fwos.mjs')).equals(readFileSync(pluginPath('dist/fwos.mjs')))).toBe(true);
    const [stamp, ...more] = backups(root);
    expect(more).toEqual([]);
    expect(read(root, `.fwos/local/backup/${stamp}/${VENDORED_CLI}/dist/fwos.mjs`)).toBe('// an older build\n');
    expect(walkFiles(join(root, '.fwos/local/backup', stamp!))).toEqual([`${VENDORED_CLI}/dist/fwos.mjs`]);
  });

  it('removes a file this fwos no longer ships, so the copy stops reading it', () => {
    const root = vendoredProject();
    // A rule an older fwos shipped and this one dropped: still loaded by the copy until it goes.
    const dropped = `${VENDORED_CLI}/modules/rules/pack/no-dropped-rule.yaml`;
    olderBuild(root, dropped, readFileSync(pluginPath('modules/rules/pack/no-pie-chart.yaml'), 'utf8').replace('id: no-pie-chart', 'id: no-dropped-rule'));
    writeText(join(root, 'apps/web/src/a.tsx'), 'export const A = () => null;\n');
    const rules = () => spawnSync(process.execPath, [join(root, VENDORED_CLI, 'dist/fwos.mjs'), 'check', 'rules/pack'], { cwd: root, encoding: 'utf8' }).stdout;
    expect(rules()).toMatch(/8 rules active/);
    vendorCli(root);
    expect(existsSync(join(root, dropped))).toBe(false);
    expect(readJson<Manifest>(join(root, '.fwos/manifest.json'))!.files[dropped]).toBeUndefined();
    expect(rules()).toMatch(/7 rules active/);
    const [stamp] = backups(root);
    expect(read(root, `.fwos/local/backup/${stamp}/${dropped}`)).toMatch(/id: no-dropped-rule/);
  });

  it('keeps a dropped file someone patched, and says so', () => {
    const root = vendoredProject();
    const dropped = `${VENDORED_CLI}/modules/rules/pack/no-dropped-rule.yaml`;
    olderBuild(root, dropped, 'id: no-dropped-rule\n');
    writeText(join(root, dropped), 'id: no-dropped-rule\n# ours\n');
    expect(() => vendorCli(root)).toThrow(/no-dropped-rule\.yaml/);
    expect(read(root, dropped)).toBe('id: no-dropped-rule\n# ours\n');
  });
});

describe('generated files', () => {
  it('fwos tokens build writes neither file while the other was edited by hand', async () => {
    const { main } = await import('../main.ts');
    const { starterFiles } = await import('../../../modules/design-system/index.ts');
    const root = tempProject(Object.fromEntries(starterFiles().map((f) => [`design-system/${f.path}`, f.content])));
    initProject(root);
    const io = { out: () => {}, err: () => {}, cwd: root };
    expect(await main(['tokens', 'build'], io)).toBe(0);
    const tokens = join(root, 'packages/tokens/generated/tokens.css');
    const before = readFileSync(tokens, 'utf8');
    writeText(join(root, 'packages/tokens/generated/theme.css'), '/* hand edit */\n');
    // A token change that makes tokens.css due for a rewrite: the small radius, 4px to 3px.
    const base = join(root, 'design-system/tokens/base.json');
    const doc = JSON.parse(readFileSync(base, 'utf8'));
    doc.radius.sm.$value.value = 3;
    writeText(base, JSON.stringify(doc));
    expect(await main(['tokens', 'build'], io)).toBe(2);
    expect(readFileSync(tokens, 'utf8')).toBe(before);
  });
});


describe('vendor file boundaries', () => {
  it('refuses a traversal manifest entry before deleting or backing up a sibling file', () => {
    const parent = tempProject({ 'victim.txt': 'synthetic sentinel' });
    const root = join(parent, 'app');
    mkdirSync(root);
    initProject(root);
    const manifest = readJson<Manifest>(join(root, '.fwos/manifest.json'))!;
    manifest.files['.fwos/cli/../../../victim.txt'] = { sha: hashText('synthetic sentinel'), kind: 'fwos', pluginVersion: '0.0.9' };
    writeJson(join(root, '.fwos/manifest.json'), manifest);
    expect(() => vendorCli(root)).toThrow(/path|symlink/i);
    expect(readFileSync(join(parent, 'victim.txt'), 'utf8')).toBe('synthetic sentinel');
    expect(existsSync(join(root, '.fwos/cli'))).toBe(false);
    expect(backups(root)).toEqual([]);
  });

  it.each(['.fwos/cli', '.fwos/cli/dist'])('refuses a symlinked %s before writing outside the project', (rel) => {
    const root = tempProject();
    const outside = tempProject();
    initProject(root);
    mkdirSync(join(root, rel, '..'), { recursive: true });
    symlinkSync(outside, join(root, rel), 'dir');
    expect(() => vendorCli(root)).toThrow(/symlink/i);
    expect(readdirSync(outside)).toEqual([]);
    expect(backups(root)).toEqual([]);
  });

  it('refuses a symlinked backup directory before copying or replacing an owned file', () => {
    const root = vendoredProject();
    const outside = tempProject();
    const bundle = `${VENDORED_CLI}/dist/fwos.mjs`;
    olderBuild(root, bundle, '// synthetic previous runtime\n');
    mkdirSync(join(root, '.fwos/local'), { recursive: true });
    symlinkSync(outside, join(root, '.fwos/local/backup'), 'dir');
    expect(() => vendorCli(root)).toThrow(/symlink/i);
    expect(read(root, bundle)).toBe('// synthetic previous runtime\n');
    expect(readdirSync(outside)).toEqual([]);
  });

  it('rejects escaping backup input paths before making any backup', () => {
    const root = tempProject({ 'inside.txt': 'inside' });
    initProject(root);
    expect(() => backupFiles(root, ['inside.txt', '../outside.txt'])).toThrow(/path/i);
    expect(backups(root)).toEqual([]);
  });
});
