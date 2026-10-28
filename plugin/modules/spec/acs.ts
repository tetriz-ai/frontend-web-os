// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Acceptance criteria. IDs are `AC-<feature>-<n>`, stable across branches. Each AC is a heading
// followed by `- Key: value` lines, so it reads well and parses without a model:
//
//   ### AC-reading-1: Saving a link puts it at the top of the list
//   - Journey: J1
//   - Given an empty list, when I save a link, then it shows first with its title.
//   - Proven against: local
//   - Release: first

export const AC_ID = /\bAC-[a-z0-9]+(?:-[a-z0-9]+)*-\d+\b/g;
const AC_HEADING = /^#{2,4}\s+(AC-[a-z0-9]+(?:-[a-z0-9]+)*-\d+)\s*(?:[:.–—-]\s*(.*))?$/;

export type ProvenAgainst = 'mock' | 'local' | 'real';

export interface Ac {
  id: string;
  feature: string;
  title: string;
  line: number;
  fields: Record<string, string>;
  provenAgainst?: ProvenAgainst;
  release: 'first' | 'later';
  /** Set when the AC can only be checked by a person; the reason is required. */
  manual?: string;
}

export function featureOf(id: string): string {
  return id.replace(/^AC-/, '').replace(/-\d+$/, '');
}

/** Parses `- Key: value` blocks under headings matching `pattern`. Shared by the spec and the test plan. */
export function parseBlocks(text: string, pattern: RegExp): { id: string; title: string; line: number; fields: Record<string, string> }[] {
  const lines = text.split(/\r?\n/);
  const out: { id: string; title: string; line: number; fields: Record<string, string> }[] = [];
  let cur: (typeof out)[number] | null = null;
  let inFence = false;
  lines.forEach((raw, i) => {
    if (/^\s*```/.test(raw)) inFence = !inFence;
    if (inFence) return;
    const m = pattern.exec(raw.trim());
    if (m) {
      cur = { id: m[1]!, title: (m[2] ?? '').trim(), line: i + 1, fields: {} };
      out.push(cur);
      return;
    }
    if (/^#{1,6}\s/.test(raw)) {
      cur = null;
      return;
    }
    if (!cur) return;
    const f = /^\s*[-*]\s+\*{0,2}([A-Za-z][\w /-]*?)\*{0,2}\s*:\s*(.+)$/.exec(raw);
    if (f) cur.fields[f[1]!.trim().toLowerCase()] = f[2]!.trim();
  });
  return out;
}

export function parseAcs(spec: string): Ac[] {
  return parseBlocks(spec, AC_HEADING).map((b) => {
    const proven = b.fields['proven against']?.toLowerCase().split(/[\s,(]/)[0];
    const ac: Ac = {
      id: b.id,
      feature: featureOf(b.id),
      title: b.title,
      line: b.line,
      fields: b.fields,
      release: b.fields.release?.toLowerCase().startsWith('later') ? 'later' : 'first',
    };
    if (proven === 'mock' || proven === 'local' || proven === 'real') ac.provenAgainst = proven;
    if (b.fields.manual) ac.manual = b.fields.manual;
    return ac;
  });
}

/**
 * Each AC's text by ID: its heading and the lines under it up to the next heading, each trimmed,
 * blank lines dropped. Two versions of a spec say the same of an AC when its text is the same.
 */
export function acTexts(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let cur: string | null = null;
  let inFence = false;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) inFence = !inFence;
    const m = inFence ? null : AC_HEADING.exec(raw.trim());
    if (m) {
      cur = m[1]!;
      out[cur] = raw.trim();
      continue;
    }
    if (!inFence && /^#{1,6}\s/.test(raw)) cur = null;
    else if (cur && raw.trim()) out[cur] += `\n${raw.trim()}`;
  }
  return out;
}

/**
 * Headings that start with `AC-` (any case, any level) but don't match the AC heading, so `parseAcs`
 * would drop them silently: `### AC-List-2: ...`, `### AC-read_later-3: ...`, `##### AC-x-1: ...`.
 */
export function malformedAcHeadings(text: string): { heading: string; line: number }[] {
  const out: { heading: string; line: number }[] = [];
  let inFence = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    if (/^\s*```/.test(raw)) inFence = !inFence;
    if (inFence) return;
    const m = /^#{1,6}\s+(ac-.*)$/i.exec(raw.trim());
    if (m && !AC_HEADING.test(raw.trim())) out.push({ heading: m[1]!.trim(), line: i + 1 });
  });
  return out;
}

/** Every AC ID mentioned anywhere in the text, with its line. */
export function acReferences(text: string): { id: string; line: number }[] {
  const out: { id: string; line: number }[] = [];
  let inFence = false;
  text.split(/\r?\n/).forEach((l, i) => {
    if (/^\s*```/.test(l)) inFence = !inFence;
    if (inFence) return;
    for (const m of l.matchAll(AC_ID)) out.push({ id: m[0], line: i + 1 });
  });
  return out;
}

/** The spec's sections, in order (section 1 to 13 of the app spec). */
export const SPEC_SECTIONS = [
  "What you're approving",
  'Journeys',
  'Scope by platform',
  'Screens and navigation',
  'States per screen',
  'Data and API contract',
  'Architecture',
  'Design system binding',
  'Cross-cutting',
  'Acceptance criteria',
  'Release and distribution',
  'Open questions',
  'Slices',
] as const;

/**
 * An adopted app's spec: only what changes delivered through fwos added, never the product's whole
 * spec. Each change rewrites "What you're approving" and adds its criteria.
 */
export const ADOPTED_SPEC_SECTIONS = ["What you're approving", 'Context', 'Acceptance criteria', 'Open questions'] as const;

export const SPEC_CEILING_CHARS = 60_000;
