import { expect, it } from 'vitest';
import { formatRelative } from '@/shared/lib';
import { fixtures } from '../../../../../packages/api-contract/generated/mock-fetch';

// TC-reading-7 (existing behaviour): the shared formatter reads saved dates as relative within a
// week and as a date beyond it.

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const many = fixtures.listItems!.many!.body as { id: string; savedAt: string }[];
const savedAt = (id: string) => many.find((i) => i.id === id)!.savedAt;

it('saved dates read relative within a week and as a date beyond it @AC-reading-4', () => {
  expect(formatRelative(savedAt('itm_18'), NOW)).toBe('2 minutes ago');
  expect(formatRelative(savedAt('itm_16'), NOW)).toBe('3 days ago');
  expect(formatRelative(savedAt('itm_14'), NOW)).toBe('Sep 28, 2026');
});
