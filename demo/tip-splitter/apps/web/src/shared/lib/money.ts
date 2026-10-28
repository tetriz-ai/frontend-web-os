// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Bill math in whole cents. Every step is integer arithmetic so no float error reaches money.

export interface SplitInput {
  billCents: number;
  tipBasisPoints: number;
  people: number;
}

export interface SplitResult {
  tipCents: number;
  totalCents: number;
  perPersonCents: number;
  collectedCents: number;
}

export function splitBill({ billCents, tipBasisPoints, people }: SplitInput): SplitResult {
  // bill × bp / 10000, rounded half up: add half the divisor before flooring.
  const tipCents = Math.floor((billCents * tipBasisPoints + 5_000) / 10_000);
  const totalCents = billCents + tipCents;
  // Ceiling division, so the shares always cover the total.
  const perPersonCents = Math.floor((totalCents + people - 1) / people);
  return { tipCents, totalCents, perPersonCents, collectedCents: perPersonCents * people };
}
