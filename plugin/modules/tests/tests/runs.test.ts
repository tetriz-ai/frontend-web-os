// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The team's own test commands as `fwos tests run` last ran them: a run record of kind `tests` per
// script, replaced by its next run and bound to the code it ran on, and which result files a real
// browser wrote.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadProject, revisionOf, writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { type TestRun, browserResults, readTestRuns, recordRun } from '../index.ts';

afterAll(cleanupTempProjects);

const run = (script: string, extra: Partial<TestRun> = {}): TestRun => ({
  script,
  dir: '.',
  display: `pnpm ${script}`,
  command: 'vitest run',
  runner: 'Vitest',
  browser: false,
  mapped: true,
  exit: 0,
  results: [`.fwos/local/results/${script}.xml`],
  cases: { passed: 1, failed: 0, skipped: 0 },
  ...extra,
});

const AT = '2026-10-23T10:00:00.000Z';
/** Records `r` as `fwos tests run` does, on the code there is now. */
const record = (root: string, r: TestRun) => { for (const file of r.results) writeText(join(root, file), '<testsuite><testcase name="synthetic result"/></testsuite>'); return recordRun(loadProject(root), r, { revision: revisionOf(loadProject(root)), at: AT, command: `pnpm run ${r.script}` }); };
const app = () => tempProject({ 'apps/web/app/page.tsx': 'export default function P() { return null; }\n' });

describe('test runs', () => {
  it("keeps each script's last run as a run record of kind tests, on the code it ran on", () => {
    const root = app();
    expect(readTestRuns(loadProject(root))).toEqual([]);
    record(root, run('test'));
    record(root, run('e2e', { browser: true, runner: 'Playwright' }));
    expect(record(root, run('test', { exit: 1, cases: { passed: 0, failed: 1, skipped: 0 } }))).toBe('.fwos/local/runs/tests/test.json');
    expect(record(root, run('test', { dir: 'apps/web' }))).toBe('.fwos/local/runs/tests/apps_2fweb_2ftest.json');
    expect(readTestRuns(loadProject(root)).map((r) => [r.dir, r.script, r.exit, r.fresh])).toEqual([
      ['apps/web', 'test', 0, true],
      ['.', 'e2e', 0, true],
      ['.', 'test', 1, true],
    ]);
    expect(JSON.parse(readFileSync(join(root, '.fwos/local/runs/tests/test.json'), 'utf8'))).toMatchObject({
      schema: 1,
      kind: 'tests',
      target: 'test',
      revision: revisionOf(loadProject(root)),
      config: { command: 'pnpm run test' },
      at: AT,
      observations: { script: 'test', exit: 1 },
    });
  });

  it('reads a broken record as no runs, never as evidence', () => {
    const root = tempProject({ '.fwos/local/runs/tests/test.json': '{ "runs": [' });
    expect(readTestRuns(loadProject(root))).toEqual([]);
  });

  it('says which runs ran on other code than there is now', () => {
    const root = app();
    record(root, run('test'));
    writeText(join(root, 'apps/web/app/page.tsx'), 'export default function P() { return 1; }\n');
    expect(readTestRuns(loadProject(root))).toEqual([expect.objectContaining({ script: 'test', at: AT, fresh: false, why: 'the code changed since it ran' })]);
  });

  it("knows which result files a browser wrote: a browser runner's current bound run, never an unbound filename", () => {
    const root = app();
    record(root, run('test'));
    record(root, run('e2e', { browser: true, runner: 'Playwright', results: ['.fwos/local/results/e2e.xml'] }));
    writeText(`${root}/.fwos/local/results/playwright.xml`, '<testsuite/>');
    writeText(`${root}/.fwos/local/results/cypress-1a2b.xml`, '<testsuite/>');
    expect([...browserResults(loadProject(root))].sort()).toEqual(['.fwos/local/results/e2e.xml']);
    // A browser run of older code says nothing about this code.
    writeText(join(root, 'apps/web/app/page.tsx'), 'export default function P() { return 1; }\n');
    expect([...browserResults(loadProject(root))].sort()).toEqual([]);
  });
});
