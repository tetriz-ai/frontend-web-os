// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Fidelity: the gallery's two sides, the decisions a person records, and the outcomes the report
// keeps apart. Token validity, adoption coverage and fidelity never stand in for each other, and a
// difference nobody decided stays visible.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  adapterSet,
  type ComponentFacts,
  FIDELITY_RESULTS,
  type FidelityResults,
  type GalleryAdapter,
  type GalleryModel,
  galleryHash,
  loadProject,
  type PlatformProfile,
  writeText,
} from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { adoptionReport, decide, fromShadcn, galleryModel, readDecisions, starterFiles } from '../index.ts';

afterAll(cleanupTempProjects);

const REPO = new URL('../../../../', import.meta.url).pathname;
const THEME = readFileSync(join(REPO, 'examples/import-a-shadcn-theme/globals.css'), 'utf8');

const facts = (id: string, file: string): ComponentFacts => ({
  id,
  file,
  exports: ['Button'],
  components: ['Button'],
  variants: [{ name: 'variant', values: ['primary', 'danger'], default: 'primary', from: 'ButtonVariant' }],
  states: [{ name: 'disabled', from: 'prop disabled' }],
  interactions: [{ name: 'press', from: '<button>' }],
  recipe: 'fwos:button',
  cells: [
    { id: 'default', props: {}, states: ['default'], interactions: ['hover', 'press'] },
    { id: 'variant=danger', props: { variant: 'danger' }, states: [], interactions: ['hover', 'press'] },
  ],
  unrendered: [],
});

/** A web profile with fwos's button installed, a gallery that describes it, and no app to host the gallery. */
const profile: PlatformProfile = {
  platform: 'web',
  status: 'supported',
  checks: [],
  tools: [],
  components: { platform: 'web', importFor: (id) => `@/shared/ui/${id}`, listInstalled: () => [{ id: 'button', file: 'apps/web/src/shared/ui/button.tsx' }] },
  gallery: { platform: 'web', describe: (_p, item) => facts(item.id, item.file), files: () => ({ reason: 'no app here' }), command: () => 'pnpm gallery', hash: (_p, m) => galleryHash(m) } satisfies GalleryAdapter,
};
const adapters = adapterSet([profile]);

/** A project that imported the example theme and registers only fwos's button. */
function project(extra: Record<string, string | object> = {}): string {
  const ds = Object.fromEntries(fromShadcn(THEME, 'shadcn default', 'app/globals.css').map((f) => [`design-system/${f.path}`, f.content]));
  return tempProject({
    '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'new', platforms: ['web'] },
    ...ds,
    'design-system/components.json': { schema: 1, components: [{ id: 'button', status: 'stable', source: 'fwos', requiredStates: ['default', 'disabled'] }] },
    'apps/web/src/shared/ui/button.tsx': 'export function Button() { return null; }\n',
    ...extra,
  });
}

/** Results for every cell of the model, identical unless `diff` says otherwise. */
function results(model: GalleryModel, diff: (component: string, cell: string) => FidelityResults['cells'][number]['differences'] = () => []): FidelityResults {
  const cells: FidelityResults['cells'] = [];
  for (const v of model.viewports) {
    for (const mode of model.modes) {
      for (const c of model.components) {
        for (const cell of (c.adopted ?? c.original)!.cells) {
          cells.push({ component: c.id, cell: cell.id, mode, viewport: v.name, differences: diff(c.id, cell.id), behaviour: [{ interaction: 'press', original: 'pressed', adopted: 'pressed' }] });
        }
      }
    }
  }
  return { schema: 1, gallery: galleryHash(model), browser: 'chromium 140', cells, errors: [] };
}

const save = (root: string, r: FidelityResults) => writeText(join(root, FIDELITY_RESULTS), `${JSON.stringify(r, null, 2)}\n`);

describe('the gallery model', () => {
  it("sets the source's own values on the original side and the design system's on the adopted side", () => {
    const m = galleryModel(loadProject(project()), adapters);
    expect(m.modes).toEqual(['light', 'dark']);
    expect(m.dark).toBe('dark');
    expect(m.viewports.map((v) => `${v.name} ${v.width}`)).toEqual(['phone 390', 'desktop 1280']);
    // The theme's own variables, as it had them in each mode.
    expect(m.variables.original.light!['--primary']).toBe('oklch(0.205 0 0)');
    expect(m.variables.original.dark!['--primary']).toBe('oklch(0.922 0 0)');
    expect(m.variables.original.dark!['--radius']).toBe('0.625rem');
    // fwos's slots read from the theme on the original side, from the tokens on the adopted side.
    expect(m.variables.original.light!['--ds-brand-primary']).toBe('oklch(0.205 0 0)');
    expect(m.variables.adopted.light!['--ds-brand-primary']).toBe('oklch(0.205 0 0)');
    expect(m.variables.adopted.light!['--ds-radius-sm']).toBe('6px');
    // Your component's own names read the slot that took them; a name no slot took has no value.
    expect(m.variables.adopted.light!['--primary']).toBe('var(--ds-brand-primary)');
    expect(m.variables.adopted.light!['--muted-foreground']).toBe('var(--ds-text-muted)');
    expect(m.variables.adopted.light!['--popover']).toBe('initial');
    expect(m.variables.original.light!['--popover']).toBe('oklch(1 0 0)');
    // A slot the theme had nothing for shows fwos's value on both sides: there's nothing to compare.
    expect(m.variables.original.light!['--ds-status-warning-bg']).toBe(m.variables.adopted.light!['--ds-status-warning-bg']);
    expect(m.rows['--ds-brand-primary']).toBe('brand.primary');
    expect(m.rows['--primary']).toBe('brand.primary');
    expect(m.rows['--popover']).toBe('--popover');
  });

  it('pairs each component with what renders on each side', () => {
    const m = galleryModel(loadProject(project()), adapters);
    expect(m.components.map((c) => ({ id: c.id, kind: c.kind, original: c.original?.file, adopted: c.adopted?.file }))).toEqual([
      { id: 'button', kind: 'starter', original: 'apps/web/src/shared/ui/button.tsx', adopted: 'apps/web/src/shared/ui/button.tsx' },
    ]);
  });

  it('refuses the neutral starter: there is no source to compare with', () => {
    const root = tempProject({ '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'new', platforms: ['web'] }, ...Object.fromEntries(starterFiles().map((f) => [`design-system/${f.path}`, f.content])) });
    expect(() => galleryModel(loadProject(root), adapters)).toThrow(/nothing was adopted/);
  });
});

describe('outcomes', () => {
  it('keep token validity, generated CSS, coverage and fidelity apart', async () => {
    const r = await adoptionReport(loadProject(project()), adapters);
    expect(r.outcomes.validity).toMatchObject({ status: 'fail' });
    expect(r.outcomes.validity.detail).toMatch(/design-system\/schema PASS, design-system\/contrast FAIL \(1 finding\)/);
    expect(r.outcomes.generated).toMatchObject({ status: 'not built' });
    expect(r.outcomes.coverage).toMatchObject({ status: 'partial' });
    expect(r.outcomes.coverage.detail).toBe('slots: 20 preserved, 5 approximated, 36 defaulted; 4 source entries not consumed; components: 1 fwos starter');
    expect(r.outcomes.fidelity).toMatchObject({ status: 'not compared' });
    expect(r.outcomes.fidelity.detail).toMatch(/^no rendered comparison yet: run `fwos design-system gallery`, then `pnpm gallery`\. 46 items need a decision\.$/);
  });

  it('never call the neutral starter adopted or faithful', async () => {
    const root = tempProject({ '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'new', platforms: ['web'] }, ...Object.fromEntries(starterFiles().map((f) => [`design-system/${f.path}`, f.content])) });
    const r = await adoptionReport(loadProject(root), adapters);
    expect(r.outcomes.validity.status).toBe('pass');
    expect(r.outcomes.coverage).toMatchObject({ status: 'none', detail: 'nothing adopted: the neutral starter' });
    expect(r.outcomes.fidelity).toMatchObject({ status: 'not applicable' });
  });

  it('say the comparison is out of date when the design system changed after it ran', async () => {
    const root = project();
    const model = galleryModel(loadProject(root), adapters);
    save(root, results(model));
    expect((await adoptionReport(loadProject(root), adapters)).outcomes.fidelity.status).toBe('unresolved');
    const light = JSON.parse(readFileSync(join(root, 'design-system/tokens/light.json'), 'utf8'));
    light.color.brand.primary = { $value: '#0f766e' };
    writeFileSync(join(root, 'design-system/tokens/light.json'), JSON.stringify(light));
    expect((await adoptionReport(loadProject(root), adapters)).outcomes.fidelity).toMatchObject({ status: 'out of date' });
  });
});

describe('decisions', () => {
  it('take an explicit decision for each row that is not preserved, and refuse the wrong kind', () => {
    const root = project();
    const p = loadProject(root);
    expect(() => decide(p, adapters, ['surface.base'], 'intentional', 'why', 'Ada')).toThrow(/surface\.base is preserved: there is nothing to decide/);
    expect(() => decide(p, adapters, ['button'], 'intentional', 'why', 'Ada')).toThrow(/button is a component: decide replace or omit/);
    expect(() => decide(p, adapters, ['text.disabled'], 'replace', 'why', 'Ada')).toThrow(/text\.disabled is a token: decide intentional/);
    expect(() => decide(p, adapters, ['no.such'], 'intentional', 'why', 'Ada')).toThrow(/No row, component or difference is called "no\.such"/);
    expect(() => decide(p, adapters, ['text.disabled'], 'intentional', ' ', 'Ada')).toThrow(/needs a reason/);
    expect(decide(p, adapters, ['text.disabled'], 'intentional', 'the theme has no disabled text colour', 'Ada', '2026-10-23T10:00:00Z')).toEqual([
      { item: 'text.disabled', decision: 'intentional', reason: 'the theme has no disabled text colour', by: 'Ada', at: '2026-10-23T10:00:00Z', seen: expect.stringMatching(/^[0-9a-f]{12}$/) },
    ]);
    expect(readDecisions(p).map((d) => d.item)).toEqual(['text.disabled']);
  });

  it('take a status for every undecided row of it, of the kind the decision fits', () => {
    const p = loadProject(project());
    const tokens = decide(p, adapters, ['defaulted'], 'intentional', "fwos's defaults fill what the theme lacks", 'Ada', '2026-10-23T10:00:00Z');
    expect(tokens).toHaveLength(36);
    expect(tokens.every((d) => d.decision === 'intentional')).toBe(true);
    const components = decide(p, adapters, ['defaulted'], 'replace', 'the theme came without components', 'Ada', '2026-10-23T10:00:00Z');
    expect(components.map((d) => d.item)).toEqual(['button']);
  });

  it("go stale when what was decided changes, and a difference no row explains needs its own", async () => {
    const root = project();
    const p = loadProject(root);
    const all = ['approximated', 'defaulted', 'unsupported'];
    for (const s of all) decide(p, adapters, [s], 'intentional', 'accepted', 'Ada', '2026-10-23T10:00:00Z');
    decide(p, adapters, ['button'], 'replace', 'fwos button', 'Ada', '2026-10-23T10:00:00Z');
    const model = galleryModel(loadProject(root), adapters);
    // One difference the corrected red accounts for, and one nothing accounts for.
    save(
      root,
      results(model, (_c, cell) =>
        cell === 'variant=danger'
          ? [
              { element: '0', property: 'background-color', original: 'oklch(0.577 0.245 27.325)', adopted: 'rgb(226, 0, 0)', causes: ['--ds-status-critical-text'] },
              { element: '0', property: 'border-top-left-radius', original: '8px', adopted: '6px', causes: [] },
            ]
          : [],
      ),
    );
    const r = await adoptionReport(loadProject(root), adapters);
    expect(r.unresolved.map((u) => u.item)).toEqual(['render:button']);
    expect(r.outcomes.fidelity).toMatchObject({ status: 'unresolved', unresolved: ['render:button'] });
    decide(loadProject(root), adapters, ['render:button'], 'intentional', 'the radius ladder rounds', 'Ada', '2026-10-23T10:00:00Z');
    expect((await adoptionReport(loadProject(root), adapters)).outcomes.fidelity.status).toBe('ready');
    // The red is changed after the decision: it is a different row now, so it needs deciding again.
    const light = JSON.parse(readFileSync(join(root, 'design-system/tokens/light.json'), 'utf8'));
    light.color.status.critical.text = { $value: '#e20000' };
    writeFileSync(join(root, 'design-system/tokens/light.json'), JSON.stringify(light));
    const after = await adoptionReport(loadProject(root), adapters);
    expect(after.unresolved.map((u) => u.item)).toContain('status.critical.text');
  });
});

describe('the rendered comparison in the report', () => {
  it('keeps faithful cells, intentional changes and unresolved differences apart', async () => {
    const root = project();
    // An approved contrast correction: the theme's red, changed after the import.
    const light = JSON.parse(readFileSync(join(root, 'design-system/tokens/light.json'), 'utf8'));
    light.color.status.critical.text = { $value: '#e20000' };
    writeFileSync(join(root, 'design-system/tokens/light.json'), JSON.stringify(light));
    decide(loadProject(root), adapters, ['status.critical.text'], 'intentional', 'approved contrast correction', 'Ada', '2026-10-23T10:00:00Z');
    const model = galleryModel(loadProject(root), adapters);
    save(
      root,
      results(model, (_c, cell) =>
        cell === 'variant=danger'
          ? [
              { element: '0', property: 'background-color', original: 'oklch(0.577 0.245 27.325)', adopted: 'rgb(226, 0, 0)', causes: ['--ds-status-critical-text'] },
              { element: '0.1', property: 'color', original: 'rgb(10, 10, 10)', adopted: 'rgb(0, 0, 0)', causes: ['--popover'] },
            ]
          : [],
      ),
    );
    const md = (await adoptionReport(loadProject(root), adapters)).markdown;
    expect(md).toContain('Faithful: 4 of 8 cells render the same on both sides.');
    expect(md).toContain('Intentional: 1 difference, accounted for by a row someone decided.');
    expect(md).toContain('Unresolved: 1 difference waits on a decision.');
    expect(md).toContain('| `status.critical.text` (changed), intentional: approved contrast correction |');
    expect(md).toContain('| `--popover` (unsupported), needs a decision |');
  });
});

describe('the report', () => {
  it('is the same file for the same evidence, and leaves its own approval out', async () => {
    const root = project();
    const model = galleryModel(loadProject(root), adapters);
    save(root, results(model));
    const a = await adoptionReport(loadProject(root), adapters);
    const b = await adoptionReport(loadProject(root), adapters);
    expect(a.markdown).toBe(b.markdown);
    expect(a.markdown).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(a.markdown).not.toMatch(/approved by/i);
  });

  it('says what a PASS means and what it does not, and lists every row, component and decision', async () => {
    const root = project();
    decide(loadProject(root), adapters, ['text.disabled'], 'intentional', 'the theme has no disabled text colour', 'Ada', '2026-10-23T10:00:00Z');
    const md = (await adoptionReport(loadProject(root), adapters)).markdown;
    expect(md).toMatch(/^<!-- generated by `fwos design-system report`; do not edit\./);
    expect(md).toContain('# Design-system adoption: shadcn default');
    expect(md).toMatch(/\| Token validity \| FAIL \|/);
    expect(md).toMatch(/\| Adoption coverage \| partial \|/);
    expect(md).toMatch(/\| Fidelity \| not compared \|/);
    expect(md).toContain("doesn't compare them with your source");
    expect(md).toContain('| `surface.base` | `--background` in design-system/source/globals.css | light `oklch(1 0 0)`<br>dark `oklch(0.145 0 0)` | light `oklch(1 0 0)`<br>dark `oklch(0.145 0 0)` | preserved |');
    expect(md).toContain('| `--popover` |');
    expect(md).toContain('## Components');
    expect(md).toContain('## Needs a decision');
    expect(md).toContain('| `text.disabled` | intentional | the theme has no disabled text colour | Ada | 2026-10-23 |');
  });
});

it.each(['empty', 'missing', 'duplicate', 'unexpected'] as const)('rejects an incomplete or invalid gallery matrix: %s', async (kind) => {
  const root = project(); const model = galleryModel(loadProject(root), adapters); const run = results(model);
  if (kind === 'empty') run.cells = [];
  if (kind === 'missing') run.cells.pop();
  if (kind === 'duplicate') run.cells.push(run.cells[0]!);
  if (kind === 'unexpected') run.cells[0]!.mode = 'not-a-mode';
  save(root, run);
  expect((await adoptionReport(loadProject(root), adapters)).outcomes.fidelity.status).toBe('not compared');
});
