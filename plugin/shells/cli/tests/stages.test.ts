// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The adoption proposal stage by stage, from the idea to its acceptance: for each, what the team
// does today (with the file it was read from), what that leaves open, what fwos adds and what
// would show it helped. A team that judges a stage well served keeps its own practice there, and
// fwos then adds nothing to it: each kept stage is tested against a clean control.

import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempProjects } from '../../../kernel/testing.ts';
import {
  CRITERION,
  DELTA,
  ISSUE,
  accepting,
  atDelivery,
  bareApp,
  changed,
  commitAll,
  denied,
  fwos,
  json,
  messages,
  read,
  result,
  spec,
  specified,
  teamApp,
  write,
} from './support.ts';

afterAll(cleanupTempProjects);

type Row = { id: string; label: string; level: string; status: string; today: { what: string; from: string }[]; gap: string; adds: string; evidence: string; kept?: { reason: string; at: string } };
const stages = async (root: string, ...args: string[]) => (await json(root, 'adopt', ...args)).stages as Row[];
const stage = (rows: Row[], id: string) => rows.find((r) => r.id === id)!;
const TODAY = /^\d{4}-\d{2}-\d{2}$/;

describe('the adoption proposal, stage by stage', () => {
  it('says for each stage what the team does today and where it read it, the gap fwos addresses, what it adds and what would show it helped', async () => {
    const root = teamApp();
    const rows = await stages(root, '--level', 'delivery');
    expect(rows.map((r) => [r.id, r.label, r.level, r.status])).toEqual([
      ['idea', 'Idea and discovery', 'delivery', 'fwos'],
      ['design', 'Design and exploration', 'design', 'fwos'],
      ['spec', 'Specification', 'delivery', 'fwos'],
      ['test-plan', 'Test planning', 'delivery', 'fwos'],
      ['build', 'Implementation', 'delivery', 'fwos'],
      ['acceptance', 'Review, testing and acceptance', 'checks', 'fwos'],
    ]);
    // What the team does today, each with the file it came from: never filled in from fwos.
    expect(stage(rows, 'idea').today).toEqual([
      { what: 'issue template', from: '.github/ISSUE_TEMPLATE/feature.md' },
      { what: 'product or design doc', from: 'docs/product/members-prd.md' },
    ]);
    expect(stage(rows, 'design').today).toEqual([
      { what: 'shadcn/ui (new-york)', from: 'components.json' },
      { what: '2 UI components in components/ui', from: 'components.json aliases.ui (@/components/ui)' },
      { what: 'CSS variables, with a dark theme', from: 'app/globals.css' },
    ]);
    expect(stage(rows, 'spec').today).toEqual([{ what: 'product or design doc', from: 'docs/product/members-prd.md' }]);
    expect(stage(rows, 'test-plan').today).toEqual([
      { what: 'Vitest', from: 'vitest.config.ts' },
      { what: 'Playwright', from: 'playwright.config.ts' },
      { what: '2 test files', from: 'app/members/members.test.tsx, e2e/members.spec.ts' },
      { what: 'test: vitest run', from: 'package.json scripts.test' },
      { what: 'e2e: playwright test', from: 'package.json scripts.e2e' },
    ]);
    expect(stage(rows, 'build').today).toEqual([
      { what: 'lint: eslint .', from: 'package.json scripts.lint' },
      { what: 'ESLint', from: 'eslint.config.mjs' },
      { what: 'agent instructions', from: 'AGENTS.md' },
    ]);
    expect(stage(rows, 'acceptance').today).toEqual([
      { what: 'GitHub Actions workflow (runs the tests)', from: '.github/workflows/ci.yml' },
      { what: 'pull request template', from: '.github/pull_request_template.md' },
      { what: 'code owners', from: '.github/CODEOWNERS' },
    ]);
    // The gap is what that practice leaves open; the addition and the evidence name what to read.
    expect(stage(rows, 'test-plan').gap).toBe("nothing maps a change's criteria to the tests that prove them, or names the existing tests around it");
    expect(stage(rows, 'idea').adds).toContain("the spec delta's Request: each ask with the criteria that deliver it, or dropped with why");
    expect(stage(rows, 'idea').evidence).toContain('docs/app/spec.md ## Request and ## Open questions');
    expect(stage(rows, 'design').evidence).toContain('docs/app/spec.md ## States');
    expect(stage(rows, 'spec').evidence).toContain('spec/format (vague, context, delta)');
    expect(stage(rows, 'test-plan').evidence).toContain('tests/plan, tests/regression');
    expect(stage(rows, 'acceptance').evidence).toContain('docs/app/reports/acceptance.md (## Traceability)');
    for (const r of rows) for (const field of ['gap', 'adds', 'evidence'] as const) expect(r[field], `${r.id} ${field}`).not.toBe('');
    // Read-only, like the rest of the proposal.
    expect(changed(root)).toEqual([]);
  });

  it('grounds each gap in what it found: an app with no tests, docs, lint or review has other gaps than one with them', async () => {
    const bare = await stages(bareApp(), '--level', 'delivery');
    const rich = await stages(teamApp(), '--level', 'delivery');
    for (const r of bare) expect(r.today, r.id).toEqual([]);
    expect(stage(bare, 'test-plan').gap).toBe('no test runner found, so nothing can prove a change works yet');
    expect(stage(bare, 'idea').gap).toBe('requests arrive as text: nothing writes down their asks, assumptions and open questions before the work starts');
    expect(stage(bare, 'acceptance').gap).toBe('no review workflow or CI found: nothing shows which criterion each test proves, or which findings are new');
    for (const id of ['idea', 'design', 'spec', 'test-plan', 'build', 'acceptance']) expect(stage(bare, id).gap, id).not.toBe(stage(rich, id).gap);
  });

  it('marks what a level adds later, and says so in the proposal text', async () => {
    const root = teamApp();
    const rows = await stages(root);
    expect(rows.map((r) => `${r.id}:${r.status}`)).toEqual(['idea:later', 'design:later', 'spec:later', 'test-plan:later', 'build:later', 'acceptance:fwos']);
    expect(stage(rows, 'acceptance').adds).toBe('`fwos check` fails only on findings new since the baseline');
    expect(stage(await stages(root, '--level', 'design'), 'design').status).toBe('fwos');
    const text = (await fwos(root, 'adopt', '--level', 'delivery')).out;
    expect(text).toContain('Stages at level delivery: what you have, what it leaves open, what fwos adds, and what would show it helped');
    expect(text).toMatch(/\n {2}test-plan {3}fwos {3}Test planning\n {6}have {7}Vitest \(vitest\.config\.ts\), Playwright \(playwright\.config\.ts\), /);
    expect(text).toMatch(/\n {6}open {7}nothing maps a change's criteria to the tests that prove them/);
    expect(text).toContain('A stage your team already serves well can stay yours: --keep <stage> --reason "<why>".');
    expect((await fwos(root, 'adopt')).out).toMatch(/\n {2}spec {8}later {2}Specification, at level delivery\n/);
  });
});

describe('keeping a stage the team already serves', () => {
  const REASON = 'QA plans our tests in TestRail';

  it('previews a kept stage with why, writes it on a yes, shows it in status, and gives it back', async () => {
    const root = teamApp();
    const p = await json(root, 'adopt', '--level', 'delivery', '--keep', 'test-plan', '--reason', REASON);
    expect(stage(p.stages, 'test-plan')).toMatchObject({ status: 'kept', kept: { reason: REASON, at: expect.stringMatching(TODAY) } });
    expect(p.proposal.state.adopt.keep).toEqual({ 'test-plan': { reason: REASON, at: expect.stringMatching(TODAY) } });
    expect(changed(root)).toEqual([]);

    const r = await fwos(root, 'adopt', '--level', 'delivery', '--keep', 'test-plan', '--reason', REASON, '--yes');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain(`Kept as your team's: test planning (${REASON}). fwos adds nothing there; link your own artifact to a change with \`fwos change link <url|path> --stage test-plan\`.`);
    expect(JSON.parse(read(root, '.fwos/state.json')).adopt.keep).toEqual({ 'test-plan': { reason: REASON, at: expect.stringMatching(TODAY) } });
    expect(stage((await json(root, 'status')).adoption.stages, 'test-plan')).toMatchObject({ status: 'kept', kept: { reason: REASON } });
    expect((await fwos(root, 'status')).out).toMatch(new RegExp(`\\n {2}test-plan {3}kept {3}Test planning: ${REASON}\\n`));
    commitAll(root, 'adopt fwos');

    // Giving it back keeps every record: the level, its history, the changes and the baseline.
    const before = { changes: read(root, '.fwos/changes/0001-initial.json'), baseline: read(root, '.fwos/baseline.json'), history: JSON.parse(read(root, '.fwos/state.json')).adopt.history };
    const preview = await json(root, 'adopt', '--use', 'test-plan');
    expect(preview).toMatchObject({ adopted: true, level: 'delivery', change: 'Test planning goes back to fwos. Keeps 1 change record and the baseline.' });
    expect((await fwos(root, 'adopt', '--use', 'test-plan', '--yes')).code).toBe(0);
    const state = JSON.parse(read(root, '.fwos/state.json'));
    expect(state.adopt.keep).toBeUndefined();
    expect(state.adopt).toMatchObject({ level: 'delivery', history: before.history });
    expect(read(root, '.fwos/changes/0001-initial.json')).toBe(before.changes);
    expect(read(root, '.fwos/baseline.json')).toBe(before.baseline);
  });

  it('keeps the kept stages when the level changes later', async () => {
    const root = teamApp();
    expect((await fwos(root, 'adopt', '--keep', 'acceptance', '--reason', 'QA signs off in TestRail', '--yes')).code).toBe(0);
    expect((await fwos(root, 'adopt', '--level', 'delivery', '--yes')).code).toBe(0);
    expect(JSON.parse(read(root, '.fwos/state.json')).adopt).toMatchObject({ level: 'delivery', keep: { acceptance: { reason: 'QA signs off in TestRail' } } });
    expect(stage((await json(root, 'status')).adoption.stages, 'acceptance')).toMatchObject({ status: 'kept' });
  });

  it('keeps a stage on an adopted app with the level as it is, and says so', async () => {
    const root = teamApp();
    await atDelivery(root);
    const p = await json(root, 'adopt', '--keep', 'design', '--reason', 'our designers review every state');
    expect(p.change).toBe("Design and exploration stays your team's (our designers review every state). Keeps 1 change record and the baseline.");
    expect((await fwos(root, 'adopt', '--keep', 'design', '--reason', 'our designers review every state', '--yes')).code).toBe(0);
    expect(JSON.parse(read(root, '.fwos/state.json')).adopt).toMatchObject({ level: 'delivery', keep: { design: { reason: 'our designers review every state' } } });
  });

  it('refuses a stage it does not know, a keep with no reason, and a stage both kept and given back', async () => {
    const root = teamApp();
    expect(await fwos(root, 'adopt', '--keep', 'review', '--reason', 'x')).toMatchObject({ code: 2, err: expect.stringContaining('Unknown stage "review". One of: idea, design, spec, test-plan, build, acceptance.') });
    expect(await fwos(root, 'adopt', '--keep', 'design')).toMatchObject({ code: 2, err: expect.stringContaining('Missing --reason.') });
    expect(await fwos(root, 'adopt', '--keep', 'design', '--use', 'design', '--reason', 'x')).toMatchObject({ code: 2, err: expect.stringContaining('design is in both --keep and --use: pick one.') });
  });
});

describe('a kept stage: fwos adds nothing there, against a control where fwos keeps it', () => {
  /** An adopted app at level delivery with a change on its spec delta, keeping `kept` if given. */
  async function app(kept: string | null, files: { spec?: string; plan?: string | null } = {}) {
    const root = teamApp();
    await atDelivery(root, ...(kept ? ['--keep', kept, '--reason', `the team's own ${kept} practice`] : []));
    await specified(root, files);
    return root;
  }

  it('idea: the delta needs no Request when the team keeps its own asks (its issues and PRDs)', async () => {
    const without = spec({ request: '' });
    expect(await messages(await app(null, { spec: without }), 'spec/format', 'request')).toEqual([expect.stringContaining('no "## Request"')]);
    expect(await messages(await app('idea', { spec: without }), 'spec/format', 'request')).toEqual([]);
  });

  it('design: the delta needs no States when the team keeps its own design reviews', async () => {
    const without = spec({ states: '' });
    expect(await messages(await app(null, { spec: without }), 'spec/format', 'states')).toEqual([expect.stringContaining('no "## States"')]);
    expect(await messages(await app('design', { spec: without }), 'spec/format', 'states')).toEqual([]);
  });

  it("spec: the delta holds only the criteria, each pointing at the team's own spec it came from", async () => {
    const TEAM_SPEC = 'https://example.com/specs/members-search';
    const criteria = (source: string) => `${DELTA.request}\n${DELTA.states}\n## Acceptance criteria\n${CRITERION.replace('- Proven against: mock', `- Proven against: mock\n- Source: ${source}`)}`;
    // The control: fwos's own spec delta needs its sections.
    const control = await app(null, { spec: `# Changes\n\n${criteria(TEAM_SPEC)}` });
    expect((await result(control, 'spec/format')).findings.map((f) => f.rule)).toEqual(expect.arrayContaining(['section']));
    const root = await app('spec', { spec: `# Changes\n\n${criteria(`${TEAM_SPEC}#search`)}` });
    expect(await messages(root, 'spec/format', 'source')).toEqual([expect.stringContaining('AC-members-1 names where it comes from (https://example.com/specs/members-search#search), but change 0002-search-the-members-list links no such spec')]);
    expect((await fwos(root, 'change', 'link', TEAM_SPEC, '--stage', 'spec')).code).toBe(0);
    expect(await result(root, 'spec/format')).toMatchObject({ status: 'pass', findings: [] });
    write(root, 'docs/app/spec.md', `# Changes\n\n${criteria('').replace('- Source: \n', '')}`);
    expect(await messages(root, 'spec/format', 'source')).toEqual([expect.stringContaining('AC-members-1 says nothing of where it comes from: add "- Source: <where in your spec>"')]);
  });

  it('test plan: tests/plan and tests/regression are off, and the spec is approved on its own', async () => {
    const control = await app(null, { plan: null });
    expect(await result(control, 'tests/plan')).toMatchObject({ status: 'off', reason: expect.stringContaining('no docs/app/test-plan.md yet') });
    expect(await fwos(control, 'approve', 'spec', '--by', 'Example Owner')).toMatchObject({ code: 2, err: expect.stringContaining('docs/app/test-plan.md') });
    const root = await app('test-plan', { plan: null });
    expect(await result(root, 'tests/plan')).toMatchObject({ status: 'off', reason: "kept: your team's own practice (the team's own test-plan practice); `fwos tests run` still runs your tests" });
    expect(await result(root, 'tests/regression')).toMatchObject({ status: 'off', reason: expect.stringContaining("kept: your team's own practice") });
    expect((await fwos(root, 'approve', 'spec', '--by', 'Example Owner')).code).toBe(0);
  });

  it('build: no spec gate holds an edit, and an edit outside the map keeps no change from done', async () => {
    expect(denied(await app(null), 'app/members/page.tsx')).toBe(true);
    const root = await app('build');
    expect(denied(root, 'app/members/page.tsx')).toBe(false);
    const control = await app(null);
    for (const r of [root, control]) {
      await accepting(r);
      write(r, 'app/settings/page.tsx', `${read(r, 'app/settings/page.tsx')}// tidied\n`);
      // The runs from before the edit no longer count, so the tests run again on the code as it is.
      await fwos(r, 'tests', 'run');
    }
    expect((await fwos(control, 'report')).code).toBe(1);
    expect(read(control, 'docs/app/reports/acceptance.md')).toContain('- app/settings/page.tsx was edited outside what the change maps (/members)');
    expect((await fwos(root, 'report')).code).toBe(0);
    expect(read(root, 'docs/app/reports/acceptance.md')).toContain('Edited outside what it maps: app/settings/page.tsx (implementation is your team\'s here)');
  });

  it("acceptance: the change closes on the team's own sign-off, linked, with no fwos approval", async () => {
    const control = await app(null);
    await accepting(control);
    expect(await fwos(control, 'change', 'done')).toMatchObject({ code: 2, err: expect.stringContaining('needs the acceptance report approved first') });
    const root = await app('acceptance');
    await accepting(root);
    expect(await fwos(root, 'change', 'done')).toMatchObject({ code: 2, err: expect.stringContaining("acceptance is your team's here (the team's own acceptance practice): link its sign-off first, with `fwos change link <url|path> --stage acceptance`") });
    expect((await json(root, 'next')).action).toMatch(/^Acceptance is your team's here/);
    expect((await fwos(root, 'change', 'link', `${ISSUE}#issuecomment-9`, '--stage', 'acceptance')).code).toBe(0);
    const done = await fwos(root, 'change', 'done');
    expect(done.code, done.err).toBe(0);
    expect(JSON.parse(read(root, '.fwos/changes/0002-search-the-members-list.json')).approvals.acceptance).toBeUndefined();
  });
});
