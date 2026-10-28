// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Every YAML file in the repo parses, including the CI workflows (ours and the one the scaffold
// gives users). GitHub rejects a workflow with a YAML error before any job runs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { walkFiles } from '../../plugin/kernel/index.ts';

const REPO = new URL('../../', import.meta.url).pathname;
const files = walkFiles(REPO, { include: ['**/*.{yml,yaml}'], exclude: ['**/node_modules/**', 'examples/**/pnpm-lock.yaml', 'demo/**/pnpm-lock.yaml', 'pnpm-lock.yaml'] });

describe('YAML', () => {
  it('finds the workflows', () => {
    expect(files).toEqual(expect.arrayContaining(['.github/workflows/ci.yml', 'plugin/modules/screens/templates/web/.github/workflows/fwos.yml']));
  });

  it.each(files)('%s parses', (file) => {
    expect(() => parse(readFileSync(join(REPO, file), 'utf8'))).not.toThrow();
  });

  it.each(files.filter((f) => f.includes('.github/workflows/')))('%s has jobs with steps', (file) => {
    const wf = parse(readFileSync(join(REPO, file), 'utf8')) as { jobs: Record<string, { steps: unknown[] }> };
    for (const [name, job] of Object.entries(wf.jobs)) expect(job.steps?.length, name).toBeGreaterThan(0);
  });
});

it('scaffold CI pins actions to commits and keeps every shipped copy aligned', () => {
  const actions = (text: string) => {
    const workflow = parse(text) as { jobs: { check: { steps: { uses?: string }[] } } };
    return workflow.jobs.check.steps.flatMap((step) => step.uses ? [step.uses] : []);
  };
  const expected = actions(readFileSync(join(REPO, 'plugin/modules/screens/templates/web/.github/workflows/fwos.yml'), 'utf8'));
  expect(expected).toHaveLength(3);
  for (const action of expected) expect(action).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
  for (const file of [
    'examples/reading-list/.github/workflows/fwos.yml',
    'demo/tip-splitter/.github/workflows/fwos.yml',
    'distribution/plugin/modules/screens/templates/web/.github/workflows/fwos.yml',
    'demo/tip-splitter/.fwos/cli/modules/screens/templates/web/.github/workflows/fwos.yml',
  ]) expect(actions(readFileSync(join(REPO, file), 'utf8')), file).toEqual(expected);
});
