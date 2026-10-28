// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Who owns a file, from the repository's CODEOWNERS, read the way GitHub reads it: the first file
// found of .github/CODEOWNERS, CODEOWNERS and docs/CODEOWNERS, and for each path the last line that
// matches. Patterns follow gitignore: a leading or inner slash anchors at the root, a name with no
// slash matches at any depth, and a folder matches everything in it.

import { join } from 'node:path';
import { readText } from './files.ts';
import { matchGlob } from './glob.ts';

export const CODEOWNERS_FILES = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

interface Rule {
  glob: string;
  owners: string[];
}

function rules(text: string): Rule[] {
  const out: Rule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    let p = pattern!;
    const anchored = p.startsWith('/') || p.replace(/\/$/, '').includes('/');
    p = p.replace(/^\//, '').replace(/\/$/, '');
    if (p === '*' || p === '**') p = '**';
    else if (!anchored) p = `**/${p}`;
    out.push({ glob: p, owners });
  }
  return out;
}

/** The owners of `files` (paths relative to `root`), each once in the order they appear, and the CODEOWNERS file they came from. */
export function codeOwners(root: string, files: string[]): { file: string | null; owners: string[] } {
  const file = CODEOWNERS_FILES.find((f) => readText(join(root, f)) !== null) ?? null;
  if (!file) return { file: null, owners: [] };
  const all = rules(readText(join(root, file)) ?? '');
  const owners: string[] = [];
  for (const f of files) {
    const rule = all.findLast((r) => matchGlob(f, r.glob) || matchGlob(f, `${r.glob}/**`));
    for (const o of rule?.owners ?? []) if (!owners.includes(o)) owners.push(o);
  }
  return { file, owners };
}
