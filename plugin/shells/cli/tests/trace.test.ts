// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// A change in an adopted app, traced from the request to its evidence: the asks and the criteria
// that deliver them, the questions settled before the build, the states its interactions bring,
// a test plan that tests a changed criterion anew and says what can't run yet, the team's own
// artifacts linked per stage, what is still open at each handoff, and the trace handed out in
// text, JSON and the acceptance report. Each gap is planted against a clean control.

import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempProjects } from '../../../kernel/testing.ts';
import {
  CRITERION,
  DELTA,
  ISSUE,
  PLAN,
  REQUEST,
  accepting,
  atDelivery,
  building,
  changed,
  commitAll,
  fail,
  fwos,
  json,
  junit,
  messages,
  pass,
  proving,
  read,
  result,
  spec,
  specified,
  teamApp,
  write,
} from './support.ts';

afterAll(cleanupTempProjects);

const ID = '0002-search-the-members-list';
const states = (rows: string) => `## States\n| State | What the user sees | Criterion |\n|---|---|---|\n${rows}`;

async function adopted(...adopt: string[]) {
  const root = teamApp();
  await atDelivery(root, ...adopt);
  return root;
}

describe("the change's spec delta answers for its request", () => {
  it('traces each ask to the criteria that deliver it, and flags an ask with none, a drop with no reason and a criterion no ask names', async () => {
    const root = await adopted();
    const loose = `## Request\n"${REQUEST}"\n\n### REQ-1: Search the members by name\n\n### REQ-2: Export the list as CSV\n- Dropped: no\n`;
    await specified(root, { spec: spec({ request: loose }) });
    expect(await messages(root, 'spec/format', 'request')).toEqual([
      "REQ-1 (Search the members by name) has no criterion and isn't dropped: name the criteria that deliver it (- AC: AC-...), or drop it with why (- Dropped: <why>)",
      'REQ-2 is dropped with no reason: say why it is left out (- Dropped: <why>)',
      "AC-members-1 isn't traced to the request: name it under the ask it delivers (- AC: AC-members-1 under a ### REQ-<n>)",
    ]);
    write(root, 'docs/app/spec.md', spec());
    expect(await messages(root, 'spec/format', 'request')).toEqual([]);
  });

  it('holds the spec approval while a question is open, and flags a question written with no ID', async () => {
    const root = await adopted();
    const open = '## Open questions\n### Q-1: Does a search match emails as well as names?\n\n- Should the list remember the last search?\n';
    await specified(root, { spec: spec({ questions: open }) });
    expect(await messages(root, 'spec/format', 'question')).toEqual(['"Should the list remember the last search?" is a question with no ID: write it as ### Q-<n>: <question>, so its answer is recorded before the approval']);
    expect(await fwos(root, 'approve', 'spec', '--by', 'Example Owner')).toMatchObject({
      code: 2,
      err: expect.stringContaining('Q-1 is still open ("Does a search match emails as well as names?"): answer it in the spec delta (- Answer: <answer>) before the approval'),
    });
    // The control: the same question, answered.
    write(root, 'docs/app/spec.md', spec());
    expect(await messages(root, 'spec/format', 'question')).toEqual([]);
    expect((await fwos(root, 'approve', 'spec', '--by', 'Example Owner')).code).toBe(0);
  });

  it('flags a criterion of its own that needs interpretation, before any code changes, and leaves the criteria it carries alone', async () => {
    const root = await adopted();
    // A criterion an earlier change approved, with a word this change didn't write.
    const earlier = '### AC-members-9: The list loads quickly\n- Given 3 members, then the list shows them.\n- Proven against: mock\n';
    write(root, 'docs/app/spec.md', spec({ criteria: `## Acceptance criteria\n${earlier}` }));
    commitAll(root, 'an earlier change');
    const vague = CRITERION.replace('then only Ada shows', 'then the relevant members show quickly');
    await specified(root, { spec: spec({ criteria: `## Acceptance criteria\n${earlier}\n${vague}` }) });
    expect(await messages(root, 'spec/format', 'vague')).toEqual(['AC-members-1 says "relevant" and "quickly", which need interpretation: say exactly what the user sees, with the values or numbers that decide it']);
    // Caught at the spec: nothing of the app's code has changed yet.
    expect(changed(root).filter((f) => !/ (?:docs|\.fwos)\//.test(f))).toEqual([]);
    write(root, 'docs/app/spec.md', spec({ criteria: `## Acceptance criteria\n${earlier}\n${CRITERION}` }));
    expect(await messages(root, 'spec/format', 'vague')).toEqual([]);
  });

  it("asks for the states the change's interactions bring, a search's no-match state first, and a criterion for each", async () => {
    const root = await adopted();
    await specified(root, { spec: spec({ states: states('| filtered | only the members whose name holds the search | AC-members-1 |\n| loading | the skeleton | |\n') }) });
    expect(await messages(root, 'spec/format', 'states')).toEqual([
      'the state "loading" names no criterion: an AC that covers it, "unchanged", or "none: <why>"',
      'the change searches ("search" in the request), so a search or filter can match nothing: add "filtered-empty" to ## States with the criterion that covers it, or "none: <why>" if it can\'t happen',
    ]);
    write(root, 'docs/app/spec.md', spec({ states: states('| filtered | only the members whose name holds the search | AC-members-1 |\n| filtered-empty | No members match. | AC-members-1 |\n| loading | the skeleton | unchanged |\n') }));
    expect(await messages(root, 'spec/format', 'states')).toEqual([]);
  });
});

describe('the test plan: what the tests prove, and what the change leaves uncovered', () => {
  it('asks a changed criterion for a case that fails first, since its old tests prove what it said before', async () => {
    const root = await adopted();
    write(root, 'docs/app/spec.md', spec());
    commitAll(root, 'the first change');
    const changedSpec = spec({ criteria: `## Acceptance criteria\n${CRITERION.replace('when I search "ada"', 'when I search "ada" or "ADA@example.com"')}` });
    const existing = PLAN.replaceAll('- Status: new', '- Status: existing');
    await specified(root, { spec: changedSpec, plan: existing });
    expect(await messages(root, 'tests/plan', 'changed-ac')).toEqual([
      'AC-members-1 changes in this change, but its only cases are existing ones (TC-members-1, TC-members-2): they prove what it said before, so give it a new case that fails first',
    ]);
    write(root, 'docs/app/test-plan.md', PLAN);
    expect(await messages(root, 'tests/plan', 'changed-ac')).toEqual([]);
  });

  it('says which cases no test script of the app can run yet, and says nothing when one can', async () => {
    const root = teamApp({}, { test: 'vitest run' });
    await atDelivery(root);
    await specified(root);
    expect((await result(root, 'tests/plan')).info).toEqual(expect.arrayContaining(['no test script in package.json can run TC-members-2 (e2e) yet: add a browser runner, or name GAP-browser with what is missing']));
    const control = await adopted();
    await specified(control);
    expect((await result(control, 'tests/plan')).info?.join('\n') ?? '').not.toContain('can run');
  });
});

describe("handoffs: the team's artifacts in, the trace out, and what is open at each", () => {
  it("links the team's own artifact for a stage to the open change, and only to an open one", async () => {
    const root = await adopted();
    expect(await fwos(root, 'change', 'link', 'https://example.com/design/abc')).toMatchObject({ code: 2, err: expect.stringContaining('No change is open to link it to.') });
    await specified(root);
    const r = await fwos(root, 'change', 'link', 'https://example.com/design/abc', 'docs/product/members-prd.md', '--stage', 'design');
    expect(r.code, r.err).toBe(0);
    expect(r.out.split('\n')).toEqual([
      `Linked to change ${ID}: https://example.com/design/abc, for design and exploration.`,
      expect.stringMatching(new RegExp(`^Linked to change ${ID}: docs/product/members-prd\\.md \\(at [0-9a-f]{12}\\), for design and exploration\\.$`)),
    ]);
    expect(JSON.parse((await fwos(root, 'change', 'show')).out).links).toEqual([
      { ref: ISSUE },
      { ref: 'https://example.com/design/abc', stage: 'design' },
      { ref: 'docs/product/members-prd.md', sha: expect.stringMatching(/^[0-9a-f]{12}$/), stage: 'design' },
    ]);
    expect(await fwos(root, 'change', 'link', 'docs/nope.md')).toMatchObject({ code: 2, err: expect.stringContaining("docs/nope.md isn't a URL or a file in the project") });
    expect(await fwos(root, 'change', 'link', ISSUE, '--stage', 'review')).toMatchObject({ code: 2, err: expect.stringContaining('Unknown stage "review"') });
  });

  it('says what is carried into each step: at the spec approval, the build, acceptance and the close', async () => {
    const root = await adopted('--keep', 'design', '--reason', 'our designers review every state');
    await specified(root);
    const assumed = "A team has at most 100 members, so the list isn't paged.";
    expect((await json(root, 'next')).open).toEqual({
      questions: [],
      assumptions: [{ text: assumed, file: 'docs/app/spec.md' }],
      dropped: [{ id: 'REQ-2', title: 'Export the list as CSV', why: 'the app has no download route; a change of its own (Example Owner)' }],
      criteria: [],
      unlinked: [{ stage: 'design', label: 'Design and exploration' }],
    });
    const approved = await fwos(root, 'approve', 'spec', '--by', 'Example Owner');
    expect(approved.out.split('\n').slice(1)).toEqual([
      'Carried into the build: 1 assumption, 1 dropped ask and 1 kept stage with nothing linked.',
      `  - assumed: ${assumed} (docs/app/spec.md)`,
      '  - dropped: REQ-2 Export the list as CSV: the app has no download route; a change of its own (Example Owner)',
      '  - kept, nothing linked: design and exploration (`fwos change link <url|path> --stage design`)',
    ]);
    expect((await fwos(root, 'change', 'link', 'https://example.com/design/abc', '--stage', 'design')).code).toBe(0);
    expect((await fwos(root, 'step', 'build')).out).toContain('Carried into the build: 1 assumption and 1 dropped ask.');
    proving(root);
    await fwos(root, 'tests', 'run');
    expect((await fwos(root, 'step', 'accept')).out).toContain('Carried into acceptance: 1 assumption and 1 dropped ask.');
  });

  it('carries nothing for a code-only change, whose spec is an earlier change\'s', async () => {
    const root = await adopted();
    write(root, 'docs/app/spec.md', spec());
    commitAll(root, 'an earlier change, with an ask it dropped');
    expect((await fwos(root, 'change', 'new', 'fix the members heading', '--route', 'code-only')).code).toBe(0);
    expect((await json(root, 'next')).open).toBeUndefined();
    expect((await fwos(root, 'step', 'accept')).out).not.toContain('Carried into');
  });

  it("leaves a dropped ask out of the states it would bring", async () => {
    const root = await adopted();
    expect((await fwos(root, 'change', 'new', 'show every member', '--route', 'touches-ac')).code).toBe(0);
    await fwos(root, 'change', 'map', '/members');
    const request = '## Request\n"show every member"\n\n### REQ-1: Show every member\n- AC: AC-members-1\n\n### REQ-2: Filter them by role\n- Dropped: a change of its own (Example Owner)\n';
    const every = '### AC-members-1: The list shows every member\n- Given three members, then all three show.\n- Proven against: mock\n';
    write(root, 'docs/app/spec.md', spec({ request, states: states('| ready | every member | AC-members-1 |\n'), criteria: `## Acceptance criteria\n${every}` }));
    // Nothing the change does searches or filters: the ask that would have is dropped.
    expect(await messages(root, 'spec/format', 'states')).toEqual([]);
  });

  it('shows a criterion dropped since the change began, and says when nothing is open', async () => {
    const root = await adopted();
    const earlier = '### AC-members-9: The list shows each role\n- Given 3 members, then each shows their role.\n- Proven against: mock\n';
    write(root, 'docs/app/spec.md', spec({ criteria: `## Acceptance criteria\n${earlier}` }));
    commitAll(root, 'an earlier change');
    await specified(root);
    expect((await json(root, 'next')).open.criteria).toEqual(['AC-members-9']);
    expect((await fwos(root, 'approve', 'spec', '--by', 'Example Owner')).out).toContain('  - dropped: AC-members-9, in the spec when the change began');
    const clean = await adopted();
    await specified(clean, { spec: spec({ context: DELTA.context.replace(/- \[ASSUMED\].*\n/, ''), request: DELTA.request.replace(/\n### REQ-2[\s\S]*$/, '\n') }) });
    expect((await fwos(clean, 'approve', 'spec', '--by', 'Example Owner')).out).toContain('Nothing open carried into the build.');
  });

  it('traces the change from the request to its evidence, in text and JSON', async () => {
    const root = await adopted();
    await specified(root);
    await accepting(root);
    const t = await json(root, 'change', 'trace');
    expect(t.change).toEqual({ id: ID, title: REQUEST, route: 'touches-ac', step: 'accept', status: 'open' });
    expect(t.links).toEqual([{ ref: ISSUE }]);
    expect(t.stages.map((s: { id: string; by: string }) => `${s.id}:${s.by}`)).toEqual(['idea:fwos', 'design:fwos', 'spec:fwos', 'test-plan:fwos', 'build:fwos', 'acceptance:fwos']);
    expect(t.asks).toEqual([
      { id: 'REQ-1', title: 'Search the members by name', criteria: ['AC-members-1'], verdict: 'proven' },
      { id: 'REQ-2', title: 'Export the list as CSV', criteria: [], dropped: 'the app has no download route; a change of its own (Example Owner)', verdict: 'dropped' },
    ]);
    expect(t.questions).toEqual([{ id: 'Q-1', text: 'Does a search match emails as well as names?', answer: 'Names only, as the list shows them (Example Owner)' }]);
    expect(t.states).toEqual([
      { state: 'filtered', what: 'only the members whose name holds the search', criteria: ['AC-members-1'] },
      { state: 'filtered-empty', what: 'No members match.', criteria: ['AC-members-1'] },
    ]);
    expect(t.criteria).toMatchObject([
      {
        id: 'AC-members-1',
        title: 'Searching narrows the list',
        own: 'added',
        verdict: 'proven',
        browser: true,
        cases: [
          { id: 'TC-members-1', level: 'component', status: 'new', runnable: true },
          { id: 'TC-members-2', level: 'e2e', status: 'new', runnable: true },
        ],
      },
    ]);
    expect(t.regression).toEqual([
      { path: 'app/members/members.test.tsx', ran: true, passed: 1, failed: 0, skipped: 0 },
      { path: 'e2e/members.spec.ts', ran: true, passed: 1, failed: 0, skipped: 0 },
    ]);
    expect(t.build).toEqual({ edited: [], added: [], outside: [] });
    expect(t.open.dropped).toEqual([{ id: 'REQ-2', title: 'Export the list as CSV', why: 'the app has no download route; a change of its own (Example Owner)' }]);
    const text = (await fwos(root, 'change', 'trace')).out.split('\n');
    expect(text[0]).toBe(`Change ${ID}: ${REQUEST} (touches-ac, step accept, open)`);
    expect(text).toEqual(
      expect.arrayContaining([
        '  REQ-1  Search the members by name -> AC-members-1: PROVEN',
        '  REQ-2  Export the list as CSV: dropped (the app has no download route; a change of its own (Example Owner))',
        '  Q-1  Does a search match emails as well as names? Names only, as the list shows them (Example Owner)',
        '  AC-members-1  added  TC-members-1 (component, new), TC-members-2 (e2e, new): PROVEN, seen in a browser',
        '  app/members/members.test.tsx: 1 passed',
      ]),
    );
  });

  it('puts the trace in the acceptance report, with what is open at acceptance', async () => {
    const root = await adopted('--keep', 'design', '--reason', 'our designers review every state');
    await specified(root);
    expect((await fwos(root, 'change', 'link', 'https://example.com/design/abc', '--stage', 'design')).code).toBe(0);
    await accepting(root);
    const report = read(root, 'docs/app/reports/acceptance.md');
    expect(report).toContain(
      [
        '## Traceability',
        '',
        `From the request to the evidence for ${ID}: who served each stage, each ask and the criteria that deliver it, the questions settled before the build, the states, and each criterion's cases.`,
        '',
        '| Stage | By | Artifact |',
        '|---|---|---|',
        '| Idea and discovery | fwos | docs/app/spec.md ## Request |',
        '| Design and exploration | your team (kept: our designers review every state) | https://example.com/design/abc |',
        '| Specification | fwos | docs/app/spec.md |',
        '| Test planning | fwos | docs/app/test-plan.md |',
        '| Implementation | fwos | the change\'s edits, held to what it maps |',
        '| Review, testing and acceptance | fwos | this report |',
        '',
        '| Ask | Criteria | Verdict |',
        '|---|---|---|',
        '| REQ-1: Search the members by name | AC-members-1 | PROVEN |',
        '| REQ-2: Export the list as CSV | dropped: the app has no download route; a change of its own (Example Owner) | - |',
        '',
        'Questions settled before the build:',
        '',
        '- Q-1: Does a search match emails as well as names? Names only, as the list shows them (Example Owner)',
        '',
        '| Criterion | Own | Cases | Verdict |',
        '|---|---|---|---|',
        '| AC-members-1 | added | TC-members-1 (component, new), TC-members-2 (e2e, new) | PROVEN, seen in a browser |',
        '',
        'Open at acceptance: 1 assumption and 1 dropped ask.',
        '',
        "- assumed: A team has at most 100 members, so the list isn't paged. (docs/app/spec.md)",
        '- dropped: REQ-2 Export the list as CSV: the app has no download route; a change of its own (Example Owner)',
      ].join('\n'),
    );
    // Kept, the design states aren't fwos's: the delta has them, but the report doesn't hold the team to them.
    expect(report).not.toContain('| State | Criterion |');
    // The same evidence, the same report.
    expect((await fwos(root, 'report')).out).toContain('Unchanged: docs/app/reports/acceptance.md');
  });

  it('carries a failing criterion back to the ask it came from', async () => {
    const root = await adopted();
    await specified(root);
    await building(root);
    proving(root);
    write(root, 'fake-vitest.xml', junit(fail('narrows the list @AC-members-1', 'expected 1 row, got 3', 'app/members/search.test.tsx'), pass('lists members')));
    await fwos(root, 'tests', 'run');
    await fwos(root, 'step', 'accept');
    expect((await fwos(root, 'report')).code).toBe(1);
    expect((await json(root, 'change', 'trace')).asks[0]).toEqual({ id: 'REQ-1', title: 'Search the members by name', criteria: ['AC-members-1'], verdict: 'failing' });
    expect(read(root, 'docs/app/reports/acceptance.md')).toContain('| REQ-1: Search the members by name | AC-members-1 | FAILING |');
  });
});
