// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The README's own rules, checked after every rewrite: every shown command runs and prints what
// the README says, tables have at most three columns, no prose paragraph runs past three
// sentences, and running prose has no semicolons.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = new URL('../../', import.meta.url).pathname;
const readme = readFileSync(join(REPO, 'README.md'), 'utf8');

/** Prose paragraphs: blank-line separated blocks that aren't code, tables, lists, headings or HTML. */
function prose(md: string): string[] {
  const noFences = md.replace(/```[\s\S]*?```/g, '');
  return noFences
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b && !/^(#|\||[-*] |\d+\. |<|!\[|\[!\[)/.test(b));
}

describe('README', () => {
  it('shows every quick-start check output exactly as the CLI prints it', () => {
    const blocks = [...readme.matchAll(/```sh\n(node plugin\/dist\/fwos\.mjs check[^\n]*)\n```\n\n```text\n([\s\S]*?)\n```/g)];
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const [, cmd, expected] of blocks) {
      let actual = '';
      try {
        actual = execFileSync('sh', ['-c', cmd!], { cwd: REPO, env: { ...process.env, NO_COLOR: '1' } }).toString();
      } catch (e) {
        actual = (e as { stdout: Buffer }).stdout.toString();
      }
      expect(actual.trimEnd(), cmd).toBe(expected);
    }
  });

  it('keeps tables to three columns', () => {
    for (const line of readme.split('\n').filter((l) => /^\|.*\|$/.test(l))) {
      expect(line.split('|').length - 2, line).toBeLessThanOrEqual(3);
    }
  });

  it('keeps prose paragraphs to three sentences', () => {
    for (const p of prose(readme)) {
      const sentences = p.replace(/`[^`]*`/g, 'x').split(/(?<=[.!?])\s+(?=[A-Z`*])/).filter(Boolean);
      expect(sentences.length, p).toBeLessThanOrEqual(3);
    }
  });

  it('has no semicolons in running prose', () => {
    for (const p of prose(readme)) expect(p.replace(/`[^`]*`/g, ''), p).not.toMatch(/;/);
  });

  it('ends with the copyright line and credits people only through CONTRIBUTORS.md', () => {
    // Attribution stays consistent across first-party source and documentation.
    expect(readme.trimEnd().split('\n').at(-1)).toBe('Copyright 2026 Workloom Solutions Private Limited. Built by the [contributors](CONTRIBUTORS.md).');
  });
});
