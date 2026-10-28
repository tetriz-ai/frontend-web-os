// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Approvals are content hashes. An approval records the hash of what was approved; if the file
// changes afterwards, whoever edited it, the approval is stale. No manual stale flags.

import { join, posix } from 'node:path';
import { FwosError, hashPath, hashText, parseFrontmatter, writeText, type Project } from '../../kernel/index.ts';
import { type ApprovalRecord, type ApprovalVia, type Change, type Step, now } from './model.ts';
import { currentChange, isAdoptionRecord, listChanges, updateLatestChange } from './store.ts';

export interface ApprovalTarget {
  name: string;
  /** Paths relative to the project root. */
  paths(project: Project): string[];
  required: boolean;
  /** The step this approval closes. */
  step: Step;
  what: string;
  /** Listed only once it has been decided: most projects never adopt a design system to approve. */
  onDemand?: boolean;
}

const docs = (p: Project, f: string) => posix.join(p.paths.docs, f);

export const APPROVAL_TARGETS: ApprovalTarget[] = [
  { name: 'brief', paths: (p) => [docs(p, 'brief.md')], required: true, step: 'discovery', what: 'the brief' },
  { name: 'research', paths: (p) => [docs(p, 'research.md')], required: false, step: 'research', what: 'research picks' },
  {
    name: 'architecture',
    paths: (p) => [docs(p, 'modules.json')],
    required: false,
    step: 'architecture',
    what: 'the architecture (modules.json)',
  },
  {
    name: 'design-system',
    paths: (p) => [p.paths.designSystem],
    required: false,
    step: 'design-system',
    what: 'the design system',
  },
  {
    name: 'fidelity',
    paths: (p) => [p.paths.designSystem, docs(p, 'reports/design-system.md')],
    required: false,
    step: 'design-system',
    what: 'the fidelity of an adopted design system (design-system/ and its report)',
    onDemand: true,
  },
  { name: 'screens', paths: (p) => [docs(p, 'ia.json')], required: false, step: 'screens', what: 'the screens and ia.json' },
  {
    name: 'spec',
    // A team that keeps its own test planning approves the spec delta alone: fwos writes no plan for it.
    paths: (p) => [docs(p, 'spec.md'), ...(p.kept.includes('test-plan') ? [] : [docs(p, 'test-plan.md')])],
    required: true,
    step: 'spec',
    what: 'the spec and the test plan, together',
  },
  {
    name: 'acceptance',
    paths: (p) => [docs(p, 'reports/acceptance.md')],
    required: true,
    step: 'accept',
    what: 'the acceptance report',
  },
];

export function target(name: string): ApprovalTarget {
  const t = APPROVAL_TARGETS.find((x) => x.name === name);
  if (!t) {
    throw new FwosError(
      `Unknown approval "${name}".`,
      `One of: ${APPROVAL_TARGETS.map((x) => x.name).join(', ')}`,
    );
  }
  return t;
}

/** Per-file hashes and the combined hash, or `null` when any file is missing. */
export function currentHashes(project: Project, t: ApprovalTarget): { sha: string; files: Record<string, string> } | null {
  const files: Record<string, string> = {};
  for (const rel of t.paths(project)) {
    const sha = hashPath(project.abs(rel));
    if (sha === null) return null;
    files[rel] = sha;
  }
  const sha = hashText(
    Object.entries(files)
      .map(([k, v]) => `${k}\0${v}`)
      .join('\n'),
  );
  return { sha, files };
}

export type ApprovalStatus = 'approved' | 'stale' | 'missing' | 'skipped' | 'absent';

export interface ApprovalState {
  target: string;
  status: ApprovalStatus;
  required: boolean;
  record?: ApprovalRecord;
  changeId?: string;
  /** For stale approvals: which files changed since they were approved. */
  changed?: string[];
  reason?: string;
}

/**
 * Looks across every change file: the latest approval or skip of the target decides, by its time,
 * so an old skip never hides a newer approval that went stale, even one a merged branch brings in
 * under a newer change id. A change that did neither changes nothing, so an untouched approval
 * holds for free. On the same instant a skip decides, and a newer change decides over an older one.
 */
/** A target whose files aren't all there yet, naming the ones that are missing. */
function absentState(project: Project, t: ApprovalTarget, base: Pick<ApprovalState, 'target' | 'required' | 'changeId'>): ApprovalState {
  const missing = t.paths(project).filter((p) => hashPath(project.abs(p)) === null);
  return { ...base, status: 'absent', reason: `missing: ${missing.join(', ')}` };
}

/** Approved, or stale with the files that changed, against the hashes the target has now. */
function recordState(base: Pick<ApprovalState, 'target' | 'required' | 'changeId'>, rec: ApprovalRecord, current: { sha: string; files: Record<string, string> }): ApprovalState {
  if (rec.sha === current.sha) return { ...base, status: 'approved', record: rec };
  const changed = Object.keys(current.files).filter((f) => rec.files[f] !== current.files[f]);
  return { ...base, status: 'stale', record: rec, changed };
}

export function approvalState(project: Project, name: string, changes: Change[] = listChanges(project.root)): ApprovalState {
  const t = target(name);
  const base = { target: t.name, required: t.required };
  const current = currentHashes(project, t);
  const absent = () => absentState(project, t, base);
  type Decision = { at: string; rank: number; change: Change } & ({ rec: ApprovalRecord } | { reason: string });
  let last: Decision | null = null;
  changes.forEach((c, i) => {
    const rec = c.approvals[t.name];
    const decisions: Decision[] = [
      ...(rec ? [{ at: rec.at, rank: 2 * i, change: c, rec }] : []),
      ...(c.skips ?? []).filter((s) => s.target === t.name).map((s) => ({ at: s.at, rank: 2 * i + 1, change: c, reason: s.reason })),
    ];
    for (const d of decisions) if (!last || d.at > last.at || (d.at === last.at && d.rank > last.rank)) last = d;
  });
  const decided = last as Decision | null;
  if (!decided) return current ? { ...base, status: 'missing' } : absent();
  if (!('rec' in decided)) return { ...base, status: 'skipped', changeId: decided.change.id, reason: decided.reason };
  if (!current) return absent();
  return recordState({ ...base, changeId: decided.change.id }, decided.rec, current);
}

/**
 * A target's state in one change only: approved while that change's own approval still matches the
 * files. A change in an adopted app answers for itself, so an approval another change recorded is
 * context for it, never its approval.
 */
export function changeApprovalState(project: Project, change: Change, name: string): ApprovalState {
  const t = target(name);
  const base = { target: t.name, required: t.required, changeId: change.id };
  const current = currentHashes(project, t);
  if (!current) return absentState(project, t, base);
  const rec = change.approvals[t.name];
  return rec ? recordState(base, rec, current) : { ...base, status: 'missing' };
}

export function allApprovals(project: Project): ApprovalState[] {
  const changes = listChanges(project.root);
  return APPROVAL_TARGETS.map((t) => approvalState(project, t.name, changes));
}

/** True when the approval holds: approved with a matching hash, or (if skippable) skipped. */
export function satisfied(s: ApprovalState): boolean {
  return s.status === 'approved' || (s.status === 'skipped' && !s.required);
}

/** How an adopted app's own work is named in a refusal: `the brief is`, `the screens are`. */
const TEAM_OWNS: Record<string, string> = { brief: 'the brief is', research: 'the research is', architecture: 'the architecture is', 'design-system': 'the design system is', screens: 'the screens are' };

/**
 * In an adopted app an approval is recorded only as a person gives it, on the change it is for:
 * a change's own spec (once the change is mapped onto the code it touches) and its acceptance
 * report. The product as it was, its brief, architecture, design system and screens, is the
 * team's, and fwos never records an approval of it. The fidelity approval is the exception: it
 * reviews fwos's own import of the team's design system, not the design system, so a person can
 * give it whenever the comparison is ready, on the latest change.
 */
function assertAdoptedApproval(project: Project, t: ApprovalTarget): void {
  if (t.name === 'fidelity') return;
  if (t.name !== 'spec' && t.name !== 'acceptance') {
    const noun = TEAM_OWNS[t.name] ?? `${t.what} is`;
    throw new FwosError(`In an adopted app ${noun} your team's, from before fwos: fwos records no approval of ${t.name === 'screens' ? 'them' : 'it'}, only a change's own spec and acceptance, and the fidelity of its import of your design system, as people give them.`);
  }
  const open = currentChange(project.root);
  const change = open && !isAdoptionRecord(project, open) ? open : null;
  const none = new FwosError("No change is open, so there is nothing to approve: an approval is recorded on the change it's for, as it's given.", 'Start one with /fwos:change "<request>".');
  if (t.name === 'acceptance') {
    // A closed change's report can be approved again, as the latest change delivered through fwos.
    if (!change && !listChanges(project.root).some((c) => !isAdoptionRecord(project, c))) throw none;
    return;
  }
  if (!change) throw none;
  if (change.route !== 'code-only' && !change.map) {
    throw new FwosError(`Map change ${change.id} before its spec is approved: \`fwos change map <route or file>\` reads what it touches, for the spec's Context and the test plan's regression scope.`);
  }
}

export function approve(project: Project, name: string, by: string, via: ApprovalVia = 'chat', ref?: string): ApprovalRecord {
  const t = target(name);
  if (!by.trim()) throw new FwosError('An approval needs a name: --by "<who approved>".');
  if (via === 'pr' && !ref?.trim()) throw new FwosError('An approval given in a review needs its link: --ref <the review URL>.');
  if (ref !== undefined && via !== 'pr') throw new FwosError('--ref names the review a yes was given in, so use it with --via pr.');
  if (project.mode === 'adopt') assertAdoptedApproval(project, t);
  const current = currentHashes(project, t);
  if (!current) {
    const missing = t.paths(project).filter((p) => hashPath(project.abs(p)) === null);
    throw new FwosError(`Can't approve ${t.what}: ${missing.join(', ')} doesn't exist yet.`);
  }
  const record: ApprovalRecord = { ...current, by: by.trim(), at: now(), via, ...(ref ? { ref: ref.trim() } : {}) };
  updateLatestChange(project.root, (c) => {
    c.approvals[t.name] = record;
  });
  return record;
}

export function skip(project: Project, name: string, reason: string, by: string): void {
  const t = target(name);
  if (project.mode === 'adopt') {
    throw new FwosError(`In an adopted app there's no ${t.name} step to skip: a change starts at its spec delta, and what comes before it is your team's.`);
  }
  if (t.required) {
    throw new FwosError(
      `${t.what} can't be skipped; it's a required approval.`,
      'Only research, architecture, design-system and screens can be skipped. Spike mode (spikes/) has no approvals at all.',
    );
  }
  if (!reason.trim()) throw new FwosError('A skip needs a reason: --reason "<why>".');
  updateLatestChange(project.root, (c) => {
    c.skips = [...(c.skips ?? []).filter((s) => s.target !== t.name), { target: t.name, reason, by, at: now() }];
  });
}

// ---- based_on: staleness that flows downstream ----------------------------------------------

export interface DocStaleness {
  doc: string;
  stale: { ref: string; was: string; now: string | null }[];
}

/** Each doc's front matter records what it was built from (`based_on: brief.md@9f2c41d0ab12`). */
export function docStaleness(project: Project): DocStaleness[] {
  const out: DocStaleness[] = [];
  for (const rel of project.files([`${project.paths.docs}/**/*.md`])) {
    const text = project.read(rel);
    if (!text) continue;
    const refs = parseFrontmatter(text).data.based_on;
    if (!Array.isArray(refs)) continue;
    const stale: DocStaleness['stale'] = [];
    for (const ref of refs) {
      const m = /^(.+)@([0-9a-f]+)$/.exec(String(ref));
      if (!m) continue;
      const nowSha = hashPath(project.abs(join(project.paths.docs, m[1]!)));
      if (nowSha !== m[2]) stale.push({ ref: m[1]!, was: m[2]!, now: nowSha });
    }
    if (stale.length > 0) out.push({ doc: rel, stale });
  }
  return out;
}

/** Rewrites a doc's `based_on` front matter with the current hashes of its sources. */
export function stampBasedOn(project: Project, docRel: string, sources: string[]): string[] {
  const text = project.read(docRel);
  if (text === null) throw new FwosError(`${docRel} doesn't exist.`);
  const refs = sources.map((s) => {
    const sha = hashPath(project.abs(join(project.paths.docs, s)));
    if (sha === null) throw new FwosError(`Can't stamp: ${posix.join(project.paths.docs, s)} doesn't exist.`);
    return `${s}@${sha}`;
  });
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const line = `based_on: [${refs.join(', ')}]`;
  let next: string;
  if (fm) {
    const kept = fm[1]!
      .split(/\r?\n/)
      .filter((l, i, all) => !l.startsWith('based_on:') && !(l.startsWith('  - ') && isBasedOnItem(all, i)));
    next = `---\n${[...kept, line].join('\n')}\n---\n${text.slice(fm[0].length)}`;
  } else {
    next = `---\n${line}\n---\n\n${text}`;
  }
  writeText(project.abs(docRel), next);
  return refs;
}

function isBasedOnItem(lines: string[], i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    if (lines[j]!.startsWith('  - ')) continue;
    return lines[j]!.startsWith('based_on:');
  }
  return false;
}
