// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadProject, writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { changedFiles, sliceDrift, type SliceManifest } from '../index.ts';

afterAll(cleanupTempProjects);

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

const manifest: SliceManifest = { schema: 1, slice: 'S1', change: '0001-initial', title: 'x', platform: 'web', modules: ['list'], acs: [] };

describe('changedFiles and drift against git', () => {
  it('refuses a base that is not a commit', () => {
    const repo = tempProject({ 'a.txt': 'a' });
    git(repo, 'init', '-q');
    expect(() => changedFiles(repo, 'HEAD')).toThrow(/isn't a commit/);
  });

  it('reports project-relative paths when the project sits inside a bigger repo', () => {
    const repo = tempProject({
      'app/docs/app/modules.json': { schema: 1, modules: [{ name: 'list', path: 'apps/web/src/features/list', dependsOn: [] }] },
      'app/package.json': { name: 'app', dependencies: { next: '1' } },
      'app/apps/web/src/features/list/index.ts': 'export {};',
    });
    git(repo, 'init', '-q');
    git(repo, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.');
    git(repo, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'skeleton');
    const base = git(repo, 'rev-parse', 'HEAD');
    const root = join(repo, 'app');
    writeText(join(root, 'apps/web/src/features/list/view.tsx'), 'export {};');
    writeText(join(root, 'apps/web/src/main.tsx'), 'export {};');
    writeText(join(root, 'package.json'), JSON.stringify({ name: 'app', dependencies: { next: '1', 'left-pad': '1' } }));
    git(repo, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qam', 'slice');
    const changed = changedFiles(root, base);
    expect(changed).toEqual(['apps/web/src/features/list/view.tsx', 'apps/web/src/main.tsx', 'package.json']);
    const drift = sliceDrift(loadProject(root), manifest, changed, base);
    expect(drift.outside).toEqual([{ file: 'apps/web/src/main.tsx', module: null }]);
    expect(drift.newDependencies).toEqual(['left-pad']);
    expect(drift.undecided).toEqual(['left-pad']);
  });
});
