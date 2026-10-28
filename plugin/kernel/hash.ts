// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Content hashes. Approvals, locked tests and the manifest all record these.
// Line endings are normalised so a Windows checkout hashes the same as a Mac one.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isUtf8 } from 'node:buffer';
import { join } from 'node:path';
import { isDir, walkFiles } from './files.ts';

export const HASH_LENGTH = 12;

export function hashText(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex').slice(0, HASH_LENGTH);
}

/** Hash of a file, or `null` if it doesn't exist. */
export function hashFile(path: string): string | null {
  try {
    const bytes = readFileSync(path);
    // Valid text keeps cross-platform newline normalization; binary never goes through UTF-8 replacement.
    if (isUtf8(bytes) && !bytes.includes(0)) return hashText(bytes.toString('utf8'));
    return createHash('sha256').update(bytes).digest('hex').slice(0, HASH_LENGTH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Hash of every file under a directory (paths and contents), or `null` if it's missing or empty. */
export function hashDir(path: string): string | null {
  if (!isDir(path)) return null;
  const files = walkFiles(path);
  if (files.length === 0) return null;
  const parts = files.map((f) => `${f}\0${hashFile(join(path, f)) ?? 'missing'}`);
  return hashText(parts.join('\n'));
}

/** Hash of a file or a directory, whichever the path is. */
export function hashPath(path: string): string | null {
  return isDir(path) ? hashDir(path) : hashFile(path);
}
