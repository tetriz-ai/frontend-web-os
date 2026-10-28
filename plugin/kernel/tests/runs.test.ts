// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type Harness, type RunRecord, hashText, harnessStatus, loadProject, readRuns, revisionFreshness, revisionOf, runFreshness, runPath, writeRun } from '../index.ts';
import { cleanupTempProjects, tempProject, writeFiles } from '../testing.ts';

afterAll(cleanupTempProjects);

const app = () =>
  tempProject({
    'package.json': { name: 'app' },
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    'apps/web/app/page.tsx': 'export default function P() { return <p>Hi</p>; }\n',
    'apps/web/src/screens/list.tsx': 'export const List = () => null;\n',
    'packages/api-contract/fixtures/listItems.default.json': { status: 200, body: [] },
    'design-system/tokens/light.json': {},
    'docs/app/ia.json': { schema: 1, roles: ['user'], pages: [] },
    'docs/app/spec.md': '# Spec\n',
    'apps/web/e2e/list.spec.ts': "test('x', () => {});\n",
    'apps/web/src/screens/list.test.tsx': "it('x', () => {});\n",
  });

const harness: Harness = { kind: 'states', file: 'apps/web/e2e/fwos-states.spec.ts', content: '// the harness\n' };
const record = (root: string, over: Partial<RunRecord> = {}): RunRecord => ({
  schema: 1,
  kind: 'states',
  target: 'page.list',
  fwos: '0.1.0',
  harness: { file: harness.file, sha: hashText(harness.content) },
  revision: revisionOf(loadProject(root)),
  config: { server: 'production build' },
  at: '2026-10-23T00:00:00.000Z',
  observations: [],
  ...over,
});

describe('the revision a run tested', () => {
  it('changes with app source, ia.json, the design system, a package or the lockfile', () => {
    for (const [rel, text] of [
      ['apps/web/app/page.tsx', 'export default function P() { return <p>Hello</p>; }\n'],
      ['apps/web/src/screens/list.tsx', 'export const List = () => 1;\n'],
      ['docs/app/ia.json', '{"schema":1,"roles":["user","admin"],"pages":[]}\n'],
      ['design-system/tokens/light.json', '{"color":{}}\n'],
      ['packages/api-contract/fixtures/listItems.default.json', '{"status":500}\n'],
      ['pnpm-lock.yaml', 'lockfileVersion: 10\n'],
      ['apps/web/src/screens/new.tsx', 'export {};\n'],
    ]) {
      const root = app();
      const before = revisionOf(loadProject(root));
      writeFiles(root, { [rel!]: text! });
      expect(revisionOf(loadProject(root)), rel).not.toBe(before);
    }
  });

  it("doesn't change with tests, fwos's records, other docs or what a build leaves behind", () => {
    const root = app();
    const before = revisionOf(loadProject(root));
    writeFiles(root, {
      'apps/web/e2e/list.spec.ts': "test('y', () => {});\n",
      'apps/web/src/screens/list.test.tsx': "it('y', () => {});\n",
      '.fwos/changes/0001-initial.json': {},
      '.fwos/local/results/v.xml': '<testsuite/>',
      'docs/app/spec.md': '# Spec, edited\n',
      'apps/web/.next/server/app.js': 'x',
      'apps/web/next-env.d.ts': '/// <reference types="next" />\n',
      'apps/web/test-results/a.png': 'x',
      // Markdown outside the app's source is documentation: a README, a PRD a change links.
      'apps/web/README.md': '# Web\n',
      'packages/api-contract/README.md': '# Contract\n',
    });
    expect(revisionOf(loadProject(root))).toBe(before);
    // In its source, it can be a page.
    writeFiles(root, { 'apps/web/app/about/page.md': '# About\n' });
    expect(revisionOf(loadProject(root))).not.toBe(before);
  });

  it("leaves out the docs of an app at the project root, the reports fwos writes and the team's README included, but not its ia.json", () => {
    const root = tempProject({
      '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'adopt', platforms: ['web'], paths: { apps: { web: '.' } } },
      'package.json': { name: 'app' },
      'app/page.tsx': 'export default function P() { return <p>Hi</p>; }\n',
      'docs/app/ia.json': { schema: 1, roles: ['user'], pages: [] },
      'docs/app/spec.md': '# Spec\n',
    });
    const before = revisionOf(loadProject(root));
    writeFiles(root, { 'docs/app/spec.md': '# Spec, edited\n', 'docs/app/reports/acceptance.md': '# Acceptance\n', 'README.md': '# App\n', 'docs/product/members-prd.md': '# Members\n' });
    expect(revisionOf(loadProject(root))).toBe(before);
    writeFiles(root, { 'docs/app/ia.json': { schema: 1, roles: ['user', 'admin'], pages: [] } });
    const ia = revisionOf(loadProject(root));
    expect(ia).not.toBe(before);
    writeFiles(root, { 'app/page.tsx': 'export default function P() { return <p>Hello</p>; }\n' });
    expect(revisionOf(loadProject(root))).not.toBe(ia);
  });

  it('is the same for CRLF and LF checkouts', () => {
    const a = app();
    const b = app();
    writeFiles(b, { 'apps/web/app/page.tsx': 'export default function P() { return <p>Hi</p>; }\r\n' });
    expect(revisionOf(loadProject(a))).toBe(revisionOf(loadProject(b)));
  });
});

describe('run records', () => {
  it('round-trip, one file per target, with a file name any flag can go in', () => {
    const root = app();
    const p = loadProject(root);
    expect(runPath('ia', 'admin+beta_2 on/off')).toBe('.fwos/local/runs/ia/admin+beta_5f2_20on_2foff.json');
    writeRun(p, record(root));
    writeRun(p, record(root, { target: 'component.button' }));
    const { records, errors } = readRuns(loadProject(root), 'states');
    expect(errors).toEqual([]);
    expect(records.map((r) => r.target)).toEqual(['component.button', 'page.list']);
  });

  it('reports a record that is not one, by file, rather than reading it', () => {
    const root = app();
    writeFiles(root, { '.fwos/local/runs/states/page.list.json': '{"schema":1,"kind":"states"}', '.fwos/local/runs/states/page.x.json': '{' });
    writeFileSync(join(root, '.fwos/local/runs/states/notes.txt'), 'ignored');
    const { records, errors } = readRuns(loadProject(root), 'states');
    expect(records).toEqual([]);
    expect(errors.map((e) => e.file)).toEqual(['.fwos/local/runs/states/page.list.json', '.fwos/local/runs/states/page.x.json']);
  });

  it('count while they ran on this revision with this fwos harness, and not after', () => {
    const root = app();
    const fresh = record(root);
    expect(runFreshness(loadProject(root), fresh, harness)).toEqual({ fresh: true });
    // Another harness (an edited one, or another fwos version's) recorded it.
    expect(runFreshness(loadProject(root), { ...fresh, harness: { file: harness.file, sha: hashText('// edited\n') } }, harness)).toMatchObject({ fresh: false, why: expect.stringMatching(/harness other than this fwos/) });
    // The code changed while it ran.
    expect(runFreshness(loadProject(root), { ...fresh, revision: null }, harness)).toMatchObject({ fresh: false, why: expect.stringMatching(/changed while the harness ran/) });
    // The code changed since.
    writeFiles(root, { 'apps/web/src/screens/list.tsx': 'export const List = () => 2;\n' });
    expect(runFreshness(loadProject(root), fresh, harness)).toMatchObject({ fresh: false, why: expect.stringMatching(/changed since the harness ran/) });
  });

  it("keep a run of the team's own tests, which no harness recorded, and count it only on the code it ran on", () => {
    const root = app();
    const tests: RunRecord = {
      schema: 1,
      kind: 'tests',
      target: 'apps/web/test',
      fwos: '0.1.0',
      harness: null,
      revision: revisionOf(loadProject(root)),
      config: { command: 'pnpm run test --reporter=junit' },
      at: '2026-10-23T00:00:00.000Z',
      observations: { script: 'test', dir: 'apps/web', display: 'pnpm test in apps/web', command: 'vitest run', runner: 'Vitest', browser: false, mapped: true, exit: 0, results: ['.fwos/local/results/apps-web-test.xml'], cases: { passed: 1, failed: 0, skipped: 0 } },
    };
    expect(runPath('tests', 'apps/web/test')).toBe('.fwos/local/runs/tests/apps_2fweb_2ftest.json');
    writeRun(loadProject(root), tests);
    expect(readRuns(loadProject(root), 'tests')).toEqual({ records: [tests], errors: [] });
    expect(revisionFreshness(loadProject(root), tests)).toEqual({ fresh: true });
    expect(revisionFreshness(loadProject(root), { ...tests, revision: null })).toEqual({ fresh: false, why: 'the code changed while it ran' });
    // Editing a test is no new code (the locked tests catch an edit to a criterion's test).
    writeFiles(root, { 'apps/web/src/screens/list.test.tsx': "it('y', () => {});\n" });
    expect(revisionFreshness(loadProject(root), tests)).toEqual({ fresh: true });
    writeFiles(root, { 'apps/web/src/screens/list.tsx': 'export const List = () => 2;\n' });
    expect(revisionFreshness(loadProject(root), tests)).toEqual({ fresh: false, why: 'the code changed since it ran' });
  });

  it("refuse a harness run with no harness, and a run of the team's tests with one or with what it saw missing", () => {
    const root = app();
    const { harness: _, ...noHarness } = record(root);
    const run = { script: 'test', dir: '.', display: 'pnpm test', command: 'vitest run', runner: 'Vitest', browser: false, mapped: true, exit: 0, results: [], cases: { passed: 0, failed: 0, skipped: 0 } };
    writeFiles(root, {
      '.fwos/local/runs/states/page.list.json': noHarness,
      '.fwos/local/runs/tests/a.json': { ...record(root), kind: 'tests', target: 'a', observations: run },
      '.fwos/local/runs/tests/b.json': { ...record(root), harness: null, kind: 'tests', target: 'b', observations: { ...run, results: undefined } },
    });
    expect(readRuns(loadProject(root), 'states').errors).toEqual([{ file: '.fwos/local/runs/states/page.list.json', message: expect.stringContaining("required property 'harness'") }]);
    expect(readRuns(loadProject(root), 'tests').errors).toEqual([
      { file: '.fwos/local/runs/tests/a.json', message: expect.stringContaining('/harness') },
      { file: '.fwos/local/runs/tests/b.json', message: expect.stringContaining("required property 'results'") },
    ]);
  });

  it("tells fwos's harness apart from an edited one and from none", () => {
    const root = app();
    expect(harnessStatus(loadProject(root), harness)).toBe('absent');
    writeFiles(root, { [harness.file]: harness.content.replace('\n', '\r\n') });
    expect(harnessStatus(loadProject(root), harness)).toBe('current');
    writeFiles(root, { [harness.file]: '// the harness, edited\n' });
    expect(harnessStatus(loadProject(root), harness)).toBe('edited');
  });
});
