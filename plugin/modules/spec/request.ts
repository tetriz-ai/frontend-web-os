// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The sections an adopted app's change adds to its spec delta, so the request can be traced to the
// evidence: the request broken into asks (each with the criteria that deliver it, or why it was
// dropped), the questions with the answers they got, and the states of what the change touches.
//
//   ### REQ-1: Search the members by name
//   - AC: AC-members-1
//
//   ### Q-1: Does a search match emails as well as names?
//   - Answer: Names only, as the list shows them (Example Owner)
//
//   | State | What the user sees | Criterion |
//   | filtered-empty | No members match. | AC-members-1 |

import { AC_ID, parseBlocks } from './acs.ts';

const REQ_HEADING = /^#{2,4}\s+(REQ-\d+)\s*(?:[:.–—-]\s*(.*))?$/;
const Q_HEADING = /^#{2,4}\s+(Q-\d+)\s*(?:[:.–—-]\s*(.*))?$/;

/** The lines of a `## <name>` section, each with its line number, outside code fences. Null when the spec has no such section. */
export function sectionLines(text: string, name: string): { text: string; line: number }[] | null {
  const lines = text.split(/\r?\n/);
  const heading = new RegExp(`^##\\s+(?:\\d+[.)]\\s*)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  let inFence = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i]!)) inFence = !inFence;
    if (!inFence && heading.test(lines[i]!.trim())) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const out: { text: string; line: number }[] = [];
  inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*```/.test(l)) inFence = !inFence;
    if (!inFence && /^##\s/.test(l)) break;
    if (!inFence) out.push({ text: l, line: i + 1 });
  }
  return out;
}

/** One ask of the request: what it asks for, and the criteria that deliver it, or why it was left out. */
export interface Ask {
  id: string;
  title: string;
  line: number;
  criteria: string[];
  dropped?: string;
}

/** The request, broken into asks (`### REQ-<n>`). `present` says whether the spec has a `## Request` section. */
export function parseRequest(spec: string): { present: boolean; asks: Ask[] } {
  const asks = parseBlocks(spec, REQ_HEADING).map((b) => {
    const ask: Ask = { id: b.id, title: b.title, line: b.line, criteria: [...(b.fields.ac ?? b.fields.acs ?? '').matchAll(AC_ID)].map((m) => m[0]) };
    if (b.fields.dropped !== undefined) ask.dropped = b.fields.dropped;
    return ask;
  });
  return { present: sectionLines(spec, 'Request') !== null, asks };
}

export interface Question {
  id: string;
  text: string;
  line: number;
  /** Unset while the question is open. */
  answer?: string;
}

/**
 * The questions (`### Q-<n>`), each with its answer once it has one, and the questions the Open
 * questions section asks without an ID, whose answers nothing would record.
 */
export function parseQuestions(spec: string): { questions: Question[]; loose: { text: string; line: number }[] } {
  const questions = parseBlocks(spec, Q_HEADING).map((b) => {
    const q: Question = { id: b.id, text: b.title, line: b.line };
    if (b.fields.answer?.trim()) q.answer = b.fields.answer.trim();
    return q;
  });
  const loose = (sectionLines(spec, 'Open questions') ?? [])
    .map((l) => ({ text: l.text.trim().replace(/^[-*]\s+/, ''), line: l.line, raw: l.text.trim() }))
    // A Q heading, or one of its `- Key: value` lines, is no loose question.
    .filter((l) => l.text.endsWith('?') && !/^#/.test(l.raw) && !/^[-*]\s+\*{0,2}[A-Za-z][\w /-]*?\*{0,2}\s*:\s/.test(l.raw))
    .map(({ text, line }) => ({ text, line }));
  return { questions, loose };
}

/** A state of what the change touches: what the user sees in it, and the criteria that cover it (or why none does). */
export interface StateRow {
  state: string;
  what: string;
  criteria: string[];
  /** The criterion cell when it names no AC: `unchanged`, or `none: <why>`. */
  note?: string;
  line: number;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

/**
 * The `## States` table: one row per state (`| State | What the user sees | Criterion |`). `none`
 * says the section lists no state and says why ("None: ...").
 */
export function parseStates(spec: string): { present: boolean; none: boolean; rows: StateRow[] } {
  const section = sectionLines(spec, 'States');
  if (section === null) return { present: false, none: false, rows: [] };
  const table = section.filter((l) => l.text.trim().startsWith('|'));
  const separator = (t: string) => /^\|?\s*:?-{2,}/.test(t.trim());
  const rows: StateRow[] = [];
  table.forEach((l, i) => {
    // The header is the row the separator follows.
    if (separator(l.text) || (table[i + 1] && separator(table[i + 1]!.text))) return;
    const [state = '', what = '', crit = ''] = cells(l.text);
    const criteria = [...crit.matchAll(AC_ID)].map((m) => m[0]);
    const row: StateRow = { state: state.replace(/`/g, '').toLowerCase(), what, criteria, line: l.line };
    if (criteria.length === 0 && crit) row.note = crit;
    rows.push(row);
  });
  const none = rows.length === 0 && section.some((l) => /^none\b/i.test(l.text.trim().replace(/^[-*]\s+/, '')));
  return { present: true, none, rows };
}
