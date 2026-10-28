import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeroBanner } from './hero-banner';

const action = { label: 'Book a demo', href: '/pricing' };

describe('HeroBanner', () => {
  it('@state:hero-banner:plain shows the headline and one call to action', () => {
    const { container } = render(<HeroBanner headline="Berths booked without a phone call." action={action} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Berths booked without a phone call.');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(container.querySelector('video')).toBeNull();
  });

  it('@state:hero-banner:with-video plays a muted film behind it, hidden from screen readers', () => {
    const { container } = render(<HeroBanner headline="Berths" action={action} video="/harbour.mp4" />);
    const video = container.querySelector('video')!;
    expect(video.muted).toBe(true);
    expect(video.getAttribute('aria-hidden')).toBe('true');
  });
});
