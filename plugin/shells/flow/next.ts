// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The flow shell's only logic: which step a change is at, what blocks it, and what to do next.
// `/fwos:start` reads this (through `fwos next --json`) and loads the matching step skill.

import { type AdoptLevel, type AdoptStage, FwosError, type Project } from '../../kernel/index.ts';
import { type OpenItems, openItems } from '../../modules/accept/index.ts';
import {
  type ApprovalState,
  type Change,
  type KeptStage,
  STEPS,
  type Step,
  allApprovals,
  changeApprovalState,
  currentChange,
  docStaleness,
  isAdoptionRecord,
  keptStages,
  logEvent,
  readBaseline,
  satisfied,
  updateChange,
} from '../../modules/state/index.ts';
import { ADOPTED_ROUTE_ENTRY, ROUTE_ENTRY } from './routes.ts';

/** The approval each step closes. Build has none: it ends when every slice is done and checked. */
export const STEP_TARGET: Partial<Record<Step, string>> = {
  discovery: 'brief',
  research: 'research',
  architecture: 'architecture',
  'design-system': 'design-system',
  screens: 'screens',
  spec: 'spec',
  accept: 'acceptance',
};

export const STEP_SKILL: Record<Step, string | null> = {
  discovery: 'fwos:discovery',
  research: 'fwos:research',
  architecture: 'fwos:architecture',
  'design-system': 'fwos:design-system',
  screens: 'fwos:screens',
  spec: 'fwos:spec',
  build: 'fwos:build',
  accept: 'fwos:accept',
  done: null,
};

/**
 * Approvals that must hold before a change may enter `step`: every earlier step's, from `from` on.
 * A change in an adopted app starts at its route's entry, so it answers only for its own steps.
 */
export function gatesFor(step: Step, from: Step = 'discovery'): string[] {
  return STEPS.slice(STEPS.indexOf(from), STEPS.indexOf(step))
    .map((s) => STEP_TARGET[s])
    .filter((t): t is string => !!t);
}

/** Where a change in an adopted app starts: its route's entry there. */
export function adoptedEntry(change: Pick<Change, 'route'>): Step {
  return ADOPTED_ROUTE_ENTRY[change.route] ?? ROUTE_ENTRY[change.route];
}

/**
 * The approvals `change` must hold to enter `step`, as they stand. In an adopted app only the
 * change's own approvals count; in a project fwos started, the latest across every change.
 */
function gateStates(project: Project, change: Change, step: Step, approvals: ApprovalState[]): ApprovalState[] {
  if (project.mode === 'adopt') return gatesFor(step, adoptedEntry(change)).map((t) => changeApprovalState(project, change, t));
  const byTarget = new Map(approvals.map((a) => [a.target, a]));
  return gatesFor(step).map((t) => byTarget.get(t)!);
}

export interface NextStep {
  change: Pick<Change, 'id' | 'title' | 'route' | 'step'> | null;
  step: Step | null;
  skill: string | null;
  /** Earlier approvals that don't hold, so the current step can't proceed. */
  blocked: { target: string; status: string; reason?: string }[];
  stale: string[];
  pending: string[];
  section?: string;
  /** One sentence: what to do now. */
  action: string;
  /** Set in an adopted app: its level, and the stages its team keeps. The step skills then follow the adopted-app knowledge. */
  adopt?: { level: AdoptLevel; keep?: Partial<Record<AdoptStage, KeptStage>> };
  /** An adopted app's open change: what it carries into its next step (open questions, assumptions, dropped asks and criteria, kept stages with nothing linked). */
  open?: OpenItems;
}

const describe = (s: ApprovalState) =>
  s.status === 'stale' ? `${s.target} changed after it was approved (${(s.changed ?? []).join(', ')})` : `${s.target} is ${s.status}`;

export function nextStep(project: Project): NextStep {
  if (!project.initialized) {
    return {
      change: null,
      step: null,
      skill: 'fwos:start',
      blocked: [],
      stale: [],
      pending: [],
      action: 'No fwos project here yet. Run /fwos:start "<idea>" to begin (it runs `fwos init` after asking).',
    };
  }
  const change = currentChange(project.root);
  const approvals = allApprovals(project);
  const keep = project.mode === 'adopt' ? keptStages(project.root) : {};
  const adopt = project.level ? { adopt: { level: project.level, ...(Object.keys(keep).length > 0 ? { keep } : {}) } } : {};
  const adoptedChange = change && project.mode === 'adopt' && !isAdoptionRecord(project, change) ? change : null;
  // An adopted change's own approvals are the ones that can go stale for it.
  const own = adoptedChange ? (['spec', 'acceptance'] as const).map((t) => changeApprovalState(project, adoptedChange, t)) : approvals;
  const stale = [...own.filter((a) => a.status === 'stale').map((a) => a.target), ...docStaleness(project).map((d) => d.doc)];
  if (!change) {
    return {
      change: null,
      step: 'done',
      skill: null,
      blocked: [],
      stale,
      pending: [],
      action: 'Every change is done. Treat any new request as a change: /fwos:change "<request>".',
      ...adopt,
    };
  }
  if (isAdoptionRecord(project, change)) {
    // The app as it was: fwos checks it as it is, and at delivery a request becomes a change.
    const checked = readBaseline(project.root)
      ? 'run `fwos check`, and `fwos baseline` once you fix baselined findings'
      : "`fwos baseline --init` records today's findings, then `fwos check` fails only on new ones";
    const deliver = project.level === 'delivery' ? ' To deliver a request in place, use /fwos:change "<request>".' : '';
    return {
      change: { id: change.id, title: change.title, route: change.route, step: change.step },
      step: null,
      skill: null,
      blocked: [],
      stale,
      pending: [],
      action: `This app is adopted at level ${project.level}, so fwos checks it as it is: ${checked}.${deliver}`,
      ...adopt,
    };
  }
  const blocked = gateStates(project, change, change.step, approvals)
    .filter((a) => !satisfied(a))
    .map((a) => ({ target: a.target, status: a.status, ...(a.status === 'stale' ? { reason: describe(a) } : {}) }));
  const pending = change.cursor?.pending ?? [];
  const base = {
    change: { id: change.id, title: change.title, route: change.route, step: change.step },
    step: change.step,
    skill: STEP_SKILL[change.step],
    blocked,
    stale,
    pending,
    ...(change.cursor?.section ? { section: change.cursor.section } : {}),
    ...adopt,
    // A code-only change has no spec delta of its own: the spec is an earlier change's.
    ...(adoptedChange && adoptedChange.route !== 'code-only' ? { open: openItems(project, adoptedChange) } : {}),
  };
  if (blocked.length > 0) {
    const first = blocked[0]!;
    const earliest = (Object.entries(STEP_TARGET).find(([, t]) => t === first.target)?.[0] ?? 'discovery') as Step;
    return {
      ...base,
      skill: STEP_SKILL[earliest],
      action:
        first.status === 'stale'
          ? `${first.reason}. Show the user what changed, then re-approve it (\`fwos approve ${first.target} --by "<name>"\`) or route the edit as a change.`
          : `Step ${change.step} needs ${first.target} approved first (it's ${first.status}). Go back to the ${earliest} step: \`fwos step ${earliest}\`.`,
    };
  }
  const target = STEP_TARGET[change.step];
  const ownState = !target ? undefined : adoptedChange ? changeApprovalState(project, adoptedChange, target) : approvals.find((a) => a.target === target);
  if (change.step === 'done') {
    return { ...base, action: `Change ${change.id} is done. Close it with \`fwos change done\`.` };
  }
  if (adoptedChange && change.step === 'accept' && change.route !== 'code-only' && project.kept.includes('acceptance')) {
    // The team accepts the change in its own tool; the change links where, then closes.
    const why = keep.acceptance ? ` (${keep.acceptance.reason})` : '';
    const linked = (change.links ?? []).some((l) => l.stage === 'acceptance');
    return {
      ...base,
      action: linked
        ? `Acceptance is your team's here${why}, and its sign-off is linked: close the change with \`fwos change done\`.`
        : `Acceptance is your team's here${why}: link its sign-off (\`fwos change link <url|path> --stage acceptance\`), then close the change with \`fwos change done\`.`,
    };
  }
  if (ownState && satisfied(ownState)) {
    const nextIdx = STEPS.indexOf(change.step) + 1;
    const next = STEPS[nextIdx]!;
    return {
      ...base,
      action:
        next === 'done'
          ? `Acceptance is approved. Close the change: \`fwos change done\`.`
          : `${target} is ${ownState.status}. Move on: \`fwos step ${next}\`, then follow ${STEP_SKILL[next] ?? 'the next skill'}.`,
    };
  }
  if (pending.length > 0) {
    return { ...base, action: `Resume ${change.step}${change.cursor?.section ? ` at ${change.cursor.section}` : ''}: ${pending.length} question${pending.length === 1 ? '' : 's'} pending (${pending.join(', ')}).` };
  }
  return { ...base, action: `Continue step ${change.step} with ${STEP_SKILL[change.step]}.` };
}

/** Moves the current change to `step`. Going back is always allowed; going forward needs every earlier approval. */
export function setStep(project: Project, step: Step): Change {
  if (!(STEPS as readonly string[]).includes(step)) throw new FwosError(`Unknown step "${step}".`, `One of: ${STEPS.join(', ')}`);
  const change = currentChange(project.root);
  if (!change) throw new FwosError('No open change.', 'Start one with `fwos change new`.');
  const adopted = project.mode === 'adopt' && !isAdoptionRecord(project, change);
  if (adopted && STEPS.indexOf(step) < STEPS.indexOf(adoptedEntry(change))) {
    throw new FwosError(
      `Change ${change.id} starts at ${adoptedEntry(change)}: in an adopted app, the steps before it belong to your product.`,
      'For a bigger request, start a change with another route (`fwos change new "<request>" --route new-feature`).',
    );
  }
  if (STEPS.indexOf(step) > STEPS.indexOf(change.step)) {
    const unmet = gateStates(project, change, step, adopted ? [] : allApprovals(project)).filter((a) => !satisfied(a));
    if (unmet.length > 0 && adopted) {
      throw new FwosError(
        `Can't move to ${step}: ${unmet.map((a) => `${a.target} isn't approved in change ${change.id} (${a.status === 'stale' ? describe(a) : a.status})`).join('; ')}.`,
        'Show the user the spec delta and test plan, and record their yes: `fwos approve spec --by "<name>"`.',
      );
    }
    if (unmet.length > 0) {
      throw new FwosError(
        `Can't move to ${step}: ${unmet.map(describe).join('; ')}.`,
        'Approve it (`fwos approve <target> --by "<name>"`), or for research, architecture, design-system and screens, skip it with a reason (`fwos skip <target> --reason "..." --by "<name>"`).',
      );
    }
  }
  const updated = updateChange(project.root, (c) => {
    c.step = step;
    if (c.cursor) {
      delete c.cursor.section;
      c.cursor.pending = [];
    }
  });
  logEvent(project.root, 'step', { change: updated.id, step });
  return updated;
}
