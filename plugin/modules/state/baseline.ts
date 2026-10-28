// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The baseline: findings that existed before fwos (adopt mode). `fwos check` then fails only on
// a new or worse result, and still lists the baselined count. The baseline can only shrink.

import { execFileSync } from 'node:child_process';
import { type CheckResult, type Finding, FwosError, fingerprint, ownedPath, parseJsonc, readJson, writeJson } from '../../kernel/index.ts';
import { now, today } from './model.ts';
import { FWOS_DIR } from './store.ts';

export interface Baseline {
  schema: 1;
  createdAt: string;
  /**
   * The checks it covers, each with the day it was first recorded: every check that ran then, clean
   * ones included. A covered check can only shrink. One that wasn't on yet (a level that turned it
   * on, a check new in fwos) is taken in once. A file written before this field covers every check.
   */
  checks?: Record<string, string>;
  /**
   * Per check, each fingerprint and how many findings had it. A file written before fwos kept counts
   * holds a list of fingerprints instead (every digit read as N); it is still read, as a list.
   */
  findings: Record<string, Record<string, number> | string[]>;
}

const path = (root: string) => ownedPath(root, `${FWOS_DIR}/baseline.json`);

export function readBaseline(root: string): Baseline | null {
  return readJson<Baseline>(path(root));
}

/** The fingerprint an old list-style baseline holds: the message with every digit run read as N. */
function listFingerprint(checkId: string, f: Finding): string {
  const msg = f.message.replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim();
  return [checkId, f.file ?? '', f.rule ?? '', msg].join('|');
}

/**
 * The findings the baseline doesn't cover. Each baselined fingerprint covers as many findings as it
 * had when recorded, so a second identical finding is new. An old list-style entry has no count,
 * so it covers every finding with its fingerprint, as it did when it was written.
 */
function uncovered(checkId: string, findings: Finding[], known: Record<string, number> | string[]): Finding[] {
  if (Array.isArray(known)) {
    const set = new Set(known);
    return findings.filter((f) => !set.has(listFingerprint(checkId, f)));
  }
  const left = new Map(Object.entries(known));
  return findings.filter((f) => {
    const fp = fingerprint(checkId, f);
    const n = left.get(fp) ?? 0;
    if (n > 0) left.set(fp, n - 1);
    return n <= 0;
  });
}

/**
 * Checks a baseline never covers: approvals that still hold, and the proof that tests ran and
 * weren't bent. Callers add the gate checks, so a malformed file always stops the run.
 */
export const ALWAYS_CHECKED: readonly string[] = ['state/approvals', 'tests/traceability', 'tests/locked', 'tests/regression'];

/** Hides findings the baseline already records. A check whose remaining findings are empty passes. */
export function applyBaseline(results: CheckResult[], baseline: Baseline | null, exempt: ReadonlySet<string> = new Set(ALWAYS_CHECKED)): CheckResult[] {
  if (!baseline) return results;
  return results.map((r) => {
    const known = baseline.findings[r.id];
    if (!known || r.status !== 'fail' || exempt.has(r.id)) return r;
    const fresh = uncovered(r.id, r.findings, known);
    const hidden = r.findings.length - fresh.length;
    if (hidden === 0) return r;
    const next: CheckResult = { ...r, findings: fresh, baselined: hidden };
    if (fresh.length === 0) {
      next.status = 'pass';
      next.reason = `no new findings (${hidden} baselined)`;
    } else {
      next.reason = `${fresh.length} new finding${fresh.length === 1 ? '' : 's'} (${hidden} baselined)`;
    }
    return next;
  });
}

/** Per check, each fingerprint and how many findings have it, with keys sorted so the file is stable. */
export function fingerprintsOf(results: CheckResult[], exempt: ReadonlySet<string> = new Set(ALWAYS_CHECKED)): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of results) {
    if (r.findings.length === 0 || exempt.has(r.id)) continue;
    const counts = new Map<string, number>();
    for (const f of r.findings) {
      const fp = fingerprint(r.id, f);
      counts.set(fp, (counts.get(fp) ?? 0) + 1);
    }
    out[r.id] = Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  return out;
}

/** How many findings one check's entry holds. */
const size = (known: Record<string, number> | string[]) => (Array.isArray(known) ? known.length : Object.values(known).reduce((a, b) => a + b, 0));
const total = (findings: Baseline['findings']) => Object.values(findings).reduce((sum, v) => sum + size(v), 0);

/** How many findings a baseline holds, every check together. */
export const baselineTotal = (baseline: Baseline) => total(baseline.findings);
const sortedKeys = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * The baseline as the last commit has it, or null when git can't say (no repository, no commit, no
 * baseline in it). The project can sit in a subfolder of the repository.
 */
export function baselineAtHead(root: string): Baseline | null {
  try {
    const text = execFileSync('git', ['show', `HEAD:./${FWOS_DIR}/baseline.json`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return parseJsonc(text) as Baseline;
  } catch {
    return null;
  }
}

/**
 * The baseline `fwos check` honours: the working copy, but for a check the last commit's baseline
 * covers, never more of a finding than that commit holds. So a baseline widened outside the CLI,
 * by a shell edit or by deleting it and starting over, hides nothing new until it is committed,
 * where a reviewer sees it. `widened` counts, per check, what isn't honoured.
 */
export function honouredBaseline(working: Baseline | null, head: Baseline | null): { baseline: Baseline | null; widened: Record<string, number> } {
  if (!working || !head) return { baseline: working, widened: {} };
  const covered = (id: string) => !head.checks || id in head.checks;
  const widened: Record<string, number> = {};
  const findings: Baseline['findings'] = {};
  for (const [id, known] of Object.entries(working.findings)) {
    const was = head.findings[id];
    if (!covered(id)) findings[id] = known;
    else if (was === undefined) widened[id] = size(known);
    else if (Array.isArray(known) && Array.isArray(was)) {
      const keep = known.filter((fp) => was.includes(fp));
      if (keep.length > 0) findings[id] = keep;
      if (known.length > keep.length) widened[id] = known.length - keep.length;
    } else if (Array.isArray(known) || Array.isArray(was)) {
      // A representation change cannot grant new allowances before a reviewer commits it.
      findings[id] = was;
      widened[id] = size(known);
    } else {
      const keep: Record<string, number> = {};
      let extra = 0;
      for (const [fp, n] of Object.entries(known)) {
        const m = Math.min(n, was[fp] ?? 0);
        if (m > 0) keep[fp] = m;
        extra += n - m;
      }
      if (Object.keys(keep).length > 0) findings[id] = keep;
      if (extra > 0) widened[id] = extra;
    }
  }
  return { baseline: { ...working, findings }, widened };
}

/**
 * `init` records everything that fails today, and names every check that ran. Afterwards a covered
 * check may only shrink: a finding that isn't already in it can't be added, it has to be fixed. A
 * check that is on now but wasn't then is taken in once, with its findings, and listed in `added`.
 */
export function writeBaseline(root: string, results: CheckResult[], opts: { init?: boolean; exempt?: ReadonlySet<string> } = {}): {
  removed: number;
  total: number;
  added?: { id: string; count: number }[];
} {
  const exempt = opts.exempt ?? new Set(ALWAYS_CHECKED);
  const current = fingerprintsOf(results, exempt);
  const ran = results.filter((r) => r.status !== 'off' && !exempt.has(r.id)).map((r) => r.id);
  const existing = readBaseline(root);
  const added: { id: string; count: number }[] = [];
  let checks: Record<string, string> | undefined;
  if (!opts.init) {
    if (!existing) throw new FwosError('There is no baseline yet.', 'Create one with `fwos baseline --init` (adopt mode).');
    const covers = (id: string) => !existing.checks || id in existing.checks;
    const grew = results.flatMap((r) => {
      if (exempt.has(r.id) || !covers(r.id)) return [];
      const known = existing.findings[r.id];
      return (known ? uncovered(r.id, r.findings, known) : r.findings).map((f) => `${r.id}: ${f.file ? `${f.file}: ` : ''}${f.message}`);
    });
    if (grew.length > 0) {
      throw new FwosError(
        `The baseline can only shrink; ${grew.length} finding${grew.length === 1 ? ' is' : 's are'} new.`,
        grew.slice(0, 5).join('\n'),
      );
    }
    if (existing.checks) {
      checks = { ...existing.checks };
      for (const id of ran.filter((x) => !covers(x))) {
        checks[id] = today();
        added.push({ id, count: size(current[id] ?? {}) });
      }
    }
  } else if (existing) {
    throw new FwosError('A baseline already exists.', 'It can only shrink: run `fwos baseline` to drop fixed findings.');
  } else if (baselineAtHead(root)) {
    throw new FwosError(
      'The last commit has a baseline, so starting a new one would hide every finding added since.',
      'Restore it with `git checkout HEAD -- .fwos/baseline.json`, then run `fwos baseline` to drop what you fixed.',
    );
  } else checks = Object.fromEntries(ran.map((id) => [id, today()]));
  const before = existing ? total(existing.findings) : 0;
  const after = total(current);
  const takenIn = added.reduce((sum, a) => sum + a.count, 0);
  writeJson(path(root), { schema: 1, createdAt: existing?.createdAt ?? now(), ...(checks ? { checks: sortedKeys(checks) } : {}), findings: current });
  return { removed: Math.max(0, before - (after - takenIn)), total: after, ...(added.length > 0 ? { added } : {}) };
}
