// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Design Tokens Community Group (DTCG 2025.10) files: merging, `$type` inheritance, alias
// resolution and conversion to CSS values. Older string forms ("#fff", "4px") are accepted too.

import { parseDtcgColor, toHex } from './color.ts';

export interface Token {
  path: string;
  type?: string;
  value: unknown;
}

type Tree = Record<string, unknown>;

export function isTree(v: unknown): v is Tree {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merges token files; later files win. */
export function mergeTrees(trees: Tree[]): Tree {
  const out: Tree = {};
  for (const t of trees) mergeInto(out, t);
  return out;
}

function mergeInto(target: Tree, src: Tree): void {
  for (const [k, v] of Object.entries(src)) {
    const cur = target[k];
    if (isTree(v) && isTree(cur) && !('$value' in v)) mergeInto(cur, v);
    else target[k] = isTree(v) ? structuredClone(v) : v;
  }
}

/** Flattens a tree into tokens keyed by dotted path, applying inherited `$type`. */
export function flatten(tree: Tree): Map<string, Token> {
  const out = new Map<string, Token>();
  const walk = (node: Tree, path: string[], inherited?: string) => {
    const type = typeof node.$type === 'string' ? node.$type : inherited;
    if ('$value' in node) {
      out.set(path.join('.'), { path: path.join('.'), type, value: node.$value });
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$') || !isTree(v)) continue;
      walk(v, [...path, k], type);
    }
  };
  walk(tree, []);
  return out;
}

const ALIAS = /^\{([^{}]+)\}$/;

/** Resolves `{group.token}` aliases (also inside composite values). Unresolvable ones are reported. */
export function resolveAliases(tokens: Map<string, Token>): { tokens: Map<string, Token>; errors: string[] } {
  const errors: string[] = [];
  const resolved = new Map<string, Token>();
  const resolving = new Set<string>();
  const resolveValue = (v: unknown, from: string): unknown => {
    if (typeof v === 'string') {
      const m = ALIAS.exec(v);
      if (!m) return v;
      const target = resolveToken(m[1]!, from);
      return target?.value;
    }
    if (Array.isArray(v)) return v.map((x) => resolveValue(x, from));
    if (isTree(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveValue(x, from)]));
    return v;
  };
  const resolveToken = (path: string, from: string): Token | undefined => {
    const done = resolved.get(path);
    if (done) return done;
    const tok = tokens.get(path);
    if (!tok) {
      errors.push(`${from} refers to {${path}}, which doesn't exist`);
      return undefined;
    }
    if (resolving.has(path)) {
      errors.push(`alias cycle at {${path}}`);
      return undefined;
    }
    resolving.add(path);
    let type = tok.type;
    const m = typeof tok.value === 'string' ? ALIAS.exec(tok.value) : null;
    if (m && !type) type = tokens.get(m[1]!)?.type;
    const out: Token = { path, type, value: resolveValue(tok.value, path) };
    resolving.delete(path);
    resolved.set(path, out);
    return out;
  };
  for (const path of tokens.keys()) resolveToken(path, path);
  return { tokens: resolved, errors: [...new Set(errors)] };
}

function dimension(v: unknown): string | null {
  if (typeof v === 'number') return v === 0 ? '0' : `${v}px`;
  if (typeof v === 'string') return v;
  if (isTree(v) && typeof v.value === 'number' && typeof v.unit === 'string') return `${v.value}${v.unit}`;
  return null;
}

function fontFamily(v: unknown): string | null {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : null;
  if (!list) return null;
  return list
    .map((f) => String(f))
    .map((f) => (/^[\w-]+$/.test(f) || f.startsWith('"') || f.startsWith("'") ? f : `"${f}"`))
    .join(', ');
}

/** CSS text for a colour value: CSS strings stay as written, DTCG objects become oklch() or hex. */
export function colorCss(v: unknown): string | null {
  if (typeof v === 'string') return parseDtcgColor(v) ? v : null;
  if (!isTree(v)) return null;
  const c = parseDtcgColor(v);
  if (!c) return null;
  if (v.colorSpace === 'oklch' && Array.isArray(v.components)) {
    const [l, ch, h] = v.components as number[];
    return `oklch(${l} ${ch} ${h}${c.a < 1 ? ` / ${c.a}` : ''})`;
  }
  return toHex(c);
}

export interface CssDecl {
  /** Suffix appended to the slot's variable name (`-size`, `-line`, ...); empty for simple values. */
  suffix: string;
  value: string;
}

/** Converts a resolved token value of the given type to CSS declarations. Null when it can't. */
export function toCss(type: string, v: unknown): CssDecl[] | null {
  switch (type) {
    case 'color': {
      const c = colorCss(v);
      return c ? [{ suffix: '', value: c }] : null;
    }
    case 'dimension': {
      const d = dimension(v);
      return d ? [{ suffix: '', value: d }] : null;
    }
    case 'fontFamily': {
      const f = fontFamily(v);
      return f ? [{ suffix: '', value: f }] : null;
    }
    case 'duration': {
      const d = dimension(v);
      return d ? [{ suffix: '', value: typeof v === 'number' ? `${v}ms` : d }] : null;
    }
    case 'cubicBezier': {
      if (Array.isArray(v) && v.length === 4) return [{ suffix: '', value: `cubic-bezier(${v.join(', ')})` }];
      return typeof v === 'string' ? [{ suffix: '', value: v }] : null;
    }
    case 'typography': {
      if (!isTree(v)) return null;
      const out: CssDecl[] = [];
      const size = dimension(v.fontSize);
      if (!size) return null;
      out.push({ suffix: '-size', value: size });
      const line = typeof v.lineHeight === 'number' ? String(v.lineHeight) : dimension(v.lineHeight);
      if (line) out.push({ suffix: '-line', value: line });
      if (v.fontWeight !== undefined) out.push({ suffix: '-weight', value: String(v.fontWeight) });
      const tracking = dimension(v.letterSpacing);
      if (tracking) out.push({ suffix: '-tracking', value: tracking });
      return out;
    }
    case 'string':
      return typeof v === 'string' || typeof v === 'number' ? [{ suffix: '', value: String(v) }] : null;
    default:
      return null;
  }
}
