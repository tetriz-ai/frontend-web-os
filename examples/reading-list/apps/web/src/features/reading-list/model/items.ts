import type { Item } from '../data/types';

/** Newest first, by when each link was saved. Stable, so links saved in the same instant keep their order. */
export function newestFirst(items: readonly Item[]): Item[] {
  return [...items].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
