// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// What the CLI asks git and the repo's own tooling: where the commit hook goes, and which lines of a
// workflow run fwos. Shared by `fwos git-hook`, `fwos eject` and the adoption capabilities.

import { execFileSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { type Project, readText, walkFiles } from '../../kernel/index.ts';

/**
 * Where git runs this repository's pre-commit hook, as git itself says: core.hooksPath when it is
 * set, the main repository's hooks from a linked worktree, else .git/hooks. With the top of the
 * working tree, and `shared` naming the config scope when core.hooksPath comes from global or
 * system config, a folder every repository on the machine uses. Null outside a repository.
 */
export function commitHookPath(root: string): { path: string; top: string; shared?: string } | null {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  let hook: { path: string; top: string; shared?: string };
  try {
    hook = { path: join(resolve(root, git('rev-parse', '--git-path', 'hooks')), 'pre-commit'), top: git('rev-parse', '--show-toplevel') };
  } catch {
    return null;
  }
  try {
    const scope = git('config', '--show-scope', '--get', 'core.hooksPath').split('\t')[0];
    if (scope === 'global' || scope === 'system') hook.shared = scope;
  } catch {
    // core.hooksPath isn't set
  }
  return hook;
}

/** A path as the project names it: relative to its root when inside it, else as is. */
export const fromRoot = (p: Project, path: string) => {
  const rel = relative(p.root, path);
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel.split(sep).join('/');
};

export const WORKFLOWS = '.github/workflows';

/** A command that runs fwos: `fwos check`, `pnpm exec fwos check`, `a && npx fwos tokens build`. */
export const runsFwos = (command: string) => /(^|[\s;&|(`'"/])fwos\s+\S/.test(command);

/** The lines of a workflow that run fwos, trimmed. A comment runs nothing. */
export const fwosLines = (lines: string[]) => lines.map((l) => l.trim()).filter((l) => !l.startsWith('#') && runsFwos(l));

/** The project's GitHub workflows, as paths from its root. */
export const workflows = (p: Project) => walkFiles(p.abs(WORKFLOWS), { include: ['*.{yml,yaml}'] }).map((f) => `${WORKFLOWS}/${f}`);

/** Whether the commit check runs before each commit: fwos's own hook, or a line in husky or lefthook. */
export function commitCheckInstalled(p: Project): string | null {
  const hook = commitHookPath(p.root);
  if (hook && readText(hook.path)?.includes('fwos commit check')) return fromRoot(p, hook.path);
  for (const file of ['.husky/pre-commit', 'lefthook.yml', 'lefthook.yaml']) {
    if (fwosLines((p.read(file) ?? '').split('\n')).length > 0) return file;
  }
  return null;
}
