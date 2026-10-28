import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommandPalette } from '.';

const items = [{ label: 'Berth 4', target: 'b4' }, { label: 'Morning Star (IMO 9321483)', target: 'v118' }];
const noop = () => {};

describe('CommandPalette', () => {
  it('@state:command-palette:closed renders nothing', () => {
    const { container } = render(<CommandPalette items={items} open={false} onClose={noop} onPick={noop} />);
    expect(container.innerHTML).toBe('');
  });

  it('@state:command-palette:open lists every target', () => {
    render(<CommandPalette items={items} open onClose={noop} onPick={noop} />);
    expect(screen.getByRole('dialog', { name: 'Jump to' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('@state:command-palette:no-results says what to try', () => {
    render(<CommandPalette items={items} open onClose={noop} onPick={noop} />);
    fireEvent.change(screen.getByLabelText('Berth, vessel or voyage'), { target: { value: 'zzz' } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });
});
