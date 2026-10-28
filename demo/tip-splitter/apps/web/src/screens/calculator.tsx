// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

'use client';

import { CalculatorView, type CalculatorViewProps } from '@/features/tip-calculator';
import type { ScreenProps } from './registry';

const blank = { tipCents: null, totalCents: null, perPersonCents: null, collectedCents: null };

/** Fake data for each state in docs/app/ia.json (page `calculator`). */
const STATES: Record<string, CalculatorViewProps> = {
  empty: { bill: '', tipPick: '18', customTip: '', people: '2', ...blank, announcement: '' },
  ready: {
    bill: '120.00', tipPick: '18', customTip: '', people: '4',
    tipCents: 2160, totalCents: 14160, perPersonCents: 3540, collectedCents: 14160,
    announcement: 'Tip $21.60, total $141.60, $35.40 each.',
  },
  rounded: {
    bill: '100', tipPick: '18', customTip: '', people: '3',
    tipCents: 1800, totalCents: 11800, perPersonCents: 3934, collectedCents: 11802,
    announcement: 'Tip $18.00, total $118.00, $39.34 each, rounded up.',
  },
  'invalid-bill': {
    bill: '12..5', billError: 'Enter an amount like 42.50, up to 9,999,999.99.', tipPick: '18', customTip: '', people: '2',
    ...blank, announcement: '',
  },
  'invalid-tip': {
    bill: '80.00', tipPick: null, customTip: '150', tipError: 'Enter a tip from 0 to 100%, up to 2 decimals.', people: '2',
    ...blank, announcement: '',
  },
  'people-bounds': {
    bill: '64.50', tipPick: '20', customTip: '', people: '1',
    tipCents: 1290, totalCents: 7740, perPersonCents: 7740, collectedCents: 7740,
    announcement: 'Tip $12.90, total $77.40, $77.40 each.',
  },
};

export function CalculatorScreen({ state }: ScreenProps) {
  return <CalculatorView {...(STATES[state] ?? STATES.empty!)} />;
}
