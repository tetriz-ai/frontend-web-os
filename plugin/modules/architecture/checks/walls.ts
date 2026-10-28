// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// architecture/walls: every import respects modules.json. A module is used only through its
// public entry, only by modules allowed to depend on it, and app code never imports spikes/.
// Modules never import each other in a circle, even where `dependsOn: ["*"]` allows each import.
// The same check runs on the plugin itself, where it also covers file references in prompts.

import { posix } from 'node:path';
import { type Check, type Finding, type Project, matchGlob, off, result, sourceKind } from '../../../kernel/index.ts';
import { extractImports, extractPromptRefs } from '../imports.ts';
import { type ModuleDef, entryLabel, findCycles, isEntry, loadModuleMap, normPath, ownerOf, validateModuleMap } from '../modules.ts';
import { type Resolved, Resolver } from '../resolve.ts';

const CODE = '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}';

/** "1 file", "2 files". */
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A specifier that names a path in the project: relative, absolute, or a package.json `imports` key. */
const namesAPath = (spec: string) => spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#');

/** Where an import between two modules first happens. */
interface Edge {
  file: string;
  line: number;
  spec: string;
}

export interface WallsOptions {
  /** modules.json relative to the project root. Defaults to `<docs>/modules.json`. */
  modulesFile?: string;
}

export function runWalls(project: Project, opts: WallsOptions = {}) {
  const id = 'architecture/walls';
  const modulesFile = opts.modulesFile ?? posix.join(project.paths.docs, 'modules.json');
  if (!project.exists(modulesFile)) {
    // An adopted app has no architecture step; its owner writes the module map.
    const writer = project.mode === 'adopt' ? 'write it to declare your modules and which may import which' : 'the architecture step writes it';
    return off(id, `${modulesFile} not found; ${writer}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(project.read(modulesFile) ?? '');
  } catch (e) {
    return result(id, [{ file: modulesFile, message: `not valid JSON: ${(e as Error).message}` }], [modulesFile]);
  }
  const errors = validateModuleMap(raw);
  if (errors.length > 0) return result(id, errors.map((message) => ({ file: modulesFile, message })), [modulesFile]);
  const modules = (loadModuleMap(project.abs(modulesFile)) ?? { modules: [] }).modules;

  const scanned = new Set<string>();
  for (const m of modules) for (const f of project.files([`${normPath(m.path)}/${CODE}`, `${normPath(m.path)}/**/*.md`])) scanned.add(f);
  for (const f of project.files(project.paths.source)) if (matchGlob(f, CODE)) scanned.add(f);
  const files = [...scanned].sort();
  const inputs = [modulesFile, ...modules.map((m) => `${normPath(m.path)}/**`)];
  if (files.length === 0) return off(id, 'modules.json lists no files yet (0 files matched)', inputs);

  const resolver = new Resolver(project.root);
  const findings: Finding[] = [];
  let edges = 0;
  /** Module -> module it imports -> where, for every import modules.json allows. */
  const allowedEdges = new Map<string, Map<string, Edge>>();
  for (const file of files) {
    const src = project.read(file) ?? '';
    const owner = ownerOf(modules, file);
    if (file.endsWith('.md')) {
      for (const ref of extractPromptRefs(src)) {
        edges++;
        const target = ownerOf(modules, normPath(ref.spec));
        if (!project.exists(ref.spec)) {
          findings.push({ file, line: ref.line, rule: 'broken-ref', message: `references ${ref.spec}, which doesn't exist` });
        } else if (owner && target && target !== owner && !allowed(owner, target)) {
          findings.push({ file, line: ref.line, rule: 'dependency', message: denyMessage(owner, target, ref.spec) });
        }
      }
      continue;
    }
    for (const imp of extractImports(src, sourceKind(file) ?? 'jsx')) {
      const r = resolver.resolve(file, imp.spec);
      const banned = owner ? bannedBy(owner, imp.spec, r) : undefined;
      if (owner && banned) {
        findings.push({ file, line: imp.line, rule: 'banned-import', message: `module "${owner.name}" may not import ${imp.spec} (banned by "${banned}")` });
        continue;
      }
      if (r.kind === 'unresolved') {
        findings.push({ file, line: imp.line, rule: 'unresolved', message: `imports ${imp.spec}, which is not a project file or an installed or declared package. ${r.hint}` });
        continue;
      }
      if (r.kind === 'package') continue;
      // A workspace package's entry can be build output that isn't there yet, so only a path is held to existing.
      if (!r.exists && namesAPath(imp.spec)) {
        findings.push({
          file,
          line: imp.line,
          rule: 'unresolved',
          message: `imports ${imp.spec}, which resolves to no file: nothing at ${r.path}, with or without an extension or an index file. Fix the path, or add the file.`,
        });
        continue;
      }
      edges++;
      if (r.path === 'spikes' || r.path.startsWith('spikes/')) {
        findings.push({ file, line: imp.line, rule: 'spike', message: `app code can't import from spikes/ (${imp.spec}); start a change to keep a spike` });
        continue;
      }
      const target = ownerOf(modules, r.path);
      if (!target || target === owner) continue;
      if (owner && !allowed(owner, target)) {
        findings.push({ file, line: imp.line, rule: 'dependency', message: denyMessage(owner, target, imp.spec) });
        continue;
      }
      if (owner) {
        const out = allowedEdges.get(owner.name) ?? new Map<string, Edge>();
        if (!out.has(target.name)) out.set(target.name, { file, line: imp.line, spec: imp.spec });
        allowedEdges.set(owner.name, out);
      }
      if (!isEntry(target, r.path)) {
        findings.push({
          file,
          line: imp.line,
          rule: 'deep-import',
          message: `imports ${imp.spec}, inside module "${target.name}"; import from its public entry ${entryLabel(target)}`,
        });
      }
    }
  }
  // modules.json's own dependsOn has no cycle (validateModuleMap), so a cycle here goes through a "*".
  // One an import modules.json forbids would close is left to that import's finding. Code imports
  // only: a prompt naming another module's file loads nothing.
  const observed = modules.map((m) => ({ ...m, dependsOn: [...(allowedEdges.get(m.name)?.keys() ?? [])] }));
  for (const cycle of findCycles(observed)) {
    const closing = allowedEdges.get(cycle.at(-2)!)!.get(cycle.at(-1)!)!;
    findings.push({
      file: closing.file,
      line: closing.line,
      rule: 'cycle',
      message: `dependency cycle in the imports: ${cycle.join(' -> ')} (this file imports ${closing.spec}). dependsOn "*" allows each import, not a cycle: move what the modules share into a module of its own.`,
    });
  }
  // Imports are read across the app, but a wall needs a file in a module: with none, nothing was walled.
  if (findings.length === 0 && !files.some((f) => ownerOf(modules, f))) {
    const paths = modules.map((m) => normPath(m.path)).join(', ');
    return off(id, `modules.json's ${count(modules.length, 'module')} ${modules.length === 1 ? 'holds' : 'hold'} no file yet (${paths}), so no wall is checked`, inputs);
  }
  return result(id, findings, inputs, undefined, [
    `${count(files.length, 'file')}, ${count(edges, 'internal import')}, ${count(modules.length, 'module')}`,
  ]);
}

function allowed(owner: ModuleDef, target: ModuleDef): boolean {
  return owner.dependsOn.includes('*') || owner.dependsOn.includes(target.name);
}

/** The bannedImports glob an import matches: by its specifier, or by the package it names (installed or in the workspace). */
function bannedBy(owner: ModuleDef, spec: string, r: Resolved): string | undefined {
  const name = r.kind === 'file' ? r.package : r.name;
  return (owner.bannedImports ?? []).find((g) => matchGlob(spec, g) || (name !== undefined && matchGlob(name, g)));
}

function denyMessage(owner: ModuleDef, target: ModuleDef, spec: string): string {
  const deps = owner.dependsOn.length > 0 ? owner.dependsOn.join(', ') : 'nothing';
  return `module "${owner.name}" may not depend on "${target.name}" (imports ${spec}); modules.json allows: ${deps}`;
}

export const wallsCheck: Check = {
  id: 'architecture/walls',
  title: 'Module walls',
  catches: 'an import modules.json does not allow, a deep import past a public entry, an import from spikes/, a dependency cycle, an import that resolves to no file or package',
  platforms: ['web', 'electron'],
  run: ({ project }) => runWalls(project),
};
