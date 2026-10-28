// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { loadProject, writeText } from '../../plugin/kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../plugin/kernel/testing.ts';
import { loadDesignSystem, tokenOutputs } from '../../plugin/modules/design-system/index.ts';
import { Ctx, PLANTS, fwos, restorePlant } from './support/truth.ts';

afterAll(cleanupTempProjects);
for (const existing of [false, true]) it(`restores named token outputs after a proof plant (existing=${existing})`, () => {
  const root = tempProject({ 'globals.css': readFileSync(new URL('../../examples/import-a-shadcn-theme/globals.css', import.meta.url), 'utf8') });
  fwos(root, 'init', '--name', 'Synthetic journal fixture');
  fwos(root, 'design-system', 'init', '--from-shadcn', 'globals.css', '--name', 'Synthetic theme');
  // An adopted design-level app has no generated ownership entries before the probe.
  writeText(join(root, '.fwos/manifest.json'), JSON.stringify({ schema: 1, files: {} }) + '\n');
  const project = loadProject(root);
  const outputs = tokenOutputs(project, loadDesignSystem(project)!);
  if (existing) writeText(join(root, outputs[0]!.path), outputs[0]!.content);
  const before = new Map(outputs.map(({ path }) => [path, existsSync(join(root, path)) ? readFileSync(join(root, path)) : null]));
  const manifest = readFileSync(join(root, '.fwos/manifest.json'));
  const journal = new Ctx(root);
  PLANTS['state/owned']!.plant(journal);
  restorePlant(root, journal);
  for (const { path } of outputs) {
    const bytes = before.get(path);
    if (bytes === null) expect(existsSync(join(root, path)), path).toBe(false);
    else expect(readFileSync(join(root, path)), path).toEqual(bytes);
  }
  expect(readFileSync(join(root, '.fwos/manifest.json'))).toEqual(manifest);
});
