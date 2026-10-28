// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Edit-time feedback for raw design values: after a Write or Edit to app source, scan only the
// inserted text. Advisory: `fwos check` (design-system/tokens) is the gate.

import { type HookHandler, type ModuleHooks, editedPath, isTestFile, matchAny } from '../../kernel/index.ts';
import { SCANNED_FILES, scanRawValues } from './scan.ts';

function inserted(tool: string | undefined, input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  if (tool === 'Write' && typeof input.content === 'string') return input.content;
  if (tool === 'Edit' && typeof input.new_string === 'string') return input.new_string;
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    return (input.edits as { new_string?: unknown }[]).map((e) => String(e.new_string ?? '')).join('\n');
  }
  return null;
}

export const rawValuesAtEdit: HookHandler = (input, project) => {
  const rel = editedPath(input, project);
  if (!rel || !SCANNED_FILES.test(rel)) return null;
  if (!matchAny(rel, project.paths.source) || isTestFile(project, rel) || matchAny(rel, [`${project.paths.tokensOut}/**`])) return null;
  const text = inserted(input.tool_name, input.tool_input);
  if (!text) return null;
  const findings = scanRawValues(rel, text);
  if (findings.length === 0) return null;
  const lines = findings.slice(0, 8).map((f) => `- ${f.message}`);
  if (findings.length > 8) lines.push(`- ...and ${findings.length - 8} more`);
  return {
    context: `fwos [design-system/tokens] ${rel}: raw design values in what you just wrote; \`fwos check\` will fail on them:\n${lines.join('\n')}`,
  };
};

export const hooks: ModuleHooks = { postToolUse: [rawValuesAtEdit] };
