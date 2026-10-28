// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// An adopted app's change, traced from the request to its evidence: who served each stage (fwos,
// or the team with its own artifact linked), each ask and the criteria that deliver it, the
// questions settled before the build, the states, each criterion's cases and verdict, the team's
// regression tests and the build's edits. And what is still open at a handoff: open questions,
// assumptions, asks dropped, criteria dropped since the change began, kept stages with nothing
// linked. `fwos change trace` hands it out, the CLI says what is open at each step, and the
// acceptance report carries it.

import { posix } from 'node:path';
import { ADOPT_STAGES, type AdoptStage, type Project, STAGE_LABELS, hashPath } from '../../kernel/index.ts';
import { type ChangeDrift, changeDrift } from '../build/index.ts';
import { acDelta, parseAcs, parseQuestions, parseRequest, parseStates, specPath } from '../spec/index.ts';
import { type Change, type Link, type Step, keptStages } from '../state/index.ts';
import { type AcTrace, type AcVerdict, BROWSER_LEVELS, type Runners, browserResults, parseRegressionScope, parseTestPlan, regressionResults, tally, testPlanPath, traceAcs } from '../tests/index.ts';

export const reportPath = (p: Project) => posix.join(p.paths.docs, 'reports', 'acceptance.md');

export const VERDICT_LABEL: Record<AcTrace['verdict'], string> = {
  proven: 'PROVEN',
  failing: 'FAILING',
  'not-run': 'NOT RUN',
  'quarantined-only': 'NOT PROVEN (quarantined only)',
  manual: 'MANUAL',
};

/** What is still open when a change moves on: at its spec approval, each step, its acceptance and its close. */
export interface OpenItems {
  questions: { id: string; text: string }[];
  assumptions: { text: string; file: string }[];
  dropped: { id: string; title: string; why: string }[];
  /** Criteria in the spec when the change began, gone now. */
  criteria: string[];
  /** Stages the team keeps whose artifact the change doesn't link yet. */
  unlinked: { stage: AdoptStage; label: string }[];
}

export type AskVerdict = AcVerdict | 'dropped' | 'no criterion';

export interface ChangeTrace {
  change: Pick<Change, 'id' | 'title' | 'route' | 'step' | 'status'>;
  links: (Link & { changed?: boolean })[];
  stages: { id: AdoptStage; label: string; by: 'fwos' | 'team'; reason?: string; artifacts: string[] }[];
  asks: { id: string; title: string; criteria: string[]; dropped?: string; verdict: AskVerdict }[];
  questions: { id: string; text: string; answer?: string }[];
  states: { state: string; what: string; criteria: string[]; note?: string }[];
  criteria: {
    id: string;
    title: string;
    /** Added or changed by this change, or carried from an earlier one; null when it recorded no base. */
    own: 'added' | 'changed' | 'carried' | null;
    verdict: AcVerdict;
    /** Proven by a passing test from a browser run of this code. */
    browser: boolean;
    cases: { id: string; level: string; status: string; runnable?: boolean }[];
    tests: { name: string; status: string; results: string }[];
  }[];
  regression: { path: string; ran: boolean; passed: number; failed: number; skipped: number; failures?: { name: string; failure?: string }[] }[];
  /** The change's edits against what it maps; null when it isn't mapped or git can't say. */
  build: ChangeDrift | null;
  open: OpenItems;
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 0 ? '' : `${n} ${n === 1 ? one : many}`);
const andList = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** The `[ASSUMED]` lines of the change's spec delta and test plan, outside code fences. */
function assumedIn(project: Project): OpenItems['assumptions'] {
  const found: OpenItems['assumptions'] = [];
  for (const file of [specPath(project), testPlanPath(project)]) {
    let fence = false;
    for (const raw of (project.read(file) ?? '').split(/\r?\n/)) {
      if (/^\s*```/.test(raw)) fence = !fence;
      if (fence || !raw.includes('[ASSUMED]')) continue;
      const row = raw.trim().startsWith('|') ? raw.split('|').map((c) => c.trim()).filter(Boolean).join(' · ') : raw.trim().replace(/^[-*]\s+/, '');
      found.push({ text: row.replace(/\[ASSUMED\]\s*/, '').trim(), file });
    }
  }
  return found;
}

/** The links that are the team's own artifact for a stage. Links with no stage are what the request came from, so they serve the idea. */
const linksFor = (change: Change, stage: AdoptStage) => (change.links ?? []).filter((l) => l.stage === stage || (stage === 'idea' && !l.stage)).map((l) => l.ref);

/** What is open in `change` as it moves on. */
export function openItems(project: Project, change: Change): OpenItems {
  const spec = project.read(specPath(project)) ?? '';
  return {
    questions: parseQuestions(spec).questions.filter((q) => !q.answer).map((q) => ({ id: q.id, text: q.text })),
    assumptions: assumedIn(project),
    dropped: parseRequest(spec).asks.filter((a) => a.dropped !== undefined).map((a) => ({ id: a.id, title: a.title, why: a.dropped! })),
    criteria: acDelta(change, spec)?.dropped ?? [],
    unlinked: project.kept.filter((s) => linksFor(change, s).length === 0).map((stage) => ({ stage, label: STAGE_LABELS[stage] })),
  };
}

/** `1 assumption, 1 dropped ask and 1 kept stage with nothing linked`; empty when nothing is open. */
export function openSummary(o: OpenItems): string {
  return andList(
    [
      plural(o.questions.length, 'open question'),
      plural(o.assumptions.length, 'assumption'),
      plural(o.dropped.length, 'dropped ask'),
      plural(o.criteria.length, 'dropped criterion', 'dropped criteria'),
      plural(o.unlinked.length, 'kept stage with nothing linked', 'kept stages with nothing linked'),
    ].filter(Boolean),
  );
}

/** One line per open item, unprefixed. */
export function openLines(o: OpenItems): string[] {
  return [
    ...o.questions.map((q) => `open: ${q.id} ${q.text}`),
    ...o.assumptions.map((a) => `assumed: ${a.text} (${a.file})`),
    ...o.dropped.map((d) => `dropped: ${d.id} ${d.title}: ${d.why}`),
    ...o.criteria.map((id) => `dropped: ${id}, in the spec when the change began`),
    ...o.unlinked.map((u) => `kept, nothing linked: ${u.label.toLowerCase()} (\`fwos change link <url|path> --stage ${u.stage}\`)`),
  ];
}

/** Where a change at `step` goes next, as a handoff names it: `the build`, `acceptance`. */
export function handoffName(step: Step): string {
  return step === 'accept' ? 'acceptance' : step === 'done' ? 'the close' : `the ${step}`;
}

/** An ask is proven when every criterion that delivers it is; otherwise it takes the worst verdict among them. */
function askVerdict(ids: string[], verdicts: Map<string, AcVerdict>): AcVerdict {
  const vs = ids.map((id) => verdicts.get(id) ?? 'not-run');
  if (vs.every((v) => v === 'proven')) return 'proven';
  return (['failing', 'quarantined-only', 'not-run', 'manual'] as const).find((v) => vs.includes(v)) ?? 'not-run';
}

/** The whole trace of `change`. `runners`, when given, says which of its cases the app's own test scripts can run. */
export function traceChange(project: Project, change: Change, runners: Runners | null = null): ChangeTrace {
  const spec = project.read(specPath(project)) ?? '';
  const plan = project.read(testPlanPath(project));
  const delta = acDelta(change, spec);
  const traced = traceAcs(project)?.acs ?? [];
  const verdicts = new Map(traced.map((t) => [t.ac.id, t.verdict]));
  const browser = browserResults(project);
  const cases = plan === null ? [] : parseTestPlan(plan).cases;
  const kept = keptStages(project.root);
  const ours: Record<AdoptStage, string> = {
    idea: `${specPath(project)} ## Request`,
    design: `${specPath(project)} ## States`,
    spec: specPath(project),
    'test-plan': testPlanPath(project),
    build: "the change's edits, held to what it maps",
    acceptance: reportPath(project),
  };
  return {
    change: { id: change.id, title: change.title, route: change.route, step: change.step, status: change.status },
    links: (change.links ?? []).map((l) => (l.sha && hashPath(project.abs(l.ref)) !== l.sha ? { ...l, changed: true } : l)),
    stages: ADOPT_STAGES.map((id) => {
      const k = kept[id];
      return k ? { id, label: STAGE_LABELS[id], by: 'team' as const, reason: k.reason, artifacts: linksFor(change, id) } : { id, label: STAGE_LABELS[id], by: 'fwos' as const, artifacts: [ours[id]] };
    }),
    asks: parseRequest(spec).asks.map((a) => ({
      id: a.id,
      title: a.title,
      criteria: a.criteria,
      ...(a.dropped !== undefined ? { dropped: a.dropped } : {}),
      verdict: a.dropped !== undefined ? 'dropped' : a.criteria.length === 0 ? 'no criterion' : askVerdict(a.criteria, verdicts),
    })),
    questions: parseQuestions(spec).questions.map((q) => ({ id: q.id, text: q.text, ...(q.answer ? { answer: q.answer } : {}) })),
    states: parseStates(spec).rows.map((r) => ({ state: r.state, what: r.what, criteria: r.criteria, ...(r.note ? { note: r.note } : {}) })),
    criteria: parseAcs(spec).map((ac) => {
      const t = traced.find((x) => x.ac.id === ac.id);
      const tests = t?.tests ?? [];
      return {
        id: ac.id,
        title: ac.title,
        own: !delta ? null : delta.added.includes(ac.id) ? 'added' : delta.changed.includes(ac.id) ? 'changed' : 'carried',
        verdict: t?.verdict ?? 'not-run',
        browser: t?.verdict === 'proven' && tests.some((x) => x.status === 'passed' && browser.has(x.source)),
        cases: cases
          .filter((c) => c.acs.includes(ac.id))
          .map((c) => ({ id: c.id, level: c.level ?? '', status: c.status ?? '', ...(runners && c.level && c.level !== 'manual' ? { runnable: BROWSER_LEVELS.includes(c.level) ? runners.browser : runners.any } : {}) })),
        tests: tests.map((x) => ({ name: x.name, status: x.status, results: x.source })),
      };
    }),
    regression: plan === null ? [] : regressionResults(project, parseRegressionScope(plan).entries).map(({ failures, ...r }) => (failures.length > 0 ? { ...r, failures } : r)),
    build: changeDrift(project, change),
    open: openItems(project, change),
  };
}

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const caseList = (cs: ChangeTrace['criteria'][number]['cases']) => cs.map((c) => `${c.id} (${c.level}, ${c.status})`).join(', ') || 'none';
const verdictLine = (c: ChangeTrace['criteria'][number]) => `${VERDICT_LABEL[c.verdict]}${c.browser ? ', seen in a browser' : ''}`;

/** The trace as the acceptance report's `## Traceability` section. */
export function traceMarkdown(project: Project, t: ChangeTrace): string[] {
  const out = [
    '## Traceability',
    '',
    `From the request to the evidence for ${t.change.id}: who served each stage, each ask and the criteria that deliver it, the questions settled before the build, the states, and each criterion's cases.`,
    '',
    '| Stage | By | Artifact |',
    '|---|---|---|',
    ...t.stages.map((s) => {
      const artifact = s.by === 'fwos' ? (s.id === 'acceptance' ? 'this report' : s.artifacts.join(', ')) : s.artifacts.join(', ') || 'nothing linked';
      return `| ${s.label} | ${s.by === 'fwos' ? 'fwos' : `your team (kept: ${esc(s.reason ?? '')})`} | ${esc(artifact)} |`;
    }),
    '',
  ];
  if (t.asks.length > 0) {
    out.push('| Ask | Criteria | Verdict |', '|---|---|---|');
    for (const a of t.asks) {
      const what = a.dropped !== undefined ? `dropped: ${a.dropped}` : a.criteria.join(', ') || 'none';
      const verdict = a.verdict === 'dropped' ? '-' : a.verdict === 'no criterion' ? 'NO CRITERION' : VERDICT_LABEL[a.verdict];
      out.push(`| ${a.id}: ${esc(a.title)} | ${esc(what)} | ${verdict} |`);
    }
    out.push('');
  }
  if (t.questions.length > 0) {
    out.push('Questions settled before the build:', '', ...t.questions.map((q) => `- ${q.id}: ${q.text} ${q.answer ?? '(still open)'}`), '');
  }
  const design = t.stages.find((s) => s.id === 'design');
  if (design?.by === 'fwos' && t.states.length > 0) {
    out.push('| State | Criterion |', '|---|---|', ...t.states.map((s) => `| ${esc(s.state)} | ${esc(s.criteria.join(', ') || s.note || 'none')} |`), '');
  }
  if (t.criteria.length > 0) {
    out.push('| Criterion | Own | Cases | Verdict |', '|---|---|---|---|', ...t.criteria.map((c) => `| ${c.id} | ${c.own ?? '-'} | ${esc(caseList(c.cases))} | ${verdictLine(c)} |`), '');
  }
  if (project.kept.includes('build') && (t.build?.outside.length ?? 0) > 0) {
    out.push(`Edited outside what it maps: ${t.build!.outside.join(', ')} (implementation is your team's here).`, '');
  }
  // The report is the same file for the same evidence, so closing the change doesn't change this line.
  const summary = openSummary(t.open);
  out.push(summary ? `Open at acceptance: ${summary}.` : 'Nothing open at acceptance.', '');
  if (summary) out.push(...openLines(t.open).map((l) => `- ${l}`), '');
  return out;
}

/** The trace as `fwos change trace` prints it. */
export function traceText(t: ChangeTrace): string[] {
  const c = t.change;
  const out = [`Change ${c.id}: ${c.title} (${c.route}, step ${c.step}, ${c.status})`];
  if (t.links.length > 0) out.push('Linked', ...t.links.map((l) => `  ${l.ref}${l.stage ? ` (${l.stage})` : ''}${l.changed ? ', changed since it was linked' : ''}`));
  out.push('Stages', ...t.stages.map((s) => `  ${s.id.padEnd(12)}${(s.by === 'fwos' ? 'fwos' : 'kept').padEnd(7)}${s.by === 'team' ? `${s.reason}: ${s.artifacts.join(', ') || 'nothing linked'}` : s.artifacts.join(', ')}`));
  if (t.asks.length > 0) {
    out.push('Asks', ...t.asks.map((a) => (a.dropped !== undefined ? `  ${a.id}  ${a.title}: dropped (${a.dropped})` : `  ${a.id}  ${a.title} -> ${a.criteria.join(', ') || 'no criterion'}${a.verdict === 'no criterion' ? '' : `: ${VERDICT_LABEL[a.verdict as AcVerdict]}`}`)));
  }
  if (t.questions.length > 0) out.push('Questions', ...t.questions.map((q) => `  ${q.id}  ${q.text} ${q.answer ?? '(still open)'}`));
  if (t.states.length > 0) out.push('States', ...t.states.map((s) => `  ${s.state}: ${s.criteria.join(', ') || s.note || 'none'}`));
  if (t.criteria.length > 0) {
    out.push('Criteria', ...t.criteria.map((x) => `  ${x.id}  ${x.own ?? '-'}  ${caseList(x.cases)}${x.cases.some((k) => k.runnable === false) ? ' (some no test script can run yet)' : ''}: ${verdictLine(x)}`));
  }
  if (t.regression.length > 0) out.push('Regression', ...t.regression.map((r) => `  ${r.path}: ${r.ran ? tally(r) : 'did not run'}`));
  if (t.build) out.push('Build', `  ${t.build.edited.length} edited and ${t.build.added.length} added inside what it maps${t.build.outside.length > 0 ? `; outside it: ${t.build.outside.join(', ')}` : ''}`);
  return out;
}
