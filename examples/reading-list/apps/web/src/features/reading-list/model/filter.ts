import type { Item } from '../data/types';

// The filter lives in the address (R-interaction-6): / is All, /?show=unread and /?show=read.

export type Filter = 'all' | 'unread' | 'read';

export const FILTERS: readonly { id: Filter; label: string; href: string }[] = [
  { id: 'all', label: 'All', href: '/' },
  { id: 'unread', label: 'Unread', href: '/?show=unread' },
  { id: 'read', label: 'Read', href: '/?show=read' },
];

/** The `show` value from the address. Anything unknown means All (D-12). */
export function parseFilter(show: string | undefined): Filter {
  return show === 'unread' || show === 'read' ? show : 'all';
}

export function applyFilter(items: readonly Item[], filter: Filter): Item[] {
  if (filter === 'all') return [...items];
  return items.filter((item) => item.read === (filter === 'read'));
}

export const filterLabel = (filter: Filter) => FILTERS.find((f) => f.id === filter)!.label;
