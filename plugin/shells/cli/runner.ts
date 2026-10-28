// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Runs checks. Gate checks (schemas) run first; if one fails, every other check reports off with
// the reason, so nothing ever runs against a malformed or unsupported file (fail closed).

import { type Check, type CheckResult, FwosError, type Project, off } from '../../kernel/index.ts';
import { ALWAYS_CHECKED, applyBaseline, baselineAtHead, honouredBaseline, readBaseline } from '../../modules/state/index.ts';
import { adaptersFor, checksFor } from './registry.ts';

export interface RunOptions {
  /** Check ids or module prefixes (`walls`, `design-system`, `architecture/walls`). */
  only?: string[];
  staged?: string[];
  /** Set false to see every finding, baselined or not (used to rewrite the baseline). */
  baseline?: boolean;
}

export function select(checks: Check[], only?: string[]): Check[] {
  if (!only || only.length === 0) return checks;
  const picked = checks.filter((c) => only.some((o) => c.id === o || c.id.startsWith(`${o}/`) || c.id.endsWith(`/${o}`)));
  const gates = checks.filter((c) => c.gate && !picked.includes(c));
  return [...gates, ...picked];
}

export async function runChecks(project: Project, opts: RunOptions = {}): Promise<CheckResult[]> {
  const checks = select(checksFor(project), opts.only);
  const unknown = (opts.only ?? []).filter((o) => !checks.some((c) => c.id === o || c.id.startsWith(`${o}/`) || c.id.endsWith(`/${o}`)));
  const ctx = { project, adapters: adaptersFor(project), ...(opts.staged ? { staged: opts.staged } : {}) };
  const results: CheckResult[] = [];
  const run = async (c: Check): Promise<CheckResult> => {
    try {
      return await c.run(ctx);
    } catch (e) {
      // A file the check reads is broken, such as a record that isn't valid JSON: say which, as a finding would.
      if (e instanceof FwosError) return { id: c.id, status: 'fail', reason: e.message.split(`${project.root}/`).join(''), findings: [], inputs: [] };
      return { id: c.id, status: 'fail', reason: `the check crashed: ${(e as Error).message}`, findings: [{ message: (e as Error).stack?.split('\n').slice(0, 3).join(' ') ?? String(e) }], inputs: [] };
    }
  };
  const gates = checks.filter((c) => c.gate);
  for (const g of gates) results.push(await run(g));
  const failedGate = results.find((r) => r.status === 'fail');
  for (const c of checks.filter((x) => !x.gate)) {
    results.push(failedGate ? off(c.id, `stopped: ${failedGate.id} failed, so nothing else runs until it's fixed`) : await run(c));
  }
  for (const u of unknown) results.push({ id: u, status: 'fail', reason: `no check matches "${u}"`, findings: [], inputs: [] });
  // The baseline is adopt mode's: a new project starts clean, so a baseline.json there is ignored.
  if (opts.baseline === false || project.mode !== 'adopt') return results;
  const working = readBaseline(project.root);
  // Never more than the last commit's baseline covers: widening it by hand hides nothing new.
  const { baseline, widened } = honouredBaseline(working, working ? baselineAtHead(project.root) : null);
  return applyBaseline(results, baseline, unbaselined(checks)).map((r) => {
    const n = widened[r.id] ?? 0;
    if (n === 0) return r;
    const note = `.fwos/baseline.json covers ${n} more finding${n === 1 ? '' : 's'} than the last commit's, and fwos check doesn't honour ${n === 1 ? 'it' : 'them'}`;
    return { ...r, info: [...(r.info ?? []), note] };
  });
}

/** The checks a baseline never covers: every gate, plus the proof that tests ran and weren't bent. */
export function unbaselined(checks: Check[]): Set<string> {
  return new Set([...checks.filter((c) => c.gate).map((c) => c.id), ...ALWAYS_CHECKED]);
}

export function exitCode(results: CheckResult[]): number {
  return results.some((r) => r.status === 'fail') ? 1 : 0;
}
