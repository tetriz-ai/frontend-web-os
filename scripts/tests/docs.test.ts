// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The docs can't drift from the code: every check and command is documented, every relative link
// resolves, and the writing keeps the style the README promises.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { walkFiles } from '../../plugin/kernel/index.ts';
import { COMMANDS, HELP } from '../../plugin/shells/cli/commands.ts';
import { allChecks } from '../../plugin/shells/cli/registry.ts';

const REPO = new URL('../../', import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
const DOCS = ['README.md', 'CONTRIBUTING.md', 'CLAUDE.md', 'CHANGELOG.md', ...walkFiles(join(REPO, 'docs')).map((f) => `docs/${f}`)];

describe('docs', () => {
  it('document every check', () => {
    const checks = read('docs/checks.md');
    for (const c of allChecks()) expect(checks, c.id).toContain(`## ${c.id}`);
  });

  it('reference every user command in the CLI reference and the help text', () => {
    const cli = read('plugin/kernel/knowledge/cli.md');
    for (const name of Object.keys(COMMANDS).filter((n) => !['hook', 'version', 'hash', 'baseline'].includes(n))) {
      expect(cli, name).toContain(`fwos ${name}`);
      expect(HELP, name).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it.each(DOCS)('%s has no broken relative links', (doc) => {
    const text = read(doc);
    for (const m of text.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)) {
      const target = m[1]!.split('#')[0]!;
      if (!target) continue;
      expect(existsSync(join(REPO, dirname(doc), target)), `${doc} -> ${target}`).toBe(true);
    }
  });

  it.each(DOCS)('%s keeps the plain style (no em-dashes)', (doc) => {
    expect(read(doc)).not.toMatch(/—/);
  });

  it('keeps prompts free of em-dashes too', () => {
    const prompts = walkFiles(join(REPO, 'plugin'), { include: ['**/*.md'], exclude: ['**/fixtures/**'] });
    const offenders = prompts.filter((f) => /—/.test(readFileSync(join(REPO, 'plugin', f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
