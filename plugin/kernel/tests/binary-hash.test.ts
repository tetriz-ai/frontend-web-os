// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { hashDir, hashFile, loadProject, revisionOf } from '../index.ts';
import { cleanupTempProjects, tempProject } from '../testing.ts';
afterAll(cleanupTempProjects);
it('fingerprints distinct valid pixel PNGs in files, directories and application revisions', () => {
  const root = tempProject({ 'apps/web/package.json': '{}' });
  const file = join(root, 'apps/web/pixel.png');
  const images = ['pixel-0.png', 'pixel-1.png'].map((name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
  writeFileSync(file, images[0]!);
  const first = [hashFile(file), hashDir(join(root, 'apps/web')), revisionOf(loadProject(root))];
  writeFileSync(file, images[1]!);
  const next = [hashFile(file), hashDir(join(root, 'apps/web')), revisionOf(loadProject(root))];
  for (let i = 0; i < first.length; i++) expect(next[i]).not.toBe(first[i]);
});
it('preserves valid UTF-8 text CRLF normalization', () => {
  const root = tempProject({ 'a.txt': 'hello\r\nworld\r\n', 'b.txt': 'hello\nworld\n' });
  expect(hashFile(join(root, 'a.txt'))).toBe(hashFile(join(root, 'b.txt')));
});
