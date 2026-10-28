// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The regression scope as it last ran: for each existing test file an adopted app's change names
// in its test plan, the cases the results hold for it. Shared by tests/regression and the report.

import { type Project, caseInFile, loadResults } from '../../kernel/index.ts';
import { strictCoverage } from '../state/index.ts';
import { currentResultFiles } from './runs.ts';

export interface RegressionResult {
  path: string;
  /** Some result names the file. */
  ran: boolean;
  passed: number;
  failed: number;
  skipped: number;
  failures: { name: string; failure?: string }[];
}

export function regressionResults(project: Project, entries: { path: string }[]): RegressionResult[] {
  const { cases } = loadResults(project, project.initialized && strictCoverage(project.root) ? currentResultFiles(project) : undefined);
  return entries.map(({ path }) => {
    const mine = cases.filter((c) => caseInFile(c, path));
    const failed = mine.filter((c) => c.status === 'failed');
    return {
      path,
      ran: mine.some((test) => test.status !== 'skipped'),
      passed: mine.filter((c) => c.status === 'passed').length,
      failed: failed.length,
      skipped: mine.filter((c) => c.status === 'skipped').length,
      failures: failed.map((c) => ({ name: c.name, ...(c.failure ? { failure: c.failure } : {}) })),
    };
  });
}

/** `2 failed, 3 passed`, the order every run summary uses. */
export function tally(c: { passed: number; failed: number; skipped: number }): string {
  return [c.failed && `${c.failed} failed`, c.passed && `${c.passed} passed`, c.skipped && `${c.skipped} skipped`].filter(Boolean).join(', ') || 'no tests ran';
}
