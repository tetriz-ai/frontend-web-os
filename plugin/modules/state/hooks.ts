// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Hook handlers owned by the state module: the spec gate, the guard on fwos's own records, the
// generated-file warning and the one-line SessionStart summary.

import {
  EDIT_TOOLS,
  type HookHandler,
  type HookInput,
  type HookOutcome,
  type ModuleHooks,
  type Project,
  editedPath,
  isTestFile,
  matchPath,
  samePath,
} from '../../kernel/index.ts';
import { allApprovals, approvalState, changeApprovalState, docStaleness, satisfied } from './approvals.ts';
import { recordProblems, unsupportedSchemas } from './checks/state.ts';
import { acquireLock } from './lock.ts';
import { readManifest } from './owned.ts';
import { FWOS_DIR, currentChange, isAdoptionRecord } from './store.ts';

/** Blocks app source edits until the spec and test plan are approved. */
export const specGate: HookHandler = (input, project) => {
  if (!EDIT_TOOLS.has(input.tool_name ?? '')) return null;
  const rel = editedPath(input, project);
  if (!rel) return null;
  if (!matchPath(project, rel, project.paths.gated) || matchPath(project, rel, project.paths.allowedBeforeSpec)) return null;
  if (project.mode === 'adopt') return adoptedSpecGate(project, rel);
  const spec = approvalState(project, 'spec');
  if (satisfied(spec)) return null;
  const why =
    spec.status === 'stale'
      ? `the spec or test plan changed after it was approved (${(spec.changed ?? []).join(', ')})`
      : `the spec and test plan aren't approved yet (${spec.status})`;
  return {
    deny: [
      `fwos [state/spec-gate]: ${rel} is app source, and ${why}.`,
      `Allowed now: ${project.paths.docs}/, ${project.paths.designSystem}/, .fwos/, spikes/, and the screens paths (${project.paths.allowedBeforeSpec.join(', ')}).`,
      'To go on: finish the spec step and record the approval (`fwos approve spec --by "<name>"`), or put throwaway code in spikes/.',
    ].join(' '),
  };
};

/**
 * The spec gate in an adopted app (its paths.gated covers that app alone): only at the delivery
 * level, only while an fwos change with a spec is open, and only that change's own approval opens
 * it. With no change open, work outside fwos goes on as it did before fwos, and so does every edit
 * when the team keeps its own practice for the implementation.
 */
function adoptedSpecGate(project: Project, rel: string): HookOutcome | null {
  if (project.level !== 'delivery' || project.kept.includes('build')) return null;
  const change = currentChange(project.root);
  if (!change || isAdoptionRecord(project, change) || change.route === 'code-only') return null;
  const spec = changeApprovalState(project, change, 'spec');
  if (spec.status === 'approved') return null;
  const why =
    spec.status === 'stale'
      ? `change ${change.id}'s spec or test plan changed after it was approved (${(spec.changed ?? []).join(', ')})`
      : `change ${change.id}'s spec and test plan aren't approved yet (${spec.status})`;
  return {
    deny: [
      `fwos [state/spec-gate]: ${rel} is app source, and ${why}.`,
      `Allowed now: ${project.paths.docs}/, ${project.paths.designSystem}/, .fwos/, and anything outside ${project.paths.gated.join(', ')}.`,
      'To go on: write the change\'s spec delta and test plan, and record the approval (`fwos approve spec --by "<name>"`).',
    ].join(' '),
  };
}

/** What the agent writes in .fwos/ by design: local evidence and results, slice manifests, the flaky-test quarantine. */
export const AGENT_WRITES = [`${FWOS_DIR}/local/**`, `${FWOS_DIR}/slices/**`, `${FWOS_DIR}/quarantine.json`];

/** In .fwos/local/, what only the CLI writes: the harness's run records (`fwos harness record`). */
export const CLI_WRITES = [`${FWOS_DIR}/local/runs/**`];

/**
 * Blocks the edit tools on fwos's own records in .fwos/: the state file with the gate's paths, the
 * change files with their approvals and locked tests, the manifest, the baseline, the harness's run
 * records and the vendored CLI. Only the fwos CLI writes them, so no edit can drop a lock, forge an approval or empty the
 * gated paths. A record state/schema rejects stays writable, so a session can repair it.
 */
export const recordsGuard: HookHandler = (input, project) => {
  if (!EDIT_TOOLS.has(input.tool_name ?? '')) return null;
  const rel = editedPath(input, project);
  if (!rel || !matchPath(project, rel, [`${FWOS_DIR}/**`]) || (matchPath(project, rel, AGENT_WRITES) && !matchPath(project, rel, CLI_WRITES))) return null;
  if (recordProblems(project).some((f) => f.file !== undefined && samePath(project, f.file, rel))) return null;
  return {
    deny: [
      `fwos [state/records]: ${rel} is one of fwos's own records (approvals, locked tests, the gate's paths), and only the fwos CLI writes them.`,
      'Record a decision with its commands instead: `fwos approve`, `fwos skip`, `fwos signoff`, `fwos tests unlock`, `fwos change`, `fwos design-system decide`, `fwos prototype promote`. A setting in .fwos/state.json that is wrong is the user\'s to change.',
      `Writable here: ${AGENT_WRITES.join(', ')} (but not ${CLI_WRITES.join(', ')}).`,
    ].join(' '),
  };
};

/**
 * The edit gate while fwos can't read its state (a .fwos/ file that doesn't parse, or a handler that
 * failed): it can't tell whether the spec is approved or which tests are locked, so it treats the
 * spec as unapproved and every test as locked. App source and test files wait; .fwos/ (where the
 * records guard still decides), the docs, the design system and the rest stay open for the repair.
 */
export function unreadableGate(input: HookInput, project: Project, why: string): HookOutcome | null {
  if (!EDIT_TOOLS.has(input.tool_name ?? '')) return null;
  const rel = editedPath(input, project);
  if (!rel || matchPath(project, rel, [`${FWOS_DIR}/**`, `${project.paths.docs}/**`, `${project.paths.designSystem}/**`])) return null;
  const gated = matchPath(project, rel, project.paths.gated) && !matchPath(project, rel, project.paths.allowedBeforeSpec);
  if (!gated && !isTestFile(project, project.caseInsensitive ? rel.toLowerCase() : rel)) return null;
  return {
    deny: [
      `fwos [state/unreadable]: fwos couldn't read its state (${why}), so it can't tell whether the spec is approved or which tests are locked, and ${rel} waits until it can.`,
      `Repair that file (it stays writable, as do ${project.paths.docs}/ and ${project.paths.designSystem}/) or restore .fwos/ from git (\`git checkout -- .fwos/\`), then run \`fwos doctor\`.`,
    ].join(' '),
  };
}

/** Warns (doesn't block) when a generated file is about to be edited by hand. */
export const generatedWarning: HookHandler = (input, project) => {
  if (!EDIT_TOOLS.has(input.tool_name ?? '')) return null;
  const rel = editedPath(input, project);
  if (!rel) return null;
  const entry = readManifest(project.root).files[rel];
  if (!entry || entry.kind !== 'generated') return null;
  return {
    context: `fwos [state/owned]: ${rel} is generated${entry.source ? ` from ${entry.source}` : ''}. A hand edit fails \`fwos check\` (state/owned). Edit the source and regenerate instead.`,
  };
};

/**
 * A line of context for each pack file or record this fwos can't read, so the agent hears it before
 * it builds: `fwos check` stops before any check runs while one is there.
 */
export const schemaNotice: HookHandler = (_input, project) => {
  const lines = unsupportedSchemas(project).map((s) => {
    const next = s.schema! > s.reads ? 'Upgrade fwos, then run /fwos:doctor.' : 'Run `fwos update`, which migrates it or says what to change.';
    return `fwos: ${s.path} is schema ${s.schema}, which this fwos doesn't read, so \`fwos check\` stops before any check runs. ${next}`;
  });
  return lines.length > 0 ? { context: lines.join('\n') } : null;
};

/** One line of context: "fwos: change 0001-initial, step spec (states), 2 questions pending". */
export const sessionSummary: HookHandler = (input, project) => {
  const change = currentChange(project.root);
  if (change && isAdoptionRecord(project, change)) {
    return { context: `fwos: adopted app (level ${project.level}). /fwos:status says what fwos checks here, and /fwos:adopt changes the level.` };
  }
  if (!change) {
    return { context: 'fwos: every change is done. Any new request is a change: /fwos:change "<request>".' };
  }
  const parts = [`fwos: change ${change.id}, step ${change.step}`];
  if (change.cursor?.section) parts[0] += ` (section ${change.cursor.section})`;
  const pending = change.cursor?.pending?.length ?? 0;
  if (pending > 0) parts.push(`${pending} question${pending === 1 ? '' : 's'} pending`);
  const stale = allApprovals(project).filter((s) => s.status === 'stale').map((s) => s.target);
  const staleDocs = docStaleness(project).map((d) => d.doc.split('/').pop());
  if (stale.length + staleDocs.length > 0) parts.push(`stale: ${[...stale, ...staleDocs].join(', ')}`);
  if (input.session_id) {
    const lock = acquireLock(project.root, input.session_id);
    if (!lock.ok) parts.push(`another session (${lock.holder.session.slice(0, 8)}) holds this change since ${lock.holder.at}`);
  }
  return { context: `${parts.join('; ')}. Run /fwos:start to continue.` };
};

export const hooks: ModuleHooks = {
  preToolUse: [specGate, generatedWarning, recordsGuard],
  sessionStart: [sessionSummary, schemaNotice],
};

export { satisfied };
