// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Reading and writing `.fwos/`: the state file, change files, the event log and git facts.

import { execFileSync } from 'node:child_process';
import { appendFileSync, closeSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ADOPT_LEVELS,
  type AdoptLevel,
  type AdoptStage,
  FwosError,
  ownedPath,
  isFile,
  parseJsonc,
  pluginVersion,
  readJson,
  readText,
  writeJson,
  writeText,
  type Platform,
  type Project,
  type ProjectMode,
  type ProjectPaths,
} from '../../kernel/index.ts';
import { type Change, type FwosState, type KeptStage, type Link, type Route, type Step, STATE_SCHEMA_VERSION, now, today } from './model.ts';

export const FWOS_DIR = '.fwos';

export function statePath(root: string): string {
  return ownedPath(root, `${FWOS_DIR}/state.json`);
}

export function changesDir(root: string): string {
  return ownedPath(root, `${FWOS_DIR}/changes`);
}

export function writeState(root: string, state: FwosState): void {
  writeJson(statePath(root), state);
}

export interface InitOptions {
  mode?: ProjectMode;
  platforms?: Platform[];
  name?: string;
  title?: string;
  /** Where things live, when not the defaults (adopt mode reads them from the app). */
  paths?: Partial<ProjectPaths>;
  /** Adopt mode: the level to start at (checks when unset). */
  level?: AdoptLevel;
  /** Adopt mode: the stages the team keeps its own practice for. */
  keep?: Partial<Record<AdoptStage, KeptStage>>;
}

/** Step 0: creates `.fwos/` and the first change, `0001-initial`. Refuses if already set up. */
export function initProject(root: string, opts: InitOptions = {}): { state: FwosState; change: Change } {
  if (isFile(statePath(root))) {
    throw new FwosError('This project already has .fwos/state.json.', 'Run `fwos status` to see where it stands.');
  }
  const state: FwosState = {
    schema: STATE_SCHEMA_VERSION,
    pluginVersion: pluginVersion(),
    mode: opts.mode ?? 'new',
    platforms: opts.platforms ?? ['web'],
    createdAt: today(),
  };
  if (opts.name) state.name = opts.name;
  if (state.mode === 'adopt') {
    const level = opts.level ?? 'checks';
    state.adopt = { level, history: [{ level, at: today() }], ...(opts.keep && Object.keys(opts.keep).length > 0 ? { keep: opts.keep } : {}) };
  }
  if (opts.paths && Object.keys(opts.paths).length > 0) state.paths = opts.paths;
  for (const rel of [`${FWOS_DIR}/state.json`, `${FWOS_DIR}/manifest.json`, `${FWOS_DIR}/provenance.json`, `${FWOS_DIR}/changes/0001-initial.json`, `${FWOS_DIR}/local/write.lock`, '.gitignore']) ownedPath(root, rel);
  writeState(root, state);
  writeJson(ownedPath(root, `${FWOS_DIR}/manifest.json`), { schema: 1, files: {} });
  writeJson(ownedPath(root, `${FWOS_DIR}/provenance.json`), { schema: 1, entries: [] });
  ensureGitignore(root);
  const change = createChange(root, { title: opts.title ?? 'Initial app', route: 'initial', step: 'discovery', slug: 'initial' });
  return { state, change };
}

/**
 * Sets an adopted app's level and adds it to the history, touching nothing else in the state: not
 * its paths, the stages its team keeps, change records, approvals or baseline. Refuses for a
 * project that isn't adopted.
 */
export function setAdoptLevel(root: string, level: AdoptLevel): FwosState {
  if (!(ADOPT_LEVELS as readonly string[]).includes(level)) throw new FwosError(`Unknown level "${level}".`, `One of: ${ADOPT_LEVELS.join(', ')}.`);
  const state = readJson<FwosState>(statePath(root));
  if (!state) throw new FwosError('Not an fwos project (no .fwos/state.json).', 'Run `fwos adopt` to see what fwos would set up.');
  if (state.mode !== 'adopt') throw new FwosError(`This project's mode is ${state.mode}: only an adopted app has a level.`);
  state.adopt = { ...state.adopt, level, history: [...(state.adopt?.history ?? []), { level, at: today() }] };
  writeState(root, state);
  return state;
}

/**
 * Sets the stages an adopted app's team keeps its own practice for, touching nothing else: not the
 * level or its history, the paths, the change records or the baseline. An empty set removes `keep`.
 */
export function setKeptStages(root: string, keep: Partial<Record<AdoptStage, KeptStage>>): FwosState {
  const state = readJson<FwosState>(statePath(root));
  if (!state?.adopt || state.mode !== 'adopt') throw new FwosError('Only an adopted app keeps its own practice for a stage.', 'Run `fwos adopt` to see what fwos would set up.');
  const { keep: _, ...adopt } = state.adopt;
  state.adopt = Object.keys(keep).length > 0 ? { ...adopt, keep } : adopt;
  writeState(root, state);
  return state;
}

/** The stages an adopted app's team keeps its own practice for, each with why and since when. */
export function keptStages(root: string): Partial<Record<AdoptStage, KeptStage>> {
  try {
    return readJson<FwosState>(statePath(root))?.adopt?.keep ?? {};
  } catch {
    return {}; // state/schema reports an unreadable state file
  }
}

/**
 * Whether `change` is an adopted app's adoption record: the first change `fwos adopt` (or
 * `fwos init --mode adopt`) creates. It stands for the app as it was, not for work to finish.
 */
export function isAdoptionRecord(project: Pick<Project, 'mode'>, change: Pick<Change, 'route'>): boolean {
  return project.mode === 'adopt' && change.route === 'initial';
}

/** Adds `.fwos/local/` to the project's .gitignore if it isn't there. */
export function ensureGitignore(root: string): boolean {
  const path = ownedPath(root, '.gitignore');
  const text = readText(path) ?? '';
  if (/^\/?\.fwos\/local\/?\s*$/m.test(text)) return false;
  const sep = text === '' || text.endsWith('\n') ? '' : '\n';
  writeText(path, `${text}${sep}# fwos: evidence, run logs and test results (local only)\n.fwos/local/\n`);
  return true;
}

export function listChanges(root: string): Change[] {
  const dir = changesDir(root);
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  return names
    .sort()
    .map((n) => readChangeFile(join(dir, n), n))
    .filter((c): c is Change => c !== null);
}

export function readChange(root: string, id: string): Change | null {
  return readChangeFile(join(changesDir(root), `${id}.json`), `${id}.json`);
}

/** A change file, or a refusal naming it when it holds something else, such as `[]`. */
function readChangeFile(path: string, name: string): Change | null {
  const c = readJson<Change>(path);
  if (c === null) return null;
  const tree = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!tree(c) || typeof c.id !== 'string' || typeof c.step !== 'string' || !tree(c.approvals)) {
    throw new FwosError(`${FWOS_DIR}/changes/${name} isn't a change record. Restore it from git, or run \`fwos check\` to see what state/schema expects.`);
  }
  return c;
}

/** Writes to a temporary file and renames it over the old one, so a reader never sees half a file. */
export function writeChange(root: string, change: Change): void {
  const path = ownedPath(root, `${FWOS_DIR}/changes/${change.id}.json`);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = ownedPath(root, `${FWOS_DIR}/changes/${change.id}.json.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(change, null, 2)}\n`);
  renameSync(tmp, path);
}

/**
 * Runs a read-modify-write of a change file under `.fwos/local/write.lock`, so two fwos commands at
 * once never lose each other's edit. A lock older than 30 s was left by a crash and is taken over.
 */
function withWriteLock<T>(root: string, fn: () => T): T {
  const lock = ownedPath(root, `${FWOS_DIR}/local/write.lock`);
  mkdirSync(dirname(lock), { recursive: true });
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let age = 0;
      try {
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {
        continue; // released between the two calls
      }
      if (age > 30_000) rmSync(lock, { force: true });
      else if (Date.now() > deadline) throw new FwosError('Another fwos command is still writing .fwos/.', `If none is running, delete ${FWOS_DIR}/local/write.lock.`);
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'change'
  );
}

export interface NewChange {
  title: string;
  route: Route;
  step: Step;
  slug?: string;
  /** What the change comes from or builds on: an issue or doc URL, or a project file with its hash. */
  links?: Link[];
  /** The spec's criteria when the change begins (an adopted app's change). */
  base?: { acs: Record<string, string> };
}

export function createChange(root: string, opts: NewChange): Change {
  // Under the write lock, so two commands at once never pick the same number.
  return withWriteLock(root, () => newChange(root, opts));
}

function newChange(root: string, opts: NewChange): Change {
  const existing = listChanges(root);
  const next = existing.reduce((n, c) => Math.max(n, Number.parseInt(c.id.slice(0, 4), 10) || 0), 0) + 1;
  const id = `${String(next).padStart(4, '0')}-${opts.slug ?? slugify(opts.title)}`;
  const change: Change = {
    schema: 1,
    id,
    title: opts.title,
    route: opts.route,
    step: opts.step,
    status: 'open',
    createdAt: today(),
    cursor: { pending: [] },
    approvals: {},
  };
  const git = gitFacts(root);
  if (git.branch) change.branch = git.branch;
  if (git.head) change.head = git.head;
  if (opts.links?.length) change.links = opts.links;
  if (opts.base) change.base = opts.base;
  writeChange(root, change);
  return change;
}

/**
 * The change being worked on: the open change for the current git branch, else the newest open
 * change. Derived rather than stored, so two branches never fight over one state file.
 */
export function currentChange(root: string): Change | null {
  const open = listChanges(root).filter((c) => c.status === 'open');
  if (open.length === 0) return null;
  const branch = gitFacts(root).branch;
  const onBranch = branch ? open.filter((c) => c.branch === branch) : [];
  const pool = onBranch.length > 0 ? onBranch : open;
  return pool[pool.length - 1]!;
}

/**
 * The change fwos's records are about: the current change, or the last one once every change is
 * closed. An adopted app's adoption record stays open by design, so there it is the last change
 * delivered through fwos, open or closed, and the adoption record only until there is one.
 */
export function latestChange(root: string): Change | null {
  const current = currentChange(root);
  const project = { mode: readJson<FwosState>(statePath(root))?.mode ?? 'new' };
  if (current && !isAdoptionRecord(project, current)) return current;
  return listChanges(root).filter((c) => !isAdoptionRecord(project, c)).at(-1) ?? current;
}

export function requireChange(root: string): Change {
  const change = currentChange(root);
  if (!change) {
    throw new FwosError('No open change.', 'Start one with `fwos change new "<request>" --route <route>`.');
  }
  return change;
}

/** Adds links to the open change, each once (a ref already linked for the same stage is left as it is). Returns the ones added. */
export function addLinks(root: string, links: Link[]): { change: Change; added: Link[] } {
  const added: Link[] = [];
  const change = updateChange(root, (c) => {
    for (const l of links) {
      if ((c.links ?? []).some((x) => x.ref === l.ref && x.stage === l.stage)) continue;
      c.links = [...(c.links ?? []), l];
      added.push(l);
    }
  });
  return { change, added };
}

export function updateChange(root: string, mutate: (c: Change) => void): Change {
  return withWriteLock(root, () => {
    const change = requireChange(root);
    mutate(change);
    writeChange(root, change);
    return change;
  });
}

/**
 * Like updateChange, but once every change is closed it records on the latest one (latestChange).
 * Approvals, skips and sign-offs use this, so a closed project can still re-approve (say, its
 * acceptance report after an fwos upgrade changes the format).
 */
export function updateLatestChange(root: string, mutate: (c: Change) => void): Change {
  return withWriteLock(root, () => {
    const change = latestChange(root);
    if (!change) throw new FwosError('No change yet.', 'Run `fwos init` first.');
    mutate(change);
    writeChange(root, change);
    return change;
  });
}

export function gitFacts(root: string): { branch?: string; head?: string } {
  const run = (args: string[]) => {
    try {
      return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return undefined;
    }
  };
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = run(['rev-parse', '--short', 'HEAD']);
  const out: { branch?: string; head?: string } = {};
  if (branch && branch !== 'HEAD') out.branch = branch;
  if (head) out.head = head;
  return out;
}

/**
 * The change files as the last commit has them, in file-name order like listChanges. Null when git
 * can't say: no git, not a repository, or no commit yet. A committed file that doesn't parse is left
 * out (state/schema reads the working copy). Two git calls, however many changes there are.
 */
export function changesAtHead(root: string): Change[] | null {
  const git = (args: string[], input?: string) =>
    execFileSync('git', args, { cwd: root, input, stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  let blobs: { oid: string; path: string }[];
  try {
    // Paths come back relative to the project, which can sit in a subfolder of the repository.
    blobs = git(['ls-tree', '-r', '-z', 'HEAD', '--', `${FWOS_DIR}/changes`])
      .toString()
      .split('\0')
      .map((line) => /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null && m[2]!.endsWith('.json'))
      .map((m) => ({ oid: m[1]!, path: m[2]! }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  } catch {
    return null;
  }
  if (blobs.length === 0) return [];
  let out: Buffer;
  try {
    out = git(['cat-file', '--batch'], `${blobs.map((b) => b.oid).join('\n')}\n`);
  } catch {
    return null;
  }
  const changes: Change[] = [];
  let at = 0;
  for (let i = 0; i < blobs.length; i++) {
    // Each object comes back as "<oid> blob <size>\n<content>\n".
    const eol = out.indexOf(10, at);
    const size = Number(out.subarray(at, eol).toString().split(' ')[2]);
    const body = out.subarray(eol + 1, eol + 1 + size).toString('utf8');
    at = eol + 1 + size + 1;
    try {
      const c = parseJsonc(body) as Change | null;
      if (c && typeof c === 'object') changes.push(c);
    } catch {
      // unreadable in the commit: it holds no lock this can read
    }
  }
  return changes;
}

/** Appends one event to `.fwos/local/log.jsonl`, the step-by-step trail used for debugging. */
export function logEvent(root: string, kind: string, data: Record<string, unknown> = {}): void {
  try {
    const path = ownedPath(root, `${FWOS_DIR}/local/log.jsonl`);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({ at: now(), kind, ...data })}\n`);
  } catch {
    // Logging never breaks a command.
  }
}

/**
 * Whether "no test has run for this yet" is a failure. During the build, ACs and states owned by
 * slices that haven't started are pending, not failing; from acceptance on (or with no open change)
 * every one must be proven.
 */
export function strictCoverage(root: string): boolean {
  const change = currentChange(root);
  // In an adopted app the adoption record stays open: with no other change open, every change
  // delivered so far must stay proven.
  if (change && change.route === 'initial' && readJson<FwosState>(statePath(root))?.mode === 'adopt') return true;
  return !change || change.step === 'accept' || change.step === 'done';
}
