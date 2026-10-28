// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TipCalculator } from '@/features/tip-calculator';

type User = ReturnType<typeof userEvent.setup>;

const BILL_MSG = 'Enter an amount like 42.50, up to 9,999,999.99.';
const TIP_MSG = 'Enter a tip from 0 to 100%, up to 2 decimals.';
const PEOPLE_MSG = 'Enter 1 to 50 people.';
const PICK_MSG = 'Pick a tip or type one.';

const bill = () => screen.getByRole('textbox', { name: 'Bill amount ($)' });
const custom = () => screen.getByRole('textbox', { name: 'Custom tip (%)' });
const people = () => screen.getByRole('textbox', { name: 'People' });
const perPerson = () => screen.getByText('Each person pays').nextElementSibling as HTMLElement;
const tip = () => within(screen.getByText('Tip', { selector: 'dt' }).parentElement!).getByText(/^(—|\$)/);
const total = () => within(screen.getByText('Total', { selector: 'dt' }).parentElement!).getByText(/^(—|\$)/);

async function typeInto(user: User, field: HTMLElement, value: string) {
  await user.clear(field);
  await user.type(field, value);
}
async function leave(user: User) {
  await user.tab();
}
function expectBlankResults() {
  expect(perPerson()).toHaveTextContent('—');
  expect(tip()).toHaveTextContent('—');
  expect(total()).toHaveTextContent('—');
}
function expectNoQuickPick() {
  for (const pick of ['10%', '15%', '18%', '20%']) {
    expect(screen.getByRole('radio', { name: pick })).not.toBeChecked();
  }
}

describe('bill errors', () => {
  it.each(['12..5', 'abc', '-5', '4.505', '10000000'])(
    'clears results at once and shows the bill message only on blur for "%s" @AC-calc-10 @state:calculator:invalid-bill',
    async (value) => {
      const user = userEvent.setup();
      render(<TipCalculator />);
      await typeInto(user, bill(), value);
      expect(bill()).toHaveFocus();
      expectBlankResults();
      expect(screen.queryByText(BILL_MSG)).not.toBeInTheDocument();
      await leave(user);
      expect(screen.getByText(BILL_MSG)).toBeInTheDocument();
      expect(bill()).toBeInvalid();
      expectBlankResults();
    },
  );

  it.each(['1,2345', '1.234'])(
    'shows the bill error on blur for "%s" @AC-calc-10 @state:calculator:invalid-bill',
    async (value) => {
      const user = userEvent.setup();
      render(<TipCalculator />);
      await typeInto(user, bill(), value);
      expect(screen.queryByText(BILL_MSG)).not.toBeInTheDocument();
      await leave(user);
      expect(screen.getByText(BILL_MSG)).toBeInTheDocument();
      expect(bill()).toBeInvalid();
    },
  );

  it('clears the bill error when I fix the value @AC-calc-11 @state:calculator:rounded', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await typeInto(user, bill(), '12..5');
    await leave(user);
    expect(screen.getByText(BILL_MSG)).toBeInTheDocument();
    await user.click(bill());
    await typeInto(user, bill(), '12.5');
    expect(screen.queryByText(BILL_MSG)).not.toBeInTheDocument();
    expect(bill()).not.toBeInvalid();
    expect(perPerson()).toHaveTextContent('$7.38');
    expect(total()).toHaveTextContent('$14.75');
  });

  it('accepts the largest bill and people 1 and 50, and recovers from 0 people @AC-calc-10 @AC-calc-16 @state:calculator:ready @state:calculator:people-bounds', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await typeInto(user, bill(), '9999999.99');
    await leave(user);
    expect(screen.queryByText(BILL_MSG)).not.toBeInTheDocument();
    expect(bill()).not.toBeInvalid();
    expect(perPerson()).toHaveTextContent('$');

    for (const n of ['1', '50']) {
      await typeInto(user, people(), n);
      await leave(user);
      expect(screen.queryByText(PEOPLE_MSG)).not.toBeInTheDocument();
      expect(people()).not.toBeInvalid();
      expect(perPerson()).toHaveTextContent('$');
    }

    await typeInto(user, people(), '0');
    await leave(user);
    expect(screen.getByText(PEOPLE_MSG)).toBeInTheDocument();
    expectBlankResults();
    await user.click(people());
    await typeInto(user, people(), '2');
    expect(screen.queryByText(PEOPLE_MSG)).not.toBeInTheDocument();
    expect(people()).not.toBeInvalid();
    expect(perPerson()).toHaveTextContent('$');
  });
});

describe('custom tip errors', () => {
  it.each(['150', '-1', 'abc', '12.345'])(
    'marks custom tip "%s" invalid on blur, unchecks picks and blanks results @AC-calc-13 @state:calculator:invalid-tip',
    async (value) => {
      const user = userEvent.setup();
      render(<TipCalculator />);
      await user.type(bill(), '80.00');
      await typeInto(user, custom(), value);
      expectBlankResults();
      await leave(user);
      expect(screen.getByText(TIP_MSG)).toBeInTheDocument();
      expect(custom()).toBeInvalid();
      expectNoQuickPick();
      expectBlankResults();
    },
  );

  it.each([
    ['100', '$80.00'],
    ['12.5', '$10.00'],
    ['12.55', '$10.04'],
  ])(
    'accepts custom tip "%s" @AC-calc-13 @state:calculator:invalid-tip',
    async (value, expectedTip) => {
      const user = userEvent.setup();
      render(<TipCalculator />);
      await user.type(bill(), '80.00');
      await typeInto(user, custom(), value);
      await leave(user);
      expect(screen.queryByText(TIP_MSG)).not.toBeInTheDocument();
      expect(custom()).not.toBeInvalid();
      expect(tip()).toHaveTextContent(expectedTip);
    },
  );

  it('asks for a tip when the custom tip is cleared, and a pick brings results back @AC-calc-14 @state:calculator:invalid-tip', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await user.type(bill(), '80.00');
    await user.type(custom(), '12');
    expectNoQuickPick();
    expect(tip()).toHaveTextContent('$9.60');
    await user.clear(custom());
    expectBlankResults();
    expect(screen.getByText(PICK_MSG)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '18%' }));
    expect(screen.queryByText(PICK_MSG)).not.toBeInTheDocument();
    expect(tip()).toHaveTextContent('$14.40');
    expect(total()).toHaveTextContent('$94.40');
  });
});

describe('people errors', () => {
  it.each(['0', '51', '2.5', 'abc'])(
    'flags "%s" people on blur, blanks results and keeps what I typed @AC-calc-16 @state:calculator:people-bounds',
    async (value) => {
      const user = userEvent.setup();
      render(<TipCalculator />);
      await user.type(bill(), '80.00');
      await typeInto(user, people(), value);
      expectBlankResults();
      await leave(user);
      expect(screen.getByText(PEOPLE_MSG)).toBeInTheDocument();
      expect(people()).toBeInvalid();
      expect(people()).toHaveValue(value);
      expectBlankResults();
    },
  );
});

describe('reset from an invalid state', () => {
  it('clears every message and aria-invalid @AC-calc-17 @state:calculator:invalid-bill @state:calculator:invalid-tip @state:calculator:people-bounds', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await typeInto(user, bill(), '12..5');
    await typeInto(user, custom(), '150');
    await typeInto(user, people(), '0');
    await leave(user);
    expect(screen.getByText(BILL_MSG)).toBeInTheDocument();
    expect(screen.getByText(TIP_MSG)).toBeInTheDocument();
    expect(screen.getByText(PEOPLE_MSG)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    for (const msg of [BILL_MSG, TIP_MSG, PEOPLE_MSG, PICK_MSG]) {
      expect(screen.queryByText(msg)).not.toBeInTheDocument();
    }
    for (const field of [bill(), custom(), people()]) {
      expect(field).not.toBeInvalid();
    }
    expect(bill()).toHaveValue('');
    expect(custom()).toHaveValue('');
    expect(people()).toHaveValue('2');
    expect(screen.getByRole('radio', { name: '18%' })).toBeChecked();
    expectBlankResults();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the no-tip message too @AC-calc-17 @state:calculator:invalid-tip', async () => {
    const user = userEvent.setup();
    render(<TipCalculator />);
    await user.type(bill(), '80.00');
    await user.type(custom(), '12');
    await user.clear(custom());
    expect(screen.getByText(PICK_MSG)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.queryByText(PICK_MSG)).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '18%' })).toBeChecked();
  });
});
