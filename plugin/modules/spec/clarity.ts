// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Two readings of a change's own words that need no model. The terms in a criterion that leave it
// open to interpretation, after the terms to avoid in ISO/IEC/IEEE 29148 (subjective words,
// unmeasured adverbs and adjectives, loopholes, open-ended lists, comparisons with nothing). And the
// states a change's interactions bring with them: a search can match nothing, a save can fail.
// Text in quotes or backticks is the app's own copy, never the change's wording, so it is skipped.

/** The terms, each matched as a whole word or phrase, in any case. */
const VAGUE = [
  // subjective
  'user-friendly',
  'user friendly',
  'easy',
  'easily',
  'easier',
  'intuitive',
  'intuitively',
  'simple',
  'simply',
  'nice',
  'nicely',
  'seamless',
  'seamlessly',
  'smooth',
  'smoothly',
  'elegant',
  'beautiful',
  'modern',
  'pleasant',
  // unmeasured
  'fast',
  'faster',
  'quick',
  'quickly',
  'slow',
  'slowly',
  'efficient',
  'efficiently',
  'appropriate',
  'appropriately',
  'proper',
  'properly',
  'correct',
  'correctly',
  'relevant',
  'reasonable',
  'reasonably',
  'sufficient',
  'adequate',
  'adequately',
  'significant',
  'minimal',
  'optimal',
  'robust',
  'flexible',
  'usually',
  'normally',
  'typically',
  'generally',
  'often',
  'some',
  'several',
  'many',
  'few',
  'various',
  'better',
  'improved',
  'maybe',
  'perhaps',
  'possibly',
  'probably',
  'might',
  // loopholes
  'if possible',
  'where possible',
  'when possible',
  'as needed',
  'if needed',
  'as appropriate',
  'as applicable',
  'if applicable',
  // open-ended
  'etc',
  'and so on',
  'and/or',
  'or similar',
  'tbd',
  'tbc',
  'todo',
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const VAGUE_RE = new RegExp(`(?<![\\w-])(${[...VAGUE].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\w-])`, 'gi');

/**
 * The text with what names no behaviour blanked out, at the same length: what sits in double quotes
 * or backticks (the app's own copy), links, and file paths.
 */
const unquoted = (text: string) => text.replace(/"[^"\n]*"|“[^”\n]*”|`[^`\n]*`|https?:\/\/\S+|[\w.@()-]+(?:\/[\w.@()-]+)+\.\w+/g, (m) => ' '.repeat(m.length));

/** The terms in `text` that need interpretation, in the order they first appear, each once. "How many" asks for a number, so it isn't one. */
export function vagueTerms(text: string): string[] {
  const out: string[] = [];
  for (const m of unquoted(text).replace(/\bhow (?:many|few|much)\b/gi, (h) => ' '.repeat(h.length)).matchAll(VAGUE_RE)) {
    const term = m[1]!.toLowerCase();
    if (!out.includes(term)) out.push(term);
  }
  return out;
}

/** The interactions a change can bring, the words that name each, and the state each brings. */
const INTERACTIONS: { words: RegExp; state: string; what: string; does: string }[] = [
  { words: /\b(?:search(?:es|ed|ing)?|filter(?:s|ed|ing)?)\b/i, state: 'filtered-empty', what: 'a search or filter can match nothing', does: 'searches' },
  { words: /\b(?:sav(?:e|es|ed|ing)|submit(?:s|ted|ting)?|send(?:s|ing)?|sent|invit(?:e|es|ed|ing)|upload(?:s|ed|ing)?|delet(?:e|es|ed|ing))\b/i, state: 'error', what: 'saving or sending can fail', does: 'saves or sends' },
  { words: /\boffline\b/i, state: 'offline', what: 'the network can drop', does: 'works offline' },
];

export interface BroughtState {
  state: string;
  /** Why the change has it. */
  what: string;
  /** The word in the text that names the interaction, as written. */
  word: string;
}

/** The states the interactions `text` names bring with them, in the order the text names them. */
export function statesBrought(text: string): BroughtState[] {
  const plain = unquoted(text);
  return INTERACTIONS.map((i) => ({ i, m: i.words.exec(plain) }))
    .filter((x): x is { i: (typeof INTERACTIONS)[number]; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => a.m.index - b.m.index)
    .map(({ i, m }) => ({ state: i.state, what: i.what, word: m[0] }));
}

/** What the change does that brings `state`: `searches`, for filtered-empty. */
export function broughtBy(state: string): string {
  return INTERACTIONS.find((i) => i.state === state)?.does ?? `has "${state}"`;
}
