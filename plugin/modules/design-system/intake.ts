// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Design-system intake. Normalises what the user brings into DTCG files under design-system/.
// v0.1 reads a shadcn or tweakcn theme (globals.css) directly, or starts from the neutral starter.
// Anything the source doesn't define is filled from the starter and tagged [ASSUMED]. An import
// keeps a copy of the theme in design-system/source/, which the mapping report reads again.

import { readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { FwosError, type Project, isFile, lexSource, pluginPath, readText } from '../../kernel/index.ts';
import { colorCss, isTree } from './dtcg.ts';
import { SLOTS } from './slots.ts';

export const STARTER_DIR = pluginPath('modules', 'design-system', 'starter');

export interface IntakeFile {
  path: string;
  content: string;
}

/** The neutral starter, as files relative to the design-system folder. */
export function starterFiles(): IntakeFile[] {
  const out: IntakeFile[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${name.name}` : name.name;
      if (name.isDirectory()) walk(join(dir, name.name), r);
      else out.push({ path: r, content: readText(join(dir, name.name)) ?? '' });
    }
  };
  walk(STARTER_DIR, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** One declaration's text, if it sets a custom property. Anchored, so it's tried once per declaration. */
const CUSTOM_PROPERTY = /^\s*--([\w-]+)\s*:([\s\S]*)$/;

/**
 * `--name: value;` pairs per block selector in a CSS file. A block inside an at-rule other than
 * `@layer` is keyed by that at-rule and its selector, such as `@media (prefers-color-scheme: dark)
 * :root`, so its values never land in the unconditional `:root`. One pass, so it stays linear.
 */
export function cssVariables(css: string): Map<string, Map<string, string>> {
  const { masked, strings } = lexSource(css, 'css');
  // A brace or semicolon in a string is text, so the structure is read with strings blanked.
  const shape = masked.split('');
  for (const s of strings) shape.fill(' ', s.open, s.closed ? s.close + 1 : s.close);
  const blocks = new Map<string, Map<string, string>>();
  /** The open blocks, innermost last, each with the innermost at-rule (not `@layer`) it sits in. */
  const open: { key: string; scope: string }[] = [];
  let start = 0;
  for (let i = 0; i < shape.length; i++) {
    const c = shape[i];
    if (c !== '{' && c !== '}' && c !== ';') continue;
    const text = masked.slice(start, i);
    start = i + 1;
    const top = open.at(-1);
    if (c === '{') {
      const prelude = text.replace(/\s+/g, ' ').trim();
      const scope = top?.scope ?? '';
      const key = scope ? `${scope} ${prelude}` : prelude;
      open.push({ key, scope: prelude.startsWith('@') && !/^@layer\b/i.test(prelude) ? prelude : scope });
      if (!blocks.has(key)) blocks.set(key, new Map());
      continue;
    }
    const d = top ? CUSTOM_PROPERTY.exec(text) : null;
    if (d) blocks.get(top!.key)!.set(d[1]!, d[2]!.trim());
    if (c === '}') open.pop();
  }
  return blocks;
}

/** A dark mode written as a media query, `@media (prefers-color-scheme: dark) { :root { ... } }`, keyed as cssVariables keys it. */
const DARK_MEDIA = /^@media (?:(?:only )?(?:screen|all) and )?\( ?prefers-color-scheme ?: ?dark ?\) :root(?![\w-])/i;

/** shadcn variable -> slot. Several slots reuse one variable; those are tagged [ASSUMED]. */
const SHADCN_MAP: [slot: string, variable: string, exact: boolean][] = [
  ['surface.base', 'background', true],
  ['surface.elevated', 'card', true],
  ['surface.subtle', 'muted', true],
  ['surface.interactive', 'secondary', false],
  ['text.primary', 'foreground', true],
  ['text.secondary', 'muted-foreground', false],
  ['text.muted', 'muted-foreground', true],
  ['text.inverted', 'primary-foreground', false],
  ['border.default', 'border', true],
  ['border.faint', 'input', false],
  ['brand.primary', 'primary', true],
  ['brand.primary-foreground', 'primary-foreground', true],
  ['brand.accent', 'accent', true],
  ['brand.accent-foreground', 'accent-foreground', true],
  ['state.hover', 'accent', false],
  ['state.focus', 'ring', true],
  ['status.critical.text', 'destructive', true],
  ['chart.1', 'chart-1', true],
  ['chart.2', 'chart-2', true],
  ['chart.3', 'chart-3', true],
  ['chart.4', 'chart-4', true],
  ['chart.other', 'chart-5', true],
  ['font.sans', 'font-sans', true],
  ['font.mono', 'font-mono', true],
];

type Tree = Record<string, unknown>;

function getPath(tree: Tree, path: string): unknown {
  let node: unknown = tree;
  for (const p of path.split('.')) node = isTree(node) ? node[p] : undefined;
  return node;
}

function setPath(tree: Tree, path: string, value: Tree): void {
  const parts = path.split('.');
  let node = tree;
  for (const p of parts.slice(0, -1)) {
    if (!isTree(node[p])) node[p] = {};
    node = node[p] as Tree;
  }
  node[parts[parts.length - 1]!] = value;
}

function remToPx(v: string): number | null {
  const m = /^([\d.]+)(rem|px)$/.exec(v.trim());
  if (!m) return null;
  return m[2] === 'rem' ? Number.parseFloat(m[1]!) * 16 : Number.parseFloat(m[1]!);
}

/** Where an imported slot's value came from. `unsupported` is a theme variable no slot takes. */
export type MappingStatus = 'preserved' | 'approximated' | 'defaulted' | 'unsupported';

/** One line of the import report: a slot and where its value came from, or a theme variable no slot took. */
export interface ImportRow {
  /** The token the value went to, such as `color.surface.base`; null for a variable no slot took. */
  target: string | null;
  /** The theme variable it came from, such as `--background`; null when the theme had none for it. */
  source: string | null;
  /**
   * The value in each mode: what the design system now holds, or, for an unsupported row, what the
   * theme had. `same` in dark for a token both modes share.
   */
  light: string;
  dark: string;
  status: MappingStatus;
  /** Why it isn't simply preserved, or how it was derived. */
  why: string;
}

const RANK: Record<MappingStatus, number> = { preserved: 0, approximated: 1, defaulted: 2, unsupported: 3 };
const worst = (a: MappingStatus, b: MappingStatus) => (RANK[a] >= RANK[b] ? a : b);

/** Where one slot's value came from, per mode, while the theme is converted. */
interface Origin {
  source: string | null;
  light: MappingStatus;
  dark: MappingStatus;
  why: string[];
}

/** A DTCG value as the report shows it: a colour's hex, `10px`, `120ms`, `0.875rem/1.25rem 400`. */
export function showValue(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.length === 4 && v.every((x) => typeof x === 'number') ? `cubic-bezier(${v.join(', ')})` : v.join(', ');
  if (isTree(v)) {
    if (typeof v.hex === 'string') return v.hex;
    if ('colorSpace' in v) return colorCss(v) ?? JSON.stringify(v);
    if ('value' in v && 'unit' in v) return `${v.value}${v.unit}`;
    if ('fontSize' in v) return `${v.fontSize}/${v.lineHeight} ${v.fontWeight}`;
  }
  return JSON.stringify(v);
}

/** The theme converted: the token trees, the [ASSUMED] notes and the import report's rows. */
function convert(css: string) {
  const blocks = cssVariables(css);
  const light = blocks.get(':root') ?? new Map<string, string>();
  const media = [...blocks.keys()].find((k) => DARK_MEDIA.test(k));
  const dark = blocks.get('.dark') ?? blocks.get('[data-theme="dark"]') ?? blocks.get(':root.dark') ?? (media === undefined ? null : blocks.get(media)!);
  if (light.size === 0) throw new FwosError('No `:root { --background: ...; }` block found; is this a shadcn or tweakcn globals.css?');

  const starter = Object.fromEntries(starterFiles().map((f) => [f.path, f.content]));
  const base = JSON.parse(starter['tokens/base.json']!) as Tree;
  const out: Record<string, Tree> = {
    light: JSON.parse(starter['tokens/light.json']!) as Tree,
    dark: JSON.parse(starter['tokens/dark.json']!) as Tree,
  };
  const assumed: string[] = [];
  const origins = new Map<string, Origin>();
  /** The theme variables a slot took. */
  const used = new Set<string>();
  const colorSlot = (slot: string) => `color.${slot}`;

  for (const [slot, variable, exact] of SHADCN_MAP) {
    const isFont = slot.startsWith('font.');
    const lv = light.get(variable);
    if (lv === undefined) {
      assumed.push(`${slot}: no --${variable} in the theme; kept the neutral starter value`);
      origins.set(slot, { source: null, light: 'defaulted', dark: 'defaulted', why: [`no --${variable} in the theme`] });
      continue;
    }
    used.add(variable);
    const how: MappingStatus = exact ? 'preserved' : 'approximated';
    const origin: Origin = { source: `--${variable}`, light: how, dark: how, why: exact ? [] : ['shadcn has no exact match'] };
    origins.set(slot, origin);
    if (!exact) assumed.push(`${slot}: taken from --${variable} (shadcn has no exact match)`);
    if (isFont) {
      setPath(base, slot, { $type: 'fontFamily', $value: lv.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')) });
      continue;
    }
    setPath(out.light!, colorSlot(slot), { $value: lv });
    if (!dark) {
      // With no dark block at all, dark mode keeps the starter's values, which are made for dark. Every mode
      // needs a value for a slot the theme fills (C2), so a slot the starter lacks gets the fallback its
      // definition names, or the light value when it names none.
      origin.dark = 'defaulted';
      if (getPath(out.dark!, colorSlot(slot)) !== undefined) {
        origin.why.push("dark: no dark block, so the neutral starter's value");
        continue;
      }
      const fallback = SLOTS.find((s) => s.id === slot)?.fallback;
      if (typeof fallback === 'string' && fallback.startsWith('@')) {
        setPath(out.dark!, colorSlot(slot), { $value: `{${colorSlot(fallback.slice(1))}}` });
        origin.why.push("dark: no dark block, so the slot's fallback");
      } else {
        setPath(out.dark!, colorSlot(slot), { $value: lv });
        assumed.push(`${slot}: no .dark block, so dark mode reuses the light value`);
        origin.dark = worst(how, 'approximated');
        origin.why.push('dark: no dark block, so the light value');
      }
      continue;
    }
    const dv = dark.get(variable);
    setPath(out.dark!, colorSlot(slot), { $value: dv ?? lv });
    if (dv === undefined) {
      assumed.push(`${slot}: no dark value for --${variable}; reused the light one`);
      origin.dark = worst(how, 'approximated');
      origin.why.push(`dark: no --${variable}, so the light value`);
    }
  }
  if (!dark) assumed.push('no .dark block: dark mode kept the neutral starter values; review them');

  const radius = light.get('radius');
  const px = radius ? remToPx(radius) : null;
  if (px !== null) {
    used.add('radius');
    // shadcn's ladder: sm = radius - 4px, md = radius - 2px, lg = radius.
    setPath(base, 'radius.sm', { $type: 'dimension', $value: { value: Math.max(0, px - 4), unit: 'px' } });
    setPath(base, 'radius.md', { $type: 'dimension', $value: { value: Math.max(0, px - 2), unit: 'px' } });
    setPath(base, 'radius.lg', { $type: 'dimension', $value: { value: px, unit: 'px' } });
    for (const [r, why] of [['sm', ["shadcn's ladder, --radius - 4px"]], ['md', ["shadcn's ladder, --radius - 2px"]], ['lg', []]] as const) {
      origins.set(`radius.${r}`, { source: '--radius', light: 'preserved', dark: 'preserved', why: [...why] });
    }
  } else {
    assumed.push('radius: no --radius in rem or px; kept the neutral starter ladder');
    for (const r of ['sm', 'md', 'lg']) origins.set(`radius.${r}`, { source: null, light: 'defaulted', dark: 'defaulted', why: ['no --radius in rem or px'] });
  }
  for (const s of ['warning', 'caution', 'info', 'success']) {
    assumed.push(`status.${s}: shadcn has no ${s} colours; kept the neutral starter pair`);
    for (const part of ['bg', 'text']) origins.set(`status.${s}.${part}`, { source: null, light: 'defaulted', dark: 'defaulted', why: [`shadcn has no ${s} colours`] });
  }
  assumed.push('status.critical.bg: shadcn has no destructive background; kept the neutral starter value');
  origins.set('status.critical.bg', { source: null, light: 'defaulted', dark: 'defaulted', why: ['shadcn has no destructive background'] });

  // Every slot, in the contract's order, with the value it got in each mode.
  const valueAt = (tree: Tree, path: string) => {
    const node = getPath(tree, path);
    return isTree(node) && '$value' in node ? showValue(node.$value) : null;
  };
  const rows: ImportRow[] = SLOTS.map((def) => {
    const origin = origins.get(def.id) ?? { source: null, light: 'defaulted', dark: 'defaulted', why: [] };
    const colour = def.type === 'color';
    const fallback =
      def.fallback === undefined ? '' : typeof def.fallback === 'string' && def.fallback.startsWith('@') ? `same as ${def.fallback.slice(1)}` : showValue(def.fallback);
    const lightValue = valueAt(colour ? out.light! : base, def.token);
    const why = [...origin.why];
    // A slot the theme gave nothing: say what supplies its value instead.
    if (origin.light === 'defaulted') why.push(lightValue !== null ? "the neutral starter's value" : fallback ? "the slot's fallback" : 'blank, so its check is off');
    return {
      target: def.token,
      source: origin.source,
      light: lightValue ?? fallback,
      dark: colour ? (valueAt(out.dark!, def.token) ?? fallback) : 'same',
      status: worst(origin.light, origin.dark),
      why: why.join('; '),
    };
  });
  // Then what the theme had that no slot took, light block first.
  const mapped = new Set(SHADCN_MAP.map(([, v]) => v));
  for (const name of new Set([...light.keys(), ...(dark?.keys() ?? [])])) {
    if (used.has(name)) continue;
    const why = name === 'radius' ? 'not in rem or px' : mapped.has(name) ? "only in the dark block, so its slot kept the starter's value" : 'no slot takes it';
    rows.push({ target: null, source: `--${name}`, light: light.get(name) ?? '', dark: dark?.get(name) ?? '', status: 'unsupported', why });
  }
  return { base, out, assumed, rows, light, dark };
}

/** What an import makes of a theme: the token trees it writes, its rows, and the theme's own blocks. */
export type ImportModel = ReturnType<typeof convert>;

/** The theme converted as `fwos design-system init --from-shadcn` converts it. Throws on a file with no `:root` block. */
export function importModel(css: string): ImportModel {
  return convert(css);
}

/** Where every slot of an imported theme came from, and the theme variables no slot took. */
export function importRows(css: string): ImportRow[] {
  return convert(css).rows;
}

const STATUSES: MappingStatus[] = ['preserved', 'approximated', 'defaulted', 'unsupported'];

/** `21 preserved, 5 approximated, 40 defaulted, 2 unsupported`. */
export function importSummary(rows: { status: string }[]): string {
  return STATUSES.map((s) => `${rows.filter((r) => r.status === s).length} ${s}`).join(', ');
}

/** Where an import keeps its copy of the theme, inside the design-system folder: `source/globals.css`. */
export function sourceCopyPath(themePath: string): string {
  return `source/${posix.basename(themePath.replace(/\\/g, '/')) || 'theme.css'}`;
}

/**
 * Converts a shadcn/tweakcn globals.css into DTCG files plus a design-system.json, and keeps a copy
 * of the theme as it was in `source/`, recorded as `source` in design-system.json. The mapping
 * report reads that copy to say where every slot's value came from. `source` is the theme's path.
 */
export function fromShadcn(css: string, name = 'Imported shadcn theme', source = 'globals.css'): IntakeFile[] {
  const { base, out, assumed } = convert(css);
  const starter = Object.fromEntries(starterFiles().map((f) => [f.path, f.content]));
  const ds = JSON.parse(starter['design-system.json']!) as Tree;
  const copy = sourceCopyPath(source);
  ds.name = name;
  ds.assumed = assumed;
  ds.source = { format: 'shadcn', file: copy, from: source };
  const files: IntakeFile[] = [
    { path: 'design-system.json', content: `${JSON.stringify(ds, null, 2)}\n` },
    { path: 'tokens/base.json', content: `${JSON.stringify(base, null, 2)}\n` },
    { path: 'tokens/light.json', content: `${JSON.stringify(out.light, null, 2)}\n` },
    { path: 'tokens/dark.json', content: `${JSON.stringify(out.dark, null, 2)}\n` },
    { path: copy, content: css },
  ];
  for (const f of starterFiles()) if (!files.some((x) => x.path === f.path)) files.push(f);
  return files;
}

/** Refuses to run when design-system/ already has a design-system.json. */
export function assertNoDesignSystem(project: Project): void {
  if (isFile(project.abs(posix.join(project.paths.designSystem, 'design-system.json')))) {
    throw new FwosError(
      `${project.paths.designSystem}/design-system.json already exists; fwos never overwrites your design system.`,
      'Edit your tokens directly, or move the folder away and run the intake again.',
    );
  }
}
