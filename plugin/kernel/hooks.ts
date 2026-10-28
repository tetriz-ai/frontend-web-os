// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The hook contract. Each module exports handlers; `shells/hooks` routes every event to them
// and merges the outcomes (the first deny wins, context lines are joined).

import { realpathSync } from 'node:fs';
import { posix } from 'node:path';
import { matchAny } from './glob.ts';
import { normalizeRel } from './paths.ts';
import type { Project } from './project.ts';

/** What Claude Code sends on stdin. Only the fields fwos reads. */
export interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  /**
   * The subagent that made the call, when one did. Codex and Claude Code send `agent_type`; the
   * other fields are names a host may use instead, and isAgent reads every one of them.
   */
  agent_type?: string;
  agent_name?: string;
  subagent_type?: string;
  subagent_name?: string;
  agent?: string | { type?: unknown; name?: unknown };
  agent_id?: string;
  source?: string;
}

export interface HookOutcome {
  /** Block the tool call with this reason. */
  deny?: string;
  /** Extra context for Claude (SessionStart, PostToolUse, or alongside an allowed PreToolUse). */
  context?: string;
}

export type HookHandler = (input: HookInput, project: Project) => HookOutcome | null;

export interface ModuleHooks {
  preToolUse?: HookHandler[];
  postToolUse?: HookHandler[];
  sessionStart?: HookHandler[];
}

export const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * The edited file's path, relative to the project root, or null when it's outside the project.
 * Symlinks are resolved and the path takes its on-disk spelling, so a link to the root, macOS's
 * /private/var for /var, or `E2E/` for `e2e/` on a disk that ignores case is the same file. A
 * relative path, which is how a Codex patch names files, is relative to the session's folder.
 */
export function editedPath(input: HookInput, project: Project): string | null {
  const raw = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (typeof raw !== 'string' || raw === '') return null;
  const absolute = (p: string) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
  const base = typeof input.cwd === 'string' && absolute(input.cwd) ? input.cwd : project.root;
  const abs = absolute(raw) ? raw : `${base}/${raw}`;
  // Normalise so `docs/../apps/x.ts` or `//apps/x.ts` can't slip past a rule written for `apps/x.ts`.
  const norm = posix.normalize(abs.replace(/\\/g, '/'));
  const root = onDisk(posix.normalize(project.root.replace(/\\/g, '/'))).replace(/\/$/, '');
  const target = onDisk(norm);
  // The OS usually reports the on-disk case already; folding covers a disk where it doesn't.
  const key = project.caseInsensitive ? (p: string) => p.toLowerCase() : (p: string) => p;
  if (!key(target).startsWith(`${key(root)}/`)) return null;
  return target.slice(root.length + 1);
}

/**
 * Whether a project path matches any of the globs. Where the disk ignores case, so does the match:
 * a file the OS hasn't spelled for us yet (a folder that doesn't exist, or a new file) keeps the
 * name it was given, and on that disk `Apps/web/src/x.ts` is the file `apps/**` gates.
 */
export function matchPath(project: Project, rel: string, globs: readonly string[]): boolean {
  if (!project.caseInsensitive) return matchAny(rel, globs);
  return matchAny(rel.toLowerCase(), globs.map((g) => g.toLowerCase()));
}

/** Whether two project paths name the same file: one spelling, and one case where the disk ignores case. */
export function samePath(project: Project, a: string, b: string): boolean {
  const key = (p: string) => (project.caseInsensitive ? normalizeRel(p).toLowerCase() : normalizeRel(p));
  return key(a) === key(b);
}

/**
 * The path with its deepest existing ancestor resolved by the OS (symlinks, and the on-disk case
 * where the OS reports it), and the rest, which doesn't exist yet, kept as written.
 */
function onDisk(path: string): string {
  const rest: string[] = [];
  for (let head = path; ; ) {
    try {
      return posix.join(realpathSync.native(head).replace(/\\/g, '/'), ...rest.reverse());
    } catch {
      const parent = posix.dirname(head);
      if (parent === head) return path;
      rest.push(posix.basename(head));
      head = parent;
    }
  }
}

/** The fields a host may name the calling subagent in. */
const AGENT_FIELDS = ['agent_type', 'agent_name', 'subagent_type', 'subagent_name', 'agent'] as const;

/**
 * Whether the call came from the subagent `name`, with or without the plugin namespace (`builder`,
 * `fwos:builder`), in any field a host names it in, so a host that uses another field than
 * `agent_type` doesn't switch a sandbox off.
 */
export function isAgent(input: HookInput, name: string): boolean {
  const named = (t: unknown) => typeof t === 'string' && (t === name || t.endsWith(`:${name}`));
  return AGENT_FIELDS.some((field) => {
    const v: unknown = input[field];
    if (named(v)) return true;
    const o = typeof v === 'object' && v !== null ? (v as { type?: unknown; name?: unknown }) : null;
    return o !== null && (named(o.type) || named(o.name));
  });
}
