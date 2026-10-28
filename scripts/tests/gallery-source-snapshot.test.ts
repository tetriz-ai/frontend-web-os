// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { writeText } from '../../plugin/kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../plugin/kernel/testing.ts';
import { IMPORT_SAMPLE, restoreSources, snapshotSources } from './support/gallery-samples.ts';
afterAll(cleanupTempProjects);
it('preserves source bytes and their recorded SHA256 when reconstructing a sample input', () => {
  const root = tempProject({ 'apps/web/app/globals.css': '.bg-brand {color: blue;}\r\n', 'pnpm-lock.yaml': 'lockfileVersion: 9.0\n' });
  const snapshot = snapshotSources(root, IMPORT_SAMPLE); const restored = tempProject({});
  restoreSources(restored, snapshot);
  expect(readFileSync(`${restored}/apps/web/app/globals.css`)).toEqual(readFileSync(`${root}/apps/web/app/globals.css`));
  expect(snapshot.files['pnpm-lock.yaml']?.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(snapshot.validationSource).toMatch(/^[a-f0-9]{64}$/);
  expect(snapshot).not.toHaveProperty('validationCommit');
});
it('refuses generator drift rather than repinning sample evidence', () => {
  const root = tempProject({ 'apps/web/app/page.tsx': 'export default function P(){return null;}' });
  const snapshot = snapshotSources(root, IMPORT_SAMPLE); snapshot.generator.find((entry) => entry.path === 'plugin/platforms/web/gallery.ts')!.sha256 = 'changed';
  expect(() => restoreSources(tempProject({}), snapshot)).toThrow(/generator\/version changed/);
});
it('rejects edited snapshot bytes and path traversal', () => {
  const root = tempProject({ 'apps/web/app/page.tsx': 'export default function P(){return null;}' });
  const snapshot = snapshotSources(root, IMPORT_SAMPLE); snapshot.files['apps/web/app/page.tsx']!.content += 'changed';
  expect(() => restoreSources(tempProject({}), snapshot)).toThrow(/byte hash/);
  const valid = snapshotSources(root, IMPORT_SAMPLE); valid.files['../escape.ts'] = valid.files['apps/web/app/page.tsx']!;
  expect(() => restoreSources(tempProject({}), valid)).toThrow(/Unsafe.*path/);
});
it('refuses live env input and unexpected binary data without excluding them from freshness', () => {
  const root = tempProject({ 'apps/web/.env': 'PUBLIC_SYNTHETIC_VALUE=test-only\n' });
  expect(() => snapshotSources(root, IMPORT_SAMPLE)).toThrow(/Credential-bearing/);
  const binary = tempProject({});
  // An actual valid PNG, not an invalid-UTF8 pseudo-image.
  const bytes = readFileSync(new URL('../../plugin/kernel/tests/fixtures/pixel-0.png', import.meta.url));
  writeText(`${binary}/apps/web/public/input.bin`, '');
  writeFileSync(`${binary}/apps/web/public/input.bin`, bytes);
  expect(() => snapshotSources(binary, IMPORT_SAMPLE)).toThrow(/Unsupported binary/);
});

it('rejects a content identity from another gallery snapshot', () => {
  const snapshot = snapshotSources(tempProject({}), IMPORT_SAMPLE);
  snapshot.validationSource = '0'.repeat(64);
  expect(() => restoreSources(tempProject({}), snapshot)).toThrow(/content identity/);
});
