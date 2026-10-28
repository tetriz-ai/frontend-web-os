// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Input parsing for the calculator. Money is whole cents and percent is basis points, never floats.

export const MAX_AMOUNT_CENTS = 999_999_999;

/** True when `int` is 1-3 digits followed by groups of exactly 3, split by `sep`. */
function isGrouped(int: string, sep: string): boolean {
  const groups = int.split(sep);
  return /^\d{1,3}$/.test(groups[0] ?? '') && groups.slice(1).every((g) => /^\d{3}$/.test(g));
}

function toCents(int: string, frac: string): number | null {
  if (!/^\d+$/.test(int) || !/^\d{0,2}$/.test(frac)) return null;
  const cents = Number(int) * 100 + Number(frac.padEnd(2, '0'));
  return cents <= MAX_AMOUNT_CENTS ? cents : null;
}

/** Whole cents, or null when blank or invalid. Accepts "1,234.50", "1.234,50", "42,50", "$ 42.5". */
export function parseAmount(input: string): number | null {
  let s = input.replace(/\s/g, '');
  if (s.startsWith('$')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;

  const dots = s.split('.').length - 1;
  const commas = s.split(',').length - 1;

  if (dots > 0 && commas > 0) {
    // The later separator is the decimal point; the other groups thousands.
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    if ((dec === '.' ? dots : commas) !== 1) return null;
    const [int = '', frac = ''] = s.split(dec);
    if (frac === '' || !isGrouped(int, thou)) return null;
    return toCents(int.split(thou).join(''), frac);
  }

  const sep = dots > 0 ? '.' : commas > 0 ? ',' : null;
  if (sep === null) return toCents(s, '');
  const count = sep === '.' ? dots : commas;

  if (count > 1) {
    return isGrouped(s, sep) ? toCents(s.split(sep).join(''), '') : null;
  }

  const [int = '', frac = ''] = s.split(sep);
  // A lone comma before exactly 3 digits groups thousands; before 1-2 digits it is the decimal point.
  if (sep === ',' && frac.length === 3) return isGrouped(s, ',') ? toCents(int + frac, '') : null;
  if (frac === '') return null;
  return toCents(int, frac);
}

/** Basis points (hundredths of a percent), 0..10000, up to 2 decimals. */
export function parsePercent(input: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

/** Whole number of people, 1..50. */
export function parsePeople(input: string): number | null {
  const s = input.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 50 ? n : null;
}
