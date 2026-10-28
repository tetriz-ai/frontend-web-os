// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The team's own test commands as `fwos tests run` last ran them: run records of kind `tests` in
// .fwos/local/runs/tests/, local evidence like the result files they point at. One record per
// script, its last run, bound to the code it ran on, so the report can say what ran and how, and
// the browser rule knows which results a real browser wrote. A run of other code counts for neither.

import { type Project, pluginVersion, readRuns, testRunFreshness, currentTestResults, resultDigest, testInputRevision, writeRun } from '../../kernel/index.ts';

export interface TestRun {
  /** The package.json script and its folder (`.` for the root). */
  script: string;
  dir: string;
  /** How the team runs it: `pnpm test`. */
  display: string;
  command: string;
  runner: string | null;
  browser: boolean;
  /** fwos read its results, so they count as evidence. */
  mapped: boolean;
  /** Why its results don't count, when they don't. */
  reason?: string;
  exit: number;
  /** Its result files, relative to the root. */
  results: string[];
  cases: { passed: number; failed: number; skipped: number };
}

/** A recorded run, when it ran, and whether it ran on the code there is now (why not, when it didn't). */
export interface RecordedRun extends TestRun {
  at: string;
  fresh: boolean;
  why?: string;
}

/** The record's target: the script, after its folder outside the root. */
const targetOf = (r: Pick<TestRun, 'script' | 'dir'>) => (r.dir === '.' ? r.script : `${r.dir}/${r.script}`);

/**
 * Records a run as its script's last: on the revision it ran on (null when the code changed while
 * it ran), with the command fwos ran. Returns the record's path.
 */
export function recordRun(project: Project, run: TestRun, how: { revision: string | null; at: string; command: string; inputs?: string | null }): string {
  const config: Record<string, string> = { command: how.command, evidence: 'inputs-and-results-v1', testInputs: how.inputs === undefined ? testInputRevision(project) : how.inputs ?? 'changed-during-run' };
  if (run.mapped) for (const file of run.results) { const digest = resultDigest(project, file); if (digest !== null) config[`result:${file}`] = digest; }
  return writeRun(project, { schema: 1, kind: 'tests', target: targetOf(run), fwos: pluginVersion(), harness: null, revision: how.revision, config, at: how.at, observations: run });
}

/** Every recorded run, by target. A record that isn't one is no run, never evidence. */
export function readTestRuns(project: Project): RecordedRun[] {
  const currentInputs = testInputRevision(project);
  return readRuns<TestRun>(project, 'tests').records.map((r) => {
    const f = testRunFreshness(project, r, currentInputs);
    return { ...r.observations, at: r.at, fresh: f.fresh, ...(f.fresh ? {} : { why: f.why }) };
  });
}

/**
 * The result files a real browser wrote: those of a browser runner's last run through fwos, on
 * this code, and files named for Playwright or Cypress, the names fwos gives when a team sets its
 * own reporter.
 */
export function browserResults(project: Project): Set<string> {
  const out = new Set<string>();
  for (const r of readTestRuns(project)) if (r.fresh && r.browser && r.mapped && r.exit === 0) for (const f of r.results) out.add(f);

  return out;
}

/** Only the unchanged result files of current, mapped test executions count at acceptance. */
export function currentResultFiles(project: Project): Set<string> {
  return currentTestResults(project);
}
