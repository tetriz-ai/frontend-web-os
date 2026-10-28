// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// File helpers shared by every module: walking, reading, JSONC and front matter.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { matchAny } from './glob.ts';

/** Dependency, VCS and tool cache folders: never worth scanning, wherever they are. */
export const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', '.turbo', '.vercel', 'DerivedData', '.swiftpm']);

/**
 * Build and test output folders, including `out/`, where Next.js writes a static export. Tools
 * write them at a package root, so they are skipped only there: the walk root, `apps/<name>/`,
 * `packages/<name>/`, or any folder with a package.json. Deeper down the same name is app source
 * (`src/features/coverage/`) and is walked.
 */
export const OUTPUT_DIRS = new Set(['dist', 'out', 'coverage', 'test-results', 'playwright-report']);

/**
 * Test folders. Like build output, they count only at a package root: deeper down the same name
 * is app source (`src/features/tests/quiz.tsx`).
 */
export const TEST_DIRS = new Set(['tests', 'e2e']);

/**
 * Whether the folder `dir` (posix, relative, '' for the root) is a package root: the root,
 * `apps/<name>`, `packages/<name>`, or a folder `hasPackageJson` says holds a package.json.
 */
export function isPackageRoot(dir: string, hasPackageJson: (dir: string) => boolean): boolean {
  return dir === '' || /^(?:apps|packages)\/[^/]+$/.test(dir) || hasPackageJson(dir);
}

/** Whether the file `rel` sits in a `tests/` or `e2e/` folder at a package root. */
export function inTestDir(rel: string, hasPackageJson: (dir: string) => boolean): boolean {
  const parts = rel.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    if (TEST_DIRS.has(parts[i]!) && isPackageRoot(parts.slice(0, i).join('/'), hasPackageJson)) return true;
  }
  return false;
}

export interface WalkOptions {
  include?: readonly string[];
  exclude?: readonly string[];
  /** Directory names to skip at any depth. Defaults to IGNORED_DIRS. */
  ignoreDirs?: ReadonlySet<string>;
}

/** Relative posix paths of every file under `root` matching the include globs. Sorted. */
export function walkFiles(root: string, opts: WalkOptions = {}): string[] {
  const ignoreDirs = opts.ignoreDirs ?? IGNORED_DIRS;
  const out: string[] = [];
  const visit = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const rel = toPosix(relative(root, dir));
    const packageRoot = isPackageRoot(rel, () => entries.some((e) => e.name === 'package.json' && e.isFile()));
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (!ignoreDirs.has(e.name) && !(packageRoot && OUTPUT_DIRS.has(e.name))) visit(abs);
      } else if (e.isFile()) {
        const rel = toPosix(relative(root, abs));
        if (opts.include && !matchAny(rel, opts.include)) continue;
        if (opts.exclude && matchAny(rel, opts.exclude)) continue;
        out.push(rel);
      }
    }
  };
  visit(root);
  return out.sort();
}

export function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

export function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export class FwosError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'FwosError';
    if (hint !== undefined) this.hint = hint;
  }
}

/** Parses JSON, or JSON with comments and trailing commas (tsconfig style). */
export function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i += 1;
    } else if (c === '"') {
      inString = true;
      out += c;
      i += 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return JSON.parse(dropTrailingCommas(out));
}

function dropTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === ',' && /^\s*[}\]]/.test(text.slice(i + 1))) {
      // skip the trailing comma
    } else {
      out += c;
    }
  }
  return out;
}

export function readJson<T = unknown>(path: string): T | null {
  const text = readText(path);
  if (text === null) return null;
  try {
    return parseJsonc(text) as T;
  } catch (e) {
    throw new FwosError(`${path} is not valid JSON: ${(e as Error).message}`);
  }
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}

export interface FrontMatter {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(text: string): FrontMatter {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = parseYaml(m[1]!) as unknown;
  return {
    data: data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {},
    body: text.slice(m[0].length),
  };
}

/** 1-based line number of a character offset. */
export function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Owned paths must be canonical project-relative files with no symlinked component. */
export function ownedPath(root: string, rel: string): string {
  const parts = rel.split('/');
  if (!rel || isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.includes('\\') || rel.includes('\0') || parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new FwosError(`Refusing unsafe owned path: ${rel}`, 'Use a canonical path inside this project.');
  }
  let current = resolve(root);
  for (const part of parts) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new FwosError(`Refusing symlink in owned path: ${rel}`, 'Keep fwos-owned files and backup directories inside this project without symlinks.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return current;
}
