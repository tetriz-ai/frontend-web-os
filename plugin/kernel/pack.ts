// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The pack: the files that hold a project's own choices (its tokens, components, rule overrides,
// pages and modules). fwos reads them and never writes them, except `fwos update` migrating one to
// a newer schema. Each names the `schema` it was written against, and PACK_FILES is the schema
// this release reads for each: state/schema fails closed on any other, so no check reads a pack it
// can't understand, and `fwos update` plans from the same table.

import { posix } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseJsonc } from './files.ts';
import type { Project } from './project.ts';

export interface PackFile {
  /** What messages call it. */
  name: string;
  /** Where it sits, relative to the project root. */
  path(project: Project): string;
  /** What it holds. */
  holds: string;
  /** The schema this release reads. */
  schema: number;
  format: 'json' | 'yaml';
}

/** The `schema` a file's text names, or null when it doesn't parse or names no number. */
export function schemaOf(text: string, format: 'json' | 'yaml'): number | null {
  try {
    const data = (format === 'yaml' ? parseYaml(text) : parseJsonc(text)) as { schema?: unknown } | null;
    return typeof data?.schema === 'number' ? data.schema : null;
  } catch {
    return null;
  }
}

/** The registry: the file design-system.json names, else components.json, in the design-system folder. */
function componentsPath(project: Project): string {
  const config = project.read(posix.join(project.paths.designSystem, 'design-system.json'));
  let named: unknown;
  try {
    named = config === null ? undefined : (parseJsonc(config) as { components?: unknown } | null)?.components;
  } catch {
    // design-system/schema reports a design-system.json that doesn't parse
  }
  return posix.join(project.paths.designSystem, typeof named === 'string' ? named : 'components.json');
}

export const PACK_FILES: readonly PackFile[] = [
  {
    name: 'design-system.json',
    path: (p) => posix.join(p.paths.designSystem, 'design-system.json'),
    holds: 'token files per mode, the slot mapping, the registry and voice files',
    schema: 1,
    format: 'json',
  },
  { name: 'components.json', path: componentsPath, holds: 'the component registry with each component\'s required states', schema: 1, format: 'json' },
  { name: 'rules.yaml', path: (p) => posix.join(p.paths.designSystem, 'rules.yaml'), holds: 'rule overrides and custom rules', schema: 1, format: 'yaml' },
  { name: 'ia.json', path: (p) => posix.join(p.paths.docs, 'ia.json'), holds: 'pages, routes, nav, roles, flags and states', schema: 1, format: 'json' },
  { name: 'modules.json', path: (p) => posix.join(p.paths.docs, 'modules.json'), holds: 'modules, public entries and allowed dependencies', schema: 1, format: 'json' },
];

export interface FileSchema {
  /** Relative to the project root. */
  path: string;
  /** What messages call it: `ia.json`, `change file`. */
  name: string;
  /** The schema it names, or null when it doesn't parse or names none (the check that reads it says why). */
  schema: number | null;
  /** The schema this release reads. */
  reads: number;
  format: 'json' | 'yaml';
}

/** The pack files this project has, each with the schema it names. */
export function packSchemas(project: Project): FileSchema[] {
  return PACK_FILES.flatMap((f) => {
    const path = f.path(project);
    const text = project.read(path);
    return text === null ? [] : [{ path, name: f.name, schema: schemaOf(text, f.format), reads: f.schema, format: f.format }];
  });
}

/** What fwos says about a file at a schema it doesn't read: upgrade for a newer one, `fwos update` for an older one. */
export function unsupportedSchema(name: string, schema: number, reads: number): string {
  const what = schema > reads ? 'upgrade fwos' : 'run `fwos update`, which migrates it or says what to change';
  return `schema ${schema} unsupported (this fwos reads ${name} schema ${reads}); ${what}`;
}
