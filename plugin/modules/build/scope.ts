// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Building in place: an adopted app's change edits what it maps (`fwos change map`), the routes,
// components and data it was grounded in. An existing file of the app's source it edits outside
// that is drift: map it too and have the spec approved again, or make it a change of its own. The
// files it adds are its own, and tests, docs and configs aren't the app's source.

import { execFileSync } from 'node:child_process';
import { type Project, isTestFile, matchAny } from '../../kernel/index.ts';
import type { Change } from '../state/index.ts';
import { changedFiles } from './slices.ts';

export interface ChangeDrift {
  /** Existing source files the change edited that its map doesn't cover. */
  outside: string[];
  /** Existing source files it edited inside its map. */
  edited: string[];
  /** Source files it added. */
  added: string[];
}

/**
 * What a mapped change edited since it began (committed on its branch, staged or not, and new),
 * sorted against its map. Null when it isn't mapped, began outside git, or git can't say.
 */
export function changeDrift(project: Project, change: Pick<Change, 'map' | 'head'>): ChangeDrift | null {
  if (!change.map || !change.head) return null;
  let touched: string[];
  let before: Set<string>;
  try {
    touched = changedFiles(project.root, change.head);
    const tree = execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', change.head], { cwd: project.root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
    before = new Set(tree.toString().split('\0').filter(Boolean));
  } catch {
    return null;
  }
  const mapped = new Set(change.map.files);
  const out: ChangeDrift = { outside: [], edited: [], added: [] };
  for (const f of touched) {
    if (!matchAny(f, project.paths.source) || matchAny(f, project.paths.ignore) || isTestFile(project, f)) continue;
    if (!before.has(f)) out.added.push(f);
    else if (mapped.has(f)) out.edited.push(f);
    else out.outside.push(f);
  }
  return out;
}
