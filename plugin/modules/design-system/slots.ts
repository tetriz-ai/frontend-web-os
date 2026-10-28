// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The design-system contract: the slots fwos reads (knowledge/slots.md). The contract ships
// with fwos; the values are the user's. A slot maps to a token path in the user's DTCG files
// (`design-system.json` `slots` can rename it), so token names can differ between systems.
//
// required: needed to start.  default: has a fallback.  optional: blank turns its check off.

export type SlotLevel = 'required' | 'default' | 'optional';
export type SlotType = 'color' | 'dimension' | 'fontFamily' | 'typography' | 'duration' | 'cubicBezier' | 'string';

export interface SlotDef {
  id: string;
  contract: string;
  type: SlotType;
  level: SlotLevel;
  /** Default token path in the user's files. */
  token: string;
  /** Fallback when the slot is blank: another slot (`@surface.subtle`) or a literal value. */
  fallback?: string | Record<string, string | number>;
  /** Tailwind v4 theme variable(s) this slot becomes, without the leading `--`. */
  tailwind?: string;
}

const color = (id: string, contract: string, level: SlotLevel, tailwind?: string, fallback?: string): SlotDef => ({
  id,
  contract,
  type: 'color',
  level,
  token: `color.${id}`,
  ...(tailwind ? { tailwind } : {}),
  ...(fallback ? { fallback } : {}),
});

const TYPE_ROLES: [string, string, number, string][] = [
  ['display', '2.25rem', 600, '2.5rem'],
  ['title', '1.5rem', 600, '2rem'],
  ['heading', '1.125rem', 600, '1.75rem'],
  ['subheading', '1rem', 500, '1.5rem'],
  ['body', '0.875rem', 400, '1.25rem'],
  ['body-strong', '0.875rem', 600, '1.25rem'],
  ['label', '0.8125rem', 500, '1.125rem'],
  ['caption', '0.75rem', 400, '1rem'],
  ['overline', '0.6875rem', 600, '1rem'],
  ['code', '0.8125rem', 400, '1.25rem'],
  ['metric', '1.875rem', 600, '2.25rem'],
];

export const SLOTS: SlotDef[] = [
  // C3 surfaces
  color('surface.base', 'C3', 'required', 'color-surface'),
  color('surface.elevated', 'C3', 'required', 'color-surface-elevated'),
  color('surface.subtle', 'C3', 'required', 'color-surface-subtle'),
  color('surface.interactive', 'C3', 'required', 'color-surface-interactive'),
  // C4 text
  color('text.primary', 'C4', 'required', 'color-fg'),
  color('text.secondary', 'C4', 'required', 'color-fg-secondary'),
  color('text.muted', 'C4', 'required', 'color-fg-muted'),
  color('text.disabled', 'C4', 'required', 'color-fg-disabled'),
  color('text.inverted', 'C4', 'required', 'color-fg-inverted'),
  // C5 borders
  color('border.faint', 'C5', 'required', 'color-border-faint'),
  color('border.default', 'C5', 'required', 'color-border'),
  // C6 brand
  color('brand.primary', 'C6', 'required', 'color-brand'),
  color('brand.primary-foreground', 'C6', 'required', 'color-on-brand'),
  color('brand.primary-hover', 'C6', 'default', 'color-brand-hover', '@brand.primary'),
  color('brand.accent', 'C6', 'required', 'color-accent'),
  color('brand.accent-foreground', 'C6', 'required', 'color-on-accent'),
  // C7 states
  color('state.hover', 'C7', 'default', 'color-hover', '@surface.subtle'),
  color('state.selected', 'C7', 'default', 'color-selected', '@surface.interactive'),
  color('state.disabled', 'C7', 'default', 'color-disabled', '@surface.subtle'),
  color('state.overlay', 'C7', 'default', 'color-overlay', 'rgb(0 0 0 / 0.5)'),
  color('state.focus', 'C7', 'default', 'color-focus', '@brand.primary'),
  // C8 status pairs
  ...['critical', 'warning', 'caution', 'info', 'success'].flatMap((s) => [
    color(`status.${s}.bg`, 'C8', 'required', `color-${s}-bg`),
    color(`status.${s}.text`, 'C8', 'required', `color-${s}`),
  ]),
  // C9 chart palette, kept apart from UI colours
  ...['1', '2', '3', '4', 'other'].map((n) => color(`chart.${n}`, 'C9', 'optional', `color-chart-${n}`)),
  // C10 radius ladder
  ...['sm', 'md', 'lg'].map<SlotDef>((r) => ({ id: `radius.${r}`, contract: 'C10', type: 'dimension', level: 'required', token: `radius.${r}`, tailwind: `radius-${r}` })),
  { id: 'radius.full', contract: 'C10', type: 'dimension', level: 'default', token: 'radius.full', tailwind: 'radius-full', fallback: '9999px' },
  // C11 fonts and type roles
  { id: 'font.sans', contract: 'C11', type: 'fontFamily', level: 'required', token: 'font.sans', tailwind: 'font-sans' },
  { id: 'font.mono', contract: 'C11', type: 'fontFamily', level: 'required', token: 'font.mono', tailwind: 'font-mono' },
  ...TYPE_ROLES.map<SlotDef>(([role, size, weight, line]) => ({
    id: `type.${role}`,
    contract: 'C11',
    type: 'typography',
    level: 'default',
    token: `type.${role}`,
    tailwind: `text-${role}`,
    fallback: { fontSize: size, fontWeight: weight, lineHeight: line },
  })),
  // C12 motion
  { id: 'motion.fast', contract: 'C12', type: 'duration', level: 'default', token: 'motion.fast', fallback: '120ms' },
  { id: 'motion.normal', contract: 'C12', type: 'duration', level: 'default', token: 'motion.normal', fallback: '200ms' },
  { id: 'motion.slow', contract: 'C12', type: 'duration', level: 'default', token: 'motion.slow', fallback: '320ms' },
  { id: 'motion.easing', contract: 'C12', type: 'cubicBezier', level: 'default', token: 'motion.easing', tailwind: 'ease-standard', fallback: 'cubic-bezier(0.2, 0, 0, 1)' },
  // C13 minimum sizes
  { id: 'size.hit-target', contract: 'C13', type: 'dimension', level: 'default', token: 'size.hit-target', fallback: '24px' },
  { id: 'size.text-min', contract: 'C13', type: 'dimension', level: 'default', token: 'size.text-min', fallback: '12px' },
  // C15 locale
  { id: 'locale.default', contract: 'C15', type: 'string', level: 'default', token: 'locale.default', fallback: 'en' },
  { id: 'locale.date-style', contract: 'C15', type: 'string', level: 'default', token: 'locale.date-style', fallback: 'medium' },
];

export const slot = (id: string): SlotDef | undefined => SLOTS.find((s) => s.id === id);

/** CSS custom property for a slot: `surface.base` -> `--ds-surface-base`. */
export const cssVar = (id: string) => `--ds-${id.replace(/\./g, '-')}`;

/** Text-on-surface pairs the contrast check measures (WCAG AA, 4.5:1 for body text). */
export const CONTRAST_PAIRS: [fg: string, bg: string][] = [
  ...['text.primary', 'text.secondary', 'text.muted'].flatMap((t) =>
    ['surface.base', 'surface.elevated', 'surface.subtle'].map((s): [string, string] => [t, s]),
  ),
  ['text.primary', 'surface.interactive'],
  ['brand.primary-foreground', 'brand.primary'],
  ['brand.accent-foreground', 'brand.accent'],
  ['text.inverted', 'text.primary'],
  ...['critical', 'warning', 'caution', 'info', 'success'].map((s): [string, string] => [`status.${s}.text`, `status.${s}.bg`]),
];
