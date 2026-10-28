// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { type SourceKind, extractImports } from '../index.ts';

describe('extractImports and template literals', () => {
  it('reads a template literal with no interpolation as a specifier', () => {
    expect(extractImports('const x = await import(`../auth/internal`);').map((i) => i.spec)).toEqual(['../auth/internal']);
    expect(extractImports('const y = require(`./lib`);').map((i) => i.spec)).toEqual(['./lib']);
  });

  it('still skips a template literal it would have to evaluate', () => {
    expect(extractImports('const m = await import(`./features/${name}`);')).toEqual([]);
  });

  it('skips a dynamic import or require of a string it would have to add to, and keeps import attributes', () => {
    expect(extractImports("const m = import('../' + name);\nconst r = require('./lib/' + name);")).toEqual([]);
    expect(extractImports("const j = await import('./data.json', { with: { type: 'json' } });").map((i) => i.spec)).toEqual(['./data.json']);
  });
});

describe('extractImports and a slash that is not a regex', () => {
  const found = (src: string) => extractImports(src).map((i) => `${i.kind}:${i.spec}@${i.line}`);

  it('reads the import on the line after a JSX closing tag', () => {
    expect(found("export const Z = () => <div>z</div>\nexport { deep } from '@/features/nonexistent-module/internal';\n")).toEqual([
      're-export:@/features/nonexistent-module/internal@2',
    ]);
    expect(found("const el = <p>a</p>;\nimport b from './b';")).toEqual(['static:./b@2']);
  });

  it('reads the import on the line after a division by a number', () => {
    expect(found("const half = 10 / 2;\nimport b from './b';\n")).toEqual(['static:./b@2']);
    expect(found("const n = 1.5e3 / .5 / 0x1F / 1_000n;\nimport f from './f';")).toEqual(['static:./f@2']);
  });

  it('reads a slash with no closing slash on its line as division, not a regex', () => {
    expect(found("const a = x++ / 2\nimport c from './c';")).toEqual(['static:./c@2']);
  });

  it('still skips a regex, a slash in its character class included', () => {
    expect(found("const r = /ab[/]c'/g; import d from './d';")).toEqual(['static:./d@1']);
    expect(found("const r = cond ? /import x from '.\\/x'/ : null;\nimport e from './e';")).toEqual(['static:./e@2']);
  });

  it('keeps line numbers after JSX text and after strings and templates that continue on the next line', () => {
    expect(found("const el = <p>a</p>\nconst y = 1;\nimport x from './x';")).toEqual(['static:./x@3']);
    expect(found("const s = 'a\\\nb';\nconst t = `c\\\nd`;\nimport e from './e';")).toEqual(['static:./e@5']);
  });
});

describe('extractImports and backticks', () => {
  const found = (src: string, kind?: SourceKind) => extractImports(src, kind).map((i) => `${i.kind}:${i.spec}@${i.line}`);

  it('reads the import after a lone backtick in JSX text', () => {
    expect(found("export const Hint = () => <p>Press ` to open the console</p>;\nimport { x } from '../settings/internal';\n")).toEqual(['static:../settings/internal@2']);
    expect(found("export const Hint = () => <p>Press ` to open</p>;\nexport const load = () => import('./panel');\n", 'jsx')).toEqual(['dynamic:./panel@2']);
  });

  it('reads the import after a template literal whose ${...} holds a backtick or a closing brace', () => {
    expect(found("const s = `a ${`}`} b`;\nimport { x } from './x';\n", 'js')).toEqual(['static:./x@2']);
    expect(found("const s = `a ${'}'} b ${\"`\"} c`;\nimport { y } from './y';\n", 'js')).toEqual(['static:./y@2']);
  });

  it('reads no import from JSX text or MDX prose, and the MDX import after a lone backtick', () => {
    expect(found("export const A = () => <p>import data from 'file'</p>;\n")).toEqual([]);
    const mdx = "Press ` to open.\n\nimport { OldButton } from '../ui/old-button'\n\nYou can import data from 'a file' too, with `code`.\n";
    expect(found(mdx, 'mdx')).toEqual(['static:../ui/old-button@3']);
  });
});
