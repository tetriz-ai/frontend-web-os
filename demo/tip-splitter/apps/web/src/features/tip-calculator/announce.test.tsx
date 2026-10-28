// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TipCalculator } from '@/features/tip-calculator';

const bill = () => screen.getByRole('textbox', { name: 'Bill amount ($)' });
const people = () => screen.getByRole('textbox', { name: 'People' });
const status = () => screen.getByRole('status');

describe('screen-reader announcement', () => {
  // Pure fake timers: real time must not leak into the clock, or the 500 ms boundary drifts.
  // Testing Library only drains its async wrapper on fake time when a `jest` global exists.
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { jest?: unknown }).jest = { advanceTimersByTime: vi.advanceTimersByTime };
  });
  afterEach(() => {
    delete (globalThis as { jest?: unknown }).jest;
    vi.useRealTimers();
  });

  it('announces the split only after typing settles for 500 ms @AC-calc-18 @state:calculator:ready', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null });
    render(<TipCalculator />);
    await user.clear(people());
    await user.type(people(), '4');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(status()).toHaveAttribute('aria-atomic', 'true');

    for (const key of ['1', '2', '0', '.', '0', '0']) {
      await user.type(bill(), key);
      expect(status()).toHaveTextContent('');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(status()).toHaveTextContent('');
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(status().textContent).toBe('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(status().textContent).toBe('Tip $21.60, total $141.60, $35.40 each.');
  });

  it('adds "rounded up" when the share does not divide evenly @AC-calc-18 @state:calculator:ready', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null });
    render(<TipCalculator />);
    await user.clear(people());
    await user.type(people(), '3');
    await user.type(bill(), '100');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(status().textContent).toBe('Tip $18.00, total $118.00, $39.34 each, rounded up.');
  });
});
