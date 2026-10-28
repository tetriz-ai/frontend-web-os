// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { afterAll, describe, expect, it } from 'vitest';
import { type CheckResult, adapterSet, loadProject } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { checks, sliceDrift, type SliceManifest } from '../index.ts';

afterAll(cleanupTempProjects);

const modules = {
  schema: 1,
  modules: [
    { name: 'reading-list', path: 'apps/web/src/features/reading-list', dependsOn: ['shared-ui'] },
    { name: 'settings', path: 'apps/web/src/features/settings', dependsOn: ['shared-ui'] },
    { name: 'shared-ui', path: 'apps/web/src/shared/ui', dependsOn: [] },
  ],
};

const manifest: SliceManifest = {
  schema: 1,
  slice: 'S1',
  change: '0001-initial',
  title: 'Save a link',
  platform: 'web',
  modules: ['reading-list'],
  screens: ['list'],
  components: ['button'],
  states: ['list:empty'],
  acs: ['AC-list-1'],
  status: 'done',
};

const base = {
  'docs/app/modules.json': modules,
  'docs/app/spec.md': '### AC-list-1: Save\n- Proven against: local\n### AC-list-2: Mark\n- Proven against: local\n',
  'docs/app/ia.json': { schema: 1, roles: ['member'], pages: [{ id: 'list', title: 'List', route: '/', kind: 'nav', states: ['empty', 'ready'] }] },
  'design-system/components.json': { schema: 1, components: [{ id: 'button', status: 'stable', requiredStates: [] }] },
};

const run = async (root: string) => (await checks[0]!.run({ project: loadProject(root), adapters: adapterSet([]) })) as CheckResult;

describe('build/slices', () => {
  it('is off with no manifests', async () => {
    expect((await run(tempProject(base))).status).toBe('off');
  });

  it('passes a manifest that matches the results', async () => {
    const root = tempProject({
      ...base,
      '.fwos/slices/0001-initial/S1.json': manifest,
      '.fwos/local/results/v.xml': '<testsuite><testcase classname="x" name="saves @AC-list-1"/></testsuite>',
    });
    const r = await run(root);
    expect(r.findings).toEqual([]);
    expect(r.info).toEqual(['1 slice']);
  });

  it('catches unknown modules, components, screens, states and unproven ACs', async () => {
    const root = tempProject({
      ...base,
      '.fwos/slices/0001-initial/S1.json': {
        ...manifest,
        modules: ['reading-list', 'ghost'],
        components: ['button', 'fancy-table'],
        screens: ['list', 'nowhere'],
        states: ['list:offline'],
        acs: ['AC-list-2', 'AC-list-9'],
      },
      '.fwos/slices/0001-initial/S2.json': { schema: 1, slice: 'two' },
      '.fwos/local/results/v.xml': '<testsuite><testcase classname="x" name="saves @AC-list-1"/></testsuite>',
    });
    const rules = (await run(root)).findings.map((f) => f.rule);
    expect(rules.filter((r) => r !== 'schema')).toEqual(['module', 'component', 'screen', 'state', 'ac', 'ac']);
    expect(rules.filter((r) => r === 'schema').length).toBeGreaterThan(0);
  });
});

describe('sliceDrift', () => {
  it('lists files outside the slice modules, but not docs, state or lockfiles', () => {
    const p = loadProject(tempProject(base));
    const drift = sliceDrift(p, manifest, [
      'apps/web/src/features/reading-list/list.tsx',
      'apps/web/src/features/settings/form.tsx',
      'apps/web/src/main.tsx',
      'docs/app/spec.md',
      '.fwos/slices/0001-initial/S1.json',
      'pnpm-lock.yaml',
      'apps/web/package.json',
    ]);
    expect(drift.outside).toEqual([
      { file: 'apps/web/src/features/settings/form.tsx', module: 'settings' },
      { file: 'apps/web/src/main.tsx', module: null },
    ]);
  });
});
