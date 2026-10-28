import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LogoWall } from './logo-wall';

const ports = [{ name: 'Port of Haven', logo: '/ports/haven.svg' }];

describe('LogoWall', () => {
  it('@state:logo-wall:static wraps the logos in rows', () => {
    render(<LogoWall ports={ports} />);
    expect(screen.getByRole('list').getAttribute('data-scrolling')).toBeNull();
    expect(screen.getByAltText('Port of Haven')).toBeTruthy();
  });

  it('@state:logo-wall:scrolling scrolls sideways', () => {
    render(<LogoWall ports={ports} scrolling />);
    expect(screen.getByRole('list').getAttribute('data-scrolling')).toBe('true');
  });
});
