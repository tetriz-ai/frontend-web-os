// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// `fwos prototype`: check each prototype bundle in docs/app/prototypes/, promote one once nothing
// stops it and its inputs are committed (each pinned by hash in .fwos/prototypes.json), and compare
// its intended IA with the real app's routes and fresh runs of fwos's IA harness.

import { execFileSync } from 'node:child_process';
import { type AppScreens, FwosError, type IaRun, type Project, harnessStatus, readRuns, runFreshness, writeJson } from '../../kernel/index.ts';
import {
  type AppDiff,
  type BundleCheck,
  type BundleFile,
  PROMOTIONS,
  type Promotion,
  checkBundle,
  compareWithApp,
  isIaRun,
  listBundles,
  parseIa,
  prototypesDir,
} from '../../modules/screens/index.ts';
import { now } from '../../modules/state/index.ts';
import { profilesFor } from './registry.ts';

interface Promotions {
  schema: 1;
  bundles: Record<string, Promotion>;
}

/** The promotions on record, by bundle ID. */
export function readPromotions(p: Project): Record<string, Promotion> {
  const text = p.read(PROMOTIONS);
  if (text === null) return {};
  try {
    const data = JSON.parse(text) as Promotions;
    if (data.schema === 1 && data.bundles && typeof data.bundles === 'object') return data.bundles;
  } catch {
    // Said below.
  }
  throw new FwosError(`${PROMOTIONS} isn't a record of promotions that fwos wrote.`, 'Restore it from git (`git checkout -- .fwos/prototypes.json`).');
}

/** The app as the project's first screen adapter reads it, and the fresh runs of that platform's IA harness. */
function appOf(p: Project): { app: AppScreens | null; runs: IaRun[] } {
  for (const profile of profilesFor(p)) {
    const app = profile.screens?.listScreens(p);
    if (!app) continue;
    const harness = profile.verify?.harness?.(p).find((h) => h.kind === 'ia');
    const runs =
      harness && harnessStatus(p, harness) === 'current'
        ? readRuns(p, 'ia')
            .records.filter((r) => runFreshness(p, r, harness).fresh && isIaRun(r.observations))
            .map((r) => r.observations as IaRun)
        : [];
    return { app, runs };
  }
  return { app: null, runs: [] };
}

/** Every bundle in the project, each with what stops it being promoted and whether its promotion still holds. */
export function checkBundles(p: Project): BundleCheck[] {
  const bundles = listBundles(p);
  if (bundles.length === 0) return [];
  const { app } = appOf(p);
  const promotions = readPromotions(p);
  return bundles.map((file) => checkBundle(p, file, { app, bundles, promotions }));
}

function find(p: Project, id: string): BundleFile {
  const file = listBundles(p).find((b) => (b.bundle?.id ?? b.folder) === id || b.folder === id);
  if (!file) throw new FwosError(`No prototype bundle "${id}".`, `\`fwos prototype check\` lists them; each is ${prototypesDir(p)}/<id>/bundle.json.`);
  return file;
}

/** The local files among a promotion's inputs that git doesn't hold as they are now: untracked, ignored or changed. */
function uncommitted(p: Project, files: string[]): string[] {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: p.root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  try {
    git('rev-parse', '--is-inside-work-tree');
  } catch {
    throw new FwosError("This project isn't in a git repository, so fwos can't tell its inputs are committed.", 'Commit the bundle and what it links, then promote it.');
  }
  const tracked = new Set(git('ls-files', '--', ...files).split('\n').filter(Boolean));
  const changed = new Set(git('status', '--porcelain', '--untracked-files=all', '--', ...files).split('\n').filter(Boolean).map((l) => l.slice(3)));
  return files.filter((f) => !tracked.has(f) || changed.has(f));
}

/** Promotes bundle `id`: refuses while anything stops it or an input isn't committed, then pins each input by hash. */
export function promote(p: Project, id: string, by: string): { id: string; inputs: number } {
  const file = find(p, id);
  const bundles = listBundles(p);
  const promotions = readPromotions(p);
  const check = checkBundle(p, file, { app: appOf(p).app, bundles, promotions });
  if (check.problems.length > 0) throw new FwosError(`${check.id} can't be promoted:\n${check.problems.map((x) => `  ${x}`).join('\n')}`, 'Fix each, commit, and promote it again.');
  const files = [...new Set(Object.keys(check.inputs).map((ref) => ref.split('#')[0]!))].sort();
  const loose = uncommitted(p, files);
  if (loose.length > 0) throw new FwosError(`${check.id} rests on files git doesn't hold as they are: commit these first: ${loose.join(', ')}`, 'A promoted bundle is the committed one, so anyone can check it out.');
  const record: Promotions = { schema: 1, bundles: { ...promotions, [check.id]: { bundle: file.path, at: now(), by, inputs: check.inputs } } };
  writeJson(p.abs(PROMOTIONS), record);
  return { id: check.id, inputs: Object.keys(check.inputs).length };
}

/** Bundle `id`'s intended IA against the real app. */
export function prototypeDiff(p: Project, id: string): { id: string } & AppDiff {
  const file = find(p, id);
  if (!file.bundle) throw new FwosError(`${file.path} isn't a bundle fwos reads: ${file.errors.join('; ')}`);
  const text = p.read(file.bundle.ia.split('#')[0]!);
  const parsed = text === null ? null : parseIa(text);
  if (!parsed?.ia || parsed.errors.length > 0) {
    throw new FwosError(`${file.bundle.ia} ${text === null ? "doesn't exist" : 'has errors'}, so there's no intended IA to compare.`, `fwos prototype check ${id}`);
  }
  const { app, runs } = appOf(p);
  return { id: file.bundle.id, ...compareWithApp(parsed.ia, { routes: app?.screens ?? [], runs }) };
}
