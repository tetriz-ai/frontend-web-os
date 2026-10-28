// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The adoption proposal stage by stage, from the idea to its acceptance. For each stage: what the
// team does today (the repo's findings, each with the file it came from), what that leaves open,
// what fwos adds at the level, and what would show it helped. The gap is said from what was found,
// so an app with tests reads differently from one without. A team that judges a stage well served
// keeps its own practice there (`fwos adopt --keep`), and fwos adds nothing to it.

import { ADOPT_LEVELS, ADOPT_STAGES, type AdoptLevel, type AdoptStage, FwosError, type Inventory, type Project, type RepoFinding, STAGE_LABELS } from '../../kernel/index.ts';
import type { KeptStage } from '../../modules/state/index.ts';

export interface StageRow {
  id: AdoptStage;
  label: string;
  /** The level fwos starts adding to the stage at. */
  level: AdoptLevel;
  /** fwos: it adds to the stage at this level. kept: the team keeps its own practice. later: a later level adds it. */
  status: 'fwos' | 'kept' | 'later';
  /** What the team does there today, each with the file it was read from. */
  today: { what: string; from: string }[];
  /** What that leaves open, which fwos addresses. */
  gap: string;
  /** What fwos adds, at the level shown (its own level for a later stage). */
  adds: string;
  /** What would show it helped: the artifacts and checks to read. */
  evidence: string;
  kept?: KeptStage;
}

const LEVEL_OF: Record<AdoptStage, AdoptLevel> = { idea: 'delivery', design: 'design', spec: 'delivery', 'test-plan': 'delivery', build: 'delivery', acceptance: 'checks' };
const atLeast = (level: AdoptLevel, than: AdoptLevel) => ADOPT_LEVELS.indexOf(level) >= ADOPT_LEVELS.indexOf(than);
/** A script finding's name: `test` in `test: vitest run`. */
const script = (f: RepoFinding) => f.what.split(': ')[0]!;

/** Which of the repo's findings are the team's own practice for each stage. */
const PRACTICE: Record<AdoptStage, (f: RepoFinding) => boolean> = {
  idea: (f) => f.area === 'docs' && (f.what === 'issue template' || f.what === 'product or design doc'),
  design: (f) => f.area === 'components' || f.area === 'theme' || (f.area === 'tests' && f.what === 'Storybook') || (f.area === 'docs' && /decision records?$/.test(f.what)),
  spec: (f) => f.area === 'docs' && f.what === 'product or design doc',
  'test-plan': (f) => (f.area === 'tests' && f.what !== 'Storybook') || (f.area === 'scripts' && /^(?:test|e2e)(?::|$)/.test(script(f))),
  build: (f) => f.area === 'lint' || f.area === 'hooks' || f.area === 'guidance' || (f.area === 'scripts' && /^(?:lint|typecheck|type-check|check-types|format)(?::|$)/.test(script(f))),
  acceptance: (f) => f.area === 'ci' || f.area === 'review',
};

/** What each stage's practice leaves open: when the repo shows one, and when it shows none. */
const GAPS: Record<AdoptStage, [string, string]> = {
  idea: ["nothing holds a request's open questions until they're answered, or shows an ask the work left out", 'requests arrive as text: nothing writes down their asks, assumptions and open questions before the work starts'],
  design: ['nothing lists the states a changed screen gets (a search that matches no one, a save that fails) before it is built', 'no components or theme found to reuse, and nothing lists the states a changed screen gets before it is built'],
  spec: ["a change's criteria aren't written as checkable statements tied to tests, so a vague one reaches the build", "no spec or requirements doc found: a change's criteria aren't written down as checkable statements tied to tests"],
  'test-plan': ["nothing maps a change's criteria to the tests that prove them, or names the existing tests around it", 'no test runner found, so nothing can prove a change works yet'],
  build: ['they shape how the code is written, not whether it does what was asked, and nothing holds an edit to what the change is about', 'nothing holds an edit to what the change is about, or shows its tests fail before the code and pass after'],
  acceptance: ['a review sees the diff, not which criterion each test proves, what ran in a browser, or which findings are new', 'no review workflow or CI found: nothing shows which criterion each test proves, or which findings are new'],
};

/** What fwos adds to a stage at `level`. */
function adds(id: AdoptStage, level: AdoptLevel): string {
  const delivery = atLeast(level, 'delivery');
  switch (id) {
    case 'idea':
      return "the spec delta's Request: each ask with the criteria that deliver it, or dropped with why, and each open question answered before the spec is approved";
    case 'design': {
      const tokens = 'your theme as tokens and your components in the registry, with a gallery that compares them on request';
      return delivery ? `${tokens}, and for each change the states of what it touches, from a checklist of the states its interactions bring` : tokens;
    }
    case 'spec':
      return "a spec delta of only the change's own criteria, grounded in the code `fwos change map` reads, with no term that needs interpretation";
    case 'test-plan':
      return 'a test plan delta: cases for each criterion at levels your runners can run, one in a browser, a changed criterion tested anew, and the tests around the change as its regression scope';
    case 'build':
      return 'the spec gate while a change is open, its tests locked once they fail, and its edits held to what it maps';
    case 'acceptance': {
      const check = '`fwos check` fails only on findings new since the baseline';
      return delivery ? `${check}, and an acceptance report that traces the request to each criterion's tests, what ran in a browser and your regression tests, approved by a person` : check;
    }
  }
}

/** What would show fwos helped at a stage: the artifacts and checks a reviewer reads. */
function evidence(id: AdoptStage, level: AdoptLevel, p: Project): string {
  const spec = `${p.paths.docs}/spec.md`;
  const delivery = atLeast(level, 'delivery');
  switch (id) {
    case 'idea':
      return `${spec} ## Request and ## Open questions, and \`fwos change trace\`; spec/format (request), and \`fwos approve spec\`, which refuses an open question`;
    case 'design': {
      const tokens = `${p.paths.designSystem}/ and \`fwos design-system report\``;
      return delivery ? `${tokens}; ${spec} ## States; spec/format (states)` : tokens;
    }
    case 'spec':
      return `${spec}, approved with where it was given; spec/format (vague, context, delta)`;
    case 'test-plan':
      return `${p.paths.docs}/test-plan.md and the coverage in \`fwos change trace\`; tests/plan, tests/regression`;
    case 'build':
      return '`fwos change drift`, and the red run `fwos tests lock` keeps beside the green one; tests/locked, tests/traceability';
    case 'acceptance':
      return delivery ? `${p.paths.docs}/reports/acceptance.md (## Traceability); tests/traceability, tests/regression` : '`fwos check`: new findings apart from the baseline';
  }
}

/** The six stages for `p` at its level, from what the inventory found, with the stages its team keeps. */
export function stageRows(p: Project, inv: Inventory | null, keep: Partial<Record<AdoptStage, KeptStage>>): StageRow[] {
  const level = p.level ?? 'checks';
  return ADOPT_STAGES.map((id) => {
    const today = (inv?.findings ?? []).filter(PRACTICE[id]).map((f) => ({ what: f.what, from: f.from }));
    const status = keep[id] ? 'kept' : atLeast(level, LEVEL_OF[id]) ? 'fwos' : 'later';
    // A later stage says what its own level adds.
    const at = status === 'later' ? LEVEL_OF[id] : level;
    const row: StageRow = { id, label: STAGE_LABELS[id], level: LEVEL_OF[id], status, today, gap: GAPS[id][today.length > 0 ? 0 : 1], adds: adds(id, at), evidence: evidence(id, at, p) };
    if (keep[id]) row.kept = keep[id];
    return row;
  });
}

/** The stages as `fwos status` lists them (one line each), or as the proposal shows them (with what was found and what fwos adds). */
export function formatStages(rows: StageRow[], level: AdoptLevel, detail: boolean): string[] {
  const head = (r: StageRow) => `  ${r.id.padEnd(12)}${r.status.padEnd(7)}${r.label}${r.status === 'kept' ? `: ${r.kept!.reason}` : r.status === 'later' ? `, at level ${r.level}` : ''}`;
  if (!detail) return ['Stages', ...rows.map(head)];
  const line = (label: string, text: string) => `      ${label.padEnd(11)}${text}`;
  return [
    `Stages at level ${level}: what you have, what it leaves open, what fwos adds, and what would show it helped`,
    ...rows.flatMap((r) => [
      head(r),
      line('have', r.today.map((t) => `${t.what} (${t.from})`).join(', ') || 'nothing found'),
      line('open', r.gap),
      line('fwos adds', r.status === 'kept' ? `nothing while it's yours: link your own artifact to each change (\`fwos change link <url|path> --stage ${r.id}\`)` : r.adds),
      line('evidence', r.evidence),
    ]),
    '',
    'A stage your team already serves well can stay yours: --keep <stage> --reason "<why>". fwos then adds nothing there, and each change links your own artifact for it (`fwos change link <url|path> --stage <stage>`).',
  ];
}

/** Stage ids from a flag (`--keep test-plan,design`, or the flag given twice), checked. */
export function stagesOf(raw: string | string[] | undefined): AdoptStage[] {
  const ids = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
  for (const id of ids) if (!(ADOPT_STAGES as readonly string[]).includes(id)) throw new FwosError(`Unknown stage "${id}". One of: ${ADOPT_STAGES.join(', ')}.`);
  return [...new Set(ids)] as AdoptStage[];
}

/** `test planning`, `design and exploration and test planning`. */
export const stageNames = (ids: AdoptStage[]) => {
  const names = ids.map((id) => STAGE_LABELS[id].toLowerCase());
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
};
