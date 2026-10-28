// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Locked tests. Once a slice's tests are written (and new-behaviour tests have failed once), their
// files are locked by hash. The builder can't edit them through Write/Edit (a hook), and
// `fwos check` fails if a hash changes without a recorded unlock, whatever tool made the edit.

import { isAbsolute, relative } from 'node:path';
import {
  FwosError,
  type Project,
  caseInFile,
  hashFile,
  loadResults,
  normalizeRel,
  samePath,
} from '../../kernel/index.ts';
import { type Change, changesAtHead, listChanges, now, updateChange } from '../state/index.ts';

export interface LockOptions {
  slice?: string;
  /** `red`: requires a failing run for each file first. `existing`: characterisation, may start green. */
  evidence: 'red' | 'existing';
}

export type LockStatus = 'ok' | 'changed' | 'missing' | 'unlocked';

export interface LockedFile {
  path: string;
  changeId: string;
  status: LockStatus;
  unlock?: { reason: string; reviewer: string };
}

/** A test path as the project names it. An absolute path inside the project works; one outside it is refused. */
function projectPath(project: Project, named: string): string {
  const rel = normalizeRel(isAbsolute(named) ? relative(project.root, named) : named);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new FwosError(`${named} is outside the project.`, 'Lock and unlock only test files inside the project.');
  return rel;
}

/** Locks test files at their current hash. With `red` evidence, each file must have a failing case in the latest results. */
export function lockTests(project: Project, named: string[], opts: LockOptions): { locked: string[]; failing: string[] } {
  if (named.length === 0) throw new FwosError('Name the test files to lock.');
  const files = named.map((f) => projectPath(project, f));
  const failing: string[] = [];
  if (opts.evidence === 'red') {
    const { cases } = loadResults(project);
    if (cases.length === 0) {
      throw new FwosError(
        'No test results to prove the red run.',
        `Run the slice's tests first (results go to ${project.paths.results.join(', ')}), or use --existing for behaviour that already works.`,
      );
    }
    for (const f of files) {
      const red = cases.filter((c) => c.status === 'failed' && caseInFile(c, f));
      if (red.length === 0) {
        throw new FwosError(
          `${f} has no failing test in the latest results.`,
          'Tests for new behaviour must fail before the code exists. If this covers behaviour that already works, lock it with --existing.',
        );
      }
      failing.push(...red.map((c) => c.name));
    }
  }
  const at = now();
  const shas = files.map((f) => {
    const sha = hashFile(project.abs(f));
    if (sha === null) throw new FwosError(`${f} doesn't exist.`);
    return sha;
  });
  updateChange(project.root, (c) => {
    c.lockedTests ??= {};
    files.forEach((f, i) => {
      c.lockedTests![f] = { sha: shas[i]!, at, evidence: opts.evidence, ...(opts.slice ? { slice: opts.slice } : {}) };
    });
    for (const u of c.unlocks ?? []) if (files.includes(u.path) && !u.relockedAt) u.relockedAt = at;
    if (failing.length > 0) (c.redRuns ??= []).push({ at, failing, ...(opts.slice ? { slice: opts.slice } : {}) });
  });
  return { locked: files, failing };
}

export function unlockTest(project: Project, named: string, reason: string, reviewer: string): void {
  const file = projectPath(project, named);
  if (!reason.trim()) throw new FwosError('An unlock needs a reason: --reason "<why the test itself is wrong>".');
  if (!reviewer.trim()) throw new FwosError("An unlock needs a reviewer's OK: --reviewer \"<name>\".");
  if (!lockedFiles(project).some((l) => l.path === file)) throw new FwosError(`${file} isn't locked.`);
  updateChange(project.root, (c) => {
    (c.unlocks ??= []).push({ path: file, reason, reviewer, at: now() });
  });
}

/**
 * The newest unlock of `path` that no later lock closed. A lock in the same change closes it
 * (`relockedAt`), and so does a lock in any later change: an unlock is open only when it sits in
 * the change holding the newest lock, or a later one.
 */
function openUnlock(changes: Change[], path: string, lockIndex: number) {
  for (let i = changes.length - 1; i >= lockIndex; i--) {
    const u = (changes[i]!.unlocks ?? []).filter((x) => normalizeRel(x.path) === path && !x.relockedAt).pop();
    if (u) return u;
  }
  return undefined;
}

/** The newest lock of each path across `changes`, with the change that holds it. */
function newestLocks(changes: Change[]): Map<string, { sha: string; index: number; changeId: string }> {
  const latest = new Map<string, { sha: string; index: number; changeId: string }>();
  changes.forEach((c, index) => {
    for (const [path, l] of Object.entries(c.lockedTests ?? {})) latest.set(normalizeRel(path), { sha: l.sha, index, changeId: c.id });
  });
  return latest;
}

/** Every locked file across all changes (the newest lock for a path wins). */
export function lockedFiles(project: Project): LockedFile[] {
  const changes = listChanges(project.root);
  return [...newestLocks(changes)].map(([path, l]) => {
    const unlock = openUnlock(changes, path, l.index);
    const sha = hashFile(project.abs(path));
    let status: LockStatus = 'ok';
    if (unlock) status = 'unlocked';
    else if (sha === null) status = 'missing';
    else if (sha !== l.sha) status = 'changed';
    const out: LockedFile = { path, changeId: l.changeId, status };
    if (unlock) out.unlock = { reason: unlock.reason, reviewer: unlock.reviewer };
    return out;
  });
}

export interface LostLock {
  path: string;
  /** The change that holds the lock in the last commit. */
  changeId: string;
  /** `vanished`: no change file holds it now. `rehashed`: one holds it at another hash. */
  how: 'vanished' | 'rehashed';
}

/**
 * Locks the last commit holds that the change files no longer hold as committed, with no unlock of
 * that test open at the commit or recorded since. The CLI never removes a lock and re-hashes one
 * only after an unlock, so either means a change file was edited by hand. Null when git can't say
 * (no repository, or no commit yet): then only the working copy is checked.
 */
export function locksLostSinceCommit(project: Project): LostLock[] | null {
  const committed = changesAtHead(project.root);
  if (!committed) return null;
  const changes = listChanges(project.root);
  const now = newestLocks(changes);
  const unlocks = (cs: Change[], path: string) => cs.flatMap((c) => (c.unlocks ?? []).filter((u) => normalizeRel(u.path) === path).map((u) => u.at));
  const lost: LostLock[] = [];
  for (const [path, was] of newestLocks(committed)) {
    const is = now.get(path);
    if (is?.sha === was.sha) continue;
    const before = unlocks(committed, path);
    if (openUnlock(committed, path, was.index) || unlocks(changes, path).some((at) => !before.includes(at))) continue;
    lost.push({ path, changeId: was.changeId, how: is ? 'rehashed' : 'vanished' });
  }
  return lost;
}

/** Whether `path` is a locked test, in any spelling of it (and any case, where the disk ignores case). */
export function isLocked(project: Project, path: string): boolean {
  return lockedFiles(project).some((l) => samePath(project, l.path, path) && l.status !== 'unlocked');
}
