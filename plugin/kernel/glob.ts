// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// A small glob matcher: `**`, `*`, `?`, `{a,b}` and `[abc]`. Paths are posix, relative,
// with no leading `./`. Enough for config globs; no dependency needed.

const cache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const hit = cache.get(glob);
  if (hit) return hit;
  const re = new RegExp(`^${translate(normalize(glob))}$`);
  cache.set(glob, re);
  return re;
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function translate(glob: string): string {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i]!;
    if (c === '/' && glob.slice(i) === '/**') {
      out += '(?:/.*)?';
      break;
    }
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const atStart = i === 0 || glob[i - 1] === '/';
        const atEnd = i + 2 === glob.length || glob[i + 2] === '/';
        if (atStart && atEnd) {
          if (glob[i + 2] === '/') {
            out += '(?:.*/)?';
            i += 3;
          } else {
            out += '.*';
            i += 2;
          }
          continue;
        }
        out += '[^/]*';
        i += 2;
        continue;
      }
      out += '[^/]*';
      i += 1;
    } else if (c === '?') {
      out += '[^/]';
      i += 1;
    } else if (c === '{') {
      const close = findClose(glob, i);
      if (close === -1) {
        out += '\\{';
        i += 1;
        continue;
      }
      const parts = splitTop(glob.slice(i + 1, close));
      out += `(?:${parts.map(translate).join('|')})`;
      i = close + 1;
    } else if (c === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close === -1) {
        out += '\\[';
        i += 1;
        continue;
      }
      let body = glob.slice(i + 1, close);
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      out += `[${body.replace(/\\/g, '\\\\')}]`;
      i = close + 1;
    } else {
      out += /[.+^$()|\\]/.test(c) ? `\\${c}` : c;
      i += 1;
    }
  }
  return out;
}

function findClose(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    else if (s[i] === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

export function matchGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(normalize(path));
}

export function matchAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => matchGlob(path, g));
}
