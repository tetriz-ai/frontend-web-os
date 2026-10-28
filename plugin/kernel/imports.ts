// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Finds import specifiers in JS/TS source without a parser dependency. It tokenizes the kernel
// lexer's code view (text.ts), where comments, JSX text, MDX prose and regex literals are blanked
// and every string is a span, so text that merely looks like an import (in a string, a comment,
// JSX text or generated code) isn't counted. The walls check and the component registry both read
// imports through this one parser.

import { type SourceKind, type StringSpan, lexSource } from './text.ts';

export type ImportKind = 'static' | 'side-effect' | 'dynamic' | 'require' | 're-export';

export interface ImportRef {
  spec: string;
  line: number;
  kind: ImportKind;
  typeOnly: boolean;
}

/** An import with the names it takes from its module: `default`, `*` for a namespace, or an exported name. */
export interface ImportBinding extends ImportRef {
  names: string[];
}

interface Token {
  /** An identifier, a string, a number, or punctuation (`` ` `` for a template literal that is not a plain string). */
  t: 'id' | 'str' | 'num' | 'p';
  v: string;
  line: number;
}

/** A string's token: its value, or `` ` `` for a template literal with a `${...}`, an escape or no end. */
function stringToken(src: string, s: StringSpan, line: number): Token {
  const raw = src.slice(s.open + 1, s.close);
  if (s.quote === '`') {
    // A template literal with no `${...}` is a plain string, and TypeScript resolves it as a specifier.
    return s.closed && s.runs.length === 1 && !raw.includes('\\') ? { t: 'str', v: raw, line } : { t: 'p', v: '`', line };
  }
  let value = '';
  for (let j = 0; j < raw.length; j++) value += raw[j] === '\\' ? (raw[++j] ?? '') : raw[j];
  return { t: 'str', v: value, line };
}

function tokenize(src: string, kind: SourceKind): Token[] {
  const { code, strings } = lexSource(src, kind);
  const out: Token[] = [];
  let line = 1;
  let s = 0;
  let i = 0;
  const n = code.length;
  while (i < n) {
    // A string is one token, a template literal's `${...}` and the strings in it included.
    while (s < strings.length && strings[s]!.open < i) s++;
    const span = strings[s];
    if (span?.open === i) {
      out.push(stringToken(src, span, line));
      for (const end = span.closed ? span.close + 1 : span.close; i < end; i++) if (src[i] === '\n') line++;
      continue;
    }
    const c = code[i]!;
    if (c === '\n') {
      line++;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      i++;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(code[i + 1] ?? ''))) {
      // A number: `10`, `.5`, `1e3`, `0x1F`, `1_000n`.
      let j = i + 1;
      while (j < n && /[\w.]/.test(code[j]!)) j++;
      out.push({ t: 'num', v: code.slice(i, j), line });
      i = j;
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(code[j]!)) j++;
      out.push({ t: 'id', v: code.slice(i, j), line });
      i = j;
    } else {
      out.push({ t: 'p', v: c, line });
      i++;
    }
  }
  return out;
}

/** The names the tokens of an import or export clause take: `A, { B as C, type D }, * as E` gives default, B, D, *. */
function clauseNames(toks: readonly Token[]): string[] {
  const names: string[] = [];
  let braces = 0;
  let seg: Token[] = [];
  const flush = () => {
    const first = seg[0];
    if (!first) return;
    const typed = first.v === 'type' && seg.length > 1 && seg[1]!.v !== 'as';
    names.push(seg[typed ? 1 : 0]!.v);
    seg = [];
  };
  for (let j = 0; j < toks.length; j++) {
    const tok = toks[j]!;
    if (tok.t === 'p' && tok.v === '{') braces++;
    else if (tok.t === 'p' && tok.v === '}') {
      flush();
      braces--;
    } else if (braces > 0) {
      if (tok.t === 'p' && tok.v === ',') flush();
      else seg.push(tok);
    } else if (tok.t === 'p' && tok.v === '*') {
      names.push('*');
      if (toks[j + 1]?.v === 'as') j += 2;
    } else if (tok.t === 'id' && !(j === 0 && tok.v === 'type' && toks.length > 1)) {
      names.push('default');
    }
  }
  return names;
}

function scan(src: string, kind: SourceKind, withNames: boolean): ImportBinding[] {
  const toks = tokenize(src, kind);
  const out: ImportBinding[] = [];
  const at = (k: number) => toks[k];
  const isP = (k: number, v: string) => at(k)?.t === 'p' && at(k)?.v === v;
  const isId = (k: number, v: string) => at(k)?.t === 'id' && at(k)?.v === v;
  const push = (ref: ImportRef, from = 0, to = 0) => out.push(withNames ? { ...ref, names: clauseNames(toks.slice(from, to)) } : (ref as ImportBinding));

  /** From `k`, finds `from '<spec>'` at brace depth 0 before a `;`. */
  const findFrom = (k: number): { spec: string; at: number } | null => {
    let depth = 0;
    for (let j = k; j < toks.length && j < k + 2000; j++) {
      const tok = toks[j]!;
      if (tok.t === 'p' && tok.v === '{') depth++;
      else if (tok.t === 'p' && tok.v === '}') depth--;
      else if (depth === 0 && tok.t === 'p' && tok.v === ';') return null;
      else if (depth === 0 && tok.t === 'id' && tok.v === 'from' && at(j + 1)?.t === 'str') {
        return { spec: at(j + 1)!.v, at: j + 1 };
      }
      if (depth < 0) return null;
    }
    return null;
  };

  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k]!;
    if (tok.t !== 'id') continue;
    const afterDot = isP(k - 1, '.');
    if (tok.v === 'import' && !afterDot) {
      if (at(k + 1)?.t === 'str') {
        push({ spec: at(k + 1)!.v, line: tok.line, kind: 'side-effect', typeOnly: false });
      } else if (isP(k + 1, '(') && at(k + 2)?.t === 'str' && (isP(k + 3, ')') || isP(k + 3, ','))) {
        // `import('x')`, or with import attributes `import('x', { with })`; `import('x' + y)` is computed.
        push({ spec: at(k + 2)!.v, line: tok.line, kind: 'dynamic', typeOnly: false });
      } else if (isP(k + 1, '.') || isP(k + 1, '(')) {
        continue;
      } else {
        const typeOnly = isId(k + 1, 'type') && !isId(k + 2, 'from') && !isP(k + 2, ',');
        const found = findFrom(k + 1);
        if (found) {
          push({ spec: found.spec, line: tok.line, kind: 'static', typeOnly }, k + 1, found.at - 1);
          k = found.at;
        }
      }
    } else if (tok.v === 'export' && !afterDot) {
      const typeOnly = isId(k + 1, 'type');
      const start = typeOnly ? k + 2 : k + 1;
      if (isP(start, '*') || isP(start, '{')) {
        const found = findFrom(start);
        if (found) {
          push({ spec: found.spec, line: tok.line, kind: 're-export', typeOnly }, start, found.at - 1);
          k = found.at;
        }
      }
    } else if (tok.v === 'require' && !afterDot && isP(k + 1, '(') && at(k + 2)?.t === 'str' && isP(k + 3, ')')) {
      push({ spec: at(k + 2)!.v, line: tok.line, kind: 'require', typeOnly: false });
    }
  }
  return out;
}

/** The imports in a file's source. `kind` is how to read it, by its extension (sourceKind): JSX text and MDX prose aren't code. */
export function extractImports(src: string, kind: SourceKind = 'jsx'): ImportRef[] {
  return scan(src, kind, false);
}

/** Like extractImports, with the names each import takes. A dynamic import or `require` takes none it can name. */
export function extractImportBindings(src: string, kind: SourceKind = 'jsx'): ImportBinding[] {
  return scan(src, kind, true);
}
