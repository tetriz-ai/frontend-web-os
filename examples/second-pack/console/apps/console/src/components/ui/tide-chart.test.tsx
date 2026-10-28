import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TideChart } from './tide-chart';

describe('TideChart', () => {
  it('@state:tide-chart:idle draws the tide as a line', () => {
    render(<TideChart label="Tide" points={[{ hour: 0, metres: 1.2 }, { hour: 6, metres: 3.4 }]} />);
    expect(screen.getByRole('img', { name: 'Tide' }).querySelector('path')?.getAttribute('d')).toMatch(/^M0 /);
  });

  it('@state:tide-chart:busy holds the space while readings load', () => {
    render(<TideChart label="Tide" points={[]} busy />);
    expect(screen.getByLabelText('Tide').getAttribute('aria-busy')).toBe('true');
  });

  it('@state:tide-chart:offline shows no readings when the gauge is down', () => {
    render(<TideChart label="Tide" points={[{ hour: 0, metres: 1.2 }]} offline />);
    expect(screen.getByRole('status').textContent).toBe('Tide gauge offline. No readings to show.');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
