// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// A second pack, hand-built to differ from the sample's on every seam (examples/second-pack): its
// own component IDs and states, roles and flags, route shapes, modules, rule overrides and two
// surfaces with token systems of their own. The same fwos bundle follows it with no change to its
// code: every check doctor calls ON passes the app the pack describes and fails the violation
// planted for it, a file of the first pack put in place of the second's fails on the second's own
// names, and what fwos generates follows each surface's tokens.

import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import { syntheticTestRun } from '../../plugin/kernel/testing.ts';
import { walkFiles } from '../../plugin/kernel/index.ts';
import { commitAll, fwos, proveDoctor } from './support/truth.ts';

const REPO = new URL('../../', import.meta.url).pathname;
/** The first pack: the sample app every gate is tested against. */
const FIRST = 'examples/reading-list';
const SECOND = 'examples/second-pack';
const SURFACES = ['console', 'site'] as const;

const work = mkdtempSync(join(tmpdir(), 'fwos-second-pack-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

let copies = 0;
/** A copy of an example folder as git has it (tracked files, and new ones it doesn't ignore). */
function copy(rel: string): string {
  const to = join(work, String(copies++));
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', rel], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of files) {
    mkdirSync(dirname(join(to, f.slice(rel.length + 1))), { recursive: true });
    copyFileSync(join(REPO, f), join(to, f.slice(rel.length + 1)));
  }
  syntheticTestRun(to); // Explicit unit-fixture evidence, never a real app execution.
  return to;
}

const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');
const json = <T = any>(root: string, rel: string): T => JSON.parse(read(root, rel)) as T;
const write = (root: string, rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

interface Page {
  id: string;
  route?: string;
  kind: string;
  states: string[];
  visibleTo?: string[];
  flag?: string;
}

/** A project's pack, found where its .fwos/state.json says. */
function pack(root: string) {
  const paths = json<{ paths?: Record<string, any> }>(root, '.fwos/state.json').paths ?? {};
  const docs: string = paths.docs ?? 'docs/app';
  const ds: string = paths.designSystem ?? 'design-system';
  const design = json<{ name: string; tokens: { modes: Record<string, string[]> }; defaultMode?: string; slots?: Record<string, string>; components?: string }>(root, `${ds}/design-system.json`);
  return {
    app: (paths.apps?.web as string | undefined) ?? 'apps/web',
    ui: (paths.ui?.web as string | undefined) ?? 'apps/web/src/shared/ui',
    docs,
    ds,
    ia: json<{ roles: string[]; flags?: string[]; pages: Page[] }>(root, `${docs}/ia.json`),
    modules: json<{ modules: { name: string }[] }>(root, `${docs}/modules.json`).modules.map((m) => m.name),
    components: json<{ components: { id: string; requiredStates: string[] }[] }>(root, `${ds}/${design.components ?? 'components.json'}`).components,
    design,
    rules: parseYaml(read(root, `${ds}/rules.yaml`)) as { rules?: Record<string, unknown> | null; custom?: { id: string }[] | null },
  };
}

/** The kinds of route a page list has. */
function routeShapes(pages: Page[]): Set<string> {
  const out = new Set<string>();
  for (const p of pages) {
    const segs = (p.route ?? '').split('/').filter(Boolean);
    const dynamic = segs.filter((s) => /^\[[^.[]/.test(s)).length;
    if (dynamic === 1) out.add('dynamic segment');
    if (dynamic > 1) out.add('nested dynamic segments');
    if (segs.some((s) => /^\[\.\.\./.test(s))) out.add('catch-all');
    if (segs.some((s) => /^\[\[\.\.\./.test(s))) out.add('optional catch-all');
    if (p.kind !== 'nav') out.add(p.kind);
  }
  return out;
}

const union = <T>(...sets: Iterable<T>[]) => new Set(sets.flatMap((s) => [...s]));
const overlap = <T>(a: Iterable<T>, b: Iterable<T>) => [...a].filter((x) => new Set(b).has(x));
/** The token paths a design system's slots read: its own names through `slots`, or fwos's defaults. */
const tokenPaths = (d: ReturnType<typeof pack>['design']) => new Set(Object.values(d.slots ?? {}));

const first = pack(join(REPO, FIRST));
const second = Object.fromEntries(SURFACES.map((s) => [s, pack(join(REPO, SECOND, s))])) as Record<(typeof SURFACES)[number], ReturnType<typeof pack>>;
const both = Object.values(second);

interface CheckJson {
  id: string;
  status: 'pass' | 'fail' | 'off';
  reason?: string;
  info?: string[];
  findings: { file?: string; rule?: string; message: string }[];
}
const check = (root: string, ...ids: string[]): Record<string, CheckJson> =>
  Object.fromEntries((JSON.parse(fwos(root, 'check', ...ids, '--json')) as { results: CheckJson[] }).results.map((r) => [r.id, r]));
const messages = (r: CheckJson) => r.findings.map((f) => f.message);
/** A check's summary: why it is off or failed, else its first info line. */
const summary = (r: CheckJson) => (r.status === 'pass' ? (r.info?.[0] ?? '') : (r.reason ?? ''));
/** A state check on a clean pack: it passes on tagged tests, or is OFF where fwos also wants to see each state render. */
const notFailing = (r: CheckJson) => (r.status === 'fail' ? 'fail' : 'not failing');

describe('the second pack differs from the first on every seam', () => {
  it('has its own component IDs and required states', () => {
    const ids = union(...both.map((p) => p.components.map((c) => c.id)));
    expect(overlap(first.components.map((c) => c.id), ids)).toEqual([]);
    const states = union(...both.map((p) => p.components.flatMap((c) => c.requiredStates)));
    expect(overlap(first.components.flatMap((c) => c.requiredStates), states)).toEqual([]);
    // A superseded component, which the sample's registry has none of.
    expect(second.console.components.find((c) => c.id === 'legacy-berth-table')).toMatchObject({ status: 'superseded', supersededBy: 'berth-grid' });
  });

  it('has its own roles, flags and page states', () => {
    for (const p of both) expect(overlap(first.ia.roles, p.ia.roles)).toEqual([]);
    expect(first.ia.flags ?? []).toEqual([]);
    expect(second.console.ia.flags).toEqual(['berth-auctions', 'tide-forecast']);
    // Pages limited by role, by flag and by both.
    expect(second.console.ia.pages.filter((p) => p.visibleTo || p.flag).map((p) => p.id)).toEqual(['forecast', 'auctions', 'audit']);
    // Loading and ready aside, which nearly every page has, no state name is the sample's.
    const states = union(...both.flatMap((p) => p.ia.pages.map((pg) => pg.states)));
    expect(overlap(first.ia.pages.flatMap((p) => p.states), states).sort()).toEqual(['loading', 'ready']);
    expect(states.size).toBeGreaterThan(12);
  });

  it('has route shapes the sample has none of, in two router layouts', () => {
    expect([...routeShapes(first.ia.pages)]).toEqual([]);
    expect([...union(...both.map((p) => routeShapes(p.ia.pages)))].sort()).toEqual(
      ['catch-all', 'drilldown', 'dynamic segment', 'nested dynamic segments', 'optional catch-all', 'redirect', 'unlinked'].sort(),
    );
    // The console's routes sit under src/app in route groups; the site's app is the project root.
    expect(second.console.app).toBe('apps/console');
    expect(walkFiles(join(REPO, SECOND, 'console/apps/console/src/app')).filter((f) => f.startsWith('('))).not.toEqual([]);
    expect(second.site.app).toBe('.');
    expect(walkFiles(join(REPO, SECOND, 'site/app')).filter((f) => f.startsWith('('))).not.toEqual([]);
  });

  it('has its own layout, modules and rule overrides', () => {
    expect(overlap([first.app, first.ui, first.docs, first.ds], [second.console.app, second.console.ui, second.console.docs, second.console.ds])).toEqual([]);
    for (const p of both) expect(overlap(first.modules, p.modules)).toEqual([]);
    expect(first.rules.custom ?? []).toEqual([]);
    expect(Object.keys(first.rules.rules ?? {})).toEqual([]);
    expect(both.map((p) => [Object.keys(p.rules.rules ?? {}), (p.rules.custom ?? []).map((c) => c.id)])).toEqual([
      [['no-raw-intl'], ['no-direct-fetch']],
      [['no-dangerous-html'], ['no-raw-img']],
    ]);
  });

  it('has two surfaces, each with a token system of its own', () => {
    expect(Object.keys(first.design.tokens.modes)).toEqual(['light', 'dark']);
    expect(Object.keys(second.console.design.tokens.modes)).toEqual(['light', 'dark', 'contrast']);
    expect([Object.keys(second.site.design.tokens.modes), second.site.design.defaultMode]).toEqual([['dark'], 'dark']);
    // Different token names behind the slots, no name shared between the surfaces, and none of the sample's.
    expect(first.design.slots ?? {}).toEqual({});
    expect(overlap(tokenPaths(second.console.design), tokenPaths(second.site.design))).toEqual([]);
    for (const p of both) expect([...tokenPaths(p.design)].filter((t) => t.startsWith('color.'))).toEqual([]);
  });

  it('names nothing fwos itself names, so no fwos code can single it out', () => {
    const own = [
      ...both.flatMap((p) => p.components.map((c) => c.id)),
      ...both.flatMap((p) => [...p.ia.roles, ...(p.ia.flags ?? [])]).filter((x) => !['visitor', 'pilot', 'auditor'].includes(x)),
      ...both.flatMap((p) => (p.rules.custom ?? []).map((c) => c.id)),
      'Tidewatch',
    ];
    const plugin = join(REPO, 'plugin');
    const named = walkFiles(plugin).filter((f) => {
      const text = readFileSync(join(plugin, f), 'utf8');
      return own.some((x) => text.includes(x));
    });
    expect(own.length).toBeGreaterThan(10);
    expect(named).toEqual([]);
  });
});

describe.each(SURFACES)('the %s surface: doctor tells the truth', (surface) => {
  it('passes every check doctor calls ON, and fails each once its violation is planted', () => {
    const root = copy(`${SECOND}/${surface}`);
    commitAll(root);
    const r = proveDoctor(root);
    expect(r.problems).toEqual([]);
    expect(r.proven).toEqual(r.on);
    const expected = {
      console: ['design-system/chart-palette', 'architecture/contract', 'architecture/mocks', 'build/slices'],
      site: ['screens/ia', 'build/slices'],
    }[surface];
    expect(r.on).toEqual(expect.arrayContaining(expected));
  }, 240_000);

  it("never fails the state checks on the pack as it is, and counts the pack's own states", () => {
    const r = check(copy(`${SECOND}/${surface}`), 'design-system/required-states', 'screens/states');
    const [components, pages] = { console: [12, 23], site: [7, 11] }[surface];
    // A pass on tagged tests, or OFF where fwos also wants to see each state render: never a failure.
    for (const [id, n, noun] of [['design-system/required-states', components, 'required state'], ['screens/states', pages, 'page state']] as const) {
      expect(r[id]!.status, id).not.toBe('fail');
      expect(summary(r[id]!), id).toMatch(new RegExp(`^${n} ${noun}s (?:with|have) a passing tagged test`));
    }
  });
});

describe('the gates follow the pack, not the sample', () => {
  it('registry, required states and slices follow components.json', () => {
    const root = copy(`${SECOND}/console`);
    const own = check(root, 'design-system/registry', 'design-system/required-states', 'build/slices');
    expect(Object.values(own).map((r) => [r.id, r.id === 'design-system/required-states' ? notFailing(r) : r.status])).toEqual([
      ['state/schema', 'pass'],
      ['design-system/schema', 'pass'],
      ['design-system/registry', 'pass'],
      ['design-system/required-states', 'not failing'],
      ['build/slices', 'pass'],
    ]);
    // The sample's registry in its place: the console's own components are unregistered, the sample's
    // states have no test, and the slice claims components nothing registers.
    write(root, 'design/components.json', read(join(REPO, FIRST), 'design-system/components.json'));
    const swapped = check(root, 'design-system/registry', 'design-system/required-states', 'build/slices');
    expect(messages(swapped['design-system/registry']!)).toEqual(
      ['berth-grid', 'command-palette', 'legacy-berth-table', 'tide-chart', 'vessel-chip'].map((id) => `component "${id}" isn't in components.json; register it (8-field spec) or remove it`),
    );
    expect(messages(swapped['design-system/required-states']!)).toContain('button "loading" state: no passing test is tagged @state:button:loading (tag the test that renders it)');
    expect(messages(swapped['build/slices']!)).toEqual(['S1: component "berth-grid" isn\'t registered in components.json', 'S1: component "vessel-chip" isn\'t registered in components.json']);
  });

  it('flags a superseded component of its own, by the replacement it names', () => {
    const root = copy(`${SECOND}/console`);
    write(root, 'apps/console/src/features/berths/export.tsx', "import { LegacyBerthTable } from '@/components/ui';\n\nexport const BerthExport = () => <LegacyBerthTable names={[]} />;\n");
    const r = check(root, 'design-system/registry')['design-system/registry']!;
    expect(r.findings).toEqual([{ file: 'apps/console/src/features/berths/export.tsx', rule: 'superseded', message: 'imports superseded component "legacy-berth-table"; use "berth-grid"' }]);
  });

  it('screens/ia, screens/states and slices follow ia.json', () => {
    const root = copy(`${SECOND}/site`);
    const own = check(root, 'screens/ia', 'screens/states', 'build/slices');
    expect([own['screens/ia']!.status, notFailing(own['screens/states']!), own['build/slices']!.status]).toEqual(['pass', 'not failing', 'pass']);
    expect(own['screens/ia']!.info).toEqual(['web: 7 app routes, 7 ia pages, 4 nav pages linked']);
    write(root, 'docs/app/ia.json', read(join(REPO, FIRST), 'docs/app/ia.json'));
    const swapped = check(root, 'screens/ia', 'screens/states', 'build/slices');
    expect(messages(swapped['screens/ia']!).sort()).toEqual(
      ['/blog', '/blog/[]', '/changelog/[[...]]', '/docs/[...]', '/legal/[]', '/pricing'].map((r) => `web: the app exposes ${r}, which ia.json doesn't list; add it (or mark it unlinked) or remove it`),
    );
    expect(messages(swapped['screens/states']!)).toContain('list "filtered-empty": no passing test is tagged @state:list:filtered-empty (tag the test that renders it)');
    expect(messages(swapped['build/slices']!)).toEqual(['S1: screen "pricing" isn\'t in ia.json']);
  });

  it('module walls follow modules.json', () => {
    const root = copy(`${SECOND}/console`);
    // The audit trail reaching into the berth board, which the console's modules.json forbids.
    write(root, 'apps/console/src/features/audit/reach.ts', "import { BerthBoard } from '@/features/berths';\n\nexport const reach = BerthBoard;\n");
    const own = check(root, 'architecture/walls')['architecture/walls']!;
    expect(own.status).toBe('fail');
    expect(own.findings.map((f) => [f.file, f.message])).toEqual([
      ['apps/console/src/features/audit/reach.ts', 'module "audit" may not depend on "berths" (imports @/features/berths); modules.json allows: ui, readings'],
    ]);
    // The sample's modules.json knows none of the console's folders, so there's no wall to check here.
    write(root, 'docs/product/modules.json', read(join(REPO, FIRST), 'docs/app/modules.json'));
    const swapped = check(root, 'architecture/walls')['architecture/walls']!;
    expect([swapped.status, swapped.reason]).toEqual(['off', expect.stringMatching(/^modules\.json's 8 modules hold no file yet \(apps\/web\/app, apps\/web\/src\/screens, /)]);
  });

  it('the rule pack follows rules.yaml', () => {
    const root = copy(`${SECOND}/console`);
    write(root, 'apps/console/src/features/berths/refresh.ts', "export const refresh = () => fetch('/berths');\n");
    const own = check(root, 'rules/pack')['rules/pack']!;
    expect(own.findings.map((f) => [f.file, f.rule])).toEqual([['apps/console/src/features/berths/refresh.ts', 'no-direct-fetch']]);
    // With the sample's rules.yaml the console's own rule is gone, and so is its formatter's exclude.
    write(root, 'design/rules.yaml', read(join(REPO, FIRST), 'design-system/rules.yaml'));
    const swapped = check(root, 'rules/pack')['rules/pack']!;
    expect(swapped.findings.map((f) => [f.file, f.rule])).toEqual([
      ['apps/console/src/lib/readings/index.ts', 'no-raw-intl'],
      ['apps/console/src/lib/readings/index.ts', 'no-raw-intl'],
    ]);
  });

  it('the design-system checks follow each surface\'s own tokens', () => {
    const console = check(copy(`${SECOND}/console`), 'design-system');
    const site = check(copy(`${SECOND}/site`), 'design-system');
    expect(console['design-system/schema']!.info![0]).toBe('Tidewatch Console: modes light, dark, contrast');
    expect(site['design-system/schema']!.info).toEqual(['Tidewatch Site: modes dark', 'blank (their checks are off): chart.1, chart.2, chart.3, chart.4, chart.other']);
    expect([console['design-system/contrast']!.info, site['design-system/contrast']!.info]).toEqual([['54 pairs measured'], ['18 pairs measured']]);
    expect([console['design-system/chart-palette']!.status, site['design-system/chart-palette']!.status]).toEqual(['pass', 'off']);
    // The sample's design system in the site's place: the CSS the site committed no longer matches.
    const root = copy(`${SECOND}/site`);
    rmSync(join(root, 'design-system/tokens'), { recursive: true });
    cpSync(join(REPO, FIRST, 'design-system/tokens'), join(root, 'design-system/tokens'), { recursive: true });
    write(root, 'design-system/design-system.json', read(join(REPO, FIRST), 'design-system/design-system.json'));
    expect(messages(check(root, 'design-system/generated')['design-system/generated']!)).toEqual([
      'out of date with the tokens; run `fwos tokens build`',
      'out of date with the tokens; run `fwos tokens build`',
    ]);
  });
});

describe('what fwos generates follows the pack', () => {
  const css = (surface: string, file: string) => read(join(REPO, SECOND, surface), file);
  const consoleTokens = css('console', 'packages/theme/generated/tokens.css');
  const siteTokens = css('site', 'styles/generated/tokens.css');
  const firstTokens = read(join(REPO, FIRST), 'packages/tokens/generated/tokens.css');

  it("writes each surface's own values and modes", () => {
    expect(consoleTokens).toContain('source: design/ (Tidewatch Console)');
    expect(consoleTokens).toMatch(/:root \{\n {2}color-scheme: light;\n(?:.*\n)*? {2}--ds-text-primary: #06121f;/);
    expect(consoleTokens).toMatch(/:root\[data-theme="contrast"\] \{\n(?:.*\n)*? {2}--ds-text-primary: #000000;/);
    expect(consoleTokens).toContain('--ds-type-metric-size: 1.75rem;');
    expect(siteTokens).toContain('source: design-system/ (Tidewatch Site)');
    expect(siteTokens).toMatch(/:root \{\n {2}color-scheme: dark;\n(?:.*\n)*? {2}--ds-surface-base: #0a0f1c;/);
    expect(siteTokens).toContain('--ds-font-sans: Fraunces, Georgia, serif;');
    expect(siteTokens).not.toContain('data-theme="light"');
    expect(firstTokens).not.toContain('#06121f');
    expect(firstTokens).not.toContain('#0a0f1c');
  });

  it('keeps the class names components use the same in every pack', () => {
    // A slot's own variables, not the chart colours a pack may leave blank or the type modifiers (`--text-body--line-height`) a role may add.
    const vars = (text: string) => [...text.matchAll(/^\s+(--[\w-]+):/gm)].map((m) => m[1]!).filter((v) => !v.startsWith('--color-chart') && !v.slice(2).includes('--'));
    const firstTheme = vars(read(join(REPO, FIRST), 'packages/tokens/generated/theme.css'));
    expect(vars(css('console', 'packages/theme/generated/theme.css'))).toEqual(firstTheme);
    expect(vars(css('site', 'styles/generated/theme.css'))).toEqual(firstTheme);
  });

  it("diffs the IA by the second pack's own page IDs, roles and flags", () => {
    const site = copy(`${SECOND}/site`);
    expect(fwos(site, 'ia', 'diff', '--from', join(REPO, FIRST, 'docs/app/ia.json')).trim().split('\n')).toEqual([
      '+ added    home: Tidewatch at / (nav)',
      '+ added    pricing: Pricing at /pricing (nav)',
      '+ added    docs: Docs at /docs/[...slug] (nav)',
      '+ added    changelog: Changelog at /changelog/[[...release]] (nav)',
      '+ added    blog: Blog at /blog (nav)',
      '+ added    post: Blog post at /blog/[slug] (drilldown)',
      '+ added    legal: Legal at /legal/[doc] (unlinked)',
      '- removed  list: Reading list at /',
    ]);
    const root = copy(`${SECOND}/console`);
    const before = join(work, `ia-before-${copies}.json`);
    copyFileSync(join(root, 'docs/product/ia.json'), before);
    const ia = json<{ pages: Page[] }>(root, 'docs/product/ia.json');
    for (const p of ia.pages) {
      if (p.id === 'forecast') p.route = '/tides/forecast';
      if (p.id === 'audit') p.visibleTo = ['harbormaster'];
      if (p.id === 'auctions') delete p.flag;
    }
    write(root, 'docs/product/ia.json', `${JSON.stringify(ia, null, 2)}\n`);
    expect(fwos(root, 'ia', 'diff', '--from', before).trim().split('\n')).toEqual([
      '~ moved    forecast: route /forecast -> /tides/forecast',
      '~ flag     auctions: no longer behind flag berth-auctions',
      '! exposed  auctions: now visible to harbormaster while berth-auctions is off',
      '! hidden   audit: no longer visible to auditor',
    ]);
  });

  it("says which of the console's own pages screens/ia can't compare, by its roles and flags", () => {
    const r = check(copy(`${SECOND}/console`), 'screens/ia')['screens/ia']!;
    expect(r.status).toBe('off');
    expect(r.reason).toMatch(/^web: 9 app routes match 9 ia pages and 4 nav pages are linked, but /);
    expect(r.reason).toMatch(
      /, so who sees these isn't compared with the app: forecast \(flag tide-forecast\), auctions \(harbormaster, flag berth-auctions\), audit \(harbormaster or auditor\)$/,
    );
  });

  it('a violation in one surface fails only that surface', () => {
    const console = copy(`${SECOND}/console`);
    const site = copy(`${SECOND}/site`);
    write(site, 'components/ui/fwos-planted-banner.tsx', "export const Planted = () => <p className=\"text-[#ff0033]\">planted</p>;\n");
    expect(check(site, 'design-system/tokens')['design-system/tokens']!.status).toBe('fail');
    expect(check(console, 'design-system/tokens')['design-system/tokens']!.status).toBe('pass');
  });
});

describe.each(SURFACES)('the %s stand-in results', (surface) => {
  it('hold exactly the tagged tests the surface has, each marked passed', () => {
    const root = join(REPO, SECOND, surface);
    const titles = walkFiles(root, { include: ['**/*.{test,spec}.{ts,tsx}'] }).flatMap((f) =>
      [...read(root, f).matchAll(/\b(?:it|test)\(\s*(['"`])((?:(?!\1).)*@(?:(?!\1).)*)\1/g)].map((m) => m[2]!),
    );
    const xml = read(root, 'results/stand-in.xml');
    const names = [...xml.matchAll(/<testcase classname="[^"]*" name="([^"]*)"\/>/g)].map((m) => m[1]!.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
    expect(names.sort()).toEqual(titles.sort());
    expect(xml).not.toMatch(/<failure|<skipped/);
  });
});
