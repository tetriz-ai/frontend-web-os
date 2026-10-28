// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The check contract. Every module's checks implement `Check`; the CLI shell runs them.
// A check never calls a model, and anything it cannot run reports `off` with a reason.

import type { AdapterSet } from './adapters.ts';
import type { Project } from './project.ts';

export type Platform = 'web' | 'electron' | 'mac';
export const PLATFORMS: readonly Platform[] = ['web', 'electron', 'mac'];

export type CheckStatus = 'pass' | 'fail' | 'off';

export interface Finding {
  message: string;
  file?: string;
  line?: number;
  /** A stable rule or sub-check name, used for baselines and reports. */
  rule?: string;
}

export interface CheckResult {
  id: string;
  status: CheckStatus;
  /** Why it is off, or a one-line summary of a pass or fail. */
  reason?: string;
  findings: Finding[];
  /** The input paths or globs the check read. Doctor shows these. */
  inputs: string[];
  /** Extra lines that are neither findings nor failures (counts, notes). */
  info?: string[];
  /** Findings hidden because `.fwos/baseline.json` already records them. */
  baselined?: number;
}

export interface CheckContext {
  project: Project;
  adapters: AdapterSet;
  /** Only these files changed (from `--staged`). Checks may narrow their scan to them. */
  staged?: string[];
}

export interface Check {
  /** `<module>/<name>`, e.g. `architecture/walls`. */
  id: string;
  title: string;
  /** The kind of violation this check can detect, in one line. */
  catches: string;
  platforms: readonly Platform[];
  /** Schema checks run first and stop everything else when they fail (fail closed). */
  gate?: boolean;
  run(ctx: CheckContext): CheckResult | Promise<CheckResult>;
}

export function off(id: string, reason: string, inputs: string[] = []): CheckResult {
  return { id, status: 'off', reason, findings: [], inputs };
}

export function result(id: string, findings: Finding[], inputs: string[], summary?: string, info?: string[]): CheckResult {
  const status: CheckStatus = findings.length > 0 ? 'fail' : 'pass';
  const reason = summary ?? (status === 'pass' ? undefined : `${findings.length} finding${findings.length === 1 ? '' : 's'}`);
  const out: CheckResult = { id, status, findings, inputs };
  if (reason !== undefined) out.reason = reason;
  if (info && info.length > 0) out.info = info;
  return out;
}

/**
 * A key for a finding that leaves out where it sits (its line, and any line or column its message
 * quotes), so moving code doesn't break a baseline. Other digits count: `#111111` and `#222222`
 * are different findings.
 */
export function fingerprint(checkId: string, f: Finding): string {
  const msg = f.message
    .replace(/\b(lines?|col(?:umn)?s?)\s+\d+(?:\s*[-–]\s*\d+)?/gi, '$1 N')
    .replace(/\s+/g, ' ')
    .trim();
  return [checkId, f.file ?? '', f.rule ?? '', msg].join('|');
}
