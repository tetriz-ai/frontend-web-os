// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Codex, the other host fwos runs in. It sends Claude Code's hook payload, with three differences
// handled here so that no module needs to know which host it runs in:
// - an edit arrives as one `apply_patch` call, whose text names every file it touches and holds
//   the lines it adds;
// - PreToolUse can deny but can't carry extra context;
// - the model's shell doesn't have the plugin folder, so SessionStart tells it.

import type { HookInput } from '../../kernel/index.ts';

export type PatchOp = 'add' | 'update' | 'delete';

export interface PatchedFile {
  path: string;
  op: PatchOp;
}

/** A file a patch touches, with the lines it adds there (without their `+`). */
interface PatchHunk extends PatchedFile {
  added: string[];
}

const FILE_HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$/;
const MOVE_TO = /^\*\*\* Move to: (.+)$/;

/**
 * Reads an apply_patch body: each file it touches, in patch order, and the lines it adds there.
 * A header may carry leading spaces, as Codex accepts. A line that starts with `+` or `-` is never
 * a header, but any other line that reads as one is taken as one, so no file slips past the gates.
 * A moved file's added lines land in the file it moves to.
 */
function parsePatch(patch: string): PatchHunk[] {
  const out: PatchHunk[] = [];
  /** The hunk whose body is being read, and where its `+` lines land. */
  let open: PatchHunk | null = null;
  let into: PatchHunk | null = null;
  for (const line of patch.split(/\r?\n/)) {
    if (open && line.startsWith('+')) {
      into!.added.push(line.slice(1));
      continue;
    }
    if (open?.op === 'update' && line.startsWith('-')) continue;
    const text = line.trim();
    const file = FILE_HEADER.exec(text);
    if (file) {
      open = into = { path: file[2]!.trim(), op: file[1]!.toLowerCase() as PatchOp, added: [] };
      out.push(open);
      continue;
    }
    const moved = open?.op === 'update' ? MOVE_TO.exec(text) : null;
    if (moved) {
      into = { path: moved[1]!.trim(), op: 'add', added: [] };
      out.push(into);
      continue;
    }
    // Context, `@@` and `*** End of File` lines belong to an update; `*** End Patch` or any other line ends a hunk.
    if (open?.op === 'update' && (text === '*** End of File' || !line.startsWith('***'))) continue;
    open = into = null;
  }
  return out;
}

/** Every file an apply_patch body adds, updates, deletes or moves to, in patch order. */
export function patchedFiles(patch: string): PatchedFile[] {
  return parsePatch(patch).map(({ path, op }) => ({ path, op }));
}

/** The patch text of an apply_patch call: a string, or the strings of an argument list such as `["apply_patch", patch]`. */
function patchText(toolInput: Record<string, unknown> | undefined): string | null {
  for (const v of [toolInput?.command, toolInput?.patch, toolInput?.input]) {
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')) return v.join('\n');
  }
  return null;
}

/** The deny for an apply_patch whose files fwos can't read: it could touch any file, so it is refused. */
export const UNREADABLE_PATCH =
  "fwos [hooks/codex]: fwos couldn't read which files this apply_patch changes, so it can't check them against the spec gate and the locked tests. Send the patch as text, with a `*** Add File:`, `*** Update File:` or `*** Delete File:` line for each file.";

/** Whether a hook came from Codex: it sets PLUGIN_ROOT for plugin hooks, and its tool payloads carry a turn_id. */
export function fromCodex(input: HookInput, env: NodeJS.ProcessEnv = process.env): boolean {
  return input.tool_name === 'apply_patch' || typeof (input as { turn_id?: unknown }).turn_id === 'string' || !!env.PLUGIN_ROOT;
}

/**
 * The tool call as the module handlers expect it: a Codex apply_patch becomes one Write (a new
 * file, with the added lines as its content) or Edit (a changed, deleted or moved one, with the
 * added lines as its new text) per file it touches, so the gates and the edit-time scans read it
 * as they read Claude Code's edits. Any other call is unchanged. An apply_patch whose files can't
 * be read gives nothing: the dispatcher refuses it (UNREADABLE_PATCH).
 */
export function asEdits(input: HookInput): HookInput[] {
  if (input.tool_name !== 'apply_patch') return [input];
  const patch = patchText(input.tool_input);
  if (patch === null) return [];
  return parsePatch(patch).map((f) => {
    const text = f.added.join('\n');
    if (f.op === 'add') return { ...input, tool_name: 'Write', tool_input: { file_path: f.path, content: text } };
    return { ...input, tool_name: 'Edit', tool_input: f.op === 'update' ? { file_path: f.path, new_string: text } : { file_path: f.path } };
  });
}

/** SessionStart context for Codex: where the plugin is, since its shell can't expand ${CLAUDE_PLUGIN_ROOT}. */
export function codexSessionContext(env: NodeJS.ProcessEnv = process.env): string | null {
  const root = env.CLAUDE_PLUGIN_ROOT ?? env.PLUGIN_ROOT;
  if (!root) return null;
  return [
    `fwos is running in Codex. Its plugin folder is ${root}.`,
    `Wherever fwos's skills or agents say \${CLAUDE_PLUGIN_ROOT}, use that folder: for example \`node "${root}/dist/fwos.mjs" next --json\`.`,
  ].join(' ');
}
