// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Run records: what fwos's harness saw when the app's end-to-end runner ran it, and how the team's
// own test scripts went when `fwos tests run` ran them, bound to the code they ran on. A record
// names its revision (a content hash of everything a run of the app depends on) and, for the
// harness, the harness that recorded it, so it counts only while both are still current: a stale
// run, or one an edited harness recorded, proves nothing.

import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, posix } from 'node:path';
import type { Harness } from './adapters.ts';
import { readText, writeJson } from './files.ts';
import { matchAny } from './glob.ts';
import { hashFile, hashText } from './hash.ts';
import { type Project, isTestFile } from './project.ts';
import { validateWith } from './schema.ts';
import schema from './schema/run.schema.json' with { type: 'json' };

export const RUNS_DIR = '.fwos/local/runs';

/** A harness's runs (`states`, `ia`), or the team's own test scripts as `fwos tests run` ran them (`tests`). */
export type RunKind = Harness['kind'] | 'tests';

export interface RunRecord<T = unknown> {
  schema: 1;
  kind: RunKind;
  /** What it observed: `page.<id>` or `component.<id>` for states, a role and flag setting for ia, a script (`<dir>/<script>` outside the root) for tests. */
  target: string;
  /** The fwos version that recorded it. */
  fwos: string;
  /** The harness file that ran, and the hash of what it held then. Null for a run of the team's own tests. */
  harness: { file: string; sha: string } | null;
  /** The revision it ran on, or null when the code changed during the run. */
  revision: string | null;
  /** How it ran: the server, the browser, the viewport, or the command fwos ran. */
  config: Record<string, string>;
  at: string;
  observations: T;
}

/**
 * The files a run of the app depends on: its app folders, packages, design system and ia.json, and
 * the root manifests, minus tests and build output. Docs are never among them, even for an app at
 * the project root, or writing a report or a README would make every run stale: fwos's docs folder
 * (but ia.json, which the IA harness runs from), and Markdown outside the app's source.
 */
export function revisionInputs(project: Project): string[] {
  const apps = Object.values(project.paths.apps)
    .filter((a): a is string => !!a)
    .map((a) => (a === '.' ? '**' : `${a}/**`));
  const include = [...apps, 'packages/**', `${project.paths.designSystem}/**`, 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package-lock.json', 'yarn.lock'];
  const ia = posix.join(project.paths.docs, 'ia.json');
  const files = project.files(include, ['.fwos/**', `${project.paths.docs}/**`, '**/next-env.d.ts', '**/*.tsbuildinfo']);
  const prose = (f: string) => /\.md$/i.test(f) && !matchAny(f, project.paths.source);
  return [...files, ...(project.exists(ia) ? [ia] : [])].filter((f) => !isTestFile(project, f) && !prose(f)).sort();
}

const revisions = new WeakMap<Project, string>();

/** A content hash of revisionInputs: the revision a run tests. Read once per project. */
export function revisionOf(project: Project): string {
  let rev = revisions.get(project);
  if (rev === undefined) {
    rev = hashText(revisionInputs(project).map((f) => `${f}\0${hashFile(project.abs(f)) ?? 'missing'}`).join('\n'));
    revisions.set(project, rev);
  }
  return rev;
}

/** Application, test and runner inputs, excluding local outputs and prose. */
export function testInputRevision(project: Project): string {
  const inputs = new Set([...revisionInputs(project), ...project.files(['**'], ['.fwos/**', `${project.paths.docs}/**`, ...project.paths.results, '**/next-env.d.ts', '**/*.tsbuildinfo']).filter((file) => !/\.md$/i.test(file) || matchAny(file, project.paths.source))]);
  return hashText([...inputs].sort().map((file) => `${file}\0${hashFile(project.abs(file)) ?? 'missing'}`).join('\n'));
}

/** Exact result bytes, with no text normalization. */
export function resultDigest(project: Project, file: string): string | null {
  try { return createHash('sha256').update(readFileSync(project.abs(file))).digest('hex'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

/** A file name for any target: letters, digits, `.`, `+` and `-` stay; every other character becomes `_` and its hex code. */
const fileName = (target: string) => target.replace(/[^a-z0-9.+-]/gi, (c) => `_${c.charCodeAt(0).toString(16).padStart(2, '0')}`);

export function runPath(kind: RunKind, target: string): string {
  return `${RUNS_DIR}/${kind}/${fileName(target)}.json`;
}

export function writeRun(project: Project, record: RunRecord): string {
  const rel = runPath(record.kind, record.target);
  writeJson(project.abs(rel), record);
  return rel;
}

/** Why `v` isn't a record of `kind` that fwos wrote, or null when it is one. */
function notARecord(v: unknown, kind: RunKind): string | null {
  const errors = validateWith(schema, v);
  if (errors.length > 0) return `not a run record that fwos wrote: ${errors.join('; ')}`;
  return (v as RunRecord).kind === kind ? null : `a ${(v as RunRecord).kind} run record in the ${kind} folder`;
}

/** Every record of one kind, by target. A file that isn't a record is an error, named by file, never read as one. */
export function readRuns<T = unknown>(project: Project, kind: RunKind): { records: RunRecord<T>[]; errors: { file: string; message: string }[] } {
  const dir = `${RUNS_DIR}/${kind}`;
  let names: string[];
  try {
    names = readdirSync(project.abs(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return { records: [], errors: [] };
  }
  const records: RunRecord<T>[] = [];
  const errors: { file: string; message: string }[] = [];
  for (const name of names) {
    const file = `${dir}/${name}`;
    let data: unknown;
    try {
      data = JSON.parse(readText(join(project.root, file)) ?? '');
    } catch (e) {
      errors.push({ file, message: `not valid JSON (${(e as Error).message})` });
      continue;
    }
    const why = notARecord(data, kind);
    if (why) errors.push({ file, message: why });
    else records.push(data as RunRecord<T>);
  }
  return { records: records.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0)), errors };
}

export type Freshness = { fresh: true } | { fresh: false; why: string };

/** Whether a harness record still proves anything: it ran on the current revision, with this fwos version's harness. */
export function runFreshness(project: Project, record: RunRecord, harness: Harness): Freshness {
  if (record.harness?.sha !== hashText(harness.content)) return { fresh: false, why: "a harness other than this fwos version's recorded it" };
  return revisionFreshness(project, record, 'the harness');
}

/** Whether a record ran on the current revision: all a run of the team's own tests needs, since no harness of fwos's recorded it. */
export function revisionFreshness(project: Project, record: RunRecord, what = 'it'): Freshness {
  if (record.revision === null) return { fresh: false, why: `the code changed while ${what} ran` };
  if (record.revision !== revisionOf(project)) return { fresh: false, why: `the code changed since ${what} ran` };
  return { fresh: true };
}

/** Whether the app holds fwos's harness: absent, current (what fwos ships), or edited (anything else, another fwos version's included). */
export function harnessStatus(project: Project, harness: Harness): 'absent' | 'current' | 'edited' {
  const text = project.read(harness.file);
  if (text === null) return 'absent';
  return hashText(text) === hashText(harness.content) ? 'current' : 'edited';
}

/** A team's result evidence is current only while inputs and exact produced bytes still match. */
export function testRunFreshness(project: Project, record: RunRecord<{ mapped: boolean; results: string[] }>, inputs = testInputRevision(project)): Freshness {
  const revision = revisionFreshness(project, record);
  if (!revision.fresh) return revision;
  if (record.config.evidence !== 'inputs-and-results-v1' || record.config.testInputs !== inputs) return { fresh: false, why: 'test inputs changed or this run has no current input binding; run `fwos tests run`' };
  const observed = record.observations;
  if (!observed || observed.mapped !== true || !Array.isArray(observed.results) || observed.results.length === 0 || observed.results.some((file) => typeof file !== 'string' || !record.config[`result:${file}`] || resultDigest(project, file) !== record.config[`result:${file}`])) return { fresh: false, why: 'result bytes changed or were not produced by this run; run `fwos tests run`' };
  return { fresh: true };
}

/** Shared evidence filter: modules may read current test results without depending on tests. */
export function currentTestResults(project: Project): Set<string> {
  const inputs = testInputRevision(project);
  return new Set(readRuns<{ mapped: boolean; results: string[] }>(project, 'tests').records.filter((record) => testRunFreshness(project, record, inputs).fresh).flatMap((record) => record.observations.results));
}
