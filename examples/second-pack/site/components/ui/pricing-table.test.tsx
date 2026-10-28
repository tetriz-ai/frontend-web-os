import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PricingTable } from './pricing-table';

const plans = [{ id: 'quay', name: 'Quay', monthly: '€490 a month', yearly: '€4,900 a year' }];
const noop = () => {};

describe('PricingTable', () => {
  it('@state:pricing-table:monthly shows monthly prices first', () => {
    render(<PricingTable plans={plans} onQuote={noop} />);
    expect(screen.getByText('€490 a month')).toBeTruthy();
  });

  it('@state:pricing-table:yearly shows yearly prices once chosen', () => {
    render(<PricingTable plans={plans} onQuote={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yearly' }));
    expect(screen.getByText('€4,900 a year')).toBeTruthy();
  });

  it('@state:pricing-table:loading-quote keeps the button disabled while the request is sent', () => {
    render(<PricingTable plans={plans} onQuote={noop} quoting />);
    const button = screen.getByRole('button', { name: 'Sending your request' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
