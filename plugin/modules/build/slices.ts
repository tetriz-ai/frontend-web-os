// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Slices: what each slice built (the manifest) and whether the diff stayed inside it (drift).

import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { FwosError, type Project, matchAny, validateWith } from '../../kernel/index.ts';
import { loadModuleMap, ownerOf } from '../architecture/index.ts';
import schema from './schema/slice.schema.json' with { type: 'json' };

export interface SliceManifest {
  schema: 1;
  slice: string;
  change: string;
  title: string;
  platform: 'web' | 'electron' | 'mac';
  modules: string[];
  screens?: string[];
  components?: string[];
  states?: string[];
  acs: string[];
  dependsOn?: string[];
  status?: 'planned' | 'in-progress' | 'done';
}

export const SLICES_GLOB = '.fwos/slices/**/*.json';

export function loadSlices(project: Project): { path: string; manifest: SliceManifest | null; errors: string[] }[] {
  return project.files([SLICES_GLOB]).map((path) => {
    let data: unknown;
    try {
      data = JSON.parse(project.read(path) ?? '');
    } catch (e) {
      return { path, manifest: null, errors: [`not valid JSON: ${(e as Error).message}`] };
    }
    const errors = validateWith(schema, data);
    return { path, manifest: errors.length === 0 ? (data as SliceManifest) : null, errors };
  });
}

/** Paths a slice may always touch, whatever its modules: fwos state, docs, the design system, lockfiles, package.json. */
const alwaysOk = (p: Project) => ['.fwos/**', `${p.paths.docs}/**`, `${p.paths.designSystem}/**`, '**/pnpm-lock.yaml', '**/package-lock.json', '**/yarn.lock', '**/package.json'];

export interface Drift {
  outside: { file: string; module: string | null }[];
  newDependencies: string[];
  undecided: string[];
}

/**
 * Files the slice changed outside its declared modules, and dependencies it added. A new dependency
 * needs a decision row in decisions.md (and a registry check).
 */
export function sliceDrift(project: Project, manifest: SliceManifest, changed: string[], base?: string): Drift {
  const map = loadModuleMap(project.abs(posix.join(project.paths.docs, 'modules.json')));
  const modules = map?.modules ?? [];
  const outside: Drift['outside'] = [];
  const ok = alwaysOk(project);
  for (const file of changed) {
    if (matchAny(file, ok)) continue;
    const owner = ownerOf(modules, file);
    if (owner && manifest.modules.includes(owner.name)) continue;
    outside.push({ file, module: owner?.name ?? null });
  }
  const newDependencies = base ? addedDependencies(project, changed, base) : [];
  const decisions = project.read(posix.join(project.paths.docs, 'decisions.md')) ?? '';
  const undecided = newDependencies.filter((d) => !decisions.includes(d));
  return { outside, newDependencies, undecided };
}

function addedDependencies(project: Project, changed: string[], base: string): string[] {
  const added = new Set<string>();
  for (const file of changed.filter((f) => /(^|\/)package\.json$/.test(f))) {
    const now = safeJson(project.read(file));
    let before: Record<string, unknown> | null = null;
    try {
      // `./` makes the path relative to the project folder, which may sit inside a bigger repo.
      before = safeJson(execFileSync('git', ['show', `${base}:./${file}`], { cwd: project.root, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
    } catch {
      before = {};
    }
    const deps = (pkg: Record<string, unknown> | null) =>
      new Set(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((k) => Object.keys((pkg?.[k] as object) ?? {})));
    const old = deps(before);
    for (const d of deps(now)) if (!old.has(d)) added.add(d);
  }
  return [...added].sort();
}

function safeJson(text: string | null): Record<string, unknown> | null {
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Files changed since `base` (committed, staged and unstaged, plus untracked), relative to the
 * project folder even when it sits inside a bigger repo. `base` must be a real commit: the one
 * before the slice started.
 */
export function changedFiles(root: string, base: string): string[] {
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  try {
    git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  } catch {
    throw new FwosError(
      `"${base}" isn't a commit in this repository.`,
      'Commit the walking skeleton first, then pass the commit before the slice started: `fwos slice drift S1 --base <commit>`.',
    );
  }
  const lines = (args: string[]) => git(args).split('\0').filter(Boolean);
  return [
    ...new Set([
      ...lines(['diff', '-z', '--no-renames', '--name-only', '--relative', `${base}...HEAD`]),
      ...lines(['diff', '-z', '--no-renames', '--name-only', '--relative', 'HEAD']),
      ...lines(['ls-files', '-z', '--others', '--exclude-standard']),
    ]),
  ].sort();
}
