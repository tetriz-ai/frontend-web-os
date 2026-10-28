import { afterEach, describe, expect, it, vi } from 'vitest';
import { READING_LIST_STORAGE_KEY, createLocalRepository } from '@/features/reading-list';
import { fixtures } from '../../../../../packages/api-contract/generated/mock-fetch';

// TC-reading-13: the local store keeps the contract's shapes across instances. The provider side of
// the seam: what it returns has exactly the fields of the shared fixtures.

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const itemShape = Object.keys(fixtures.createItem!.default!.body as object).sort();
const unavailable = (fixtures.listItems!.unavailable!.body as { message: string }).message;

afterEach(() => {
  vi.useRealTimers();
});

describe('the local store', () => {
  it('lists what another store saved, newest first, in the contract shape @AC-reading-1 @AC-reading-2', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T12:00:00.000Z'));
    const storage = new MemoryStorage();
    const first = createLocalRepository(() => storage);

    const titled = await first.createItem({ url: 'https://example.com/articles/slow-reading', title: 'The case for slow reading' });
    vi.setSystemTime(new Date('2026-10-07T12:01:00.000Z'));
    const untitled = await first.createItem({ url: 'https://blog.example.org/2026/09/notes-on-focus' });

    expect(Object.keys(titled).sort()).toEqual(itemShape);
    expect(titled).toMatchObject({ title: 'The case for slow reading', read: false, savedAt: '2026-10-07T12:00:00.000Z' });
    expect(untitled).toMatchObject({ title: 'blog.example.org', read: false, savedAt: '2026-10-07T12:01:00.000Z' });
    expect(untitled.id).not.toBe(titled.id);

    const listed = await createLocalRepository(() => storage).listItems();
    expect(listed).toEqual([untitled, titled]);
    for (const item of listed) expect(Object.keys(item).sort()).toEqual(itemShape);
  });

  it('reads a stored contract list body as it is, sorted newest first @AC-reading-1', async () => {
    const many = fixtures.listItems!.many!.body as { savedAt: string }[];
    const storage = new MemoryStorage();
    storage.setItem(READING_LIST_STORAGE_KEY, JSON.stringify([...many].reverse()));
    expect(await createLocalRepository(() => storage).listItems()).toEqual(many);
  });

  it('fails with the reason from listItems.unavailable when storage is blocked @AC-reading-10', async () => {
    const blocked = createLocalRepository(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    await expect(blocked.listItems()).rejects.toThrow(unavailable);
    await expect(blocked.createItem({ url: 'https://example.com/' })).rejects.toThrow(unavailable);
  });
});
