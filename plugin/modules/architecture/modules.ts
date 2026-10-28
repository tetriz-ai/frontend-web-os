// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The modular monolith as data (`modules.json`): loading, validation and module lookup.

import { posix } from 'node:path';
import { readJson, validateWith } from '../../kernel/index.ts';
import schema from './schema/modules.schema.json' with { type: 'json' };

export interface ModuleDef {
  name: string;
  path: string;
  kind?: string;
  entry?: string[];
  dependsOn: string[];
  bannedImports?: string[];
  description?: string;
}

export interface ModuleMap {
  schema: 1;
  modules: ModuleDef[];
}

export const DEFAULT_ENTRIES = ['index.ts', 'index.tsx'];

export function loadModuleMap(path: string): ModuleMap | null {
  return readJson<ModuleMap>(path);
}

/** Schema errors, unknown names, overlapping paths and dependency cycles. */
export function validateModuleMap(map: unknown): string[] {
  const errors = validateWith(schema, map);
  if (errors.length > 0) return errors;
  const m = map as ModuleMap;
  const names = new Set<string>();
  const paths = new Map<string, string>();
  for (const mod of m.modules) {
    if (names.has(mod.name)) errors.push(`module "${mod.name}" is declared twice`);
    names.add(mod.name);
    const p = normPath(mod.path);
    const other = paths.get(p);
    if (other) errors.push(`modules "${other}" and "${mod.name}" share the path ${p}`);
    paths.set(p, mod.name);
  }
  for (const mod of m.modules) {
    for (const dep of mod.dependsOn) {
      if (dep === '*') continue;
      if (dep === mod.name) errors.push(`module "${mod.name}" depends on itself`);
      else if (!names.has(dep)) errors.push(`module "${mod.name}" depends on unknown module "${dep}"`);
    }
  }
  for (const cycle of findCycles(m.modules)) errors.push(`dependency cycle: ${cycle.join(' -> ')}`);
  return errors;
}

export function findCycles(modules: ModuleDef[]): string[][] {
  const deps = new Map<string, string[]>();
  for (const m of modules) {
    // A name declared twice is its own error; merge its edges so cycles still show.
    deps.set(m.name, [...(deps.get(m.name) ?? []), ...m.dependsOn.filter((d) => d !== '*' && d !== m.name)]);
  }
  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string) => {
    state.set(name, 'visiting');
    stack.push(name);
    for (const d of deps.get(name) ?? []) {
      if (!deps.has(d)) continue;
      if (state.get(d) === 'visiting') {
        const cycle = [...stack.slice(stack.indexOf(d)), d];
        const key = [...cycle].slice(0, -1).sort().join(',');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (!state.has(d)) {
        visit(d);
      }
    }
    stack.pop();
    state.set(name, 'done');
  };
  for (const m of modules) if (!state.has(m.name)) visit(m.name);
  return cycles;
}

export function normPath(p: string): string {
  return posix.normalize(p.replace(/\\/g, '/')).replace(/^\.\//, '').replace(/\/$/, '');
}

/** The module that owns a file: the longest module path that contains it. */
export function ownerOf(modules: ModuleDef[], file: string): ModuleDef | null {
  let best: ModuleDef | null = null;
  let bestLen = -1;
  for (const m of modules) {
    const p = normPath(m.path);
    if ((file === p || file.startsWith(`${p}/`)) && p.length > bestLen) {
      best = m;
      bestLen = p.length;
    }
  }
  return best;
}

const stripExt = (p: string) => p.replace(/\.(d\.)?(m|c)?(t|j)sx?$/, '');

/** True when `file` is one of the module's public entries (or the module folder itself). */
export function isEntry(mod: ModuleDef, file: string): boolean {
  const base = normPath(mod.path);
  const target = stripExt(file);
  if (target === base) return true;
  return (mod.entry ?? DEFAULT_ENTRIES).some((e) => stripExt(posix.join(base, e)) === target);
}

export function entryLabel(mod: ModuleDef): string {
  return (mod.entry ?? DEFAULT_ENTRIES).map((e) => posix.join(normPath(mod.path), e)).join(' or ');
}
