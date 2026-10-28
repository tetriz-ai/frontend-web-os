// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Text helpers for scanners that work on source without parsing it.

/**
 * How to read a source file. `js` is JavaScript or TypeScript with no JSX. `jsx` adds JSX
 * elements, whose text is neither a comment nor a string. `mdx` is JSX text at the top level.
 */
export type SourceKind = 'css' | 'js' | 'jsx' | 'mdx';

/** The kind of a file by its extension, or null for a file the scanners don't read. */
export function sourceKind(file: string): SourceKind | null {
  if (/\.(?:css|scss|less)$/.test(file)) return 'css';
  if (/\.[mc]?tsx?$/.test(file)) return file.endsWith('x') ? 'jsx' : 'js';
  if (/\.[mc]?jsx?$/.test(file)) return 'jsx';
  if (file.endsWith('.mdx')) return 'mdx';
  return null;
}

/** A string literal, a JSX attribute string or a template literal. */
export interface StringSpan {
  /** Offset of the opening quote. */
  open: number;
  /** Offset of the closing quote, or where the string stopped when it never closed. */
  close: number;
  quote: string;
  closed: boolean;
  /** The literal text as [start, end) offsets. A template literal has one run per stretch between `${...}`. */
  runs: [number, number][];
}

export interface Lexed {
  /** The source with comments replaced by spaces (offsets and newlines kept). */
  masked: string;
  /** `masked` with JSX text, MDX prose and regex literals blanked too, so only code and strings are left. */
  code: string;
  strings: StringSpan[];
}

/** Splits source into comments, strings and the rest. Linear in the length of the source. */
export function lexSource(src: string, kind: SourceKind): Lexed {
  return kind === 'css' ? lexCss(src) : lexScript(src, kind);
}

/**
 * Replaces comments with spaces (offsets and newlines kept), leaving strings alone. `true` reads
 * CSS and `false` reads script with no JSX; pass a kind to read JSX text as text, not as comments.
 */
export function maskComments(src: string, kind: boolean | SourceKind): string {
  return lexSource(src, kind === true ? 'css' : kind === false ? 'js' : kind).masked;
}

/** Lexes a file by its name, Sass and Less `//` comments included, or null for a kind no scanner reads. */
export function lexFile(file: string, src: string): Lexed | null {
  const kind = sourceKind(file);
  if (!kind) return null;
  const lexed = lexSource(src, kind);
  if (!/\.(?:scss|less)$/.test(file)) return lexed;
  const masked = maskLineComments(lexed.masked, lexed.strings);
  return { ...lexed, masked, code: masked };
}

/**
 * Blanks Sass and Less `//` comments, which a CSS lexer leaves in: a `//` outside a string, at the
 * start of a line or after a space, `;`, `{` or `}`. So `url(http://...)` stays.
 */
function maskLineComments(masked: string, strings: StringSpan[]): string {
  const out = masked.split('');
  // The lexer gives strings in order and apart, so a binary search finds the one at `at`.
  const inString = (at: number) => {
    let lo = 0;
    let hi = strings.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = strings[mid]!;
      if (at < s.open) hi = mid - 1;
      else if (at > s.close) lo = mid + 1;
      else return true;
    }
    return false;
  };
  let i = masked.indexOf('//');
  while (i !== -1) {
    if (/^$|[\s;{}]/.test(masked[i - 1] ?? '') && !inString(i)) {
      const end = masked.indexOf('\n', i);
      const stop = end === -1 ? masked.length : end;
      out.fill(' ', i, stop);
      i = masked.indexOf('//', stop);
    } else i = masked.indexOf('//', i + 1);
  }
  return out.join('');
}

function blank(out: string[], from: number, to: number) {
  for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
}

/** A '...' or "..." string from `open`: backslash escapes, and it stops at a newline. */
function quoted(src: string, open: number): StringSpan {
  const q = src[open]!;
  let j = open + 1;
  while (j < src.length && src[j] !== q && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
  const close = Math.min(j, src.length);
  return { open, close, quote: q, closed: src[close] === q, runs: [[open + 1, close]] };
}

function lexCss(src: string): Lexed {
  const out = src.split('');
  const strings: StringSpan[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(out, i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      const s = quoted(src, i);
      strings.push(s);
      i = s.closed ? s.close + 1 : s.close;
    } else i++;
  }
  const masked = out.join('');
  return { masked, code: masked, strings };
}

type Tag = { t: 'tag'; name: string; at: number; strings: number; prev: string; word: string };
type Frame = { t: 'code'; depth: number } | { t: 'tmpl'; span: StringSpan; from: number } | Tag | { t: 'kids' };

const IDENT = /[\w$]/;
const KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'default']);
/** After one of these, `/` starts a regex and `<` can start a JSX element. */
const OPERATORS = '([{,;=:?!&|^~+-*%<>';
/** Longest regex literal looked for, so a stray `/` can't make the scan quadratic. */
const MAX_REGEX = 500;

/** The offset after a regex literal starting at `i`, or -1 when it doesn't close on its line. */
function regexEnd(src: string, i: number): number {
  let inClass = false;
  const stop = Math.min(src.length, i + MAX_REGEX);
  for (let j = i + 1; j < stop; j++) {
    const c = src[j]!;
    if (c === '\n') return -1;
    if (c === '\\') j++;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      let k = j + 1;
      while (k < src.length && /[a-z]/.test(src[k]!)) k++;
      return k;
    }
  }
  return -1;
}

/** Whether the backticks at `at` start a line, after at most three spaces: where an MDX fence opens or closes. */
function startsLine(src: string, at: number): boolean {
  let j = at;
  while (j > 0 && at - j < 3 && src[j - 1] === ' ') j--;
  return j === 0 || src[j - 1] === '\n';
}

/**
 * Where each MDX code span closes: for every run of backticks, the next run of exactly as many in
 * its paragraph, or -1 when there is none and the run is a backtick in the text. A blank line or a
 * fence line ends a paragraph. One pass each way, so it stays linear.
 */
function codeSpanEnds(src: string): Map<number, number> {
  const runs: { at: number; n: number; para: number }[] = [];
  let para = 0;
  let blankLine = true;
  for (let k = 0; k < src.length; k++) {
    const c = src[k];
    if (c === '\n') {
      if (blankLine) para++;
      blankLine = true;
    } else if (c === '`') {
      let n = 1;
      while (src[k + n] === '`') n++;
      const fence = n >= 3 && startsLine(src, k);
      runs.push({ at: k, n, para: fence ? ++para : para });
      if (fence) para++;
      blankLine = false;
      k += n - 1;
    } else if (c !== ' ' && c !== '\t' && c !== '\r') blankLine = false;
  }
  const ends = new Map<number, number>();
  const next = new Map<number, number>();
  let current = -1;
  for (let r = runs.length - 1; r >= 0; r--) {
    const run = runs[r]!;
    if (run.para !== current) {
      next.clear();
      current = run.para;
    }
    ends.set(run.at, next.get(run.n) ?? -1);
    next.set(run.n, run.at);
  }
  return ends;
}

/** The end of an MDX fence of `n` backticks opening at `at`: after a later line of at least `n` backticks and nothing else, or the end of the source. */
function fenceEnd(src: string, at: number, n: number): number {
  for (let eol = src.indexOf('\n', at); eol !== -1; ) {
    let j = eol + 1;
    while (j - eol <= 3 && src[j] === ' ') j++;
    let m = 0;
    while (src[j + m] === '`') m++;
    const next = src.indexOf('\n', j + m);
    if (m >= n && src.slice(j + m, next === -1 ? src.length : next).trim() === '') return j + m;
    eol = next;
  }
  return src.length;
}

/** Last offset of each closing tag (`</Name>`, and `</>` as ""), to tell `<T>` from an element. */
function closingTags(src: string): Map<string, number> {
  const last = new Map<string, number>();
  for (const m of src.matchAll(/<\/\s*([A-Za-z_$][\w$.:-]*)?\s*>/g)) last.set(m[1] ?? '', m.index);
  return last;
}

function lexScript(src: string, kind: 'js' | 'jsx' | 'mdx'): Lexed {
  const out = src.split('');
  const strings: StringSpan[] = [];
  const closers = kind === 'js' ? new Map<string, number>() : closingTags(src);
  const lastBlockEnd = src.lastIndexOf('*/');
  const lastQuote: Record<string, number> = { '"': src.lastIndexOf('"'), "'": src.lastIndexOf("'") };
  const lastGt = src.lastIndexOf('>');
  const stack: Frame[] = [kind === 'mdx' ? { t: 'kids' } : { t: 'code', depth: 0 }];
  /** Offsets of a `<` that turned out not to open an element; read again as an operator or text. */
  const notTag = new Set<number>();
  /** 1 where the code view is blanked: JSX text, MDX prose and regex literals. */
  const notCode = new Uint8Array(src.length);
  const spanEnds = kind === 'mdx' ? codeSpanEnds(src) : new Map<number, number>();
  let prev = '';
  let word = '';
  let i = 0;

  const exprStart = () => prev === '' || OPERATORS.includes(prev) || (prev === 'a' && KEYWORDS.has(word));
  const operand = () => {
    prev = ')';
    word = '';
  };
  const blockComment = () => {
    if (src[i + 1] !== '*' || lastBlockEnd < i + 2) return false;
    const stop = src.indexOf('*/', i + 2) + 2;
    blank(out, i, stop);
    i = stop;
    return true;
  };

  /** Opens a JSX element when one starts at `i`. */
  const openTag = (): boolean => {
    if (kind === 'js' || notTag.has(i)) return false;
    const next = src[i + 1] ?? '';
    if (next === '>') {
      if ((closers.get('') ?? -1) < i) return false;
      stack.push({ t: 'kids' });
      i += 2;
      return true;
    }
    if (!/[A-Za-z_$]/.test(next)) return false;
    const name = /^[\w$.:-]+/.exec(src.slice(i + 1, i + 200))![0];
    // A type parameter list, `<T,>` or `<T extends U>`, not an element.
    if (/^\s*(?:,|extends\b)/.test(src.slice(i + 1 + name.length, i + 1 + name.length + 20))) return false;
    stack.push({ t: 'tag', name, at: i, strings: strings.length, prev, word });
    i += 1 + name.length;
    return true;
  };

  /** Not an element after all: restore the text from its `<` and read it again. */
  const rewind = (tag: Tag) => {
    while (stack.at(-1) !== tag) stack.pop();
    stack.pop();
    for (let k = tag.at; k < i && k < src.length; k++) out[k] = src[k]!;
    notCode.fill(0, tag.at, i);
    strings.length = tag.strings;
    notTag.add(tag.at);
    prev = tag.prev;
    word = tag.word;
    i = tag.at;
  };

  const closeElement = () => {
    stack.pop();
    if (stack.at(-1)?.t === 'code') operand();
  };

  const code = (top: { t: 'code'; depth: number }, c: string) => {
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      blank(out, i, stop);
      i = stop;
    } else if (c === '/' && blockComment()) {
      // masked
    } else if (c === '/' && exprStart() && regexEnd(src, i) !== -1) {
      const end = regexEnd(src, i);
      notCode.fill(1, i, end);
      i = end;
      operand();
    } else if (c === '"' || c === "'") {
      const s = quoted(src, i);
      strings.push(s);
      i = s.closed ? s.close + 1 : s.close;
      operand();
    } else if (c === '`') {
      const span: StringSpan = { open: i, close: src.length, quote: '`', closed: false, runs: [] };
      strings.push(span);
      stack.push({ t: 'tmpl', span, from: i + 1 });
      i++;
    } else if (c === '{') {
      top.depth++;
      prev = '{';
      word = '';
      i++;
    } else if (c === '}' && top.depth === 0 && stack.length > 1) {
      stack.pop();
      const back = stack.at(-1)!;
      if (back.t === 'tmpl') back.from = i + 1;
      i++;
    } else if (c === '<' && exprStart() && openTag()) {
      // entered a JSX element
    } else if (IDENT.test(c)) {
      let j = i + 1;
      while (j < src.length && IDENT.test(src[j]!)) j++;
      word = src.slice(i, j);
      prev = 'a';
      i = j;
    } else {
      if (c === '}') top.depth = Math.max(0, top.depth - 1);
      if (!/\s/.test(c)) {
        prev = c;
        word = '';
      }
      i++;
    }
  };

  const template = (top: { t: 'tmpl'; span: StringSpan; from: number }, c: string) => {
    if (c === '\\') i += 2;
    else if (c === '`') {
      top.span.runs.push([top.from, i]);
      top.span.close = i;
      top.span.closed = true;
      stack.pop();
      operand();
      i++;
    } else if (c === '$' && src[i + 1] === '{') {
      top.span.runs.push([top.from, i]);
      stack.push({ t: 'code', depth: 0 });
      prev = '';
      i += 2;
    } else i++;
  };

  const tag = (top: Tag, c: string) => {
    if (c === '"' || c === "'") {
      if (lastQuote[c]! <= i) return rewind(top);
      const end = src.indexOf(c, i + 1);
      strings.push({ open: i, close: end, quote: c, closed: true, runs: [[i + 1, end]] });
      i = end + 1;
    } else if (c === '{') {
      stack.push({ t: 'code', depth: 0 });
      prev = '';
      i++;
    } else if (c === '/' && src[i + 1] === '>') {
      i += 2;
      closeElement();
    } else if (c === '>') {
      // An opening tag with no closing tag anywhere after it is a type, such as `<T>(x: T) => x`.
      if ((closers.get(top.name) ?? -1) < i) return rewind(top);
      stack[stack.length - 1] = { t: 'kids' };
      i++;
    } else if (c === '/' && blockComment()) {
      // masked
    } else if (c === '<' || c === ';' || c === '(' || c === ')' || c === '}') {
      rewind(top);
    } else i++;
  };

  const children = (c: string) => {
    if (c === '{') {
      stack.push({ t: 'code', depth: 0 });
      prev = '';
      i++;
    } else if (c === '<' && src[i + 1] === '/') {
      if (stack.length === 1 || lastGt < i) notCode[i++] = 1;
      else {
        i = src.indexOf('>', i) + 1;
        closeElement();
      }
    } else if (c === '<' && openTag()) {
      // a nested element
    } else if (kind === 'mdx' && stack.length === 1 && (i === 0 || src[i - 1] === '\n') && /^(?:import|export)[\s{*]/.test(src.slice(i, i + 7))) {
      // An MDX import or export is script up to the next blank line, so its comments are comments.
      const blankLine = src.indexOf('\n\n', i);
      const stop = blankLine === -1 ? src.length : blankLine;
      const esm = lexScript(src.slice(i, stop), 'jsx');
      for (let k = 0; k < esm.masked.length; k++) {
        out[i + k] = esm.masked[k]!;
        if (esm.code[k] !== esm.masked[k]) notCode[i + k] = 1;
      }
      for (const s of esm.strings) strings.push({ ...s, open: s.open + i, close: s.close + i, runs: s.runs.map(([a, b]) => [a + i, b + i] as [number, number]) });
      i = stop;
    } else if (c === '`' && kind === 'mdx') {
      // MDX code is text: braces in it don't open an expression. A fence (three or more backticks
      // starting a line) runs to a line of at least as many. A code span closes on the next run of
      // exactly as many in its paragraph, and a run with none there is just a backtick.
      let n = 1;
      while (src[i + n] === '`') n++;
      const close = spanEnds.get(i) ?? -1;
      const end = n >= 3 && startsLine(src, i) ? fenceEnd(src, i, n) : close === -1 ? i + n : close + n;
      notCode.fill(1, i, end);
      i = end;
    } else notCode[i++] = 1;
  };

  let rereads = 0;
  for (;;) {
    while (i < src.length) {
      const top = stack.at(-1)!;
      const c = src[i]!;
      if (top.t === 'code') code(top, c);
      else if (top.t === 'tmpl') template(top, c);
      else if (top.t === 'tag') tag(top, c);
      else children(c);
    }
    // An element still open at the end was never one: read its `<` again as an operator or text.
    // After a few of these, give up on every open one at once, so nesting can't make it quadratic.
    const open = stack.filter((f): f is Tag => f.t === 'tag');
    if (open.length === 0) break;
    if (++rereads > 8) for (const t of open) notTag.add(t.at);
    rewind(rereads > 8 ? open[0]! : open.at(-1)!);
  }
  for (const f of stack) if (f.t === 'tmpl') f.span.runs.push([f.from, src.length]);
  const masked = out.join('');
  for (let k = 0; k < out.length; k++) if (notCode[k] && out[k] !== '\n') out[k] = ' ';
  return { masked, code: out.join(''), strings };
}

/** The key a string is the value of: `color: "red"`, `stroke="red"`, `fill={'red'}`. Reads back from the quote. */
export function keyBefore(masked: string, open: number): string | undefined {
  let j = open - 1;
  const skip = () => {
    while (j >= 0 && /\s/.test(masked[j]!)) j--;
  };
  skip();
  if (masked[j] === '{') {
    j--;
    skip();
  }
  const op = masked[j];
  if (op !== ':' && op !== '=') return undefined;
  if (op === '=' && /[=!<>]/.test(masked[j - 1] ?? '')) return undefined;
  j--;
  skip();
  const quote = masked[j] === '"' || masked[j] === "'" ? masked[j--] : '';
  const end = j + 1;
  while (j >= 0 && end - j < 64 && /[\w-]/.test(masked[j]!)) j--;
  if (quote && masked[j] !== quote) return undefined;
  const key = masked.slice(j + 1, end);
  return /^[A-Za-z]/.test(key) ? key : undefined;
}
