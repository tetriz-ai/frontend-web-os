// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { afterAll, describe, expect, it } from 'vitest';
import { adapterSet, type CheckResult, loadProject, type StateObservation } from '../../../kernel/index.ts';
import { syntheticTestRun, cleanupTempProjects, contextFor, harnessProfile, installHarness, minimalState, recordRun, tempProject } from '../../../kernel/testing.ts';
import {
  checks,
  contrast,
  cssVariables,
  fromShadcn,
  hooks,
  importRows,
  importSummary,
  loadDesignSystem,
  nearestPassing,
  parseColor,
  parseDtcgColor,
  SLOTS,
  scanRawValues,
  starterFiles,
  themeCss,
  tokenOutputs,
  tokensCss,
  toHex,
} from '../index.ts';

afterAll(cleanupTempProjects);

const starter = () => Object.fromEntries(starterFiles().map((f) => [`design-system/${f.path}`, f.content]));
const run = async (id: string, root: string, profiles = adapterSet([])) =>
  (await checks.find((c) => c.id === id)!.run({ project: loadProject(root), adapters: profiles })) as CheckResult;

describe('colour', () => {
  it.each([
    ['#fff', '#ffffff'],
    ['#18181b', '#18181b'],
    ['rgb(255 0 0)', '#ff0000'],
    ['rgba(0, 0, 255, 0.5)', '#0000ff80'],
    ['hsl(120 100% 25%)', '#008000'],
    ['oklch(1 0 0)', '#ffffff'],
    ['oklch(0 0 0)', '#000000'],
    ['oklch(0.628 0.2577 29.23)', '#ff0000'],
    ['white', '#ffffff'],
  ])('parses %s', (input, hex) => {
    expect(toHex(parseColor(input)!)).toBe(hex);
  });

  it('rejects junk', () => {
    expect(parseColor('var(--x)')).toBeNull();
    expect(parseColor('#12')).toBeNull();
  });

  it('reads DTCG colour objects', () => {
    expect(toHex(parseDtcgColor({ colorSpace: 'srgb', components: [1, 0, 0] })!)).toBe('#ff0000');
    expect(toHex(parseDtcgColor({ colorSpace: 'hsl', components: [0, 0, 100] })!)).toBe('#ffffff');
    expect(toHex(parseDtcgColor({ colorSpace: 'display-p3', components: [1, 1, 1] })!)).toBe('#ffffff');
    expect(toHex(parseDtcgColor({ colorSpace: 'rec2020', components: [1, 1, 1], hex: '#ffffff' })!)).toBe('#ffffff');
    expect(parseDtcgColor({ colorSpace: 'rec2020', components: [1, 1, 1] })).toBeNull();
  });

  it('computes WCAG contrast', () => {
    expect(contrast(parseColor('#000')!, parseColor('#fff')!)).toBeCloseTo(21, 5);
    expect(contrast(parseColor('#777')!, parseColor('#fff')!)).toBeCloseTo(4.48, 2);
  });

  it('suggests the nearest passing shade', () => {
    const fix = nearestPassing(parseColor('#8b9cf0')!, parseColor('#ffffff')!, 4.5)!;
    expect(contrast(fix, parseColor('#ffffff')!)).toBeGreaterThanOrEqual(4.5);
  });

  it('suggests a shade that still passes as the hex the finding prints', () => {
    // Unrounded, each first shade reached 4.5:1, but its hex fell just short (#007e79 on #f4f4f5 was 4.484:1).
    for (const [fg, bg] of [['#28e553', '#f4f4f5'], ['#299994', '#f4f4f5'], ['#16b9be', '#fafafa'], ['#fea233', '#f4f4f5']] as const) {
      const fix = nearestPassing(parseColor(fg)!, parseColor(bg)!, 4.5)!;
      expect(contrast(parseColor(toHex(fix))!, parseColor(bg)!), `${fg} on ${bg} -> ${toHex(fix)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('lays a translucent background over the surface it sits on', () => {
    const veil = parseColor('rgb(255 255 255 / 0.05)')!;
    const night = parseColor('#09090b')!;
    expect(contrast(parseColor('#555555')!, veil, night)).toBeCloseTo(2.44, 2);
    expect(contrast(parseColor('#fafafa')!, veil, night)).toBeCloseTo(17.43, 2);
    expect(contrast(parseColor('#555555')!, veil)).toBeCloseTo(7.46, 2);
  });
});

describe('the neutral starter', () => {
  it('fills every required slot and passes every check', async () => {
    const root = tempProject(starter());
    const ds = loadDesignSystem(loadProject(root))!;
    expect(ds.errors).toEqual([]);
    expect(ds.missing).toEqual([]);
    expect((await run('design-system/schema', root)).status).toBe('pass');
    const c = await run('design-system/contrast', root);
    expect(c.findings).toEqual([]);
    expect(c.info).toEqual(['36 pairs measured']);
    expect((await run('design-system/chart-palette', root)).reason).toBe('chart palette blank (slot C9): chart colour check off');
  });

  it('generates CSS variables per mode and a slots-only Tailwind theme', () => {
    const ds = loadDesignSystem(loadProject(tempProject(starter())))!;
    const css = tokensCss(ds);
    expect(css).toContain('--ds-surface-base: #ffffff;');
    expect(css).toContain('--ds-state-hover: var(--ds-surface-subtle);');
    expect(css).toContain('--ds-type-body-size: 0.875rem;');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css.match(/--ds-radius-sm/g)).toHaveLength(1);
    const theme = themeCss(ds);
    expect(theme).toContain('--color-*: initial;');
    expect(theme).toContain('--color-surface: var(--ds-surface-base);');
    expect(theme).toContain('--text-body--line-height: var(--ds-type-body-line);');
    expect(theme).not.toContain('chart');
  });
});

describe('design-system/schema', () => {
  it('is off with no design system', async () => {
    expect((await run('design-system/schema', tempProject())).status).toBe('off');
  });

  it('counts one [ASSUMED] default in the singular', async () => {
    // The starter carries exactly one assumption.
    const r = await run('design-system/schema', tempProject(starter()));
    expect(r.info).toContain('1 [ASSUMED] default to confirm');
  });

  it('fails closed on an unsupported schema version', async () => {
    const root = tempProject({ ...starter(), 'design-system/design-system.json': { schema: 9, name: 'x', tokens: { modes: {} } } });
    const r = await run('design-system/schema', root);
    expect(r.status).toBe('fail');
    expect(r.findings[0]!.message).toMatch(/schema 9 unsupported/);
  });

  it('names blank required slots, broken aliases and unknown slot ids', async () => {
    const files = starter();
    const light = JSON.parse(files['design-system/tokens/light.json']!);
    delete light.color.surface.base;
    light.color.text.primary = { $value: '{color.nope}' };
    const ds = JSON.parse(files['design-system/design-system.json']!);
    ds.slots = { 'surface.made-up': 'color.x' };
    const root = tempProject({ ...files, 'design-system/tokens/light.json': light, 'design-system/design-system.json': ds });
    const r = await run('design-system/schema', root);
    const messages = r.findings.map((f) => f.message).join('\n');
    expect(messages).toMatch(/slots: "surface.made-up" isn't a slot/);
    expect(messages).toMatch(/refers to \{color.nope\}/);
    expect(r.status).toBe('fail');
  });

  it('follows a renamed token through the slots map', async () => {
    const files = starter();
    const light = JSON.parse(files['design-system/tokens/light.json']!);
    const dark = JSON.parse(files['design-system/tokens/dark.json']!);
    for (const t of [light, dark]) {
      t.color.canvas = { default: t.color.surface.base };
      delete t.color.surface.base;
    }
    const ds = JSON.parse(files['design-system/design-system.json']!);
    ds.slots = { 'surface.base': 'color.canvas.default' };
    const root = tempProject({
      ...files,
      'design-system/tokens/light.json': light,
      'design-system/tokens/dark.json': dark,
      'design-system/design-system.json': ds,
    });
    expect((await run('design-system/schema', root)).status).toBe('pass');
    expect(tokensCss(loadDesignSystem(loadProject(root))!)).toContain('--ds-surface-base: #ffffff;');
  });
});

describe('design-system/contrast', () => {
  it('fails a low-contrast pair and suggests a fix', async () => {
    const files = starter();
    const light = JSON.parse(files['design-system/tokens/light.json']!);
    light.color.text.muted = { $value: '#b4b4b4' };
    const r = await run('design-system/contrast', tempProject({ ...files, 'design-system/tokens/light.json': light }));
    expect(r.status).toBe('fail');
    expect(r.findings[0]!.message).toMatch(/^light: text.muted on surface.base is 2\.\d\d:1, under 4.5:1; nearest passing shade #[0-9a-f]{6}$/);
  });

  it('fails a pair just under 4.5:1 and passes one just over', async () => {
    const pair = async (muted: string) => {
      const files = starter();
      const light = JSON.parse(files['design-system/tokens/light.json']!);
      light.color.text.muted = { $value: muted };
      const r = await run('design-system/contrast', tempProject({ ...files, 'design-system/tokens/light.json': light }));
      return r.findings.filter((f) => f.rule === 'text.muted/surface.base').map((f) => f.message);
    };
    expect(await pair('#777777')).toEqual(['light: text.muted on surface.base is 4.48:1, under 4.5:1; nearest passing shade #767676']);
    expect(await pair('#767676')).toEqual([]);
  });

  it('passes a pair at exactly 4.5:1 and fails one just under it', async () => {
    // In floating point, this sRGB colour on the white surface comes to exactly 4.5:1.
    const exact = { colorSpace: 'srgb', components: [0.4653895821926819, 0.4653, 0.4653] };
    const under = { colorSpace: 'srgb', components: [0.4654, 0.4653, 0.4653] };
    expect(contrast(parseDtcgColor(exact)!, parseColor('#ffffff')!)).toBe(4.5);
    expect(contrast(parseDtcgColor(under)!, parseColor('#ffffff')!)).toBeLessThan(4.5);
    const pair = async (muted: unknown) => {
      const files = starter();
      const light = JSON.parse(files['design-system/tokens/light.json']!);
      light.color.text.muted = { $value: muted };
      const r = await run('design-system/contrast', tempProject({ ...files, 'design-system/tokens/light.json': light }));
      expect(r.status).not.toBe('off');
      return r.findings.filter((f) => f.rule === 'text.muted/surface.base').map((f) => f.message);
    };
    expect(await pair(exact)).toEqual([]);
    // A failing ratio never prints as 4.50:1, which would read as a pass.
    expect(await pair(under)).toEqual([expect.stringMatching(/^light: text\.muted on surface\.base is 4\.49:1, under 4\.5:1/)]);
  });

  it('gives the same answer on every Node version, however the last bit of the ratio falls', async () => {
    // A few bits above the exact pair, V8 makes this 4.499999999999999 before rounding: the value
    // Node 22 gave for the exact pair itself, where Node 24 gave 4.5.
    const noisy = { colorSpace: 'srgb', components: [0.4653895821926822, 0.4653, 0.4653] };
    expect(contrast(parseDtcgColor(noisy)!, parseColor('#ffffff')!)).toBe(4.5);
    const files = starter();
    const light = JSON.parse(files['design-system/tokens/light.json']!);
    light.color.text.muted = { $value: noisy };
    const r = await run('design-system/contrast', tempProject({ ...files, 'design-system/tokens/light.json': light }));
    expect(r.findings.filter((f) => f.rule === 'text.muted/surface.base')).toEqual([]);
  });

  it("measures a translucent dark surface over the dark base, not over white", async () => {
    const files = starter();
    const dark = JSON.parse(files['design-system/tokens/dark.json']!);
    dark.color.surface.subtle = { $value: 'rgb(255 255 255 / 0.05)' };
    dark.color.text.muted = { $value: '#555555' };
    const r = await run('design-system/contrast', tempProject({ ...files, 'design-system/tokens/dark.json': dark }));
    const onSubtle = r.findings.filter((f) => f.rule?.endsWith('/surface.subtle')).map((f) => f.message);
    // #808080 measures 4.61:1 there. The next shade down, #7e7e7e, measures 4.48:1 and would not pass.
    expect(onSubtle).toEqual(['dark: text.muted on surface.subtle is 2.44:1, under 4.5:1; nearest passing shade #808080']);
  });
});

describe('design-system/chart-palette', () => {
  it('turns on when filled and catches look-alikes and UI clashes', async () => {
    const files = starter();
    const light = JSON.parse(files['design-system/tokens/light.json']!);
    light.color.chart = {
      1: { $value: '#3b5bdb' },
      2: { $value: '#3c5cdc' },
      3: { $value: '#e8590c' },
      4: { $value: '#2f9e44' },
      other: { $value: '#868e96' },
    };
    const r = await run('design-system/chart-palette', tempProject({ ...files, 'design-system/tokens/light.json': light }));
    expect(r.status).toBe('fail');
    expect(r.findings.map((f) => f.rule)).toEqual(expect.arrayContaining(['too-alike', 'ui-colour']));
  });

  it('calls colours under 0.08 apart in OKLab too alike, and colours just over it distinct', async () => {
    // #3692ec is 0.064 from #1c7ed6, #3d99f3 is 0.085 from it; every other pair is far apart.
    const findings = async (second: string) => {
      const files = starter();
      const light = JSON.parse(files['design-system/tokens/light.json']!);
      light.color.chart = { 1: { $value: '#1c7ed6' }, 2: { $value: second }, 3: { $value: '#2b8a3e' }, 4: { $value: '#ae3ec9' }, other: { $value: '#868e96' } };
      return (await run('design-system/chart-palette', tempProject({ ...files, 'design-system/tokens/light.json': light }))).findings.map((f) => f.message);
    };
    expect(await findings('#3692ec')).toEqual(['light: chart.1 and chart.2 are too alike to tell apart in a chart']);
    expect(await findings('#3d99f3')).toEqual([]);
  });
});

describe('raw value scan', () => {
  const rules = (file: string, src: string) => scanRawValues(file, src).map((f) => `${f.rule}@${f.line}`);

  it('flags raw colours, palette classes, sizes, fonts and radii in TSX', () => {
    const src = [
      'export const A = () => (',
      '  <div className="bg-red-500 hover:text-white text-sm rounded-xl p-4 text-[13px]" style={{ color: "#ff0000", fontSize: 12 }}>',
      '    <span className="bg-[#123456] text-fg rounded-md">ok</span>',
      '  </div>',
      ');',
      "const c = 'oklch(0.5 0.1 200)';",
    ].join('\n');
    expect(rules('a.tsx', src)).toEqual([
      'palette-class@2',
      'palette-class@2',
      'raw-color@2',
      'raw-size@2',
      'raw-size@2',
      'raw-size@2',
      'raw-radius@2',
      'raw-color@3',
      'raw-color@6',
    ]);
  });

  it('leaves slot classes, comments, URLs and ignored lines alone', () => {
    const src = [
      '// bg-red-500 in a comment',
      "const url = 'https://example.com/#fff';",
      '<p className="bg-surface text-fg-muted text-body rounded-lg border-border">x</p>;',
      '/* text-sm */',
      '<i className="text-xs" /> // fwos-ignore tokens',
      '// fwos-ignore-next-line tokens',
      '<i className="bg-blue-600" />',
      "const anchor = '#add-item';",
    ].join('\n');
    expect(rules('b.tsx', src)).toEqual([]);
  });

  it('checks untrusted CSS custom properties and declarations but not selectors', () => {
    const css = [
      ':root { --ds-local: #fff; }',
      '#main:hover { color: #ff0000; background: var(--ds-surface-base); }',
      '.a { font-size: 14px; font-family: Inter, sans-serif; }',
      '.b { font-family: var(--ds-font-sans); border-color: rgb(0 0 0 / 10%); }',
      '.c { @apply text-lg; }',
    ].join('\n');
    expect(rules('x.css', css)).toEqual(['raw-color@1', 'raw-color@2', 'raw-size@3', 'raw-font@3', 'raw-color@4', 'raw-size@5']);
  });

  const messages = (file: string, src: string) => scanRawValues(file, src).map((f) => `${f.line} ${f.message}`);
  const JS = 'is a raw colour; use var(--ds-...) or a slot class';

  it("flags Tailwind's default palette through a variable, in a class, var(), theme() or --theme()", () => {
    const tsx = [
      '<div className="bg-(--color-red-500) hover:text-(color:--color-white)" />;',
      '<div className="bg-[var(--color-sky-950)] shadow-[0_0_0_1px_var(--color-black)]" />;',
      "const s = { color: 'var(--color-mauve-50)' };",
      '<div className="bg-(--color-surface) text-[var(--ds-text-primary)] border-(--color-red-550) bg-(--color-red-500-alt)" />;',
    ].join('\n');
    expect(rules('a.tsx', tsx)).toEqual(['palette-class@1', 'palette-class@1', 'palette-var@2', 'palette-var@2', 'palette-var@3']);
    const css = [
      '.a { color: var(--color-red-500); }',
      '.b { background: color-mix(in oklab, var( --color-blue-600) 50%, transparent); }',
      '.c { border-color: --theme(--color-zinc-200); outline-color: theme(colors.red.500); fill: theme("colors.white"); }',
      '.d { color: var(--color-fg); --color-red-500: var(--ds-brand-primary); @apply bg-(--color-emerald-700); }',
    ].join('\n');
    expect(rules('a.css', css)).toEqual(['palette-var@1', 'palette-var@2', 'palette-var@3', 'palette-var@3', 'palette-var@3', 'palette-class@4']);
    expect(messages('b.css', '.a { color: var(--color-red-500); }')).toEqual([
      "1 var(--color-red-500) uses Tailwind's default palette; use a slot colour (var(--ds-...), or a class such as bg-surface or text-fg)",
    ]);
  });

  it('finds a colour inside a longer string or arbitrary value', () => {
    const src = [
      'export const A = () => (',
      '  <div style={{ border: "1px solid #ff0000", boxShadow: "0 1px 2px rgba(0,0,0,.5)" }} className="shadow-[0_1px_2px_rgba(0,0,0,.5)]" />',
      ');',
      'const ring = `0 0 0 2px ${focus ? "#fff" : "oklch(0.5 0.1 200)"}`;',
    ].join('\n');
    expect(messages('a.tsx', src)).toEqual([
      '2 "shadow-[0_1px_2px_rgba(0,0,0,.5)]" hard-codes a colour; use a slot colour class',
      `2 #ff0000 in "1px solid #ff0000" ${JS}`,
      `2 rgba() in "0 1px 2px rgba(0,0,0,.5)" ${JS}`,
      `4 "#fff" ${JS}`,
      `4 "oklch(0.5 0.1 200)" ${JS}`,
    ]);
  });

  it('leaves hex-like and colour-like text that is not a colour alone', () => {
    const src = [
      "const order = 'Order #1234 shipped';",
      "const url = 'https://example.com/a#fff';",
      "const pick = 'Pick a color(s)';",
      "const anchor = '#add-item';",
      "const row = document.querySelector('#feed .item');",
      '<rect fill="url(#fade)" />;',
      '<p>Use #fff on red</p>;',
    ].join('\n');
    expect(messages('a.tsx', src)).toEqual([]);
    expect(messages('b.ts', 'const rule = `.a { color: #abc; }`;')).toEqual([`1 #abc in \`.a { color: #abc; }\` ${JS}`]);
  });

  it('finds named colours where a colour goes, and nowhere else', () => {
    const src = [
      '<p style={{ color: "red", border: "1px solid tomato" }} className="text-[red] bg-[color:navy]">The red fox</p>;',
      '<path fill="red" stroke="currentColor" />;',
      "const label = 'red';",
      "type Tone = { color: 'red' | 'blue' };",
      "const s = { color: 'transparent', background: 'url(red.png)', transition: 'color 0.2s', variant: 'red' };",
    ].join('\n');
    expect(messages('a.tsx', src)).toEqual([
      '1 "text-[red]" hard-codes a colour; use a slot colour class',
      '1 "bg-[color:navy]" hard-codes a colour; use a slot colour class',
      `1 "red" ${JS}`,
      `1 tomato in "1px solid tomato" ${JS}`,
      `2 "red" ${JS}`,
    ]);
    const css = [
      '.a { color: red; border: 1px solid RebeccaPurple; }',
      '.b { background: url(red.png) var(--red); transition: color 0.2s; fill: currentColor; outline-color: transparent; }',
      '.c:hover { --ds-x: red; content: "red"; }',
    ].join('\n');
    expect(messages('a.css', css)).toEqual(['1 red is a raw colour in CSS; use var(--ds-...)', '1 RebeccaPurple is a raw colour in CSS; use var(--ds-...)']);
  });

  it('finds raw radii and fonts outside Tailwind classes, and colour functions in any case', () => {
    const css = [
      '.a { border-radius: 7px; }',
      '.b { border-top-left-radius: 4px; -webkit-border-radius: 2px; border-start-end-radius: 1rem; }',
      '.c { font: 14px/1.5 Arial; }',
      '.d { color: RGB(255,0,0); }',
    ].join('\n');
    const RADIUS = 'is hard-coded; use var(--ds-radius-<size>)';
    expect(messages('a.css', css)).toEqual([
      `1 border-radius ${RADIUS}`,
      `2 border-top-left-radius ${RADIUS}`,
      `2 -webkit-border-radius ${RADIUS}`,
      `2 border-start-end-radius ${RADIUS}`,
      '3 font is hard-coded; use var(--ds-type-<role>-size) and var(--ds-font-sans) or var(--ds-font-mono)',
      '4 RGB() is a raw colour in CSS; use var(--ds-...)',
    ]);
    const tsx = [
      "const s = { borderRadius: 7, borderTopLeftRadius: '4px', font: '14px Arial', color: 'RGB(255,0,0)' };",
      '<p className="font-[Comic_Sans_MS]" style={{ font: "italic 12px \'Open Sans\'" }} />;',
    ].join('\n');
    const JS_RADIUS = 'is hard-coded; use rounded-sm, rounded-md, rounded-lg or rounded-full';
    const JS_FONT = 'font is hard-coded; use a type role class and font-sans or font-mono';
    expect(messages('a.tsx', tsx)).toEqual([
      `1 'RGB(255,0,0)' ${JS}`,
      `1 borderRadius ${JS_RADIUS}`,
      `1 borderTopLeftRadius ${JS_RADIUS}`,
      `1 ${JS_FONT}`,
      '2 "font-[Comic_Sans_MS]" hard-codes a font; use font-sans or font-mono',
      `2 ${JS_FONT}`,
    ]);
  });

  it('leaves token radii and fonts, zero and CSS-wide keywords alone', () => {
    const css = [
      ':root { --ds-radius-sm: 6px; --radius: 0.625rem; --font-display: 14px Arial; }',
      '.a { border-radius: var(--ds-radius-md); border-bottom-right-radius: 0; border-top-left-radius: 0px !important; }',
      '.b { font: inherit; border-radius: initial; border-top-right-radius: unset; border-top-left-radius: calc(var(--ds-radius-lg) / 2); }',
      '.c { font: var(--ds-type-body-size)/var(--ds-type-body-line) var(--ds-font-sans); }',
      '.d { font: 600 var(--ds-type-label-size) var(--ds-font-sans); }',
      '.font:hover { color: var(--ds-fg); }',
    ].join('\n');
    expect(messages('a.css', css)).toEqual([]);
    const tsx = [
      "const s = { borderRadius: 0, borderTopLeftRadius: 'var(--ds-radius-sm)', borderBottomLeftRadius: '0px', font: 'inherit', borderTopRightRadius: radius };",
      "const t = { fontFamily: 'var(--ds-font-sans)', fontSize: 'inherit', font: 'var(--ds-type-body-size) var(--ds-font-sans)' };",
      '<p className="font-sans font-mono font-[600] font-[var(--ds-font-sans)] rounded-md" />;',
      "type T = { font: 'sans' | 'mono' };",
    ].join('\n');
    expect(messages('a.tsx', tsx)).toEqual([]);
  });

  it('finds raw radii and fonts under quoted keys, in a font shorthand family, in a var() fallback and in a length hint', () => {
    const JS_RADIUS = 'is hard-coded; use rounded-sm, rounded-md, rounded-lg or rounded-full';
    const tsx = [
      "const a = { 'borderRadius': 7, \"borderTopLeftRadius\": '4px' };",
      'const b = { "font": "14px Arial" };',
      "const c = { 'fontFamily': 'Comic Sans MS' };",
      "const d = { 'fontSize': 14 };",
      '<p className="text-[length:14px]" />;',
    ].join('\n');
    expect(messages('a.tsx', tsx)).toEqual([
      `1 borderRadius ${JS_RADIUS}`,
      `1 borderTopLeftRadius ${JS_RADIUS}`,
      '2 font is hard-coded; use a type role class and font-sans or font-mono',
      '3 fontFamily is hard-coded; use font-sans or font-mono',
      '4 fontSize is hard-coded; use a type role class',
      '5 "text-[length:14px]" hard-codes a type size; use a type role',
    ]);
    const css = [
      '.a { font: var(--ds-type-body-size)/1.5 Arial; }',
      '.b { border-radius: var(--nope, 7px); }',
      '.c { font: var(--ds-type-body-size) var(--ds-font-sans, Georgia); }',
      '.d { font-family: var(--ds-font-sans, Arial); font-size: var(--ds-type-body-size, 14px); }',
    ].join('\n');
    expect(messages('a.css', css)).toEqual([
      '1 font is hard-coded; use var(--ds-type-<role>-size) and var(--ds-font-sans) or var(--ds-font-mono)',
      '2 border-radius is hard-coded; use var(--ds-radius-<size>)',
      '3 font is hard-coded; use var(--ds-type-<role>-size) and var(--ds-font-sans) or var(--ds-font-mono)',
      '4 font-family is hard-coded; use var(--ds-font-sans) or var(--ds-font-mono)',
      '4 font-size is hard-coded; use var(--ds-type-<role>-size)',
    ]);
  });

  it('leaves token fallbacks, a whole-shorthand variable and quoted keys with token values alone', () => {
    const css = [
      '.a { border-radius: var(--ds-radius-md, var(--ds-radius-sm)); border-top-left-radius: var(--x, 0); }',
      '.b { font: var(--ds-type-body); font-family: var(--ds-font-sans, var(--ds-font-mono)); }',
      '.c { font: 600 var(--ds-type-label-size)/var(--ds-type-label-line) var(--ds-font-sans); }',
      '.d { border-radius: var(--x,); font: calc(var(--ds-type-body-size) * 1.2) var(--ds-font-sans); }',
    ].join('\n');
    expect(messages('a.css', css)).toEqual([]);
    const tsx = [
      "const s = { 'borderRadius': 0, \"fontFamily\": 'var(--ds-font-sans)', 'fontSize': 'inherit', 'font': 'var(--ds-type-body-size) var(--ds-font-sans)' };",
      '<p className="text-[length:var(--ds-type-body-size)]" />;',
    ].join('\n');
    expect(messages('a.tsx', tsx)).toEqual([]);
  });

  it("flags Tailwind v4's shadow and ring colour utilities", () => {
    const src = '<div className="inset-shadow-red-500 inset-ring-red-500 drop-shadow-red-500 text-shadow-red-500 hover:drop-shadow-blue-600/50 drop-shadow-lg text-shadow-sm" />;';
    expect(scanRawValues('a.tsx', src).map((f) => f.message.split(' ')[0])).toEqual([
      '"inset-shadow-red-500"',
      '"inset-ring-red-500"',
      '"drop-shadow-red-500"',
      '"text-shadow-red-500"',
      '"hover:drop-shadow-blue-600"',
    ]);
  });

  it('flags a four-digit hex with alpha', () => {
    expect(messages('a.tsx', 'const s = { color: "#f00a" };')).toEqual([`1 "#f00a" ${JS}`]);
    expect(messages('a.css', '.a { color: #f00a; }')).toEqual(['1 #f00a is a raw colour in CSS; use var(--ds-...)']);
  });

  it('leaves a short hex alone when it is the value of href, to, id or key', () => {
    const src = [
      '<a href="#add">Add</a>;',
      "const link = { href: '#fab', to: '#bad' };",
      '<Link to="#cafe" key="#abc" id="#def" />;',
      "const c = { color: '#add' };",
      "const anchor = '#add';",
      "const swatch = { id: '#abcdef', key: '#c0ffee' };",
    ].join('\n');
    expect(messages('a.tsx', src)).toEqual([`4 '#add' ${JS}`, `5 '#add' ${JS}`, `6 '#abcdef' ${JS}`, `6 '#c0ffee' ${JS}`]);
  });

  it("flags every default palette of Tailwind 4.3, at every shade from 50 to 950", () => {
    const src = '<div className="bg-mauve-500 text-olive-700 border-mist-200 hover:ring-taupe-900 bg-red-50 text-slate-950" />;';
    expect(scanRawValues('a.tsx', src).map((f) => f.message.split(' ')[0])).toEqual([
      '"bg-mauve-500"',
      '"text-olive-700"',
      '"border-mist-200"',
      '"hover:ring-taupe-900"',
      '"bg-red-50"',
      '"text-slate-950"',
    ]);
  });

  const SIZE = 'font-size is hard-coded; use var(--ds-type-<role>-size)';
  const FAMILY = 'font-family is hard-coded; use var(--ds-font-sans) or var(--ds-font-mono)';
  const FONT = 'font is hard-coded; use var(--ds-type-<role>-size) and var(--ds-font-sans) or var(--ds-font-mono)';
  const RADIUS = 'is hard-coded; use var(--ds-radius-<size>)';

  it('reads a CSS size, font or radius as raw unless its whole value comes from tokens', () => {
    const css = [
      '.a { font-size: clamp(1rem,2vw,3rem); }',
      '.b { font-size: calc(1rem + 2px); }',
      '.c { font-size: large; }',
      '.d { FONT-SIZE: 14px; }',
      '.e { Font-Family: Arial; }',
      '.f { border-radius: var(--r) 4px; }',
      '.g { border-radius: calc(var(--r) + 4px); }',
      '.h { font-family: var(--ds-font-sans), Arial; }',
      '.i { font: var(--ds-type-body-size) var(--ds-font-sans) Arial; }',
      '.j { BORDER-RADIUS: 4px; font-size: var(--ds-type-body-size) 2px; }',
      '.k { font-size: calc(var(--ds-type-body-size) + 2px); border-top-left-radius: calc(var(--ds-radius-lg) - 2px); }',
      '.l { font: calc(var(--ds-type-body-size) + 1px) var(--ds-font-sans); }',
    ].join('\n');
    expect(messages('a.css', css)).toEqual([
      `1 ${SIZE}`,
      `2 ${SIZE}`,
      `3 ${SIZE}`,
      `4 ${SIZE}`,
      `5 ${FAMILY}`,
      `6 border-radius ${RADIUS}`,
      `7 border-radius ${RADIUS}`,
      `8 ${FAMILY}`,
      `9 ${FONT}`,
      `10 border-radius ${RADIUS}`,
      `10 ${SIZE}`,
      `11 ${SIZE}`,
      `11 border-top-left-radius ${RADIUS}`,
      `12 ${FONT}`,
    ]);
  });

  it('leaves arithmetic on tokens, several token radii and token keywords in any case alone', () => {
    const css = [
      '.a { font-size: calc(var(--ds-type-body-size) * 1.2); border-radius: calc(var(--ds-radius-lg) * 2) var(--ds-radius-sm); }',
      '.b { border-radius: max(var(--ds-radius-sm), var(--ds-radius-md)) / 0; font-size: VAR(--ds-type-body-size); }',
      '.c { font-family: revert; font-size: inherit; border-top-left-radius: calc((var(--a) + var(--b)) / 2); }',
      '.d { border-radius: var(--x, calc(var(--y) / 2)); font-size: min(var(--a), var(--b)); }',
    ].join('\n');
    expect(messages('a.css', css)).toEqual([]);
  });

  it('reads a style object value as raw unless its whole value comes from tokens', () => {
    const JS_SIZE = 'fontSize is hard-coded; use a type role class';
    const JS_FAMILY = 'fontFamily is hard-coded; use font-sans or font-mono';
    const JS_FONT = 'font is hard-coded; use a type role class and font-sans or font-mono';
    const JS_RADIUS = 'is hard-coded; use rounded-sm, rounded-md, rounded-lg or rounded-full';
    const tsx = [
      "const a = { fontSize: '.875rem' };",
      "const b = { fontSize: 'var(--x, 14px)' };",
      "const c = { fontFamily: 'var(--x, Arial)' };",
      "const d = { borderRadius: 'var(--r, 4px)' };",
      "const e = { font: 'var(--x) Arial' };",
      'const f = { fontSize: .875 };',
      "const g = { fontSize: 'clamp(1rem, 2vw, 3rem)', borderTopLeftRadius: `calc(var(--r) + 4px)` };",
    ].join('\n');
    expect(messages('a.tsx', tsx)).toEqual([
      `1 ${JS_SIZE}`,
      `2 ${JS_SIZE}`,
      `3 ${JS_FAMILY}`,
      `4 borderRadius ${JS_RADIUS}`,
      `5 ${JS_FONT}`,
      `6 ${JS_SIZE}`,
      `7 ${JS_SIZE}`,
      `7 borderTopLeftRadius ${JS_RADIUS}`,
    ]);
    const clean = [
      "const s = { fontSize: 'calc(var(--ds-type-body-size) * 1.2)', borderRadius: 'var(--ds-radius-md, var(--ds-radius-sm))' };",
      "const t = { fontFamily: 'var(--ds-font-sans, var(--ds-font-mono))', font: 'inherit', fontSize: `${size}px` };",
      "type U = { fontSize: '14px' | '16px'; font: 'sans' | 'mono' };",
    ].join('\n');
    expect(messages('a.tsx', clean)).toEqual([]);
  });

  it('flags an arbitrary type size that starts with a dot or a sum, but not arithmetic on a token', () => {
    const src = '<p className="text-[.875rem] leading-[clamp(1rem,2vw,3rem)] tracking-[calc(var(--ds-type-body-tracking)*2)]" />;';
    expect(scanRawValues('a.tsx', src).map((f) => f.message)).toEqual([
      '"text-[.875rem]" hard-codes a type size; use a type role',
      '"leading-[clamp(1rem,2vw,3rem)]" hard-codes a type size; use a type role',
    ]);
  });

  it('reads a percentage after a hex as a CSS cue, so the hex is a colour, but not a percentage in prose', () => {
    expect(messages('a.tsx', 'const stop = "#ff0000 50%";')).toEqual([`1 #ff0000 in "#ff0000 50%" ${JS}`]);
    expect(messages('a.tsx', 'const stops = "#fff 0%, #000 100%";')).toHaveLength(2);
    expect(messages('a.tsx', 'const order = "Order #1234 is 50% off";')).toEqual([]);
  });

  it('flags a raw var() fallback or a keyword in an arbitrary type or font class, and leaves tokens alone', () => {
    const raw = 'text-[length:var(--x,14px)] leading-[var(--x,20px)] leading-[var(--x,_1.5rem)] text-[length:large] font-[var(--x,Arial)] font-[family-name:var(--x,Arial)]';
    expect(scanRawValues('a.tsx', `<p className="${raw}" />;`).map((f) => f.message.split(' ')[0])).toEqual(raw.split(' ').map((c) => `"${c}"`));
    const tokens = 'text-[length:var(--ds-type-body-size)] leading-[var(--x)] font-[var(--ds-font-sans)] font-[family-name:var(--ds-font-sans)] font-[--ds-font-sans] font-[var(--w,600)] text-[var(--x,#fff)]';
    expect(scanRawValues('a.tsx', `<p className="${tokens}" />;`).filter((f) => f.rule !== 'raw-color')).toEqual([]);
  });

  it('reads fwos-ignore only in a comment, never in a string or text', () => {
    const src = [
      'const l = "fwos-ignore tokens"; const s = { color: "#ff0000" };',
      '<i className="text-xs" /> // fwos-ignoretokens',
      "const t = 'fwos-ignore-next-line tokens';",
      '<i className="bg-blue-600" />;',
      'export const P = () => <p>fwos-ignore tokens <b className="bg-red-500" /></p>;',
    ].join('\n');
    expect(rules('a.tsx', src)).toEqual(['raw-color@1', 'raw-size@2', 'palette-class@4', 'palette-class@5']);
    expect(rules('b.tsx', '{/* fwos-ignore-next-line tokens */}\n<i className="text-xs" />;')).toEqual([]);
    expect(rules('a.css', '.a { color: #fff; } /* fwos-ignore tokens */\n.b { content: "fwos-ignore tokens"; color: #fff; }')).toEqual(['raw-color@2']);
    expect(rules('a.scss', '.a { color: #fff; } // fwos-ignore tokens\n.b { color: #fff; }')).toEqual(['raw-color@2']);
    // An MDX import or export line is script, so a comment on it is a comment; prose is text.
    const mdx = 'export const C = () => <div className="bg-red-500" />; // fwos-ignore tokens\n\n# Title\n\nfwos-ignore tokens <b className="bg-red-500" />';
    expect(rules('a.mdx', mdx)).toEqual(['palette-class@5']);
    expect(rules('b.mdx', '// fwos-ignore-next-line tokens\nexport const C = () => <div className="bg-red-500" />;')).toEqual(['palette-class@2']);
    // A backtick with no closing run in its paragraph is just a backtick: the export after it is still script.
    expect(rules('c.mdx', `Press \` to open.\n\n${mdx.split('\n')[0]}\n\nSee \`x\`.`)).toEqual([]);
  });

  it('reads comment markers in JSX text as text', () => {
    expect(rules('a.tsx', '<p>Globs look like apps/*</p>;\nexport const B = () => <div className="bg-red-500" />;')).toEqual(['palette-class@2']);
    expect(rules('b.tsx', 'export const C = () => <><p>See http://example.com</p><div className="bg-red-500" /></>;')).toEqual(['palette-class@1']);
    expect(rules('c.tsx', 'export const D = () => <ul>{/* bg-red-500 */}</ul>; // text-sm')).toEqual([]);
  });

  it('stays fast on long lines', () => {
    const start = performance.now();
    scanRawValues('a.tsx', 'a:'.repeat(40_000));
    scanRawValues('a.css', 'a:'.repeat(40_000));
    scanRawValues('b.css', `.a { color:${'#fff'.repeat(32_000)} }`);
    scanRawValues('c.tsx', `<p className="${'text-[1'.repeat(10_000)}">x</p>;`);
    scanRawValues('d.tsx', '<a b={'.repeat(5_000));
    scanRawValues('f.css', `.a { color: ${'var(  --color-'.repeat(10_000)}${'theme( colors.'.repeat(10_000)} }`);
    scanRawValues('g.tsx', `<p className="${'bg-(--color-'.repeat(10_000)}" />;`);
    scanRawValues('e.css', `.a { border-radius: ${'var(--x, '.repeat(20_000)}7px${')'.repeat(20_000)}; font: ${'var(--y, '.repeat(20_000)}1px }`);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('design-system/tokens', () => {
  it('scans app source but skips tests and the generated token layer', async () => {
    const root = tempProject({
      'apps/web/src/a.tsx': '<div className="bg-red-500" />',
      'apps/web/src/a.test.tsx': '<div className="bg-red-500" />',
      'apps/web/src/b.stories.tsx': '<div className="bg-red-500" />',
      'packages/tokens/generated/tokens.css': '/* generated by fwos, do not edit. */\n:root { --ds-x: #fff; }',
      'apps/web/app/page.tsx': '<p className="text-fg" />',
    });
    const r = await run('design-system/tokens', root);
    expect(r.findings.map((f) => f.file)).toEqual(['apps/web/src/a.tsx']);
    expect(r.info).toEqual(['2 files scanned']);
  });

  it('gives app source no pass for a generated-file header', async () => {
    const root = tempProject({ 'apps/web/src/gen.css': '/* generated by fwos, do not edit. */\n.a { color: #fff; }' });
    expect((await run('design-system/tokens', root)).findings.map((f) => f.message)).toEqual(['#fff is a raw colour in CSS; use var(--ds-...)']);
  });

  it('scans Less, .mjs and MDX files', async () => {
    const root = tempProject({
      'apps/web/src/theme.less': '.a { color: #ff0000; }',
      'apps/web/src/util.mjs': "export const c = '#ff0000';",
      'apps/web/app/docs/page.mdx': "# Docs\n\nDon't use apps/* here.\n\n<Box className=\"bg-red-500\" />",
    });
    const r = await run('design-system/tokens', root);
    expect(r.findings.map((f) => `${f.file}:${f.line}`)).toEqual(['apps/web/app/docs/page.mdx:5', 'apps/web/src/theme.less:1', 'apps/web/src/util.mjs:1']);
  });

  it('scans app folders named like build output', async () => {
    const root = tempProject({ 'apps/web/src/features/coverage/index.tsx': '<div className="bg-red-500 text-[#123456]" />' });
    const r = await run('design-system/tokens', root);
    expect(r.findings.map((f) => `${f.file} ${f.rule}`)).toEqual([
      'apps/web/src/features/coverage/index.tsx palette-class',
      'apps/web/src/features/coverage/index.tsx raw-color',
    ]);
  });

  it('scans app folders named tests, and skips test files and test folders at a package root', async () => {
    const bad = '<div className="bg-red-500" />';
    const root = tempProject({
      'apps/web/src/features/tests/quiz.tsx': bad,
      'apps/web/src/features/quiz/quiz.test.tsx': bad,
      'apps/web/src/features/quiz/quiz.spec.mts': "export const c = '#ff0000';",
      'apps/web/src/__tests__/a.tsx': bad,
      'apps/web/src/kit/package.json': '{}',
      'apps/web/src/kit/tests/b.tsx': bad,
      'apps/web/src/kit/e2e/c.tsx': bad,
    });
    const r = await run('design-system/tokens', root);
    expect(r.findings.map((f) => f.file)).toEqual(['apps/web/src/features/tests/quiz.tsx']);
    expect(r.info).toEqual(['1 file scanned']);
  });

  it('gives edit-time feedback in an app folder named tests, but not in a test file', () => {
    const root = tempProject({ 'apps/web/package.json': '{}' });
    const edit = (path: string) =>
      hooks.postToolUse![0]!(
        { hook_event_name: 'PostToolUse', cwd: root, tool_name: 'Write', tool_input: { file_path: `${root}/${path}`, content: '<div className="bg-red-500" />' } },
        loadProject(root),
      );
    expect(edit('apps/web/src/features/tests/quiz.tsx')?.context).toMatch(/bg-red-500/);
    expect(edit('apps/web/src/features/quiz/quiz.test.tsx')).toBeNull();
  });

  it('is off with no source', async () => {
    expect((await run('design-system/tokens', tempProject())).status).toBe('off');
  });
});

describe('design-system/generated', () => {
  it('is off until built, then fails when an output is missing or stale', async () => {
    const root = tempProject(starter());
    const project = loadProject(root);
    // Never built (an adopted app): off with the fix, not a "missing" finding a baseline would hide.
    const never = await run('design-system/generated', root);
    expect(never.status).toBe('off');
    expect(never.reason).toMatch(/not generated yet .*fwos tokens build/);
    const outputs = tokenOutputs(project, loadDesignSystem(project)!);
    const files = Object.fromEntries(outputs.map((o) => [o.path, o.content]));
    const built = tempProject({ ...starter(), ...files });
    expect((await run('design-system/generated', built)).status).toBe('pass');
    const stale = tempProject({ ...starter(), ...files, 'packages/tokens/generated/tokens.css': 'old' });
    expect((await run('design-system/generated', stale)).findings.map((f) => f.rule)).toEqual(['drift']);
    const [kept, ...gone] = outputs;
    const partly = tempProject({ ...starter(), [kept!.path]: kept!.content });
    expect((await run('design-system/generated', partly)).findings.map((f) => f.rule)).toEqual(gone.map(() => 'missing'));
  });
});

describe('design-system/registry', () => {
  const adapter = (installed: { id: string; file: string }[]) =>
    adapterSet([
      {
        platform: 'web',
        status: 'supported',
        checks: [],
        tools: [],
        components: { platform: 'web', importFor: (id) => `@/shared/ui/${id}`, listInstalled: () => installed },
      },
    ]);

  it("counts any import into a superseded folder component as a use, but not the folder's own files", async () => {
    const root = tempProject({
      'design-system/components.json': {
        schema: 1,
        components: [
          { id: 'alert', status: 'stable', requiredStates: [] },
          { id: 'fancy', status: 'superseded', supersededBy: 'alert', requiredStates: [] },
        ],
      },
      'apps/web/src/shared/ui/alert.tsx': 'export const Alert = () => null;',
      'apps/web/src/shared/ui/fancy/index.tsx': "export { Fancy, FancyCard } from './fancy';",
      'apps/web/src/shared/ui/fancy/fancy.tsx': 'export const Fancy = () => null;\nexport const FancyCard = () => null;',
      'apps/web/src/shared/ui/index.ts': "export { Alert } from './alert';\nexport { FancyCard } from './fancy';",
      'apps/web/src/features/a/deep.tsx': "import { Fancy } from '@/shared/ui/fancy/fancy';",
      'apps/web/src/features/b/barrel.tsx': "import { FancyCard } from '@/shared/ui';",
      'apps/web/src/features/c/fine.tsx': "import { Alert } from '@/shared/ui';",
    });
    const r = await run(
      'design-system/registry',
      root,
      adapter([
        { id: 'alert', file: 'apps/web/src/shared/ui/alert.tsx' },
        { id: 'fancy', file: 'apps/web/src/shared/ui/fancy' },
      ]),
    );
    expect(r.findings.map((f) => `${f.rule}:${f.file}`)).toEqual(['superseded:apps/web/src/features/a/deep.tsx', 'superseded:apps/web/src/features/b/barrel.tsx']);
  });

  it('fails on unregistered, removed and superseded-in-use components', async () => {
    const root = tempProject({
      'design-system/components.json': {
        schema: 1,
        components: [
          { id: 'button', status: 'stable', requiredStates: [] },
          { id: 'old-button', status: 'superseded', supersededBy: 'button', requiredStates: [] },
          { id: 'gone', status: 'removed', requiredStates: [] },
        ],
      },
      'apps/web/src/features/x/view.tsx': "import { OldButton } from '@/shared/ui/old-button';",
    });
    const r = await run(
      'design-system/registry',
      root,
      adapter([
        { id: 'button', file: 'apps/web/src/shared/ui/button.tsx' },
        { id: 'mystery', file: 'apps/web/src/shared/ui/mystery.tsx' },
        { id: 'gone', file: 'apps/web/src/shared/ui/gone.tsx' },
      ]),
    );
    expect(r.findings.map((f) => f.rule)).toEqual(['unregistered', 'removed', 'superseded']);
    expect(r.findings[2]!.message).toBe('imports superseded component "old-button"; use "button"');
  });

  it('catches a retired component through the barrel, a relative path, an extension or a dynamic import', async () => {
    const root = tempProject({
      'design-system/components.json': {
        schema: 1,
        components: [
          { id: 'button', status: 'stable', requiredStates: [] },
          { id: 'card', status: 'stable', requiredStates: [] },
          { id: 'old-button', status: 'superseded', supersededBy: 'button', requiredStates: [] },
          { id: 'gone', status: 'removed', requiredStates: [] },
        ],
      },
      'apps/web/src/shared/ui/index.ts': "export { Button } from './button';\nexport { Card } from './card';\nexport { OldButton, type OldButtonProps } from './old-button';\n",
      'apps/web/src/shared/ui/button.tsx': 'export const Button = () => null;\n',
      'apps/web/src/shared/ui/card.tsx': 'export const Card = () => null;\n',
      'apps/web/src/shared/ui/old-button.tsx': 'export type OldButtonProps = {};\nexport function OldButton() {\n  return null;\n}\n',
      'apps/web/src/features/a/barrel.tsx': "import { Button, OldButton } from '@/shared/ui';\n",
      'apps/web/src/features/a/barrel-type.tsx': "import type { OldButtonProps } from '@/shared/ui/index';\n",
      'apps/web/src/features/a/relative.tsx': "import { OldButton } from '../../shared/ui/old-button';\n",
      'apps/web/src/features/a/relative-barrel.tsx': "import { OldButton as B } from '../../shared/ui';\n",
      'apps/web/src/features/a/extension.tsx': "import { OldButton } from '@/shared/ui/old-button.tsx';\n",
      'apps/web/src/features/a/dynamic.tsx': "const B = lazy(() => import('@/shared/ui/old-button'));\n",
      'apps/web/src/features/a/uses-gone.tsx': "import { Gone } from '@/shared/ui';\n",
      'apps/web/src/features/a/clean.tsx': [
        "import { Button, Card } from '@/shared/ui';",
        "import { Card as C } from '../../shared/ui/card';",
        "// import { OldButton } from '@/shared/ui';",
        "const s = \"import { OldButton } from '@/shared/ui/old-button'\";",
        '',
      ].join('\n'),
    });
    const r = await run(
      'design-system/registry',
      root,
      adapter([
        { id: 'button', file: 'apps/web/src/shared/ui/button.tsx' },
        { id: 'card', file: 'apps/web/src/shared/ui/card.tsx' },
        { id: 'old-button', file: 'apps/web/src/shared/ui/old-button.tsx' },
      ]),
    );
    expect(r.findings.map((f) => `${f.file} ${f.rule}`)).toEqual([
      'apps/web/src/features/a/barrel-type.tsx superseded',
      'apps/web/src/features/a/barrel.tsx superseded',
      'apps/web/src/features/a/dynamic.tsx superseded',
      'apps/web/src/features/a/extension.tsx superseded',
      'apps/web/src/features/a/relative-barrel.tsx superseded',
      'apps/web/src/features/a/relative.tsx superseded',
      'apps/web/src/features/a/uses-gone.tsx removed',
    ]);
    expect(r.findings.at(-1)!.message).toBe('imports removed component "gone"');
  });

  const retiredUi = {
    'design-system/components.json': {
      schema: 1,
      components: [
        { id: 'button', status: 'stable', requiredStates: [] },
        { id: 'old-button', status: 'superseded', supersededBy: 'button', requiredStates: [] },
      ],
    },
    'apps/web/src/shared/ui/index.ts': "export { Button } from './button';\nexport { OldButton } from './old-button';\n",
    'apps/web/src/shared/ui/button.tsx': 'export const Button = () => null;\n',
    'apps/web/src/shared/ui/old-button.tsx': 'export const OldButton = () => null;\n',
  };
  const installedUi = [
    { id: 'button', file: 'apps/web/src/shared/ui/button.tsx' },
    { id: 'old-button', file: 'apps/web/src/shared/ui/old-button.tsx' },
  ];

  it('resolves import paths the way TypeScript does: paths, odd spellings and a namespace import of the barrel', async () => {
    const root = tempProject({
      ...retiredUi,
      'apps/web/tsconfig.json': { compilerOptions: { paths: { '@/*': ['./src/*'], '~/*': ['./src/*'] } } },
      'apps/web/src/legacy/old-button.tsx': 'export const OldButton = () => null;\n',
      'apps/web/src/features/a/tilde.tsx': "import { OldButton } from '~/shared/ui/old-button';\n",
      'apps/web/src/features/a/trailing-slash.tsx': "import { OldButton } from '@/shared/ui/';\n",
      'apps/web/src/features/a/dot-segment.tsx': "import { OldButton } from '@/shared/ui/./old-button';\n",
      'apps/web/src/features/a/double-slash.tsx': "import { OldButton } from '@/shared//ui/old-button';\n",
      'apps/web/src/features/a/namespace.tsx': "import * as UI from '@/shared/ui';\nexport const V = () => <UI.OldButton />;\n",
      'apps/web/src/features/a/clean.tsx': "import { Button } from '~/shared/ui/';\nimport { OldButton } from '@/legacy/old-button';\nexport const V = () => <Button><OldButton /></Button>;\n",
    });
    const r = await run('design-system/registry', root, adapter(installedUi));
    expect(r.findings.map((f) => `${f.file} ${f.rule}`)).toEqual([
      'apps/web/src/features/a/dot-segment.tsx superseded',
      'apps/web/src/features/a/double-slash.tsx superseded',
      'apps/web/src/features/a/namespace.tsx superseded',
      'apps/web/src/features/a/tilde.tsx superseded',
      'apps/web/src/features/a/trailing-slash.tsx superseded',
    ]);
  });

  it('resolves a bare path through baseUrl, and lets a namespace import of a barrel without the component pass', async () => {
    const root = tempProject({
      ...retiredUi,
      'apps/web/tsconfig.json': { compilerOptions: { baseUrl: 'src' } },
      'apps/web/src/features/a/base-url.tsx': "import { OldButton } from 'shared/ui/old-button';\n",
    });
    const r = await run('design-system/registry', root, adapter(installedUi));
    expect(r.findings.map((f) => `${f.file} ${f.rule}`)).toEqual(['apps/web/src/features/a/base-url.tsx superseded']);
    const clean = tempProject({
      ...retiredUi,
      'apps/web/src/shared/ui/index.ts': "export { Button } from './button';\n",
      'apps/web/src/features/a/namespace.tsx': "import * as UI from '@/shared/ui';\nexport const V = () => <UI.Button />;\n",
    });
    expect((await run('design-system/registry', clean, adapter(installedUi))).status).toBe('pass');
  });

  it('reads importers in every script form, .mjs, .cjs, .mts and .cts too', async () => {
    const root = tempProject({
      ...retiredUi,
      'apps/web/src/features/a/esm.mjs': "import { OldButton } from '@/shared/ui/old-button';\n",
      'apps/web/src/features/a/common.cjs': "const { OldButton } = require('@/shared/ui/old-button');\n",
      'apps/web/src/features/a/module.mts': "import { OldButton } from '@/shared/ui/old-button';\n",
      'apps/web/src/features/a/common.cts': "import { OldButton } from '@/shared/ui';\n",
    });
    const r = await run('design-system/registry', root, adapter(installedUi));
    expect(r.findings.map((f) => `${f.file} ${f.rule}`)).toEqual([
      'apps/web/src/features/a/common.cjs superseded',
      'apps/web/src/features/a/common.cts superseded',
      'apps/web/src/features/a/esm.mjs superseded',
      'apps/web/src/features/a/module.mts superseded',
    ]);
  });

  it('reads the imports of MDX files, and not their prose', async () => {
    const root = tempProject({
      ...retiredUi,
      'apps/web/app/docs/page.mdx': "# Buttons\n\nPress ` to search.\n\nimport { OldButton } from '@/shared/ui/old-button'\n\n<OldButton />\n",
      'apps/web/src/features/a/guide.mdx': "import { Button } from '@/shared/ui'\n\nYou could import { OldButton } from '@/shared/ui', but don't.\n\n<Button />\n",
    });
    const r = await run('design-system/registry', root, adapter(installedUi));
    expect(r.findings.map((f) => `${f.file} ${f.rule}`)).toEqual(['apps/web/app/docs/page.mdx superseded']);
  });

  it('reads the import after a lone backtick in JSX text or a backtick inside a template literal', async () => {
    const root = tempProject({
      ...retiredUi,
      'apps/web/src/features/a/hint.tsx': "export const Hint = () => <p>Press ` to search</p>;\nimport { OldButton } from '@/shared/ui/old-button';\n",
      'apps/web/src/features/a/label.ts': "export const label = (n: number) => `${n} ${`}`}`;\nimport { OldButton } from '@/shared/ui';\n",
      'apps/web/src/features/a/clean.tsx': "export const Note = () => <p>import {'{'} OldButton {'}'} from '@/shared/ui/old-button'</p>;\n",
    });
    const r = await run('design-system/registry', root, adapter(installedUi));
    expect(r.findings.map((f) => `${f.file} ${f.rule}`)).toEqual(['apps/web/src/features/a/hint.tsx superseded', 'apps/web/src/features/a/label.ts superseded']);
  });

  it('is off without an adapter', async () => {
    const root = tempProject({ 'design-system/components.json': { schema: 1, components: [] } });
    expect((await run('design-system/registry', root)).reason).toMatch(/no component adapter/);
  });
});

describe('design-system/required-states', () => {
  const comps = {
    'design-system/components.json': {
      schema: 1,
      components: [{ id: 'button', status: 'stable', requiredStates: ['default', 'loading'] }],
    },
  };

  it('is off until tests have run', async () => {
    expect((await run('design-system/required-states', tempProject(comps))).reason).toMatch(/run the tests first/);
  });

  it('needs a passing render test per state', async () => {
    const xml = `<testsuites><testsuite name="ui">
      <testcase classname="button" name="renders default @state:button:default"/>
      <testcase classname="button" name="renders loading @state:button:loading"><failure message="expected spinner"/></testcase>
    </testsuite></testsuites>`;
    const r = await run('design-system/required-states', tempProject({ ...comps, '.fwos/local/results/vitest.xml': xml }));
    expect(r.findings.map((f) => f.message)).toEqual(['button "loading" state: its test fails (expected spinner)']);
  });

  // Tags alone vouch for nothing rendering: with no harness to render the fixtures, it's off and says so.
  it('says what it counts: a passing tagged test, whose rendering it trusts, is not a pass on its own', async () => {
    const xml = (cases: string) => `<testsuites><testsuite name="ui">${cases}</testsuite></testsuites>`;
    const missing = await run('design-system/required-states', tempProject({ ...comps, '.fwos/local/results/vitest.xml': xml('<testcase classname="button" name="renders @state:button:default"/>') }));
    expect(missing.findings.map((f) => f.message)).toEqual(['button "loading" state: no passing test is tagged @state:button:loading (tag the test that renders it)']);
    const both = xml('<testcase classname="button" name="a @state:button:default"/><testcase classname="button" name="b @state:button:loading"/>');
    const r = await run('design-system/required-states', tempProject({ ...comps, '.fwos/local/results/vitest.xml': both }));
    expect(r).toMatchObject({
      status: 'off',
      reason: '2 required states have a passing tagged test (fwos trusts the tag, not what the test renders), but nothing shows them rendering: no platform here has a harness that renders state fixtures',
    });
  });

  describe('render proofs', () => {
    const tags = '<testsuite><testcase classname="button" name="a @state:button:default"/><testcase classname="button" name="b @state:button:loading"/></testsuite>';
    const seen = (state: string, over: Partial<StateObservation> = {}): StateObservation => ({
      state,
      status: 200,
      found: true,
      nodes: 2,
      text: 'Save',
      busy: 0,
      alerts: [],
      statuses: [],
      items: [],
      disabled: 0,
      invalid: 0,
      ...over,
    });
    const app = (step = 'build') => {
      const root = tempProject({
        ...comps,
        '.fwos/state.json': minimalState(),
        '.fwos/changes/0001-initial.json': { schema: 1, id: '0001-initial', title: 'Initial app', route: 'initial', step, status: 'open', createdAt: '2026-10-07', approvals: {} },
        'apps/web/src/shared/ui/button.tsx': 'export const Button = () => null;\n',
        '.fwos/local/results/vitest.xml': tags,
      });
      installHarness(root);
      syntheticTestRun(root);
      return root;
    };
    const check = (root: string) => run('design-system/required-states', root, adapterSet([harnessProfile()]));

    it('passes a required state whose tagged test passes and whose fixture renders as its contract says', async () => {
      const root = app();
      recordRun(root, 'states', 'component.button', [seen('default'), seen('loading', { busy: 1, disabled: 1, text: 'Save Loading' })]);
      const r = await check(root);
      expect(r.status).toBe('pass');
      expect(r.info?.[0]).toBe('2 required states render as their contract says, with a passing tagged test');
    });

    // The issue 17 reproduction: tests named for the state pass while the button renders as if idle.
    it('fails a loading button that is not busy, whatever its tagged test asserts', async () => {
      const root = app();
      recordRun(root, 'states', 'component.button', [seen('default'), seen('loading', { disabled: 1 })]);
      expect((await check(root)).findings.map((f) => f.message)).toEqual([
        'button "loading" state: nothing is marked aria-busy="true". A "loading" state renders something marked aria-busy="true", no alert, none of the ready state\'s content',
      ]);
    });

    it('fails at acceptance when no fresh run rendered a required state', async () => {
      const root = app('accept');
      expect((await check(root)).findings.map((f) => f.message)).toEqual([
        'button "default" state: no fresh render proof (no run of the harness has recorded it; run the end-to-end tests)',
        'button "loading" state: no fresh render proof (no run of the harness has recorded it; run the end-to-end tests)',
      ]);
    });
  });
});

describe('shadcn intake', () => {
  // Values from shadcn/ui's default theme (MIT, Copyright (c) 2023 shadcn). See NOTICE.
  const globals = `
@import "tailwindcss";
:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.45 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}
.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
}`;

  it('maps a shadcn theme onto the slots and tags every guess', async () => {
    const files = fromShadcn(globals, 'Acme');
    const root = tempProject(Object.fromEntries(files.map((f) => [`design-system/${f.path}`, f.content])));
    const ds = loadDesignSystem(loadProject(root))!;
    expect(ds.errors).toEqual([]);
    expect(ds.missing).toEqual([]);
    expect(ds.config.name).toBe('Acme');
    expect(tokensCss(ds)).toContain('--ds-brand-primary: oklch(0.205 0 0);');
    expect(tokensCss(ds)).toContain('--ds-radius-sm: 6px;');
    expect(ds.config.assumed).toEqual(
      expect.arrayContaining([
        'status.success: shadcn has no success colours; kept the neutral starter pair',
        'text.secondary: taken from --muted-foreground (shadcn has no exact match)',
      ]),
    );
    expect((await run('design-system/schema', root)).status).toBe('pass');
  });

  it('rejects a file with no :root block', () => {
    expect(() => fromShadcn('.x { color: red }')).toThrow(/No `:root/);
  });

  // Schema and contrast passing says the result is valid, not that it is the source: the report
  // says where every slot came from, and what the source had that no slot took.
  describe('the import report', () => {
    const extra = globals
      .replace('--radius: 0.625rem;', '--radius: 0.625rem;\n  --popover: oklch(1 0 0);\n  --sidebar: oklch(0.985 0 0);')
      .replace('--border: oklch(1 0 0 / 10%);', '--border: oklch(1 0 0 / 10%);\n  --sidebar: oklch(0.205 0 0);')
      .concat('\n@theme inline { --color-background: var(--background); }');
    const files = fromShadcn(extra, 'Acme', 'app/globals.css');
    const rows = importRows(extra);
    const row = (key: string) => rows.find((r) => r.target === key || r.source === key);

    it('says where every slot came from: preserved, approximated or defaulted, with the value it got in each mode', () => {
      expect(rows.filter((r) => r.target).map((r) => r.target)).toEqual(SLOTS.map((s) => s.token));
      expect(row('color.surface.base')).toEqual({ target: 'color.surface.base', source: '--background', light: 'oklch(1 0 0)', dark: 'oklch(0.145 0 0)', status: 'preserved', why: '' });
      expect(row('color.surface.interactive')).toMatchObject({ source: '--secondary', light: 'oklch(0.97 0 0)', status: 'approximated', why: 'shadcn has no exact match; dark: no --secondary, so the light value' });
      expect(row('color.text.disabled')).toMatchObject({ source: null, light: '#a1a1aa', dark: '#52525b', status: 'defaulted', why: "the neutral starter's value" });
      expect(row('color.state.focus')).toMatchObject({ source: '--ring', light: 'oklch(0.708 0 0)', dark: 'oklch(0.708 0 0)', status: 'approximated' });
      expect(row('color.state.selected')).toMatchObject({ source: null, light: 'same as surface.interactive', status: 'defaulted', why: "the slot's fallback" });
      expect(row('font.sans')).toMatchObject({ source: null, status: 'defaulted', why: "no --font-sans in the theme; the neutral starter's value" });
      expect(row('radius.sm')).toMatchObject({ source: '--radius', light: '6px', dark: 'same', status: 'preserved', why: "shadcn's ladder, --radius - 4px" });
      expect(row('type.body')).toMatchObject({ source: null, light: '0.875rem/1.25rem 400', status: 'defaulted', why: "the slot's fallback" });
    });

    it('lists what the source had that no slot took, from the blocks it reads', () => {
      expect(rows.filter((r) => r.status === 'unsupported')).toEqual([
        { target: null, source: '--popover', light: 'oklch(1 0 0)', dark: '', status: 'unsupported', why: 'no slot takes it' },
        { target: null, source: '--sidebar', light: 'oklch(0.985 0 0)', dark: 'oklch(0.205 0 0)', status: 'unsupported', why: 'no slot takes it' },
      ]);
    });

    it('counts each status, and keeps the theme it read beside the design system instead of a one-off report', () => {
      const count = (s: string) => rows.filter((r) => r.status === s).length;
      expect(importSummary(rows)).toBe(`${count('preserved')} preserved, ${count('approximated')} approximated, ${count('defaulted')} defaulted, ${count('unsupported')} unsupported`);
      // The mapping is computed from this copy whenever it is asked for (see adoption.test.ts).
      expect(files.find((f) => f.path === 'source/globals.css')?.content).toBe(extra);
      expect(files.some((f) => f.path === 'import-report.md')).toBe(false);
      expect(starterFiles().some((f) => f.path.startsWith('source/'))).toBe(false);
    });
  });

  it('keeps the neutral starter for dark mode when the theme has no .dark block', async () => {
    const charts = ['0.646 0.222 41.116', '0.6 0.118 184.704', '0.398 0.07 227.392', '0.828 0.189 84.429', '0.769 0.188 70.08'];
    const lightOnly = globals
      .slice(0, globals.indexOf('.dark'))
      .replace('}', `${charts.map((c, i) => `  --chart-${i + 1}: oklch(${c});`).join('\n')}\n}`);
    const files = fromShadcn(lightOnly, 'Light only');
    const tokens = (list: { path: string; content: string }[]) => JSON.parse(list.find((f) => f.path === 'tokens/dark.json')!.content);
    const dark = tokens(files);
    const starterDark = tokens(starterFiles());
    for (const group of Object.keys(starterDark.color)) expect(dark.color[group]).toEqual(starterDark.color[group]);
    // The starter has no state or chart tokens: hover and focus get the fallbacks the slots name, and the
    // chart colours, which have none, reuse the light values.
    expect(dark.color.state).toEqual({ hover: { $value: '{color.surface.subtle}' }, focus: { $value: '{color.brand.primary}' } });
    expect(Object.values(dark.color.chart)).toEqual(charts.map((c) => ({ $value: `oklch(${c})` })));
    const root = tempProject(Object.fromEntries(files.map((f) => [`design-system/${f.path}`, f.content])));
    const ds = loadDesignSystem(loadProject(root))!;
    expect(ds.errors).toEqual([]);
    expect(ds.config.assumed).toContain('no .dark block: dark mode kept the neutral starter values; review them');
    expect(ds.config.assumed).toContain('chart.1: no .dark block, so dark mode reuses the light value');
    expect(ds.config.assumed!.filter((a) => a.includes('reused the light one'))).toEqual([]);
    expect((await run('design-system/schema', root)).status).toBe('pass');
    const r = await run('design-system/contrast', root);
    expect(r.findings.filter((f) => f.message.startsWith('dark:'))).toEqual([]);
  });

  const file = (list: { path: string; content: string }[], path: string) => JSON.parse(list.find((f) => f.path === path)!.content);

  it('reads @media (prefers-color-scheme: dark) as the dark mode, as it reads a .dark block', () => {
    const viaClass = fromShadcn(globals);
    for (const media of ['@media (prefers-color-scheme: dark)', '@media screen and (prefers-color-scheme:dark)']) {
      for (const selector of [':root', ':root:not(.light)']) {
        const viaMedia = fromShadcn(globals.replace('.dark {', `${media} {\n${selector} {`).concat('\n}'));
        for (const path of ['tokens/light.json', 'tokens/dark.json', 'design-system.json']) expect(file(viaMedia, path), `${media} ${selector}: ${path}`).toEqual(file(viaClass, path));
      }
    }
    const viaMedia = fromShadcn(globals.replace('.dark {', '@media (prefers-color-scheme: dark) {\n:root {').concat('\n}'));
    expect(file(viaMedia, 'tokens/light.json').color.surface.base).toEqual({ $value: 'oklch(1 0 0)' });
    expect(file(viaMedia, 'tokens/dark.json').color.surface.base).toEqual({ $value: 'oklch(0.145 0 0)' });
    expect(file(viaMedia, 'design-system.json').assumed.filter((a: string) => a.includes('.dark block'))).toEqual([]);
  });

  it('reads :root through @layer, and keeps a :root inside any other at-rule out of the light mode', () => {
    const plain = fromShadcn(globals);
    const layered = fromShadcn(`@layer base {\n${globals}\n}`);
    const conditional = fromShadcn(`${globals}\n@media (min-width: 640px) { :root { --background: oklch(0.5 0 0); --radius: 1rem; } }\n@supports (color: red) { :root { --primary: red; } }`);
    for (const path of ['tokens/light.json', 'tokens/dark.json', 'tokens/base.json']) {
      expect(file(layered, path), path).toEqual(file(plain, path));
      expect(file(conditional, path), path).toEqual(file(plain, path));
    }
  });

  it('reads a semicolon or brace in a string as text', () => {
    const vars = cssVariables(':root { --font-sans: "A;B", sans-serif; --x: url("a{b}.svg"); --background: #fff }');
    expect(Object.fromEntries(vars.get(':root')!)).toEqual({ 'font-sans': '"A;B", sans-serif', x: 'url("a{b}.svg")', background: '#fff' });
  });

  it('stays fast on long input', () => {
    const start = performance.now();
    cssVariables('a'.repeat(40_000));
    cssVariables(`:root { ${'-'.repeat(40_000)} }`);
    cssVariables('@media a {'.repeat(10_000));
    cssVariables('/*'.repeat(20_000));
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('adopt mode', () => {
  const adopted = (files: Record<string, unknown> = {}) => tempProject({ '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'adopt', platforms: ['web'] }, ...files });

  it('names the command that writes the design system, not a step an adopted app never runs', async () => {
    for (const id of ['design-system/schema', 'design-system/contrast', 'design-system/chart-palette', 'design-system/generated']) {
      const r = await run(id, adopted());
      expect(r.status, id).toBe('off');
      expect(r.reason, id).toBe('no design-system/design-system.json yet; `fwos design-system init` writes it (add `--from-shadcn <globals.css>` to start from your shadcn theme)');
    }
    expect((await run('design-system/schema', tempProject())).reason).toBe('no design-system/design-system.json yet; the design-system step writes it');
  });

  it("doesn't send an adopted app to the scaffold for its components", async () => {
    const files = { 'design-system/components.json': { schema: 1, components: [] } };
    const web = adapterSet([{ platform: 'web', status: 'supported', checks: [], tools: [], components: { platform: 'web', importFor: (id) => `@/shared/ui/${id}`, listInstalled: () => [] } }]);
    expect((await run('design-system/registry', adopted(files), web)).reason).toBe('no components installed yet (components elsewhere: set paths.ui in .fwos/state.json)');
    expect((await run('design-system/registry', tempProject(files), web)).reason).toMatch(/the scaffold adds the starter set/);
  });
});

void contextFor;
