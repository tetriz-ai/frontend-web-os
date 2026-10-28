// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// `fwos update` with a controlled previous-vendor fixture built from the current runtime.
// It deliberately makes one CLI file stale and omits one template; it is not a historical release.
// It reads every pack file's and record's schema
// first, writes nothing while anything stands in the way, and backs up what it replaces.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACK_FILES, hashDir, hashFile, revisionOf, writeRun, loadProject, parseJsonc, pluginPath, pluginVersion, walkFiles, writeJson, writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { type Io } from '../commands.ts';
import { main } from '../main.ts';
import { type Migrations, applyUpdate, planUpdate } from '../update.ts';
import { removeOwned, writeOwned } from '../../../modules/state/index.ts';
import { VENDORED_CLI, runtimeFiles, vendorCli } from '../vendor.ts';

afterAll(cleanupTempProjects);

const REPO = new URL('../../../../', import.meta.url).pathname;

async function fwos(cwd: string, ...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (...l) => out.push(...l), err: (...l) => err.push(...l), cwd };
  const code = await main(argv, io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/** Preserve demo app/approval inputs, then construct explicitly synthetic vendor upgrade input. */
function demo(): string {
  const root = tempProject({});
  for (const rel of execFileSync('git', ['ls-files', 'demo/tip-splitter'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean)) {
    if (rel.startsWith('demo/tip-splitter/.fwos/cli/')) continue;
    const to = join(root, rel.slice('demo/tip-splitter/'.length));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(REPO, rel), to);
  }
  vendorCli(root);
  writeOwned(root, `${VENDORED_CLI}/dist/fwos.mjs`, '#!/usr/bin/env node\n// Controlled stale CLI fixture: no historical release code.\nconsole.log(\"synthetic-previous\");\n', 'fwos', 'synthetic update test input');
  removeOwned(root, `${VENDORED_CLI}/platforms/web/templates/harness/fwos-ia.spec.ts`);
  return root;
}

const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');
const json = <T extends object = Record<string, unknown>>(root: string, rel: string) => parseJsonc(read(root, rel)) as T;
const backups = (root: string) => (existsSync(join(root, '.fwos/local/backup')) ? readdirSync(join(root, '.fwos/local/backup')) : []);
/** The vendored files that differ from what this fwos ships: older ones it replaces. */
const older = (root: string) =>
  runtimeFiles()
    .filter((rel) => existsSync(join(root, VENDORED_CLI, rel)) && !readFileSync(join(root, VENDORED_CLI, rel)).equals(readFileSync(pluginPath(rel))))
    .map((rel) => `${VENDORED_CLI}/${rel}`);
/** The files this fwos ships that the older copy doesn't have yet: ones it adds. */
const missing = (root: string) => runtimeFiles().filter((rel) => !existsSync(join(root, VENDORED_CLI, rel))).map((rel) => `${VENDORED_CLI}/${rel}`);
const packHashes = (root: string) => PACK_FILES.map((f) => hashFile(join(root, f.path(loadProject(root)))));

describe('fwos update on a controlled previous-vendor fixture', () => {
  it('previews what it would replace and writes nothing', async () => {
    const root = demo();
    const stale = older(root);
    expect(stale).toContain(`${VENDORED_CLI}/dist/fwos.mjs`);
    const before = hashDir(root);
    const r = await fwos(root, 'update');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/each at a schema this fwos reads; nothing to migrate/);
    for (const f of stale) expect(r.out).toMatch(new RegExp(`replace\\s+${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(r.out).toMatch(/Run `fwos update --yes`/);
    expect(hashDir(root)).toBe(before);
  });

  it('replaces the older vendored files after backing them up, and leaves the pack alone', async () => {
    const root = demo();
    const stale = older(root);
    const was = Object.fromEntries(stale.map((f) => [f, read(root, f)]));
    const pack = packHashes(root);
    const r = await fwos(root, 'update', '--yes');
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    // Every file is this fwos's now, the ones the older copy lacked included, and only replaced ones were backed up.
    expect([older(root), missing(root)]).toEqual([[], []]);
    const [stamp, ...more] = backups(root);
    expect(more).toEqual([]);
    expect(walkFiles(join(root, '.fwos/local/backup', stamp!))).toEqual([...stale].sort());
    for (const f of stale) expect(read(root, `.fwos/local/backup/${stamp}/${f}`), f).toBe(was[f]);
    expect(r.out).toContain(`Backed up ${stale.length} file${stale.length === 1 ? '' : 's'} to .fwos/local/backup/${stamp}/`);
    expect(packHashes(root)).toEqual(pack);
    // The manifest holds what it wrote, so nothing reads as a hand edit, and the copy runs as this version.
    expect((await fwos(root, 'check', 'state/owned')).out).toMatch(/^PASS\s+state\/owned/m);
    expect(spawnSync(process.execPath, [join(root, VENDORED_CLI, 'dist/fwos.mjs'), 'version'], { encoding: 'utf8' }).stdout.trim()).toBe(pluginVersion());
    // Once is enough: a second run finds nothing to do and backs up nothing.
    const again = await fwos(root, 'update', '--yes');
    expect(again.out).toMatch(/^Nothing to update/m);
    expect(backups(root)).toEqual([stamp]);
  });

  it('writes nothing while someone has patched a file in .fwos/cli, and names it', async () => {
    const root = demo();
    const stale = older(root);
    const was = Object.fromEntries(stale.map((f) => [f, read(root, f)]));
    // A rule weakened in the copy so it never matches: fwos owns that file, and the copy runs it in CI.
    const rule = `${VENDORED_CLI}/modules/rules/pack/no-raw-intl.yaml`;
    writeText(join(root, rule), read(root, rule).replace(/^pattern: .*$/m, "pattern: 'never-matches-anything'"));
    const r = await fwos(root, 'update', '--yes');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^fwos: update stopped before writing anything:$/m);
    expect(r.err).toContain(`${rule}: edited since fwos wrote it`);
    expect(r.err).toMatch(/design-system\/rules\.yaml/);
    for (const f of stale) expect(read(root, f), f).toBe(was[f]);
    expect(backups(root)).toEqual([]);
  });

  it('writes nothing while a file fwos did not write sits where the copy reads its rules', async () => {
    const root = demo();
    writeText(join(root, VENDORED_CLI, 'modules/rules/pack/our-rule.yaml'), 'id: our-rule\n');
    const r = await fwos(root, 'update', '--yes');
    expect(r.code).toBe(2);
    expect(r.err).toContain(`${VENDORED_CLI}/modules/rules/pack/our-rule.yaml: fwos didn't write it`);
    expect(backups(root)).toEqual([]);
  });

  it('stops on a pack file from a newer schema, and writes nothing', async () => {
    const root = demo();
    writeJson(join(root, 'docs/app/ia.json'), { ...json(root, 'docs/app/ia.json'), schema: 2 });
    const before = hashDir(root);
    const r = await fwos(root, 'update', '--yes');
    expect(r.code).toBe(2);
    expect(r.err).toContain('docs/app/ia.json is schema 2, newer than this fwos reads (ia.json schema 1): upgrade fwos');
    expect(hashDir(root)).toBe(before);
  });

  it('stops on an older schema it has no migration for, and says what to change', async () => {
    const root = demo();
    writeJson(join(root, 'docs/app/modules.json'), { ...json(root, 'docs/app/modules.json'), schema: 0 });
    const before = hashDir(root);
    const r = await fwos(root, 'update', '--yes');
    expect(r.code).toBe(2);
    expect(r.err).toContain(
      'docs/app/modules.json is schema 0, and this fwos has no migration from it to modules.json schema 1: rewrite it as schema 1 (docs/file-formats.md), or use the fwos that wrote it',
    );
    expect(hashDir(root)).toBe(before);
  });

  it('refreshes nothing in .fwos/cli when the project pins fwos-check elsewhere, and says so', async () => {
    const root = demo();
    const pkg = json<{ devDependencies: Record<string, string> }>(root, 'package.json');
    writeJson(join(root, 'package.json'), { ...pkg, devDependencies: { 'fwos-check': 'link:../fwos' } });
    const stale = older(root);
    const r = await fwos(root, 'update', '--yes');
    expect(r.code).toBe(0);
    expect(r.out).toContain('fwos-check is pinned to link:../fwos, not the vendored copy, so .fwos/cli is left as it is: update that pin yourself');
    expect(older(root)).toEqual(stale);
  });
});

describe('a pack migration', () => {
  // No pack file has an older schema yet, so this release ships no migration: a stand-in runs the
  // path the first real one (schema 1 to 2) will take.
  const renamed: Migrations = {
    'ia.json': [
      {
        from: 0,
        to: 1,
        run: (d) => {
          const ia = d as { pages: Record<string, unknown>[] };
          return { ...ia, schema: 1, pages: ia.pages.map(({ path, ...p }) => ({ ...p, route: path })) };
        },
      },
    ],
  };

  it('backs up the file, then writes it at the schema this fwos reads', async () => {
    const root = demo();
    const current = json<{ pages: Record<string, unknown>[] }>(root, 'docs/app/ia.json');
    const previous = { ...current, schema: 0, pages: current.pages.map(({ route, ...p }) => ({ ...p, path: route })) };
    writeJson(join(root, 'docs/app/ia.json'), previous);
    const text = read(root, 'docs/app/ia.json');
    const plan = planUpdate(loadProject(root), renamed);
    expect(plan.blocked).toEqual([]);
    expect(plan.schemas.find((s) => s.path === 'docs/app/ia.json')).toMatchObject({ schema: 0, reads: 1, action: 'migrate' });
    const done = applyUpdate(loadProject(root), plan, renamed);
    expect(done.migrated).toEqual(['docs/app/ia.json']);
    expect(json(root, 'docs/app/ia.json')).toEqual(current);
    expect(read(root, `.fwos/local/backup/${backups(root)[0]}/docs/app/ia.json`)).toBe(text);
    // Migration does not manufacture a current browser run for the copied demo.
    expect((await fwos(root, 'check', 'screens/ia')).out).toContain('no fresh run');
    const project = loadProject(root);
    const harness = 'apps/web/e2e/fwos-ia.spec.ts';
    // Explicit SYNTHETIC unit observations test the migrated IA contract, not browser execution.
    writeRun(project, {
      schema: 1, kind: 'ia', target: 'user', fwos: pluginVersion(),
      harness: { file: harness, sha: hashFile(project.abs(harness))! },
      revision: revisionOf(project), config: { source: 'SYNTHETIC migration unit fixture, not browser execution' },
      at: '2026-10-27T00:00:00.000Z',
      observations: { role: 'user', flags: [], applied: true, nav: ['/'], visits: [{ page: 'calculator', path: '/', status: 200, finalPath: '/', notFound: false, denied: false }] },
    });
    expect((await fwos(root, 'check', 'screens/ia')).out).toMatch(/^PASS\s+screens\/ia/m);
  });

  it('migrates nothing while something else stands in the way', () => {
    const root = demo();
    const current = json<{ pages: Record<string, unknown>[] }>(root, 'docs/app/ia.json');
    writeJson(join(root, 'docs/app/ia.json'), { ...current, schema: 0, pages: current.pages.map(({ route, ...p }) => ({ ...p, path: route })) });
    writeJson(join(root, 'docs/app/modules.json'), { ...json(root, 'docs/app/modules.json'), schema: 9 });
    const plan = planUpdate(loadProject(root), renamed);
    expect(plan.blocked).toEqual(['docs/app/modules.json is schema 9, newer than this fwos reads (modules.json schema 1): upgrade fwos']);
    expect(() => applyUpdate(loadProject(root), plan, renamed)).toThrow(/stopped before writing anything/);
    expect(json(root, 'docs/app/ia.json').schema).toBe(0);
    expect(backups(root)).toEqual([]);
  });
});

it('needs an fwos project', async () => {
  const r = await fwos(tempProject({}), 'update');
  expect(r.code).toBe(2);
  expect(r.err).toMatch(/Not an fwos project/);
});
