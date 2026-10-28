// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The one hook dispatcher. Claude Code or Codex runs `fwos hook <event>`; this routes the event to
// each module's handlers and merges the outcomes: the first deny wins, context lines are joined.
// It stays silent unless the project has .fwos/state.json, so the plugin is quiet elsewhere. Codex's
// differences (patches, no PreToolUse context, no plugin folder in its shell) are met in codex.ts.

import { sep } from 'node:path';
import { FwosError, type HookHandler, type HookInput, type HookOutcome, type Project, findProjectRoot, loadProject } from '../../kernel/index.ts';
import { hooks as designSystem } from '../../modules/design-system/index.ts';
import { hooks as rules } from '../../modules/rules/index.ts';
import { hooks as state, unreadableGate } from '../../modules/state/index.ts';
import { hooks as tests } from '../../modules/tests/index.ts';
import { UNREADABLE_PATCH, asEdits, codexSessionContext, fromCodex } from './codex.ts';

export type HookEvent = 'pre-tool-use' | 'post-tool-use' | 'session-start';

const EVENT_NAME: Record<HookEvent, string> = {
  'pre-tool-use': 'PreToolUse',
  'post-tool-use': 'PostToolUse',
  'session-start': 'SessionStart',
};

export const HANDLERS: Record<HookEvent, HookHandler[]> = {
  // The planner sandbox first: it needs nothing from the project.
  'pre-tool-use': [...(tests.preToolUse ?? []), ...(state.preToolUse ?? [])],
  'post-tool-use': [...(designSystem.postToolUse ?? []), ...(rules.postToolUse ?? [])],
  'session-start': [...(state.sessionStart ?? [])],
};

export interface HookResult {
  stdout: string;
  code: number;
}

export function dispatch(event: HookEvent, input: HookInput, cwd: string = process.cwd()): HookResult {
  // Input that isn't an object is malformed: stay out of the way rather than block the tool call.
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { stdout: '', code: 0 };
  const hookEventName = EVENT_NAME[event];
  const codex = fromCodex(input);
  // In Codex the plugin folder goes in every session's context, an fwos project or not yet.
  const host = event === 'session-start' && codex ? codexSessionContext() : null;
  const root = findProjectRoot(typeof input.cwd === 'string' ? input.cwd : cwd);
  if (!root) return host ? output(hookEventName, { context: host }) : { stdout: '', code: 0 };
  // What fwos couldn't read, if anything. Then it can't tell what is approved or locked, so it fails
  // closed on the paths that depend on it (state's unreadableGate) and leaves the rest open, with one
  // warning, so the session can repair the file instead of locking up.
  let unreadable: string | null = null;
  const why = (e: unknown) => {
    const message = e instanceof FwosError ? e.message : `${(e as Error).name}: ${(e as Error).message}`;
    return message.split(`${root}${sep}`).join('');
  };
  let project: Project;
  try {
    project = loadProject(root);
  } catch (e) {
    unreadable = why(e);
    project = loadProject(root, { defaults: true });
  }
  const warning = (w: string) =>
    `fwos couldn't read its state (${w}). Until it can, app source and test files are closed to edits. Repair that file or restore .fwos/ from git (\`git checkout -- .fwos/\`), then run \`fwos doctor\`.`;
  const contexts: string[] = host ? [host] : [];
  // A Codex patch is checked file by file, as Claude Code's edits are. One whose files can't be
  // read could touch a gated or locked file, so it is refused rather than let through.
  const calls = asEdits(input);
  if (calls.length === 0 && event === 'pre-tool-use') return output(hookEventName, { deny: UNREADABLE_PATCH });
  for (const call of calls) {
    let failed = unreadable !== null;
    for (const handler of HANDLERS[event]) {
      let out: HookOutcome | null = null;
      try {
        out = handler(call, project);
      } catch (e) {
        unreadable ??= why(e);
        failed = true;
      }
      if (out?.deny && event === 'pre-tool-use') return output(hookEventName, { deny: unreadable === null ? out.deny : `${out.deny} ${warning(unreadable)}` });
      if (out?.context) contexts.push(out.context);
    }
    if (failed && event === 'pre-tool-use') {
      const out = unreadableGate(call, project, unreadable!);
      if (out?.deny) return output(hookEventName, { deny: out.deny });
    }
  }
  if (unreadable !== null) contexts.push(warning(unreadable));
  // Codex treats context on PreToolUse as a hook error, so there it can only deny.
  if (codex && event === 'pre-tool-use') return { stdout: '', code: 0 };
  return contexts.length > 0 ? output(hookEventName, { context: contexts.join('\n\n') }) : { stdout: '', code: 0 };
}

function output(hookEventName: string, o: HookOutcome): HookResult {
  if (o.deny) {
    return {
      stdout: JSON.stringify({ hookSpecificOutput: { hookEventName, permissionDecision: 'deny', permissionDecisionReason: o.deny } }),
      code: 0,
    };
  }
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: o.context } }), code: 0 };
}

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
