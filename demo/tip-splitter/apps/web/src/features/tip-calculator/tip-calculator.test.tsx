// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TipCalculator } from '@/features/tip-calculator';

describe('tip calculator opening state', () => {
  it('shows the opening values when it mounts with no input @AC-calc-1 @state:calculator:empty', () => {
    render(<TipCalculator />);

    expect(screen.getByRole('heading', { level: 1, name: 'Split the bill' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Bill amount ($)' })).toHaveValue('');
    expect(screen.getByRole('group', { name: 'Tip' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '18%' })).toBeChecked();
    for (const other of ['10%', '15%', '20%']) {
      expect(screen.getByRole('radio', { name: other })).not.toBeChecked();
    }
    expect(screen.getByRole('textbox', { name: 'Custom tip (%)' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'People' })).toHaveValue('2');

    const perPerson = screen.getByText('Each person pays');
    expect(perPerson.nextElementSibling).toHaveTextContent('—');
    const tip = screen.getByText('Tip', { selector: 'dt' });
    expect(within(tip.parentElement!).getByText('—')).toBeInTheDocument();
    const total = screen.getByText('Total', { selector: 'dt' });
    expect(within(total.parentElement!).getByText('—')).toBeInTheDocument();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
