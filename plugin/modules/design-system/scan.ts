// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Finds raw design values in app source: colours, sizes, fonts and radii that bypass the slots.
// Every pattern here is linear in the length of the file: a class pattern only starts where a
// class does, and nothing looks back further than one bounded window.

import { type Finding, type StringSpan, keyBefore, lexFile, lexSource, sourceKind } from '../../kernel/index.ts';

/** The files the token scan reads. */
export const SCANNED_FILES = /\.(?:[cm]?[jt]sx?|css|scss|less|mdx)$/;

/** Tailwind's default palettes, as its theme.css names them (4.3 added mauve, olive, mist and taupe). */
const PALETTE =
  'slate|gray|zinc|neutral|stone|mauve|olive|mist|taupe|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOR_UTILS =
  'bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|fill|stroke|from|via|to|outline|decoration|divide|placeholder|accent|caret|shadow|inset-shadow|inset-ring|drop-shadow|text-shadow';
/** A colour function. CSS function names ignore case, so every pattern built on it takes the `i` flag. */
const COLOR_FN = '(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(';
const HEX = '#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})';
/** What a colour function's arguments start with, so prose such as "color(s)" isn't one. */
const FN_ARGS = '\\s*(?:[\\d.+-]|var\\(|calc\\(|\\$\\{|from[\\s_]|(?:srgb(?:-linear)?|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz(?:-d50|-d65)?)[\\s_])';

/** CSS named colours. `transparent` and `currentcolor` carry no colour of their own, so they're fine. */
const NAMED = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue ' +
    'chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey ' +
    'darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray ' +
    'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen ' +
    'fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen ' +
    'lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime ' +
    'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive ' +
    'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
    'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke ' +
    'yellow yellowgreen'
  ).split(' '),
);
/** A word in a value: not part of a path, a variable, a URL, a longer name or a function call. */
const WORD = /(?<![A-Za-z0-9./#$@-])[A-Za-z]+(?![A-Za-z0-9./(-])/g;
/** A CSS property or style key that takes a colour, with dashes removed and lower-cased. */
const COLOUR_KEY =
  /^(?:webkit)?(?:color|background(?:color)?|border(?:top|right|bottom|left|block|inline)?(?:start|end)?(?:color)?|outline(?:color)?|boxshadow|textshadow|textdecoration(?:color)?|textemphasiscolor|caretcolor|accentcolor|columnrule(?:color)?|fill|stroke|stopcolor|floodcolor|lightingcolor|scrollbarcolor|textfillcolor|textstroke(?:color)?|taphighlightcolor)$/;
const colourKey = (key: string) => COLOUR_KEY.test(key.toLowerCase().replace(/-/g, ''));
/**
 * Signs that a string is CSS, so a hex in it is a colour and not "Order #1234" or "#feed .item". A
 * percentage counts only right after a hex, as in a gradient stop, so "Order #1234 is 50% off" is prose.
 */
const CSS_CUE = new RegExp(`\\d(?:px|rem|em|vh|vw)\\b|${HEX}\\s+[\\d.]+%(?!\\w)|\\b(?:solid|dashed|dotted|double|groove|ridge|inset|outset)\\b|gradient\\(`);
const DECLARATION = /(?<![\w-])([a-z-]+)\s*:/gi;
const readsAsCss = (text: string) => CSS_CUE.test(text) || [...text.matchAll(DECLARATION)].some((d) => colourKey(d[1]!));
const MSG_JS = 'is a raw colour; use var(--ds-...) or a slot class';

/** Style and weight keywords a font shorthand may start with before its tokens: `600 var(--ds-...)`. */
const FONT_LEAD_RE = /^(?:(?:normal|italic|oblique|bold|bolder|lighter|small-caps|[1-9]00)\s+)*/i;
const CSS_WIDE = /^(?:inherit|initial|unset|revert|revert-layer)$/i;
/** The border-radius property and its longhands, such as border-top-left-radius. */
const CSS_RADIUS = /^(?:-(?:webkit|moz)-)?border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/;
const MSG_CSS_FONT = 'font is hard-coded; use var(--ds-type-<role>-size) and var(--ds-font-sans) or var(--ds-font-mono)';
const MSG_CSS_SIZE = 'font-size is hard-coded; use var(--ds-type-<role>-size)';
const MSG_CSS_FAMILY = 'font-family is hard-coded; use var(--ds-font-sans) or var(--ds-font-mono)';
/** A style object key, bare or in matching quotes: `fontSize`, `'fontSize'` or `"fontSize"`. The quote is group 1. */
const jsKey = (name: string) => `(['"]?)${name}\\1`;
/** A short hex in one of these is a fragment or a name, not a colour: `href="#add"`, `to: '#top'`. */
const NAME_KEYS = new Set(['href', 'to', 'id', 'key']);
const SHORT_HEX = /^.#[0-9a-fA-F]{3,4}.$/;

/** CSS functions that do arithmetic, so a token inside one is still a token. */
const MATH_FN = new Set(['calc', 'min', 'max', 'clamp']);
const FN_AT = /([a-z][a-z-]*)\(/iy;
/** A CSS number, with its unit (group 1) when it has one. */
const NUMBER_AT = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(%|[a-z]+)?/iy;
const PROPERTY_AT = /--[\w-]*/y;
const KEYWORD_AT = /[a-z-]+/iy;
/** A number in script, such as `14` or `.875`. */
const JS_NUMBER = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/y;

/**
 * The end of one token term that starts at `i`, or -1 when none does. A term is a var(), whose
 * fallback, when it has one, holds only tokens too; arithmetic on var()s and plain numbers in
 * calc(), min(), max() or clamp(); or a zero where `zero` is set. A length of its own, a keyword or
 * any other function is raw. A loop with its own stack, not recursion, so deep nesting can't
 * overflow it, and it reads each character once.
 */
function termEnd(value: string, i: number, zero: boolean): number {
  const stack: ('name' | 'fallback' | 'math')[] = [];
  let j = i;
  while (j < value.length) {
    const top = stack.at(-1);
    const c = value[j]!;
    if (top && /\s/.test(c)) {
      j++;
      continue;
    }
    if (top !== 'name') {
      FN_AT.lastIndex = j;
      const fn = FN_AT.exec(value);
      if (fn) {
        const name = fn[1]!.toLowerCase();
        if (name === 'var') stack.push('name');
        else if (MATH_FN.has(name)) stack.push('math');
        else return -1;
        j = FN_AT.lastIndex;
        continue;
      }
    }
    if (top && c === ')') {
      stack.pop();
      j++;
      if (stack.length === 0) return j;
      continue;
    }
    if (top === 'name') {
      PROPERTY_AT.lastIndex = j;
      if (PROPERTY_AT.test(value)) j = PROPERTY_AT.lastIndex;
      else if (c === ',') {
        stack[stack.length - 1] = 'fallback';
        j++;
      } else return -1;
      continue;
    }
    if (top === 'math' && c === '(') {
      stack.push('math');
      j++;
      continue;
    }
    // An operator or a separator, unless it is the sign of the number after it.
    const operator = top === 'math' ? '+-*/,' : top === 'fallback' ? ',/' : '';
    if (operator.includes(c) && !('+-'.includes(c) && /[\d.]/.test(value[j + 1] ?? ''))) {
      j++;
      continue;
    }
    NUMBER_AT.lastIndex = j;
    const n = NUMBER_AT.exec(value);
    if (n) {
      const end = NUMBER_AT.lastIndex;
      if (/[\w.(]/.test(value[end] ?? '')) return -1;
      // A zero is no length of its own, and a plain number in arithmetic only scales a token.
      const ok = Number.parseFloat(n[0]) === 0 ? zero || top !== undefined : top === 'math' && n[1] === undefined;
      if (!ok) return -1;
      if (!top) return end;
      j = end;
      continue;
    }
    if (top === 'fallback') {
      KEYWORD_AT.lastIndex = j;
      const k = KEYWORD_AT.exec(value);
      if (k && CSS_WIDE.test(k[0])) {
        j = KEYWORD_AT.lastIndex;
        continue;
      }
    }
    return -1;
  }
  return -1;
}

/**
 * Whether all of a CSS value comes from tokens: one CSS-wide keyword, or up to `max` token terms
 * (see termEnd) apart by spaces or slashes. So `var(--r) 4px` and `calc(var(--r) + 4px)` are raw:
 * the 4px is a value of its own. An empty value sets nothing, so it is fine.
 */
function tokenOnly(value: string, zero: boolean, max = Number.POSITIVE_INFINITY): boolean {
  const v = value.trim();
  if (v === '' || CSS_WIDE.test(v)) return true;
  let terms = 0;
  for (let i = 0; i < v.length; ) {
    const end = termEnd(v, i, zero);
    if (end === -1 || ++terms > max) return false;
    i = end;
    const gap = i;
    while (i < v.length && (/\s/.test(v[i]!) || v[i] === '/')) i++;
    if (i === gap && i < v.length) return false;
  }
  return true;
}

/**
 * Whether a font shorthand takes its size and family from tokens: style and weight keywords, a
 * token size, an optional `/line-height`, then a token family, and nothing after it. One var()
 * can hold the whole shorthand.
 */
function fontFromTokens(value: string): boolean {
  const v = value.trim();
  if (v === '' || CSS_WIDE.test(v)) return true;
  let i = termEnd(v, FONT_LEAD_RE.exec(v)![0].length, false);
  if (i === -1) return false;
  const ws = () => {
    while (i < v.length && /\s/.test(v[i]!)) i++;
  };
  ws();
  if (v[i] === '/') {
    // The line height isn't a token concern: a token, or a plain value such as 1.5.
    i++;
    ws();
    const end = termEnd(v, i, false);
    if (end !== -1) i = end;
    else while (i < v.length && !/\s/.test(v[i]!)) i++;
    ws();
  }
  if (i === v.length) return true;
  i = termEnd(v, i, false);
  if (i === -1) return false;
  ws();
  return i === v.length;
}

/** The value of a Tailwind arbitrary class, with `_` read as a space: `text-[length:1.5rem]` gives `1.5rem`. */
const arbitraryValue = (cls: string) => cls.slice(cls.indexOf('[') + 1, -1).replace(/^length:/, '').replace(/_/g, ' ');

/** What a rule's `keep` can read besides its match. */
interface Scan {
  src: string;
  masked: string;
  /** Each string literal by the offset of its opening quote. */
  stringAt: Map<number, StringSpan>;
}

/** Whether a string's text is all written out: no `${...}` in it, which is a runtime value. */
const literal = (s: StringSpan) => s.closed && s.runs.length === 1 && s.runs[0]![0] === s.open + 1 && s.runs[0]![1] === s.close;

/**
 * Keeps a style key whose value is raw: a string that isn't all tokens (`tokens` says), or a
 * number that `rawNumber` calls raw. Anything else, such as a variable, is a runtime value.
 */
const rawStyle =
  (tokens: (value: string) => boolean, rawNumber: (n: number) => boolean) =>
  (m: RegExpExecArray, scan: Scan): boolean => {
    const at = m.index + m[0].length;
    const s = scan.stringAt.get(at);
    // `font: 'sans' | 'mono'` is a type: a list of names, not a value in use.
    if (s) return literal(s) && !unionMember(scan.masked, s) && !tokens(scan.src.slice(s.open + 1, s.close));
    JS_NUMBER.lastIndex = at;
    const n = JS_NUMBER.exec(scan.masked);
    return n !== null && rawNumber(Number(n[0]));
  };

/** A class with any variant prefix (`hover:`, `md:`) kept in the match. */
const classRe = (core: string) => new RegExp(`(?<![\\w:-])(?:[\\w-]+:)*${core}|(?<=:)${core}`, 'g');

interface Rule {
  rule: string;
  re: RegExp;
  message: (m: RegExpExecArray) => string;
  css?: boolean;
  js?: boolean;
  /** Keeps only the matches this says are raw, when the pattern alone can't tell. */
  keep?: (m: RegExpExecArray, scan: Scan) => boolean;
}

/** A colour of Tailwind's default palette: `red-500`, `white`. */
const PALETTE_COLOUR = `(?:(?:${PALETTE})-(?:50|[1-9]00|950)|white|black)(?![\\w-])`;
const MSG_PALETTE = "uses Tailwind's default palette; use a slot colour";

const PALETTE_RULES: Rule[] = [
  {
    rule: 'palette-class',
    re: classRe(`(?:${COLOR_UTILS})-${PALETTE_COLOUR}`),
    message: (m) => `"${m[0]}" ${MSG_PALETTE} (bg-surface, text-fg, bg-brand, text-critical...)`,
    js: true,
    css: true,
  },
  {
    // The same colours through their theme variables: `bg-(--color-red-500)` is Tailwind 4's short form of `bg-[var(--color-red-500)]`.
    rule: 'palette-class',
    re: classRe(`(?:${COLOR_UTILS})-\\((?:color:)?--color-${PALETTE_COLOUR}\\)`),
    message: (m) => `"${m[0]}" ${MSG_PALETTE} (bg-surface, text-fg, bg-brand, text-critical...)`,
    js: true,
    css: true,
  },
  {
    // var() anywhere (`_` is a space in an arbitrary value), Tailwind's --theme() and theme() in CSS,
    // and theme()'s older dotted path.
    rule: 'palette-var',
    re: new RegExp(`(?<![A-Za-z0-9-])(var|--theme|theme)\\(\\s*(--color-${PALETTE_COLOUR}|['"]?colors\\.(?:(?:${PALETTE})\\.(?:50|[1-9]00|950)|white|black)(?![\\w.-]))`, 'g'),
    message: (m) => `${m[1]}(${m[2]!.replace(/^['"]/, '')}) ${MSG_PALETTE} (var(--ds-...), or a class such as bg-surface or text-fg)`,
    js: true,
    css: true,
  },
];

const RULES: Rule[] = [
  {
    rule: 'raw-size',
    re: classRe('text-(?:xs|sm|base|lg|[2-9]?xl)(?![\\w-])'),
    message: (m) => `"${m[0]}" is a raw font size; use a type role (text-body, text-label, text-heading...)`,
    js: true,
    css: true,
  },
  {
    rule: 'raw-size',
    // Tailwind's `length:` hint (`text-[length:14px]`) marks the value as a size, and so does a
    // number, a sum or a var() whose fallback is a number. Arithmetic on a token, such as
    // `text-[calc(var(--ds-type-body-size)*2)]`, is fine. `text-[var(--x)]` alone reads as a colour.
    re: classRe('(?:text|leading|tracking)-\\[(?:length:[^\\]\\n]{1,200}|(?:[\\d.]|(?:calc|clamp|min|max)\\(|var\\(--[\\w-]*,_?[\\d.])[^\\]\\n]{0,200})\\]'),
    keep: (m) => !tokenOnly(arbitraryValue(m[0]), false, 1),
    message: (m) => `"${m[0]}" hard-codes a type size; use a type role`,
    js: true,
    css: true,
  },
  {
    // Style objects: a string value is read as the CSS it sets, so all of it must be tokens.
    rule: 'raw-size',
    re: new RegExp(`(?<![\\w$.-])${jsKey('fontSize')}\\s*:\\s*`, 'g'),
    keep: rawStyle((v) => tokenOnly(v, false, 1), () => true),
    message: () => 'fontSize is hard-coded; use a type role class',
    js: true,
  },
  {
    rule: 'raw-font',
    re: new RegExp(`(?<![\\w$.-])${jsKey('fontFamily')}\\s*:\\s*`, 'g'),
    keep: rawStyle((v) => tokenOnly(v, false, 1), () => false),
    message: () => 'fontFamily is hard-coded; use font-sans or font-mono',
    js: true,
  },
  {
    rule: 'raw-radius',
    re: classRe('rounded(?:-[trblse]{1,2})?-(?:\\[[^\\]\\n]{1,200}\\]|xs|xl|[2-4]xl)(?![\\w-])'),
    message: (m) => `"${m[0]}" isn't on the radius ladder; use rounded-sm, rounded-md, rounded-lg or rounded-full`,
    js: true,
    css: true,
  },
  {
    rule: 'raw-radius',
    re: new RegExp(`(?<![\\w$.-])${jsKey('((?:Webkit|Moz)?[Bb]order(?:Top|Bottom|Start|End)?(?:Left|Right|Start|End)?Radius)')}\\s*:\\s*`, 'g'),
    keep: rawStyle((v) => tokenOnly(v, true), (n) => n !== 0),
    message: (m) => `${m[2]} is hard-coded; use rounded-sm, rounded-md, rounded-lg or rounded-full`,
    js: true,
  },
  {
    rule: 'raw-font',
    // Tailwind reads a number in `font-[...]` as a weight, so only a family name counts: written out,
    // or as a var() fallback. `font-[--x]` is a variable.
    re: classRe('font-\\[(?![\\d.]|--|weight:|number:)[^\\]\\n]{1,200}\\]'),
    keep: (m) => {
      const value = arbitraryValue(m[0]).replace(/^family-name:/, '');
      return !tokenOnly(value, false, 1) && !/^var\(--[\w-]*\s*,\s*[\d.]/.test(value);
    },
    message: (m) => `"${m[0]}" hard-codes a font; use font-sans or font-mono`,
    js: true,
    css: true,
  },
  {
    rule: 'raw-font',
    re: new RegExp(`(?<![\\w$.-])${jsKey('font')}\\s*:\\s*`, 'g'),
    keep: rawStyle(fontFromTokens, () => false),
    message: () => 'font is hard-coded; use a type role class and font-sans or font-mono',
    js: true,
  },
];

/** A Tailwind arbitrary value, such as `text-[#1f2937]` or `shadow-[0_1px_2px_rgba(0,0,0,.5)]`. */
const ARBITRARY = /(?<![\w-])([\w-]+)-\[([^\]\n]{1,500})\]/g;
const ARBITRARY_START = new RegExp(`^(?:#[0-9a-fA-F]{3,8}|${COLOR_FN})`, 'i');
const ARBITRARY_HEX = new RegExp(`(?<=^|[\\s_,(:])(?<!url\\()${HEX}(?=$|[\\s_,)/])`);
const ARBITRARY_FN = new RegExp(`(?<![A-Za-z0-9-])${COLOR_FN}${FN_ARGS}`, 'i');
const IS_COLOR_UTIL = new RegExp(`^(?:${COLOR_UTILS})$`);

/** A string that is one hex colour, or starts with a colour function: one finding for the whole string. */
const WHOLE_HEX = new RegExp(`^(['"\`])${HEX}\\1$`);
const WHOLE_FN = new RegExp(`^(['"\`])\\s*${COLOR_FN}[^'"\`]*\\1$`, 'i');
const STRING_COLOUR = new RegExp(`(?<=^|[\\s(,:\\[_{])(?<!url\\()${HEX}(?=$|[\\s,);!\\]_}])|(?<![\\w-])${COLOR_FN}${FN_ARGS}`, 'gi');

const CSS_COLOUR = new RegExp(`#[0-9a-fA-F]{3,8}(?![\\w-])|${COLOR_FN}`, 'gi');
const CSS_VALUE = /:[^;{}]*/g;

/** The exception markers. They count only in comment text, so a string that mentions one isn't one. */
const IGNORE = /fwos-ignore(?:-next-line)?\s+tokens/g;
const IGNORE_NEXT = /fwos-ignore-next-line\s+tokens/g;

interface Hit {
  at: number;
  rule: string;
  message: string;
}

/** Whether `at` falls in one of `spans`, sorted [start, end) pairs that don't overlap. */
function within(spans: readonly (readonly [number, number])[], at: number): boolean {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = spans[mid]!;
    if (at < a) hi = mid - 1;
    else if (at >= b) lo = mid + 1;
    else return true;
  }
  return false;
}

const preview = (lit: string) => (lit.length > 48 ? `${lit.slice(0, 45)}...` : lit);
const fnName = (m: string) => `${/^[a-z]+/i.exec(m)![0]}()`;

/** Decode written colour literals without evaluating expressions or changing source delimiters. */
function decodedSource(src: string, css: boolean, strings: StringSpan[], masked: string): { text: string; offsets: number[] } {
  const runs = strings.flatMap((span) => span.runs).sort((a, b) => a[0] - b[0]);
  const offsets: number[] = [];
  const slash = String.fromCharCode(92);
  const cssEscape = new RegExp("^\\\\([0-9a-f]{1,6})(?:\\r\\n|[\\t\\n\\r\\f ])?", 'i');
  const jsEscape = new RegExp("^\\\\(?:u\\{([0-9a-f]{1,6})\\}|u([0-9a-f]{4})|x([0-9a-f]{2}))", 'i');
  let text = '';
  for (let i = 0; i < src.length;) {
    const start = i;
    const inLiteral = css ? masked[i] === src[i] : within(runs, i);
    let part: string | undefined;
    if (src[i] === slash && src[i + 1] === slash) {
      text += src.slice(i, i + 2);
      offsets.push(i, i + 1);
      i += 2;
      continue;
    }
    if (inLiteral && src[i] === slash) {
      const match = (css ? cssEscape : jsEscape).exec(src.slice(i));
      if (match) {
        const point = Number.parseInt(match[1] ?? match[2] ?? match[3]!, 16);
        if (point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) && ![92,39,34,96,10,13,47,123,125,36,42].includes(point)) {
          part = String.fromCodePoint(point);
          i += match[0].length;
        }
      }
    }
    part ??= src[i++]!;
    text += part;
    for (let j = 0; j < part.length; j++) offsets.push(start);
  }
  return { text, offsets };
}

export function scanRawValues(file: string, src: string): Finding[] {
  const kind = sourceKind(file) ?? 'js';
  const css = kind === 'css';
  const original = src;
  const initial = lexFile(file, src) ?? lexSource(src, kind);
  const decoded = decodedSource(src, css, initial.strings, initial.masked);
  src = decoded.text;
  const { strings, masked } = lexFile(file, src) ?? lexSource(src, kind);
  const scan: Scan = { src, masked, stringAt: new Map(strings.map((s) => [s.open, s])) };
  const hits: Hit[] = [];
  const run = (r: Rule) => {
    r.re.lastIndex = 0;
    for (const m of masked.matchAll(r.re)) if (!r.keep || r.keep(m, scan)) hits.push({ at: m.index, rule: r.rule, message: r.message(m) });
  };

  for (const r of PALETTE_RULES) run(r);

  const claimed: [number, number][] = [];
  for (const m of masked.matchAll(ARBITRARY)) {
    const whole = m[0];
    const util = m[1]!;
    const value = m[2]!;
    const named = IS_COLOR_UTIL.test(util) && [...value.matchAll(WORD)].some((w) => NAMED.has(w[0].toLowerCase()));
    if (!ARBITRARY_START.test(value) && !ARBITRARY_HEX.test(value) && !ARBITRARY_FN.test(value) && !named) continue;
    claimed.push([m.index, m.index + whole.length]);
    hits.push({ at: m.index, rule: 'raw-color', message: `"${whole}" hard-codes a colour; use a slot colour class` });
  }
  const isClaimed = (at: number) => within(claimed, at);

  if (css) hits.push(...cssColours(masked, isClaimed));
  else hits.push(...stringColours(src, masked, strings, isClaimed));

  for (const r of RULES) if (css ? r.css : r.js) run(r);
  if (css) hits.push(...cssDeclarations(masked));
  return toFindings(file, original, initial.masked, hits.map((hit) => ({ ...hit, at: decoded.offsets[hit.at] ?? hit.at })));
}

/** Colours in string literals: a whole-string colour, then colours inside longer strings. */
function stringColours(src: string, masked: string, strings: StringSpan[], isClaimed: (at: number) => boolean): Hit[] {
  const whole: Hit[] = [];
  const fns: Hit[] = [];
  const inside: Hit[] = [];
  for (const s of strings) {
    if (!s.closed) continue;
    const lit = src.slice(s.open, s.close + 1);
    if (WHOLE_HEX.test(lit)) {
      if (SHORT_HEX.test(lit) && NAME_KEYS.has(keyBefore(masked, s.open) ?? '')) continue;
      whole.push({ at: s.open, rule: 'raw-color', message: `${lit} ${MSG_JS}` });
      continue;
    }
    if (WHOLE_FN.test(lit)) {
      fns.push({ at: s.open, rule: 'raw-color', message: `${lit} ${MSG_JS}` });
      continue;
    }
    const key = keyBefore(masked, s.open);
    const forColour = key !== undefined && colourKey(key);
    const text = src.slice(s.open + 1, s.close);
    let css: boolean | undefined;
    const inRun = (at: number) => within(s.runs, at) && !isClaimed(at);
    for (const m of text.matchAll(STRING_COLOUR)) {
      const at = s.open + 1 + m.index;
      if (!inRun(at)) continue;
      if (m[0].startsWith('#')) {
        if (!(css ??= forColour || readsAsCss(text))) continue;
        inside.push({ at, rule: 'raw-color', message: `${m[0]} in ${preview(lit)} ${MSG_JS}` });
      } else {
        inside.push({ at, rule: 'raw-color', message: `${fnName(m[0])} in ${preview(lit)} ${MSG_JS}` });
      }
    }
    if (!forColour || unionMember(masked, s)) continue;
    if (NAMED.has(text.trim().toLowerCase()) && inRun(s.open + 1)) {
      whole.push({ at: s.open, rule: 'raw-color', message: `${lit} ${MSG_JS}` });
      continue;
    }
    for (const w of text.matchAll(WORD)) {
      const at = s.open + 1 + w.index;
      if (NAMED.has(w[0].toLowerCase()) && inRun(at)) inside.push({ at, rule: 'raw-color', message: `${w[0]} in ${preview(lit)} ${MSG_JS}` });
    }
  }
  return [...whole, ...fns, ...inside];
}

/** `'red' | 'blue'` in a type is a list of names, not a colour in use. */
function unionMember(masked: string, s: StringSpan): boolean {
  return /^\s*\|/.test(masked.slice(s.close + 1, s.close + 20)) || /\|\s*$/.test(masked.slice(Math.max(0, s.open - 20), s.open));
}

/** Colours in CSS declaration values. Only configured token files are exempted by the calling check. */
function cssColours(masked: string, isClaimed: (at: number) => boolean): Hit[] {
  const out: Hit[] = [];
  const named: Hit[] = [];
  for (const v of masked.matchAll(CSS_VALUE)) {
    let start = v.index;
    while (start > 0 && !';{}'.includes(masked[start - 1]!)) start--;
    const prop = masked.slice(start, v.index).trim();
    for (const m of v[0].matchAll(CSS_COLOUR)) {
      const at = v.index + m.index;
      if (!isClaimed(at)) out.push({ at, rule: 'raw-color', message: `${m[0].replace(/\($/, '()')} is a raw colour in CSS; use var(--ds-...)` });
    }
    if (!colourKey(prop)) continue;
    for (const w of v[0].matchAll(WORD)) {
      const at = v.index + w.index;
      if (NAMED.has(w[0].toLowerCase()) && !isClaimed(at)) named.push({ at, rule: 'raw-color', message: `${w[0]} is a raw colour in CSS; use var(--ds-...)` });
    }
  }
  return [...out, ...named];
}

/**
 * Raw radii, font sizes and fonts in CSS declarations: a value counts as tokens only when all of
 * it does (see tokenOnly). Property names ignore case, so FONT-SIZE is font-size. Custom
 * properties are the token layer's job.
 */
function cssDeclarations(masked: string): Hit[] {
  const out: Hit[] = [];
  for (const v of masked.matchAll(CSS_VALUE)) {
    // `a:hover {` is a selector, not a declaration.
    if (masked[v.index + v[0].length] === '{') continue;
    let start = v.index;
    while (start > 0 && !';{}'.includes(masked[start - 1]!)) start--;
    const before = masked.slice(start, v.index);
    const prop = before.trim().toLowerCase();
    const at = start + before.length - before.trimStart().length;
    const value = v[0].slice(1).replace(/!\s*important\s*$/i, '').trim();
    if (CSS_RADIUS.test(prop)) {
      if (!tokenOnly(value, true)) out.push({ at, rule: 'raw-radius', message: `${prop} is hard-coded; use var(--ds-radius-<size>)` });
    } else if (prop === 'font') {
      if (!fontFromTokens(value)) out.push({ at, rule: 'raw-font', message: MSG_CSS_FONT });
    } else if (prop === 'font-size') {
      if (!tokenOnly(value, false, 1)) out.push({ at, rule: 'raw-size', message: MSG_CSS_SIZE });
    } else if (prop === 'font-family') {
      if (!tokenOnly(value, false, 1)) out.push({ at, rule: 'raw-font', message: MSG_CSS_FAMILY });
    }
  }
  return out;
}

function toFindings(file: string, src: string, masked: string, hits: Hit[]): Finding[] {
  const starts = [0];
  for (let i = src.indexOf('\n'); i !== -1; i = src.indexOf('\n', i + 1)) starts.push(i + 1);
  const lineAt = (at: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const text = (line: number) => src.slice(starts[line - 1] ?? src.length, (starts[line] ?? src.length + 1) - 1);
  // The lexer blanks comments, so a marker is in a comment where the masked text differs from the source.
  const marked = (line: number, re: RegExp) => {
    const from = starts[line - 1]!;
    for (const m of text(line).matchAll(re)) if (masked[from + m.index] !== src[from + m.index]) return true;
    return false;
  };
  const ignored = new Map<number, boolean>();
  const isIgnored = (line: number) => {
    if (!ignored.has(line)) ignored.set(line, marked(line, IGNORE) || (line > 1 && marked(line - 1, IGNORE_NEXT)));
    return ignored.get(line)!;
  };
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const line = lineAt(h.at);
    if (isIgnored(line)) continue;
    const key = `${h.at}:${h.rule}:${h.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ file, line, rule: h.rule, message: h.message });
  }
  return findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}
