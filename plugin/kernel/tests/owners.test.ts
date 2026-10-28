// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { afterAll, describe, expect, it } from 'vitest';
import { codeOwners } from '../index.ts';
import { cleanupTempProjects, tempProject } from '../testing.ts';

afterAll(cleanupTempProjects);

describe('codeOwners', () => {
  const root = tempProject({
    '.github/CODEOWNERS': [
      '# The team, unless a line below says otherwise',
      '*       @example-org/web',
      '*.css   @example-org/design',
      '/app/(dashboard)/   @example-org/dashboard @example-owner',
      'docs/   @example-org/docs',
      '/lib/db.ts @example-org/data',
      'e2e     @example-org/qa',
      '',
    ].join('\n'),
  });

  it('takes the last line that matches, as GitHub does', () => {
    expect(codeOwners(root, ['lib/utils.ts'])).toEqual({ file: '.github/CODEOWNERS', owners: ['@example-org/web'] });
    expect(codeOwners(root, ['app/globals.css'])).toEqual({ file: '.github/CODEOWNERS', owners: ['@example-org/design'] });
    expect(codeOwners(root, ['app/(dashboard)/dashboard/page.tsx'])).toEqual({ file: '.github/CODEOWNERS', owners: ['@example-org/dashboard', '@example-owner'] });
    expect(codeOwners(root, ['lib/db.ts']).owners).toEqual(['@example-org/data']);
  });

  it('matches a pattern with no leading slash at any depth, and a folder name for everything in it', () => {
    expect(codeOwners(root, ['packages/site/docs/intro.md']).owners).toEqual(['@example-org/docs']);
    expect(codeOwners(root, ['e2e/team.spec.ts']).owners).toEqual(['@example-org/qa']);
  });

  it('joins the owners of several files, each once', () => {
    expect(codeOwners(root, ['app/(dashboard)/page.tsx', 'lib/db.ts', 'app/(dashboard)/layout.tsx']).owners).toEqual(['@example-org/dashboard', '@example-owner', '@example-org/data']);
  });

  it('says there is no CODEOWNERS file rather than guess', () => {
    expect(codeOwners(tempProject({ 'README.md': '' }), ['app/page.tsx'])).toEqual({ file: null, owners: [] });
  });
});
