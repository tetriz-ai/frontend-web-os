// Local mode (D-6): the contract's operations over this browser's site storage. The stored value is
// the contract's listItems body, an array of Items, under one key. This is the only file in the app
// that touches storage (rule pack: no-storage-in-ui).

import { newestFirst } from '../model/items';
import { checkLink, titleFor } from '../model/link';
import { ITEM_MISSING, type ReadingListRepository, STORAGE_UNAVAILABLE } from './repository';
import type { Item } from './types';

export const READING_LIST_STORAGE_KEY = 'reading-list.items';

/** The two Storage methods the repository needs, so tests can hand it an in-memory store. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const browserStorage = (): StorageLike => window.localStorage;

const isItem = (v: unknown): v is Item => {
  const i = v as Partial<Item> | null;
  return (
    !!i &&
    typeof i.id === 'string' &&
    typeof i.url === 'string' &&
    typeof i.title === 'string' &&
    typeof i.savedAt === 'string' &&
    typeof i.read === 'boolean'
  );
};

const newId = () => `itm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Any storage failure (blocked site data, a private window, a full quota) becomes one plain reason. */
function guard<T>(run: () => T): T {
  try {
    return run();
  } catch {
    throw new Error(STORAGE_UNAVAILABLE);
  }
}

export function createLocalRepository(getStorage: () => StorageLike = browserStorage): ReadingListRepository {
  const read = (): Item[] => {
    const raw = guard(() => getStorage().getItem(READING_LIST_STORAGE_KEY));
    if (!raw) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    return Array.isArray(parsed) ? newestFirst(parsed.filter(isItem)) : [];
  };
  const write = (items: Item[]) => guard(() => getStorage().setItem(READING_LIST_STORAGE_KEY, JSON.stringify(items)));
  const find = (items: Item[], id: string) => {
    const index = items.findIndex((i) => i.id === id);
    if (index === -1) throw new Error(ITEM_MISSING);
    return index;
  };

  return {
    async listItems() {
      return read();
    },
    async createItem(input) {
      const link = checkLink(input.url);
      if (!link.ok) throw new Error(link.message);
      const items = read();
      const item: Item = {
        id: newId(),
        url: link.url,
        title: titleFor(link.url, input.title),
        savedAt: new Date().toISOString(),
        read: false,
      };
      write([item, ...items]);
      return item;
    },
    async updateItem(id, patch) {
      const items = read();
      const index = find(items, id);
      const item: Item = { ...items[index]!, read: patch.read };
      items[index] = item;
      write(items);
      return item;
    },
    async deleteItem(id) {
      const items = read();
      const index = find(items, id);
      items.splice(index, 1);
      write(items);
    },
  };
}
