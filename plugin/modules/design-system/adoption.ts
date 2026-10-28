// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The source-to-target mapping, for every input fwos takes: a shadcn theme (read again from the
// copy the import kept), DTCG tokens with their own names, and the neutral starter. Each slot gets
// the source file and key it reads, its original and resulting value in each mode and a status;
// the source entries nothing consumed are listed too, and so is each component with what it
// becomes. A PASS from design-system/schema says the result is valid. This says how much of the
// source it carries.

import { posix } from 'node:path';
import { type AdapterSet, type ComponentFacts, type ComponentAdapter, FwosError, type GalleryAdapter, type Project } from '../../kernel/index.ts';
import { flatten, isTree, mergeTrees } from './dtcg.ts';
import { type ImportModel, importModel, showValue, starterFiles } from './intake.ts';
import { type ComponentEntry, type DesignSystem, type ResolvedSlot, loadComponents, loadDesignSystem, resolveSlots } from './load.ts';
import { SLOTS } from './slots.ts';

/**
 * preserved: the source's value, where it means the same. approximated: the source's value where it
 * only roughly fits, or what replaces your component. defaulted: fwos's, where the source had
 * nothing. unsupported: in the source, and nothing took it. changed: the design system's value is
 * no longer the source's, an edit made after the import such as a contrast fix.
 */
export type RowStatus = 'preserved' | 'approximated' | 'defaulted' | 'unsupported' | 'changed';

export const ROW_STATUSES: RowStatus[] = ['preserved', 'approximated', 'defaulted', 'changed', 'unsupported'];

/** One slot, or one source entry nothing consumed. */
export interface TokenRow {
  /** What a decision names: the slot id (`surface.base`), or the source key nothing consumed (`--popover`). */
  key: string;
  /** The file and the key or token path the value comes from. Null when the source has nothing for it. */
  source: { file: string; key: string } | null;
  /** The slot it fills, or null for a source entry nothing consumed. */
  target: string | null;
  /** Per mode: what the source has, as written. Empty when it has nothing. */
  original: Record<string, string>;
  /** Per mode: what the design system holds now. Empty for a source entry nothing consumed. */
  result: Record<string, string>;
  status: RowStatus;
  why: string;
}

/** One component: yours, fwos's, or yours paired with what replaces it. */
export interface ComponentRow {
  /** What a decision names: your component's id, or fwos's for one of its own. */
  key: string;
  /** Your implementation: its file and what it exports. Null for one of fwos's. */
  source: { file: string; exports: string[] } | null;
  /** What it becomes in the registry, or null when nothing does. `file` is null until it is installed. */
  target: { id: string; file: string | null; by: 'yours' | 'fwos' } | null;
  status: RowStatus;
  why: string;
  /** What the source says about it: of your implementation, else of the registered one. */
  facts: ComponentFacts | null;
}

/** A shadcn theme as the import read it: its variables in each mode, as a browser applies them. */
export interface ThemeSource {
  /** The copy of the theme, relative to the project root. */
  file: string;
  /** Per mode, every variable of the theme with its value (a dark block over `:root` in dark). */
  vars: Record<string, Record<string, string>>;
  /** Each variable a slot took, and the slot that stands for it. */
  takenBy: Record<string, string>;
  /** The slots as the import wrote them, before any edit: what the theme gives each slot. */
  imported: Map<string, ResolvedSlot>;
}

export interface Mapping {
  input: 'shadcn' | 'dtcg' | 'starter';
  /** What was read, in words: `app/globals.css (copied to design-system/source/globals.css)`. */
  source: string;
  name: string;
  modes: string[];
  tokens: TokenRow[];
  components: ComponentRow[];
  ds: DesignSystem;
  /** For a shadcn theme: its variables, for the gallery's original side. */
  theme?: ThemeSource;
}

type Tree = Record<string, unknown>;

/** A slot's value as the design system holds it in a mode: `#fff`, `6px`, `0.875rem/1.25rem 400`, `same as surface.subtle`. */
export function slotValue(slot: ResolvedSlot | undefined, mode: string): string {
  if (!slot || slot.status === 'blank') return '';
  if (slot.status === 'default' && typeof slot.from === 'string' && slot.from.startsWith('@')) return `same as ${slot.from.slice(1)}`;
  const decls = slot.css[mode] ?? [];
  if (decls.length === 1 && decls[0]!.suffix === '') return decls[0]!.value;
  const part = (suffix: string) => decls.find((d) => d.suffix === suffix)?.value;
  const size = part('-size');
  if (size === undefined) return decls.map((d) => d.value).join(' ');
  return [`${size}${part('-line') ? `/${part('-line')}` : ''}`, part('-weight'), part('-tracking')].filter(Boolean).join(' ');
}

const perMode = (modes: string[], f: (mode: string) => string) => Object.fromEntries(modes.map((m) => [m, f(m)]));

/**
 * Each theme variable a slot took, and the slot that stands for it on the adopted side: the one
 * that took it as it is (`--radius` is radius.lg, not the ladder below it), else an exact match,
 * else the first that took it at all.
 */
function takenBy(model: ImportModel): Record<string, string> {
  const rank = (status: string, why: string) => (status === 'preserved' && why === '' ? 0 : status === 'preserved' ? 1 : why.startsWith('shadcn has no exact match') ? 3 : 2);
  const best = new Map<string, { slot: string; rank: number }>();
  for (const row of model.rows) {
    if (!row.target || !row.source || row.status === 'defaulted') continue;
    const r = rank(row.status, row.why);
    const prev = best.get(row.source);
    if (!prev || r < prev.rank) best.set(row.source, { slot: SLOTS.find((s) => s.token === row.target)!.id, rank: r });
  }
  return Object.fromEntries([...best].map(([name, b]) => [name, b.slot]));
}

/** The mapping for a design system imported from a shadcn theme, read from the copy the import kept. */
function fromTheme(project: Project, ds: DesignSystem, copy: string, from: string | undefined): Omit<Mapping, 'components'> {
  const css = project.read(copy);
  if (css === null) {
    throw new FwosError(`${copy} is missing. It is the copy of your theme the import kept, and the mapping reads it.`, 'Restore it from git, or remove `source` from design-system.json to map the tokens as they are.');
  }
  let model: ImportModel;
  try {
    model = importModel(css);
  } catch {
    throw new FwosError(`${copy} has no \`:root\` block, so there is no theme to map.`, 'Restore the copy from git, or remove `source` from design-system.json to map the tokens as they are.');
  }
  // As a browser applies the theme: the dark block over `:root` in dark, `:root` alone otherwise.
  const vars = perModeVars(ds.modes, model);
  const original = (name: string | null) => perMode(ds.modes, (m) => (name ? (vars[m]![name] ?? '') : ''));
  // What the import wrote, resolved as the design system resolves: an edit since then shows as changed.
  const imported = resolveSlots(ds.dir, ds.modes, {}, [model.base], Object.fromEntries(ds.modes.map((m) => [m, [model.out[m === 'dark' ? 'dark' : 'light']!]]))).slots;
  const tokens: TokenRow[] = [];
  for (const row of model.rows) {
    if (!row.target) {
      tokens.push({ key: row.source!, source: { file: copy, key: row.source! }, target: null, original: original(row.source), result: perMode(ds.modes, () => ''), status: 'unsupported', why: row.why });
      continue;
    }
    const def = SLOTS.find((s) => s.token === row.target)!;
    const result = perMode(ds.modes, (m) => slotValue(ds.slots.get(def.id), m));
    const before = perMode(ds.modes, (m) => slotValue(imported.get(def.id), m));
    const src = original(row.source);
    const edited = ds.modes.filter((m) => result[m] !== before[m]);
    tokens.push({
      key: def.id,
      source: row.source ? { file: copy, key: row.source } : null,
      target: def.id,
      original: src,
      result,
      status: edited.length > 0 ? 'changed' : row.status,
      why: edited.length > 0 ? edited.map((m) => `${m}: set after the import (the theme had ${src[m] || 'none'})`).join('; ') : row.why,
    });
  }
  // Slots first, in the contract's order, then what nothing took.
  tokens.sort((a, b) => (a.target === null ? 1 : 0) - (b.target === null ? 1 : 0));
  return {
    input: 'shadcn',
    source: `${from ?? copy} (copied to ${copy})`,
    name: ds.config.name,
    modes: ds.modes,
    tokens,
    ds,
    theme: { file: copy, vars, takenBy: takenBy(model), imported },
  };
}

/** Each mode's variables as `--name: value`, as a browser applies the theme: the dark block over `:root` in dark. */
function perModeVars(modes: string[], model: ImportModel): Record<string, Record<string, string>> {
  const named = (m: Map<string, string>) => Object.fromEntries([...m].map(([k, v]) => [`--${k}`, v]));
  const light = named(model.light);
  return Object.fromEntries(modes.map((m) => [m, m === 'dark' && model.dark ? { ...light, ...named(model.dark) } : { ...light }]));
}

/** Every `{a.b}` alias in a value, inside composite values too. */
function aliasesIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') {
    const m = /^\{([^{}]+)\}$/.exec(v);
    if (m) out.push(m[1]!);
  } else if (Array.isArray(v)) for (const x of v) aliasesIn(x, out);
  else if (isTree(v)) for (const x of Object.values(v)) aliasesIn(x, out);
  return out;
}

/** The mapping for DTCG tokens, the user's own or the starter's: the token files are the source. */
function fromTokens(project: Project, ds: DesignSystem): Omit<Mapping, 'components'> {
  const at = (rel: string) => posix.join(ds.dir, rel);
  const parse = (rel: string): Tree => {
    try {
      const t = JSON.parse(project.read(at(rel)) ?? '{}');
      return isTree(t) ? t : {};
    } catch {
      return {};
    }
  };
  const shared = ds.config.tokens.shared ?? [];
  const order = [...new Set([...shared, ...ds.modes.flatMap((m) => ds.config.tokens.modes[m] ?? [])])];
  const flat = new Map(order.map((f) => [f, flatten(parse(f))]));
  /** Per mode: each token path with its value as written and the file that sets it (the last one). */
  const raw = new Map(
    ds.modes.map((m) => {
      const byPath = new Map<string, { value: unknown; file: string }>();
      for (const f of [...shared, ...(ds.config.tokens.modes[m] ?? [])]) for (const [path, tok] of flat.get(f)!) byPath.set(path, { value: tok.value, file: f });
      return [m, byPath];
    }),
  );
  const starter = Object.fromEntries(starterFiles().map((f) => [f.path, f.content]));
  const starterRaw = new Map(
    (['light', 'dark'] as const).map((m) => [m, flatten(mergeTrees([JSON.parse(starter['tokens/base.json']!), JSON.parse(starter[`tokens/${m}.json`]!)]))]),
  );
  const sameAsStarter = (path: string) =>
    ds.modes.every((m) => {
      const mine = raw.get(m)!.get(path);
      const theirs = starterRaw.get(m as 'light' | 'dark')?.get(path);
      return !!mine && !!theirs && JSON.stringify(mine.value) === JSON.stringify(theirs.value);
    });

  const reached = new Set<string>();
  const reach = (mode: string, path: string) => {
    if (reached.has(`${mode}\0${path}`)) return;
    reached.add(`${mode}\0${path}`);
    reached.add(path);
    for (const a of aliasesIn(raw.get(mode)!.get(path)?.value)) reach(mode, a);
  };

  const tokens: TokenRow[] = [];
  for (const def of SLOTS) {
    const slot = ds.slots.get(def.id)!;
    const result = perMode(ds.modes, (m) => slotValue(slot, m));
    const none = perMode(ds.modes, () => '');
    if (slot.status !== 'filled') {
      const why = slot.status === 'blank' ? 'blank, so its check is off' : "the slot's fallback";
      tokens.push({ key: def.id, source: null, target: def.id, original: none, result, status: 'defaulted', why });
      continue;
    }
    const path = slot.from!;
    for (const m of ds.modes) reach(m, path);
    if (sameAsStarter(path)) {
      tokens.push({ key: def.id, source: null, target: def.id, original: none, result, status: 'defaulted', why: "the neutral starter's value" });
      continue;
    }
    const files = [...new Set(ds.modes.map((m) => raw.get(m)!.get(path)?.file).filter((f): f is string => !!f))].map(at);
    const original = perMode(ds.modes, (m) => {
      const v = raw.get(m)!.get(path);
      return v ? showValue(v.value) : '';
    });
    tokens.push({ key: def.id, source: { file: files.join(', '), key: path }, target: def.id, original, result, status: 'preserved', why: '' });
  }

  // What no slot reaches, directly or through an alias, in the order the files list it.
  const listed = new Set<string>();
  for (const f of order) {
    for (const path of flat.get(f)!.keys()) {
      if (listed.has(path) || reached.has(path)) continue;
      listed.add(path);
      const files = order.filter((g) => flat.get(g)!.has(path)).map(at);
      const original = perMode(ds.modes, (m) => {
        const v = raw.get(m)!.get(path);
        return v ? showValue(v.value) : '';
      });
      tokens.push({ key: path, source: { file: files.join(', '), key: path }, target: null, original, result: perMode(ds.modes, () => ''), status: 'unsupported', why: 'no slot reads it, so it never reaches the generated CSS' });
    }
  }
  const nothingYours = tokens.every((t) => t.status === 'defaulted');
  return {
    input: nothingYours ? 'starter' : 'dtcg',
    source: nothingYours ? 'the neutral starter' : order.map(at).join(', '),
    name: ds.config.name,
    modes: ds.modes,
    tokens,
    ds,
  };
}

/** The web profile's component and gallery adapters, for the project's platforms. */
export function componentAdapters(project: Project, adapters: AdapterSet): { components: ComponentAdapter | null; gallery: GalleryAdapter | null } {
  for (const p of project.platforms) {
    const profile = adapters.get(p);
    if (profile?.components) return { components: profile.components, gallery: profile.gallery ?? null };
  }
  return { components: null, gallery: null };
}

/** Each component: yours reused, fwos's own, yours replaced by another, or yours left behind. */
function componentRows(project: Project, ds: DesignSystem, adapters: AdapterSet): ComponentRow[] {
  const registry = loadComponents(project, ds);
  const { components, gallery } = componentAdapters(project, adapters);
  const installed = components?.listInstalled(project) ?? [];
  const fileOf = (id: string) => installed.find((x) => x.id === id)?.file ?? null;
  const facts = (id: string, file: string | null, declared: string[], source?: string): ComponentFacts | null =>
    file && gallery ? gallery.describe(project, { id, file, ...(source ? { source } : {}) }, declared) : null;
  const entries = registry && registry.errors.length === 0 ? registry.components : [];
  const byId = new Map(entries.map((c) => [c.id, c]));
  const replaced = new Set(entries.filter((c) => c.status === 'superseded' && c.supersededBy).map((c) => c.supersededBy!));
  const rows: ComponentRow[] = [];
  const ofFwos = (c: ComponentEntry) => c.source === 'fwos';
  for (const c of entries) {
    const file = fileOf(c.id);
    if (c.status === 'superseded') {
      const next = byId.get(c.supersededBy!)!;
      const f = facts(c.id, file, c.requiredStates, c.source);
      rows.push({
        key: c.id,
        source: file ? { file, exports: f?.exports ?? [] } : null,
        target: { id: next.id, file: fileOf(next.id), by: ofFwos(next) ? 'fwos' : 'yours' },
        status: 'approximated',
        why: `yours, replaced by ${next.id}`,
        facts: f,
      });
      continue;
    }
    if (c.status === 'removed') {
      const f = facts(c.id, file, c.requiredStates, c.source);
      rows.push({ key: c.id, source: file ? { file, exports: f?.exports ?? [] } : null, target: null, status: 'unsupported', why: 'yours, marked removed in components.json', facts: f });
      continue;
    }
    // A replacement is the row of what it replaces.
    if (replaced.has(c.id)) continue;
    const f = facts(c.id, file, c.requiredStates, c.source);
    if (ofFwos(c)) {
      rows.push({
        key: c.id,
        source: null,
        target: { id: c.id, file, by: 'fwos' },
        status: 'defaulted',
        why: file ? "fwos's starter component, not yours" : "fwos's starter component, not installed yet",
        facts: f,
      });
    } else if (file) {
      rows.push({ key: c.id, source: { file, exports: f?.exports ?? [] }, target: { id: c.id, file, by: 'yours' }, status: 'preserved', why: 'yours, reused as it is', facts: f });
    } else {
      rows.push({ key: c.id, source: null, target: { id: c.id, file: null, by: 'yours' }, status: 'unsupported', why: `yours, registered but not installed${components?.folder ? ` in ${components.folder(project)}` : ''}`, facts: null });
    }
  }
  for (const inst of installed) {
    if (byId.has(inst.id)) continue;
    const f = facts(inst.id, inst.file, []);
    rows.push({ key: inst.id, source: { file: inst.file, exports: f?.exports ?? [] }, target: null, status: 'unsupported', why: 'yours, not in components.json, so nothing fwos builds uses it', facts: f });
  }
  return rows;
}

/**
 * The source-to-target mapping of the project's design system, or null when it has none. Throws
 * when an imported theme's copy is gone, rather than map a theme it can no longer read.
 */
export function mapDesignSystem(project: Project, adapters: AdapterSet): Mapping | null {
  const ds = loadDesignSystem(project);
  if (!ds) return null;
  if (ds.slots.size === 0) {
    throw new FwosError(`${ds.configPath} has errors, so there is nothing to map yet.`, ds.errors.map((e) => e.message).join('\n'));
  }
  const src = ds.config.source;
  const base = src?.format === 'shadcn' ? fromTheme(project, ds, posix.join(ds.dir, src.file), src.from) : fromTokens(project, ds);
  return { ...base, components: componentRows(project, ds, adapters) };
}

/** `20 preserved, 5 approximated, 36 defaulted, 4 unsupported`: the token rows by status, as the import has always counted them. */
export function tokenSummary(rows: TokenRow[]): string {
  const n = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  const parts = ['preserved', 'approximated', 'defaulted'].map((s) => `${n(s as RowStatus)} ${s}`);
  if (n('changed') > 0) parts.push(`${n('changed')} changed`);
  parts.push(`${n('unsupported')} unsupported`);
  return parts.join(', ');
}
