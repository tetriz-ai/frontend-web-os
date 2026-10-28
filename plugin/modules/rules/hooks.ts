// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The edit-time check: after a Write or Edit, run the check rules against only the text the edit
// inserted, and tell Claude what it tripped. Advisory: `fwos check` is the gate.

import { type HookHandler, type ModuleHooks, editedPath, matchAny } from '../../kernel/index.ts';
import { checkText, effectiveRules, rulesFor } from './engine.ts';

export function insertedText(toolName: string | undefined, input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  if (toolName === 'Write' && typeof input.content === 'string') return input.content;
  if (toolName === 'Edit' && typeof input.new_string === 'string') return input.new_string;
  if (toolName === 'MultiEdit' && Array.isArray(input.edits)) {
    return (input.edits as { new_string?: unknown }[]).map((e) => (typeof e.new_string === 'string' ? e.new_string : '')).join('\n');
  }
  return null;
}

export const editTimeCheck: HookHandler = (input, project) => {
  const rel = editedPath(input, project);
  if (!rel) return null;
  const text = insertedText(input.tool_name, input.tool_input);
  if (!text) return null;
  const { rules, ignore } = effectiveRules(project);
  if (matchAny(rel, ignore)) return null;
  const findings = checkText(rulesFor(project.platforms, rules), rel, text);
  if (findings.length === 0) return null;
  const lines = findings.slice(0, 8).map((f) => `- ${f.rule}: ${f.message}`);
  if (findings.length > 8) lines.push(`- ...and ${findings.length - 8} more`);
  return { context: `fwos [rules/edit-time] ${rel}: the text you just wrote trips ${findings.length} rule${findings.length === 1 ? '' : 's'} that \`fwos check\` will fail on:\n${lines.join('\n')}` };
};

export const hooks: ModuleHooks = { postToolUse: [editTimeCheck] };
