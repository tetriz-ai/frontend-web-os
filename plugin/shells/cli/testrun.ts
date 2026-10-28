// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// `fwos tests run`: the project's own test scripts, run through its package manager as the
// team runs them. The platform says which runner each calls and the JUnit reporter to add on the
// command line, so the results land in .fwos/local/results/ and count as evidence, and the team's
// configs stay as they are. Each run is recorded for the report and the browser rule, on the code
// it ran on. A script whose results fwos can't read still runs, and its line says it proves nothing.

import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { posix } from 'node:path';
import { FwosError, type Project, type TestCommand, type TestCommandAdapter, jestJsonToJUnit, loadProject, matchGlob, parseJUnit, readText, revisionOf, testInputRevision, walkFiles, writeText } from '../../kernel/index.ts';
import { type TestRun, recordRun, tally as summary } from '../../modules/tests/index.ts';

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** How a test command is named in output: `pnpm e2e (Playwright, in a browser)`. */
export const runLabel = (c: Pick<TestCommand, 'display' | 'runner' | 'browser'>) => `${c.display}${c.runner ? ` (${c.runner}${c.browser ? ', in a browser' : ''})` : ''}`;

/** The result files a glob names right now (a fresh walk, so files a run just wrote are there). */
function resultFiles(p: Project, glob: string): string[] {
  const dir = posix.dirname(glob.replace(/\*.*$/, 'x'));
  return walkFiles(p.abs(dir), { ignoreDirs: new Set() })
    .map((f) => posix.join(dir, f))
    .filter((f) => matchGlob(f, glob));
}

/** The last lines a command printed, for a run whose results say nothing about why it failed. */
function tail(out: string, n = 10): string[] {
  return out
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
    .slice(-n)
    .map((l) => `  ${l}`);
}

/** A run as `fwos tests run` recorded it: when, on which revision (null when the code changed while it ran), and where. */
export type RecordedTestRun = TestRun & { at: string; revision: string | null; file: string };

export interface TestsRun {
  runs: RecordedTestRun[];
  skipped: { script: string; dir: string; why: string }[];
  lines: string[];
  /** 1 when a script failed, else 0. */
  exit: number;
}

/** Runs the named scripts, or every test script the app has, records each run, and says how each went. */
export function runTests(p: Project, adapter: TestCommandAdapter, names: string[]): TestsRun {
  const { commands, skipped } = adapter.commands(p, names);
  if (commands.length === 0) {
    throw new FwosError(
      skipped.length > 0 ? `Nothing to run: ${skipped.map((s) => `${s.script} (${s.why})`).join('; ')}.` : 'No test script in package.json (looked for test, test:*, e2e and e2e:*).',
      'Add your test command as a script, or name the script to run: `fwos tests run <script>`.',
    );
  }
  const lines: string[] = [];
  const runs: RecordedTestRun[] = [];
  // The code each run started on: a fresh walk, so what an earlier command wrote is seen.
  let revision = revisionOf(loadProject(p.root));
  let inputs = testInputRevision(loadProject(p.root));
  for (const c of commands) {
    // An earlier run's results never stand in for this one's.
    for (const f of [...(c.results ? resultFiles(p, c.results) : []), ...(c.raw ? [c.raw] : [])]) rmSync(p.abs(f), { force: true });
    const r = spawnSync(c.argv[0]!, c.argv.slice(1), {
      cwd: p.abs(c.dir),
      env: { ...process.env, ...c.env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      maxBuffer: 256 * 1024 * 1024,
    });
    const exit = r.status ?? (r.error ? 127 : 1);
    const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}\n${r.error ? r.error.message : ''}`;
    if (c.results && c.format === 'jest-json' && c.raw) {
      const raw = readText(p.abs(c.raw));
      if (raw !== null) writeText(p.abs(c.results), jestJsonToJUnit(raw, p.root));
    }
    const files = c.results ? resultFiles(p, c.results) : [];
    const cases = files.flatMap((f) => parseJUnit(readText(p.abs(f)) ?? '', f));
    const tally = { passed: 0, failed: 0, skipped: 0 };
    for (const t of cases) tally[t.status]++;
    const label = runLabel(c);
    let reason: string | undefined;
    if (!c.results) {
      reason = c.unmapped;
      lines.push(`${label}: exit ${exit}. Not mapped: ${c.unmapped}, so this run proves no criterion.`);
    } else if (files.length === 0) {
      reason = `it wrote no results to ${c.results}`;
      lines.push(`${label}: exit ${exit}, and it wrote no results, so this run proves nothing.`);
    } else if (cases.length === 0) {
      reason = 'the result files contain no readable test cases';
      lines.push(`${label}: exit ${exit}; ${reason}, so this run proves nothing.`);
    } else {
      lines.push(`${label}: ${exit !== 0 && tally.failed === 0 ? `exit ${exit}, ` : ''}${summary(tally)}. Results in ${files.join(', ')}.`);
      const failed = cases.filter((t) => t.status === 'failed');
      for (const t of failed.slice(0, 5)) lines.push(`  failed: ${t.name}${t.failure ? ` (${t.failure})` : ''}`);
      if (failed.length > 5) lines.push(`  and ${count(failed.length - 5, 'more failing test')}`);
    }
    if (exit !== 0 && (files.length === 0 || tally.failed === 0)) lines.push(...tail(output));
    const run: TestRun = {
      script: c.script,
      dir: c.dir,
      display: c.display,
      command: c.command,
      runner: c.runner,
      browser: c.browser,
      mapped: cases.length > 0,
      ...(reason ? { reason } : {}),
      exit,
      results: files,
      cases: tally,
    };
    const after = revisionOf(loadProject(p.root));
    const afterInputs = testInputRevision(loadProject(p.root));
    const at = new Date().toISOString();
    const ran = after === revision && afterInputs === inputs ? revision : null;
    runs.push({ ...run, at, revision: ran, file: recordRun(p, run, { revision: ran, at, command: c.argv.join(' '), inputs: afterInputs === inputs ? inputs : null }) });
    revision = after;
    inputs = afterInputs;
  }
  for (const s of skipped) lines.push(`${s.script}${s.dir === '.' ? '' : ` in ${s.dir}`}: not run here, since ${s.why}.`);
  return { runs, skipped, lines, exit: runs.some((r) => r.exit !== 0) ? 1 : 0 };
}
