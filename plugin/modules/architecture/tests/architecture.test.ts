// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type PlatformProfile, loadProject, writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, contextFor, tempProject } from '../../../kernel/testing.ts';
import { checks, extractImports, extractPromptRefs, findCycles, Resolver, runWalls, validateModuleMap } from '../index.ts';

afterAll(cleanupTempProjects);

const specs = (src: string) => extractImports(src).map((i) => `${i.kind}:${i.spec}${i.typeOnly ? ':type' : ''}`);

describe('extractImports', () => {
  it('finds every import form', () => {
    const src = `
      import a from './a';
      import { b, c as d } from "./b";
      import * as e from './e';
      import type { F } from './f';
      import g, { h } from './g';
      import './side.css';
      export * from './re';
      export { x } from './rx';
      export type { T } from './rt';
      const lazy = await import('./lazy');
      const req = require('./req');
      import {
        multi,
        line,
      } from './multi';
    `;
    expect(specs(src)).toEqual([
      'static:./a',
      'static:./b',
      'static:./e',
      'static:./f:type',
      'static:./g',
      'side-effect:./side.css',
      're-export:./re',
      're-export:./rx',
      're-export:./rt:type',
      'dynamic:./lazy',
      'require:./req',
      'static:./multi',
    ]);
  });

  it('ignores imports in comments, strings, templates and regexes', () => {
    const src = `
      // import x from './commented';
      /* import y from './block'; */
      const s = "import z from './string'";
      const t = \`import w from './template' \${1 + 2}\`;
      const r = /import v from '.\\/regex'/;
      const ratio = a / b; import real from './real';
      const meta = import.meta.url;
      export { local };
      export default thing;
    `;
    expect(specs(src)).toEqual(['static:./real']);
  });

  it('keeps line numbers', () => {
    expect(extractImports('\n\nimport a from "./a";')[0]!.line).toBe(3);
  });

  it('survives stray quotes in JSX text', () => {
    const src = `import a from './a';\nconst el = <p>Don't panic</p>;\nimport b from './b';`;
    expect(specs(src)).toEqual(['static:./a', 'static:./b']);
  });

  it('reads plugin-root references in prompts', () => {
    expect(extractPromptRefs('See ${CLAUDE_PLUGIN_ROOT}/modules/rules/knowledge/states.md.')).toEqual([
      { spec: 'modules/rules/knowledge/states.md', line: 1 },
    ]);
  });
});

describe('Resolver', () => {
  const root = tempProject({
    'apps/web/tsconfig.json': '{ // comment\n "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
    'apps/web/src/features/list/index.ts': '',
    'apps/web/src/features/list/item.tsx': '',
    'apps/web/src/shared/ui/button.tsx': '',
    'pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n  - "packages/*"\n',
    'packages/contract/package.json': '{ "name": "@app/contract", "main": "src/index.ts" }',
    'packages/contract/src/index.ts': '',
    'packages/contract/src/types.ts': '',
    'lib/esm.ts': '',
  });
  const r = new Resolver(root);

  it.each([
    ['apps/web/src/features/list/item.tsx', './index', 'apps/web/src/features/list/index.ts'],
    ['apps/web/src/features/list/item.tsx', '.', 'apps/web/src/features/list/index.ts'],
    ['apps/web/src/app.tsx', '@/features/list', 'apps/web/src/features/list/index.ts'],
    ['apps/web/src/app.tsx', '@/shared/ui/button', 'apps/web/src/shared/ui/button.tsx'],
    ['apps/web/src/app.tsx', '@app/contract', 'packages/contract/src/index.ts'],
    ['apps/web/src/app.tsx', '@app/contract/src/types', 'packages/contract/src/types.ts'],
    ['lib/a.ts', './esm.js', 'lib/esm.ts'],
  ])('%s imports %s', (from, spec, expected) => {
    expect(r.resolve(from, spec)).toMatchObject({ kind: 'file', path: expected, exists: true });
  });

  it('treats a declared or installed name as a package, and anything else as unresolved', () => {
    const pkgs = tempProject({
      'package.json': { dependencies: { next: '1' }, devDependencies: { vitest: '1' } },
      'apps/web/package.json': { peerDependencies: { react: '1' } },
      'node_modules/@tanstack/react-query/package.json': {},
      'node_modules/@types/estree/package.json': {},
      'node_modules/@types/babel__core/package.json': {},
    });
    const p = new Resolver(pkgs);
    expect(p.resolve('apps/web/src/a.ts', 'next/link')).toEqual({ kind: 'package', name: 'next' });
    expect(p.resolve('apps/web/src/a.ts', 'react')).toEqual({ kind: 'package', name: 'react' });
    expect(p.resolve('apps/web/src/a.ts', '@tanstack/react-query')).toEqual({ kind: 'package', name: '@tanstack/react-query' });
    expect(p.resolve('apps/web/src/a.ts', 'estree')).toEqual({ kind: 'package', name: 'estree' });
    expect(p.resolve('apps/web/src/a.ts', '@babel/core')).toEqual({ kind: 'package', name: '@babel/core' });
    expect(p.resolve('apps/web/src/a.ts', 'node:fs/promises')).toEqual({ kind: 'package', name: 'node:fs' });
    expect(p.resolve('apps/web/src/a.ts', 'path')).toEqual({ kind: 'package', name: 'path' });
    expect(p.resolve('apps/web/src/a.ts', 'virtual:pwa-register')).toEqual({ kind: 'package', name: 'virtual:pwa-register' });
    expect(p.resolve('apps/web/src/a.ts', 'zod')).toMatchObject({ kind: 'unresolved', name: 'zod' });
    // react is declared by apps/web, not by the root, so the root's own code can't rely on it.
    expect(p.resolve('scripts/a.ts', 'react')).toMatchObject({ kind: 'unresolved', name: 'react' });
  });

  it('resolves subpath imports (#name) through the nearest package.json', () => {
    const sub = tempProject({
      'apps/web/package.json': { imports: { '#db': { node: './src/db/node.ts', default: './src/db/index.ts' }, '#lib/*': './src/lib/*.ts' } },
      'apps/web/src/db/node.ts': '',
      'apps/web/src/lib/date.ts': '',
    });
    const s = new Resolver(sub);
    expect(s.resolve('apps/web/src/a.ts', '#db')).toMatchObject({ kind: 'file', path: 'apps/web/src/db/node.ts', exists: true });
    expect(s.resolve('apps/web/src/a.ts', '#lib/date')).toMatchObject({ kind: 'file', path: 'apps/web/src/lib/date.ts', exists: true });
    expect(s.resolve('apps/web/src/a.ts', '#nope')).toMatchObject({ kind: 'unresolved', name: '#nope' });
  });

  describe('tsconfig, the way TypeScript reads it', () => {
    const files = { 'apps/web/src/features/auth/internal.ts': '', 'apps/web/wrong/features/auth/internal.ts': '' };
    const at = (tsconfigs: Record<string, object>, spec = '@/features/auth/internal') =>
      new Resolver(tempProject({ ...files, ...tsconfigs })).resolve('apps/web/src/features/list/index.ts', spec);
    const src = { '@/*': ['./src/*'] };
    const wrong = { '@/*': ['./wrong/*'] };

    it('lets a later extends entry win over an earlier one, and the config itself win over both', () => {
      const a = { 'apps/web/a.json': { compilerOptions: { paths: wrong } }, 'apps/web/b.json': { compilerOptions: { paths: src } } };
      expect(at({ ...a, 'apps/web/tsconfig.json': { extends: ['./a.json', './b.json'] } })).toMatchObject({ path: 'apps/web/src/features/auth/internal.ts' });
      expect(at({ ...a, 'apps/web/tsconfig.json': { extends: ['./b.json', './a.json'] } })).toMatchObject({ path: 'apps/web/wrong/features/auth/internal.ts' });
      expect(at({ ...a, 'apps/web/tsconfig.json': { extends: ['./b', './a'], compilerOptions: { paths: src } } })).toMatchObject({
        path: 'apps/web/src/features/auth/internal.ts',
      });
    });

    it('resolves inherited paths against the inherited baseUrl, or the config that set them, or ${configDir}', () => {
      // paths from a parent, baseUrl from the child: the targets are relative to the child's baseUrl.
      expect(
        at({ 'apps/tsconfig.base.json': { compilerOptions: { paths: { '@/*': ['*'] } } }, 'apps/web/tsconfig.json': { extends: '../tsconfig.base.json', compilerOptions: { baseUrl: 'src' } } }),
      ).toMatchObject({ path: 'apps/web/src/features/auth/internal.ts', exists: true });
      // No baseUrl: relative to the config that set them, so a shared config uses ${configDir}.
      expect(at({ 'apps/tsconfig.base.json': { compilerOptions: { paths: { '@/*': ['./web/src/*'] } } }, 'apps/web/tsconfig.json': { extends: '../tsconfig.base.json' } })).toMatchObject({
        path: 'apps/web/src/features/auth/internal.ts',
        exists: true,
      });
      expect(
        at({ 'tsconfig.base.json': { compilerOptions: { paths: { '@/*': ['${configDir}/src/*'] } } }, 'apps/web/tsconfig.json': { extends: '../../tsconfig.base.json' } }),
      ).toMatchObject({ path: 'apps/web/src/features/auth/internal.ts', exists: true });
    });

    it('finds the tsconfig above the project root, as TypeScript would', () => {
      const outer = tempProject({ 'tsconfig.json': { compilerOptions: { paths: { '@/*': ['./app/src/*'] } } }, 'app/src/x.ts': '' });
      expect(new Resolver(join(outer, 'app')).resolve('src/a.ts', '@/x')).toMatchObject({ kind: 'file', path: 'src/x.ts', exists: true });
    });

    it('prefers the longest matching paths pattern', () => {
      expect(at({ 'apps/web/tsconfig.json': { compilerOptions: { paths: { '@/*': ['./wrong/*'], '@/features/*': ['./src/features/*'] } } } })).toMatchObject({
        path: 'apps/web/src/features/auth/internal.ts',
      });
    });

    it('says which extends it could not find', () => {
      const r = at({ 'apps/web/tsconfig.json': { extends: '@repo/tsconfig/next.json' } });
      expect(r).toMatchObject({ kind: 'unresolved', name: '@/features' });
      expect(r.kind === 'unresolved' && r.hint).toMatch(/apps\/web\/tsconfig\.json extends "@repo\/tsconfig\/next\.json", which isn't installed or in the workspace/);
    });
  });
});

describe('modules.json validation', () => {
  it('finds unknown deps, duplicates, shared paths and cycles', () => {
    const errors = validateModuleMap({
      schema: 1,
      modules: [
        { name: 'a', path: 'src/a', dependsOn: ['b'] },
        { name: 'b', path: 'src/b', dependsOn: ['c'] },
        { name: 'c', path: 'src/c', dependsOn: ['a', 'ghost'] },
        { name: 'c', path: 'src/a/', dependsOn: [] },
      ],
    });
    expect(errors).toEqual([
      'module "c" is declared twice',
      'modules "a" and "c" share the path src/a',
      'module "c" depends on unknown module "ghost"',
      'dependency cycle: a -> b -> c -> a',
    ]);
  });

  it('reports schema errors first', () => {
    expect(validateModuleMap({ schema: 1, modules: [{ name: 'A B', path: 'x' }] })).toEqual([
      "/modules/0 must have required property 'dependsOn'",
      '/modules/0/name must match pattern "^[a-z0-9][a-z0-9/_-]*$"',
    ]);
  });

  it('reports each cycle once', () => {
    expect(
      findCycles([
        { name: 'a', path: 'a', dependsOn: ['b'] },
        { name: 'b', path: 'b', dependsOn: ['a'] },
      ]),
    ).toEqual([['a', 'b', 'a']]);
  });
});

const app = {
  'docs/app/modules.json': {
    schema: 1,
    modules: [
      { name: 'app', path: 'apps/web/app', kind: 'app', dependsOn: ['*'] },
      { name: 'reading-list', path: 'apps/web/src/features/reading-list', dependsOn: ['shared-ui'] },
      { name: 'settings', path: 'apps/web/src/features/settings', dependsOn: ['shared-ui'] },
      { name: 'shared-ui', path: 'apps/web/src/shared/ui', dependsOn: [], entry: ['index.ts'] },
      { name: 'features-pkg', path: 'packages/features', dependsOn: [], bannedImports: ['next', 'next/*'] },
    ],
  },
  'apps/web/tsconfig.json': { compilerOptions: { paths: { '@/*': ['./src/*'] } } },
  'apps/web/app/page.tsx': "import { List } from '@/features/reading-list';\nexport default List;",
  'apps/web/src/features/reading-list/index.ts': "export { List } from './list';",
  'apps/web/src/features/reading-list/list.tsx': "import { Button } from '@/shared/ui';\nexport const List = () => Button;",
  'apps/web/src/features/settings/index.ts': 'export const x = 1;',
  'apps/web/src/shared/ui/index.ts': "export { Button } from './button';",
  'apps/web/src/shared/ui/button.tsx': 'export const Button = 1;',
  'packages/features/src/index.ts': "import { useState } from 'react';",
  'package.json': { dependencies: { next: '16.0.0', react: '19.0.0' } },
};

describe('architecture/walls', () => {
  it('passes a clean app', () => {
    const r = runWalls(loadProject(tempProject(app)));
    expect(r.findings).toEqual([]);
    expect(r.status).toBe('pass');
    expect(r.info?.[0]).toMatch(/files, 4 internal imports, 5 modules/);
  });

  it('is off without modules.json', () => {
    expect(runWalls(loadProject(tempProject({}))).status).toBe('off');
  });

  it("is off, naming the modules, when none of them holds a file of the app: there's no wall to check", () => {
    // Another app's modules.json: every import resolves, but no file is in a module it walls.
    const root = tempProject({ ...app, 'docs/app/modules.json': { schema: 1, modules: [{ name: 'billing', path: 'apps/admin/src/billing', dependsOn: [] }, { name: 'ui', path: 'apps/admin/src/ui', dependsOn: [] }] } });
    const r = runWalls(loadProject(root));
    expect(r.status).toBe('off');
    expect(r.reason).toBe("modules.json's 2 modules hold no file yet (apps/admin/src/billing, apps/admin/src/ui), so no wall is checked");
    // An import that resolves to nothing still fails: that is checked across the app, wall or not.
    writeText(join(root, 'apps/web/src/features/settings/index.ts'), "import { gone } from './gone';\nexport const s = gone;\n");
    expect(runWalls(loadProject(root)).findings.map((f) => f.rule)).toEqual(['unresolved']);
  });

  it('catches a planted cross-module import, a deep import, a banned import and a spike import', () => {
    const root = tempProject({
      ...app,
      'apps/web/src/features/reading-list/list.tsx':
        "import { Button } from '@/shared/ui/button';\nimport { x } from '@/features/settings';\nimport { try1 } from '../../../../../spikes/try/a';\nexport const List = 1;",
      'packages/features/src/index.ts': "import Link from 'next/link';",
      'spikes/try/a.ts': 'export const try1 = 1;',
    });
    const r = runWalls(loadProject(root));
    expect(r.status).toBe('fail');
    expect(r.findings.map((f) => `${f.rule}@${f.line}`)).toEqual(['deep-import@1', 'dependency@2', 'spike@3', 'banned-import@1']);
    expect(r.findings[1]!.message).toBe(
      'module "reading-list" may not depend on "settings" (imports @/features/settings); modules.json allows: shared-ui',
    );
  });

  it('sees an import on the line after a JSX closing tag or a division', () => {
    const root = tempProject({
      ...app,
      'apps/web/src/features/reading-list/list.tsx': [
        "import { Button } from '@/shared/ui';",
        'export const List = () => <div>{Button}</div>',
        "export { x } from '@/features/settings';",
        'const half = 10 / 2;',
        "import { y } from '@/features/settings';",
        'export const h = [half, y];',
      ].join('\n'),
    });
    expect(runWalls(loadProject(root)).findings.map((f) => `${f.rule}@${f.line}`)).toEqual(['dependency@3', 'dependency@5']);
  });

  it('sees an import after a lone backtick in JSX text or a backtick inside a template literal', () => {
    const root = tempProject({
      ...app,
      'apps/web/src/features/reading-list/list.tsx': [
        "import { Button } from '@/shared/ui';",
        'export const List = () => <p>Press ` to search {Button}</p>;',
        "export { x } from '@/features/settings';",
        'export const label = (n: number) => `${n} ${`}`}`;',
        "import { y } from '@/features/settings';",
        'export const z = y;',
      ].join('\n'),
    });
    expect(runWalls(loadProject(root)).findings.map((f) => `${f.rule}@${f.line}`)).toEqual(['dependency@3', 'dependency@5']);
  });

  it('flags a relative or #name import that resolves to no file, and passes declaration files, .js for .ts and a query', () => {
    const root = tempProject({
      ...app,
      'apps/web/package.json': { imports: { '#db': './src/db/missing.ts' } },
      'apps/web/src/features/settings/index.ts': [
        "import { x } from './does-not-exist';",
        "import type { T } from './types';",
        "import { y } from './real.js';",
        "import raw from './notes.md?raw';",
        "import { db } from '#db';",
        'export const s = [x, y, raw, db];',
      ].join('\n'),
      'apps/web/src/features/settings/types.d.ts': 'export type T = 1;',
      'apps/web/src/features/settings/real.ts': 'export const y = 1;',
      'apps/web/src/features/settings/notes.md': '# Notes',
    });
    const r = runWalls(loadProject(root));
    expect(r.findings.map((f) => `${f.rule}@${f.line}`)).toEqual(['unresolved@1', 'unresolved@5']);
    expect(r.findings[0]!.message).toBe(
      'imports ./does-not-exist, which resolves to no file: nothing at apps/web/src/features/settings/does-not-exist, with or without an extension or an index file. Fix the path, or add the file.',
    );
  });

  it('bans an import by what it names, a workspace package too', () => {
    const banned = (modulesJson: object) =>
      runWalls(
        loadProject(
          tempProject({
            ...app,
            'docs/app/modules.json': modulesJson,
            'pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n  - "packages/*"\n',
            'packages/server/package.json': { name: '@example-org/server', main: 'src/index.ts' },
            'packages/server/src/index.ts': 'export const db = 1;',
            'packages/server/src/db.ts': 'export const db = 1;',
            'packages/features/src/index.ts': "import { db } from '@example-org/server';\nimport { db as d2 } from '@example-org/server/src/db';\nexport const f = [db, d2];",
          }),
        ),
      ).findings.map((f) => `${f.rule}@${f.line}`);
    const map = app['docs/app/modules.json'];
    const withBan = (ban: string[]) => ({ ...map, modules: map.modules.map((m) => (m.name === 'features-pkg' ? { ...m, bannedImports: ban } : m)) });
    expect(banned(withBan(['next', 'next/*']))).toEqual([]);
    expect(banned(withBan(['@example-org/server']))).toEqual(['banned-import@1', 'banned-import@2']);
    expect(banned(withBan(['@example-org/server/src/*']))).toEqual(['banned-import@2']);
  });

  describe('a dependency cycle', () => {
    const walls = (modules: object[], files: Record<string, string>) => {
      const p = loadProject(tempProject({ 'docs/app/modules.json': { schema: 1, modules }, ...files }));
      p.paths.source = ['src/**'];
      return runWalls(p).findings;
    };

    it('is caught in the imports when dependsOn "*" lets each one through', () => {
      const findings = walls(
        [
          { name: 'a', path: 'src/a', dependsOn: ['*'] },
          { name: 'b', path: 'src/b', dependsOn: ['*'] },
          { name: 'c', path: 'src/c', dependsOn: ['a'] },
        ],
        {
          'src/a/index.ts': "import { b } from '../b';\nexport const a = b;",
          'src/b/index.ts': "export const b = 1;\nexport { c } from '../c';",
          'src/c/index.ts': "import { a } from '../a';\nexport const c = a;",
        },
      );
      expect(findings.map((f) => `${f.rule} ${f.file}@${f.line}`)).toEqual(['cycle src/c/index.ts@1']);
      expect(findings[0]!.message).toBe(
        'dependency cycle in the imports: a -> b -> c -> a (this file imports ../a). dependsOn "*" allows each import, not a cycle: move what the modules share into a module of its own.',
      );
    });

    it('is left to the dependency finding when an import modules.json forbids closes it', () => {
      const findings = walls(
        [
          { name: 'a', path: 'src/a', dependsOn: ['*'] },
          { name: 'b', path: 'src/b', dependsOn: [] },
        ],
        { 'src/a/index.ts': "import { b } from '../b';\nexport const a = b;", 'src/b/index.ts': "import { a } from '../a';\nexport const b = a;" },
      );
      expect(findings.map((f) => `${f.rule} ${f.file}@${f.line}`)).toEqual(['dependency src/b/index.ts@1']);
    });
  });

  it('says how many files, imports and modules it read, in the singular for one', () => {
    const p = loadProject(tempProject({ 'docs/app/modules.json': { schema: 1, modules: [{ name: 'a', path: 'src/a', dependsOn: [] }] }, 'src/a/index.ts': "import { a } from './index';\nexport { a };" }));
    p.paths.source = ['src/**'];
    expect(runWalls(p).info).toEqual(['1 file, 1 internal import, 1 module']);
  });

  it('flags deep imports from code outside every module', () => {
    const root = tempProject({
      ...app,
      'apps/web/src/main.tsx': "import { List } from '@/features/reading-list/list';",
    });
    expect(runWalls(loadProject(root)).findings.map((f) => f.rule)).toEqual(['deep-import']);
  });

  it('fails on an invalid modules.json', () => {
    const root = tempProject({ 'docs/app/modules.json': '{ not json' });
    expect(runWalls(loadProject(root)).status).toBe('fail');
  });

  describe('an alias across a wall', () => {
    const walls = (files: Record<string, string | object>) =>
      runWalls(
        loadProject(
          tempProject({
            'docs/app/modules.json': {
              schema: 1,
              modules: [
                { name: 'list', path: 'apps/web/src/features/list', dependsOn: [] },
                { name: 'auth', path: 'apps/web/src/features/auth', dependsOn: [] },
              ],
            },
            'apps/web/src/features/auth/index.ts': 'export {};',
            'apps/web/src/features/auth/internal.ts': 'export default 1;',
            'apps/web/src/features/list/index.ts': "import x from '@/features/auth/internal';\nexport default x;",
            ...files,
          }),
        ),
      ).findings;
    const shared = { compilerOptions: { paths: { '@/*': ['${configDir}/src/*'] } } };

    it.each<[string, Record<string, string | object>]>([
      ['a relative import (control)', { 'apps/web/src/features/list/index.ts': "import x from '../auth/internal';\nexport default x;" }],
      ['paths in the app tsconfig (control)', { 'apps/web/tsconfig.json': { compilerOptions: { paths: { '@/*': ['./src/*'] } } } }],
      [
        'paths from an extends that is an installed package',
        { 'apps/web/tsconfig.json': { extends: '@repo/tsconfig/next.json' }, 'node_modules/@repo/tsconfig/package.json': { name: '@repo/tsconfig' }, 'node_modules/@repo/tsconfig/next.json': shared },
      ],
      [
        'paths from an extends that is a workspace package',
        {
          'pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n  - "packages/*"\n',
          'apps/web/tsconfig.json': { extends: '@repo/tsconfig/next' },
          'packages/tsconfig/package.json': { name: '@repo/tsconfig' },
          'packages/tsconfig/next.json': shared,
        },
      ],
      [
        'paths from a package extends with no subpath (its tsconfig.json)',
        { 'apps/web/tsconfig.json': { extends: '@repo/tsconfig' }, 'node_modules/@repo/tsconfig/package.json': { name: '@repo/tsconfig' }, 'node_modules/@repo/tsconfig/tsconfig.json': shared },
      ],
      ['paths from an extends array', { 'apps/web/tsconfig.json': { extends: ['./tsconfig.base.json'] }, 'apps/web/tsconfig.base.json': { compilerOptions: { paths: { '@/*': ['./src/*'] } } } }],
      ['baseUrl', { 'apps/web/tsconfig.json': { compilerOptions: { baseUrl: 'src' } }, 'apps/web/src/features/list/index.ts': "import x from 'features/auth/internal';\nexport default x;" }],
    ])('is caught through %s', (_, files) => {
      expect(walls(files).map((f) => `${f.rule}@${f.line}`)).toEqual(['dependency@1']);
    });

    it('is flagged as unresolved, not passed, when its tsconfig extends cannot be found', () => {
      const findings = walls({ 'apps/web/tsconfig.json': { extends: '@repo/tsconfig/next.json' } });
      expect(findings.map((f) => `${f.rule}@${f.line}`)).toEqual(['unresolved@1']);
      expect(findings[0]!.message).toBe(
        'imports @/features/auth/internal, which is not a project file or an installed or declared package. Check the tsconfig paths, baseUrl and extends that apply to this file (apps/web/tsconfig.json extends "@repo/tsconfig/next.json", which isn\'t installed or in the workspace).',
      );
    });

    it('flags a package that is neither declared nor installed, and passes builtins, declared and installed ones', () => {
      const findings = walls({
        'package.json': { dependencies: { react: '19.0.0' } },
        'node_modules/clsx/package.json': { name: 'clsx' },
        'apps/web/src/features/list/index.ts': [
          "import { readFileSync } from 'node:fs';",
          "import { join } from 'path';",
          "import { useState } from 'react';",
          "import clsx from 'clsx';",
          "import { z } from 'zod';",
          'export default [readFileSync, join, useState, clsx, z];',
        ].join('\n'),
      });
      expect(findings.map((f) => `${f.rule}@${f.line}`)).toEqual(['unresolved@5']);
      expect(findings[0]!.message).toMatch(/imports zod, .*or add zod to package\.json and install it\.$/);
    });
  });

  it('checks prompt references against the walls', () => {
    const root = tempProject({
      'modules.json': {
        schema: 1,
        modules: [
          { name: 'rules', path: 'modules/rules', dependsOn: [] },
          { name: 'spec', path: 'modules/spec', dependsOn: [] },
        ],
      },
      'modules/rules/knowledge/states.md': '# States',
      'modules/rules/index.ts': '',
      'modules/spec/index.ts': '',
      'modules/spec/skills/spec/SKILL.md':
        'Read ${CLAUDE_PLUGIN_ROOT}/modules/rules/knowledge/states.md and ${CLAUDE_PLUGIN_ROOT}/modules/spec/missing.md',
    });
    const r = runWalls(loadProject(root), { modulesFile: 'modules.json' });
    expect(r.findings.map((f) => f.rule)).toEqual(['dependency', 'broken-ref']);
  });
});

describe('architecture/contract', () => {
  const contract = (fixtures: Record<string, object | string>) =>
    tempProject({
      'packages/api-contract/openapi.yaml': `openapi: 3.1.0
info: { title: t, version: '1' }
paths:
  /items:
    get:
      operationId: listItems
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/Item' }
    post:
      operationId: createItem
      responses:
        '201':
          description: created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Item' }
        '204': { description: none }
components:
  schemas:
    Item:
      type: object
      required: [id, url]
      properties:
        id: { type: string }
        url: { type: string }
      additionalProperties: false
`,
      ...Object.fromEntries(Object.entries(fixtures).map(([k, v]) => [`packages/api-contract/fixtures/${k}`, v])),
    });
  const run = (root: string) => checks.find((c) => c.id === 'architecture/contract')!.run(contextFor(root));

  it('passes valid fixtures and lists operations without any', async () => {
    const r = await run(contract({ 'listItems.default.json': { status: 200, body: [{ id: '1', url: 'https://example.org' }] } }));
    expect(r.status).toBe('pass');
    expect(r.info).toEqual(['2 operations, 1 fixture', 'no fixtures yet: createItem']);
  });

  it('fails on a wrong body, an unknown operation, an undeclared status and a bad name', async () => {
    const r = await run(
      contract({
        'listItems.default.json': { status: 200, body: [{ id: 1 }] },
        'getThing.default.json': { status: 200, body: {} },
        'createItem.error.json': { status: 500, body: {} },
        'createItem.none.json': { status: 204, body: { surprise: true } },
        'nodot.json': { status: 200 },
      }),
    );
    expect(r.status).toBe('fail');
    expect(r.findings.map((f) => f.rule).sort()).toEqual(
      ['fixture-name', 'schema', 'schema', 'unexpected-body', 'unknown-operation', 'unknown-status'].sort(),
    );
  });

  it('is off without an openapi file', async () => {
    expect((await run(tempProject({}))).status).toBe('off');
  });
});

describe('architecture/mocks', () => {
  // A stand-in generator: its mock lists the contract's operations and fixtures, as the web one bakes them in.
  const generator: PlatformProfile = {
    platform: 'web',
    status: 'supported',
    checks: [],
    tools: [],
    fixtures: {
      platform: 'web',
      generate: (_p, c) =>
        c.operations.length === 0
          ? []
          : [{ path: `${c.dir}/generated/mock-fetch.ts`, content: mock(c.operations.map((o) => `${o.method} ${o.path}`), c.fixtures.map((f) => f.file)), source: c.source }],
    },
  };
  const mock = (ops: string[], fixtures: string[] = []) => `${JSON.stringify({ ops, fixtures })}\n`;
  const openapi = (path = '/items') => `openapi: 3.1.0\ninfo: { title: t, version: '1' }\npaths:\n  ${path}:\n    get:\n      operationId: listItems\n      responses:\n        '200': { description: ok }\n`;
  const OUT = 'packages/api-contract/generated/mock-fetch.ts';
  const run = (root: string, profiles = [generator]) => checks.find((c) => c.id === 'architecture/mocks')!.run(contextFor(root, profiles));

  it('passes when the generated mocks match the contract and its fixtures, with CRLF line endings too', async () => {
    const root = tempProject({ 'packages/api-contract/openapi.yaml': openapi(), [OUT]: mock(['GET /items']).replace(/\n/g, '\r\n') });
    expect(await run(root)).toMatchObject({ status: 'pass', findings: [] });
  });

  it('fails when an operation or a fixture changed after the mocks were generated', async () => {
    const moved = await run(tempProject({ 'packages/api-contract/openapi.yaml': openapi('/links'), [OUT]: mock(['GET /items']) }));
    expect(moved.status).toBe('fail');
    expect(moved.findings).toEqual([{ file: OUT, rule: 'drift', message: 'out of date with packages/api-contract/openapi.yaml and its fixtures; run `fwos contract mocks`' }]);
    const added = tempProject({ 'packages/api-contract/openapi.yaml': openapi(), 'packages/api-contract/fixtures/listItems.empty.json': { status: 200 }, [OUT]: mock(['GET /items']) });
    expect((await run(added)).findings.map((f) => f.rule)).toEqual(['drift']);
  });

  it('is off, saying why, with no contract, no operations, no generator or no mocks generated yet', async () => {
    const reason = async (files: Record<string, string | object>, profiles?: PlatformProfile[]) => {
      const r = await run(tempProject(files), profiles);
      expect(r.status).toBe('off');
      return r.reason;
    };
    expect(await reason({})).toBe('no packages/api-contract/openapi.yaml (no API contract yet)');
    expect(await reason({ 'packages/api-contract/openapi.yaml': 'paths: [' })).toBe("the openapi file in packages/api-contract can't be parsed (see architecture/contract)");
    expect(await reason({ 'packages/api-contract/openapi.yaml': 'openapi: 3.1.0\npaths: {}\n' })).toBe('packages/api-contract/openapi.yaml has no operations yet, so there is no mock to generate');
    expect(await reason({ 'packages/api-contract/openapi.yaml': openapi() }, [])).toBe('no mock generator for web');
    expect(await reason({ 'packages/api-contract/openapi.yaml': openapi() })).toBe(`mocks not generated yet (${OUT}); run \`fwos contract mocks\``);
  });
});
