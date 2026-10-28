// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// spec/format: the spec has every section, every AC is well-formed and unique, every AC says
// what it was proven against, and every AC reference points at a real AC. Judgement about the
// content (is each AC checkable without interpretation?) belongs to the spec review, not here.

import { posix } from 'node:path';
import { type Check, type Finding, type Project, off, parseFrontmatter, result } from '../../../kernel/index.ts';
import { type Change, currentChange, isAdoptionRecord } from '../../state/index.ts';
import { ADOPTED_SPEC_SECTIONS, SPEC_CEILING_CHARS, SPEC_SECTIONS, acReferences, acTexts, malformedAcHeadings, parseAcs } from '../acs.ts';
import { broughtBy, statesBrought, vagueTerms } from '../clarity.ts';
import { acDelta } from '../delta.ts';
import { parseQuestions, parseRequest, parseStates } from '../request.ts';

export const specPath = (p: Project) => posix.join(p.paths.docs, 'spec.md');

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^\d+[.)]\s*/, '')
    .trim();

/** A section's text, from its `## ` heading to the next one. */
function section(body: string, name: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+/.test(l) && norm(l.replace(/^##\s+/, '')).startsWith(norm(name)));
  if (start === -1) return '';
  const end = lines.findIndex((l, i) => i > start && /^##\s+/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
const quoted = (xs: string[]) => {
  const q = xs.map((x) => `"${x}"`);
  return q.length < 2 ? q.join('') : `${q.slice(0, -1).join(', ')} and ${q.at(-1)}`;
};

/**
 * The open change of an adopted app, on a route with a spec delta. What it answers for depends on
 * the stages the team keeps its own practice for. With the spec fwos's: its Context names each file
 * it maps, its own criteria need no interpretation, and every open question has an ID. With the
 * spec kept, each of its criteria names where in the team's spec it comes from. Either way it has
 * criteria of its own, added or changed since it began; the ones it carries were approved by the
 * changes before it. Its asks (unless the team keeps the idea stage) and its states (unless it keeps
 * design) trace the request to them.
 */
function ownChange(project: Project, path: string, text: string, body: string): Finding[] {
  if (project.mode !== 'adopt' || !project.initialized) return [];
  const change = currentChange(project.root);
  if (!change || isAdoptionRecord(project, change) || change.route === 'code-only') return [];
  const findings: Finding[] = [];
  const delta = acDelta(change, text);
  const own = delta ? [...delta.added, ...delta.changed] : [];
  const acs = parseAcs(text);
  const lineOf = (id: string) => acs.find((a) => a.id === id)?.line;
  if (!project.kept.includes('spec')) {
    const context = section(body, 'Context');
    for (const t of change.map?.targets ?? []) {
      if (!context.includes(t.file)) findings.push({ file: path, rule: 'context', message: `the Context section doesn't name ${t.file}, which the change maps${t.target === t.file ? '' : ` (${t.target})`}` });
    }
    const texts = acTexts(text);
    for (const id of own) {
      const terms = vagueTerms(texts[id] ?? '');
      if (terms.length > 0) findings.push({ file: path, line: lineOf(id), rule: 'vague', message: `${id} says ${quoted(terms)}, which need interpretation: say exactly what the user sees, with the values or numbers that decide it` });
    }
    for (const q of parseQuestions(text).loose) {
      findings.push({ file: path, line: q.line, rule: 'question', message: `"${q.text}" is a question with no ID: write it as ### Q-<n>: <question>, so its answer is recorded before the approval` });
    }
  } else findings.push(...sources(path, change, own, acs, lineOf));
  if (delta && own.length === 0) {
    findings.push({ file: path, rule: 'delta', message: `change ${change.id} (${change.route}) adds or changes no acceptance criterion, so there is nothing new to approve: write its criteria in the spec delta, or route it code-only` });
  }
  if (!project.kept.includes('idea')) findings.push(...asks(path, text, own));
  if (!project.kept.includes('design')) findings.push(...states(path, text, change.title, own));
  return findings;
}

/** With the spec kept, each of the change's own criteria names where in the team's spec it comes from: one of the change's links. */
function sources(path: string, change: Change, own: string[], acs: ReturnType<typeof parseAcs>, lineOf: (id: string) => number | undefined): Finding[] {
  const refs = (change.links ?? []).map((l) => l.ref);
  const how = '`fwos change link <url|path> --stage spec`';
  return own.flatMap((id): Finding[] => {
    const source = acs.find((a) => a.id === id)?.fields.source?.trim();
    if (!source) return [{ file: path, line: lineOf(id), rule: 'source', message: `${id} says nothing of where it comes from: add "- Source: <where in your spec>", one of change ${change.id}'s links (${how})` }];
    if (refs.some((r) => source.startsWith(r))) return [];
    return [{ file: path, line: lineOf(id), rule: 'source', message: `${id} names where it comes from (${source}), but change ${change.id} links no such spec: link it with ${how}` }];
  });
}

/** Each ask of the request has the criteria that deliver it, or why it was dropped, and each of the change's own criteria answers an ask. */
function asks(path: string, text: string, own: string[]): Finding[] {
  const r = parseRequest(text);
  const finding = (message: string, line?: number): Finding => ({ file: path, ...(line ? { line } : {}), rule: 'request', message });
  if (!r.present) return [finding('no "## Request": list each ask of the request as ### REQ-<n>: <ask>, with the criteria that deliver it (- AC: ...) or why it is left out (- Dropped: <why>)')];
  if (r.asks.length === 0) return [finding('the Request section names no ask: write each as ### REQ-<n>: <ask>, with the criteria that deliver it')];
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const a of r.asks) {
    if (seen.has(a.id)) out.push(finding(`${a.id} is defined twice`, a.line));
    seen.add(a.id);
    if (a.dropped !== undefined) {
      if (a.dropped.trim().length < 5) out.push(finding(`${a.id} is dropped with no reason: say why it is left out (- Dropped: <why>)`, a.line));
    } else if (a.criteria.length === 0) {
      out.push(finding(`${a.id} (${a.title}) has no criterion and isn't dropped: name the criteria that deliver it (- AC: AC-...), or drop it with why (- Dropped: <why>)`, a.line));
    }
  }
  const named = new Set(r.asks.flatMap((a) => a.criteria));
  for (const id of own) if (!named.has(id)) out.push(finding(`${id} isn't traced to the request: name it under the ask it delivers (- AC: ${id} under a ### REQ-<n>)`));
  return out;
}

/**
 * The states of what the change touches, each with what covers it, and every state its
 * interactions bring (a search's filtered-empty first), read from the request, its asks and its
 * own criteria.
 */
function states(path: string, text: string, request: string, own: string[]): Finding[] {
  const s = parseStates(text);
  const finding = (message: string, line?: number): Finding => ({ file: path, ...(line ? { line } : {}), rule: 'states', message });
  if (!s.present) return [finding('no "## States": list the states of what the change touches (| State | What the user sees | Criterion |), or write "None" and why')];
  const out: Finding[] = [];
  for (const row of s.rows) {
    const note = row.note ?? '';
    const covered = row.criteria.length > 0 || /^unchanged\b/i.test(note) || /^(?:none|n\/a)\b\W*\S.{3,}/i.test(note);
    if (!covered) out.push(finding(`the state "${row.state}" names no criterion: an AC that covers it, "unchanged", or "none: <why>"`, row.line));
  }
  const texts = acTexts(text);
  // A dropped ask brings no state: the change doesn't do it.
  const asked = parseRequest(text).asks.filter((a) => a.dropped === undefined);
  const where: [string, string][] = [['the request', request], ...asked.map((a): [string, string] => [a.id, a.title]), ...own.map((id): [string, string] => [id, texts[id] ?? ''])];
  const brought = new Map<string, { word: string; what: string; in: string }>();
  for (const [name, t] of where) for (const b of statesBrought(t)) if (!brought.has(b.state)) brought.set(b.state, { word: b.word, what: b.what, in: name });
  for (const [state, b] of brought) {
    if (s.rows.some((r) => r.state === state)) continue;
    out.push(finding(`the change ${broughtBy(state)} ("${b.word}" in ${b.in}), so ${b.what}: add "${state}" to ## States with the criterion that covers it, or "none: <why>" if it can't happen`));
  }
  return out;
}

export const formatCheck: Check = {
  id: 'spec/format',
  title: 'Spec structure and AC format',
  catches:
    'a missing spec section, a duplicate or malformed AC, an AC with no "proven against", a reference to an AC that does not exist; in an adopted app\'s change, an ask with no criterion, a criterion no ask names, a state its interactions bring left out, a criterion that needs interpretation, a question with no ID',
  platforms: ['web', 'electron', 'mac'],
  run({ project }) {
    const id = 'spec/format';
    const path = specPath(project);
    const text = project.read(path);
    if (text === null) {
      const writer = project.mode === 'adopt' ? 'a change delivered through fwos writes its spec delta there' : 'the spec step writes it';
      return off(id, `no ${path} yet; ${writer}`);
    }
    const findings: Finding[] = [];
    const body = parseFrontmatter(text).body;
    const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => norm(m[1]!));
    // A team that keeps its own spec keeps its prose there too: fwos's delta holds only the criteria.
    const sections = project.mode !== 'adopt' ? SPEC_SECTIONS : project.kept.includes('spec') ? (['Acceptance criteria'] as const) : ADOPTED_SPEC_SECTIONS;
    for (const s of sections) {
      if (!headings.some((h) => h.startsWith(norm(s)))) findings.push({ file: path, rule: 'section', message: `missing section "## ${s}"` });
    }
    for (const h of malformedAcHeadings(text)) {
      findings.push({
        file: path,
        line: h.line,
        rule: 'ac-malformed',
        message: `"${h.heading}" is not read as an AC; write it as "### AC-<feature>-<n>: <title>", with the feature in lowercase letters, digits and hyphens`,
      });
    }
    const acs = parseAcs(text);
    if (acs.length === 0) findings.push({ file: path, rule: 'ac', message: 'no acceptance criteria (### AC-<feature>-<n>: <title>)' });
    const seen = new Map<string, number>();
    for (const ac of acs) {
      if (seen.has(ac.id)) findings.push({ file: path, line: ac.line, rule: 'ac-duplicate', message: `${ac.id} is defined twice (first at line ${seen.get(ac.id)})` });
      seen.set(ac.id, ac.line);
      if (!ac.title) findings.push({ file: path, line: ac.line, rule: 'ac-title', message: `${ac.id} has no title` });
      if (!ac.provenAgainst) {
        findings.push({ file: path, line: ac.line, rule: 'ac-proven-against', message: `${ac.id} needs "- Proven against: mock | local | real"` });
      }
      if (ac.fields.manual !== undefined && ac.fields.manual.trim().length < 5) {
        findings.push({ file: path, line: ac.line, rule: 'ac-manual', message: `${ac.id} is manual, so it needs a reason why it can't be automated` });
      }
    }
    for (const ref of acReferences(text)) {
      if (!seen.has(ref.id)) findings.push({ file: path, line: ref.line, rule: 'ac-reference', message: `refers to ${ref.id}, which isn't defined` });
    }
    findings.push(...ownChange(project, path, text, body));
    if (text.length > SPEC_CEILING_CHARS) {
      findings.push({ file: path, rule: 'size', message: `${text.length} characters, over the ${SPEC_CEILING_CHARS} ceiling; link the brief instead of repeating it, and move mechanism out` });
    }
    const first = acs.filter((a) => a.release === 'first').length;
    return result(id, findings, [path], undefined, [`${acs.length} AC${acs.length === 1 ? '' : 's'} (${first} first release)`]);
  },
};
