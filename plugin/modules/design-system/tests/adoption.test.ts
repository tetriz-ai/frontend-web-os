// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The source-to-target mapping for every input fwos takes: a shadcn theme (through the copy the
// import keeps), DTCG tokens with their own names (Ember), and the neutral starter. A passing
// schema check says the result is valid; these rows say how much of the source it carries.

import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { adapterSet, type ComponentFacts, type GalleryAdapter, loadProject, type PlatformProfile } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { checks, fromShadcn, mapDesignSystem, SLOTS, starterFiles } from '../index.ts';

afterAll(cleanupTempProjects);

const REPO = new URL('../../../../', import.meta.url).pathname;
const THEME = readFileSync(join(REPO, 'examples/import-a-shadcn-theme/globals.css'), 'utf8');

/** A web profile whose component adapter lists `installed`, and whose gallery describes each by its id. */
function web(installed: { id: string; file: string }[] = []): PlatformProfile {
  const describe: GalleryAdapter['describe'] = (_p, item) =>
    ({ id: item.id, file: item.file, exports: [], components: [], variants: [], states: [], interactions: [], recipe: 'generic', cells: [], unrendered: [] }) satisfies ComponentFacts;
  return {
    platform: 'web',
    status: 'supported',
    checks: [],
    tools: [],
    components: { platform: 'web', importFor: (id) => `@/shared/ui/${id}`, listInstalled: () => installed },
    gallery: { platform: 'web', describe, files: () => ({ reason: 'not in this test' }), command: () => 'true', hash: () => 'none' },
  };
}

const imported = (extra: Record<string, string> = {}) =>
  tempProject({ ...Object.fromEntries(fromShadcn(THEME, 'shadcn default', 'app/globals.css').map((f) => [`design-system/${f.path}`, f.content])), ...extra });

const rowsOf = (root: string, profile = web()) => mapDesignSystem(loadProject(root), adapterSet([profile]))!;

describe('a shadcn import keeps its source', () => {
  const files = fromShadcn(THEME, 'shadcn default', 'app/globals.css');

  it('copies the theme into design-system/source/ as it was, and records where it came from', () => {
    expect(files.find((f) => f.path === 'source/globals.css')?.content).toBe(THEME);
    const ds = JSON.parse(files.find((f) => f.path === 'design-system.json')!.content);
    expect(ds.source).toEqual({ format: 'shadcn', file: 'source/globals.css', from: 'app/globals.css' });
  });

  it('writes no one-off import report: the mapping is computed from the copy whenever it is asked for', () => {
    expect(files.map((f) => f.path)).not.toContain('import-report.md');
  });

  it('still passes the schema check with the source recorded, and the pass says it is not a match', async () => {
    const r = await checks.find((c) => c.id === 'design-system/schema')!.run({ project: loadProject(imported()), adapters: adapterSet([]) });
    expect(r.findings).toEqual([]);
    expect(r.status).toBe('pass');
    expect(r.info).toContain('imported from app/globals.css: valid, not shown to match it (`fwos design-system report` maps it)');
  });
});

describe('mapping a shadcn theme', () => {
  const m = rowsOf(imported());
  const row = (key: string) => m.tokens.find((r) => r.key === key);

  it('says what it read', () => {
    expect(m.input).toBe('shadcn');
    expect(m.source).toBe('app/globals.css (copied to design-system/source/globals.css)');
    expect(m.modes).toEqual(['light', 'dark']);
  });

  it('gives every slot its source file and key, its original and resulting value in each mode, and a status', () => {
    expect(m.tokens.filter((r) => r.target).map((r) => r.target)).toEqual(SLOTS.map((s) => s.id));
    expect(row('surface.base')).toEqual({
      key: 'surface.base',
      source: { file: 'design-system/source/globals.css', key: '--background' },
      target: 'surface.base',
      original: { light: 'oklch(1 0 0)', dark: 'oklch(0.145 0 0)' },
      result: { light: 'oklch(1 0 0)', dark: 'oklch(0.145 0 0)' },
      status: 'preserved',
      why: '',
    });
    expect(row('text.secondary')).toMatchObject({ source: { key: '--muted-foreground' }, original: { light: 'oklch(0.48 0 0)' }, result: { light: 'oklch(0.48 0 0)' }, status: 'approximated', why: 'shadcn has no exact match' });
    expect(row('radius.sm')).toMatchObject({ source: { key: '--radius' }, original: { light: '0.625rem', dark: '0.625rem' }, result: { light: '6px', dark: '6px' }, status: 'preserved', why: "shadcn's ladder, --radius - 4px" });
    expect(row('text.disabled')).toMatchObject({ source: null, original: { light: '', dark: '' }, result: { light: '#a1a1aa', dark: '#52525b' }, status: 'defaulted', why: "the neutral starter's value" });
    expect(row('state.selected')).toMatchObject({ source: null, result: { light: 'same as surface.interactive', dark: 'same as surface.interactive' }, status: 'defaulted', why: "the slot's fallback" });
    expect(row('type.body')).toMatchObject({ source: null, result: { light: '0.875rem/1.25rem 400', dark: '0.875rem/1.25rem 400' }, status: 'defaulted' });
  });

  it('lists the source entries nothing consumed, with their values', () => {
    expect(m.tokens.filter((r) => r.status === 'unsupported')).toEqual(
      ['card-foreground', 'popover', 'popover-foreground', 'secondary-foreground'].map((v) => ({
        key: `--${v}`,
        source: { file: 'design-system/source/globals.css', key: `--${v}` },
        target: null,
        original: expect.objectContaining({ light: expect.stringMatching(/^oklch\(/) }),
        result: { light: '', dark: '' },
        status: 'unsupported',
        why: 'no slot takes it',
      })),
    );
  });

  it('shows a value edited after the import as changed, with the source value it replaced', () => {
    const root = imported();
    const light = JSON.parse(readFileSync(join(root, 'design-system/tokens/light.json'), 'utf8'));
    light.color.status.critical.text = { $value: '#e20000' };
    writeFileSync(join(root, 'design-system/tokens/light.json'), JSON.stringify(light));
    const after = rowsOf(root).tokens.find((r) => r.key === 'status.critical.text');
    expect(after).toMatchObject({
      original: { light: 'oklch(0.577 0.245 27.325)', dark: 'oklch(0.704 0.191 22.216)' },
      result: { light: '#e20000', dark: 'oklch(0.704 0.191 22.216)' },
      status: 'changed',
      why: 'light: set after the import (the theme had oklch(0.577 0.245 27.325))',
    });
  });

  it('says so when the copy of the theme is gone, instead of guessing', () => {
    const root = imported();
    cpSync(join(root, 'design-system/source/globals.css'), join(root, 'elsewhere.css'));
    writeFileSync(join(root, 'design-system/source/globals.css'), '');
    expect(() => rowsOf(root)).toThrow(/design-system\/source\/globals\.css has no `:root` block/);
  });
});

describe('mapping DTCG tokens with their own names (Ember)', () => {
  const root = tempProject({});
  cpSync(join(REPO, 'examples/swap-in-a-design-system/ember'), join(root, 'design-system'), { recursive: true });
  const m = rowsOf(root);
  const row = (key: string) => m.tokens.find((r) => r.key === key);

  it('reads the token files as the source', () => {
    expect(m.input).toBe('dtcg');
    expect(m.source).toBe('design-system/tokens/palette.json, design-system/tokens/day.json, design-system/tokens/night.json');
  });

  it('gives every slot the token it reads and the file it is in, aliases as written and resolved', () => {
    expect(row('surface.base')).toEqual({
      key: 'surface.base',
      source: { file: 'design-system/tokens/day.json, design-system/tokens/night.json', key: 'color.canvas.default' },
      target: 'surface.base',
      original: { light: '{palette.sand.0}', dark: '{palette.sand.950}' },
      result: { light: '#fffdf9', dark: '#16110b' },
      status: 'preserved',
      why: '',
    });
    expect(row('radius.sm')).toMatchObject({ source: { file: 'design-system/tokens/palette.json', key: 'shape.corner.small' }, original: { light: '2px' }, result: { light: '2px', dark: '2px' }, status: 'preserved' });
    expect(row('font.sans')).toMatchObject({ source: { key: 'typeface.body' }, result: { light: '"Iowan Old Style", Charter, Georgia, serif' }, status: 'preserved' });
  });

  it('marks what the slots fill from fwos, and leaves blank slots blank', () => {
    expect(row('state.hover')).toMatchObject({ source: null, result: { light: 'same as surface.subtle' }, status: 'defaulted', why: "the slot's fallback" });
    expect(row('motion.fast')).toMatchObject({ source: null, result: { light: '120ms' }, status: 'defaulted', why: "the slot's fallback" });
    expect(row('chart.1')).toMatchObject({ source: null, result: { light: '', dark: '' }, status: 'defaulted', why: 'blank, so its check is off' });
    expect(m.tokens.filter((r) => r.target && r.status === 'preserved')).toHaveLength(31);
  });

  it('lists the tokens no slot reaches, directly or through an alias', () => {
    expect(m.tokens.filter((r) => r.status === 'unsupported')).toEqual([
      { key: 'palette.sand.600', source: { file: 'design-system/tokens/palette.json', key: 'palette.sand.600' }, target: null, original: { light: '#6b5841', dark: '#6b5841' }, result: { light: '', dark: '' }, status: 'unsupported', why: 'no slot reads it, so it never reaches the generated CSS' },
      { key: 'palette.ember.600', source: { file: 'design-system/tokens/palette.json', key: 'palette.ember.600' }, target: null, original: { light: '#b9461a', dark: '#b9461a' }, result: { light: '', dark: '' }, status: 'unsupported', why: 'no slot reads it, so it never reaches the generated CSS' },
    ]);
  });
});

describe('mapping the neutral starter', () => {
  it('says nothing was adopted: every value is the starter or a fallback', () => {
    const m = rowsOf(tempProject(Object.fromEntries(starterFiles().map((f) => [`design-system/${f.path}`, f.content]))));
    expect(m.input).toBe('starter');
    expect(m.tokens.every((r) => r.status === 'defaulted')).toBe(true);
    expect(m.tokens.find((r) => r.key === 'surface.base')).toMatchObject({ source: null, result: { light: '#ffffff' }, why: "the neutral starter's value" });
  });

  it('counts a starter token you replaced as yours', () => {
    const files = Object.fromEntries(starterFiles().map((f) => [`design-system/${f.path}`, f.content]));
    const light = JSON.parse(files['design-system/tokens/light.json']!);
    light.color.brand.primary = { $value: '#0f766e' };
    const m = rowsOf(tempProject({ ...files, 'design-system/tokens/light.json': JSON.stringify(light) }));
    expect(m.input).toBe('dtcg');
    expect(m.tokens.find((r) => r.key === 'brand.primary')).toMatchObject({
      source: { file: 'design-system/tokens/light.json, design-system/tokens/dark.json', key: 'color.brand.primary' },
      original: { light: '#0f766e' },
      status: 'preserved',
    });
    expect(m.tokens.find((r) => r.key === 'brand.accent')).toMatchObject({ status: 'defaulted', why: "the neutral starter's value" });
  });
});

describe('component rows', () => {
  const registry = (components: object[]) => ({ 'design-system/components.json': { schema: 1, components } });

  it('tell your reused components apart from fwos starter replacements, replacements and omissions', () => {
    const root = imported(
      Object.fromEntries(
        Object.entries(
          registry([
            { id: 'button', status: 'stable', source: 'shadcn', requiredStates: [] },
            { id: 'input', status: 'superseded', supersededBy: 'text-field', source: 'shadcn', requiredStates: [] },
            { id: 'text-field', status: 'stable', source: 'fwos', requiredStates: ['default'] },
            { id: 'badge', status: 'stable', source: 'fwos', requiredStates: [] },
            { id: 'table', status: 'removed', source: 'local', requiredStates: [] },
          ]),
        ).map(([k, v]) => [k, `${JSON.stringify(v)}\n`]),
      ),
    );
    const installed = ['badge', 'button', 'calendar', 'input', 'table', 'text-field'].map((id) => ({ id, file: `components/ui/${id}.tsx` }));
    const m = rowsOf(root, web(installed));
    const by = Object.fromEntries(m.components.map((c) => [c.key, { status: c.status, source: c.source?.file ?? null, target: c.target?.id ?? null, why: c.why }]));
    // One row per pair: the replacement is the row of the component it replaces.
    expect(by).toEqual({
      button: { status: 'preserved', source: 'components/ui/button.tsx', target: 'button', why: 'yours, reused as it is' },
      input: { status: 'approximated', source: 'components/ui/input.tsx', target: 'text-field', why: 'yours, replaced by text-field' },
      badge: { status: 'defaulted', source: null, target: 'badge', why: "fwos's starter component, not yours" },
      table: { status: 'unsupported', source: 'components/ui/table.tsx', target: null, why: 'yours, marked removed in components.json' },
      calendar: { status: 'unsupported', source: 'components/ui/calendar.tsx', target: null, why: 'yours, not in components.json, so nothing fwos builds uses it' },
    });
  });

  it('lists a registered component that is not installed yet, so its rows wait for the scaffold', () => {
    const m = rowsOf(imported());
    expect(m.components.find((c) => c.key === 'button')).toMatchObject({ status: 'defaulted', target: { id: 'button', file: null }, why: "fwos's starter component, not installed yet" });
  });
});
