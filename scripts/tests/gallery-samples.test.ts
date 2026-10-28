// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The gallery samples published in examples/*/gallery/ came from real runs (scripts/tests/
// gallery.test.ts with FWOS_GALLERY_SAMPLES=1). This rebuilds, with nothing installed, the project
// each came from, and proves the run rendered the gallery this fwos writes for it, and that the
// published report is the one fwos writes for that evidence. A change to the mapping, the
// recipes or the report makes it fail until the samples are run again.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadProject } from '../../plugin/kernel/index.ts';
import { cleanupTempProjects } from '../../plugin/kernel/testing.ts';
import { adoptionReport } from '../../plugin/modules/design-system/index.ts';
import { adaptersFor } from '../../plugin/shells/cli/registry.ts';
import { EMBER_SAMPLE, IMPORT_SAMPLE, REPO, SAMPLE_FILES, SHEETS, rebuild } from './support/gallery-samples.ts';

afterAll(cleanupTempProjects);

describe.each([IMPORT_SAMPLE, EMBER_SAMPLE])('the gallery sample in $example', (sample) => {
  const folder = join(REPO, sample.example, 'gallery');

  it('comes from a run of the gallery this fwos writes, and its report is the one fwos writes for it', async () => {
    const root = await rebuild(sample);
    const p = loadProject(root);
    const r = await adoptionReport(p, adaptersFor(p));
    expect(r.outcomes.fidelity.status, 'the published run rendered another gallery: run FWOS_E2E=1 FWOS_GALLERY_SAMPLES=1 pnpm vitest run scripts/tests/gallery.test.ts').not.toBe('out of date');
    expect(r.outcomes.fidelity.status).not.toBe('not compared');
    expect(readFileSync(join(folder, SAMPLE_FILES.report), 'utf8')).toBe(r.markdown);
  });

  it('has a sheet for each mode and width, and the README shows them', () => {
    const readme = readFileSync(join(REPO, sample.example, 'README.md'), 'utf8');
    for (const sheet of SHEETS) {
      expect(existsSync(join(folder, sheet)), sheet).toBe(true);
      expect(readme, sheet).toContain(`gallery/${sheet}`);
    }
    expect(readme).toContain(`gallery/${SAMPLE_FILES.report}`);
  });
});
