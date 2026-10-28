// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Test helpers shared by every module's tests. Not part of the runtime bundle.

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adapterSet, type Harness, type PlatformProfile } from './adapters.ts';
import type { CheckContext } from './check.ts';
import { writeText } from './files.ts';
import { hashText } from './hash.ts';
import { loadResults } from './results.ts';
import { loadProject } from './project.ts';
import { type RunKind, type RunRecord, revisionOf, resultDigest, testInputRevision, writeRun } from './runs.ts';

const made: string[] = [];

/** Writes `files` (relative path -> content) into a fresh temp folder and returns its path. */
export function tempProject(files: Record<string, string | object> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'fwos-test-'));
  made.push(root);
  writeFiles(root, files);
  return root;
}

export function writeFiles(root: string, files: Record<string, string | object>): void {
  for (const [rel, content] of Object.entries(files)) {
    writeText(join(root, rel), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
}

/** Copies a fixture folder into a temp folder, so a test can plant violations without touching it. */
export function copyFixture(from: string): string {
  const root = mkdtempSync(join(tmpdir(), 'fwos-test-'));
  made.push(root);
  cpSync(from, root, { recursive: true });
  return root;
}

export function cleanupTempProjects(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function contextFor(root: string, profiles: PlatformProfile[] = []): CheckContext {
  return { project: loadProject(root), adapters: adapterSet(profiles) };
}

/** Stand-ins for fwos's harness files: what a test's web profile ships, and where. */
export const TEST_HARNESS: Harness[] = [
  { kind: 'states', file: 'apps/web/e2e/fwos-states.spec.ts', content: '// fwos state harness (test stand-in)\n' },
  { kind: 'ia', file: 'apps/web/e2e/fwos-ia.spec.ts', content: '// fwos ia harness (test stand-in)\n' },
];

/** A web profile whose verify driver ships TEST_HARNESS, over any other adapters a test gives it. */
export function harnessProfile(extra: Partial<PlatformProfile> = {}): PlatformProfile {
  return {
    platform: 'web',
    status: 'supported',
    checks: [],
    tools: [],
    verify: { platform: 'web', name: 'test', probe: () => ({ ready: true }), harness: () => TEST_HARNESS },
    ...extra,
  };
}

/** Puts the stand-in harness files in the app, as `fwos harness` would. */
export function installHarness(root: string): void {
  writeFiles(root, Object.fromEntries(TEST_HARNESS.map((h) => [h.file, h.content])));
}

/** Records a run of the stand-in harness on the project as it is now, as `fwos harness record` would. */
export function recordRun<T>(root: string, kind: RunKind, target: string, observations: T, over: Partial<RunRecord<T>> = {}): string {
  const project = loadProject(root);
  const harness = TEST_HARNESS.find((h) => h.kind === kind)!;
  return writeRun(project, {
    schema: 1,
    kind,
    target,
    fwos: '0.1.0',
    harness: { file: harness.file, sha: hashText(harness.content) },
    revision: revisionOf(project),
    config: { server: 'production build', browser: 'chromium' },
    at: '2026-10-23T00:00:00.000Z',
    observations,
    ...over,
  });
}

export const minimalState = (extra: object = {}) => ({
  schema: 1,
  pluginVersion: '0.1.0',
  mode: 'new',
  platforms: ['web'],
  currentChange: '0001-initial',
  ...extra,
});

/** Synthetic run evidence for unit fixtures only; never represents a real test execution. */
export function syntheticTestRun(root: string): void {
  const project = loadProject(root); const { files, cases } = loadResults(project);
  const counts = { passed: 0, failed: 0, skipped: 0 }; for (const c of cases) counts[c.status]++;
  writeRun(project, { schema: 1, kind: 'tests', target: 'synthetic-fixture', fwos: '0.1.0', harness: null, revision: revisionOf(project), at: '2026-10-07T00:00:00.000Z',
    config: { evidence: 'inputs-and-results-v1', testInputs: testInputRevision(project), ...Object.fromEntries(files.map((file) => [`result:${file}`, resultDigest(project, file)!])) },
    observations: { script: 'synthetic-fixture', dir: '.', display: 'synthetic fixture, not an execution', command: 'synthetic fixture', runner: 'fixture', browser: true, mapped: cases.length > 0, exit: 0, results: files, cases: counts } });
}
