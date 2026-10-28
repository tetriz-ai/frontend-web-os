import { describe, expect, it } from 'vitest';
import { formatUsd, splitBill } from '@/shared/lib';

describe('splitBill tip rounding', () => {
  it('rounds 33.33 at 15% half up to a 500 cent tip @AC-calc-8', () => {
    const r = splitBill({ billCents: 3333, tipBasisPoints: 1500, people: 1 });
    expect(r.tipCents).toBe(500);
    expect(r.totalCents).toBe(3833);
  });

  it.each([
    ['0.10 at 5% (0.5 cent rounds up)', 10, 500, 1],
    ['0.30 at 5% (1.5 cents rounds up)', 30, 500, 2],
    ['0.09 at 5% (0.45 cent rounds down)', 9, 500, 0],
    ['0.01 at 50% (0.5 cent rounds up)', 1, 5000, 1],
    ['0.03 at 50% (1.5 cents rounds up)', 3, 5000, 2],
    ['0.01 at 0%', 1, 0, 0],
  ])('rounds half up: %s @AC-calc-8', (_name, billCents, bp, tipCents) => {
    const r = splitBill({ billCents, tipBasisPoints: bp, people: 1 });
    expect(r.tipCents).toBe(tipCents);
    expect(r.totalCents).toBe(billCents + tipCents);
  });

  it('keeps 0.01 at 0% as a one cent total @AC-calc-8', () => {
    expect(splitBill({ billCents: 1, tipBasisPoints: 0, people: 1 }).totalCents).toBe(1);
  });
});

describe('splitBill table', () => {
  it.each([
    ['100 at 18% across 3 @AC-calc-6', 10000, 1800, 3, 1800, 11800, 3934, 11802],
    ['0.01 at 0% across 50 @AC-calc-24', 1, 0, 50, 0, 1, 1, 50],
    ['120 at 18% across 4 @AC-calc-6', 12000, 1800, 4, 2160, 14160, 3540, 14160],
    ['9999999.99 at 18% across 1 @AC-calc-23', 999999999, 1800, 1, 180000000, 1179999999, 1179999999, 1179999999],
  ])('table: %s', (_name, billCents, bp, people, tip, total, per, collected) => {
    expect(splitBill({ billCents, tipBasisPoints: bp, people })).toEqual({
      tipCents: tip,
      totalCents: total,
      perPersonCents: per,
      collectedCents: collected,
    });
  });

  it('splits 100 at 18% across 3 @AC-calc-6', () => {
    const r = splitBill({ billCents: 10000, tipBasisPoints: 1800, people: 3 });
    expect([r.totalCents, r.perPersonCents, r.collectedCents]).toEqual([11800, 3934, 11802]);
    expect(r.collectedCents - r.totalCents).toBe(2);
  });

  it('splits 0.01 at 0% across 50 @AC-calc-24', () => {
    const r = splitBill({ billCents: 1, tipBasisPoints: 0, people: 50 });
    expect([r.perPersonCents, r.collectedCents]).toEqual([1, 50]);
    expect(r.collectedCents - r.totalCents).toBe(49);
  });

  it('splits 120 at 18% across 4 exactly @AC-calc-6', () => {
    const r = splitBill({ billCents: 12000, tipBasisPoints: 1800, people: 4 });
    expect([r.tipCents, r.totalCents, r.perPersonCents]).toEqual([2160, 14160, 3540]);
    expect(r.collectedCents).toBe(r.totalCents);
  });
});

describe('splitBill invariants', () => {
  const bills = [1, 99, 3333, 10000, 12345, 999999999];
  const tips = [0, 1255, 1500, 1800, 10000];
  const people = [1, 2, 3, 7, 50];
  const rows = bills.flatMap((b) => tips.flatMap((t) => people.map((p) => [b, t, p] as const)));

  it.each(rows)('bill %i bp %i people %i keeps the share invariants @AC-calc-6 @AC-calc-24', (billCents, bp, n) => {
    const r = splitBill({ billCents, tipBasisPoints: bp, people: n });
    expect(r.totalCents).toBe(billCents + r.tipCents);
    expect(r.perPersonCents).toBe(Math.ceil(r.totalCents / n));
    expect(r.collectedCents).toBe(r.perPersonCents * n);
    expect(r.collectedCents).toBeGreaterThanOrEqual(r.totalCents);
    expect(r.collectedCents - r.totalCents).toBeLessThan(n);
  });
});

describe('formatUsd', () => {
  it.each([
    [0, '$0.00'],
    [1, '$0.01'],
    [3540, '$35.40'],
    [123450, '$1,234.50'],
    [1179999999, '$11,799,999.99'],
  ])('formats %i cents as %s @AC-calc-23', (cents, text) => {
    expect(formatUsd(cents)).toBe(text);
  });
});
