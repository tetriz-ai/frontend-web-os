// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Where the plugin itself lives on disk. This file and `dist/fwos.mjs` both sit one folder
// below the plugin root, so the same arithmetic works from source (tests) and from the bundle.

import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './files.ts';

export const pluginRoot: string = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function pluginPath(...parts: string[]): string {
  return join(pluginRoot, ...parts);
}

let version: string | null = null;

/** The plugin's version, or, for the copy `fwos scaffold` vendors into a project, that copy's package.json version. */
export function pluginVersion(): string {
  version ??=
    readJson<{ version?: string }>(pluginPath('.claude-plugin', 'plugin.json'))?.version ??
    readJson<{ name?: string; version?: string }>(pluginPath('package.json'))?.version ??
    '0.0.0';
  return version;
}

/** A project-relative path in one spelling: forward slashes, no `./`, no `..` or `//` detours. */
export function normalizeRel(path: string): string {
  return posix.normalize(path.replace(/\\/g, '/')).replace(/^\.\//, '');
}
