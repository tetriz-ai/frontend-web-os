// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { afterAll, describe, expect, it } from 'vitest';
import { type CheckResult, loadProject } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { initProject, skip, updateChange } from '../../state/index.ts';
import { buildReport } from '../index.ts';

afterAll(cleanupTempProjects);

const spec = `### AC-list-1: Save a link
- Proven against: local
### AC-list-2: Mark read
- Proven against: local
### AC-list-3: VoiceOver
- Proven against: real
- Manual: needs a person with a screen reader
### AC-list-4: Share
- Proven against: real
- Release: later
`;

function project(results: string) {
  const root = tempProject({
    'docs/app/spec.md': spec,
    'docs/app/brief.md': '# Brief\n- Offline: yes [ASSUMED] single device\n',
    'docs/app/test-plan.md': '### GAP-1: Real sync\n- Missing: no staging account\n',
    '.fwos/local/results/vitest.xml': `<testsuite>${results}</testsuite>`,
  });
  initProject(root);
  return { root, p: loadProject(root) };
}

const checks: CheckResult[] = [
  { id: 'architecture/walls', status: 'pass', findings: [], inputs: [], info: ['12 files'] },
  { id: 'design-system/chart-palette', status: 'off', reason: 'chart palette blank (slot C9): chart colour check off', findings: [], inputs: [] },
];

describe('buildReport', () => {
  it('is not done while ACs fail, manual checks and gaps wait, or checks fail', () => {
    const { p } = project('<testcase classname="a" name="saves @AC-list-1"/><testcase classname="a" name="marks @AC-list-2"><failure message="no Read tab"/></testcase>');
    const r = buildReport(p, [...checks, { id: 'design-system/tokens', status: 'fail', reason: '2 findings', findings: [], inputs: [] }], { web: 'supported' });
    expect(r.done).toBe(false);
    expect(r.blockers).toEqual([
      'AC-list-2 is failing',
      'AC-list-3 is a manual check waiting for a named sign-off',
      'GAP-1 (Real sync) is a named gap waiting for a sign-off',
      'check design-system/tokens fails: 2 findings',
    ]);
    expect(r.markdown).toContain('| AC-list-2 | Mark read | FAILING: no Read tab | local |');
    expect(r.markdown).toContain('| design-system/chart-palette | OFF | chart palette blank (slot C9): chart colour check off |');
    expect(r.markdown).toContain('- brief.md: Offline: yes [ASSUMED] single device');
    expect(r.markdown).toContain('- AC-list-4: Share (NOT RUN)');
  });

  it('is done once everything is proven or signed off, and lists skips and autopilot approvals', () => {
    const { root, p } = project('<testcase classname="a" name="saves @AC-list-1"/><testcase classname="a" name="marks @AC-list-2"/>');
    skip(p, 'research', 'no web access', 'Ada');
    updateChange(root, (c) => {
      c.signoffs = [
        { item: 'AC-list-3', by: 'Ada', at: '2026-10-07', note: 'walked it with VoiceOver' },
        { item: 'GAP-1', by: 'Grace', at: '2026-10-07' },
      ];
      c.approvals.brief = { sha: 'x', files: {}, by: 'autopilot', at: '2026-10-07', via: 'autopilot' };
    });
    const r = buildReport(p, checks);
    expect(r.blockers).toEqual([]);
    expect(r.done).toBe(true);
    expect(r.markdown).toContain('Verdict: **Done**');
    expect(r.markdown).toContain('| AC-list-3 | VoiceOver | SIGNED OFF by Ada |');
    expect(r.markdown).toContain('- research skipped by Ada in 0001-initial: no web access');
    expect(r.markdown).toContain('brief approved by autopilot');
  });

  it('is the same file for the same evidence', () => {
    const { p } = project('<testcase classname="a" name="saves @AC-list-1"/>');
    expect(buildReport(p, checks).markdown).toBe(buildReport(p, checks).markdown);
  });
});
