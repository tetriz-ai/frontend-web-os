// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Import specifiers come from the kernel's parser, shared with the component registry. This file
// keeps the prompt-reference reader, which only the walls check needs.

export { extractImports, type ImportKind, type ImportRef } from '../../kernel/index.ts';

/** `${CLAUDE_PLUGIN_ROOT}/modules/rules/knowledge/states.md` style references in prompt files. */
export function extractPromptRefs(md: string): { spec: string; line: number }[] {
  const out: { spec: string; line: number }[] = [];
  const re = /\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./@()-]+[\w/])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const line = md.slice(0, m.index).split('\n').length;
    out.push({ spec: m[1]!, line });
  }
  return out;
}
