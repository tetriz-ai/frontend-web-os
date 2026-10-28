// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// "doctor tells the truth" on the reading-list example: every check doctor calls ON fails once a
// violation it should catch is planted (scripts/tests/support/truth.ts). The same proof runs on an
// unrelated open-source app in adopt mode at release (adopt.test.ts).

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { allChecks } from '../../plugin/shells/cli/registry.ts';
import { PLANTS, commitAll, passingResultsFromTitles, passingRunsFromTargets, proveDoctor } from './support/truth.ts';

const REPO = new URL('../../', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'fwos-truth-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('doctor tells the truth', () => {
  it('has a planted violation for every check fwos ships', () => {
    expect(allChecks().map((c) => c.id).filter((id) => !PLANTS[id])).toEqual([]);
    expect(Object.keys(PLANTS).filter((id) => !allChecks().some((c) => c.id === id))).toEqual([]);
  });

  it('on the reading-list example, every check doctor calls ON catches its planted violation', () => {
    // The example as committed: no node_modules, and its tests' results and its harness's runs stood in for.
    const example = join(REPO, 'examples/reading-list');
    for (const rel of execFileSync('git', ['ls-files'], { cwd: example, encoding: 'utf8' }).split('\n').filter(Boolean)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      copyFileSync(join(example, rel), join(dir, rel));
    }
    expect(passingResultsFromTitles(dir, 'apps')).toBeGreaterThan(20);
    expect(passingRunsFromTargets(dir)).toBe(8);
    commitAll(dir);
    const r = proveDoctor(dir);
    expect(r.problems).toEqual([]);
    expect(r.proven).toEqual(r.on);
    // Everything but the blank chart palette, the uninstalled licences, and the regression scope only
    // an adopted app's change has.
    expect(r.on.length).toBe(allChecks().length - 3);
    expect(r.on).not.toContain('tests/regression');
  }, 180_000);
});
