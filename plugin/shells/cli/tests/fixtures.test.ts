// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Every check ships a planted-violation fixture: a good project it must pass and a bad one it must
// fail. A check claims only what its fixtures prove. Regenerate with `pnpm fixtures`.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { adapterSet, type CheckResult, loadProject } from '../../../kernel/index.ts';
import { cleanupTempProjects, copyFixture } from '../../../kernel/testing.ts';
import { PROFILES, allChecks } from '../registry.ts';

afterAll(cleanupTempProjects);

const root = new URL('../../../', import.meta.url).pathname;
const fixtureDir = (id: string) => {
  const [mod, name] = id.split('/') as [string, string];
  return mod === 'web' ? join(root, 'platforms/web/checks/fixtures', name) : join(root, 'modules', mod, 'checks/fixtures', name);
};

describe.each(allChecks().map((c) => [c.id, c] as const))('%s', (id, check) => {
  const dir = fixtureDir(id);

  it('has a good and a bad fixture', () => {
    expect(existsSync(join(dir, 'good')), `${dir}/good`).toBe(true);
    expect(existsSync(join(dir, 'bad')), `${dir}/bad`).toBe(true);
  });

  const run = async (kind: 'good' | 'bad') => {
    const project = loadProject(copyFixture(join(dir, kind)));
    return (await check.run({ project, adapters: adapterSet(PROFILES.filter((p) => p.platform === 'web')) })) as CheckResult;
  };

  it('passes its good fixture', async () => {
    const r = await run('good');
    expect(r.findings, JSON.stringify(r.findings)).toEqual([]);
    expect(r.status, r.reason).toBe('pass');
  });

  it('fails its bad fixture, with findings', async () => {
    const r = await run('bad');
    expect(r.status, r.reason).toBe('fail');
    expect(r.findings.length).toBeGreaterThan(0);
  });
});
