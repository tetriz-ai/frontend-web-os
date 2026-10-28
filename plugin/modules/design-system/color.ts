// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Colour parsing and WCAG contrast. Reads the forms design systems actually use: hex, rgb(),
// hsl(), oklch(), oklab() and DTCG colour objects (srgb, srgb-linear, hsl, oklch, oklab, display-p3).

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const NAMED: Record<string, Rgba> = {
  white: { r: 1, g: 1, b: 1, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
};

const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
function num(token: string, scale100 = 1): number {
  const t = token.trim();
  if (t === 'none') return 0;
  const percent = t.endsWith('%');
  const value = percent ? t.slice(0, -1) : t;
  if (!NUMERIC.test(value)) return Number.NaN;
  const n = Number(value);
  return percent ? (n / 100) * scale100 : n;
}

function hue(token: string): number {
  const m = /^(.*?)(turn|grad|rad|deg)?$/.exec(token.trim());
  if (!m || !NUMERIC.test(m[1]!)) return Number.NaN;
  const degrees = Number(m[1]) * ({ turn: 360, grad: 0.9, rad: 180 / Math.PI, deg: 1 }[m[2] ?? 'deg'] ?? 1);
  return ((degrees % 360) + 360) % 360;
}

function args(body: string): { parts: string[]; alpha: string | null } {
  if (body.split('/').length > 2 || /,\s*,|^\s*,|,\s*$/.test(body)) return { parts: [], alpha: null };
  const [main, alpha] = body.includes('/') ? body.split('/') : [body, null];
  const parts = main!.trim().split(/[\s,]+/).filter(Boolean);
  if (alpha === null && parts.length === 4) return { parts: parts.slice(0, 3), alpha: parts[3]! };
  return { parts, alpha: alpha?.trim() ?? null };
}

// After Björn Ottosson's OKLab reference code, Copyright (c) 2020 Björn Ottosson, public domain or
// MIT (see NOTICE): https://bottosson.github.io/posts/oklab/
export function oklabToRgb(L: number, a: number, b: number, alpha = 1): Rgba {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return {
    r: clamp01(fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp01(fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp01(fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
    a: alpha,
  };
}

export function rgbToOklch(c: Rgba): { l: number; c: number; h: number } {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

export function oklchToRgb(l: number, c: number, h: number, alpha = 1): Rgba {
  const rad = (h * Math.PI) / 180;
  return oklabToRgb(l, c * Math.cos(rad), c * Math.sin(rad), alpha);
}

function hslToRgb(h: number, s: number, l: number, a = 1): Rgba {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: clamp01(f(0)), g: clamp01(f(8)), b: clamp01(f(4)), a };
}

/** Parses a CSS colour string. Returns null for anything it doesn't understand. */
function parseCssColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (NAMED[s]) return { ...NAMED[s]! };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1]!;
    if (h.length <= 4) h = [...h].map((x) => x + x).join('');
    const v = (i: number) => Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: v(0), g: v(2), b: v(4), a: h.length === 8 ? v(6) : 1 };
  }
  const fn = /^(rgba?|hsla?|oklch|oklab)\((.*)\)$/.exec(s);
  if (!fn) return null;
  const { parts, alpha } = args(fn[2]!);
  if (parts.length !== 3) return null;
  const a = alpha === null ? 1 : clamp01(num(alpha));
  if (!Number.isFinite(a) || parts.some((part, i) => !Number.isFinite(i === (fn[1]!.startsWith('hsl') ? 0 : fn[1] === 'oklch' ? 2 : -1) ? hue(part) : num(part)))) return null;
  switch (fn[1]) {
    case 'rgb':
    case 'rgba':
      return { r: clamp01(num(parts[0]!, 255) / 255), g: clamp01(num(parts[1]!, 255) / 255), b: clamp01(num(parts[2]!, 255) / 255), a };
    case 'hsl':
    case 'hsla':
      return hslToRgb(hue(parts[0]!), clamp01(num(parts[1]!) / (parts[1]!.endsWith('%') ? 1 : 100)), clamp01(num(parts[2]!) / (parts[2]!.endsWith('%') ? 1 : 100)), a);
    case 'oklch':
      return oklchToRgb(num(parts[0]!), num(parts[1]!, 0.4), hue(parts[2]!), a);
    case 'oklab':
      return oklabToRgb(num(parts[0]!), num(parts[1]!, 0.4), num(parts[2]!, 0.4), a);
    default:
      return null;
  }
}

export function parseColor(input: string): Rgba | null {
  const color = parseCssColor(input);
  return color && Object.values(color).every(Number.isFinite) ? color : null;
}

const P3_TO_SRGB = [
  [1.2249401, -0.2249404, 0],
  [-0.0420569, 1.0420571, 0],
  [-0.0196376, -0.0786361, 1.0982735],
] as const;

/** A DTCG colour value: a string, or `{ colorSpace, components, alpha?, hex? }`. */
export function parseDtcgColor(value: unknown): Rgba | null {
  if (typeof value === 'string') return parseColor(value);
  if (!value || typeof value !== 'object') return null;
  const v = value as { colorSpace?: string; components?: unknown[]; alpha?: number; hex?: string };
  if (v.alpha !== undefined && (typeof v.alpha !== 'number' || !Number.isFinite(v.alpha))) return null;
  const alpha = v.alpha === undefined ? 1 : clamp01(v.alpha);
  if (v.components !== undefined && (!Array.isArray(v.components) || v.components.some((x) => x !== 'none' && (typeof x !== 'number' || !Number.isFinite(x))))) return null;
  const c = (v.components ?? []).map((x) => (x === 'none' ? 0 : x as number));
  if (c.length !== 3 || c.some((x) => !Number.isFinite(x))) {
    return typeof v.hex === 'string' ? withAlpha(parseColor(v.hex), alpha) : null;
  }
  const [x, y, z] = c as [number, number, number];
  switch (v.colorSpace) {
    case 'srgb':
      return { r: clamp01(x), g: clamp01(y), b: clamp01(z), a: alpha };
    case 'srgb-linear':
      return { r: clamp01(fromLinear(x)), g: clamp01(fromLinear(y)), b: clamp01(fromLinear(z)), a: alpha };
    case 'hsl':
      return hslToRgb(x, y / 100, z / 100, alpha);
    case 'oklch':
      return oklchToRgb(x, y, z, alpha);
    case 'oklab':
      return oklabToRgb(x, y, z, alpha);
    case 'display-p3': {
      const lin = [toLinear(x), toLinear(y), toLinear(z)];
      const m = (row: readonly number[]) => clamp01(fromLinear(row[0]! * lin[0]! + row[1]! * lin[1]! + row[2]! * lin[2]!));
      return { r: m(P3_TO_SRGB[0]), g: m(P3_TO_SRGB[1]), b: m(P3_TO_SRGB[2]), a: alpha };
    }
    default:
      return typeof v.hex === 'string' ? withAlpha(parseColor(v.hex), alpha) : null;
  }
}

function withAlpha(c: Rgba | null, a: number): Rgba | null {
  return c ? { ...c, a: c.a * a } : null;
}

export function toHex(c: Rgba): string {
  const h = (x: number) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a < 1 ? h(c.a) : ''}`;
}

/** Composites a translucent colour over an opaque background. */
export function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

export function luminance(c: Rgba): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** Contrast ratios are rounded to six decimal places. */
const RATIO_SCALE = 1e6;

/**
 * WCAG 2.x contrast ratio. Translucent colours are composited: `bg` over `canvas` (the surface it
 * sits on, white when not given), then `fg` over that. The ratio is rounded to six decimal places,
 * because V8 versions differ in the last bit of `**`: unrounded, the same pair came to 4.5 on Node
 * 24 and 4.499999999999999 on Node 22, so a pair at exactly 4.5:1 passed on one and failed on the
 * other. Six places is far finer than any visible difference and far coarser than that noise.
 */
export function contrast(fg: Rgba, bg: Rgba, canvas: Rgba = NAMED.white!): number {
  const ground = canvas.a < 1 ? over(canvas, NAMED.white!) : canvas;
  const base = bg.a < 1 ? over(bg, ground) : bg;
  const top = fg.a < 1 ? over(fg, base) : fg;
  const a = luminance(top);
  const b = luminance(base);
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * RATIO_SCALE) / RATIO_SCALE;
}

/** The colour as its hex writes it: each channel rounded to 8 bits. */
const eightBit = (c: Rgba): Rgba => {
  const q = (x: number) => Math.round(clamp01(x) * 255) / 255;
  return { r: q(c.r), g: q(c.g), b: q(c.b), a: c.a };
};

/**
 * The nearest shade of `fg` (same hue and chroma, moved in OKLCH lightness) that reaches
 * `target` against `bg` laid over `canvas`. Returns null if no lightness gets there. Each shade
 * is measured as its hex, rounded to 8 bits a channel, so the hex a finding suggests passes as
 * written: unrounded, about one suggestion in sixteen fell just short of 4.5:1.
 */
export function nearestPassing(fg: Rgba, bg: Rgba, target: number, canvas?: Rgba): Rgba | null {
  if (contrast(fg, bg, canvas) >= target) return fg;
  const { l, c, h } = rgbToOklch(fg);
  for (let step = 0.005; step <= 1; step += 0.005) {
    for (const next of [l - step, l + step]) {
      if (next < 0 || next > 1) continue;
      const cand = eightBit(oklchToRgb(next, c, h, 1));
      if (contrast(cand, bg, canvas) >= target) return cand;
    }
  }
  return null;
}
