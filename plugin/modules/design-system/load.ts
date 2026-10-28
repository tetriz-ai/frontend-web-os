// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Loads the user's design system and resolves every slot in every mode.

import { posix } from 'node:path';
import { type Project, validateWith } from '../../kernel/index.ts';
import componentsSchema from './schema/components.schema.json' with { type: 'json' };
import dsSchema from './schema/design-system.schema.json' with { type: 'json' };
import { type CssDecl, type Token, flatten, isTree, mergeTrees, resolveAliases, toCss } from './dtcg.ts';
import { SLOTS, type SlotDef } from './slots.ts';

export const DS_SCHEMA_VERSION = 1;

export interface DesignSystemConfig {
  schema: number;
  name: string;
  platforms?: string[];
  tokens: { shared?: string[]; modes: Record<string, string[]> };
  defaultMode?: string;
  slots?: Record<string, string>;
  assumed?: string[];
  components?: string;
  voice?: string;
  /** Where an imported design system came from: the copy of the theme the import kept, relative to the folder. */
  source?: { format: 'shadcn'; file: string; from?: string };
}

export type SlotStatus = 'filled' | 'default' | 'blank';

export interface ResolvedSlot {
  def: SlotDef;
  status: SlotStatus;
  /** The token path it came from (filled), or the fallback it used (default). */
  from?: string;
  /** Mode -> CSS declarations. */
  css: Record<string, CssDecl[]>;
  /** Mode -> raw resolved value (colours are read by the contrast check). */
  raw: Record<string, unknown>;
}

export interface DesignSystem {
  dir: string;
  configPath: string;
  config: DesignSystemConfig;
  modes: string[];
  defaultMode: string;
  slots: Map<string, ResolvedSlot>;
  /** Malformed files, bad aliases, unknown slot ids, unreadable values: the schema check fails on these. */
  errors: { file?: string; message: string }[];
  /** Required slots with no value: the schema check fails on these too. */
  missing: string[];
  inputs: string[];
}

export interface ComponentEntry {
  id: string;
  status: 'stable' | 'beta' | 'superseded' | 'removed';
  supersededBy?: string;
  requiredStates: string[];
  source?: string;
  spec?: string;
}

export function dsConfigPath(project: Project): string {
  return posix.join(project.paths.designSystem, 'design-system.json');
}

export function hasDesignSystem(project: Project): boolean {
  return project.exists(dsConfigPath(project));
}

/** Loads and resolves the design system. Returns null when there's no design-system.json. */
export function loadDesignSystem(project: Project): DesignSystem | null {
  const configPath = dsConfigPath(project);
  const text = project.read(configPath);
  if (text === null) return null;
  const dir = project.paths.designSystem;
  const errors: DesignSystem['errors'] = [];
  const empty = (config: DesignSystemConfig): DesignSystem => ({
    dir,
    configPath,
    config,
    modes: [],
    defaultMode: '',
    slots: new Map(),
    errors,
    missing: [],
    inputs: [configPath],
  });
  let config: DesignSystemConfig;
  try {
    config = JSON.parse(text);
  } catch (e) {
    errors.push({ file: configPath, message: `not valid JSON: ${(e as Error).message}` });
    return empty({ schema: 0, name: '', tokens: { modes: {} } });
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    for (const error of validateWith(dsSchema, config)) errors.push({ file: configPath, message: error });
    return empty({ schema: 0, name: 'Invalid design system', tokens: { modes: {} } });
  }
  if (typeof config.schema === 'number' && config.schema !== DS_SCHEMA_VERSION) {
    errors.push({
      file: configPath,
      message: `schema ${config.schema} unsupported (this fwos reads design-system schema ${DS_SCHEMA_VERSION}); upgrade fwos`,
    });
    return empty(config);
  }
  for (const e of validateWith(dsSchema, config)) errors.push({ file: configPath, message: e });
  if (errors.length > 0) return empty(config);

  const readTree = (rel: string): Record<string, unknown> => {
    const path = posix.join(dir, rel);
    const t = project.read(path);
    if (t === null) {
      errors.push({ file: path, message: 'listed in design-system.json but missing' });
      return {};
    }
    try {
      const parsed = JSON.parse(t);
      if (!isTree(parsed)) throw new Error('not an object');
      return parsed;
    } catch (e) {
      errors.push({ file: path, message: `not valid JSON: ${(e as Error).message}` });
      return {};
    }
  };

  const modes = Object.keys(config.tokens.modes);
  const defaultMode = config.defaultMode ?? modes[0]!;
  if (!modes.includes(defaultMode)) errors.push({ file: configPath, message: `defaultMode "${defaultMode}" isn't one of: ${modes.join(', ')}` });
  for (const id of Object.keys(config.slots ?? {})) {
    if (!SLOTS.some((s) => s.id === id)) errors.push({ file: configPath, message: `slots: "${id}" isn't a slot in the contract` });
  }

  const shared = (config.tokens.shared ?? []).map(readTree);
  const perMode = Object.fromEntries(modes.map((m) => [m, config.tokens.modes[m]!.map(readTree)]));
  const { slots, missing, errors: slotErrors } = resolveSlots(dir, modes, config.slots ?? {}, shared, perMode);
  errors.push(...slotErrors);

  const inputs = [configPath, ...new Set([...(config.tokens.shared ?? []), ...Object.values(config.tokens.modes).flat()].map((f) => posix.join(dir, f)))];
  return { dir, configPath, config, modes, defaultMode, slots, errors, missing, inputs };
}

/** Every slot resolved in every mode, from token trees already read: shared ones, then each mode's. */
export function resolveSlots(
  dir: string,
  modes: string[],
  slotPaths: Record<string, string>,
  shared: Record<string, unknown>[],
  perMode: Record<string, Record<string, unknown>[]>,
): { slots: Map<string, ResolvedSlot>; missing: string[]; errors: DesignSystem['errors'] } {
  const errors: DesignSystem['errors'] = [];
  const tokensOf = new Map<string, Map<string, Token>>();
  for (const mode of modes) {
    const flat = flatten(mergeTrees([...shared, ...(perMode[mode] ?? [])]));
    const { tokens, errors: aliasErrors } = resolveAliases(flat);
    for (const e of aliasErrors) errors.push({ file: dir, message: `${mode}: ${e}` });
    tokensOf.set(mode, tokens);
  }

  const slots = new Map<string, ResolvedSlot>();
  const missing: string[] = [];
  const resolveSlot = (def: SlotDef, depth = 0): ResolvedSlot => {
    const done = slots.get(def.id);
    if (done) return done;
    const path = slotPaths[def.id] ?? def.token;
    const out: ResolvedSlot = { def, status: 'blank', css: {}, raw: {} };
    const found = modes.map((m) => tokensOf.get(m)!.get(path));
    if (found.some(Boolean)) {
      out.status = 'filled';
      out.from = path;
      modes.forEach((mode, i) => {
        // Every mode needs its own value (C2); borrowing another mode's would hide a gap.
        const tok = found[i];
        if (!tok) {
          errors.push({ file: dir, message: `${mode}: ${path} (slot ${def.id}) has no value in this mode; every mode needs one (C2)` });
          return;
        }
        const css = toCss(def.type, tok.value);
        if (!css) {
          errors.push({ file: dir, message: `${mode}: ${path} (slot ${def.id}) isn't a valid ${def.type}: ${JSON.stringify(tok.value)}` });
          return;
        }
        out.css[mode] = css;
        out.raw[mode] = tok.value;
      });
    } else if (def.fallback !== undefined && depth < 5) {
      out.status = 'default';
      if (typeof def.fallback === 'string' && def.fallback.startsWith('@')) {
        const other = resolveSlot(SLOTS.find((s) => s.id === (def.fallback as string).slice(1))!, depth + 1);
        out.from = def.fallback;
        out.css = other.css;
        out.raw = other.raw;
        if (other.status === 'blank') out.status = 'blank';
      } else {
        out.from = 'fwos default';
        const css = toCss(def.type, def.fallback);
        for (const m of modes) {
          out.css[m] = css ?? [];
          out.raw[m] = def.fallback;
        }
      }
    }
    if (out.status === 'blank' && def.level === 'required') missing.push(def.id);
    slots.set(def.id, out);
    return out;
  };
  for (const def of SLOTS) resolveSlot(def);
  return { slots, missing, errors };
}

export function componentsPath(project: Project, ds?: DesignSystem | null): string {
  const designSystem = ds === undefined ? loadDesignSystem(project) : ds;
  return posix.join(project.paths.designSystem, designSystem?.config.components ?? 'components.json');
}

/** The component registry, or null when there's none. Throws a readable error when it's malformed. */
export function loadComponents(project: Project, ds?: DesignSystem | null): { path: string; components: ComponentEntry[]; errors: string[] } | null {
  const path = componentsPath(project, ds);
  const text = project.read(path);
  if (text === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { path, components: [], errors: [`not valid JSON: ${(e as Error).message}`] };
  }
  const errors = validateWith(componentsSchema, data);
  const components = errors.length === 0 ? (data as { components: ComponentEntry[] }).components : [];
  const seen = new Set<string>();
  for (const c of components) {
    if (seen.has(c.id)) errors.push(`component "${c.id}" is listed twice`);
    seen.add(c.id);
    if (c.status === 'superseded' && !c.supersededBy) errors.push(`component "${c.id}" is superseded but names no supersededBy`);
    if (c.supersededBy && !components.some((x) => x.id === c.supersededBy)) {
      errors.push(`component "${c.id}" is superseded by unknown component "${c.supersededBy}"`);
    }
  }
  return { path, components, errors };
}
