// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// How a team reviews and ships a change, read from its repository: the prefixes its branches are
// named with, its pull request template and its CODEOWNERS. Read-only and cheap: fixed paths and one
// git call, so `fwos change new` and `fwos next` can fit a change to it.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { isFile } from './files.ts';
import type { Workflow } from './inventory.ts';
import { CODEOWNERS_FILES } from './owners.ts';

/** Where GitHub looks for a pull request template. */
export const PR_TEMPLATES = ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md', 'pull_request_template.md', 'PULL_REQUEST_TEMPLATE.md', 'docs/pull_request_template.md', 'docs/PULL_REQUEST_TEMPLATE.md'];

/** Branches a repository keeps for good: never a sign of how a change's branch is named. */
const LONG_LIVED = new Set(['HEAD', 'main', 'master', 'develop', 'development', 'dev', 'trunk', 'staging', 'production', 'release', 'gh-pages']);

/**
 * The `<prefix>/<name>` convention of the branches git has (local and remote): the prefixes, most
 * used first, and those branches, when at least two and half of the others use one.
 */
export function branchConvention(root: string): { prefixes: string[]; names: string[] } {
  let refs: string[];
  try {
    refs = execFileSync('git', ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n').filter(Boolean);
  } catch {
    return { prefixes: [], names: [] };
  }
  const names = [...new Set(refs.map((r) => r.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/[^/]+\//, '')))].filter((n) => !LONG_LIVED.has(n));
  const prefixed = names.filter((n) => /^[\w.-]+\/./.test(n));
  if (prefixed.length < 2 || prefixed.length * 2 < names.length) return { prefixes: [], names: [] };
  const counts = new Map<string, number>();
  for (const n of prefixed) counts.set(n.split('/')[0]!, (counts.get(n.split('/')[0]!) ?? 0) + 1);
  const prefixes = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([p]) => p);
  const rank = (n: string) => prefixes.indexOf(n.split('/')[0]!);
  return { prefixes, names: prefixed.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1)) };
}

export function readWorkflow(root: string): Workflow {
  return {
    branchPrefixes: branchConvention(root).prefixes,
    template: PR_TEMPLATES.find((f) => isFile(join(root, f))) ?? null,
    codeowners: CODEOWNERS_FILES.find((f) => isFile(join(root, f))) ?? null,
  };
}

/** The prefixes a change's kind of work goes under, by how teams usually spell them. */
const KINDS: Record<'feat' | 'fix', string[]> = { feat: ['feat', 'feature', 'features'], fix: ['fix', 'bugfix', 'hotfix', 'bug'] };

/**
 * The branch for a change, named as the team names theirs: its prefix for that kind of work, or its
 * only prefix. Null when the team has no convention, or several prefixes and none for the work.
 */
export function branchFor(w: Workflow, kind: 'feat' | 'fix', slug: string): string | null {
  const prefix = KINDS[kind].find((k) => w.branchPrefixes.includes(k)) ?? (w.branchPrefixes.length === 1 ? w.branchPrefixes[0] : undefined);
  return prefix ? `${prefix}/${slug}` : null;
}
