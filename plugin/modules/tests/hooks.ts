// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Hook handlers owned by the tests module: locked test files, and the test planner's sandbox.

import { EDIT_TOOLS, type HookHandler, type ModuleHooks, editedPath, isAgent } from '../../kernel/index.ts';
import { isLocked } from './locked.ts';

/**
 * The test planner works from the spec alone. Every tool call it makes is denied (backstop to its
 * tool list), except SubagentHandback: in auto mode that's how a subagent hands its result back,
 * so denying it loses the plan. It reads nothing.
 */
export const plannerSandbox: HookHandler = (input) => {
  if (!isAgent(input, 'test-planner')) return null;
  if (input.tool_name === 'SubagentHandback') return null;
  return {
    deny: 'fwos [tests/planner-sandbox]: the test planner writes the plan from the spec, ia.json and the contract in its prompt. It may not read the repo or run tools.',
  };
};

/** Locked tests can't be edited through Write/Edit until they're unlocked with a reason and a reviewer. */
export const lockedGuard: HookHandler = (input, project) => {
  if (!EDIT_TOOLS.has(input.tool_name ?? '')) return null;
  const rel = editedPath(input, project);
  if (!rel || !isLocked(project, rel)) return null;
  return {
    deny: `fwos [tests/locked]: ${rel} is a locked test. Change the code, not the test. If the test itself is wrong, record why and who agreed: \`fwos tests unlock ${rel} --reason "<why>" --reviewer "<name>"\`, edit it, then lock it again.`,
  };
};

export const hooks: ModuleHooks = { preToolUse: [plannerSandbox, lockedGuard] };
