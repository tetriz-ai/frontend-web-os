// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The CLI across a whole change: closing it, later slices, unlocks, assumptions and doctor.

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, syntheticTestRun, tempProject } from '../../../kernel/testing.ts';
import type { Io } from '../commands.ts';
import { main } from '../main.ts';

afterAll(cleanupTempProjects);

async function fwos(cwd: string, ...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (...l) => out.push(...l), err: (...l) => err.push(...l), cwd };
  const code = await main(argv, io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const SECTIONS = ["What you're approving", 'Journeys', 'Scope by platform', 'Screens and navigation', 'States per screen', 'Data and API contract', 'Architecture', 'Design system binding', 'Cross-cutting'];
const spec = `# Spec\n\n${SECTIONS.map((x, i) => `## ${i + 1}. ${x}\n\nText.\n`).join('\n')}
## 10. Acceptance criteria
### AC-list-1: Save
- Proven against: local
### AC-list-2: Filter
- Proven against: local

## 11. Release and distribution

Text.

## 12. Open questions

None.

## 13. Slices

S1.
`;
const plan = `# Plan
### TC-list-1: save
- AC: AC-list-1
- Level: component
- Status: new
### TC-list-2: filter
- AC: AC-list-2
- Level: e2e
- Status: new
${['crawl', 'a11y', 'keyboard', 'themes', 'phone', 'prod'].map((r) => `### TC-default-${r}: ${r}\n- Level: e2e\n`).join('')}`;

async function projectAtBuild(results: string, specText = spec) {
  const root = tempProject({
    'docs/app/brief.md': '# Brief\n',
    'docs/app/spec.md': specText,
    'docs/app/test-plan.md': plan,
    'docs/app/decisions.md': '| # | Date | Step | Decision | Why |\n|---|---|---|---|---|\n| D-1 | 2026-10-07 | architecture | Local mode [ASSUMED] | no backend yet |\n',
    'e2e/a.spec.ts': 'x',
    '.fwos/local/results/v.xml': `<testsuite>${results}</testsuite>`,
  });
  await fwos(root, 'init');
  await fwos(root, 'approve', 'brief', '--by', 'Ada');
  for (const t of ['research', 'architecture', 'design-system', 'screens']) await fwos(root, 'skip', t, '--reason', 'r', '--by', 'Ada');
  await fwos(root, 'approve', 'spec', '--by', 'Ada');
  await fwos(root, 'step', 'build');
  // The supplied XML is synthetic current evidence for this fixture, not a real runner.
  syntheticTestRun(root);
  return root;
}

describe('closing a change keeps the acceptance approval valid', () => {
  it('writes the same report before and after `change done`', async () => {
    const root = await projectAtBuild('<testcase classname="c" name="a @AC-list-1"/><testcase classname="c" name="b @AC-list-2"/>');
    await fwos(root, 'step', 'accept');
    expect((await fwos(root, 'report')).code).toBe(0);
    expect((await fwos(root, 'approve', 'acceptance', '--by', 'Ada')).code).toBe(0);
    expect((await fwos(root, 'change', 'done')).code).toBe(0);
    expect((await fwos(root, 'report')).out).toMatch(/Unchanged: docs\/app\/reports\/acceptance.md/);
    expect((await fwos(root, 'status')).out).toMatch(/acceptance\s+approved/);
    const check = JSON.parse((await fwos(root, 'check', 'approvals', '--json')).out);
    expect(check.results.find((r: { id: string }) => r.id === 'state/approvals').status).toBe('pass');
  });

  it('can still re-approve after every change is closed', async () => {
    const root = await projectAtBuild('<testcase classname="c" name="a @AC-list-1"/><testcase classname="c" name="b @AC-list-2"/>');
    await fwos(root, 'step', 'accept');
    await fwos(root, 'report');
    await fwos(root, 'approve', 'acceptance', '--by', 'Ada');
    await fwos(root, 'change', 'done');
    writeText(join(root, 'docs/app/reports/acceptance.md'), (readFileSync(join(root, 'docs/app/reports/acceptance.md'), 'utf8')));
    expect((await fwos(root, 'approve', 'acceptance', '--by', 'Ada')).code).toBe(0);
    writeText(join(root, 'docs/app/test-plan.md'), `${plan}### GAP-1: Real sync\n- Missing: no staging account\n`);
    expect((await fwos(root, 'signoff', 'GAP-1', '--by', 'Ada')).code).toBe(0);
  });
});

describe('ACs of later slices are pending during the build, required at acceptance', () => {
  it('passes with pending info in build, fails in accept', async () => {
    const root = await projectAtBuild('<testcase classname="c" name="a @AC-list-1"/>');
    const during = JSON.parse((await fwos(root, 'check', 'traceability', '--json')).out).results.find((r: { id: string }) => r.id === 'tests/traceability');
    expect(during.status).toBe('pass');
    expect(during.info).toContain('not built yet (pending until acceptance): AC-list-2');
    await fwos(root, 'step', 'accept');
    const at = JSON.parse((await fwos(root, 'check', 'traceability', '--json')).out).results.find((r: { id: string }) => r.id === 'tests/traceability');
    expect(at.status).toBe('fail');
    expect((await fwos(root, 'report')).out).toMatch(/not done yet \(2 blockers\)/);
  });

  it('counts a single blocker in the singular', async () => {
    const manual = spec.replace('### AC-list-2: Filter\n', '### AC-list-2: Filter\n- Manual: try it with a screen reader\n');
    const root = await projectAtBuild('<testcase classname="c" name="a @AC-list-1"/>', manual);
    await fwos(root, 'step', 'accept');
    expect((await fwos(root, 'report')).out).toMatch(/not done yet \(1 blocker\)\n\s+- AC-list-2 is a manual check waiting for a named sign-off/);
  });

  it('still fails a failing test during the build', async () => {
    const root = await projectAtBuild('<testcase classname="c" name="a @AC-list-1"><failure message="nope"/></testcase>');
    expect((await fwos(root, 'check', 'traceability')).code).toBe(1);
  });
});

describe('the report keeps every unlock, even after the test is locked again', () => {
  it('lists a re-locked unlock with its reason and reviewer', async () => {
    const root = await projectAtBuild('<testcase classname="c" name="a @AC-list-1"/><testcase classname="c" name="b @AC-list-2"/>');
    await fwos(root, 'tests', 'lock', 'e2e/a.spec.ts', '--existing');
    await fwos(root, 'tests', 'unlock', 'e2e/a.spec.ts', '--reason', 'matched the route announcer', '--reviewer', 'Grace');
    writeText(join(root, 'e2e/a.spec.ts'), 'y');
    await fwos(root, 'tests', 'lock', 'e2e/a.spec.ts', '--existing');
    await fwos(root, 'report');
    const report = readFileSync(join(root, 'docs/app/reports/acceptance.md'), 'utf8');
    expect(report).toContain('- e2e/a.spec.ts: matched the route announcer (reviewer: Grace; locked again; 0001-initial)');
  });
});

describe('assumptions read cleanly in the report', () => {
  it('turns a decisions table row into one readable line', async () => {
    const root = await projectAtBuild('<testcase classname="c" name="a @AC-list-1"/>');
    await fwos(root, 'report');
    const report = readFileSync(join(root, 'docs/app/reports/acceptance.md'), 'utf8');
    expect(report).toContain('- decisions.md: D-1 · 2026-10-07 · architecture · Local mode [ASSUMED] · no backend yet');
    expect(report).not.toContain('\\|');
  });
});

describe('doctor lists tools for this project only', () => {
  it("doesn't flag Xcode on a web-only project", async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    const d = JSON.parse((await fwos(root, 'doctor', '--json')).out);
    expect(d.tools.map((t: { name: string }) => t.name)).not.toContain('Xcode');
  });
});
