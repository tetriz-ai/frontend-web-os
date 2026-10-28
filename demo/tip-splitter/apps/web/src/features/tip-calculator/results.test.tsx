// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TipCalculator } from '@/features/tip-calculator';

const bill = () => screen.getByRole('textbox', { name: 'Bill amount ($)' });
const custom = () => screen.getByRole('textbox', { name: 'Custom tip (%)' });
const people = () => screen.getByRole('textbox', { name: 'People' });
const perPerson = () => screen.getByText('Each person pays').nextElementSibling as HTMLElement;
const tip = () => within(screen.getByText('Tip', { selector: 'dt' }).parentElement!).getByText(/^(—|\$)/);
const total = () => within(screen.getByText('Total', { selector: 'dt' }).parentElement!).getByText(/^(—|\$)/);

async function typeBill(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.clear(bill());
  await user.type(bill(), value);
}
async function typePeople(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.clear(people());
  await user.type(people(), value);
}

describe('live results', () => {
  it('updates results live as I type and step @AC-calc-2 @state:calculator:ready', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await user.type(bill(), '120.00');
    await user.click(screen.getByRole('button', { name: 'Increase people' }));
    await user.click(screen.getByRole('button', { name: 'Increase people' }));
    expect(people()).toHaveValue('4');
    expect(tip()).toHaveTextContent('$21.60');
    expect(total()).toHaveTextContent('$141.60');
    expect(perPerson()).toHaveTextContent('$35.40');
  });

  it('applies a tapped quick pick @AC-calc-3 @state:calculator:ready', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await user.type(bill(), '120.00');
    await typePeople(user, '4');
    await user.click(screen.getByRole('radio', { name: '20%' }));
    expect(screen.getByRole('radio', { name: '20%' })).toBeChecked();
    expect(tip()).toHaveTextContent('$24.00');
    expect(total()).toHaveTextContent('$144.00');
    expect(perPerson()).toHaveTextContent('$36.00');
  });

  it('custom tip unchecks picks and a pick clears the custom tip @AC-calc-4', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await user.type(bill(), '120.00');
    await typePeople(user, '4');
    expect(screen.getByRole('radio', { name: '18%' })).toBeChecked();
    await user.type(custom(), '12.5');
    for (const pick of ['10%', '15%', '18%', '20%']) {
      expect(screen.getByRole('radio', { name: pick })).not.toBeChecked();
    }
    expect(tip()).toHaveTextContent('$15.00');
    expect(total()).toHaveTextContent('$135.00');
    expect(perPerson()).toHaveTextContent('$33.75');
    await user.click(screen.getByRole('radio', { name: '15%' }));
    expect(custom()).toHaveValue('');
    expect(tip()).toHaveTextContent('$18.00');
  });

  it('accepts a custom tip of 0 with no error @AC-calc-5 @state:calculator:ready', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await user.type(bill(), '50.00');
    await user.type(custom(), '0');
    expect(tip()).toHaveTextContent('$0.00');
    expect(total()).toHaveTextContent('$50.00');
    expect(perPerson()).toHaveTextContent('$25.00');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rounds each share up and says so @AC-calc-6 @state:calculator:rounded', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await user.type(bill(), '100');
    await typePeople(user, '3');
    expect(perPerson()).toHaveTextContent('$39.34');
    expect(screen.getByText('Rounded up: the group pays $118.02, $0.02 over the total.')).toBeInTheDocument();
  });

  it('shows no rounding note when shares divide evenly @AC-calc-7 @state:calculator:ready', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await user.type(bill(), '120.00');
    await typePeople(user, '4');
    expect(perPerson()).toHaveTextContent('$35.40');
    expect(screen.queryByText(/^Rounded up/)).not.toBeInTheDocument();
  });

  it('rounds the tip to the cent @AC-calc-8', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await user.type(bill(), '33.33');
    await user.click(screen.getByRole('button', { name: 'Decrease people' }));
    await user.click(screen.getByRole('radio', { name: '15%' }));
    expect(tip()).toHaveTextContent('$5.00');
    expect(total()).toHaveTextContent('$38.33');
  });

  it('reads the valid bill formats @AC-calc-9', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await user.click(screen.getByRole('button', { name: 'Decrease people' }));
    await user.type(custom(), '0');
    const cases: Array<[string, string]> = [
      ['42,50', '$42.50'],
      ['$1,234.50', '$1,234.50'],
      ['1,234', '$1,234.00'],
      [' 42.5 ', '$42.50'],
      ['1.234,50', '$1,234.50'],
      ['1,234,567', '$1,234,567.00'],
      ['1.234.567', '$1,234,567.00'],
      ['12,345.6', '$12,345.60'],
    ];
    for (const [input, expected] of cases) {
      await typeBill(user, input);
      expect(total(), `bill "${input}"`).toHaveTextContent(expected);
    }
    for (const input of ['1,2345', '1.234']) {
      await typeBill(user, input);
      expect(total(), `bill "${input}"`).toHaveTextContent('—');
    }
  });

  it('shows zeros for a bill of 0 with no error @AC-calc-12 @state:calculator:ready', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await user.type(bill(), '0');
    expect(tip()).toHaveTextContent('$0.00');
    expect(total()).toHaveTextContent('$0.00');
    expect(perPerson()).toHaveTextContent('$0.00');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stops the stepper at 1 and 50 @AC-calc-15 @state:calculator:people-bounds', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await user.type(bill(), '64.50');
    await user.click(screen.getByRole('radio', { name: '20%' }));
    await user.click(screen.getByRole('button', { name: 'Decrease people' }));
    expect(people()).toHaveValue('1');
    expect(screen.getByRole('button', { name: 'Decrease people' })).toBeDisabled();
    expect(perPerson()).toHaveTextContent('$77.40');
    expect(screen.getByText('Just you, so you pay the whole total.')).toBeInTheDocument();

    await typePeople(user, '49');
    await user.click(screen.getByRole('button', { name: 'Increase people' }));
    expect(people()).toHaveValue('50');
    expect(screen.getByRole('button', { name: 'Increase people' })).toBeDisabled();
  });

  it('rounds a one-cent bill across 50 people up @AC-calc-24 @state:calculator:rounded @state:calculator:people-bounds', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await user.type(bill(), '0.01');
    await user.type(custom(), '0');
    await typePeople(user, '50');
    expect(perPerson()).toHaveTextContent('$0.01');
    expect(screen.getByText('Rounded up: the group pays $0.50, $0.49 over the total.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase people' })).toBeDisabled();
  });

  it('describes Bill amount with the pre-tax hint @AC-calc-26 @state:calculator:empty', () => {
    render(<TipCalculator />);
    const hint = 'Tip is on the amount you enter. Enter it before tax if you tip pre-tax.';
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(bill()).toHaveAccessibleDescription(hint);
  });
});
