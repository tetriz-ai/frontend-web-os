import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BerthGrid } from './berth-grid';

const rows = [
  { id: 'b4', name: 'Berth 4', vessel: 'Morning Star', arrival: '14:05', draught: '14.5 m' },
  { id: 'b7', name: 'Berth 7', vessel: 'Nordic Tern', arrival: '09:30', draught: '11.2 m' },
];

describe('BerthGrid', () => {
  it('@state:berth-grid:idle lists each berth with its vessel', () => {
    render(<BerthGrid rows={rows} />);
    expect(screen.getByRole('button', { name: 'Berth 4' })).toBeTruthy();
    expect(screen.getByText('Nordic Tern')).toBeTruthy();
  });

  it('@state:berth-grid:sorted puts the earliest arrival first', () => {
    render(<BerthGrid rows={rows} sortedBy="arrival" />);
    const first = screen.getAllByRole('row')[1]!;
    expect(within(first).getByRole('button').textContent).toBe('Berth 7');
  });

  it('@state:berth-grid:unbooked says no berths are booked', () => {
    render(<BerthGrid rows={[]} />);
    expect(screen.getByText('No berths are booked today.')).toBeTruthy();
  });

  it('@state:berth-grid:stale says the feed paused and keeps the rows', () => {
    render(<BerthGrid rows={rows} stale />);
    expect(screen.getByRole('status').textContent).toMatch(/Feed paused/);
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
});
