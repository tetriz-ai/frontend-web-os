// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The design-system checks. `schema` is a gate: a malformed or unsupported design system stops
// `fwos check` before anything else runs. Blank optional slots turn their checks off, by name.

import { posix } from 'node:path';
import {
  type Check,
  type CheckContext,
  type ComponentAdapter,
  type Finding,
  type ImportBinding,
  type Project,
  Resolver,
  checkStates,
  extractImportBindings,
  isTestFile,
  lexSource,
  loadResults,
  currentTestResults,
  matchAny,
  off,
  result,
  sourceKind,
} from '../../../kernel/index.ts';
import { contrast, nearestPassing, parseDtcgColor, rgbToOklch, toHex } from '../color.ts';
import { tokenOutputs } from '../generate.ts';
import { type ComponentEntry, type DesignSystem, loadComponents, loadDesignSystem } from '../load.ts';
import { SCANNED_FILES, scanRawValues } from '../scan.ts';
import { strictCoverage } from '../../state/index.ts';
import { CONTRAST_PAIRS, SLOTS } from '../slots.ts';

const ALL = ['web', 'electron', 'mac'] as const;
/** Why a design-system check is off with no design system. An adopted app never runs the step, so it gets the command. */
const noDs = (project: Project) =>
  project.mode === 'adopt'
    ? 'no design-system/design-system.json yet; `fwos design-system init` writes it (add `--from-shadcn <globals.css>` to start from your shadcn theme)'
    : 'no design-system/design-system.json yet; the design-system step writes it';
/** `1 file`, `2 files`. */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export const schemaCheck: Check = {
  id: 'design-system/schema',
  title: 'Design system contract',
  catches: 'a malformed or unsupported design system, a broken alias, a required slot left blank',
  platforms: ALL,
  gate: true,
  run({ project }) {
    const id = 'design-system/schema';
    const ds = loadDesignSystem(project);
    if (!ds) return off(id, noDs(project));
    const findings: Finding[] = ds.errors.map((e) => ({ ...(e.file ? { file: e.file } : {}), message: e.message }));
    for (const s of ds.missing) {
      const def = SLOTS.find((d) => d.id === s)!;
      findings.push({
        file: ds.configPath,
        rule: 'required-slot',
        message: `required slot ${s} (${def.contract}) is blank; add token ${ds.config.slots?.[s] ?? def.token} or map the slot to one of yours`,
      });
    }
    const comps = loadComponents(project, ds);
    for (const e of comps?.errors ?? []) findings.push({ file: comps!.path, message: e });
    const blank = SLOTS.filter((d) => d.level === 'optional' && ds.slots.get(d.id)?.status === 'blank').map((d) => d.id);
    const info = [`${ds.config.name}: modes ${ds.modes.join(', ')}`];
    if (blank.length > 0) info.push(`blank (their checks are off): ${blank.join(', ')}`);
    if ((ds.config.assumed ?? []).length > 0) info.push(`${count(ds.config.assumed!.length, '[ASSUMED] default')} to confirm`);
    // A pass says the tokens are valid. For an import, say that it isn't a match with the theme.
    if (ds.config.source) info.push(`imported from ${ds.config.source.from ?? ds.config.source.file}: valid, not shown to match it (\`fwos design-system report\` maps it)`);
    return result(id, findings, ds.inputs, undefined, info);
  },
};

function colorOf(ds: DesignSystem, slot: string, mode: string) {
  const s = ds.slots.get(slot);
  if (!s || s.status === 'blank') return null;
  return parseDtcgColor(s.raw[mode]);
}

export const contrastCheck: Check = {
  id: 'design-system/contrast',
  title: 'Text contrast',
  catches: 'a text or foreground slot under 4.5:1 against the surface it sits on, in any mode',
  platforms: ALL,
  run({ project }) {
    const id = 'design-system/contrast';
    const ds = loadDesignSystem(project);
    if (!ds) return off(id, noDs(project));
    if (ds.errors.length > 0) return off(id, 'the design system has errors (see design-system/schema)', ds.inputs);
    const findings: Finding[] = [];
    let measured = 0;
    for (const mode of ds.modes) {
      // A translucent surface shows the mode's base surface through it, not white.
      const base = colorOf(ds, 'surface.base', mode) ?? undefined;
      for (const [fg, bg] of CONTRAST_PAIRS) {
        const a = colorOf(ds, fg, mode);
        const b = colorOf(ds, bg, mode);
        if (!a || !b) continue;
        measured++;
        const canvas = bg === 'surface.base' ? undefined : base;
        const ratio = contrast(a, b, canvas);
        if (ratio >= 4.5) continue;
        const fix = nearestPassing(a, b, 4.5, canvas);
        // Rounded to 2 places, a ratio just under 4.5 would print as 4.50 and read as a pass.
        const shown = Math.min(Number(ratio.toFixed(2)), 4.49).toFixed(2);
        findings.push({
          file: ds.dir,
          rule: `${fg}/${bg}`,
          message: `${mode}: ${fg} on ${bg} is ${shown}:1, under 4.5:1${fix ? `; nearest passing shade ${toHex(fix)}` : ''}`,
        });
      }
    }
    return result(id, findings, ds.inputs, undefined, [`${count(measured, 'pair')} measured`]);
  },
};

export const chartPaletteCheck: Check = {
  id: 'design-system/chart-palette',
  title: 'Chart palette',
  catches: 'chart colours that are missing, too alike, or the same as a UI colour',
  platforms: ALL,
  run({ project }) {
    const id = 'design-system/chart-palette';
    const ds = loadDesignSystem(project);
    if (!ds) return off(id, noDs(project));
    const chart = SLOTS.filter((d) => d.contract === 'C9');
    const filled = chart.filter((d) => ds.slots.get(d.id)?.status === 'filled');
    if (filled.length === 0) return off(id, 'chart palette blank (slot C9): chart colour check off', ds.inputs);
    const findings: Finding[] = [];
    for (const d of chart) if (!filled.includes(d)) findings.push({ rule: d.id, message: `${d.id} is blank; fill all of chart.1-4 and chart.other` });
    const ui = ['brand.primary', 'brand.accent', ...['critical', 'warning', 'caution', 'info', 'success'].map((s) => `status.${s}.text`)];
    const dist = (x: ReturnType<typeof parseDtcgColor>, y: ReturnType<typeof parseDtcgColor>) => {
      const p = rgbToOklch(x!);
      const q = rgbToOklch(y!);
      const ax = p.c * Math.cos((p.h * Math.PI) / 180);
      const bx = p.c * Math.sin((p.h * Math.PI) / 180);
      const ay = q.c * Math.cos((q.h * Math.PI) / 180);
      const by = q.c * Math.sin((q.h * Math.PI) / 180);
      return Math.hypot(p.l - q.l, ax - ay, bx - by);
    };
    for (const mode of ds.modes) {
      for (let i = 0; i < filled.length; i++) {
        const ci = colorOf(ds, filled[i]!.id, mode);
        if (!ci) continue;
        for (let j = i + 1; j < filled.length; j++) {
          const cj = colorOf(ds, filled[j]!.id, mode);
          if (cj && dist(ci, cj) < 0.08) {
            findings.push({ rule: 'too-alike', message: `${mode}: ${filled[i]!.id} and ${filled[j]!.id} are too alike to tell apart in a chart` });
          }
        }
        for (const u of ui) {
          const cu = colorOf(ds, u, mode);
          if (cu && dist(ci, cu) < 0.02) {
            findings.push({ rule: 'ui-colour', message: `${mode}: ${filled[i]!.id} is the same colour as ${u}; keep chart colours apart from UI colours` });
          }
        }
      }
    }
    return result(id, findings, ds.inputs);
  },
};

export const tokensCheck: Check = {
  id: 'design-system/tokens',
  title: 'No raw design values',
  catches: 'raw colours, default-palette classes, raw font sizes, fonts and radii outside the token layer',
  platforms: ['web', 'electron'],
  run({ project, staged }) {
    const id = 'design-system/tokens';
    const exclude = [`${project.paths.designSystem}/**`, `${project.paths.tokensOut}/**`, '**/*.d.ts', '**/*.stories.*'];
    let files = project.files(project.paths.source, exclude).filter((f) => SCANNED_FILES.test(f) && !isTestFile(project, f));
    if (staged) files = files.filter((f) => staged.includes(f));
    if (files.length === 0) return off(id, `no app source matched ${project.paths.source.join(', ')}`, project.paths.source);
    const findings: Finding[] = [];
    for (const f of files) findings.push(...scanRawValues(f, project.read(f) ?? ''));
    return result(id, findings, project.paths.source, undefined, [`${count(files.length, 'file')} scanned`]);
  },
};

export const generatedCheck: Check = {
  id: 'design-system/generated',
  title: 'Generated token files current',
  catches: 'CSS variables or the Tailwind theme out of date with the tokens',
  platforms: ['web', 'electron'],
  run({ project }) {
    const id = 'design-system/generated';
    const ds = loadDesignSystem(project);
    if (!ds) return off(id, noDs(project));
    if (ds.errors.length > 0 || ds.missing.length > 0) return off(id, 'the design system has errors (see design-system/schema)', ds.inputs);
    const findings: Finding[] = [];
    const outputs = tokenOutputs(project, ds);
    // Never built (an adopted app, before `fwos tokens build`): nothing can drift yet, so it's off,
    // not a "missing" finding a baseline would hide for good. Some built and some gone still fails.
    if (outputs.length > 0 && outputs.every((o) => !project.exists(o.path))) {
      return off(id, `token CSS not generated yet (${outputs.map((o) => o.path).join(', ')}); run \`fwos tokens build\``, ds.inputs);
    }
    for (const out of outputs) {
      const disk = project.read(out.path);
      if (disk === null) findings.push({ file: out.path, rule: 'missing', message: 'not generated yet; run `fwos tokens build`' });
      else if (disk.replace(/\r\n/g, '\n') !== out.content) {
        findings.push({ file: out.path, rule: 'drift', message: 'out of date with the tokens; run `fwos tokens build`' });
      }
    }
    return result(id, findings, ds.inputs);
  },
};

const MODULE_EXT = /\.[cm]?[jt]sx?$/;
/** The files whose imports count as uses: every script form, .mjs, .cjs, .mts and .cts too, and MDX. */
const IMPORTERS = /\.(?:[cm]?[jt]sx?|mdx)$/;
/** A module path with no extension and no trailing `/index`, so `ui/index.ts` and `ui` compare equal. */
const modulePath = (p: string) => p.replace(MODULE_EXT, '').replace(/\/index$/, '');
const pascalCase = (id: string) => id.replace(/(?:^|-)([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const DECLARED = /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g;

/** The names a component's own file exports: declarations and export lists (`a as b` exports b). */
function exportedNames(file: string, src: string): string[] {
  const { masked } = lexSource(src, sourceKind(file) ?? 'js');
  const names = [...masked.matchAll(DECLARED)].map((m) => m[1]!);
  for (const m of masked.matchAll(EXPORT_LIST)) {
    for (const part of m[1]!.split(',')) {
      const words = part.trim().split(/\s+/).filter((w) => w !== 'type');
      if (words[0]) names.push(words.at(-1)!);
    }
  }
  return names;
}

interface Retired {
  entry: ComponentEntry;
  /** Its own file, when installed. */
  file: string | undefined;
  /** The adapter's import path for it, such as `@/shared/ui/old-button`. */
  spec: string;
  /** The barrel that path sits in, such as `@/shared/ui`. */
  barrel: string;
  /** Where it lives in the project, with no extension. */
  paths: Set<string>;
  /** For a component that is a folder, the folder and its import path: anything inside either is it. */
  folder?: string[];
  /** The names a barrel import of it can take. */
  names: Set<string>;
  /** Whether a barrel takes it in, so a namespace import of that barrel (`* as UI`) takes it too. */
  inBarrel: boolean;
}

/** Where an import points, with no extension: an import made from `from`, resolved by `resolver`. */
type Target = (from: string, spec: string) => string;

/**
 * A resolver for import targets: the file TypeScript would pick (tsconfig `paths`, `baseUrl`,
 * relative paths, folder index files), or, when nothing resolves, the specifier as written with
 * its `.`, `//` and trailing `/` normalised, so the adapter's own alias still matches.
 */
function importTargets(project: Project): Target {
  const resolver = new Resolver(project.root);
  const cache = new Map<string, string>();
  return (from, spec) => {
    const key = `${posix.dirname(from)}\0${spec}`;
    let hit = cache.get(key);
    if (hit === undefined) {
      const r = resolver.resolve(from, spec);
      hit = modulePath((r.kind === 'file' ? r.path : posix.normalize(spec)).replace(/\/+$/, ''));
      cache.set(key, hit);
    }
    return hit;
  };
}

/** The index files of the folders: their barrels. */
function barrelFiles(project: Project, dirs: string[]): string[] {
  return dirs.flatMap((d) => project.files([`${d}/index.{ts,tsx,js,jsx,mjs}`]));
}

/**
 * The superseded and removed components, with where they live: their installed file, or else the
 * folder the installed components share. A removed component that is no longer installed keeps
 * its PascalCase id as its name.
 */
function retiredComponents(
  project: Project,
  adapter: ComponentAdapter,
  entries: ComponentEntry[],
  installed: { id: string; file: string }[],
  uiDirs: string[],
  target: Target,
  imports: (f: string) => ImportBinding[],
): Retired[] {
  const barrels = barrelFiles(project, uiDirs);
  return entries
    .filter((c) => c.status === 'superseded' || c.status === 'removed')
    .map((entry) => {
      const file = installed.find((x) => x.id === entry.id)?.file;
      // A folder component is every script file in it: their names are its names.
      const folder = file && !MODULE_EXT.test(file) ? file : undefined;
      const parts = folder ? project.files([`${folder}/**`]).filter((f) => MODULE_EXT.test(f)) : file ? [file] : [];
      const spec = modulePath(adapter.importFor(entry.id));
      const paths = new Set(file ? [modulePath(file)] : uiDirs.map((d) => `${d}/${entry.id}`));
      return {
        entry,
        file,
        spec,
        barrel: posix.dirname(spec),
        paths,
        ...(folder ? { folder: [folder, spec] } : {}),
        names: new Set([pascalCase(entry.id), ...parts.flatMap((f) => exportedNames(f, project.read(f) ?? ''))]),
        inBarrel: barrels.some((b) => imports(b).some((imp) => paths.has(target(b, imp.spec)))),
      };
    });
}

/** Whether the import `imp` in file `f`, which points at `to`, takes the retired component `r`, directly or through its barrel. */
function importsRetired(imp: ImportBinding, f: string, to: string, r: Retired, uiDirs: string[]): boolean {
  const inside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);
  // A folder component's own files import each other; that's how it is built, not a use of it.
  if (r.folder && inside(f, r.folder[0]!)) return false;
  if (to === r.spec || r.paths.has(to) || r.folder?.some((d) => inside(to, d))) {
    // The barrel re-exporting its own components is how they are published, not a use.
    return !(imp.kind === 're-export' && uiDirs.includes(posix.dirname(f)) && modulePath(f) === posix.dirname(f));
  }
  const barrel = to === r.barrel || uiDirs.includes(to);
  // `import * as UI` (or `export *`) takes every name the barrel exports.
  return barrel && (imp.names.some((n) => r.names.has(n)) || (r.inBarrel && imp.names.includes('*')));
}

export const registryCheck: Check = {
  id: 'design-system/registry',
  title: 'Registered components only',
  catches: 'an installed component missing from components.json, or a removed or superseded one still used',
  platforms: ['web', 'electron'],
  run(ctx: CheckContext) {
    const id = 'design-system/registry';
    const { project } = ctx;
    const comps = loadComponents(project);
    if (!comps) return off(id, 'no design-system/components.json');
    if (comps.errors.length > 0) return off(id, 'components.json has errors (see design-system/schema)', [comps.path]);
    const adapters = project.platforms.map((p) => ctx.adapters.get(p)?.components).filter((a) => !!a);
    if (adapters.length === 0) return off(id, `no component adapter for ${project.platforms.join(', ')}`, [comps.path]);
    const byId = new Map(comps.components.map((c) => [c.id, c]));
    const findings: Finding[] = [];
    const sources = project.files(project.paths.source).filter((f) => IMPORTERS.test(f) && !isTestFile(project, f));
    const importsOf = new Map<string, ImportBinding[]>();
    const imports = (f: string) => {
      if (!importsOf.has(f)) importsOf.set(f, extractImportBindings(project.read(f) ?? '', sourceKind(f) ?? 'jsx'));
      return importsOf.get(f)!;
    };
    const target = importTargets(project);
    const installed = adapters.map((a) => a.listInstalled(project));
    if (installed.every((list) => list.length === 0)) {
      const where = adapters.map((a) => a.folder?.(project)).filter((f) => !!f);
      // An adopted app has no scaffold to add the starter set.
      const scaffold = project.mode === 'adopt' ? '' : 'the scaffold adds the starter set; ';
      return off(id, `no components installed yet${where.length ? ` in ${where.join(', ')}` : ''} (${scaffold}components elsewhere: set paths.ui in .fwos/state.json)`, [comps.path]);
    }
    for (const [i, adapter] of adapters.entries()) {
      for (const inst of installed[i]!) {
        const entry = byId.get(inst.id);
        if (!entry) {
          findings.push({ file: inst.file, rule: 'unregistered', message: `component "${inst.id}" isn't in components.json; register it (8-field spec) or remove it` });
        } else if (entry.status === 'removed') {
          findings.push({ file: inst.file, rule: 'removed', message: `component "${inst.id}" is marked removed in components.json` });
        }
      }
      const uiDirs = [...new Set(installed[i]!.map((x) => posix.dirname(x.file)))];
      for (const r of retiredComponents(project, adapter, comps.components, installed[i]!, uiDirs, target, imports)) {
        const c = r.entry;
        for (const f of sources) {
          if (f === r.file || matchAny(f, [`**/${c.id}.*`])) continue;
          if (imports(f).some((imp) => importsRetired(imp, f, target(f, imp.spec), r, uiDirs))) {
            findings.push({
              file: f,
              rule: c.status,
              message: `imports ${c.status} component "${c.id}"${c.supersededBy ? `; use "${c.supersededBy}"` : ''}`,
            });
          }
        }
      }
    }
    return result(id, findings, [comps.path, ...project.paths.source]);
  },
};

export const requiredStatesCheck: Check = {
  id: 'design-system/required-states',
  title: 'Every required state renders as its contract says, with a passing tagged test',
  catches:
    "a registered component's required state with no passing test tagged @state:<id>:<state>, or whose fixture fwos's harness saw render wrong: loading not busy, disabled with no disabled control, invalid not marked, an alert with the wrong role, a fixture that ignores its state, a hover that paints it while a click there does nothing",
  platforms: ALL,
  run(ctx) {
    const id = 'design-system/required-states';
    const { project } = ctx;
    const comps = loadComponents(project);
    if (!comps) return off(id, 'no design-system/components.json');
    const wanted = comps.components.filter((c) => c.status !== 'removed' && c.requiredStates.length > 0);
    if (wanted.length === 0) return off(id, 'no component declares required states', [comps.path]);
    const results = loadResults(project, project.initialized && strictCoverage(project.root) ? currentTestResults(project) : undefined);
    if (results.cases.length === 0 && !(project.initialized && strictCoverage(project.root))) {
      return off(id, `no test results in ${project.paths.results.join(', ')}; run the tests first`, [comps.path, ...project.paths.results]);
    }
    return checkStates(ctx, {
      id,
      subjects: wanted.map((c) => ({ kind: 'component', id: c.id, states: c.requiredStates })),
      results,
      name: (component, state) => `${component} "${state}" state`,
      noun: 'required state',
      pendingTags: false,
      strict: strictCoverage(project.root),
      fixtureHint: 'add it to src/screens/components.tsx, or in an app with no screens browser run `fwos design-system gallery`, which renders each state a prop sets',
      inputs: [comps.path, ...results.files],
    });
  },
};

export const checks: Check[] = [
  schemaCheck,
  contrastCheck,
  chartPaletteCheck,
  tokensCheck,
  generatedCheck,
  registryCheck,
  requiredStatesCheck,
];
