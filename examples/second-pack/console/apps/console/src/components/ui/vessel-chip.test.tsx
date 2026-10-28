import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VesselChip } from './vessel-chip';

describe('VesselChip', () => {
  it('@state:vessel-chip:idle names the vessel, then its IMO number', () => {
    render(<VesselChip name="Morning Star" imo="9321483" />);
    expect(screen.getByRole('button').textContent).toBe('Morning Star (IMO 9321483)');
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');
  });

  it('@state:vessel-chip:selected is pressed', () => {
    render(<VesselChip name="Morning Star" imo="9321483" selected />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
  });
});
