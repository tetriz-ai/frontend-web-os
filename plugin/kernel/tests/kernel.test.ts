// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { afterAll, describe, expect, it } from 'vitest';
import {
  fingerprint,
  hashDir,
  extractImportBindings,
  extractImports,
  hashText,
  isTestFile,
  lexSource,
  loadProject,
  findProjectRoot,
  maskComments,
  matchGlob,
  parseFrontmatter,
  parseJsonc,
  result,
  validateWith,
  walkFiles,
  lineOf,
} from '../index.ts';
import { cleanupTempProjects, minimalState, tempProject } from '../testing.ts';
import { join } from 'node:path';

afterAll(cleanupTempProjects);

describe('glob', () => {
  it.each([
    ['src/a.ts', 'src/*.ts', true],
    ['src/deep/a.ts', 'src/*.ts', false],
    ['src/deep/a.ts', 'src/**/*.ts', true],
    ['src/a.ts', 'src/**/*.ts', true],
    ['a.tsx', '**/*.{ts,tsx}', true],
    ['x/y/a.css', '**/*.{ts,tsx}', false],
    ['apps/web/app/(fwos-screens)/x/page.tsx', 'apps/*/app/(fwos-screens)/**', true],
    ['apps/web/app/(main)/x/page.tsx', 'apps/*/app/(fwos-screens)/**', false],
    ['spikes/try/a.ts', 'spikes/**', true],
    ['spikes', 'spikes/**', true],
    ['a1.ts', 'a[0-9].ts', true],
    ['ab.ts', 'a?.ts', true],
    ['./src/a.ts', 'src/a.ts', true],
    ['src/a.test.tsx', '**/*.test.{ts,tsx,js,jsx}', true],
  ])('%s vs %s -> %s', (path, glob, expected) => {
    expect(matchGlob(path, glob)).toBe(expected);
  });
});

describe('parseJsonc', () => {
  it('strips comments and trailing commas but leaves strings alone', () => {
    const text = `{
      // a comment
      "url": "http://example.org/*not a comment*/", /* block */
      "list": [1, 2,],
      "s": "a,}",
    }`;
    expect(parseJsonc(text)).toEqual({ url: 'http://example.org/*not a comment*/', list: [1, 2], s: 'a,}' });
  });

  it('keeps escaped quotes inside strings', () => {
    expect(parseJsonc('{"a": "say \\"hi\\" // not"}')).toEqual({ a: 'say "hi" // not' });
  });
});

describe('parseFrontmatter', () => {
  it('reads YAML front matter and returns the body', () => {
    const fm = parseFrontmatter('---\nbased_on:\n  - brief.md@abc\n---\n# Spec\n');
    expect(fm.data).toEqual({ based_on: ['brief.md@abc'] });
    expect(fm.body).toBe('# Spec\n');
  });

  it('returns the whole text when there is none', () => {
    expect(parseFrontmatter('# Title')).toEqual({ data: {}, body: '# Title' });
  });
});

describe('hash', () => {
  it('ignores CRLF vs LF', () => {
    expect(hashText('a\r\nb')).toBe(hashText('a\nb'));
    expect(hashText('a')).toHaveLength(12);
  });

  it('hashes a directory by paths and contents', () => {
    const a = tempProject({ 'x/a.json': '{}', 'x/b.json': '[]' });
    const b = tempProject({ 'x/a.json': '{}', 'x/b.json': '[]' });
    const c = tempProject({ 'x/a.json': '{}', 'x/c.json': '[]' });
    expect(hashDir(join(a, 'x'))).toBe(hashDir(join(b, 'x')));
    expect(hashDir(join(a, 'x'))).not.toBe(hashDir(join(c, 'x')));
    expect(hashDir(join(a, 'missing'))).toBeNull();
  });
});

describe('walkFiles', () => {
  it('skips node_modules and filters by globs', () => {
    const root = tempProject({
      'src/a.ts': '',
      'src/b.css': '',
      'node_modules/x/index.ts': '',
      '.next/x.ts': '',
    });
    expect(walkFiles(root, { include: ['**/*.ts'] })).toEqual(['src/a.ts']);
  });

  it('skips build output at a package root but walks app folders with the same name', () => {
    const root = tempProject({
      'coverage/index.html': '',
      'dist/a.js': '',
      'apps/web/coverage/x.js': '',
      'apps/web/test-results/x.js': '',
      'packages/ui/dist/x.js': '',
      'examples/demo/package.json': '{}',
      'examples/demo/playwright-report/x.js': '',
      'apps/web/src/features/coverage/index.tsx': '',
      'apps/web/src/features/dist/index.tsx': '',
      'apps/web/src/test-results/view.tsx': '',
    });
    expect(walkFiles(root, { include: ['**/*.{js,tsx,html}'] })).toEqual([
      'apps/web/src/features/coverage/index.tsx',
      'apps/web/src/features/dist/index.tsx',
      'apps/web/src/test-results/view.tsx',
    ]);
  });

  // `next build` with `output: 'export'` writes apps/web/out/, minified chunks that no check should
  // scan.
  it("skips a static export's out/ at a package root but walks an out/ folder in app source", () => {
    const root = tempProject({
      'out/index.html': '',
      'apps/web/out/index.html': '',
      'apps/web/out/_next/static/chunks/app.js': '',
      'apps/web/src/features/out/index.tsx': '',
    });
    expect(walkFiles(root, { include: ['**/*.{js,tsx,html}'] })).toEqual(['apps/web/src/features/out/index.tsx']);
  });
});

describe('lexSource', () => {
  const masked = (src: string, kind: Parameters<typeof lexSource>[1]) => lexSource(src, kind).masked;

  it('reads JSX text as text, not as the start of a comment', () => {
    const glob = '<p>Globs look like apps/*</p>\n<div className="bg-red-500" />;';
    expect(masked(glob, 'jsx')).toBe(glob);
    const url = 'const a = <p>See http://example.com</p>; <div className="bg-red-500" />;';
    expect(masked(url, 'jsx')).toBe(url);
    expect(masked('const a = <li>Don\'t // keep</li>; // gone', 'jsx')).toBe('const a = <li>Don\'t // keep</li>;        ');
  });

  it('still masks real comments around and inside JSX', () => {
    const src = 'return (\n  <ul>\n    {/* x */}\n    <li title="a" /* y */ />\n  </ul>\n); // z';
    expect(masked(src, 'jsx')).toBe('return (\n  <ul>\n    {       }\n    <li title="a"         />\n  </ul>\n);     ');
  });

  it('tells a type parameter from an element', () => {
    expect(masked('const f = <T,>(x: T) => x; // a', 'jsx')).toBe('const f = <T,>(x: T) => x;     ');
    expect(masked('type F = <T>(x: T) => T; // a', 'jsx')).toBe('type F = <T>(x: T) => T;     ');
    expect(masked('const y = f<T>(z); /* a */', 'js')).toBe('const y = f<T>(z);        ');
  });

  it('keeps strings, regex literals and an unclosed /* as they are', () => {
    expect(masked("const r = /\\/*x/; // a", 'js')).toBe('const r = /\\/*x/;     ');
    expect(masked("const s = '// not a comment'; /* a */", 'js')).toBe("const s = '// not a comment';        ");
    expect(masked('const glob = a /* no end', 'js')).toBe('const glob = a /* no end');
  });

  it('lists strings, with the literal runs of a template', () => {
    const src = 'const s = `a ${b ? "#fff" : 1} z`;';
    const spans = lexSource(src, 'js').strings.map((s) => [src.slice(s.open, s.close + 1), s.runs.map(([a, b]) => src.slice(a, b))]);
    expect(spans).toEqual([
      ['`a ${b ? "#fff" : 1} z`', ['a ', ' z']],
      ['"#fff"', ['#fff']],
    ]);
  });

  it('reads MDX as JSX text, with code spans as text', () => {
    const src = 'Use apps/* and http://example.com.\n\n```js\nconst a = { b: "#fff" }\n```\n\n<Box fill="#f00" /> {/* note */}';
    const lexed = lexSource(src, 'mdx');
    expect(lexed.masked).toBe(src.replace('/* note */', '          '));
    expect(lexed.strings.map((s) => src.slice(s.open, s.close + 1))).toEqual(['"#f00"']);
  });

  it('reads an MDX backtick with no closing run in its paragraph as text, so a later import or export is still script', () => {
    const src = "Press ` to open.\n\nimport { OldButton } from '../ui/old-button' // a `note`\n\nSee `x` and ``y``.\n\n```js\nconst a = `b`\n````\n";
    const lexed = lexSource(src, 'mdx');
    expect(lexed.strings.map((s) => src.slice(s.open, s.close + 1))).toEqual(["'../ui/old-button'"]);
    expect(lexed.masked).toBe(src.replace('// a `note`', ' '.repeat(11)));
    // A fence runs to a line of at least as many backticks; one left open runs to the end.
    const open = '```\n{a}\n\nexport { x } from "./x"\n';
    expect(lexSource(open, 'mdx').strings).toEqual([]);
  });

  it('gives a code view: comments, JSX text, MDX prose and regex literals blanked, strings kept', () => {
    const jsx = "const r = /`'/g; const el = <p title=\"t\">Don't ` {x}</p>; // c";
    const blanked = (src: string, ...parts: string[]) => parts.reduce((s, p) => s.replace(p, ' '.repeat(p.length)), src);
    expect(lexSource(jsx, 'jsx').code).toBe(blanked(jsx, "/`'/g", "Don't ` ", '// c'));
    expect(lexSource(jsx, 'jsx').masked).toBe(blanked(jsx, '// c'));
    const mdx = "# Hi `there`\n\nimport a from './a'\n\nText {b}\n";
    expect(lexSource(mdx, 'mdx').code).toBe("            \n\nimport a from './a'\n\n     {b}\n");
    expect(lexSource('a { color: red } /* x */', 'css').code).toBe('a { color: red }        ');
  });

  it('keeps the old two-argument form', () => {
    expect(maskComments('a { color: red } /* x */', true)).toBe('a { color: red }        ');
    expect(maskComments('a // x', false)).toBe('a     ');
  });
});

describe('project', () => {
  it('uses defaults when uninitialised', () => {
    const p = loadProject(tempProject({}));
    expect(p.initialized).toBe(false);
    expect(p.platforms).toEqual(['web']);
    expect(p.paths.docs).toBe('docs/app');
  });

  it('merges paths from state.json and drops unknown platforms', () => {
    const root = tempProject({
      '.fwos/state.json': minimalState({ platforms: ['web', 'ios'], paths: { docs: 'documentation', apps: { mac: 'mac' } } }),
      'src/x.ts': '',
      'spikes/s/x.ts': '',
    });
    const p = loadProject(root);
    expect(p.initialized).toBe(true);
    expect(p.platforms).toEqual(['web']);
    expect(p.paths.docs).toBe('documentation');
    expect(p.paths.apps).toEqual({ web: 'apps/web', mac: 'mac' });
    expect(p.files(['**/*.ts'])).toEqual(['src/x.ts']);
  });

  it("skips the vendored CLI in .fwos/cli, whose templates look like app source, but not fwos's other files", () => {
    const root = tempProject({
      '.fwos/state.json': minimalState(),
      '.fwos/cli/modules/screens/templates/web/apps/web/app/page.tsx': "export default () => <div dangerouslySetInnerHTML={{ __html: '' }} />;",
      '.fwos/local/results/v.xml': '<testsuite/>',
      'apps/web/app/page.tsx': '',
    });
    const p = loadProject(root);
    expect(p.files(['**/*.tsx'])).toEqual(['apps/web/app/page.tsx']);
    expect(p.files(['.fwos/local/results/**/*.xml'])).toEqual(['.fwos/local/results/v.xml']);
  });

  it('finds the project root from a subfolder', () => {
    const root = tempProject({ '.fwos/state.json': minimalState(), 'apps/web/src/a.ts': '' });
    expect(findProjectRoot(join(root, 'apps/web/src'))).toBe(root);
  });

  it('tells test files from app source: test names anywhere, tests/ and e2e/ folders only at a package root', () => {
    const p = loadProject(tempProject({ 'tools/kit/package.json': '{}', 'apps/web/src/kit/package.json': '{}' }));
    const tests = [
      'tests/a.ts',
      'e2e/a.spec.ts',
      'apps/web/e2e/flow.ts',
      'apps/web/tests/setup.ts',
      'packages/ui/tests/a.tsx',
      'tools/kit/tests/a.ts',
      'apps/web/src/kit/e2e/a.tsx',
      'apps/web/src/features/list/row.test.tsx',
      'apps/web/src/features/list/row.spec.mts',
      'apps/web/src/__tests__/row.tsx',
    ];
    const source = ['apps/web/src/features/tests/quiz.tsx', 'apps/web/src/e2e/flow.tsx', 'packages/ui/src/tests/a.ts', 'apps/web/app/tests/page.tsx', 'tests.ts'];
    expect(tests.filter((f) => !isTestFile(p, f))).toEqual([]);
    expect(source.filter((f) => isTestFile(p, f))).toEqual([]);
  });
});

describe('extractImports', () => {
  it('is the same parser the walls check reads', () => {
    expect(extractImports("import a from './a';\nconst b = import('./b');").map((i) => `${i.kind}:${i.spec}:${i.line}`)).toEqual([
      'static:./a:1',
      'dynamic:./b:2',
    ]);
    expect(Object.keys(extractImports("import a from './a';")[0]!)).toEqual(['spec', 'line', 'kind', 'typeOnly']);
  });

  it('lists the names each import takes from its module', () => {
    const src = [
      "import A, { B, C as D, type E, default as F, type as G } from './x';",
      "import * as NS from './y';",
      "import type { H } from './z';",
      "import type I from './i';",
      "import './side-effect';",
      "export { J, K as L } from './j';",
      "export * from './k';",
      "const m = import('./m');",
    ].join('\n');
    expect(extractImportBindings(src).map((i) => `${i.spec} ${i.names.join(',')}`)).toEqual([
      './x default,B,C,E,default,type',
      './y *',
      './z H',
      './i default',
      './side-effect ',
      './j J,K',
      './k *',
      './m ',
    ]);
  });
});

describe('check helpers', () => {
  it('passes with no findings and fails with some', () => {
    expect(result('m/c', [], ['x']).status).toBe('pass');
    const r = result('m/c', [{ message: 'bad' }], ['x']);
    expect(r.status).toBe('fail');
    expect(r.reason).toBe('1 finding');
  });

  it('fingerprints without line or column numbers', () => {
    const a = fingerprint('m/c', { file: 'a.ts', line: 3, message: 'raw colour #fff at col 12' });
    const b = fingerprint('m/c', { file: 'a.ts', line: 40, message: 'raw colour #fff at col 7' });
    expect(a).toBe(b);
    const c = fingerprint('m/c', { file: 'a.ts', message: '"bg-[#111111]" hard-codes a colour' });
    const d = fingerprint('m/c', { file: 'a.ts', message: '"bg-[#222222]" hard-codes a colour' });
    expect(c).not.toBe(d);
  });

  it('counts lines', () => {
    expect(lineOf('a\nb\nc', 4)).toBe(3);
  });
});

describe('validateWith', () => {
  it('formats errors with their path', () => {
    const schema = { type: 'object', required: ['id'], properties: { id: { type: 'string' } }, additionalProperties: false };
    expect(validateWith(schema, { id: 'x' })).toEqual([]);
    expect(validateWith(schema, { id: 1, extra: true }).sort()).toEqual([
      '(root) must NOT have additional properties (extra)',
      '/id must be string',
    ]);
  });
});
