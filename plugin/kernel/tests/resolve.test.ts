// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { afterAll, describe, expect, it } from 'vitest';
import { Resolver, readWorkspace } from '../index.ts';
import { cleanupTempProjects, tempProject } from '../testing.ts';

afterAll(cleanupTempProjects);

describe('Resolver', () => {
  const root = tempProject({
    'apps/web/tsconfig.json': { compilerOptions: { paths: { '@/*': ['./src/*'], '~/*': ['./src/*'] } } },
    'apps/web/src/shared/ui/index.ts': "export { Button } from './button';\n",
    'apps/web/src/shared/ui/button.tsx': 'export const Button = () => null;\n',
    'apps/admin/tsconfig.json': { compilerOptions: { baseUrl: 'src' } },
    'apps/admin/src/shared/ui/button.tsx': 'export const Button = () => null;\n',
  });
  const r = new Resolver(root);
  const from = 'apps/web/src/features/a/view.tsx';

  it.each([
    ['~/shared/ui/button', 'apps/web/src/shared/ui/button.tsx'],
    ['@/shared/ui/./button', 'apps/web/src/shared/ui/button.tsx'],
    ['@/shared//ui/button', 'apps/web/src/shared/ui/button.tsx'],
    ['@/shared/ui/', 'apps/web/src/shared/ui/index.ts'],
    ['@/shared/ui', 'apps/web/src/shared/ui/index.ts'],
    ['../../shared/ui/', 'apps/web/src/shared/ui/index.ts'],
    ['@/shared/ui/button?raw', 'apps/web/src/shared/ui/button.tsx'],
  ])('resolves %s to the file TypeScript would', (spec, path) => {
    expect(r.resolve(from, spec)).toEqual({ kind: 'file', path, exists: true });
  });

  it('resolves a declaration file, a .js that stands for one, and a path with a bundler query', () => {
    const d = new Resolver(tempProject({ 'src/types.d.ts': '', 'src/legacy.d.ts': '', 'src/notes.md': '', 'src/shapes/index.d.ts': '' }));
    expect(d.resolve('src/a.ts', './types')).toEqual({ kind: 'file', path: 'src/types.d.ts', exists: true });
    expect(d.resolve('src/a.ts', './legacy.js')).toEqual({ kind: 'file', path: 'src/legacy.d.ts', exists: true });
    expect(d.resolve('src/a.ts', './shapes')).toEqual({ kind: 'file', path: 'src/shapes/index.d.ts', exists: true });
    expect(d.resolve('src/a.ts', './notes.md?raw')).toEqual({ kind: 'file', path: 'src/notes.md', exists: true });
    expect(d.resolve('src/a.ts', './gone')).toEqual({ kind: 'file', path: 'src/gone', exists: false });
  });

  it('resolves a .jsx that stands for a .tsx, and a folder through its package.json', () => {
    const d = new Resolver(
      tempProject({
        'src/components/item-row.tsx': '',
        'src/vendored/package.json': { name: 'vendored', types: 'lib/index.d.ts', main: 'lib/index.js' },
        'src/vendored/lib/index.d.ts': '',
        'src/plain/package.json': { main: './dist/main' },
        'src/plain/dist/main.js': '',
        'src/self/package.json': { main: '.' },
        'src/self/index.ts': '',
      }),
    );
    expect(d.resolve('src/a.ts', './components/item-row.jsx')).toEqual({ kind: 'file', path: 'src/components/item-row.tsx', exists: true });
    expect(d.resolve('src/a.ts', './vendored')).toEqual({ kind: 'file', path: 'src/vendored/lib/index.d.ts', exists: true });
    expect(d.resolve('src/a.ts', './plain')).toEqual({ kind: 'file', path: 'src/plain/dist/main.js', exists: true });
    expect(d.resolve('src/a.ts', './self')).toEqual({ kind: 'file', path: 'src/self/index.ts', exists: true });
  });

  it('names the workspace package an import reaches a file through', () => {
    const ws = new Resolver(
      tempProject({
        'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
        'packages/server/package.json': { name: '@example-org/server', main: 'src/index.ts' },
        'packages/server/src/index.ts': '',
        'packages/server/src/db.ts': '',
      }),
    );
    expect(ws.resolve('apps/web/src/a.ts', '@example-org/server')).toEqual({ kind: 'file', path: 'packages/server/src/index.ts', exists: true, package: '@example-org/server' });
    expect(ws.resolve('apps/web/src/a.ts', '@example-org/server/src/db')).toEqual({ kind: 'file', path: 'packages/server/src/db.ts', exists: true, package: '@example-org/server' });
  });

  it('resolves a bare path through baseUrl', () => {
    expect(r.resolve('apps/admin/src/app/page.tsx', 'shared/ui/button')).toEqual({ kind: 'file', path: 'apps/admin/src/shared/ui/button.tsx', exists: true });
  });

  it('reads workspace folders from package.json and pnpm-workspace.yaml', () => {
    const npm = tempProject({
      'package.json': { workspaces: ['apps/*', 'libs/*'] },
      'apps/web/package.json': { name: 'web' },
      'libs/ui/package.json': { name: 'ui' },
      'tools/x/package.json': { name: 'x' },
    });
    expect(Object.fromEntries(readWorkspace(npm))).toEqual({ web: 'apps/web', ui: 'libs/ui' });
    const pnpm = tempProject({ 'pnpm-workspace.yaml': "packages:\n  - 'libs/*'\n", 'libs/ui/package.json': { name: 'ui' } });
    expect(Object.fromEntries(readWorkspace(pnpm))).toEqual({ ui: 'libs/ui' });
  });

  it('skips a workspace package.json that is not valid JSON, and keeps the rest', () => {
    const broken = tempProject({
      'package.json': '{ "workspaces": ["libs/*"], ',
      'pnpm-workspace.yaml': "packages:\n  - 'libs/*'\n",
      'libs/ui/package.json': { name: 'ui' },
      'libs/bad/package.json': '{ "name": "bad",',
    });
    expect(Object.fromEntries(readWorkspace(broken))).toEqual({ ui: 'libs/ui' });
  });
});
